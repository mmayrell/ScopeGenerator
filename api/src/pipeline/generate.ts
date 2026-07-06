import { InvocationContext } from '@azure/functions'
import { JobMessage, Lesson, Unit } from '../domain/types'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { getScope, getSet, mutateScope, saveScope, snapshotScope } from '../data/entities'
import { completeUnit, getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { cardsPrompt, planPrompt } from '../services/prompts'
import {
  PLAN_SCHEMA,
  PlanLessonSkeleton,
  PlanOutput,
  toLesson,
  UNIT_CARDS_BATCH_SCHEMA,
  WireLessonBatch,
} from '../services/schemas'
import { today } from '../shared/util'
import { countLessons, deriveProtectedBoundaries, runQc } from './qc'

// Generation pipeline (contract §Generation pipeline), checkpointed for the
// 10-minute consumption timeout:
//   plan     (Stages 2–4, one Claude call)  → jobs/<jobId>/plan.json
//   cards    (Stage 5, parallel per unit)   → jobs/<jobId>/unit-<i>.json
//   finalize (Stage 6, programmatic QC)     → the assembled Scope, v1 snapshot

// Singular 'Stage' — the frontend parses the label with /stage\s*(\d+)/i.
const STAGE_PLAN = 'Stage 2–4 — Scope resolution, atomization & sequencing'
const STAGE_CARDS = 'Stage 5 — Card generation'
const STAGE_FINALIZE = 'Stage 6 — Assembly & auto-QC'
export const GENERATE_TOTAL_STAGES = 3

const planPath = (jobId: string) => `jobs/${jobId}/plan.json`
const unitPath = (jobId: string, i: number) => `jobs/${jobId}/unit-${i}.json`
const unitBatchPath = (jobId: string, i: number, b: number) => `jobs/${jobId}/unit-${i}-batch-${b}.json`

// Cards generate at most this many lessons per Claude call: a 10-lesson unit's
// full 13-field cards overflowed the 48k output budget in production (the
// truncation error is terminal, so every queue retry repeated the identical
// oversized call). Batches also keep each call well inside the 10-minute
// Consumption timeout.
const CARDS_LESSON_BATCH = 4
// Leave headroom inside the 10-minute functionTimeout: after this long, stop
// starting new batches and re-enqueue the message to continue where the
// checkpoints left off. A batch call can realistically run 3-5 minutes
// (plus SDK backoff during capacity windows), so the budget must leave at
// least that much runway — a host-timeout abort skips the worker's catch
// entirely and burns a dequeue attempt with nothing recorded.
const CARDS_TIME_BUDGET_MS = 4.5 * 60 * 1000

export async function generatePlanStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = requireScopeId(msg)
  if (await pauseRequested(msg.jobId)) {
    await settlePaused(msg)
    return
  }
  const scope = await getScope(scopeId)
  const set = await getSet(scope.setId)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = STAGE_PLAN
    pushLog(r, `Planning ${scope.request.mode} scope against ${set.name}`)
  })

  // Checkpoint reuse keeps retries idempotent (a prior attempt may have failed
  // between the checkpoint write and the fan-out).
  let plan = await getJsonOrUndefined<PlanOutput>(dataContainer(), planPath(msg.jobId))
  if (!plan) {
    plan = await generateStructured<PlanOutput>({
      ...planPrompt(set, scope),
      schema: PLAN_SCHEMA,
    })
    if (!plan.units || plan.units.length === 0) {
      throw new Error('planning produced no units — the request resolved to an empty scope')
    }
    await putJson(dataContainer(), planPath(msg.jobId), plan)
  }
  const totalUnits = plan.units.length

  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = 1
    r.stage = STAGE_CARDS
    r.totalUnits = totalUnits
    r.unitsDone = r.unitsDone ?? 0
    pushLog(r, `Plan checkpointed: ${totalUnits} units, ${plan.units.reduce((n, u) => n + u.lessons.length, 0)} lesson skeletons`)
  })

  for (let i = 0; i < totalUnits; i++) {
    await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'cards', scopeId, unitIndex: i })
  }
  ctx.log(`generate/plan ${msg.jobId}: fanned out ${totalUnits} card units`)
}

