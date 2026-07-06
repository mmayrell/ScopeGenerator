import { EvidencePacket, PacketFramework, PacketStandard } from '../domain/types'
import { deletePacketDocs, getPacket, listPackets, mutatePacket, savePacket, toPacketSummary } from '../data/packets'
import { createJob, latestJobForPacket, mutateJob, pushLog, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, nowIso } from '../shared/util'

/**
 * Evidence Packets — the standalone web-hunting tool (contract §Evidence
 * packets). Packets are independent of standard sets and scopes: the request
 * carries the catalog standards verbatim, and a 'packet' job sends the
 * web-searching agent to hunt released items online.
 */

const FRAMEWORKS: PacketFramework[] = ['ccss', 'teks', 'sol', 'best']
/** Hunts are batched web-search calls (~4 standards each); cap the fan-out so one packet can't queue hours of work. */
const MAX_STANDARDS = 120
/**
 * Field caps: an oversized title breaks the Azure Table index row AFTER the
 * blob is written (orphaned blob), and megabyte standard texts would reach
 * every hunt prompt. Generous relative to real catalog data (longest official
 * wording ≈ 2.2k chars).
 */
const cap = (v: unknown, max: number): string => String(v ?? '').slice(0, max)

interface CreatePacketBody {
  title?: string
  framework?: string
  frameworkLabel?: string
  grades?: number[]
  years?: number[]
  standards?: Partial<PacketStandard>[]
}

// POST /api/packets → { packet, jobId } — create a packet and dispatch the hunt agent
api({
  name: 'packet-create',
  methods: ['POST'],
  route: 'packets',
  handler: async (req) => {
    const body = await readJson<CreatePacketBody>(req)
    if (!body.framework || !FRAMEWORKS.includes(body.framework as PacketFramework)) {
      throw new HttpError(400, `framework must be one of: ${FRAMEWORKS.join(', ')}`)
    }
    const rawStandards = Array.isArray(body.standards) ? body.standards : []
    const standards: PacketStandard[] = rawStandards
      .filter((s) => typeof s?.code === 'string' && s.code.length > 0)
      .map((s) => ({
        code: cap(s.code, 60),
        grade: Math.trunc(Number(s.grade ?? 0)),
        domain: cap(s.domain, 40),
        domainName: cap(s.domainName ?? s.domain, 120),
        text: cap(s.text, 3000),
      }))
    if (standards.length === 0) throw new HttpError(400, 'at least one standard is required')
    if (standards.length > MAX_STANDARDS) {
      throw new HttpError(400, `too many standards (${standards.length}) — select at most ${MAX_STANDARDS} per packet`)
    }

    const now = nowIso()
    const jobId = newId('job')
    const packet: EvidencePacket = {
      id: newId('packet'),
      title: cap(body.title, 200).trim() || 'Mathematics Released Item Repository',
      framework: body.framework as PacketFramework,
      frameworkLabel: cap(body.frameworkLabel, 80).trim() || body.framework.toUpperCase(),
      grades: [...new Set(standards.map((s) => s.grade))].sort((a, b) => a - b),
      // Policy: never hunt tests administered before 2017.
      years: (body.years ?? []).map((y) => Math.trunc(Number(y))).filter((y) => y >= 2017 && y < 2100),
      standards,
      status: 'hunting',
      items: [],
      doneBatches: [],
      huntJobId: jobId, // ownership token — only this job may mutate the hunt
      created: now,
      updated: now,
    }
    await savePacket(packet)

    try {
      // BOTH writes inside the try: a createJob failure (not just enqueue)
      // would otherwise strand the packet at 'hunting' with no job row and no
      // message — hunting forever in the list, 404 from the job poll.
      await createJob({
        jobId,
        kind: 'packet',
        packetId: packet.id,
        totalStages: 1, // the worker recomputes from the batch plan on first run
        stage: 'Queued',
        detail: `Hunt dispatched: ${standards.length} standard${standards.length === 1 ? '' : 's'} (${packet.frameworkLabel})`,
      })
      await enqueueJob({ jobId, kind: 'packet', step: 'hunt', packetId: packet.id })
    } catch (e) {
      // A 'queued' job row with no message would show as hunting forever.
      try {
        await mutateJob(jobId, (r) => {
          r.status = 'failed'
          r.error = 'Failed to dispatch hunt job'
          pushLog(r, 'Dispatch failed; use Retry on the packet')
        })
      } catch {
        /* the job row may never have been created — the packet settle below is what matters */
      }
      packet.status = 'failed'
      packet.error = 'Failed to start the hunt — use Retry'
      packet.updated = nowIso()
      await savePacket(packet)
      throw e
    }
    return ok({ packet, jobId }, 201)
  },
})

// GET /api/packets → PacketSummary[] — slim list, newest first
api({
  name: 'packet-list',
  methods: ['GET'],
  route: 'packets',
  handler: async () => {
    const packets = await listPackets()
    return ok(packets.map(toPacketSummary).sort((a, b) => b.created.localeCompare(a.created)))
  },
})

