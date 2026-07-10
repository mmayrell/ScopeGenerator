import { odata } from '@azure/data-tables'
import { VideoScript, VsgRun, VsgRunSummary } from '../domain/types'
import { HttpError } from '../shared/errors'
import { sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// Video Script Generator storage (contract §Storage layout):
//   vsg/runs/<runId>.json                      current VsgRun (per-lesson statuses + conflicts)
//   vsg/scripts/<courseId>/<lessonId>.json     latest VideoScript per (course, lesson), versioned
// Courses are NOT stored here — the VSG reads the LSG course registry.

const runBlobPath = (id: string) => `vsg/runs/${id}.json`
const scriptBlobPath = (courseId: string, lessonId: string) => `vsg/scripts/${courseId}/${lessonId}.json`

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function saveVsgRun(run: VsgRun): Promise<void> {
  await putJson(dataContainer(), runBlobPath(run.id), run)
  await upsertRunRow(run)
}

async function upsertRunRow(run: VsgRun): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'vsg-run',
      rowKey: run.id,
      courseName: run.courseName,
      status: run.status,
      updated: run.updated,
      blobPath: runBlobPath(run.id),
    },
    'Replace',
  )
}

/** Read–modify–write with ETag optimistic concurrency (worker vs HTTP reconcile/regenerate). */
export async function mutateVsgRun(id: string, fn: (run: VsgRun) => void): Promise<VsgRun> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<VsgRun>(dataContainer(), runBlobPath(id))
    if (!found) throw new HttpError(404, `video script run ${id} not found`)
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
  throw new Error(`video script run ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getVsgRunOrUndefined(id: string): Promise<VsgRun | undefined> {
  return getJsonOrUndefined<VsgRun>(dataContainer(), runBlobPath(id))
}

export async function getVsgRun(id: string): Promise<VsgRun> {
  const run = await getVsgRunOrUndefined(id)
  if (!run) throw new HttpError(404, `video script run ${id} not found`)
  return run
}

export async function listVsgRuns(): Promise<VsgRun[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${'vsg-run'}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => getVsgRunOrUndefined(id)))
  // Self-healing sweep (mirrors listLsgDocs): a checkpoint upsert can race a
  // DELETE and re-insert the row after the blob is gone.
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity('vsg-run', id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is VsgRun => d !== undefined)
}

export async function deleteVsgRunDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(runBlobPath(id)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('vsg-run', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

export function toVsgRunSummary(run: VsgRun): VsgRunSummary {
  const summary: VsgRunSummary = {
    id: run.id,
    courseName: run.courseName,
    status: run.status,
    lessonCount: run.lessons.length,
    completeCount: run.lessons.filter((l) => l.status === 'complete').length,
    needsReconciliationCount: run.lessons.filter((l) => l.status === 'needs-reconciliation').length,
    created: run.created,
    updated: run.updated,
  }
  if (run.error !== undefined) summary.error = run.error
  return summary
}

// ---------------------------------------------------------------------------
// Scripts — one blob per (course, lesson), latest version wins; the version
// counter increments on every save so regenerations are traceable.
// ---------------------------------------------------------------------------

export async function getVideoScriptOrUndefined(
  courseId: string,
  lessonId: string,
): Promise<VideoScript | undefined> {
  return getJsonOrUndefined<VideoScript>(dataContainer(), scriptBlobPath(courseId, lessonId))
}

export async function saveVideoScript(script: VideoScript): Promise<void> {
  await putJson(dataContainer(), scriptBlobPath(script.courseId, script.lessonId), script)
}
