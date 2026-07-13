import { InvocationContext } from '@azure/functions'
import {
  JobMessage,
  LsgCourse,
  LsgCourseLesson,
  LsgLessonFields,
  LsgOutput,
  LsgOutputLesson,
  LsgRun,
} from '../domain/types'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import {
  courseIdFromName,
  getLsgCourseOrUndefined,
  getLsgRun,
  mutateLsgCourse,
  mutateLsgRun,
  saveLsgCourse,
} from '../data/lsg'
import { mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { lsgFieldsPrompt, lsgPlanPrompt } from '../services/prompts'
import {
  LSG_FIELDS_BATCH_SCHEMA,
  LSG_PLAN_SCHEMA,
  WireLsgFieldsBatch,
  WireLsgPlan,
  WireLsgPlanLesson,
} from '../services/schemas'
import { newId, nowIso } from '../shared/util'

// Lesson Scope Generation pipeline (kind `lsg`, step `run`) — checkpointed for
// the 10-minute Consumption timeout, mirroring the generate pipeline's
// deadline machinery:
//   phase 1  target plan & matching (one Claude call) → jobs/<jobId>/lsg-plan.json
//   phase 2  scope fields per lesson batch            → jobs/<jobId>/lsg-batch-<i>.json
//   phase 3  assemble output + persist to the course registry (idempotent)

export const LSG_TOTAL_STAGES = 3

const STAGE_PLAN = 'Stage 1 — Target plan & lesson matching'
const STAGE_FIELDS = 'Stage 2 — Lesson scope fields'
const STAGE_PERSIST = 'Stage 3 — Persisting to the course registry'

const planPath = (jobId: string) => `jobs/${jobId}/lsg-plan.json`
const batchPath = (jobId: string, i: number) => `jobs/${jobId}/lsg-batch-${i}.json`

/** Lessons per fields call — ten prose fields each; keeps every call well inside the execution window. */
const FIELDS_BATCH = 5
/** Stop starting new batches after this long and re-enqueue (same rationale as CARDS_TIME_BUDGET_MS). */
const TIME_BUDGET_MS = 4.5 * 60 * 1000
/** In-process abort for the in-flight Claude call — a host kill at 10:00 skips all settlement. */
const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000

const PLAN_EFFORT_LADDER = ['high', 'medium', 'low'] as const
const MAX_CUTS = 3

const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))

