import { Proposal, Scope } from '../domain/types'
import { screenshotsContainer, uploadsContainer } from '../data/clients'
import { deleteScopeDocs, getScope, getSet, mutateScope, saveScope, snapshotScope } from '../data/entities'
import { deleteEvaluationDocs } from '../data/evals'
import { getPacketOrUndefined } from '../data/packets'
import { createJob, latestJobForScope, mutateJob, pushLog, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { GENERATE_TOTAL_STAGES } from '../pipeline/generate'
import { SCOPE_UPLOADS_PREFIX, SCOPE_UPLOADS_TOKEN } from '../pipeline/scope-uploads'
import { declineMerge, findProtectedPair } from '../pipeline/guardrails'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { ACTOR, capsStandardCodes, DOCTRINE_VERSIONS, ENGINE_VERSION, newId, today } from '../shared/util'

// PUT /api/scope-uploads/{token}/{fileName}  raw PDF bytes → { blobPath }
// Released questions the user attaches to a topic request, uploaded BEFORE
// POST /scopes (generation starts immediately on create, so the files must
// already be in place). The client mints the token; the scope stores it as
// request.uploadsToken, and the pipeline attaches the PDFs to the generation
// calls as native document blocks.
api({
  name: 'scope-upload-put',
  methods: ['PUT'],
  route: 'scope-uploads/{token}/{fileName}',
  handler: async (req) => {
    const token = requireParam(req, 'token')
    const fileName = requireParam(req, 'fileName')
    if (!SCOPE_UPLOADS_TOKEN.test(token)) throw new HttpError(400, 'invalid upload token')
    if (!fileName || /[\\/]|\.\./.test(fileName)) throw new HttpError(400, 'invalid file name')
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) throw new HttpError(400, 'empty upload body')
    if (bytes.length > 15 * 1024 * 1024) {
      throw new HttpError(413, 'released-questions PDF too large (15 MB max) — split it and upload the relevant pages')
    }
    const blobPath = `${SCOPE_UPLOADS_PREFIX}${token}/${fileName}`
    await uploadsContainer()
      .getBlockBlobClient(blobPath)
      .uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
    return ok({ blobPath })
  },
})

