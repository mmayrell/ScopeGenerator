import { LsgDataModelLesson, LsgMode, LsgRequestType, LsgRun } from '../domain/types'
import { getScopeOrUndefined, getSetOrUndefined } from '../data/entities'
import { listVsgRuns } from '../data/vsg'
import {
  courseIdFromName,
  deleteLsgCourseDocs,
  deleteLsgRunDocs,
  getLsgCourse,
  getLsgRun,
  importScopeIntoRegistry,
  listLsgCourses,
  listLsgRuns,
  saveLsgRun,
  snapshotByCourseName,
  snapshotFromDataModel,
  snapshotFromScope,
  toLsgRunSummary,
} from '../data/lsg'
import { createJob, latestJobForLsgRun, mutateJob, pushLog, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { LSG_TOTAL_STAGES } from '../pipeline/lsg'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, nowIso } from '../shared/util'

/**
 * Lesson Scope Generation (contract §Lesson Scope Generation) — create course
 * vs partial edit. The course registry is keyed by course NAME; the Snapshot
 * endpoint reads current course state; a run captures the snapshot, plans the
 * target lessons with per-lesson operations (CREATE | UPDATE | DEACTIVATE),
 * and the worker persists the output into the registry. Standalone: no
 * coupling to standard sets, scopes, or packets.
 */

const cap = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

// GET /api/lsg/snapshot?courseName=… → LsgSnapshot — the Course Snapshot API.
// "Course does not exist" is a first-class answer (it decides CREATE vs
// UPDATE), so an unknown name returns the empty shape, never 404.
api({
  name: 'lsg-snapshot',
  methods: ['GET'],
  route: 'lsg/snapshot',
  handler: async (req) => {
    const courseName = (req.query.get('courseName') ?? '').trim()
    if (!courseName) throw new HttpError(400, 'courseName query parameter is required')
    return ok(await snapshotByCourseName(courseName))
  },
})

// GET /api/lsg/courses → LsgCourse[] (newest first)
api({
  name: 'lsg-course-list',
  methods: ['GET'],
  route: 'lsg/courses',
  handler: async () => {
    const courses = await listLsgCourses()
    return ok(courses.sort((a, b) => b.updated.localeCompare(a.updated)))
  },
})

// POST /api/lsg/courses/import-scope { scopeId, courseName } → { course } —
// MECHANICAL import (no generation): the published scope's lessons become the
// named course's ACTIVE lesson set (existing ids kept on unit+title matches,
// absentees deactivated). Course context derives from the scope's evidence
// set; the Video Script Generator's course picker reads the result instantly.
api({
  name: 'lsg-course-import-scope',
  methods: ['POST'],
  route: 'lsg/courses/import-scope',
  handler: async (req) => {
    const body = await readJson<{ scopeId?: string; courseName?: string }>(req)
    const scopeId = cap(body.scopeId, 120)
    const courseName = cap(body.courseName, 200)
    if (!scopeId) throw new HttpError(400, 'scopeId is required')
    if (!courseName) throw new HttpError(400, 'courseName is required')
    const scope = await getScopeOrUndefined(scopeId)
    // 409, not 404: a plain 404 reads as "endpoint not deployed yet" to the
    // deploy-skew shims; a vanished scope is a stale picker, not a rollout.
    if (!scope) throw new HttpError(409, `scope ${scopeId} no longer exists — refresh and pick again`)
    if (scope.status !== 'complete') {
      throw new HttpError(409, 'only a completed scope can be imported as a course')
    }
    // A video-script run generating against this course reads it at every
    // execution — importing mid-run would deactivate/replace the lessons it
    // holds ids for and split one run across two doctrine inputs.
    const courseId = courseIdFromName(courseName)
    const liveVsg = (await listVsgRuns()).filter((r) => r.courseId === courseId && r.status === 'generating')
    if (liveVsg.length > 0) {
      throw new HttpError(409, `a video-script run is generating against "${courseName}" — wait for it or delete it first`)
    }
    // The import is mechanical — it needs only three metadata strings from
    // the scope's evidence set(s), and a DELETED set (an allowed operation
    // that leaves scopes untouched) must not block it. Missing sets degrade
    // to scope-title fallbacks.
    const setIds = scope.setIds ?? (scope.setId ? [scope.setId] : [])
    const sets = (await Promise.all(setIds.map((id) => getSetOrUndefined(id)))).filter(
      (s): s is NonNullable<typeof s> => s !== undefined,
    )
    const gradeSpan = sets.map((s) => s.gradeSpan).join(' + ')
    const gradeNums = [...(gradeSpan + ' ' + (sets.length === 0 ? scope.title : '')).matchAll(/\d+/g)].map((m) =>
      Number(m[0]),
    )
    const hasK = /\bK\b/i.test(gradeSpan)
    // Single grade → that grade; K-only → 'K'; a genuine span keeps the span
    // (the grade-band profile is per-course; a multi-grade course is
    // inherently approximate and the span at least says so).
    const grade =
      gradeNums.length === 0
        ? hasK
          ? 'K'
          : ''
        : new Set(gradeNums).size === 1
          ? String(gradeNums[0])
          : `${Math.min(...gradeNums)}-${Math.max(...gradeNums)}`
    const course = await importScopeIntoRegistry(
      {
        subject: sets[0]?.subject || 'Mathematics',
        grade,
        curriculumFramework: sets[0]?.codingScheme || sets[0]?.name || '',
        courseName,
      },
      sets.map((s) => s.name).join(' + ') || scope.title,
      scope,
    )
    return ok({ course }, 201)
  },
})