// GET /api/packets/{id} → EvidencePacket   |   DELETE /api/packets/{id} → { ok: true }
api({
  name: 'packet-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'packets/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      // Stop a live hunt first so its next checkpoint halts instead of
      // re-creating state for a deleted packet.
      const job = await latestJobForPacket(id)
      if (job && (job.status === 'queued' || job.status === 'running')) {
        await mutateJob(job.jobId, (r) => {
          r.cancelRequested = true
          pushLog(r, 'Packet deleted — hunt will stop at its next checkpoint')
        })
      }
      await deletePacketDocs(id)
      return ok({ ok: true })
    }
    return ok(await getPacket(id))
  },
})

// GET /api/packets/{id}/job → JobStatus — hunt progress for polling
api({
  name: 'packet-job',
  methods: ['GET'],
  route: 'packets/{id}/job',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForPacket(id)
    if (!job) throw new HttpError(404, `no job for packet ${id}`)
    return ok(toJobStatus(job))
  },
})

// POST /api/packets/{id}/stop → { jobId } — request the hunt to stop at its next checkpoint
api({
  name: 'packet-stop',
  methods: ['POST'],
  route: 'packets/{id}/stop',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    await getPacket(id) // 404 for unknown packets
    const job = await latestJobForPacket(id)
    if (!job || (job.status !== 'queued' && job.status !== 'running')) {
      throw new HttpError(409, 'no active hunt to stop')
    }
    await mutateJob(job.jobId, (r) => {
      r.cancelRequested = true
      pushLog(r, 'Stop requested — the hunt halts at its next checkpoint (items already found are kept)')
    })
    return ok({ jobId: job.jobId })
  },
})

// POST /api/packets/{id}/retry → { jobId } (202) — resumes a failed or stopped
// (or silently stalled) hunt. doneBatches on the packet doc make the resume
// skip every batch already searched, so a retry never repeats paid searches.
api({
  name: 'packet-retry',
  methods: ['POST'],
  route: 'packets/{id}/retry',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const packet = await getPacket(id)
    if (packet.status === 'complete') throw new HttpError(409, 'this packet already completed')

    const job = await latestJobForPacket(id)
    if (job && (job.status === 'queued' || job.status === 'running')) {
      // Same liveness rule as scope resume: trust an active row only while it
      // shows recent progress and no stop flag; otherwise re-dispatch (batches
      // are idempotent via doneBatches, so a duplicate message is harmless).
      const lastAt = job.log.length > 0 ? Date.parse(job.log[job.log.length - 1].at) : Date.parse(job.created)
      if (job.cancelRequested !== true && Date.now() - lastAt < 15 * 60 * 1000) {
        return ok({ jobId: job.jobId }, 202)
      }
    }

    // The job we are about to dispatch owns the hunt from here — stamped on
    // the packet so any superseded execution abandons at its next checkpoint.
    const resumeJobId = job ? job.jobId : newId('job')
    const resumed = await mutatePacket(id, (p) => {
      p.status = 'hunting'
      p.huntJobId = resumeJobId
      delete p.error
      p.updated = nowIso()
    })
    const detail = `Hunt re-dispatched — resuming past ${resumed.doneBatches.length} finished batch${resumed.doneBatches.length === 1 ? '' : 'es'}`

    try {
      if (job) {
        // Reuse the SAME job (the scope-resume pattern): clearing the stop
        // flag means a still-live worker simply continues instead of flipping
        // the packet we just set back to 'hunting' into 'cancelled', and
        // re-enqueueing the same id can never strand a second job row in
        // 'queued'. Cancel-then-retry with a fresh job did exactly that — the
        // packet twin of the scope Retry bug (dbb50ef).
        await mutateJob(job.jobId, (r) => {
          r.status = 'queued'
          r.stage = 'Queued'
          delete r.error
          r.cancelRequested = false
          pushLog(r, detail)
        })
        await enqueueJob({ jobId: job.jobId, kind: 'packet', step: 'hunt', packetId: id })
        return ok({ jobId: job.jobId }, 202)
      }
      // No job row at all (a create-path dispatch failure) — dispatch fresh
      // under the id already stamped as the hunt owner.
      await createJob({ jobId: resumeJobId, kind: 'packet', packetId: id, totalStages: 1, stage: 'Queued', detail })
      await enqueueJob({ jobId: resumeJobId, kind: 'packet', step: 'hunt', packetId: id })
      return ok({ jobId: resumeJobId }, 202)
    } catch (e) {
      // A 'hunting' packet with no live message would look stuck; settle it
      // back to 'failed' so Retry stays available and honest.
      await mutatePacket(id, (p) => {
        p.status = 'failed'
        p.error = 'Failed to restart the hunt — try again'
        p.updated = nowIso()
      })
      throw e
    }
  },
})