function readCuts(msg: JobMessage): number {
  const raw = (msg.payload ?? {}) as { cuts?: unknown }
  const n = Math.trunc(Number(raw.cuts ?? 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function bounded(started: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

const EMPTY_FIELDS: LsgLessonFields = {
  objectives: '',
  assessmentBoundary: '',
  difficultyCeiling: '',
  prerequisites: '',
  progressionPlacement: '',
  newLearning: '',
  instructionalApproach: '',
  nonGoals: '',
  assessmentEvidence: '',
  releasedItems: '',
}

export async function lsgRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const runId = msg.lsgRunId
  if (!runId) throw new Error('lsg/run message missing lsgRunId')
  const started = Date.now()

  const run = await getLsgRun(runId)
  if (run.status === 'complete') {
    ctx.log(`lsg/run ${msg.jobId}: run ${runId} already complete — duplicate message ignored`)
    await mutateJob(msg.jobId, (r) => {
      if (r.status !== 'complete') {
        r.status = 'complete'
        r.stagesDone = r.totalStages
        r.stage = 'Complete'
        pushLog(r, 'Run already complete — duplicate message settled')
      }
    })
    return
  }

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = STAGE_PLAN
    pushLog(r, `Planning ${run.requestType} for "${run.courseContext.courseName}"`)
  })

  // ---- phase 1: target plan & matching (checkpointed) ----
  let plan = await getJsonOrUndefined<WireLsgPlan>(dataContainer(), planPath(msg.jobId))
  if (!plan) {
    const cuts = readCuts(msg)
    const effort = PLAN_EFFORT_LADDER[Math.min(cuts, PLAN_EFFORT_LADDER.length - 1)]
    const { signal, dispose } = bounded(started)
    try {
      plan = await generateStructured<WireLsgPlan>({
        ...lsgPlanPrompt(run),
        schema: LSG_PLAN_SCHEMA,
        effort,
        signal,
      })
    } catch (e) {
      if (!isAbort(e)) throw e
      if (cuts + 1 >= PLAN_EFFORT_LADDER.length) {
        throw new Error(
          `Lesson scope planning did not fit the 10-minute execution window after ${PLAN_EFFORT_LADDER.length} attempts (effort ${PLAN_EFFORT_LADDER.join(' → ')}). Narrow the request (fewer lessons, a partial edit instead of a full course) and retry.`,
        )
      }
      await mutateJob(msg.jobId, (r) =>
        pushLog(r, `Planning was cut at the execution deadline — retrying at ${PLAN_EFFORT_LADDER[cuts + 1]} effort in a fresh execution`),
      )
      await enqueueJob({ jobId: msg.jobId, kind: 'lsg', step: 'run', lsgRunId: runId, payload: { cuts: cuts + 1 } })
      ctx.log(`lsg/run ${msg.jobId}: plan call cut at the execution deadline (cut ${cuts + 1}) — re-enqueued`)
      return
    } finally {
      dispose()
    }
    plan.lessons = sanitizePlanLessons(plan.lessons, run)
    if (plan.lessons.length === 0) {
      throw new Error('lesson scope planning produced no lessons — the request resolved to an empty plan')
    }
    await putJson(dataContainer(), planPath(msg.jobId), plan)
  }

  // ---- phase 2: scope fields per batch (checkpointed; DEACTIVATE lessons need none) ----
  const needsFields = plan.lessons.filter((l) => l.operation !== 'DEACTIVATE')
  const batches: { key: string; lesson: WireLsgPlanLesson }[][] = []
  const keyed = needsFields.map((lesson, i) => ({ key: `L${i + 1}`, lesson }))
  for (let b = 0; b < keyed.length; b += FIELDS_BATCH) {
    batches.push(keyed.slice(b, b + FIELDS_BATCH))
  }

  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = Math.max(r.stagesDone, 1)
    r.stage = STAGE_FIELDS
    r.totalUnits = batches.length
    r.unitsDone = r.unitsDone ?? 0
    pushLog(
      r,
      `Plan checkpointed: ${plan.lessons.length} lessons (${plan.lessons.filter((l) => l.operation === 'CREATE').length} create, ${plan.lessons.filter((l) => l.operation === 'UPDATE').length} update, ${plan.lessons.filter((l) => l.operation === 'DEACTIVATE').length} deactivate) — ${batches.length} field batch${batches.length === 1 ? '' : 'es'}`,
    )
  })

  const cuts = readCuts(msg)
  const fieldsByKey = new Map<string, LsgLessonFields>()
  for (let b = 0; b < batches.length; b++) {
    let batch = await getJsonOrUndefined<WireLsgFieldsBatch['lessons']>(dataContainer(), batchPath(msg.jobId, b))
    if (!batch) {
      if (b > 0 && Date.now() - started > TIME_BUDGET_MS) {
        await enqueueJob({ jobId: msg.jobId, kind: 'lsg', step: 'run', lsgRunId: runId })
        ctx.log(`lsg/run ${msg.jobId}: paused at field batch ${b}/${batches.length} (time budget) — re-enqueued`)
        return
      }
      const { signal, dispose } = bounded(started)
      let wire: WireLsgFieldsBatch
      try {
        wire = await generateStructured<WireLsgFieldsBatch>({
          ...lsgFieldsPrompt(run, plan, batches[b]),
          schema: LSG_FIELDS_BATCH_SCHEMA,
          effort: cuts > 0 ? 'low' : 'medium',
          maxTokens: 48000,
          signal,
        })
      } catch (e) {
        if (!isAbort(e)) throw e
        if (cuts + 1 >= MAX_CUTS) {
          throw new Error(
            `Lesson scope field generation (batch ${b + 1}/${batches.length}) did not fit the 10-minute execution window after ${MAX_CUTS} attempts, even at low effort — narrow the request and retry.`,
          )
        }
        await mutateJob(msg.jobId, (r) =>
          pushLog(r, `Field batch ${b + 1}/${batches.length} was cut at the execution deadline — retrying at low effort in a fresh execution`),
        )
        await enqueueJob({ jobId: msg.jobId, kind: 'lsg', step: 'run', lsgRunId: runId, payload: { cuts: cuts + 1 } })
        ctx.log(`lsg/run ${msg.jobId}: batch ${b} cut at the execution deadline (cut ${cuts + 1}) — re-enqueued`)
        return
      } finally {
        dispose()
      }
      // Validate the echo BEFORE checkpointing — a checkpointed off-target
      // batch would be reused by every retry forever.
      const wantedKeys = batches[b].map((x) => x.key)
      const gotKeys = (wire.lessons ?? []).map((l) => l.key)
      const wantedSet = new Set(wantedKeys)
      if (
        gotKeys.length !== wantedKeys.length ||
        new Set(gotKeys).size !== gotKeys.length ||
        gotKeys.some((k) => !wantedSet.has(k))
      ) {
        throw new Error(
          `lesson scope fields batch ${b + 1}/${batches.length} returned keys [${gotKeys.join(', ')}] — expected exactly [${wantedKeys.join(', ')}]`,
        )
      }
      batch = wire.lessons
      await putJson(dataContainer(), batchPath(msg.jobId, b), batch)
      await mutateJob(msg.jobId, (r) => {
        r.unitsDone = b + 1
        pushLog(r, `Field batch ${b + 1}/${batches.length} checkpointed (${batch!.length} lessons)`)
      })
    }
    for (const l of batch) {
      const { key, ...fields } = l
      fieldsByKey.set(key, fields)
    }
  }

  // ---- phase 3: assemble the output and persist it to the registry ----
  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = Math.max(r.stagesDone, 2)
    r.stage = STAGE_PERSIST
    pushLog(r, 'Assembling output and persisting course + lesson scope entities')
  })

  const output = assembleOutput(run, plan, keyed, fieldsByKey)

  // Persist the output on the run FIRST (applied still false), then apply to
  // the registry, then flip applied+complete — a redelivery between the two
  // writes re-runs an apply that is itself idempotent (title-matched upsert).
  await mutateLsgRun(runId, (r) => {
    r.output = output
    r.updated = nowIso()
  })
  await applyOutputToRegistry(output, run.snapshot?.lessons ?? [])
  await mutateLsgRun(runId, (r) => {
    r.status = 'complete'
    r.applied = true
    delete r.error
    r.updated = nowIso()
  })

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = LSG_TOTAL_STAGES
    r.stage = 'Complete'
    pushLog(
      r,
      `${output.courseOperation === 'CREATE' ? 'Course created' : 'Course updated'}: ${output.lessons.length} lesson operations persisted for "${output.targetCourse.courseName}"`,
    )
  })
  ctx.log(`lsg/run ${msg.jobId}: run ${runId} complete (${output.courseOperation}, ${output.lessons.length} lessons)`)
}