// GET /api/lsg/courses/{id} → LsgCourse   |   DELETE → { ok: true }
api({
  name: 'lsg-course-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'lsg/courses/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      await deleteLsgCourseDocs(id)
      return ok({ ok: true })
    }
    return ok(await getLsgCourse(id))
  },
})

interface CreateRunBody {
  requestType?: string
  courseContext?: { subject?: string; grade?: string; curriculumFramework?: string; courseName?: string }
  generationScope?: { mode?: string; includedLessons?: string[]; editInstruction?: string }
  /** A published scope to edit — seeds the snapshot when the registry has no course under the name. */
  sourceScopeId?: string
  /** An uploaded existing data model — seeds the snapshot (wins over sourceScopeId). */
  dataModel?: { name?: string; lessons?: Partial<LsgDataModelLesson>[] }
}

/** An uploaded data model can carry hundreds of lessons of prose — cap the run doc's footprint. */
const MAX_DM_LESSONS = 300

function normalizeDataModelLessons(rows: Partial<LsgDataModelLesson>[]): LsgDataModelLesson[] {
  return rows
    .filter((r) => typeof r?.lessonTitle === 'string' && r.lessonTitle.trim().length > 0)
    .slice(0, MAX_DM_LESSONS)
    .map((r, i) => ({
      lessonTitle: cap(r.lessonTitle, 300),
      unitName: cap(r.unitName, 200) || 'Uncategorized',
      standardId: cap(r.standardId, 80),
      lessonOrder: Number.isFinite(Number(r.lessonOrder)) && Number(r.lessonOrder) > 0 ? Math.trunc(Number(r.lessonOrder)) : i + 1,
      objectives: cap(r.objectives, 6000),
      assessmentBoundary: cap(r.assessmentBoundary, 6000),
      difficultyCeiling: cap(r.difficultyCeiling, 6000),
      prerequisites: cap(r.prerequisites, 6000),
      progressionPlacement: cap(r.progressionPlacement, 6000),
      newLearning: cap(r.newLearning, 6000),
      instructionalApproach: cap(r.instructionalApproach, 6000),
      nonGoals: cap(r.nonGoals, 6000),
      assessmentEvidence: cap(r.assessmentEvidence, 6000),
      releasedItems: cap(r.releasedItems, 6000),
    }))
}

