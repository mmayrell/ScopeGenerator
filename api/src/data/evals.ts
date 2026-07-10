import { odata } from '@azure/data-tables'
import { ScopeEvaluation, ScopeEvaluationSummary } from '../domain/types'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, putJson } from './blobs'

// Scope Evaluations storage: one blob per scope (latest evaluation wins —
// re-evaluations overwrite), indexed for listing. Blob layout (contract
// §Storage layout): evals/records/<scopeId>.json + evals/config.json (the
// webhook config, owned by services/evalsheet).

const evalBlobPath = (scopeId: string) => `evals/records/${scopeId}.json`

export async function saveEvaluation(ev: ScopeEvaluation): Promise<void> {
  await putJson(dataContainer(), evalBlobPath(ev.scopeId), ev)
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'eval',
      rowKey: ev.scopeId,
      scopeTitle: ev.scopeTitle,
      autoVerdict: ev.autoVerdict,
      exportStatus: ev.exportStatus,
      updated: ev.updated,
      blobPath: evalBlobPath(ev.scopeId),
    },
    'Replace',
  )
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
    exportStatus: ev.exportStatus,
    updated: ev.updated,
  }
  if (ev.exportError !== undefined) summary.exportError = ev.exportError
  return summary
}
