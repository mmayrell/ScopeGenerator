import { Proposal, Scope } from '../domain/types'
import { deleteScopeDocs, getScope, getSet, mutateScope, saveScope, snapshotScope } from '../data/entities'
import { createJob, latestJobForScope, toJobStatus } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { GENERATE_TOTAL_STAGES } from '../pipeline/generate'
import { declineMerge, findProtectedPair } from '../pipeline/guardrails'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { ACTOR, capsStandardCodes, DOCTRINE_VERSIONS, ENGINE_VERSION, newId, today } from '../shared/util'

// POST /api/scopes  { setId, mode, params } → { id, jobId }
// Creates the scope doc (status 'generating') and enqueues the generate job.
api({
  name: 'scope-create',
  methods: ['POST'],
  route: 'scopes',
  handler: async (req) => {
    const body = await readJson<{ setId?: string; mode?: Scope['request']['mode']; params?: string }>(req)
    if (!body.setId || !body.mode) throw new HttpError(400, 'setId and mode are required')
    const mode = body.mode
    if (!['course', 'standard', 'topic'].includes(mode)) throw new HttpError(400, `unknown mode: ${mode}`)
    const params = capsStandardCodes(body.params ?? '')
    const set = await getSet(body.setId)
    if (!set.published) throw new HttpError(400, `set ${set.id} is not published`)

    const id = `scope-${Date.now()}`
    // Title logic mirrors src/store.tsx createScope.
    const title =
      mode === 'course'
        ? `${set.gradeSpan ?? 'Course'} Mathematics — Full Course`
        : mode === 'standard'
          ? `Scope — ${params}`
          : `Topic Scope — ${params}`
    const scope: Scope = {
      id,
      setId: set.id,
      title,
      request: { mode, params },
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
      return ok({ ok: true })
    }
    return ok(await getScope(id))
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

// POST /api/scopes/{id}/lock  { lessonId } → Scope (toggle)
api({
  name: 'scope-lock',
  methods: ['POST'],
  route: 'scopes/{id}/lock',
  handler: async (req) => {
    const id = requireParam(req, 'id')
    const { lessonId } = await readJson<{ lessonId?: string }>(req)
    if (!lessonId) throw new HttpError(400, 'lessonId is required')
    const scope = await mutateScope(id, (s) => {
      s.units = s.units.map((u) => ({
        ...u,
        lessons: u.lessons.map((l) => (l.id === lessonId ? { ...l, locked: !l.locked } : l)),
      }))
    })
    return ok(scope)
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