// POST /api/scopes  { setId, mode, params } → { id, jobId }
// Creates the scope doc (status 'generating') and enqueues the generate job.
api({
  name: 'scope-create',
  methods: ['POST'],
  route: 'scopes',
  handler: async (req) => {
    const body = await readJson<{
      setId?: string
      setIds?: string[]
      mode?: Scope['request']['mode']
      params?: string
      courseName?: string
      subject?: string
      uploadsToken?: string
      uploadNames?: string[]
      packetId?: string
    }>(req)
    const requestedIds = [
      ...new Set(
        Array.isArray(body.setIds) && body.setIds.length > 0 ? body.setIds : body.setId ? [body.setId] : [],
      ),
    ]
    if (requestedIds.length === 0 || !body.mode) throw new HttpError(400, 'setIds and mode are required')
    const mode = body.mode
    if (!['course', 'standard', 'topic'].includes(mode)) throw new HttpError(400, `unknown mode: ${mode}`)
    const params = capsStandardCodes(body.params ?? '')
    // User-entered course identity — becomes card fields 01/02 and the scope
    // title. Optional at the API for deploy-skew compatibility; the frontend
    // requires both.
    const courseName = typeof body.courseName === 'string' ? body.courseName.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const selectedSets = await Promise.all(requestedIds.map((sid) => getSet(sid)))
    for (const s of selectedSets) {
      if (!s.published) throw new HttpError(400, `set ${s.id} is not published`)
    }
    const set = selectedSets[0]

    // Optional released-items source: an evidence packet whose hunted items
    // (with captured screenshots) join the scope's item bank.
    let packet: { id: string; title: string } | undefined
    if (typeof body.packetId === 'string' && body.packetId.length > 0) {
      const found = await getPacketOrUndefined(body.packetId)
      if (!found) throw new HttpError(400, `evidence packet ${body.packetId} not found`)
      if (found.status === 'hunting') {
        throw new HttpError(409, 'that repository is still hunting — wait for it to finish before scoping against it')
      }
      packet = { id: found.id, title: found.title }
    }

    const id = `scope-${Date.now()}`
    const gradeSpans = [...new Set(selectedSets.map((s) => s.gradeSpan).filter(Boolean))].join(' + ')
    const title =
      mode === 'course'
        ? `${courseName || `${gradeSpans || 'Course'} ${subject || 'Mathematics'}`} — Full Course`
        : mode === 'standard'
          ? `Scope — ${params}`
          : `Topic Scope — ${params}`
    const scope: Scope = {
      id,
      setId: set.id,
      ...(requestedIds.length > 1 ? { setIds: requestedIds } : {}),
      title,
      request: {
        mode,
        params,
        ...(courseName ? { courseName } : {}),
        ...(subject ? { subject } : {}),
        // User-attached released questions (topic requests): keep the token so
        // the pipeline can attach the PDFs and delete can clean them up.
        ...(typeof body.uploadsToken === 'string' && SCOPE_UPLOADS_TOKEN.test(body.uploadsToken)
          ? {
              uploadsToken: body.uploadsToken,
              uploadNames: Array.isArray(body.uploadNames)
                ? body.uploadNames.map((n) => String(n)).slice(0, 4)
                : [],
            }
          : {}),
        ...(packet ? { packetId: packet.id, packetTitle: packet.title } : {}),
      },
      engineVersion: ENGINE_VERSION,
      doctrineVersions: DOCTRINE_VERSIONS,
      status: 'generating',
      version: 1,
      units: [],
      qc: [],
      history: [],
      proposals: [],
      creator: ACTOR,
      updated: today(),
    }
    // Plain save (not mutateScope): brand-new doc — no concurrent writers exist yet.
    await saveScope(scope)

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'generate',
        scopeId: id,
        totalStages: GENERATE_TOTAL_STAGES,
        stage: 'Queued',
        detail: `Generation queued (${mode}: ${params || set.gradeSpan})`,
      })
      await enqueueJob({ jobId, kind: 'generate', step: 'plan', scopeId: id })
    } catch (e) {
      // No job means the 'generating' scope would be stranded forever — revert the create.
      await deleteScopeDocs(id)
      throw new HttpError(500, `failed to enqueue generation: ${e instanceof Error ? e.message : String(e)}`)
    }
    return ok({ id, jobId }, 201)
  },
})

// GET /api/scopes/{id} → Scope   |   DELETE /api/scopes/{id} → { ok: true }
api({
  name: 'scope-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'scopes/{id}',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    if (req.method === 'DELETE') {
      await deleteScopeDocs(id)
      // Best-effort cleanup of the scope's evaluation record and the publicly
      // hosted JSON copy — a stale eval row for a deleted scope is worse than
      // a failed cleanup here.
      await deleteEvaluationDocs(id).catch(() => undefined)
      await screenshotsContainer()
        .getBlockBlobClient(`evals/${id}.json`)
        .deleteIfExists()
        .catch(() => undefined)
      return ok({ ok: true })
    }
    return ok(await getScope(id))
  },
})

// POST /api/scopes/{id}/pause-generation → { jobId } (202) — flags the active
// generate job; the worker pauses at its next checkpoint (an in-flight Claude
// call finishes first). All checkpoints are kept for resume.
api({
  name: 'scope-pause-generation',
  methods: ['POST'],
  route: 'scopes/{id}/pause-generation',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForScope(id)
    if (!job || job.kind !== 'generate' || (job.status !== 'queued' && job.status !== 'running')) {
      throw new HttpError(409, 'no generation is running for this scope')
    }
    await mutateJob(job.jobId, (r) => {
      r.cancelRequested = true
      pushLog(r, 'Pause requested — the worker pauses at its next checkpoint')
    })
    return ok({ jobId: job.jobId }, 202)
  },
})

