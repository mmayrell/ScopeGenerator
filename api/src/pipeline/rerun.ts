import { InvocationContext } from '@azure/functions'
import { JobMessage, Lesson, Scope, Unit } from '../domain/types'
import { getScope, getScopeEvidenceSet, getScopeSourceSets, mutateScope, snapshotScope } from '../data/entities'
import { dedupeStudentTitles } from './titles'
import { mutateJob, pushLog } from '../data/jobs'
import { generateStructured } from '../services/claude'
import { rerunLessonPrompt, rerunUnitPrompt } from '../services/prompts'
import {
  RERUN_LESSON_SCHEMA,
  RERUN_UNIT_SCHEMA,
  toLesson,
  WireLesson,
} from '../services/schemas'
import { today } from '../shared/util'
import { loadScopeUploadDocs } from './scope-uploads'
import { findLesson } from './qc'

/**
 * Worker for kind `rerun` (contract §Other kinds): Claude regenerates the
 * target — the lesson card for `regenerate`, the containing unit's lesson list
 * for `split`/`merge`. New version, snapshot, history entry (log override
 * when the guardrail was overridden).
 */
export async function rerunRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  if (!msg.scopeId) throw new Error('rerun message missing scopeId')
  const payload = (msg.payload ?? {}) as { target?: string; mode?: string; override?: boolean }
  const target = String(payload.target ?? '')
  const mode = String(payload.mode ?? 'regenerate')
  const override = payload.override === true

  const scope = await getScope(msg.scopeId)
  const set = await getScopeEvidenceSet(scope)
  const sourceSets = await getScopeSourceSets(scope) // [] unless multi-set (cross-framework union)
  const userDocs = await loadScopeUploadDocs(scope, ctx) // user-attached released-question PDFs (topic requests)
  const validItemIds = new Set(set.items.map((it) => it.id))

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage =
      mode === 'regenerate'
        ? `Stage 5 — Regenerating ${target} in place`
        : // Singular 'Stage' — the frontend parses the label with /stage\s*(\d+)/i.
          `Stage 3–6 — Re-atomizing around ${target} (${mode})`
    pushLog(r, `Rerun ${mode} on ${target}${override ? ' (guardrail override)' : ''}`)
  })

  const located = findLesson(scope.units, target)
  const targetUnit = located?.unit ?? scope.units.find((u) => u.id === target)
  if (!targetUnit) throw new Error(`rerun target ${target} not found in scope ${scope.id}`)

  // Explicit per-mode branches — a regenerate whose target is not a lesson must
  // fail visibly, never fall through to a merge re-atomization.
  let applyChanges: (s: Scope) => void
  if (mode === 'regenerate') {
    if (!located) {
      throw new Error(
        `rerun regenerate: target ${target} does not resolve to a lesson in scope ${scope.id} — regenerate requires a lesson target`,
      )
    }
    const wire = await generateStructured<{ lesson: WireLesson }>({
      ...rerunLessonPrompt(set, scope, located.unit, located.lesson, sourceSets, userDocs.names),
      schema: RERUN_LESSON_SCHEMA,
      effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
    })
    // Regenerate-in-place keeps the lesson's position in the chain, so its
    // current itemRefs remain the attachment authority — restore any ref the
    // rerun call lost or mangled.
    const regenerated = toLesson(wire.lesson, validItemIds, located.lesson.itemRefs)
    applyChanges = (s) =>
      replaceLesson(s.units, targetUnit.id, located.lesson.id, (old) => ({ ...regenerated, id: old.id }))
  } else if (mode === 'split' || mode === 'merge') {
    const wire = await generateStructured<{ lessons: WireLesson[] }>({
      ...rerunUnitPrompt(set, scope, targetUnit, mode, target, override, sourceSets, userDocs.names),
      schema: RERUN_UNIT_SCHEMA,
      effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
    })
    if (!wire.lessons || wire.lessons.length === 0) {
      throw new Error(`rerun produced no lessons for unit ${targetUnit.id}`)
    }
    applyChanges = (s) => {
      const idx = s.units.findIndex((u) => u.id === targetUnit.id)
      if (idx < 0) throw new Error(`rerun: unit ${targetUnit.id} no longer exists in scope ${s.id}`)
      s.units[idx] = { ...s.units[idx], lessons: wire.lessons.map((w) => toLesson(w, validItemIds)) }
    }
  } else {
    throw new Error(`unknown rerun mode: ${mode} — expected split, merge or regenerate`)
  }

  // New immutable version + history entry (texts mirror src/store.tsx rerun()).
  const modeLabel = mode === 'split' ? 'more granular' : mode === 'merge' ? 'less granular' : 'regenerate in place'
  const updated = await mutateScope(scope.id, (s) => {
    applyChanges(s)
    // A rerun mints titles without a course-wide view — re-enforce display-title uniqueness.
    dedupeStudentTitles(s.units)
    s.version += 1
    s.status = 'complete'
    delete s.error
    s.updated = today()
    s.history.push({
      version: s.version,
      date: today(),
      actor: s.creator,
      event: `Rerun — ${modeLabel}`,
      detail: override
        ? `Target ${target}. Guardrail override recorded: merge across a protected boundary executed by explicit user override; logged in the RerunEvent and the affected Decision records, flagged in QC.`
        : `Target ${target}. Stage re-entry per §6: relational fields of adjacent lessons auto-regenerated.`,
    })
    if (override) {
      s.qc = [
        ...s.qc.filter((c) => c.name !== 'Guardrail override'),
        {
          name: 'Guardrail override',
          status: 'flag',
          detail: `v${s.version}: merge across a protected hard-split boundary executed on ${target} by explicit user override; recorded in the RerunEvent and the affected Decision records.`,
        },
      ]
    }
  })

  await snapshotScope(updated)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(r, `Rerun ${modeLabel} on ${target} complete — version ${updated.version}`)
  })
  ctx.log(`rerun/run ${msg.jobId}: ${mode} on ${target} → v${updated.version}`)
}

function replaceLesson(
  units: Unit[],
  unitId: string,
  lessonId: string,
  fn: (old: Lesson) => Lesson,
): void {
  const unit = units.find((u) => u.id === unitId)
  if (!unit) return
  unit.lessons = unit.lessons.map((l) => (l.id === lessonId ? fn(l) : l))
}
