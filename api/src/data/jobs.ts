import { odata, TableEntityResult } from '@azure/data-tables'
import { JobKind, JobStatus } from '../domain/types'
import { HttpError } from '../shared/errors'
import { nowIso, sleep } from '../shared/util'
import { jobsTable } from './clients'

/** Full job row (JobStatus plus coordination fields not exposed over HTTP). */
export interface JobRecord extends JobStatus {
  scopeId?: string
  setId?: string
  packetId?: string
  lsgRunId?: string
  vsgRunId?: string
  created: string
  /** comma-separated unit indexes already counted — makes unit increments idempotent */
  unitsMask?: string
  /** JSON string[] of upload blob names already extracted — resumability across the 10-minute execution cap */
  doneBlobs?: string
}

const LOG_CAP = 40

type EntityShape = Record<string, unknown> & { partitionKey: string; rowKey: string }

function toEntity(r: JobRecord): EntityShape {
  const e: EntityShape = {
    partitionKey: 'job',
    rowKey: r.jobId,
    kind: r.kind,
    status: r.status,
    stage: r.stage,
    stagesDone: r.stagesDone,
    totalStages: r.totalStages,
    created: r.created,
    logJson: JSON.stringify(r.log.slice(-LOG_CAP)),
  }
  if (r.scopeId !== undefined) e.scopeId = r.scopeId
  if (r.setId !== undefined) e.setId = r.setId
  if (r.packetId !== undefined) e.packetId = r.packetId
  if (r.lsgRunId !== undefined) e.lsgRunId = r.lsgRunId
  if (r.vsgRunId !== undefined) e.vsgRunId = r.vsgRunId
  if (r.unitsDone !== undefined) e.unitsDone = r.unitsDone
  if (r.totalUnits !== undefined) e.totalUnits = r.totalUnits
  if (r.unitsMask !== undefined) e.unitsMask = r.unitsMask
  if (r.error !== undefined) e.error = r.error
  if (r.cancelRequested !== undefined) e.cancelRequested = r.cancelRequested
  if (r.doneBlobs !== undefined) e.doneBlobs = r.doneBlobs
  return e
}

function fromEntity(e: TableEntityResult<Record<string, unknown>>): JobRecord {
  let log: JobRecord['log'] = []
  try {
    log = e.logJson ? (JSON.parse(String(e.logJson)) as JobRecord['log']) : []
  } catch {
    log = []
  }
  const rec: JobRecord = {
    jobId: String(e.rowKey ?? ''),
    kind: String(e.kind ?? 'generate') as JobKind,
    status: String(e.status ?? 'queued') as JobRecord['status'],
    stage: String(e.stage ?? ''),
    stagesDone: Number(e.stagesDone ?? 0),
    totalStages: Number(e.totalStages ?? 1),
    created: String(e.created ?? ''),
    log,
  }
  if (e.scopeId !== undefined) rec.scopeId = String(e.scopeId)
  if (e.cancelRequested !== undefined) rec.cancelRequested = Boolean(e.cancelRequested)
  if (e.doneBlobs !== undefined) rec.doneBlobs = String(e.doneBlobs)
  if (e.setId !== undefined) rec.setId = String(e.setId)
  if (e.packetId !== undefined) rec.packetId = String(e.packetId)
  if (e.lsgRunId !== undefined) rec.lsgRunId = String(e.lsgRunId)
  if (e.vsgRunId !== undefined) rec.vsgRunId = String(e.vsgRunId)
  if (e.unitsDone !== undefined) rec.unitsDone = Number(e.unitsDone)
  if (e.totalUnits !== undefined) rec.totalUnits = Number(e.totalUnits)
  if (e.unitsMask !== undefined) rec.unitsMask = String(e.unitsMask)
  if (e.error !== undefined) rec.error = String(e.error)
  return rec
}

export function pushLog(rec: JobRecord, detail: string): void {
  rec.log.push({ at: nowIso(), stage: rec.stage, detail })
  if (rec.log.length > LOG_CAP) rec.log = rec.log.slice(-LOG_CAP)
}

export async function createJob(init: {
  jobId: string
  kind: JobKind
  scopeId?: string
  setId?: string
  packetId?: string
  lsgRunId?: string
  vsgRunId?: string
  totalStages: number
  stage: string
  detail: string
}): Promise<JobRecord> {
  const rec: JobRecord = {
    jobId: init.jobId,
    kind: init.kind,
    status: 'queued',
    stage: init.stage,
    stagesDone: 0,
    totalStages: init.totalStages,
    created: nowIso(),
    log: [],
  }
  if (init.scopeId !== undefined) rec.scopeId = init.scopeId
  if (init.setId !== undefined) rec.setId = init.setId
  if (init.packetId !== undefined) rec.packetId = init.packetId
  if (init.lsgRunId !== undefined) rec.lsgRunId = init.lsgRunId
  if (init.vsgRunId !== undefined) rec.vsgRunId = init.vsgRunId
  pushLog(rec, init.detail)
  await jobsTable().createEntity(toEntity(rec))
  return rec
}

