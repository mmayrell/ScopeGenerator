import { QcFlag, QcFlagType, QcInvestigation, QcLocation, QcRepairDecision } from '../domain/types'
import { getScope } from '../data/entities'
import {
  deleteQcDocs,
  getFlagLedger,
  getInvestigationLog,
  getQcRunOrUndefined,
  listQcRuns,
  mutateFlagLedger,
  mutateInvestigationLog,
  toQcRunSummary,
} from '../data/qc'
import { createJob, latestQcJobForScope, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, nowIso } from '../shared/util'

/**
 * Quality Control & Loop Engineering (contract §Quality Control) — the
 * four-gate QC stack, the per-scope Flag Ledger, and investigation runs.
 * Runs dispatch automatically after every generation (generate.ts finalize)
 * and on demand here. EVERYTHING is read-only against the scope documents:
 * investigations propose repair diffs and record accept/edit/reject as
 * telemetry; nothing here ever edits a generated scope.
 */

const FLAG_TYPES: QcFlagType[] = ['rigor', 'granularity', 'sequencing', 'wording', 'evidence', 'other']

// GET /api/qc → { runs: QcRunSummary[] } — the QC runs list with open-flag counts
api({
  name: 'qc-list',
  methods: ['GET'],
  route: 'qc',
  handler: async () => {
    const runs = await listQcRuns()
    const summaries = await Promise.all(
      runs.map(async (run) => {
        const ledger = await getFlagLedger(run.scopeId)
        return toQcRunSummary(run, ledger.flags.filter((f) => f.status === 'open' || f.status === 'investigating').length)
      }),
    )
    return ok({ runs: summaries.sort((a, b) => b.updated.localeCompare(a.updated)) })
  },
})

// GET /api/qc/{scopeId} → { run, flags, investigations } (full detail view)
// DELETE /api/qc/{scopeId} → { ok } — permanently delete the run, ledger, and
// investigation log (the scope is untouched)
api({
  name: 'qc-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'qc/{scopeId}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    if (req.method === 'DELETE') {
      // A run may be mid-flight — flag its job so the worker discards results
      // instead of resurrecting the deleted record at its final save.
      const job = await latestQcJobForScope(scopeId)
      if (job && (job.status === 'queued' || job.status === 'running')) {
        await mutateJob(job.jobId, (r) => {
          r.cancelRequested = true
          pushLog(r, 'QC docs deleted — the run stops at its next checkpoint')
        })
      }
      await deleteQcDocs(scopeId)
      return ok({ ok: true })
    }
    const run = await getQcRunOrUndefined(scopeId)
    if (!run) throw new HttpError(404, `no QC run for scope ${scopeId}`)
    const ledger = await getFlagLedger(scopeId)
    const log = await getInvestigationLog(scopeId)
    return ok({ run, flags: ledger.flags, investigations: log.investigations })
  },
})

// POST /api/qc/{scopeId}/run → { jobId } (202) — run (or re-run) the four gates
api({
  name: 'qc-run',
  methods: ['POST'],
  route: 'qc/{scopeId}/run',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    if (scope.status !== 'complete') throw new HttpError(409, 'only a completed scope can run the QC gates')
    // One run at a time per scope: concurrent runs would interleave saves of
    // the same run document (finalize auto-dispatches one right after
    // generation — a user click seconds later must not double-run).
    const inFlight = await latestQcJobForScope(scopeId)
    if (inFlight && (inFlight.status === 'queued' || inFlight.status === 'running')) {
      throw new HttpError(409, 'a QC job is already queued or running for this scope — wait for it to finish')
    }
    const jobId = newId('job')
    await createJob({
      jobId,
      kind: 'qc',
      scopeId,
      totalStages: 5,
      stage: 'Queued',
      detail: `Four-gate QC dispatched for "${scope.title}"`,
    })
    try {
      await enqueueJob({ jobId, kind: 'qc', step: 'run', scopeId })
    } catch (e) {
      await mutateJob(jobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the QC run'
        pushLog(r, 'Dispatch failed; run the gates again')
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId }, 202)
  },
})

