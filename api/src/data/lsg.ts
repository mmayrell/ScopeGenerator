import { odata } from '@azure/data-tables'
import { LsgCourse, LsgCourseLesson, LsgDataModelLesson, LsgRun, LsgRunSummary, LsgSnapshot, Scope } from '../domain/types'
import { HttpError } from '../shared/errors'
import { newId, nowIso, sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfAbsent, putJsonIfMatch } from './blobs'

// Lesson Scope Generation storage (contract §Storage layout):
//   lsg/courses/<courseId>.json   current LsgCourse (the course registry)
//   lsg/runs/<runId>.json         current LsgRun
// Table `entities` index rows: PartitionKey 'lsg-course' / 'lsg-run'.

const courseBlobPath = (id: string) => `lsg/courses/${id}.json`
const runBlobPath = (id: string) => `lsg/runs/${id}.json`

/**
 * The course primary key is the course NAME (design Decision 2): the same
 * name always resolves to the same courseId, so "G3 CCSS NHITL" invoked twice
 * updates one course while "G3 NHITL 2" creates another.
 */
export function courseIdFromName(courseName: string): string {
  const slug = courseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled-course'
}

// ---------------------------------------------------------------------------
// Courses (the registry the Snapshot API reads and the orchestrator writes)
// ---------------------------------------------------------------------------

export async function saveLsgCourse(course: LsgCourse): Promise<void> {
  await putJson(dataContainer(), courseBlobPath(course.courseId), course)
  await upsertCourseRow(course)
}

async function upsertCourseRow(course: LsgCourse): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'lsg-course',
      rowKey: course.courseId,
      courseName: course.courseName,
      updated: course.updated,
      blobPath: courseBlobPath(course.courseId),
    },
    'Replace',
  )
}

