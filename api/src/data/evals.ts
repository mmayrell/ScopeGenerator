import { odata } from '@azure/data-tables'
import { ScopeEvaluation, ScopeEvaluationSummary } from '../domain/types'
import { HttpError } from '../shared/errors'
import { sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// Scope Evaluations storage: one blob per scope (latest evaluation wins —
// re-evaluations overwrite, preserving the SME fields), indexed for listing.
// Blob layout (contract §Storage layout): evals/records/<scopeId>.json.
// Concurrent writers exist (the worker's re-evaluation vs the SME's PUT), so
// updates to an EXISTING record go through mutateEvaluation (ETag retry) —
// plain saveEvaluation is for creation only.

const evalBlobPath = (scopeId: string) => `evals/records/${scopeId}.json`

async function upsertEvalRow(ev: ScopeEvaluation): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'eval',
      rowKey: ev.scopeId,
      scopeTitle: ev.scopeTitle,
      autoVerdict: ev.autoVerdict,
      updated: ev.updated,
      blobPath: evalBlobPath(ev.scopeId),
    },
    'Replace',
  )
}

export async function saveEvaluation(ev: ScopeEvaluation): Promise<void> {
  await putJson(dataContainer(), evalBlobPath(ev.scopeId), ev)
  await upsertEvalRow(ev)
}

/** Read–modify–write with ETag optimistic concurrency (worker save vs SME PUT). Throws 404 when no record exists. */
export async function mutateEvaluation(scopeId: string, fn: (ev: ScopeEvaluation) => void): Promise<ScopeEvaluation> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<ScopeEvaluation>(dataContainer(), evalBlobPath(scopeId))
    if (!found) throw new HttpError(404, `no evaluation for scope ${scopeId}`)
    const ev = found.doc
    fn(ev)
    try {
      await putJsonIfMatch(dataContainer(), evalBlobPath(scopeId), ev, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertEvalRow(ev)
    return ev
  }
  throw new Error(`evaluation ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getEvaluationOrUndefined(scopeId: string): Promise<ScopeEvaluation | undefined> {
  return getJsonOrUndefined<ScopeEvaluation>(dataContainer(), evalBlobPath(scopeId))
}

export async function listEvaluations(): Promise<ScopeEvaluation[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${'eval'}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => getEvaluationOrUndefined(id)))
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity('eval', id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is ScopeEvaluation => d !== undefined)
}

export async function deleteEvaluationDocs(scopeId: string): Promise<void> {
  await dataContainer().getBlockBlobClient(evalBlobPath(scopeId)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('eval', scopeId)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

export function toEvaluationSummary(ev: ScopeEvaluation): ScopeEvaluationSummary {
  const summary: ScopeEvaluationSummary = {
    scopeId: ev.scopeId,
    scopeTitle: ev.scopeTitle,
    autoVerdict: ev.autoVerdict,
    failCount: ev.failCount,
    hardGateFails: ev.hardGateFails,
    averageScore: ev.averageScore,
    updated: ev.updated,
  }
  if (ev.smeVerdict !== undefined && ev.smeVerdict !== '') summary.smeVerdict = ev.smeVerdict
  return summary
}
