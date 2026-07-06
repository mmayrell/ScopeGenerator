import { Artifact, NewSetUploads, StandardSet } from '../domain/types'
import { dataContainer, uploadsContainer } from '../data/clients'
import { deleteSetDocs, getSet, listScopes, listSets, saveSet } from '../data/entities'
import { createJob, latestJobForSet, mutateJob, pushLog, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { itemImageBlobPath } from '../pipeline/ingest'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, today } from '../shared/util'

/**
 * Enqueues an ingest job step for a set, reusing an already-active ingest job
 * (idempotent), and failing the job row if the queue write dies so a 'queued'
 * row with no message can't wedge the set forever.
 */
async function enqueueIngest(set: StandardSet, step: 'extract', detail: string): Promise<string> {
  const existing = await latestJobForSet(set.id)
  if (existing && existing.kind === 'ingest' && (existing.status === 'queued' || existing.status === 'running')) {
    // A 'running' row does not prove a live execution: the Consumption plan
    // kills executions at 10 minutes, and a poisoned message leaves the row
    // running forever. Supersede when the job is provably dead (no log entry
    // within 15 minutes > functionTimeout) or was stopped and had 3+ minutes
    // to settle; otherwise reuse it.
    const lastAt = existing.log.length > 0 ? Date.parse(existing.log[existing.log.length - 1].at) : Date.parse(existing.created)
    const idleMs = Date.now() - lastAt
    const dead = idleMs > 15 * 60 * 1000 || (existing.cancelRequested === true && idleMs > 3 * 60 * 1000)
    if (!dead) return existing.jobId
    await mutateJob(existing.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Extraction — Stopped'
      pushLog(r, existing.cancelRequested ? 'Stopped by user — superseded by a new job' : 'Stalled (no progress in 15 minutes) — superseded by a new job')
    })
  }
  const jobId = newId('job')
  await createJob({
    jobId,
    kind: 'ingest',
    setId: set.id,
    totalStages: 1,
    stage: 'Queued',
    detail,
  })
  try {
    await enqueueJob({ jobId, kind: 'ingest', step, setId: set.id })
  } catch (e) {
    await mutateJob(jobId, (rec) => {
      rec.status = 'failed'
      rec.error = `Failed to enqueue ${step} job`
      pushLog(rec, 'Enqueue failed; the step can be retried')
    })
    throw e
  }
  return jobId
}

// GET /api/bootstrap → { sets, scopes } — initial load
api({
  name: 'bootstrap',
  methods: ['GET'],
  route: 'bootstrap',
  handler: async () => {
    const [sets, scopes] = await Promise.all([listSets(), listScopes()])
    return ok({ sets, scopes })
  },
})

// GET /api/sets/{id} → StandardSet   |   DELETE /api/sets/{id} → { ok: true }
api({
  name: 'set-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'sets/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      await deleteSetDocs(id)
      return ok({ ok: true })
    }
    return ok(await getSet(id))
  },
})

// POST /api/sets  { name, uploads: NewSetUploads } → { id } — mirrors store.tsx createSet
api({
  name: 'set-create',
  methods: ['POST'],
  route: 'sets',
  handler: async (req) => {
    // Slots may arrive partially filled (or malformed) — every access below is
    // guarded with (slot?.files ?? []) / (slot?.notes ?? '') so a missing slot
    // never TypeErrors.
    const body = await readJson<{ name?: string; uploads?: Partial<NewSetUploads> }>(req)
    if (!body.name || !body.uploads) throw new HttpError(400, 'name and uploads are required')
    const uploads = body.uploads
    const id = `set-${Date.now()}`
    let n = 0
    const mk = (role: Artifact['role'], fileName: string, notes: string): Artifact => ({
      id: `${id}-a${n++}`,
      role,
      fileName,
      usageNotes: notes.trim(),
      reviewStatus: 'reviewed',
      // No placeholder metadata — real values (item counts, declared windows)
      // arrive from extraction or usage notes.
      meta: {},
    })
    const artifacts: Artifact[] = [
      ...(uploads.standards?.files ?? []).map((f) => mk('standards', f, uploads.standards?.notes ?? '')),
      ...(uploads.items?.files ?? []).map((f) => mk('items', f, uploads.items?.notes ?? '')),
      ...(uploads.unpacking?.files ?? []).map((f) => mk('unpacking-structured', f, uploads.unpacking?.notes ?? '')),
      ...(uploads.progression?.files ?? []).map((f) => mk('progression', f, uploads.progression?.notes ?? '')),
    ]
    const set: StandardSet = {
      id,
      name: body.name,
      subject: 'To be configured',
      gradeSpan: 'To be configured',
      hierarchyLevels: ['Grade', 'Domain', 'Cluster', 'Standard'],
      codingScheme: 'Declared in set configuration at review',
      codingNotes: '',
      emphasisSource: 'not declared',
      published: false,
      artifacts,
      // No warnings at creation — coverage gaps are flagged by ingestion, and only
      // the important granular ones whose handling is genuinely unclear.
      warnings: [],
      tree: [],
      items: [],
      updated: today(),
    }
    await saveSet(set)
    return ok({ id }, 201)
  },
})