/** Read–modify–write with ETag optimistic concurrency — the LSG twin of mutateScope. */
export async function mutateLsgCourse(id: string, fn: (course: LsgCourse) => void): Promise<LsgCourse> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<LsgCourse>(dataContainer(), courseBlobPath(id))
    if (!found) throw new HttpError(404, `course ${id} not found`)
    const course = found.doc
    fn(course)
    try {
      await putJsonIfMatch(dataContainer(), courseBlobPath(id), course, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertCourseRow(course)
    return course
  }
  throw new Error(`course ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getLsgCourseOrUndefined(id: string): Promise<LsgCourse | undefined> {
  return getJsonOrUndefined<LsgCourse>(dataContainer(), courseBlobPath(id))
}

export async function getLsgCourse(id: string): Promise<LsgCourse> {
  const course = await getLsgCourseOrUndefined(id)
  if (!course) throw new HttpError(404, `course ${id} not found`)
  return course
}

export async function listLsgCourses(): Promise<LsgCourse[]> {
  return listLsgDocs<LsgCourse>('lsg-course', getLsgCourseOrUndefined)
}

export async function deleteLsgCourseDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(courseBlobPath(id)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('lsg-course', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

/**
 * Course Snapshot API (design Decision 3) — read-only current course/lesson
 * state, resolved by course NAME. A course that does not exist returns the
 * design doc's empty shape, never a 404: "does not exist" is a first-class
 * answer (it decides CREATE vs UPDATE).
 */
export async function snapshotByCourseName(courseName: string): Promise<LsgSnapshot> {
  const course = await getLsgCourseOrUndefined(courseIdFromName(courseName))
  if (!course) return { courseExists: false, course: null, lessons: [] }
  return {
    courseExists: true,
    course: {
      courseId: course.courseId,
      courseName: course.courseName,
      subject: course.subject,
      grade: course.grade,
      curriculumFramework: course.curriculumFramework,
    },
    lessons: course.lessons,
  }
}

/**
 * Snapshot seeded from a published scope document — used when the registry
 * has no course under the requested name but the user picked one of the
 * app's completed scopes as the course to edit. The scope's lesson ids
 * ("U3.L3") become the platform lesson ids; the fourteen card fields map onto
 * the ten DM-bound scope fields by content. `courseExists` is true: the
 * course conceptually exists (we are editing it), so the run's operation is
 * UPDATE and its lessons are matchable for UPDATE/DEACTIVATE.
 */
export function snapshotFromScope(
  courseContext: LsgRun['courseContext'],
  scope: Scope,
): LsgSnapshot {
  let order = 0
  const lessons: LsgCourseLesson[] = scope.units.flatMap((unit) =>
    unit.lessons.map((l) => {
      order++
      const f = l.fields
      // Field 1 format is "<CODE> — <verbatim wording>" — the code is the part before the dash.
      const standardId = (f.standards.content.split('—')[0] ?? '').trim().slice(0, 80)
      return {
        lessonId: l.id,
        unitName: unit.title,
        // The platform lessonTitle is the STUDENT-FACING title, matching the
        // scope JSON export exactly — the registry's (unitName, lessonTitle)
        // identity keys must agree with what exports/DM uploads carry, or a
        // re-import of the same scope mass-deactivates and duplicates every
        // lesson. Legacy scopes without the field keep the engineering title.
        lessonTitle: (l.studentFriendlyTitle ?? '').trim() || l.title,
        standardId,
        lessonOrder: order,
        status: 'ACTIVE' as const,
        objectives: f.objectives?.content ?? '',
        assessmentBoundary: f.boundary.content,
        difficultyCeiling: f.ceiling.content,
        prerequisites: f.prerequisites.content,
        progressionPlacement: f.progression.content,
        newLearning: f.newLearning.content,
        instructionalApproach: f.approach.content,
        nonGoals: f.nonGoals.content,
        assessmentEvidence: f.assessment.content,
        releasedItems: f.releasedItems.content,
      }
    }),
  )
  return seededSnapshot(courseContext, lessons)
}

/**
 * MECHANICAL registry import from a published scope — no generation, no
 * Claude call. The scope's lessons (the snapshotFromScope card-field mapping)
 * become the course's ACTIVE lesson set under full-course semantics:
 * existing lessons matched by (unitName, lessonTitle) keep their platform
 * lessonIds and take the scope's field content; unmatched scope lessons are
 * CREATED with fresh platform ids; previously ACTIVE lessons absent from the
 * scope are DEACTIVATED (never deleted). This is how the registry catches up
 * with a regenerated scope instantly — the Video Script Generator reads the
 * registry, and a stale course (e.g. 97 lessons against a 224-lesson
 * regenerated scope) would otherwise need a full paid LSG run to refresh.
 */
export async function importScopeIntoRegistry(
  courseContext: LsgRun['courseContext'],
  standardSet: string,
  scope: Scope,
): Promise<LsgCourse> {
  const snapshot = snapshotFromScope(courseContext, scope)
  const courseId = courseIdFromName(courseContext.courseName)
  const now = nowIso()
  const existing = await getLsgCourseOrUndefined(courseId)
  if (!existing) {
    const course: LsgCourse = {
      courseId,
      courseName: courseContext.courseName,
      subject: courseContext.subject,
      grade: courseContext.grade,
      curriculumFramework: courseContext.curriculumFramework,
      standardSet,
      lessons: snapshot.lessons.map((l) => ({ ...l, lessonId: newId('lesson') })),
      created: now,
      updated: now,
    }
    // Create-only: a concurrent LSG-run apply (or a double-clicked import)
    // observing "not exists" at the same moment must not be clobbered — the
    // loser falls through to the ETag-protected mutate path below.
    if (await putJsonIfAbsent(dataContainer(), courseBlobPath(courseId), course)) {
      await upsertCourseRow(course)
      return course
    }
  }
  return mutateLsgCourse(courseId, (course) => {
    const keyOf = (unitName: string, lessonTitle: string) => `${unitName}|${lessonTitle}`.trim().toLowerCase()
    // SYMMETRIC suffix keying on both sides: duplicate (unit, title) pairs —
    // in the incoming scope or already in the registry — each keep their own
    // row, and RE-imports converge onto the same rows instead of creating a
    // fresh duplicate per import.
    const suffixed = (base: string, seen: Map<string, number>): string => {
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return n === 1 ? base : `${base}#${n}`
    }
    const byKey = new Map<string, LsgCourseLesson>()
    const existingKeys = new Map<LsgCourseLesson, string>()
    const seenExisting = new Map<string, number>()
    for (const l of course.lessons) {
      const k = suffixed(keyOf(l.unitName, l.lessonTitle), seenExisting)
      existingKeys.set(l, k)
      byKey.set(k, l)
    }
    const importedKeys = new Set<string>()
    const seenIncoming = new Map<string, number>()
    for (const inc of snapshot.lessons) {
      const key = suffixed(keyOf(inc.unitName, inc.lessonTitle), seenIncoming)
      importedKeys.add(key)
      const cur = byKey.get(key)
      if (cur) {
        // The platform owns lesson identity — keep the id, take the content.
        Object.assign(cur, { ...inc, lessonId: cur.lessonId, status: 'ACTIVE' as const })
      } else {
        const created: LsgCourseLesson = { ...inc, lessonId: newId('lesson') }
        course.lessons.push(created)
        byKey.set(key, created)
      }
    }
    for (const l of course.lessons) {
      const k = existingKeys.get(l)
      if (k !== undefined && l.status === 'ACTIVE' && !importedKeys.has(k)) l.status = 'INACTIVE'
    }
    course.lessons.sort((a, b) =>
      a.status === b.status ? a.lessonOrder - b.lessonOrder : a.status === 'ACTIVE' ? -1 : 1,
    )
    if (standardSet) course.standardSet = standardSet
    if (courseContext.subject) course.subject = courseContext.subject
    if (courseContext.grade) course.grade = courseContext.grade
    if (courseContext.curriculumFramework) course.curriculumFramework = courseContext.curriculumFramework
    // Same slug by construction (the caller resolved courseId from this
    // name) — refreshing repairs display-name drift, e.g. a mangled em dash
    // from a non-UTF-8 client.
    course.courseName = courseContext.courseName
    course.updated = now
  })
}

