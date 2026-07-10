import { getScope } from '../data/entities'
import { getEvaluationOrUndefined, listEvaluations, saveEvaluation, toEvaluationSummary } from '../data/evals'
import { createJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { EVAL_SHEET_URL, fetchEvalSheetModel, getEvalConfig, pushEvalRow, saveEvalConfig, SME_COLUMN_COUNT } from '../services/evalsheet'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { newId, nowIso } from '../shared/util'

/**
 * Scope Evaluations (contract §Scope Evaluations) — the rubric-sheet QC
 * layer. Evaluations run automatically after every generation (see
 * generate.ts finalize) and on demand here; rows reach the Google sheet
 * through the configured Apps Script webhook.
 */

// GET /api/evals → { sheetUrl, connected, evaluations: ScopeEvaluationSummary[] }
api({
  name: 'evals-list',
  methods: ['GET'],
  route: 'evals',
  handler: async () => {
    const [evals, config] = await Promise.all([listEvaluations(), getEvalConfig()])
    return ok({
      sheetUrl: EVAL_SHEET_URL,
      connected: config.webhookUrl.length > 0,
      evaluations: evals.map(toEvaluationSummary).sort((a, b) => b.updated.localeCompare(a.updated)),
    })
  },
})

// PUT /api/evals/config { webhookUrl } → { connected } — the Apps Script web-app URL
api({
  name: 'evals-config',
  methods: ['PUT'],
  route: 'evals/config',
  handler: async (req) => {
    const body = await readJson<{ webhookUrl?: string }>(req)
    const webhookUrl = String(body.webhookUrl ?? '').trim().slice(0, 500)
    if (webhookUrl && !/^https:\/\/script\.google(?:usercontent)?\.com\//.test(webhookUrl)) {
      throw new HttpError(400, 'the webhook must be a Google Apps Script web-app URL (https://script.google.com/…)')
    }
    await saveEvalConfig({ webhookUrl })
    return ok({ connected: webhookUrl.length > 0 })
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

// POST /api/evals/{scopeId}/push → { exported } — retry the sheet write for a pending row
api({
  name: 'evals-push',
  methods: ['POST'],
  route: 'evals/{scopeId}/push',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const ev = await getEvaluationOrUndefined(scopeId)
    if (!ev) throw new HttpError(404, `no evaluation for scope ${scopeId}`)
    const config = await getEvalConfig()
    if (!config.webhookUrl) throw new HttpError(409, 'connect the sheet first (paste the Apps Script web-app URL)')
    // A stored row is only valid against the column layout it was built for.
    // If the sheet's headings have changed since, pushing would land verdicts
    // under the wrong rubrics — refuse and ask for a re-evaluation instead.
    if (ev.headings) {
      const model = await fetchEvalSheetModel()
      const current = model.columns.slice(0, model.columns.length - SME_COLUMN_COUNT).map((c) => c.heading)
      if (current.length !== ev.headings.length || current.some((h, i) => h !== ev.headings![i])) {
        throw new HttpError(409, 'the sheet\'s columns have changed since this evaluation ran — re-evaluate the scope, then push')
      }
    }
    try {
      await pushEvalRow(config.webhookUrl, scopeId, ev.values)
      ev.exportStatus = 'exported'
      delete ev.exportError
    } catch (e) {
      ev.exportError = e instanceof Error ? e.message : String(e)
      ev.exportStatus = 'pending-export'
      await saveEvaluation({ ...ev, updated: nowIso() })
      throw new HttpError(502, `the sheet webhook rejected the row: ${ev.exportError}`)
    }
    await saveEvaluation({ ...ev, updated: nowIso() })
    return ok({ exported: true })
  },
})
