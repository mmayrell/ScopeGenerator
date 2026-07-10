import { VsgRun, VsgRunLesson } from '../domain/types'
import { getLsgCourse, listLsgCourses } from '../data/lsg'
import {
  deleteVsgRunDocs,
  getVideoScriptOrUndefined,
  getVsgRun,
  listVsgRuns,
  mutateVsgRun,
  saveVsgRun,
  toVsgRunSummary,
} from '../data/vsg'
import { createJob, latestJobForVsgRun, mutateJob, pushLog, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { VSG_PLAYBOOK_VERSION } from '../data/video-playbook'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { DOCTRINE_VERSIONS, newId, nowIso } from '../shared/util'

/**
 * Video Script Generator (contract §Video Script Generator). Courses come
 * from the LSG registry (GET lsg/courses serves the picker); a run scripts a
 * multi-selected set of a course's ACTIVE lessons, one Claude call per lesson
 * through the vsg worker step. Conflict handling is flag → propose →
 * reconcile: POST …/reconcile records the user's per-conflict resolutions and
 * re-opens exactly that lesson.
 */

const MAX_LESSONS_PER_RUN = 60
const cap = (v: unknown, max: number): string => String(v ?? '').slice(0, max)

// POST /api/vsg/runs → { run, jobId } (201)
api({
  name: 'vsg-run-create',
  methods: ['POST'],
  route: 'vsg/runs',
  handler: async (req) => {
    const body = await readJson<{ courseId?: string; lessonIds?: string[]; steering?: string }>(req)
    const courseId = cap(body.courseId, 200)
    if (!courseId) throw new HttpError(400, 'courseId is required')
    const course = await getLsgCourse(courseId)

    const requested = [...new Set(Array.isArray(body.lessonIds) ? body.lessonIds.map((x) => cap(x, 120)) : [])]
    if (requested.length === 0) throw new HttpError(400, 'select at least one lesson')
    if (requested.length > MAX_LESSONS_PER_RUN) {
      throw new HttpError(400, `too many lessons (${requested.length}) — select at most ${MAX_LESSONS_PER_RUN} per run`)
    }
    const activeById = new Map(course.lessons.filter((l) => l.status === 'ACTIVE').map((l) => [l.lessonId, l]))
    const unknown = requested.filter((id) => !activeById.has(id))
    if (unknown.length > 0) {
      throw new HttpError(400, `these lessons are not active lessons of "${course.courseName}": ${unknown.slice(0, 6).join(', ')}`)
    }

    // One live run per (course, lesson): scripts store one-blob-per-lesson
    // with a read-increment-write version bump, so two concurrent runs over
    // the same lesson would race to the same blob and corrupt the version
    // trail (each run claiming a script the other generated).
    const liveOverlap = (await listVsgRuns())
      .filter((r) => r.courseId === course.courseId && r.status === 'generating')
      .flatMap((r) => r.lessons.filter((l) => requested.includes(l.lessonId)).map((l) => l.lessonTitle))
    if (liveOverlap.length > 0) {
      throw new HttpError(
        409,
        `a run is already generating scripts for ${liveOverlap.length} of these lessons (${[...new Set(liveOverlap)].slice(0, 4).join('; ')}${liveOverlap.length > 4 ? '; …' : ''}) — wait for it or delete it first`,
      )
    }

    const now = nowIso()
    const jobId = newId('job')
    // Resolutions persist per (lesson, conflict) across runs (playbook §2.4):
    // seed each lesson with the conflicts its LAST script was reconciled
    // under, so a new run pre-fills them instead of re-asking.
    const priorResolutions = new Map<string, VsgRunLesson['conflicts']>()
    await Promise.all(
      requested.map(async (id) => {
        const prior = await getVideoScriptOrUndefined(course.courseId, id)
        if (prior && prior.conflictsResolved.length > 0) priorResolutions.set(id, prior.conflictsResolved)
      }),
    )
    const lessons: VsgRunLesson[] = requested
      .map((id) => activeById.get(id)!)
      .sort((a, b) => a.lessonOrder - b.lessonOrder)
      .map((l) => ({
        lessonId: l.lessonId,
        lessonTitle: l.lessonTitle,
        unitName: l.unitName,
        lessonOrder: l.lessonOrder,
        status: 'pending' as const,
        conflicts: priorResolutions.get(l.lessonId) ?? [],
      }))
    const run: VsgRun = {
      id: newId('vsgrun'),
      courseId: course.courseId,
      courseName: course.courseName,
      subject: course.subject,
      grade: course.grade,
      standardSet: course.standardSet,
      steering: cap(body.steering, 4000).trim(),
      status: 'generating',
      lessons,
      playbookVersion: `VSG Playbook ${VSG_PLAYBOOK_VERSION}`,
      doctrineVersion: DOCTRINE_VERSIONS[0],
      created: now,
      updated: now,
    }
    await saveVsgRun(run)

    try {
      await createJob({
        jobId,
        kind: 'vsg',
        vsgRunId: run.id,
        totalStages: lessons.length,
        stage: 'Queued',
        detail: `Video scripts dispatched: ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} of "${course.courseName}"`,
      })
      await enqueueJob({ jobId, kind: 'vsg', step: 'run', vsgRunId: run.id })
    } catch (e) {
      try {
        await mutateJob(jobId, (r) => {
          r.status = 'failed'
          r.error = 'Failed to dispatch the scripting job'
          pushLog(r, 'Dispatch failed; delete the run and try again')
        })
      } catch {
        /* the job row may never have been created */
      }
      await mutateVsgRun(run.id, (r) => {
        r.status = 'failed'
        r.error = 'Failed to start the run — delete it and try again'
        r.updated = nowIso()
      })
      throw e
    }
    return ok({ run, jobId }, 201)
  },
})

// GET /api/vsg/runs → VsgRunSummary[] — newest first
api({
  name: 'vsg-run-list',
  methods: ['GET'],
  route: 'vsg/runs',
  handler: async () => {
    const runs = await listVsgRuns()
    return ok(runs.map(toVsgRunSummary).sort((a, b) => b.created.localeCompare(a.created)))
  },
})

// GET /api/vsg/runs/{id} → VsgRun   |   DELETE → { ok: true }
api({
  name: 'vsg-run-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'vsg/runs/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      const job = await latestJobForVsgRun(id)
      if (job && (job.status === 'queued' || job.status === 'running')) {
        await mutateJob(job.jobId, (r) => {
          r.cancelRequested = true
          pushLog(r, 'Run deleted — scripting stops at its next checkpoint')
        })
      }
      await deleteVsgRunDocs(id)
      return ok({ ok: true })
    }
    return ok(await getVsgRun(id))
  },
})