export async function getJob(jobId: string): Promise<JobRecord> {
  try {
    const e = await jobsTable().getEntity('job', jobId)
    return fromEntity(e as TableEntityResult<Record<string, unknown>>)
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404) throw new HttpError(404, `job ${jobId} not found`)
    throw err
  }
}

/**
 * Read–modify–replace with ETag optimistic concurrency (contract §Storage layout):
 * parallel unit workers race on the same row, so every mutation re-reads the
 * entity, applies `fn`, and writes with `updateEntity(..., 'Replace', { etag })`.
 * A 412 (precondition failed) retries up to 10 times with a small backoff.
 */
export async function mutateJob(jobId: string, fn: (rec: JobRecord) => void): Promise<JobRecord> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await jobsTable().getEntity('job', jobId)
    const rec = fromEntity(raw as TableEntityResult<Record<string, unknown>>)
    fn(rec)
    try {
      await jobsTable().updateEntity(toEntity(rec), 'Replace', { etag: raw.etag })
      return rec
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
    }
  }
  throw new Error(`job ${jobId}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

/**
 * Marks one unit's cards checkpoint as complete (idempotent via unitsMask) and
 * reports whether the post-mutation state has ALL units done. At-least-once
 * signaling: a redelivered last-unit message (or an SDK retry after the commit)
 * must still see `reachedTotal: true`, so the finalize signal is never
 * swallowed — the finalize step itself is idempotent and tolerates duplicates.
 */
export async function completeUnit(
  jobId: string,
  unitIndex: number,
  detail: string,
): Promise<{ rec: JobRecord; reachedTotal: boolean }> {
  let reachedTotal = false
  const rec = await mutateJob(jobId, (r) => {
    const mask = new Set(
      (r.unitsMask ?? '')
        .split(',')
        .filter((s) => s.length > 0)
        .map((s) => Number(s)),
    )
    if (!mask.has(unitIndex)) {
      mask.add(unitIndex)
      r.unitsDone = mask.size
      r.unitsMask = [...mask].sort((a, b) => a - b).join(',')
      pushLog(r, detail)
    }
    reachedTotal = r.totalUnits !== undefined && mask.size === r.totalUnits
  })
  return { rec, reachedTotal }
}

export async function latestJobForScope(scopeId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and scopeId eq ${scopeId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

/** Latest QC job for a scope — the QC DELETE flags it cancelRequested so a mid-flight run discards its results. */
export async function latestQcJobForScope(scopeId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and scopeId eq ${scopeId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (rec.kind !== 'qc') continue
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

/** Mirrors latestJobForScope for set-bound jobs (ingest) — used to make publish idempotent. */
export async function latestJobForSet(setId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and setId eq ${setId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

/** Mirrors latestJobForLsgRun for VSG-run-bound jobs (Video Script Generator). */
export async function latestJobForVsgRun(vsgRunId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and vsgRunId eq ${vsgRunId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

/** Mirrors latestJobForScope for LSG-run-bound jobs (Lesson Scope Generation). */
export async function latestJobForLsgRun(lsgRunId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and lsgRunId eq ${lsgRunId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

/** Mirrors latestJobForScope for packet-bound jobs (the web-hunting agent). */
export async function latestJobForPacket(packetId: string): Promise<JobRecord | undefined> {
  const filter = odata`PartitionKey eq ${'job'} and packetId eq ${packetId}`
  let latest: JobRecord | undefined
  for await (const e of jobsTable().listEntities({ queryOptions: { filter } })) {
    const rec = fromEntity(e as TableEntityResult<Record<string, unknown>>)
    if (!latest || rec.created > latest.created) latest = rec
  }
  return latest
}

export function toJobStatus(rec: JobRecord): JobStatus {
  const status: JobStatus = {
    jobId: rec.jobId,
    kind: rec.kind,
    status: rec.status,
    stage: rec.stage,
    stagesDone: rec.stagesDone,
    totalStages: rec.totalStages,
    log: rec.log,
  }
  if (rec.unitsDone !== undefined) status.unitsDone = rec.unitsDone
  if (rec.totalUnits !== undefined) status.totalUnits = rec.totalUnits
  if (rec.error !== undefined) status.error = rec.error
  if (rec.cancelRequested !== undefined) status.cancelRequested = rec.cancelRequested
  return status
}