export async function generateCardsStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = requireScopeId(msg)
  const unitIndex = msg.unitIndex
  if (unitIndex === undefined) throw new Error('cards message missing unitIndex')

  const plan = await getJsonOrUndefined<PlanOutput>(dataContainer(), planPath(msg.jobId))
  if (!plan) throw new Error(`plan checkpoint missing for job ${msg.jobId}`)
  const skeleton = plan.units[unitIndex]
  if (!skeleton) throw new Error(`plan has no unit at index ${unitIndex}`)
  // A degenerate plan (schema rules cannot express minItems) must fail loudly —
  // otherwise the empty batch loop would checkpoint a lesson-less unit into a
  // 'complete' scope.
  if (skeleton.lessons.length === 0) throw new Error(`plan unit ${skeleton.id} has no lessons`)

  if (await pauseRequested(msg.jobId)) {
    await settlePaused(msg)
    return
  }

  // Idempotent: reuse the unit checkpoint if a prior attempt already produced it.
  let unit = await getJsonOrUndefined<Unit>(dataContainer(), unitPath(msg.jobId, unitIndex))
  if (!unit) {
    const scope = await getScope(scopeId)
    const set = await getSet(scope.setId)
    const validItemIds = new Set(set.items.map((it) => it.id))
    const batches: PlanLessonSkeleton[][] = []
    for (let b = 0; b < skeleton.lessons.length; b += CARDS_LESSON_BATCH) {
      batches.push(skeleton.lessons.slice(b, b + CARDS_LESSON_BATCH))
    }
    const started = Date.now()
    const lessons: Lesson[] = []
    for (let b = 0; b < batches.length; b++) {
      // Per-batch checkpoint: a redelivered attempt resumes mid-unit.
      let batch = await getJsonOrUndefined<Lesson[]>(dataContainer(), unitBatchPath(msg.jobId, unitIndex, b))
      if (!batch) {
        if (b > 0 && (await pauseRequested(msg.jobId))) {
          await settlePaused(msg)
          return
        }
        if (b > 0 && Date.now() - started > CARDS_TIME_BUDGET_MS) {
          await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'cards', scopeId, unitIndex })
          ctx.log(`generate/cards ${msg.jobId}: unit ${unitIndex} paused at batch ${b}/${batches.length} (time budget) — re-enqueued`)
          return
        }
        const wire = await generateStructured<WireLessonBatch>({
          ...cardsPrompt(set, scope, plan, skeleton, batches[b]),
          schema: UNIT_CARDS_BATCH_SCHEMA,
          // effort 'medium' + 48k max_tokens fits the 10-minute Consumption
          // functionTimeout; each call carries at most CARDS_LESSON_BATCH
          // lessons so the output cannot reach the cap. The plan step keeps
          // effort 'high'.
          effort: 'medium',
          maxTokens: 48000,
        })
        if (!wire.lessons || wire.lessons.length === 0) {
          throw new Error(`card generation returned no lessons for unit ${skeleton.id} (batch ${b + 1}/${batches.length})`)
        }
        // Validate against the skeleton slice BEFORE checkpointing: the model
        // sees the full unit_skeleton alongside batch_lessons, so an
        // off-target reply (wrong ids, duplicates, extra lessons) is possible
        // — and a checkpointed bad batch would be reused by every retry
        // forever. A throw instead gets normal queue retries, which
        // regenerate the batch.
        const returnedIds = wire.lessons.map((l) => l.id)
        const wantedIds = batches[b].map((l) => l.id)
        const wantedSet = new Set(wantedIds)
        if (
          returnedIds.length !== wantedIds.length ||
          new Set(returnedIds).size !== returnedIds.length ||
          returnedIds.some((lid) => !wantedSet.has(lid))
        ) {
          throw new Error(
            `card generation for unit ${skeleton.id} (batch ${b + 1}/${batches.length}) returned lessons [${returnedIds.join(', ')}] — expected exactly [${wantedIds.join(', ')}]`,
          )
        }
        // Assemble in skeleton order regardless of reply order.
        const byId = new Map(wire.lessons.map((l) => [l.id, l]))
        batch = batches[b].map((sk) => {
          const w = byId.get(sk.id)
          if (!w) throw new Error(`lesson ${sk.id} missing from validated batch — unreachable`)
          return toLesson(w, validItemIds)
        })
        await putJson(dataContainer(), unitBatchPath(msg.jobId, unitIndex, b), batch)
      }
      lessons.push(...batch)
    }
    unit = { id: skeleton.id, title: skeleton.title, rationale: skeleton.rationale, strand: skeleton.strand, lessons }
    await putJson(dataContainer(), unitPath(msg.jobId, unitIndex), unit)
  }

  const { reachedTotal } = await completeUnit(
    msg.jobId,
    unitIndex,
    `Unit ${unit.id} — ${unit.title}: ${unit.lessons.length} cards checkpointed`,
  )
  if (reachedTotal) {
    await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'finalize', scopeId })
    ctx.log(`generate/cards ${msg.jobId}: unit ${unitIndex} completed the set — finalize enqueued`)
  }
}