// POST /api/scopes/{id}/resume-generation → { jobId } (202) — continues a
// paused (or failed) generation. Reuses the SAME job id so the plan/unit/batch
// checkpoints under jobs/<jobId>/ are found; the plan step re-fans-out
// idempotently (unit blobs short-circuit, completeUnit dedupes via unitsMask).
api({
  name: 'scope-resume-generation',
  methods: ['POST'],
  route: 'scopes/{id}/resume-generation',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    await getScope(id) // 404 before any state is touched — a deleted scope must not strand the job row
    const job = await latestJobForScope(id)
    if (!job || job.kind !== 'generate') throw new HttpError(409, 'no generation job to resume')
    if (job.status === 'complete') throw new HttpError(409, 'this generation already completed')
    if (job.status === 'queued' || job.status === 'running') {
      // A queued/running row does not prove a live message (a failed resume or
      // a poisoned message leaves the row active forever). Only trust it while
      // the job shows recent progress; otherwise fall through and re-enqueue —
      // every step is idempotent, so a duplicate message is harmless.
      // NEVER trust a cancel-flagged job: cancel-then-retry hits this branch
      // while the worker is still winding down (the row stays queued/running
      // and 'Cancelled by user' is a fresh log entry) — an early return here
      // would leave the flag set and the scope failed, making Retry a silent
      // no-op. Fall through instead: the flag is cleared and a fresh plan
      // message enqueued; if the old run is still mid-call, its checkpoints
      // make the duplicate harmless.
      const lastAt = job.log.length > 0 ? Date.parse(job.log[job.log.length - 1].at) : Date.parse(job.created)
      if (job.cancelRequested !== true && Date.now() - lastAt < 15 * 60 * 1000) {
        return ok({ jobId: job.jobId }, 202)
      }
    }
    await mutateJob(job.jobId, (r) => {
      r.status = 'queued'
      r.stage = 'Queued'
      r.cancelRequested = false
      delete r.error
      pushLog(r, 'Resumed — continuing from the checkpoints')
    })
    await mutateScope(id, (s) => {
      s.status = 'generating'
      delete s.error
      s.updated = today()
    })
    await enqueueJob({ jobId: job.jobId, kind: 'generate', step: 'plan', scopeId: id })
    return ok({ jobId: job.jobId }, 202)
  },
})

// POST /api/scopes/{id}/cancel-generation → { scope } — abandons the run: the
// active job (if any) is flagged to stop, and the scope settles 'failed' so it
// can be retried or deleted. Checkpoints remain, so resume-generation can
// still revive it.
api({
  name: 'scope-cancel-generation',
  methods: ['POST'],
  route: 'scopes/{id}/cancel-generation',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForScope(id)
    if (job && job.kind === 'generate' && (job.status === 'queued' || job.status === 'running')) {
      await mutateJob(job.jobId, (r) => {
        r.cancelRequested = true
        pushLog(r, 'Cancelled by user')
      })
    }
    const scope = await mutateScope(id, (s) => {
      if (s.status === 'generating' || s.status === 'paused') {
        s.status = 'failed'
        s.error = 'Generation cancelled by user.'
        s.updated = today()
      }
    })
    return ok({ scope })
  },
})

// GET /api/scopes/{id}/job → JobStatus — polled by the generation screen
api({
  name: 'scope-job',
  methods: ['GET'],
  route: 'scopes/{id}/job',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const job = await latestJobForScope(id)
    if (!job) throw new HttpError(404, `no job found for scope ${id}`)
    return ok(toJobStatus(job))
  },
})

