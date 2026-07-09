import { InvocationContext } from '@azure/functions'
import { JobMessage, Lesson, Unit } from '../domain/types'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { getScope, getScopeEvidenceSet, getScopeSourceSets, mutateScope, saveScope, snapshotScope } from '../data/entities'
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
import { ensureSetItemsExtracted } from './items'
import { loadScopeUploadDocs } from './scope-uploads'
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
// full lesson cards overflowed the 48k output budget in production (the
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

// Hard abort for the in-flight Claude call: a plan or cards call can legally
// stretch (SDK backoff during capacity windows, parse retries) past the
// 10-minute host cap, and a host kill skips the worker's catch ENTIRELY — the
// message just redelivers and repeats the identical oversized call until it
// lands in the poison queue with nothing settled (prod, 2026-07: a
// cross-framework full-course plan died exactly this way). Aborting at 8.5
// minutes keeps the failure in-process, where the step can escalate.
const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000

// Deadline-cut escalation (mirrors the packet hunts): `cuts` rides the queue
// message payload and counts how many executions were aborted mid-call on
// this step. Each cut re-runs the call at lower effort; when the ladder is
// exhausted the step fails with a terminal error (worker.ts TERMINAL_ERROR
// matches the phrase) instead of burning the full dequeue budget on a call
// that provably cannot fit.
const PLAN_EFFORT_LADDER = ['high', 'medium', 'low'] as const
const MAX_CARD_CUTS = 3

const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))