// POST /api/qc/{scopeId}/flags { location?, type, note } → QcFlag (201)
// Flags cost nothing to raise — nothing happens until an investigation runs.
api({
  name: 'qc-flag-create',
  methods: ['POST'],
  route: 'qc/{scopeId}/flags',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    const body = await readJson<{ location?: QcLocation; type?: string; note?: string }>(req)
    const type = String(body.type ?? '').trim() as QcFlagType
    if (!FLAG_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${FLAG_TYPES.join(' | ')}`)
    const note = String(body.note ?? '')
      .slice(0, 4000)
      .trim()
    if (note.length === 0) throw new HttpError(400, 'a flag needs a note — it is a question the investigation answers')
    const location: QcLocation = {}
    if (body.location?.unitId) location.unitId = String(body.location.unitId).slice(0, 40)
    if (body.location?.lessonId) location.lessonId = String(body.location.lessonId).slice(0, 40)
    if (body.location?.field) location.field = String(body.location.field).slice(0, 60)
    const flag: QcFlag = {
      id: newId('flag'),
      location,
      type,
      note,
      scopeVersion: scope.updated,
      status: 'open',
      raised: nowIso(),
    }
    await mutateFlagLedger(scopeId, (l) => l.flags.push(flag))
    return ok(flag, 201)
  },
})

// DELETE /api/qc/{scopeId}/flags/{flagId} → { ok } — withdraw an OPEN flag
api({
  name: 'qc-flag-delete',
  methods: ['DELETE'],
  route: 'qc/{scopeId}/flags/{flagId}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const flagId = requireParam(req, 'flagId')
    await mutateFlagLedger(scopeId, (l) => {
      const flag = l.flags.find((f) => f.id === flagId)
      if (!flag) throw new HttpError(404, `no flag ${flagId}`)
      if (flag.status !== 'open') throw new HttpError(409, 'only an open flag can be withdrawn — investigated flags are the audit trail')
      l.flags = l.flags.filter((f) => f.id !== flagId)
    })
    return ok({ ok: true })
  },
})

// POST /api/qc/{scopeId}/investigate { flagIds? } → { jobId, investigationId } (202)
// Runs the six-step investigation over the named flags (default: all open).
api({
  name: 'qc-investigate',
  methods: ['POST'],
  route: 'qc/{scopeId}/investigate',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    const body = await readJson<{ flagIds?: string[] }>(req).catch(() => ({}) as { flagIds?: string[] })
    const ledger = await getFlagLedger(scopeId)
    const wanted = Array.isArray(body.flagIds) && body.flagIds.length > 0 ? new Set(body.flagIds.map(String)) : undefined
    const targets = ledger.flags.filter((f) => f.status === 'open' && (wanted === undefined || wanted.has(f.id)))
    if (targets.length === 0) throw new HttpError(409, 'no open flags to investigate')

    const investigationId = newId('inv')
    const inv: QcInvestigation = {
      id: investigationId,
      scopeId,
      flagIds: targets.map((f) => f.id),
      status: 'running',
      verdicts: [],
      patternSweep: [],
      gateGaps: [],
      proposedRepairs: [],
      repairDecisions: [],
      created: nowIso(),
      updated: nowIso(),
    }
    await mutateInvestigationLog(scopeId, (l) => l.investigations.push(inv))
    await mutateFlagLedger(scopeId, (l) => {
      for (const f of l.flags) if (inv.flagIds.includes(f.id)) f.status = 'investigating'
    })

    const jobId = newId('job')
    try {
      // createJob sits INSIDE the rollback try: a table hiccup here must not
      // strand the investigation 'running' and its flags 'investigating'.
      await createJob({
        jobId,
        kind: 'qc',
        scopeId,
        totalStages: 1,
        stage: 'Queued',
        detail: `Investigation of ${targets.length} flag(s) on "${scope.title}"`,
      })
      await enqueueJob({ jobId, kind: 'qc', step: 'investigate', scopeId, payload: { investigationId } })
    } catch (e) {
      // Roll the flags back to open and mark the investigation failed — a
      // dispatch failure must never leave zombies 'investigating' forever.
      await mutateInvestigationLog(scopeId, (l) => {
        const target = l.investigations.find((i) => i.id === investigationId)
        if (target) {
          target.status = 'failed'
          target.error = 'Failed to dispatch the investigation job'
          target.updated = nowIso()
        }
      }).catch(() => undefined)
      await mutateFlagLedger(scopeId, (l) => {
        for (const f of l.flags) if (inv.flagIds.includes(f.id) && f.status === 'investigating') f.status = 'open'
      }).catch(() => undefined)
      await mutateJob(jobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the investigation job'
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId, investigationId }, 202)
  },
})

// PUT /api/qc/{scopeId}/investigations/{invId}/repairs/{index} { decision, editedText?, reason }
// → QcInvestigation — record a repair decision. TELEMETRY ONLY: accepting a
// repair never applies it; application to the scope is a manual act.
api({
  name: 'qc-repair-decision',
  methods: ['PUT'],
  route: 'qc/{scopeId}/investigations/{invId}/repairs/{index}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const invId = requireParam(req, 'invId')
    const index = Number(requireParam(req, 'index'))
    const body = await readJson<{ decision?: string; editedText?: string; reason?: string }>(req)
    const decision = String(body.decision ?? '').trim() as QcRepairDecision['decision']
    if (!['accept', 'edit', 'reject'].includes(decision)) throw new HttpError(400, 'decision must be accept | edit | reject')
    const reason = String(body.reason ?? '')
      .slice(0, 2000)
      .trim()
    if (reason.length === 0) throw new HttpError(400, 'every repair decision requires a reason — the queue is the telemetry instrument')
    let updated: QcInvestigation | undefined
    await mutateInvestigationLog(scopeId, (l) => {
      const inv = l.investigations.find((i) => i.id === invId)
      if (!inv) throw new HttpError(404, `no investigation ${invId}`)
      if (!Number.isInteger(index) || index < 0 || index >= inv.proposedRepairs.length) {
        throw new HttpError(400, `repair index out of range (0..${inv.proposedRepairs.length - 1})`)
      }
      const entry: QcRepairDecision = { repairIndex: index, decision, reason, decided: nowIso() }
      if (decision === 'edit') {
        const editedText = String(body.editedText ?? '').trim()
        if (editedText.length === 0) throw new HttpError(400, 'an edit decision carries the edited text')
        entry.editedText = editedText.slice(0, 8000)
      }
      inv.repairDecisions = [...inv.repairDecisions.filter((d) => d.repairIndex !== index), entry]
      inv.updated = nowIso()
      updated = inv
    })
    return ok(updated)
  },
})