/** Snapshot seeded from an uploaded existing data model (rows already normalized/capped by the HTTP layer). */
export function snapshotFromDataModel(
  courseContext: LsgRun['courseContext'],
  rows: LsgDataModelLesson[],
): LsgSnapshot {
  const lessons: LsgCourseLesson[] = rows.map((row, i) => ({
    lessonId: `dm-${i + 1}`,
    unitName: row.unitName,
    lessonTitle: row.lessonTitle,
    standardId: row.standardId,
    lessonOrder: row.lessonOrder > 0 ? row.lessonOrder : i + 1,
    status: 'ACTIVE' as const,
    objectives: row.objectives,
    assessmentBoundary: row.assessmentBoundary,
    difficultyCeiling: row.difficultyCeiling,
    prerequisites: row.prerequisites,
    progressionPlacement: row.progressionPlacement,
    newLearning: row.newLearning,
    instructionalApproach: row.instructionalApproach,
    nonGoals: row.nonGoals,
    assessmentEvidence: row.assessmentEvidence,
    releasedItems: row.releasedItems,
  }))
  return seededSnapshot(courseContext, lessons)
}

function seededSnapshot(courseContext: LsgRun['courseContext'], lessons: LsgCourseLesson[]): LsgSnapshot {
  return {
    courseExists: true,
    course: {
      courseId: courseIdFromName(courseContext.courseName),
      courseName: courseContext.courseName,
      subject: courseContext.subject,
      grade: courseContext.grade,
      curriculumFramework: courseContext.curriculumFramework,
    },
    lessons,
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function saveLsgRun(run: LsgRun): Promise<void> {
  await putJson(dataContainer(), runBlobPath(run.id), run)
  await upsertRunRow(run)
}

async function upsertRunRow(run: LsgRun): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'lsg-run',
      rowKey: run.id,
      courseName: run.courseContext.courseName,
      status: run.status,
      updated: run.updated,
      blobPath: runBlobPath(run.id),
    },
    'Replace',
  )
}

/** Read–modify–write with ETag optimistic concurrency (worker vs HTTP mutations). */
export async function mutateLsgRun(id: string, fn: (run: LsgRun) => void): Promise<LsgRun> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<LsgRun>(dataContainer(), runBlobPath(id))
    if (!found) throw new HttpError(404, `lesson scope run ${id} not found`)
    const run = found.doc
    fn(run)
    try {
      await putJsonIfMatch(dataContainer(), runBlobPath(id), run, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertRunRow(run)
    return run
  }
  throw new Error(`lesson scope run ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getLsgRunOrUndefined(id: string): Promise<LsgRun | undefined> {
  return getJsonOrUndefined<LsgRun>(dataContainer(), runBlobPath(id))
}

export async function getLsgRun(id: string): Promise<LsgRun> {
  const run = await getLsgRunOrUndefined(id)
  if (!run) throw new HttpError(404, `lesson scope run ${id} not found`)
  return run
}

export async function listLsgRuns(): Promise<LsgRun[]> {
  return listLsgDocs<LsgRun>('lsg-run', getLsgRunOrUndefined)
}

export async function deleteLsgRunDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(runBlobPath(id)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('lsg-run', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

export function toLsgRunSummary(run: LsgRun): LsgRunSummary {
  const summary: LsgRunSummary = {
    id: run.id,
    requestType: run.requestType,
    courseName: run.courseContext.courseName,
    mode: run.generationScope.mode,
    status: run.status,
    lessonCount: run.output?.lessons.length ?? 0,
    created: run.created,
    updated: run.updated,
  }
  if (run.error !== undefined) summary.error = run.error
  return summary
}

// ---------------------------------------------------------------------------

async function listLsgDocs<T>(
  partition: 'lsg-course' | 'lsg-run',
  fetch: (id: string) => Promise<T | undefined>,
): Promise<T[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${partition}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => fetch(id)))
  // Self-healing sweep (mirrors listPackets): a checkpoint upsert can race a
  // DELETE and re-insert the row after the blob is gone.
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity(partition, id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is Awaited<T> => d !== undefined)
}