/**
 * Code-level guard on the model's matching output (the snapshot is the
 * identity authority — Decision 4): an UPDATE/DEACTIVATE whose lessonId is not
 * in the snapshot cannot be persisted. Unknown UPDATEs demote to CREATE;
 * unknown DEACTIVATEs are dropped (there is nothing to deactivate). CREATEs
 * never carry an id.
 */
function sanitizePlanLessons(lessons: WireLsgPlanLesson[], run: LsgRun): WireLsgPlanLesson[] {
  const knownIds = new Set((run.snapshot?.lessons ?? []).map((l) => l.lessonId))
  const out: WireLsgPlanLesson[] = []
  for (const l of lessons) {
    if (l.operation === 'CREATE') {
      out.push({ ...l, lessonId: '', deactivationReason: '' })
    } else if (knownIds.has(l.lessonId)) {
      out.push(l.operation === 'UPDATE' ? { ...l, deactivationReason: '' } : l)
    } else if (l.operation === 'UPDATE') {
      out.push({ ...l, lessonId: '', operation: 'CREATE', deactivationReason: '' })
    }
    // unknown DEACTIVATE: dropped
  }
  return out
}

function assembleOutput(
  run: LsgRun,
  plan: WireLsgPlan,
  keyed: { key: string; lesson: WireLsgPlanLesson }[],
  fieldsByKey: Map<string, LsgLessonFields>,
): LsgOutput {
  const keyByLesson = new Map(keyed.map((k) => [k.lesson, k.key]))
  const existing = run.snapshot?.courseExists === true ? run.snapshot.course : null
  const courseName = run.courseContext.courseName
  const lessons: LsgOutputLesson[] = plan.lessons.map((l) => {
    const key = keyByLesson.get(l)
    const fields = (key ? fieldsByKey.get(key) : undefined) ?? EMPTY_FIELDS
    return {
      lessonId: l.lessonId || null,
      operation: l.operation,
      unitName: l.unitName,
      lessonOrder: l.lessonOrder,
      standardId: l.standardId,
      lessonTitle: l.lessonTitle,
      deactivationReason: l.operation === 'DEACTIVATE' ? l.deactivationReason || 'Deactivated by the new target plan.' : null,
      ...fields,
      // STRICT output rule: released items are always an array.
      releasedItems: splitReleasedItems(fields.releasedItems),
    }
  })
  return {
    // The snapshot decides CREATE vs UPDATE (design §2), never the model.
    courseOperation: existing ? 'UPDATE' : 'CREATE',
    targetCourse: {
      courseId: existing ? existing.courseId : null,
      courseName, // the primary key — always exactly as requested
      grade: run.courseContext.grade,
      subject: run.courseContext.subject,
      standardSet: plan.targetCourse.standardSet || run.courseContext.curriculumFramework,
    },
    lessons,
  }
}

