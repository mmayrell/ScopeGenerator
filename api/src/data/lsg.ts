import { odata } from '@azure/data-tables'
import { LsgCourse, LsgRun, LsgRunSummary, LsgSnapshot } from '../domain/types'
import { HttpError } from '../shared/errors'
import { sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

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