// GET /api/vsg/runs/{id}/job → JobStatus (poll)
api({
  name: 'vsg-run-job',
  methods: ['GET'],
  route: 'vsg/runs/{id}/job',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForVsgRun(id)
    if (!job) throw new HttpError(404, `no job for run ${id}`)
    return ok(toJobStatus(job))
  },
})

/**
 * Re-dispatch a settled or stalled run job so the worker picks up re-opened
 * lessons. Reuses the latest job row when it exists (the packet-retry
 * pattern: never a second live row for the same work); a provably-live job
 * needs no dispatch — the worker's settle-time pending check hands off.
 */
async function redispatch(runId: string, detail: string): Promise<string> {
  const job = await latestJobForVsgRun(runId)
  if (job && (job.status === 'queued' || job.status === 'running')) {
    const lastAt = job.log.length > 0 ? Date.parse(job.log[job.log.length - 1].at) : Date.parse(job.created)
    if (job.cancelRequested !== true && Date.now() - lastAt < 15 * 60 * 1000) return job.jobId
  }
  if (job) {
    await mutateJob(job.jobId, (r) => {
      r.status = 'queued'
      r.stage = 'Queued'
      delete r.error
      r.cancelRequested = false
      pushLog(r, detail)
    })
    await enqueueJob({ jobId: job.jobId, kind: 'vsg', step: 'run', vsgRunId: runId })
    return job.jobId
  }
  const jobId = newId('job')
  const run = await getVsgRun(runId)
  await createJob({ jobId, kind: 'vsg', vsgRunId: runId, totalStages: run.lessons.length, stage: 'Queued', detail })
  await enqueueJob({ jobId, kind: 'vsg', step: 'run', vsgRunId: runId })
  return jobId
}

