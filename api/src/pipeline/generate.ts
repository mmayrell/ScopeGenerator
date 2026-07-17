import { InvocationContext } from '@azure/functions'
import { ItemRecord, JobMessage, Lesson, StandardNode, StandardSet, Unit } from '../domain/types'
import { getJsonOrUndefined, putJson, putJsonIfAbsent } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { getScope, getScopeEvidenceSet, getScopeSourceSets, mutateScope, saveScope, snapshotScope } from '../data/entities'
import { completeUnit, createJob, getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { cardsPrompt, courseMapPrompt, unitPlanPrompt } from '../services/prompts'
import { dedupeStudentTitles } from './titles'
import {
  COURSE_MAP_SCHEMA,
  CourseMap,
  DeferredItem,
  PlanLessonSkeleton,
  PlanOutput,
  PlanUnit,
  toLesson,
  UNIT_CARDS_BATCH_SCHEMA,
  UNIT_PLAN_SCHEMA,
  UnitPlanOutput,
  WireLessonBatch,
} from '../services/schemas'
import { newId, today } from '../shared/util'
import { ensureSetItemsExtracted } from './items'
import { loadScopeUploadDocs } from './scope-uploads'
import { countLessons, deriveProtectedBoundaries, runQc } from './qc'
import { buildCoherenceWebs, coherenceQcCheck } from './webs'

// Generation pipeline (contract §Generation pipeline), checkpointed for the
// 10-minute consumption timeout:
//   plan     (Stages 2–4, checkpointed multi-call)
//            pass 1: the course map (scope resolution + unit architecture,
//                    one small call)        → jobs/<jobId>/plan-map.json
//            pass 2: per-unit atomization/ledger/placement (one call PER
//                    unit, sequential — each with its own full output
//                    budget)                → jobs/<jobId>/plan-unit-<i>.json
//            pass 3: programmatic assembly  → jobs/<jobId>/plan.json
//            A single whole-course plan call had to compress every unit into
//            one output window under the execution deadline — the direct
//            cause of under-atomized courses (~60 lessons where the engine
//            document's depth calibration demands 100+).
//   cards    (Stage 5, parallel per unit)   → jobs/<jobId>/unit-<i>-lesson-<id>.json per lesson,
//                                             then the assembled jobs/<jobId>/unit-<i>.json
//   finalize (Stage 6, programmatic QC)     → the assembled Scope, v1 snapshot

// Singular 'Stage' — the frontend parses the label with /stage\s*(\d+)/i.
const STAGE_PLAN = 'Stage 2–4 — Scope resolution, atomization & sequencing'
const STAGE_CARDS = 'Stage 5 — Card generation'
const STAGE_FINALIZE = 'Stage 6 — Assembly & auto-QC'
export const GENERATE_TOTAL_STAGES = 3

const planPath = (jobId: string) => `jobs/${jobId}/plan.json`
const planMapPath = (jobId: string) => `jobs/${jobId}/plan-map.json`
const planUnitPath = (jobId: string, i: number) => `jobs/${jobId}/plan-unit-${i}.json`
const unitPath = (jobId: string, i: number) => `jobs/${jobId}/unit-${i}.json`
// Legacy fixed-size batch checkpoint (pre per-lesson checkpoints) — still READ
// so runs that failed under the old batching resume without regenerating.
const unitBatchPath = (jobId: string, i: number, b: number) => `jobs/${jobId}/unit-${i}-batch-${b}.json`
const unitLessonPath = (jobId: string, i: number, lessonId: string) =>
  `jobs/${jobId}/unit-${i}-lesson-${lessonId}.json`

// Cards generate at most this many lessons per Claude call: a 10-lesson unit's
// full lesson cards overflowed the 48k output budget in production (the
// truncation error is terminal, so every queue retry repeated the identical
// oversized call). Batches also keep each call well inside the 10-minute
// Consumption timeout.
const CARDS_LESSON_BATCH = 4
// Even 4-lesson calls can overflow on dense lessons (prod, 2026-07: a CCSS
// grade-6 full course failed repeatedly on the same slice). The call size is
// ADAPTIVE: on truncation it halves (persisted on the re-enqueued message as
// payload.callSize) down to a single lesson, so no fixed slice can ever loop
// a generation to death. Reasoning tokens share the max_tokens budget, so a
// single lesson that still overflows gets one rescue retry at low effort with
// the full default output cap before failing terminally.
const CARDS_MAX_TOKENS = 48000
const CARDS_RESCUE_MAX_TOKENS = 64000
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
// Planning calls (course map + one per unit) run sequentially inside one
// execution until this budget, then re-enqueue — same pattern as cards.
const PLAN_TIME_BUDGET_MS = 4.5 * 60 * 1000
// A planning call aborted at the execution deadline after launching this far
// into the window was cut by SCHEDULING, not by its own size — it re-runs at
// the same effort in a fresh execution instead of burning a ladder rung.
const LATE_START_GRACE_MS = 60 * 1000

const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))