/**
 * The orchestrator persist (design Decision 5): the LSG output lands in the
 * course registry via the lesson-scope write path — CREATE assigns a platform
 * lessonId, UPDATE merges onto the existing lesson, DEACTIVATE flips status.
 * A course missing from the registry (fresh CREATE, or a run seeded from a
 * published scope / uploaded data model) is first materialized with the run's
 * snapshot lessons, so seeded UPDATE/DEACTIVATE lessonIds resolve.
 * Idempotent: a CREATE whose title already exists ACTIVE in the same unit
 * upserts instead of duplicating (safe under queue redelivery).
 */
async function applyOutputToRegistry(output: LsgOutput, seedLessons: LsgCourseLesson[]): Promise<void> {
  const courseId = courseIdFromName(output.targetCourse.courseName)
  const now = nowIso()
  const existing = await getLsgCourseOrUndefined(courseId)

  if (!existing) {
    const course: LsgCourse = {
      courseId,
      courseName: output.targetCourse.courseName,
      subject: output.targetCourse.subject,
      grade: output.targetCourse.grade,
      curriculumFramework: output.targetCourse.standardSet,
      standardSet: output.targetCourse.standardSet,
      lessons: seedLessons,
      created: now,
      updated: now,
    }
    await saveLsgCourse(course)
  }

  await mutateLsgCourse(courseId, (course) => {
    for (const l of output.lessons) {
      if (l.operation === 'DEACTIVATE') {
        const target = course.lessons.find((cl) => cl.lessonId === l.lessonId)
        if (target) target.status = 'INACTIVE'
        continue
      }
      if (l.operation === 'UPDATE') {
        const idx = course.lessons.findIndex((cl) => cl.lessonId === l.lessonId)
        if (idx >= 0) {
          course.lessons[idx] = toCourseLesson(l, course.lessons[idx].lessonId)
          continue
        }
        // Snapshot drift (lesson deleted since the run started) — fall through to create.
      }
      // CREATE (or drifted UPDATE): upsert by (unitName, lessonTitle) among
      // ACTIVE lessons so a redelivered apply never duplicates.
      const match = course.lessons.find(
        (cl) =>
          cl.status === 'ACTIVE' &&
          cl.unitName.toLowerCase() === l.unitName.toLowerCase() &&
          cl.lessonTitle.toLowerCase() === l.lessonTitle.toLowerCase(),
      )
      if (match) {
        const idx = course.lessons.indexOf(match)
        course.lessons[idx] = toCourseLesson(l, match.lessonId)
      } else {
        course.lessons.push(toCourseLesson(l, newId('lesson')))
      }
    }
    course.lessons.sort((a, b) => a.lessonOrder - b.lessonOrder || a.lessonTitle.localeCompare(b.lessonTitle))
    course.updated = now
  })
}

function toCourseLesson(l: LsgOutputLesson, lessonId: string): LsgCourseLesson {
  return {
    lessonId,
    unitName: l.unitName,
    lessonTitle: l.lessonTitle,
    standardId: l.standardId,
    lessonOrder: l.lessonOrder,
    status: 'ACTIVE',
    objectives: l.objectives,
    assessmentBoundary: l.assessmentBoundary,
    difficultyCeiling: l.difficultyCeiling,
    prerequisites: l.prerequisites,
    progressionPlacement: l.progressionPlacement,
    newLearning: l.newLearning,
    instructionalApproach: l.instructionalApproach,
    nonGoals: l.nonGoals,
    assessmentEvidence: l.assessmentEvidence,
    // The output contract carries released items as an ARRAY; the registry
    // stores the blank-line-joined string (the card-field shape).
    releasedItems: joinReleasedItems(l.releasedItems),
  }
}

/** Output-contract shape: released items are ALWAYS an array — one entry per item reference or exemplar. */
export function splitReleasedItems(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
}

export function joinReleasedItems(items: string[] | string): string {
  return Array.isArray(items) ? items.join('\n\n') : String(items ?? '')
}