// POST /api/lsg/runs → { run, jobId } (201) — captures the course snapshot,
// creates the run doc (status 'generating'), and dispatches the lsg job.
api({
  name: 'lsg-run-create',
  methods: ['POST'],
  route: 'lsg/runs',
  handler: async (req) => {
    const body = await readJson<CreateRunBody>(req)
    const requestType = String(body.requestType ?? '') as LsgRequestType
    if (!['FULL_COURSE', 'PARTIAL_UPDATE'].includes(requestType)) {
      throw new HttpError(400, 'requestType must be FULL_COURSE or PARTIAL_UPDATE')
    }
    const mode = String(body.generationScope?.mode ?? '') as LsgMode
    if (!['FULL_COURSE', 'LESSONS'].includes(mode)) {
      throw new HttpError(400, 'generationScope.mode must be FULL_COURSE or LESSONS')
    }
    const courseName = cap(body.courseContext?.courseName, 200)
    const subject = cap(body.courseContext?.subject, 120)
    const grade = cap(body.courseContext?.grade, 40)
    const curriculumFramework = cap(body.courseContext?.curriculumFramework, 80)
    if (!courseName || !subject || !grade || !curriculumFramework) {
      throw new HttpError(400, 'courseContext requires subject, grade, curriculumFramework, and courseName')
    }
    const includedLessons = (Array.isArray(body.generationScope?.includedLessons) ? body.generationScope.includedLessons : [])
      .map((t) => cap(t, 300))
      .filter((t) => t.length > 0)
      .slice(0, 60)
    if (mode === 'LESSONS' && includedLessons.length === 0) {
      throw new HttpError(400, 'mode LESSONS requires at least one included lesson')
    }
    const editInstruction = cap(body.generationScope?.editInstruction, 4000)
    const courseContext = { subject, grade, curriculumFramework, courseName }

    // The snapshot is captured NOW and stored on the run — the plan the worker
    // builds (possibly across retries) always matches against one stable view.
    // The registry is authoritative (it holds prior edits); when it has no
    // course under the name, an uploaded data model seeds the snapshot, else a
    // selected published scope does.
    let snapshot = await snapshotByCourseName(courseName)
    let source: LsgRun['source']
    const dmRows = normalizeDataModelLessons(Array.isArray(body.dataModel?.lessons) ? body.dataModel.lessons : [])
    const sourceScopeId = cap(body.sourceScopeId, 100)
    if (!snapshot.courseExists && dmRows.length > 0) {
      snapshot = snapshotFromDataModel(courseContext, dmRows)
      source = { dataModelName: cap(body.dataModel?.name, 200) || 'uploaded data model' }
      if (sourceScopeId) source.scopeId = sourceScopeId
    } else if (!snapshot.courseExists && sourceScopeId) {
      const scope = await getScopeOrUndefined(sourceScopeId)
      if (!scope) throw new HttpError(400, `scope ${sourceScopeId} not found`)
      if (scope.status !== 'complete') throw new HttpError(409, 'that scope is not complete — wait for it to finish before editing it')
      snapshot = snapshotFromScope(courseContext, scope)
      source = { scopeId: scope.id, scopeTitle: scope.title }
    }
    if (mode === 'LESSONS' && !snapshot.courseExists) {
      throw new HttpError(
        400,
        `course "${courseName}" does not exist — a partial edit needs an existing course, a published scope to edit, or an uploaded data model`,
      )
    }

    const now = nowIso()
    const jobId = newId('job')
    const run: LsgRun = {
      id: newId('lsgrun'),
      requestType,
      courseContext,
      generationScope: { mode, includedLessons, editInstruction },
      ...(source ? { source } : {}),
      status: 'generating',
      snapshot,
      created: now,
      updated: now,
    }
    await saveLsgRun(run)

    try {
      await createJob({
        jobId,
        kind: 'lsg',
        lsgRunId: run.id,
        totalStages: LSG_TOTAL_STAGES,
        stage: 'Queued',
        detail: `Lesson scope generation queued (${requestType}, ${mode}) for "${courseName}"`,
      })
      await enqueueJob({ jobId, kind: 'lsg', step: 'run', lsgRunId: run.id })
    } catch (e) {
      // No job means the 'generating' run would spin forever — settle it failed.
      try {
        await mutateJob(jobId, (r) => {
          r.status = 'failed'
          r.error = 'Failed to dispatch the generation job'
          pushLog(r, 'Dispatch failed')
        })
      } catch {
        /* the job row may never have been created — the run settle below is what matters */
      }
      run.status = 'failed'
      run.error = 'Failed to start the generation — try again'
      run.updated = nowIso()
      await saveLsgRun(run)
      throw new HttpError(500, `failed to enqueue lesson scope generation: ${e instanceof Error ? e.message : String(e)}`)
    }
    return ok({ run, jobId }, 201)
  },
})

// GET /api/lsg/runs → LsgRunSummary[] (newest first)
api({
  name: 'lsg-run-list',
  methods: ['GET'],
  route: 'lsg/runs',
  handler: async () => {
    const runs = await listLsgRuns()
    return ok(runs.map(toLsgRunSummary).sort((a, b) => b.created.localeCompare(a.created)))
  },
})

// GET /api/lsg/runs/{id} → LsgRun   |   DELETE → { ok: true }
api({
  name: 'lsg-run-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'lsg/runs/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      await deleteLsgRunDocs(id)
      return ok({ ok: true })
    }
    return ok(await getLsgRun(id))
  },
})

// GET /api/lsg/runs/{id}/job → JobStatus — polled by the run screen
api({
  name: 'lsg-run-job',
  methods: ['GET'],
  route: 'lsg/runs/{id}/job',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForLsgRun(id)
    if (!job) throw new HttpError(404, `no job for lesson scope run ${id}`)
    return ok(toJobStatus(job))
  },
})