function readCuts(msg: JobMessage): number {
  const raw = (msg.payload ?? {}) as { cuts?: unknown }
  const n = Math.trunc(Number(raw.cuts ?? 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Bound a Claude call to the execution deadline; the caller escalates on abort. */
function bounded(started: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

export async function generatePlanStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = requireScopeId(msg)
  const started = Date.now()
  if (await pauseRequested(msg.jobId)) {
    await settlePaused(msg)
    return
  }
  const scope = await getScope(scopeId)
  // Released items extract lazily, once per set, ahead of the first plan that
  // needs them — classified records + cropped screenshots land on the set for
  // this and every later scope. False = partial work done and re-enqueued.
  if (!(await ensureSetItemsExtracted(scope, msg, ctx))) return
  const set = await getScopeEvidenceSet(scope)
  const sourceSets = await getScopeSourceSets(scope) // [] unless multi-set (cross-framework union)
  const userDocs = await loadScopeUploadDocs(scope, ctx) // user-attached released-question PDFs (topic requests)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = STAGE_PLAN
    pushLog(r, `Planning ${scope.request.mode} scope against ${set.name}`)
  })

  // Checkpoint reuse keeps retries idempotent (a prior attempt may have failed
  // between the checkpoint write and the fan-out).
  let plan = await getJsonOrUndefined<PlanOutput>(dataContainer(), planPath(msg.jobId))
  if (!plan) {
    // Deadline-cut effort ladder: each aborted execution retries one level
    // lower (a lower-effort plan of the same request is far better than a
    // generation that dies). The ladder's end fails terminally.
    const cuts = readCuts(msg)
    const effort = PLAN_EFFORT_LADDER[Math.min(cuts, PLAN_EFFORT_LADDER.length - 1)]
    const { signal, dispose } = bounded(started)
    try {
      plan = await generateStructured<PlanOutput>({
        ...planPrompt(set, scope, sourceSets, userDocs.names),
        schema: PLAN_SCHEMA,
        effort,
        signal,
        ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
      })
    } catch (e) {
      if (!isAbort(e)) throw e
      if (cuts + 1 >= PLAN_EFFORT_LADDER.length) {
        throw new Error(
          `Planning did not fit the 10-minute execution window after ${PLAN_EFFORT_LADDER.length} attempts (effort ${PLAN_EFFORT_LADDER.join(' → ')}). The request is too large for one planning call — narrow it (fewer standards, a single framework, or a smaller grade span) and retry.`,
        )
      }
      // Log BEFORE enqueueing: if either write fails, the error rethrows and
      // the host redelivers THIS message — enqueue-first could strand a
      // continuation alongside the redelivery.
      await mutateJob(msg.jobId, (r) =>
        pushLog(
          r,
          `Planning ran long and was cut at the execution deadline — retrying at ${PLAN_EFFORT_LADDER[cuts + 1]} effort in a fresh execution`,
        ),
      )
      await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'plan', scopeId, payload: { cuts: cuts + 1 } })
      ctx.log(`generate/plan ${msg.jobId}: call cut at the execution deadline (cut ${cuts + 1}) — re-enqueued`)
      return
    } finally {
      dispose()
    }
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
    const set = await getScopeEvidenceSet(scope)
    const sourceSets = await getScopeSourceSets(scope)
    const userDocs = await loadScopeUploadDocs(scope, ctx)
    const validItemIds = new Set(set.items.map((it) => it.id))
    const batches: PlanLessonSkeleton[][] = []
    for (let b = 0; b < skeleton.lessons.length; b += CARDS_LESSON_BATCH) {
      batches.push(skeleton.lessons.slice(b, b + CARDS_LESSON_BATCH))
    }
    const started = Date.now()
    const cuts = readCuts(msg)
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
        const { signal, dispose } = bounded(started)
        let wire: WireLessonBatch
        try {
          wire = await generateStructured<WireLessonBatch>({
            ...cardsPrompt(set, scope, plan, skeleton, batches[b], sourceSets, userDocs.names),
            schema: UNIT_CARDS_BATCH_SCHEMA,
            ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
            // effort 'medium' + 48k max_tokens fits the 10-minute Consumption
            // functionTimeout; each call carries at most CARDS_LESSON_BATCH
            // lessons so the output cannot reach the cap. The plan step keeps
            // effort 'high'. After a deadline cut the batch re-runs at 'low'.
            effort: cuts > 0 ? 'low' : 'medium',
            maxTokens: 48000,
            signal,
          })
        } catch (e) {
          if (!isAbort(e)) throw e
          // The in-flight batch call was cut at the execution deadline —
          // finished batches are checkpointed, so a fresh execution resumes
          // exactly here. Escalate through `cuts` so a batch that can NEVER
          // fit fails terminally instead of looping forever.
          if (cuts + 1 >= MAX_CARD_CUTS) {
            throw new Error(
              `Card generation for unit ${skeleton.id} (batch ${b + 1}/${batches.length}) did not fit the 10-minute execution window after ${MAX_CARD_CUTS} attempts, even at low effort — narrow the request and retry.`,
            )
          }
          await mutateJob(msg.jobId, (r) =>
            pushLog(
              r,
              `Unit ${skeleton.id}: card batch ${b + 1}/${batches.length} ran long and was cut at the execution deadline — retrying at low effort in a fresh execution`,
            ),
          )
          await enqueueJob({
            jobId: msg.jobId,
            kind: 'generate',
            step: 'cards',
            scopeId,
            unitIndex,
            payload: { cuts: cuts + 1 },
          })
          ctx.log(`generate/cards ${msg.jobId}: unit ${unitIndex} batch ${b} cut at the execution deadline (cut ${cuts + 1}) — re-enqueued`)
          return
        } finally {
          dispose()
        }
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
          // The plan skeleton is the authority on which items attach here —
          // restore any ref the cards call lost or mangled.
          return toLesson(w, validItemIds, sk.itemRefs)
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
  const evidenceSet = await getScopeEvidenceSet(scope)
  const qc = runQc(units, plan, evidenceSet.items)
  const lessons = countLessons(units)

  scope.units = units
  scope.qc = qc
  scope.status = 'complete'
  delete scope.error
  scope.version = 1
  scope.updated = today()
  scope.protectedBoundaries = deriveProtectedBoundaries(units)
  // Version labels derive from what THIS scope recorded at creation — a
  // generation in flight across a deploy must not stamp its history with the
  // new build's constants while the document says otherwise.
  const versionLabels = [scope.engineVersion, ...scope.doctrineVersions].map((v) => v.split(' (')[0]).join(', ')
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
      } generation. ${versionLabels}. ${lessons} lessons, ${units.length} unit${units.length === 1 ? '' : 's'}.`,
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
