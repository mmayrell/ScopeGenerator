import { Artifact, NewSetUploads, StandardSet } from '../domain/types'
import { uploadsContainer } from '../data/clients'
import { deleteSetDocs, getSet, listScopes, listSets, saveSet } from '../data/entities'
import { createJob, latestJobForSet, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, today } from '../shared/util'

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
      meta:
        role === 'items'
          ? { sourceDescription: 'Uploaded release PDF', window: 'declared at review', coverage: 'unknown' }
          : {},
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
      warnings: [
        {
          id: `${id}-w1`,
          text: 'Ingestion queued: parsing and indexing run next — the Standards Tree and Item Bank populate when they finish.',
          acknowledged: false,
        },
      ],
      tree: [],
      items: [],
      lexicons: { representations: [], problemTypes: [] },
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

// POST /api/sets/{id}/publish → { set, jobId? }
// If the set has uploaded PDFs in uploads/, enqueue an ingest job (Stage 1) and
// hold publish pending ingestion; otherwise publish immediately (seeded sets).
api({
  name: 'set-publish',
  methods: ['POST'],
  route: 'sets/{id}/publish',
  handler: async (req) => {
    const set = await getSet(requireParam(req, 'id'))
    // Idempotent: re-publishing an already-published set is a no-op (no job).
    if (set.published) return ok({ set })
    let hasUploads = false
    for await (const blob of uploadsContainer().listBlobsFlat({ prefix: `${set.id}/` })) {
      void blob
      hasUploads = true
      break
    }
    if (!hasUploads) {
      set.published = true
      set.updated = today()
      await saveSet(set)
      return ok({ set })
    }
    // Idempotent: an ingest job already queued/running for this set is returned
    // instead of enqueueing a duplicate.
    const existing = await latestJobForSet(set.id)
    if (existing && existing.kind === 'ingest' && (existing.status === 'queued' || existing.status === 'running')) {
      return ok({ set, jobId: existing.jobId })
    }
    const jobId = newId('job')
    await createJob({
      jobId,
      kind: 'ingest',
      setId: set.id,
      totalStages: 1,
      stage: 'Queued',
      detail: `Ingest queued for ${set.name} — publish pending`,
    })
    try {
      await enqueueJob({ jobId, kind: 'ingest', step: 'run', setId: set.id })
    } catch (e) {
      // A 'queued' job row with no queue message would be returned by the
      // idempotency check above forever, wedging publish for this set.
      await mutateJob(jobId, (rec) => {
        rec.status = 'failed'
        rec.error = 'Failed to enqueue ingest job'
        pushLog(rec, 'Enqueue failed; publish can be retried')
      })
      throw e
    }
    set.updated = today()
    await saveSet(set)
    return ok({ set, jobId })
  },
})