// PUT /api/uploads/{setId}/{role}/{fileName}  raw bytes → { blobPath }
api({
  name: 'upload-put',
  methods: ['PUT'],
  route: 'uploads/{setId}/{role}/{fileName}',
  handler: async (req) => {
    const setId = requireParam(req, 'setId')
    const role = requireParam(req, 'role')
    const fileName = requireParam(req, 'fileName')
    if (!['standards', 'items', 'unpacking', 'progression'].includes(role)) {
      throw new HttpError(400, `unknown upload role: ${role}`)
    }
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) throw new HttpError(400, 'empty upload body')
    const blobPath = `${setId}/${role}/${fileName}`
    await uploadsContainer()
      .getBlockBlobClient(blobPath)
      .uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
    return ok({ blobPath })
  },
})

// POST /api/sets/{id}/acknowledge-warning  { warningId, resolution?, resolvedBy? } → StandardSet
// The user decides how each coverage gap is resolved: the deterministic default
// suggestion, or their own instruction. The resolution is recorded on the warning
// and injected into the stages that consume the gap.
api({
  name: 'set-acknowledge-warning',
  methods: ['POST'],
  route: 'sets/{id}/acknowledge-warning',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    const { warningId, resolution, resolvedBy } = await readJson<{
      warningId?: string
      resolution?: string
      resolvedBy?: 'default' | 'custom'
    }>(req)
    if (!warningId) throw new HttpError(400, 'warningId is required')
    if (resolvedBy && resolvedBy !== 'default' && resolvedBy !== 'custom') {
      throw new HttpError(400, 'resolvedBy must be "default" or "custom"')
    }
    set.warnings = set.warnings.map((w) =>
      w.id === warningId
        ? { ...w, acknowledged: true, resolution: resolution?.trim() || w.resolution, resolvedBy: resolvedBy ?? w.resolvedBy }
        : w,
    )
    await saveSet(set)
    return ok(set)
  },
})

// POST /api/sets/{id}/confirm-alignment  { itemId } → StandardSet
api({
  name: 'set-confirm-alignment',
  methods: ['POST'],
  route: 'sets/{id}/confirm-alignment',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    const { itemId } = await readJson<{ itemId?: string }>(req)
    if (!itemId) throw new HttpError(400, 'itemId is required')
    set.items = set.items.map((it) => (it.id === itemId ? { ...it, confidence: 'confirmed' } : it))
    await saveSet(set)
    return ok(set)
  },
})

// POST /api/sets/{id}/resolve-artifact  { artifactId } → StandardSet
api({
  name: 'set-resolve-artifact',
  methods: ['POST'],
  route: 'sets/{id}/resolve-artifact',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    const { artifactId } = await readJson<{ artifactId?: string }>(req)
    if (!artifactId) throw new HttpError(400, 'artifactId is required')
    set.artifacts = set.artifacts.map((a) =>
      a.id === artifactId
        ? {
            ...a,
            reviewStatus: 'reviewed',
            blockingError: undefined,
            usageNotes: a.usageNotes || 'Declaration corrected at review.',
          }
        : a,
    )
    await saveSet(set)
    return ok(set)
  },
})

