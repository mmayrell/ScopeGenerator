import { getScope } from '../data/entities'
import { deleteEvaluationDocs, getEvaluationOrUndefined, listEvaluations, mutateEvaluation, toEvaluationSummary } from '../data/evals'
import { EVAL_RUBRIC_COLUMNS } from '../data/eval-rubric'
import { screenshotsContainer } from '../data/clients'
import { createJob, latestEvalJobForScope, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, nowIso } from '../shared/util'

/**
 * Scope Evaluations (contract §Scope Evaluations) — the built-in rubric QC
 * layer. Evaluations run automatically after every generation (see
 * generate.ts finalize) and on demand here; the rubric lives in
 * data/eval-rubric.ts, results live in the app (details view, SME entry,
 * client-side CSV export), and runs can be deleted.
 */

const VALID_SME_VERDICTS = ['', 'FAIL', 'PASS — GOOD', 'PASS — GOOD ENOUGH']

// GET /api/evals → { rubric, evaluations: ScopeEvaluationSummary[] }
api({
  name: 'evals-list',
  methods: ['GET'],
  route: 'evals',
  handler: async () => {
    const evals = await listEvaluations()
    return ok({
      rubric: EVAL_RUBRIC_COLUMNS,
      evaluations: evals.map(toEvaluationSummary).sort((a, b) => b.updated.localeCompare(a.updated)),
    })
  },
})

// GET /api/evals/{scopeId} → ScopeEvaluation (full record for the details view)
// DELETE /api/evals/{scopeId} → { ok } — permanently delete an evaluation run
// (the record and the publicly hosted scope-JSON copy; the scope is untouched)
api({
  name: 'evals-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'evals/{scopeId}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    if (req.method === 'DELETE') {
      // A run may be re-evaluating right now — flag its job so the worker
      // discards its results instead of resurrecting the deleted record.
      const job = await latestEvalJobForScope(scopeId)
      if (job && (job.status === 'queued' || job.status === 'running')) {
        await mutateJob(job.jobId, (r) => {
          r.cancelRequested = true
          pushLog(r, 'Evaluation deleted — the run stops at its next checkpoint')
        })
      }
      await deleteEvaluationDocs(scopeId)
      await screenshotsContainer()
        .getBlockBlobClient(`evals/${scopeId}.json`)
        .deleteIfExists()
        .catch(() => undefined)
      return ok({ ok: true })
    }
    const ev = await getEvaluationOrUndefined(scopeId)
    if (!ev) throw new HttpError(404, `no evaluation for scope ${scopeId}`)
    return ok(ev)
  },
})

// PUT /api/evals/{scopeId}/sme { sme?, smeVerdict?, smeNotes? } → ScopeEvaluationSummary
api({
  name: 'evals-sme',
  methods: ['PUT'],
  route: 'evals/{scopeId}/sme',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const body = await readJson<{ sme?: string; smeVerdict?: string; smeNotes?: string }>(req)
    const smeVerdict = String(body.smeVerdict ?? '').trim()
    if (!VALID_SME_VERDICTS.includes(smeVerdict)) {
      throw new HttpError(400, `smeVerdict must be one of: ${VALID_SME_VERDICTS.filter(Boolean).join(' | ')} (or empty)`)
    }
    // ETag mutate: an SME save must never clobber (or be clobbered by) a
    // re-evaluation finishing concurrently. `updated` is deliberately NOT
    // bumped — it means "when the agent last evaluated", and the page's
    // dispatch watch keys on it.
    const ev = await mutateEvaluation(scopeId, (r) => {
      r.sme = String(body.sme ?? '').slice(0, 2000).trim()
      r.smeVerdict = smeVerdict
      r.smeNotes = String(body.smeNotes ?? '').slice(0, 20000).trim()
      r.smeUpdated = nowIso()
    })
    return ok(toEvaluationSummary(ev))
  },
})

// POST /api/evals/{scopeId}/run → { jobId } (202) — evaluate (or re-evaluate) one scope
api({
  name: 'evals-run',
  methods: ['POST'],
  route: 'evals/{scopeId}/run',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    if (scope.status !== 'complete') throw new HttpError(409, 'only a completed scope can be evaluated')
    const jobId = newId('job')
    await createJob({
      jobId,
      kind: 'eval',
      scopeId,
      totalStages: 3,
      stage: 'Queued',
      detail: `Rubric evaluation dispatched for "${scope.title}"`,
    })
    try {
      await enqueueJob({ jobId, kind: 'eval', step: 'run', scopeId })
    } catch (e) {
      await mutateJob(jobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the evaluation job'
        pushLog(r, 'Dispatch failed; run the evaluation again')
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId }, 202)
  },
})