// POST /api/vsg/runs/{id}/reconcile { lessonId, resolutions: [{ conflictId, resolution, resolvedBy }] } → { jobId }
api({
  name: 'vsg-run-reconcile',
  methods: ['POST'],
  route: 'vsg/runs/{id}/reconcile',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const body = await readJson<{
      lessonId?: string
      resolutions?: { conflictId?: string; resolution?: string; resolvedBy?: string }[]
    }>(req)
    const lessonId = cap(body.lessonId, 120)
    const provided = new Map(
      (Array.isArray(body.resolutions) ? body.resolutions : [])
        .filter((r) => typeof r.conflictId === 'string' && cap(r.resolution, 4000).trim().length > 0)
        .map((r) => [r.conflictId as string, { resolution: cap(r.resolution, 4000).trim(), resolvedBy: r.resolvedBy === 'custom' ? ('custom' as const) : ('default' as const) }]),
    )
    await mutateVsgRun(id, (run) => {
      const lesson = run.lessons.find((l) => l.lessonId === lessonId)
      if (!lesson) throw new HttpError(404, `lesson ${lessonId} is not part of this run`)
      if (lesson.status !== 'needs-reconciliation') {
        throw new HttpError(409, `lesson ${lessonId} is not awaiting reconciliation`)
      }
      const open = lesson.conflicts.filter((c) => !c.resolution)
      const unresolved = open.filter((c) => !provided.has(c.id))
      if (unresolved.length > 0) {
        throw new HttpError(400, `every open conflict needs a resolution — missing: ${unresolved.map((c) => c.id).join(', ')}`)
      }
      const now = nowIso()
      for (const c of open) {
        const r = provided.get(c.id)!
        c.resolution = r.resolution
        c.resolvedBy = r.resolvedBy
        c.resolvedAt = now
      }
      lesson.status = 'pending'
      delete lesson.error
      if (run.status !== 'generating') run.status = 'generating'
      run.updated = now
    })
    // A dispatch failure must not strand the lesson at 'pending' (nothing
    // else can drive it): revert to needs-reconciliation — the resolutions
    // stay recorded, so retrying the reconcile (even with no new answers)
    // re-dispatches cleanly.
    let jobId: string
    try {
      jobId = await redispatch(id, `Reconciled ${lessonId} — regenerating with the recorded resolutions`)
    } catch (e) {
      await mutateVsgRun(id, (run) => {
        const lesson = run.lessons.find((l) => l.lessonId === lessonId)
        if (lesson && lesson.status === 'pending') lesson.status = 'needs-reconciliation'
        run.updated = nowIso()
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId }, 202)
  },
})

// POST /api/vsg/runs/{id}/regenerate { lessonId } → { jobId } — fresh script for one lesson
api({
  name: 'vsg-run-regenerate',
  methods: ['POST'],
  route: 'vsg/runs/{id}/regenerate',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const body = await readJson<{ lessonId?: string }>(req)
    const lessonId = cap(body.lessonId, 120)
    let priorStatus: 'complete' | 'failed' | 'needs-reconciliation' = 'failed'
    await mutateVsgRun(id, (run) => {
      const lesson = run.lessons.find((l) => l.lessonId === lessonId)
      if (!lesson) throw new HttpError(404, `lesson ${lessonId} is not part of this run`)
      if (lesson.status === 'generating' || lesson.status === 'pending') {
        throw new HttpError(409, `lesson ${lessonId} is already generating`)
      }
      priorStatus = lesson.status
      // Resolutions persist per (lesson, conflict) and pre-fill regeneration;
      // unresolved flags are dropped — still-real conflicts re-flag fresh.
      lesson.conflicts = lesson.conflicts.filter((c) => c.resolution)
      lesson.status = 'pending'
      delete lesson.error
      if (run.status !== 'generating') run.status = 'generating'
      run.updated = nowIso()
    })
    // A dispatch failure must not strand the lesson at 'pending' — restore
    // the prior settled status so Regenerate stays retryable.
    let jobId: string
    try {
      jobId = await redispatch(id, `Regenerating ${lessonId}`)
    } catch (e) {
      await mutateVsgRun(id, (run) => {
        const lesson = run.lessons.find((l) => l.lessonId === lessonId)
        if (lesson && lesson.status === 'pending') lesson.status = priorStatus
        run.updated = nowIso()
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId }, 202)
  },
})

// GET /api/vsg/scripts/{courseId}/{lessonId} → VideoScript
api({
  name: 'vsg-script-get',
  methods: ['GET'],
  route: 'vsg/scripts/{courseId}/{lessonId}',
  handler: async (req) => {
    const courseId = requireParam(req, 'courseId')
    const lessonId = requireParam(req, 'lessonId')
    const script = await getVideoScriptOrUndefined(courseId, lessonId)
    if (!script) throw new HttpError(404, `no script for ${courseId}/${lessonId}`)
    return ok(script)
  },
})

// GET /api/vsg/courses → the LSG course registry, shaped for the picker
api({
  name: 'vsg-courses',
  methods: ['GET'],
  route: 'vsg/courses',
  handler: async () => {
    const courses = await listLsgCourses()
    return ok(
      courses
        .map((c) => ({
          courseId: c.courseId,
          courseName: c.courseName,
          subject: c.subject,
          grade: c.grade,
          standardSet: c.standardSet,
          activeLessonCount: c.lessons.filter((l) => l.status === 'ACTIVE').length,
          updated: c.updated,
        }))
        .sort((a, b) => b.updated.localeCompare(a.updated)),
    )
  },
})