const isTruncation = (e: unknown): boolean =>
  /max_tokens reached/i.test(e instanceof Error ? e.message : String(e))

function readCuts(msg: JobMessage): number {
  const raw = (msg.payload ?? {}) as { cuts?: unknown }
  const n = Math.trunc(Number(raw.cuts ?? 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Learned lessons-per-call for the cards step (shrunk on truncation), riding the queue message. */
function readCallSize(msg: JobMessage): number {
  const raw = (msg.payload ?? {}) as { callSize?: unknown }
  const n = Math.trunc(Number(raw.callSize ?? CARDS_LESSON_BATCH))
  return Number.isFinite(n) && n >= 1 && n <= CARDS_LESSON_BATCH ? n : CARDS_LESSON_BATCH
}

/**
 * Plan-step cut state: `cutUnit` scopes the effort-ladder escalation to the
 * one planning call that was cut (-1 = the course-map call, i = unit i).
 * Legacy messages carrying only `cuts` (pre-split planning) map to the course
 * map, which is where a legacy single-call plan job resumes anyway.
 */
function readPlanCuts(msg: JobMessage): { cuts: number; cutUnit: number } {
  const raw = (msg.payload ?? {}) as { cuts?: unknown; cutUnit?: unknown }
  const cuts = Math.trunc(Number(raw.cuts ?? 0))
  const cutUnit = Math.trunc(Number(raw.cutUnit ?? -1))
  return {
    cuts: Number.isFinite(cuts) && cuts > 0 ? cuts : 0,
    cutUnit: Number.isFinite(cutUnit) && cutUnit >= -1 ? cutUnit : -1,
  }
}

/**
 * Unit ownership of the standards tree: a node is owned by the unit whose
 * standardCodes carry its code/norm, ownership inherits down the subtree
 * (sub-part-aligned items belong to the unit that owns the parent), and an
 * un-owned ANCESTOR node (cluster/KS-level) resolves to the LATEST owning
 * unit among its descendants — the first point in the course where all of a
 * coarse-grain item's prerequisite instruction can exist (the same rule
 * ingestion applies to multi-standard items). Also reports content-standard
 * leaves (wording, no children) no unit covers — silently untaught scope.
 */
function unitOwnershipOf(
  set: StandardSet,
  map: CourseMap,
): { nodeOwner: Map<string, number>; uncoveredLeaves: string[] } {
  const codeOwner = new Map<string, number>()
  map.units.forEach((u, i) => {
    for (const c of u.standardCodes) codeOwner.set(c.toUpperCase(), i)
  })
  const nodeOwner = new Map<string, number>()
  const uncoveredLeaves: string[] = []
  const walk = (node: StandardNode, inherited: number | undefined): Set<number> => {
    const own = codeOwner.get(node.code.toUpperCase()) ?? codeOwner.get(node.norm.toUpperCase()) ?? inherited
    const owners = new Set<number>()
    if (own !== undefined) owners.add(own)
    const children = node.children ?? []
    for (const child of children) for (const o of walk(child, own)) owners.add(o)
    if (own !== undefined) {
      nodeOwner.set(node.code.toUpperCase(), own)
      nodeOwner.set(node.norm.toUpperCase(), own)
    } else if (owners.size > 0) {
      const latest = Math.max(...owners)
      nodeOwner.set(node.code.toUpperCase(), latest)
      nodeOwner.set(node.norm.toUpperCase(), latest)
    } else if (children.length === 0 && (node.wording ?? '').trim().length > 0) {
      uncoveredLeaves.push(node.code)
    }
    return owners
  }
  for (const root of set.tree) walk(root, undefined)
  return { nodeOwner, uncoveredLeaves }
}

/** Deterministic item partition: each item lands in exactly ONE unit's bucket (or none, when out of scope). */
function partitionItemsByUnit(set: StandardSet, map: CourseMap): ItemRecord[][] {
  const { nodeOwner } = unitOwnershipOf(set, map)
  const buckets: ItemRecord[][] = map.units.map(() => [])
  for (const item of set.items) {
    const owner = nodeOwner.get(item.alignmentCode.toUpperCase())
    if (owner !== undefined) buckets[owner].push(item)
  }
  return buckets
}

/**
 * Items deferred out of earlier units and not yet absorbed — the pending list
 * the next unit's call tries to place (guide §16.3, the Deferral Rule run
 * across unit boundaries).
 */
function pendingDeferralsOf(
  map: CourseMap,
  unitPlans: UnitPlanOutput[],
): (DeferredItem & { fromUnit: string })[] {
  const absorbed = new Set<string>()
  for (const up of unitPlans) {
    for (const l of up.lessons) for (const r of l.itemRefs) absorbed.add(r)
    for (const pd of up.placedDeferrals) absorbed.add(pd.itemRef)
  }
  const out: (DeferredItem & { fromUnit: string })[] = []
  const seen = new Set<string>()
  unitPlans.forEach((up, j) => {
    for (const d of up.deferredOut) {
      if (absorbed.has(d.itemRef) || seen.has(d.itemRef)) continue
      seen.add(d.itemRef)
      out.push({ ...d, fromUnit: map.units[j]?.id ?? 'U?' })
    }
  })
  return out
}

/**
 * Pass 3 — programmatic assembly of the final PlanOutput: unit metadata from
 * the map, lessons/prereqs from the unit plans, placedDeferrals merged into
 * their target lessons' itemRefs, itemRefs filtered to real item ids, and
 * every never-absorbed deferral logged as an end-of-course exclusion
 * (guide §16.2 — cumulative items never distort the atomization).
 */
function assemblePlan(map: CourseMap, unitPlans: UnitPlanOutput[], validItemIds: Set<string>): PlanOutput {
  const units: PlanUnit[] = map.units.map((mu, i) => {
    const up = unitPlans[i]
    return {
      id: mu.id,
      title: mu.title,
      rationale: mu.rationale,
      strand: mu.strand,
      topic: mu.topic,
      priorGradeTopics: mu.priorGradeTopics,
      nextGradeTopics: mu.nextGradeTopics,
      prereqs: up.prereqs,
      lessons: up.lessons.map((l) => ({ ...l, itemRefs: l.itemRefs.filter((r) => validItemIds.has(r)) })),
    }
  })
  const lessonById = new Map(units.flatMap((u) => u.lessons.map((l) => [l.id, l] as const)))
  const decisions: string[] = [...map.scopeDecisions]
  for (const up of unitPlans) {
    decisions.push(...up.scopeDecisions)
    for (const pd of up.placedDeferrals) {
      const lesson = lessonById.get(pd.lessonId)
      if (!lesson || !validItemIds.has(pd.itemRef)) continue
      if (!lesson.itemRefs.includes(pd.itemRef)) lesson.itemRefs.push(pd.itemRef)
      decisions.push(`Deferral placed (engine Deferral Rule): item ${pd.itemRef} → ${pd.lessonId} — ${pd.justification}`)
    }
  }
  // Backstop: one item, one lesson, course-wide (first placement in course
  // order wins). Per-unit sanitation makes cross-unit duplicates structurally
  // impossible for fresh plans, but assembly is the last gate before cards.
  const seenRefs = new Set<string>()
  for (const u of units) {
    for (const l of u.lessons) {
      l.itemRefs = l.itemRefs.filter((r) => {
        if (seenRefs.has(r)) return false
        seenRefs.add(r)
        return true
      })
    }
  }
  const placedAll = new Set(units.flatMap((u) => u.lessons.flatMap((l) => l.itemRefs)))
  const noted = new Set<string>()
  unitPlans.forEach((up, i) => {
    for (const d of up.deferredOut) {
      if (placedAll.has(d.itemRef) || noted.has(d.itemRef) || !validItemIds.has(d.itemRef)) continue
      noted.add(d.itemRef)
      decisions.push(
        `End-of-course exclusion (engine Placement Doctrine §16.2): item ${d.itemRef}, deferred out of ${map.units[i]?.id ?? 'U?'} on untaught demands (${d.missingDemands.join('; ') || 'unstated'}), was never absorbable by a later lesson — treated as end-of-course/cumulative assessment, not lesson-aligned.`,
      )
    }
  })
  return { units, scopeDecisions: decisions }
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

  // Checkpoint reuse keeps retries idempotent (a prior attempt may have failed
  // between the checkpoint write and the fan-out).
  let plan = await getJsonOrUndefined<PlanOutput>(dataContainer(), planPath(msg.jobId))
  if (!plan) {
    // Deadline-cut effort ladder, per CALL: `cutUnit` (-1 = the course-map
    // call, i = unit i's call) scopes `cuts` to the one call that was cut, so
    // an escalation never lowers the effort of the calls that fit fine.
    const { cuts, cutUnit } = readPlanCuts(msg)
    let calls = 0

    /**
     * Shared escalation for a planning call that overflowed or was cut:
     * truncation and deadline cuts both retry one effort level lower
     * (reasoning tokens share the max_tokens budget, so a lower-effort re-run
     * of the identical request leaves far more room for the plan itself — a
     * plain retry would repeat the identical overflowing call forever). The
     * ladder's end fails terminally. Log BEFORE enqueueing: if either write
     * fails, the error rethrows and the host redelivers THIS message —
     * enqueue-first could strand a continuation alongside the redelivery.
     */
    const escalatePlanCall = async (e: unknown, label: string, callCuts: number, unitIdx: number): Promise<boolean> => {
      const truncated = isTruncation(e)
      if (!truncated && !isAbort(e)) return false
      if (callCuts + 1 >= PLAN_EFFORT_LADDER.length) {
        throw new Error(
          `Planning (${label}) ${
            truncated ? "exceeded the model's output budget" : 'did not fit the 10-minute execution window'
          } after ${PLAN_EFFORT_LADDER.length} attempts (effort ${PLAN_EFFORT_LADDER.join(' → ')}) — narrow the request (fewer standards or a smaller grade span) and retry.`,
        )
      }
      await mutateJob(msg.jobId, (r) =>
        pushLog(
          r,
          `Planning (${label}) ${
            truncated ? 'overflowed the output budget' : 'ran long and was cut at the execution deadline'
          } — retrying at ${PLAN_EFFORT_LADDER[callCuts + 1]} effort in a fresh execution`,
        ),
      )
      await enqueueJob({
        jobId: msg.jobId,
        kind: 'generate',
        step: 'plan',
        scopeId,
        payload: { cuts: callCuts + 1, cutUnit: unitIdx },
      })
      ctx.log(`generate/plan ${msg.jobId}: ${label} ${truncated ? 'overflowed' : 'cut'} (cut ${callCuts + 1}) — re-enqueued`)
      return true
    }

    // ---- Pass 1: the course map (scope resolution + unit architecture) ----
    let map = await getJsonOrUndefined<CourseMap>(dataContainer(), planMapPath(msg.jobId))
    await mutateJob(msg.jobId, (r) => {
      r.status = 'running'
      r.stage = STAGE_PLAN
      if (!map) pushLog(r, `Planning ${scope.request.mode} scope against ${set.name} — building the course map`)
    })
    if (!map) {
      const mapCuts = cutUnit === -1 ? cuts : 0
      const { signal, dispose } = bounded(started)
      try {
        map = await generateStructured<CourseMap>({
          ...courseMapPrompt(set, scope, sourceSets, userDocs.names),
          schema: COURSE_MAP_SCHEMA,
          effort: PLAN_EFFORT_LADDER[Math.min(mapCuts, PLAN_EFFORT_LADDER.length - 1)],
          signal,
          ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
        })
      } catch (e) {
        if (await escalatePlanCall(e, 'course map', mapCuts, -1)) return
        throw e
      } finally {
        dispose()
      }
      calls++
      if (!map.units || map.units.length === 0) {
        throw new Error('planning produced no units — the request resolved to an empty scope')
      }
      // A malformed map poisons every downstream unit call — fail loudly so
      // normal queue retries regenerate it instead of checkpointing it.
      const unitIds = map.units.map((u) => u.id)
      if (new Set(unitIds).size !== unitIds.length) {
        throw new Error(`course map has duplicate unit ids: ${unitIds.join(', ')}`)
      }
      const emptyUnits = map.units.filter((u) => u.standardCodes.length === 0).map((u) => u.id)
      if (emptyUnits.length > 0) {
        throw new Error(`course map units carry no standards: ${emptyUnits.join(', ')}`)
      }
      // Exclusivity: a standard assigned to two units would feed its items to
      // two independent unit calls, each COMMANDED to place them — the same
      // released item would land on two lessons with nothing downstream able
      // to tell which placement is right.
      const codeOwner = new Map<string, string>()
      const overlaps: string[] = []
      for (const u of map.units) {
        for (const c of u.standardCodes) {
          const k = c.toUpperCase()
          const prior = codeOwner.get(k)
          if (prior && prior !== u.id) overlaps.push(`${c} (${prior} + ${u.id})`)
          codeOwner.set(k, u.id)
        }
      }
      if (overlaps.length > 0) {
        throw new Error(
          `course map assigns the same standard to multiple units: ${overlaps.slice(0, 8).join('; ')}${overlaps.length > 8 ? '; …' : ''}`,
        )
      }
      // Whole-course coverage: a standard the map drops from every unit is a
      // standard NO unit call will ever see — silently untaught. Coverage is
      // the completion test (map prompt), so enforce it where the full scope
      // is known (course mode = every content standard of the set).
      if (scope.request.mode === 'course') {
        const { uncoveredLeaves } = unitOwnershipOf(set, map)
        if (uncoveredLeaves.length > 0) {
          throw new Error(
            `course map assigns no unit to ${uncoveredLeaves.length} content standard${uncoveredLeaves.length === 1 ? '' : 's'}: ${uncoveredLeaves
              .slice(0, 10)
              .join(', ')}${uncoveredLeaves.length > 10 ? ', …' : ''}`,
          )
        }
      }
      // Create-only write: two overlapping deliveries can both reach here with
      // DIFFERENT maps (the call is non-deterministic); an overwrite would mix
      // unit checkpoints from two architectures. First writer wins — the loser
      // adopts the persisted map so everything it writes agrees with it.
      if (!(await putJsonIfAbsent(dataContainer(), planMapPath(msg.jobId), map))) {
        const winner = await getJsonOrUndefined<CourseMap>(dataContainer(), planMapPath(msg.jobId))
        if (!winner) throw new Error('course map checkpoint vanished after a write conflict — retrying')
        map = winner
      }
      const standardCount = new Set(map.units.flatMap((u) => u.standardCodes.map((c) => c.toUpperCase()))).size
      const mapUnitCount = map.units.length
      await mutateJob(msg.jobId, (r) =>
        pushLog(r, `Course map: ${mapUnitCount} units covering ${standardCount} standards — atomizing each unit in its own call`),
      )
    }

    // ---- Pass 2: per-unit atomization, ledger, item placement (sequential —
    // each unit's call reads the cumulative ledger of everything before it) ----
    // Items are partitioned across units IN CODE (not per-call itemsForCodes):
    // deterministic, exactly one unit sees each in-scope item — per-unit code
    // matching both dropped coarse-grain-aligned items (cluster/KS-level
    // official alignments match no most-granular unit code) and double-fed
    // items when codes overlapped.
    const itemBuckets = partitionItemsByUnit(set, map)
    const unitPlans: UnitPlanOutput[] = []
    for (let i = 0; i < map.units.length; i++) {
      const mu = map.units[i]
      let up = await getJsonOrUndefined<UnitPlanOutput>(dataContainer(), planUnitPath(msg.jobId, i))
      // A checkpoint written against a DIFFERENT course map (a pre-guard
      // concurrent delivery, or index drift) is discarded, not trusted — the
      // fresh-call validation below never ran against THIS map.
      if (up && !(up.lessons.length > 0 && up.lessons.every((l) => l.id.startsWith(`${mu.id}.`)))) {
        ctx.warn(`generate/plan ${msg.jobId}: unit checkpoint ${i} does not match map unit ${mu.id} — regenerating`)
        up = undefined
      }
      if (!up) {
        if (calls > 0 && (await pauseRequested(msg.jobId))) {
          await settlePaused(msg)
          return
        }
        if (calls > 0 && Date.now() - started > PLAN_TIME_BUDGET_MS) {
          await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'plan', scopeId })
          ctx.log(
            `generate/plan ${msg.jobId}: paused before unit ${i + 1}/${map.units.length} (time budget) — re-enqueued`,
          )
          return
        }
        const unitCuts = cutUnit === i ? cuts : 0
        const priorUnits = map.units.slice(0, i).map((muPrior, j) => ({ id: muPrior.id, lessons: unitPlans[j].lessons }))
        const pending = pendingDeferralsOf(map, unitPlans)
        const pendingRefs = new Set(pending.map((d) => d.itemRef))
        const unitItems = [
          ...itemBuckets[i],
          ...set.items.filter((it) => pendingRefs.has(it.id) && !itemBuckets[i].some((b) => b.id === it.id)),
        ]
        const allowedRefs = new Set(unitItems.map((it) => it.id))
        const callStarted = Date.now()
        const { signal, dispose } = bounded(started)
        try {
          up = await generateStructured<UnitPlanOutput>({
            ...unitPlanPrompt(set, scope, map, i, priorUnits, pending, unitItems, sourceSets, userDocs.names),
            schema: UNIT_PLAN_SCHEMA,
            effort: PLAN_EFFORT_LADDER[Math.min(unitCuts, PLAN_EFFORT_LADDER.length - 1)],
            signal,
            ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
          })
        } catch (e) {
          // A call cut after launching LATE in the window (earlier calls ate
          // the runway) says nothing about whether it fits — continue in a
          // fresh execution at the SAME effort, where it runs first and gets
          // the full window. Only an early-started cut burns a ladder rung.
          if (isAbort(e) && callStarted - started > LATE_START_GRACE_MS) {
            await mutateJob(msg.jobId, (r) =>
              pushLog(
                r,
                `Unit ${mu.id}: planning call started late in the execution window and was cut — continuing in a fresh execution at the same effort`,
              ),
            )
            await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'plan', scopeId })
            ctx.log(`generate/plan ${msg.jobId}: unit ${mu.id} cut after a late start — re-enqueued without escalation`)
            return
          }
          if (await escalatePlanCall(e, `unit ${mu.id}`, unitCuts, i)) return
          throw e
        } finally {
          dispose()
        }
        calls++
        // Off-target output must fail loudly BEFORE checkpointing — a
        // checkpointed bad unit would be reused by every retry forever; a
        // throw gets normal queue retries (each attempt's error now lands on
        // the job log via the worker).
        if (!up.lessons || up.lessons.length === 0) {
          throw new Error(`unit planning for ${mu.id} produced no lessons`)
        }
        const ids = up.lessons.map((l) => l.id)
        const foreign = ids.filter((id) => !id.startsWith(`${mu.id}.`))
        if (foreign.length > 0 || new Set(ids).size !== ids.length) {
          throw new Error(
            `unit planning for ${mu.id} returned malformed lesson ids [${ids.join(', ')}] — expected unique ids prefixed "${mu.id}."`,
          )
        }
        // Deferral outputs are load-bearing across units (pendingDeferralsOf
        // treats a placedDeferral as absorption; assembly trusts lessonId) —
        // a hallucinated id here would silently convert a placeable item into
        // a false end-of-course exclusion. Same fail-loudly bar as lesson ids.
        const idSet = new Set(ids)
        const seenPd = new Set<string>()
        const badPlaced = up.placedDeferrals.filter((pd) => {
          const dup = seenPd.has(pd.itemRef)
          seenPd.add(pd.itemRef)
          return dup || !idSet.has(pd.lessonId) || !pendingRefs.has(pd.itemRef)
        })
        const badOut = up.deferredOut.filter((d) => !allowedRefs.has(d.itemRef))
        if (badPlaced.length > 0 || badOut.length > 0) {
          throw new Error(
            `unit planning for ${mu.id} returned invalid deferral refs: ${[
              ...badPlaced.map((pd) => `placed ${pd.itemRef} → ${pd.lessonId}`),
              ...badOut.map((d) => `deferred-out ${d.itemRef}`),
            ]
              .slice(0, 8)
              .join('; ')} — placements must target this unit's lessons with pending item ids; deferrals must name supplied item ids`,
          )
        }
        // Repairable model slips are sanitized (not thrown): itemRefs outside
        // this unit's supplied items (cross-unit duplicates by construction),
        // duplicate refs, and deferredOut entries contradicting an in-unit
        // placement of the same item.
        const seenRef = new Set<string>()
        for (const l of up.lessons) {
          const kept = l.itemRefs.filter((r) => allowedRefs.has(r) && !seenRef.has(r))
          if (kept.length !== l.itemRefs.length) {
            ctx.warn(
              `generate/plan ${msg.jobId}: unit ${mu.id} lesson ${l.id} dropped ${l.itemRefs.length - kept.length} out-of-scope/duplicate itemRef(s)`,
            )
          }
          for (const r of kept) seenRef.add(r)
          l.itemRefs = kept
        }
        up.deferredOut = up.deferredOut.filter((d) => !seenRef.has(d.itemRef))
        await putJson(dataContainer(), planUnitPath(msg.jobId, i), up)
        const placed = up.lessons.filter((l) => l.itemRefs.length > 0).length
        const lessonCount = up.lessons.length
        const progressLine = `Unit ${i + 1}/${map.units.length} planned — ${mu.id} ${mu.title}: ${lessonCount} lesson atoms (${placed} carrying placed items)`
        await mutateJob(msg.jobId, (r) => pushLog(r, progressLine))
      }
      unitPlans.push(up)
    }

    // ---- Pass 3: programmatic assembly (deferral threading, end-of-course
    // exclusions, item-ref hygiene) ----
    plan = assemblePlan(
      map,
      unitPlans,
      new Set(set.items.map((it) => it.id)),
    )
    await putJson(dataContainer(), planPath(msg.jobId), plan)
  }
  const totalUnits = plan.units.length

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running' // a redelivery can reach here with the row still 'queued'
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
    const started = Date.now()
    const cuts = readCuts(msg)
    let callSize = readCallSize(msg)

    // Checkpoints are PER LESSON (decoupled from call batching, which is
    // adaptive): a redelivered attempt resumes exactly at the first missing
    // lesson no matter what call size produced the finished ones. Legacy
    // fixed-size batch checkpoints from older builds seed the map so failed
    // runs from before this change resume without regenerating.
    const done = new Map<string, Lesson>()
    for (let b = 0; b * CARDS_LESSON_BATCH < skeleton.lessons.length; b++) {
      const legacy = await getJsonOrUndefined<Lesson[]>(dataContainer(), unitBatchPath(msg.jobId, unitIndex, b))
      if (legacy) for (const l of legacy) done.set(l.id, l)
    }
    for (const sk of skeleton.lessons) {
      if (done.has(sk.id)) continue
      const l = await getJsonOrUndefined<Lesson>(dataContainer(), unitLessonPath(msg.jobId, unitIndex, sk.id))
      if (l) done.set(sk.id, l)
    }

    const callCards = (slice: PlanLessonSkeleton[], effort: 'low' | 'medium', maxTokens: number, signal: AbortSignal) =>
      generateStructured<WireLessonBatch>({
        ...cardsPrompt(set, scope, plan, skeleton, slice, sourceSets, userDocs.names),
        schema: UNIT_CARDS_BATCH_SCHEMA,
        ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
        // effort 'medium' + 48k max_tokens fits the 10-minute Consumption
        // functionTimeout. The plan step keeps effort 'high'. After a
        // deadline cut the remaining lessons re-run at 'low'.
        effort,
        maxTokens,
        signal,
      })

    // Deadline-cut escalation shared by both call sites below: checkpointed
    // lessons are kept, so a fresh execution resumes exactly here; `cuts`
    // makes a slice that can NEVER fit fail terminally instead of looping.
    const escalateCut = async (label: string): Promise<void> => {
      if (cuts + 1 >= MAX_CARD_CUTS) {
        throw new Error(
          `Card generation for unit ${skeleton.id} (${label}) did not fit the 10-minute execution window after ${MAX_CARD_CUTS} attempts, even at low effort — narrow the request and retry.`,
        )
      }
      await mutateJob(msg.jobId, (r) =>
        pushLog(
          r,
          `Unit ${skeleton.id}: card call (${label}) ran long and was cut at the execution deadline — retrying at low effort in a fresh execution`,
        ),
      )
      await enqueueJob({
        jobId: msg.jobId,
        kind: 'generate',
        step: 'cards',
        scopeId,
        unitIndex,
        payload: { cuts: cuts + 1, callSize },
      })
      ctx.log(
        `generate/cards ${msg.jobId}: unit ${unitIndex} (${label}) cut at the execution deadline (cut ${cuts + 1}) — re-enqueued`,
      )
    }

    let calls = 0
    while (done.size < skeleton.lessons.length) {
      const pending = skeleton.lessons.filter((sk) => !done.has(sk.id))
      if (calls > 0 && (await pauseRequested(msg.jobId))) {
        await settlePaused(msg)
        return
      }
      if (calls > 0 && Date.now() - started > CARDS_TIME_BUDGET_MS) {
        await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'cards', scopeId, unitIndex, payload: { callSize } })
        ctx.log(
          `generate/cards ${msg.jobId}: unit ${unitIndex} paused with ${pending.length} lesson(s) pending (time budget) — re-enqueued`,
        )
        return
      }
      const slice = pending.slice(0, callSize)
      const label = `lessons ${slice.map((sk) => sk.id).join(', ')}`
      const { signal, dispose } = bounded(started)
      let wire: WireLessonBatch
      calls++
      try {
        wire = await callCards(slice, cuts > 0 ? 'low' : 'medium', CARDS_MAX_TOKENS, signal)
      } catch (e) {
        if (isTruncation(e) && slice.length > 1) {
          // The output budget overflowed — truncation is deterministic, so a
          // plain retry of the identical slice fails identically. Halve the
          // call size (it rides every re-enqueue) and re-slice.
          callSize = Math.ceil(slice.length / 2)
          await mutateJob(msg.jobId, (r) =>
            pushLog(
              r,
              `Unit ${skeleton.id}: ${slice.length} lessons per call overflowed the output budget — continuing with ${callSize}`,
            ),
          )
          continue
        }
        if (isTruncation(e)) {
          // A single lesson alone overflowed 48k. Reasoning tokens share the
          // max_tokens budget, so one rescue attempt at low effort with the
          // full default cap almost always fits; a second overflow is terminal.
          await mutateJob(msg.jobId, (r) =>
            pushLog(
              r,
              `Unit ${skeleton.id}: lesson ${slice[0].id} alone overflowed the output budget — retrying at low effort with the full output cap`,
            ),
          )
          try {
            wire = await callCards(slice, 'low', CARDS_RESCUE_MAX_TOKENS, signal)
          } catch (e2) {
            if (isTruncation(e2)) {
              throw new Error(
                `Card generation for lesson ${slice[0].id} (unit ${skeleton.id}) exceeded the model's output budget even alone at low effort — the lesson resolves to more content than one call can emit. Split the standard or narrow the request and retry.`,
              )
            }
            if (isAbort(e2)) {
              await escalateCut(label)
              return
            }
            throw e2
          }
        } else if (isAbort(e)) {
          await escalateCut(label)
          return
        } else {
          throw e
        }
      } finally {
        dispose()
      }
      if (!wire.lessons || wire.lessons.length === 0) {
        throw new Error(`card generation returned no lessons for unit ${skeleton.id} (${label})`)
      }
      // Validate against the skeleton slice BEFORE checkpointing: the model
      // sees the full unit_skeleton alongside batch_lessons, so an
      // off-target reply (wrong ids, duplicates, extra lessons) is possible
      // — and a checkpointed bad lesson would be reused by every retry
      // forever. A throw instead gets normal queue retries, which
      // regenerate the slice.
      const returnedIds = wire.lessons.map((l) => l.id)
      const wantedIds = slice.map((l) => l.id)
      const wantedSet = new Set(wantedIds)
      if (
        returnedIds.length !== wantedIds.length ||
        new Set(returnedIds).size !== returnedIds.length ||
        returnedIds.some((lid) => !wantedSet.has(lid))
      ) {
        throw new Error(
          `card generation for unit ${skeleton.id} returned lessons [${returnedIds.join(', ')}] — expected exactly [${wantedIds.join(', ')}]`,
        )
      }
      const byId = new Map(wire.lessons.map((l) => [l.id, l]))
      for (const sk of slice) {
        const w = byId.get(sk.id)
        if (!w) throw new Error(`lesson ${sk.id} missing from validated slice — unreachable`)
        // The plan skeleton is the authority on which items attach here —
        // restore any ref the cards call lost or mangled.
        const lesson = toLesson(w, validItemIds, sk.itemRefs)
        await putJson(dataContainer(), unitLessonPath(msg.jobId, unitIndex, sk.id), lesson)
        done.set(sk.id, lesson)
      }
    }
    // Assemble in skeleton order regardless of generation order.
    const lessons = skeleton.lessons.map((sk) => done.get(sk.id) as Lesson)
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
  // Student-facing display titles are a downstream identity key — enforce
  // course-wide uniqueness (sibling card batches pick theirs independently).
  dedupeStudentTitles(units)

  const scope = await getScope(scopeId)
  const evidenceSet = await getScopeEvidenceSet(scope)
  // Coherence webs (Atomization Guide Part IV): rendered from the plan's
  // dependency extraction + the finished units, sanitized into DAGs; their
  // structural findings land in the QC report.
  const built = buildCoherenceWebs(plan, units, scope.title)
  const qc = [...runQc(units, plan, evidenceSet.items), coherenceQcCheck(built)]
  const lessons = countLessons(units)

  scope.units = units
  scope.qc = qc
  if (built.webs.length > 0) scope.coherence = built.webs
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
  // Every generated scope passes the four QC gates (spec: the gates run as
  // pipeline stages after generation) — best-effort observer: a dispatch
  // failure must never fail the generation, and the gates are read-only
  // against the scope they check.
  const qcJobId = newId('job')
  let qcJobCreated = false
  try {
    await createJob({
      jobId: qcJobId,
      kind: 'qc',
      scopeId,
      totalStages: 5,
      stage: 'Queued',
      detail: `Four-gate QC dispatched for "${scope.title}"`,
    })
    qcJobCreated = true
    await enqueueJob({ jobId: qcJobId, kind: 'qc', step: 'run', scopeId })
  } catch (e) {
    ctx.warn(`generate/finalize ${msg.jobId}: QC dispatch failed (scope unaffected): ${String(e)}`)
    if (qcJobCreated) {
      // The job record exists but no queue message will ever pick it up —
      // mark it failed rather than leaving an eternal 'Queued'.
      await mutateJob(qcJobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the QC run'
        pushLog(r, 'Dispatch failed; run the gates from the Quality Control page')
      }).catch(() => undefined)
    }
  }
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
