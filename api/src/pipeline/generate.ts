import { InvocationContext } from '@azure/functions'
import { JobMessage, Unit } from '../domain/types'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { getScope, getSet, saveScope, snapshotScope } from '../data/entities'
import { completeUnit, getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { cardsPrompt, planPrompt } from '../services/prompts'
import {
  PLAN_SCHEMA,
  PlanOutput,
  toUnit,
  UNIT_CARDS_SCHEMA,
  WireUnitCards,
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

export async function generatePlanStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = requireScopeId(msg)
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

  // Idempotent: reuse the unit checkpoint if a prior attempt already produced it.
  let unit = await getJsonOrUndefined<Unit>(dataContainer(), unitPath(msg.jobId, unitIndex))
  if (!unit) {
    const scope = await getScope(scopeId)
    const set = await getSet(scope.setId)
    const wire = await generateStructured<WireUnitCards>({
      ...cardsPrompt(set, scope, plan, skeleton),
      schema: UNIT_CARDS_SCHEMA,
      // effort 'medium' + 48k max_tokens fits the 10-minute Consumption
      // functionTimeout (effort 'high' at 64k could exceed it and queue retries
      // would repeat the identical call); quality remains high on claude-fable-5.
      // The plan step keeps effort 'high'.
      effort: 'medium',
      maxTokens: 48000,
    })
    if (!wire.lessons || wire.lessons.length === 0) {
      throw new Error(`card generation returned no lessons for unit ${skeleton.id}`)
    }
    unit = toUnit(wire, new Set(set.items.map((it) => it.id)))
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

function requireScopeId(msg: JobMessage): string {
  if (!msg.scopeId) throw new Error(`${msg.kind}/${msg.step} message missing scopeId`)
  return msg.scopeId
}
