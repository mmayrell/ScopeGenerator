import { odata } from '@azure/data-tables'
import { QcBar, QcDeck, QcInvestigationLog, QcNoteLedger, QcReport, QcReportSummary } from '../domain/types'
import { HttpError } from '../shared/errors'
import { nowIso, sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { DEFAULT_CRITERIA, DEFAULT_DECK, DEFAULT_PLAN } from './qc-defaults'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// QC Bar storage (contract §Quality Control):
//   qc/bar.json                       THE bar — criteria + escalation plan, versioned on save
//   qc/deck.json                      the test deck of deliberately broken cards
//   qc/reports/<scopeId>.json         the scope's QC Report (generation writes it; sweeps overwrite)
//   qc/notes/<scopeId>.json           the note ledger — persists across reports
//   qc/investigations/<scopeId>.json  investigation log
// Concurrent writers exist (generation checkpoints vs HTTP edits), so updates
// to existing docs go through the ETag mutate helpers.

const barPath = 'qc/bar.json'
const deckPath = 'qc/deck.json'
const reportBlobPath = (scopeId: string) => `qc/reports/${scopeId}.json`
const notesBlobPath = (scopeId: string) => `qc/notes/${scopeId}.json`
const invBlobPath = (scopeId: string) => `qc/investigations/${scopeId}.json`

// ---------------------------------------------------------------------------
// The Bar + the deck — singletons, created from the factory defaults on first
// read. The stored document is the authority from its first save.
// ---------------------------------------------------------------------------

const defaultBar = (): QcBar => ({ barVersion: 1, criteria: DEFAULT_CRITERIA, escalationPlan: DEFAULT_PLAN, updated: nowIso() })
const defaultDeck = (): QcDeck => ({ cards: DEFAULT_DECK, updated: nowIso() })

export async function getBar(): Promise<QcBar> {
  return (await getJsonOrUndefined<QcBar>(dataContainer(), barPath)) ?? defaultBar()
}

/** ETag mutate; creates from defaults if absent. Bumps barVersion unless the mutation says otherwise (stats accumulation must NOT bump). */
export async function mutateBar(fn: (bar: QcBar) => void, opts?: { bumpVersion?: boolean }): Promise<QcBar> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcBar>(dataContainer(), barPath)
    const bar = found?.doc ?? defaultBar()
    fn(bar)
    if (opts?.bumpVersion !== false) bar.barVersion += 1
    bar.updated = nowIso()
    try {
      if (found) await putJsonIfMatch(dataContainer(), barPath, bar, found.etag)
      else await putJson(dataContainer(), barPath, bar)
      return bar
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`QC bar: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getDeck(): Promise<QcDeck> {
  return (await getJsonOrUndefined<QcDeck>(dataContainer(), deckPath)) ?? defaultDeck()
}

export async function mutateDeck(fn: (deck: QcDeck) => void): Promise<QcDeck> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcDeck>(dataContainer(), deckPath)
    const deck = found?.doc ?? defaultDeck()
    fn(deck)
    deck.updated = nowIso()
    try {
      if (found) await putJsonIfMatch(dataContainer(), deckPath, deck, found.etag)
      else await putJson(dataContainer(), deckPath, deck)
      return deck
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`QC deck: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function upsertReportRow(report: QcReport): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'qcreport',
      rowKey: report.scopeId,
      scopeTitle: report.scopeTitle,
      status: report.status,
      origin: report.origin,
      updated: report.updated,
      blobPath: reportBlobPath(report.scopeId),
    },
    'Replace',
  )
}

export async function saveQcReport(report: QcReport): Promise<void> {
  await putJson(dataContainer(), reportBlobPath(report.scopeId), report)
  await upsertReportRow(report)
}

/** Read–modify–write with ETag optimistic concurrency. Throws 404 when no report exists. */
export async function mutateQcReport(scopeId: string, fn: (report: QcReport) => void): Promise<QcReport> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcReport>(dataContainer(), reportBlobPath(scopeId))
    if (!found) throw new HttpError(404, `no QC report for scope ${scopeId}`)
    const report = found.doc
    fn(report)
    report.updated = nowIso()
    try {
      await putJsonIfMatch(dataContainer(), reportBlobPath(scopeId), report, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertReportRow(report)
    return report
  }
  throw new Error(`QC report ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getQcReportOrUndefined(scopeId: string): Promise<QcReport | undefined> {
  return getJsonOrUndefined<QcReport>(dataContainer(), reportBlobPath(scopeId))
}

export async function listQcReports(): Promise<QcReport[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${'qcreport'}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => getQcReportOrUndefined(id)))
  // Self-healing sweep: an upsert can race a DELETE and re-insert the row.
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity('qcreport', id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is QcReport => d !== undefined)
}

export async function deleteQcDocs(scopeId: string): Promise<void> {
  await Promise.all([
    dataContainer().getBlockBlobClient(reportBlobPath(scopeId)).deleteIfExists(),
    dataContainer().getBlockBlobClient(notesBlobPath(scopeId)).deleteIfExists(),
    dataContainer().getBlockBlobClient(invBlobPath(scopeId)).deleteIfExists(),
    // Legacy four-gate era blobs — same permanent-delete semantics.
    dataContainer().getBlockBlobClient(`qc/runs/${scopeId}.json`).deleteIfExists(),
    dataContainer().getBlockBlobClient(`qc/flags/${scopeId}.json`).deleteIfExists(),
  ])
  for (const partition of ['qcreport', 'qcrun']) {
    try {
      await entitiesTable().deleteEntity(partition, scopeId)
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status !== 404) throw e
    }
  }
}

// ---------------------------------------------------------------------------
// Note ledger — persists across reports; created lazily on the first note.
// ---------------------------------------------------------------------------

export async function getNoteLedger(scopeId: string): Promise<QcNoteLedger> {
  return (
    (await getJsonOrUndefined<QcNoteLedger>(dataContainer(), notesBlobPath(scopeId))) ?? {
      scopeId,
      notes: [],
      updated: nowIso(),
    }
  )
}

/** ETag mutate; creates the ledger if absent (notes cost nothing to leave). */
export async function mutateNoteLedger(scopeId: string, fn: (ledger: QcNoteLedger) => void): Promise<QcNoteLedger> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<QcNoteLedger>(dataContainer(), notesBlobPath(scopeId))
    const ledger = found?.doc ?? { scopeId, notes: [], updated: nowIso() }
    fn(ledger)
    ledger.updated = nowIso()
    try {
      if (found) await putJsonIfMatch(dataContainer(), notesBlobPath(scopeId), ledger, found.etag)
      else await putJson(dataContainer(), notesBlobPath(scopeId), ledger)
      return ledger
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`note ledger ${scopeId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
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

export function toQcReportSummary(report: QcReport, openNoteCount: number): QcReportSummary {
  return {
    scopeId: report.scopeId,
    scopeTitle: report.scopeTitle,
    origin: report.origin,
    status: report.status,
    barVersion: report.barVersion,
    lessonCount: report.lessons.length,
    passedFirstTry: report.passedFirstTry,
    redFlagCount: report.redFlagCount,
    advisoryCount: report.advisoryCount,
    openNoteCount,
    updated: report.updated,
  }
}