// POST /api/sets/{id}/ingest → { jobId } — extraction phase (standards tree,
// item bank with screenshots, cross-document conflict pass). Called by the
// frontend as soon as the uploads finish at creation; also the retry path.
api({
  name: 'set-ingest',
  methods: ['POST'],
  route: 'sets/{id}/ingest',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    let hasUploads = false
    for await (const blob of uploadsContainer().listBlobsFlat({ prefix: `${set.id}/` })) {
      void blob
      hasUploads = true
      break
    }
    if (!hasUploads) throw new HttpError(409, 'no uploaded documents to ingest')
    const jobId = await enqueueIngest(set, 'extract', `Extraction queued for ${set.name}`)
    set.updated = today()
    await saveSet(set)
    return ok({ jobId }, 202)
  },
})

// POST /api/sets/{id}/stop-ingest → { jobId } (202) — flags the active ingest
// job; the worker halts at its next checkpoint (an in-flight AI call finishes
// first) and settles the job as 'cancelled'.
api({
  name: 'set-stop-ingest',
  methods: ['POST'],
  route: 'sets/{id}/stop-ingest',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForSet(id)
    if (!job || job.kind !== 'ingest' || (job.status !== 'queued' && job.status !== 'running')) {
      throw new HttpError(409, 'no active ingest job to stop')
    }
    await mutateJob(job.jobId, (r) => {
      r.cancelRequested = true
      pushLog(r, 'Stop requested — halting at the next checkpoint')
    })
    return ok({ jobId: job.jobId }, 202)
  },
})

// GET /api/sets/{id}/job → JobStatus — polled during extraction
api({
  name: 'set-job',
  methods: ['GET'],
  route: 'sets/{id}/job',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForSet(id)
    if (!job) throw new HttpError(404, `no job found for set ${id}`)
    return ok(toJobStatus(job))
  },
})

// GET /api/item-image/{setId}/{itemId} → PNG — question screenshots for <img>
// tags. Browsers can't attach the x-access-code header to an image request, so
// this endpoint also accepts ?code= (checked manually; auth:false skips the
// header middleware).
api({
  name: 'item-image',
  methods: ['GET'],
  route: 'item-image/{setId}/{itemId}',
  auth: false,
  handler: async (req) => {
    const expected = process.env.APP_ACCESS_CODE
    const supplied = req.headers.get('x-access-code') ?? req.query.get('code')
    if (!expected || supplied !== expected) {
      return { status: 401, jsonBody: { error: 'unauthorized' } }
    }
    const setId = requireParam(req, 'setId')
    const itemId = requireParam(req, 'itemId')
    const blob = dataContainer().getBlobClient(itemImageBlobPath(setId, itemId))
    if (!(await blob.exists())) throw new HttpError(404, 'no screenshot for this item')
    const bytes = await blob.downloadToBuffer()
    return {
      status: 200,
      body: new Uint8Array(bytes),
      headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' },
    }
  },
})

// POST /api/sets/{id}/publish → { set } — final gate. Seeded sets (no
// uploads) publish immediately; uploaded sets publish once extraction is done
// and every alignment issue is resolved.
api({
  name: 'set-publish',
  methods: ['POST'],
  route: 'sets/{id}/publish',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    // Idempotent: re-publishing an already-published set is a no-op.
    if (set.published) return ok({ set })
    if (set.artifacts.some((a) => a.reviewStatus === 'blocked')) {
      throw new HttpError(409, 'resolve the blocking artifact errors first')
    }
    let hasUploads = false
    for await (const blob of uploadsContainer().listBlobsFlat({ prefix: `${set.id}/` })) {
      void blob
      hasUploads = true
      break
    }
    if (hasUploads) {
      const unresolved = set.warnings.filter((w) => !w.acknowledged).length
      if (set.tree.length === 0 || unresolved > 0) {
        throw new HttpError(409, 'complete the ingest flow first: extraction → resolve alignment issues')
      }
    }
    set.published = true
    set.updated = today()
    await saveSet(set)
    return ok({ set })
  },
})