export async function generateFinalizeStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = requireScopeId(msg)
  // completeUnit signals reachedTotal at-least-once, so duplicate finalize
  // messages are possible — no-op when the job already completed. The rest of
  // the step is idempotent anyway (rebuilds from checkpoints and overwrites).
  const job = await getJob(msg.jobId)
  if (job.status === 'complete') {
    ctx.log(`generate/finalize ${msg.jobId}: job already complete — duplicate finalize ignored`)
    return
  }
  if (await pauseRequested(msg.jobId)) {
    await settlePaused(msg)
    return
  }
  const plan = await getJsonOrUndefined<PlanOutput>(dataContainer(), planPath(msg.jobId))
  if (!plan) throw new Error(`plan checkpoint missing for job ${msg.jobId}`)

  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = 2
    r.stage = STAGE_FINALIZE
    pushLog(r, 'Assembling scope from checkpoints and running auto-QC')
  })

  const units: Unit[] = []
  for (let i = 0; i < plan.units.length; i++) {
    const unit = await getJsonOrUndefined<Unit>(dataContainer(), unitPath(msg.jobId, i))
    if (!unit) throw new Error(`unit checkpoint ${i} missing for job ${msg.jobId}`)
    units.push(unit)
  }

  const scope = await getScope(scopeId)
  const qc = runQc(units, plan)
  const lessons = countLessons(units)

  scope.units = units
  scope.qc = qc
  scope.status = 'complete'
  delete scope.error
  scope.version = 1
  scope.updated = today()
  scope.protectedBoundaries = deriveProtectedBoundaries(units)
  // History entry mirrors src/store.tsx finishGeneration (engine v2.3,
  // DI BrainLift v1.8, per the seed conventions).
  scope.history = [
    {
      version: 1,
      date: today(),
      actor: scope.creator,
      event: 'Generated',
      detail: `${
        scope.request.mode === 'course'
          ? 'Full-course'
          : scope.request.mode === 'standard'
            ? 'Single-standard'
            : 'Topic'
      } generation. Engine v2.3, DI BrainLift v1.8. ${lessons} lessons, ${units.length} unit${units.length === 1 ? '' : 's'}.`,
    },
  ]

  await snapshotScope(scope)
  // Plain save (not mutateScope): during generation the UI offers no mutations, so no concurrent writers exist.
  await saveScope(scope)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = GENERATE_TOTAL_STAGES
    r.stage = 'Complete'
    pushLog(r, `Scope complete: ${units.length} units, ${lessons} lessons, QC ${qc.filter((c) => c.status === 'pass').length}/${qc.length} pass`)
  })
  ctx.log(`generate/finalize ${msg.jobId}: scope ${scopeId} complete`)
}

/** Cooperative pause: the pause endpoint sets cancelRequested; steps check at checkpoints. */
async function pauseRequested(jobId: string): Promise<boolean> {
  const rec = await getJob(jobId)
  return rec.cancelRequested === true
}

/**
 * Settle a paused generation: job 'cancelled' (stage 'Generation — Paused'),
 * scope status 'paused'. Multiple in-flight cards messages can all hit a pause
 * checkpoint — the mutateJob guard makes the settle write once, and the whole
 * thing is idempotent. All checkpoints stay in place; resume re-enqueues the
 * plan step under the SAME job id and skips straight past finished work.
 */
async function settlePaused(msg: JobMessage): Promise<void> {
  await mutateJob(msg.jobId, (r) => {
    if (r.status === 'cancelled') return
    r.status = 'cancelled'
    r.stage = 'Generation — Paused'
    pushLog(r, 'Paused by user — progress is checkpointed; resume continues where this left off')
  })
  if (msg.scopeId) {
    await mutateScope(msg.scopeId, (sc) => {
      if (sc.status === 'generating') {
        sc.status = 'paused'
        sc.updated = today()
      }
    })
  }
}

function requireScopeId(msg: JobMessage): string {
  if (!msg.scopeId) throw new Error(`${msg.kind}/${msg.step} message missing scopeId`)
  return msg.scopeId
}