// POST /api/scopes/{id}/rerun  { target, mode, override? } → { ok, message, guardrail?, jobId? }
// The guardrail check is synchronous and data-driven off scope.protectedBoundaries,
// replicating the exact decline message/criterion/evidence of src/store.tsx rerun().
api({
  name: 'scope-rerun',
  methods: ['POST'],
  route: 'scopes/{id}/rerun',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const scope = await getScope(id)
    const body = await readJson<{ target?: string; mode?: string; override?: boolean }>(req)
    if (!body.target || !body.mode) throw new HttpError(400, 'target and mode are required')
    const { target, mode } = body
    if (!['split', 'merge', 'regenerate'].includes(mode)) {
      throw new HttpError(400, `unknown rerun mode: ${mode} — expected split, merge or regenerate`)
    }
    const override = body.override === true

    const pair = mode === 'merge' ? findProtectedPair(scope, target) : undefined
    if (pair && !override) {
      const decline = declineMerge(pair)
      return ok({ ok: false, message: decline.message, guardrail: decline.guardrail })
    }

    const prevStatus = scope.status
    const prevError = scope.error
    await mutateScope(id, (s) => {
      s.status = 'generating'
      delete s.error
      s.updated = today()
    })

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'rerun',
        scopeId: scope.id,
        totalStages: 1,
        stage: 'Queued',
        detail: `Rerun ${mode} on ${target}${override ? ' (guardrail override)' : ''}`,
      })
      await enqueueJob({
        jobId,
        kind: 'rerun',
        step: 'run',
        scopeId: scope.id,
        payload: { target, mode, override },
      })
    } catch (e) {
      // No job means 'generating' would be stranded forever — restore the previous state.
      await mutateScope(id, (s) => {
        s.status = prevStatus
        if (prevError !== undefined) s.error = prevError
        else delete s.error
        s.updated = today()
      })
      throw new HttpError(500, `failed to enqueue rerun: ${e instanceof Error ? e.message : String(e)}`)
    }

    const modeLabel = mode === 'split' ? 'more granular' : mode === 'merge' ? 'less granular' : 'regenerate in place'
    const message = override
      ? `Override executed on ${target} — new version created; the override is logged and QC-flagged.`
      : `Rerun (${modeLabel}) executed on ${target} — new immutable version created.`
    return ok({ ok: true, message, jobId })
  },
})

// POST /api/scopes/{id}/reports  { target, text } → Proposal (status 'drafting', working: true)
api({
  name: 'scope-reports',
  methods: ['POST'],
  route: 'scopes/{id}/reports',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const body = await readJson<{ target?: string; text?: string }>(req)
    if (!body.target || !body.text) throw new HttpError(400, 'target and text are required')

    const proposal: Proposal = {
      id: `prop-${Date.now()}`,
      report: { id: `pr-${Date.now()}`, target: body.target, text: body.text, actor: ACTOR, date: today() },
      changes: [],
      ripple: [],
      status: 'drafting',
      working: true,
      rounds: [],
    }
    await mutateScope(id, (s) => {
      s.proposals.push(proposal)
      s.updated = today()
    })

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'proposal',
        scopeId: id,
        totalStages: 1,
        stage: 'Queued',
        detail: `PerformanceReport filed on ${body.target}`,
      })
      await enqueueJob({
        jobId,
        kind: 'proposal',
        step: 'run',
        scopeId: id,
        payload: { proposalId: proposal.id },
      })
    } catch (e) {
      // No job means the 'drafting' proposal would spin forever — remove it again.
      await mutateScope(id, (s) => {
        s.proposals = s.proposals.filter((p) => p.id !== proposal.id)
        s.updated = today()
      })
      throw new HttpError(500, `failed to enqueue proposal drafting: ${e instanceof Error ? e.message : String(e)}`)
    }
    return ok(proposal, 201)
  },
})

