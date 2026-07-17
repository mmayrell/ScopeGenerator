import { odata } from '@azure/data-tables'
import { QcFlagLedger, QcInvestigationLog, QcRun, QcRunSummary } from '../domain/types'
import { HttpError } from '../shared/errors'
import { nowIso, sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// Quality Control storage (contract §Storage layout):
//   qc/runs/<scopeId>.json            the scope's current QC Report (re-runs overwrite)
//   qc/flags/<scopeId>.json           the Flag Ledger — persists across runs
//   qc/investigations/<scopeId>.json  investigation log (appended per run)
// Everything is READ-ONLY with respect to the scope documents themselves.
// Concurrent writers exist (worker checkpoints vs HTTP flag/decision writes),
// so updates to existing docs go through the ETag mutate helpers.

const runBlobPath = (scopeId: string) => `qc/runs/${scopeId}.json`
const flagsBlobPath = (scopeId: string) => `qc/flags/${scopeId}.json`
const invBlobPath = (scopeId: string) => `qc/investigations/${scopeId}.json`

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function upsertRunRow(run: QcRun): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'qcrun',
      rowKey: run.scopeId,
      scopeTitle: run.scopeTitle,
      status: run.status,
      verdict: run.verdict,
      updated: run.updated,
      blobPath: runBlobPath(run.scopeId),
    },
    'Replace',
  )
}

export async function saveQcRun(run: QcRun): Promise<void> {
  await putJson(dataContainer(), runBlobPath(run.scopeId), run)
  await upsertRunRow(run)
}

/** Read–modify–write with ETag optimistic concurrency. Throws 404 when no run exists. */
export async function mutateQcRun(scopeId: string, fn: (run: QcRun) => void): Promise<QcRun> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcRun>(dataContainer(), runBlobPath(scopeId))
    if (!found) throw new HttpError(404, `no QC run for scope ${scopeId}`)
    const run = found.doc
    fn(run)
    try {
      await putJsonIfMatch(dataContainer(), runBlobPath(scopeId), run, found.etag)
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
  throw new Error(`QC run ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getQcRunOrUndefined(scopeId: string): Promise<QcRun | undefined> {
  return getJsonOrUndefined<QcRun>(dataContainer(), runBlobPath(scopeId))
}

export async function listQcRuns(): Promise<QcRun[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${'qcrun'}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => getQcRunOrUndefined(id)))
  // Self-healing sweep: an upsert can race a DELETE and re-insert the row
  // after the blob is gone.
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity('qcrun', id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is QcRun => d !== undefined)
}

export async function deleteQcDocs(scopeId: string): Promise<void> {
  await Promise.all([
    dataContainer().getBlockBlobClient(runBlobPath(scopeId)).deleteIfExists(),
    dataContainer().getBlockBlobClient(flagsBlobPath(scopeId)).deleteIfExists(),
    dataContainer().getBlockBlobClient(invBlobPath(scopeId)).deleteIfExists(),
  ])
  try {
    await entitiesTable().deleteEntity('qcrun', scopeId)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

// ---------------------------------------------------------------------------
// Flag Ledger — persists across runs; created lazily on the first flag.
// ---------------------------------------------------------------------------

export async function getFlagLedger(scopeId: string): Promise<QcFlagLedger> {
  return (
    (await getJsonOrUndefined<QcFlagLedger>(dataContainer(), flagsBlobPath(scopeId))) ?? {
      scopeId,
      flags: [],
      updated: nowIso(),
    }
  )
}

/** ETag mutate; creates the ledger if absent (flags cost nothing to raise). */
export async function mutateFlagLedger(scopeId: string, fn: (ledger: QcFlagLedger) => void): Promise<QcFlagLedger> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcFlagLedger>(dataContainer(), flagsBlobPath(scopeId))
    const ledger = found?.doc ?? { scopeId, flags: [], updated: nowIso() }
    fn(ledger)
    ledger.updated = nowIso()
    try {
      if (found) await putJsonIfMatch(dataContainer(), flagsBlobPath(scopeId), ledger, found.etag)
      else await putJson(dataContainer(), flagsBlobPath(scopeId), ledger)
      return ledger
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`flag ledger ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

// ---------------------------------------------------------------------------
// Investigations — an append-mostly per-scope log.
// ---------------------------------------------------------------------------

export async function getInvestigationLog(scopeId: string): Promise<QcInvestigationLog> {
  return (
    (await getJsonOrUndefined<QcInvestigationLog>(dataContainer(), invBlobPath(scopeId))) ?? {
      scopeId,
      investigations: [],
      updated: nowIso(),
    }
  )
}

/** ETag mutate; creates the log if absent. */
export async function mutateInvestigationLog(
  scopeId: string,
  fn: (log: QcInvestigationLog) => void,
): Promise<QcInvestigationLog> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcInvestigationLog>(dataContainer(), invBlobPath(scopeId))
    const log = found?.doc ?? { scopeId, investigations: [], updated: nowIso() }
    fn(log)
    log.updated = nowIso()
    try {
      if (found) await putJsonIfMatch(dataContainer(), invBlobPath(scopeId), log, found.etag)
      else await putJson(dataContainer(), invBlobPath(scopeId), log)
      return log
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`investigation log ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

// ---------------------------------------------------------------------------

export function toQcRunSummary(run: QcRun, openFlagCount: number): QcRunSummary {
  return {
    scopeId: run.scopeId,
    scopeTitle: run.scopeTitle,
    status: run.status,
    verdict: run.verdict,
    findingCount: run.findings.length,
    blockingCount: run.findings.filter((f) => f.severity === 'blocking').length,
    quarantinedCount: run.quarantinedCards.length,
    openFlagCount,
    updated: run.updated,
  }
}