// POST /api/scopes/{id}/proposals/{pid}/iterate  { feedback } → Proposal (working: true)
api({
  name: 'proposal-iterate',
  methods: ['POST'],
  route: 'scopes/{id}/proposals/{pid}/iterate',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const pid = requireParam(req, 'pid')
    const { feedback } = await readJson<{ feedback?: string }>(req)
    if (!feedback) throw new HttpError(400, 'feedback is required')

    const scope = await mutateScope(id, (s) => {
      const proposal = s.proposals.find((p) => p.id === pid)
      if (!proposal) throw new HttpError(404, `proposal ${pid} not found`)
      if (proposal.status !== 'draft' && proposal.status !== 'drafting') {
        throw new HttpError(400, `proposal ${pid} is ${proposal.status} and can no longer be iterated`)
      }
      proposal.working = true
      s.updated = today()
    })
    const proposal = scope.proposals.find((p) => p.id === pid)
    if (!proposal) throw new HttpError(404, `proposal ${pid} not found`)

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'iterate',
        scopeId: id,
        totalStages: 1,
        stage: 'Queued',
        detail: `Feedback round on proposal ${pid}`,
      })
      await enqueueJob({
        jobId,
        kind: 'iterate',
        step: 'run',
        scopeId: id,
        payload: { proposalId: pid, feedback },
      })
    } catch (e) {
      // No job means 'working' would spin forever — restore the settled state.
      await mutateScope(id, (s) => {
        const p = s.proposals.find((x) => x.id === pid)
        if (p) p.working = false
        s.updated = today()
      })
      throw new HttpError(500, `failed to enqueue proposal iteration: ${e instanceof Error ? e.message : String(e)}`)
    }
    return ok(proposal)
  },
})

// POST /api/scopes/{id}/proposals/{pid}/resolve  { accept } → Scope
// Accept: bump version, snapshot, history entry, enqueue apply-proposal job;
// abandon: mark abandoned.
api({
  name: 'proposal-resolve',
  methods: ['POST'],
  route: 'scopes/{id}/proposals/{pid}/resolve',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const pid = requireParam(req, 'pid')
    const { accept } = await readJson<{ accept?: boolean }>(req)
    if (typeof accept !== 'boolean') throw new HttpError(400, 'accept (boolean) is required')

    if (!accept) {
      const scope = await mutateScope(id, (s) => {
        const proposal = s.proposals.find((p) => p.id === pid)
        if (!proposal) throw new HttpError(404, `proposal ${pid} not found`)
        proposal.status = 'abandoned'
        proposal.working = false
        s.updated = today()
      })
      return ok(scope)
    }

    let prevStatus: Proposal['status'] = 'draft'
    const scope = await mutateScope(id, (s) => {
      const proposal = s.proposals.find((p) => p.id === pid)
      if (!proposal) throw new HttpError(404, `proposal ${pid} not found`)
      prevStatus = proposal.status
      proposal.status = 'accepted'
      proposal.working = true // Claude is applying the change set; UI polls until settled
      s.version += 1
      s.updated = today()
      // History detail mirrors src/store.tsx resolveProposal.
      s.history.push({
        version: s.version,
        date: today(),
        actor: ACTOR,
        event: 'Data-informed revision accepted',
        detail: `PerformanceReport on ${proposal.report.target}: ${
          proposal.changes[0]?.kind === 'split'
            ? 'split executed per Editing Splits'
            : 'modeling intensified inside the atom'
        }; report and proposal history attached to the RerunEvent.`,
      })
    })
    await snapshotScope(scope)

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'apply-proposal',
        scopeId: scope.id,
        totalStages: 1,
        stage: 'Queued',
        detail: `Applying accepted proposal ${pid} (v${scope.version})`,
      })
      await enqueueJob({
        jobId,
        kind: 'apply-proposal',
        step: 'run',
        scopeId: scope.id,
        payload: { proposalId: pid },
      })
    } catch (e) {
      // No job means the accept would never be applied — revert the version bump,
      // the history entry and the proposal state.
      await mutateScope(id, (s) => {
        const p = s.proposals.find((x) => x.id === pid)
        if (p) {
          p.status = prevStatus
          p.working = false
        }
        s.history = s.history.filter(
          (h) => !(h.version === s.version && h.event === 'Data-informed revision accepted'),
        )
        s.version -= 1
        s.updated = today()
      })
      throw new HttpError(500, `failed to enqueue proposal application: ${e instanceof Error ? e.message : String(e)}`)
    }
    return ok(scope)
  },
})
