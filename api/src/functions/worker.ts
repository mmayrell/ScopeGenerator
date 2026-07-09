import { app, InvocationContext } from '@azure/functions'
import { JobMessage, Proposal, Scope } from '../domain/types'
import { getSetOrUndefined, mutateScope, mutateSet, snapshotScope } from '../data/entities'
import { getPacketOrUndefined, mutatePacket } from '../data/packets'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { generateCardsStep, generateFinalizeStep, generatePlanStep } from '../pipeline/generate'
import { extractRunStep } from '../pipeline/ingest'
import { lsgRunStep } from '../pipeline/lsg'
import { mutateLsgRun } from '../data/lsg'
import { huntPacketStep } from '../pipeline/packets'
import { applyProposalRunStep, iterateRunStep, proposalRunStep } from '../pipeline/proposals'
import { rerunRunStep } from '../pipeline/rerun'
import { nowIso, today } from '../shared/util'

/** Must match host.json → extensions.queues.maxDequeueCount. */
const MAX_DEQUEUE_COUNT = 12 // keep in sync with host.json extensions.queues.maxDequeueCount

/**
 * Attempts a step may RUN before the worker refuses to re-run it (see the
 * circuit breaker in the handler). Distinct from MAX_DEQUEUE_COUNT, which only
 * bounds attempts whose errors we can catch — timeout kills bypass the catch.
 */
const RUN_ATTEMPT_CAP = 3

/**
 * Deterministic failures — the same input fails the same way every attempt, so
 * retrying only burns 10-minute windows and API spend. Fail fast.
 */
const TERMINAL_ERROR =
  /truncated \(max_tokens|declined this request|compiled grammar is too large|is password-protected|did not fit the 10-minute execution window/i

/**
 * Queue-triggered pipeline worker on `genjobs`, dispatching on
 * JobMessage.kind/step. The host delivers the base64-decoded JSON (typed as
 * unknown and validated here). Failure at any step after the queue's built-in
 * retries (maxDequeueCount 12) marks the job failed and settles the affected
 * document per job kind (see markFailed).
 */
app.storageQueue('genjobs-worker', {
  queueName: 'genjobs',
  connection: 'AzureWebJobsStorage',
  handler: async (queueItem: unknown, context: InvocationContext): Promise<void> => {
    let msg: JobMessage
    try {
      msg = parseJobMessage(queueItem)
    } catch (e) {
      // Malformed message — retrying can never succeed; log and consume it.
      context.error('genjobs-worker: dropping malformed queue message', queueItem, e)
      return
    }

    const dequeueCount = Number(
      (context.triggerMetadata?.dequeueCount as number | string | undefined) ?? 1,
    )
    // Circuit breaker: a high dequeue count means previous attempts died WITHOUT
    // reaching the catch below — the host kills the invocation at the 10-minute
    // functionTimeout (typically a Claude call that cannot fit) and the catch
    // never runs. Re-running just repeats the same expensive doomed call up to
    // maxDequeueCount times; fail the job visibly instead.
    if (dequeueCount > RUN_ATTEMPT_CAP) {
      context.error(
        `genjobs-worker: job ${msg.jobId} ${msg.kind}/${msg.step} exceeded ${RUN_ATTEMPT_CAP} attempts (dequeue ${dequeueCount}); previous attempts were killed before error handling could run - failing the job without re-running`,
      )
      await markFailed(
        msg,
        `Step was killed ${RUN_ATTEMPT_CAP} times before completing - almost certainly the 10-minute execution cap on a Claude call that does not fit. Reduce the request scope (e.g. plan one framework at a time), lower CLAUDE_EFFORT, or split the step.`,
        context,
      )
      return
    }
    try {
      await dispatch(msg, context)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      context.error(
        `genjobs-worker: job ${msg.jobId} ${msg.kind}/${msg.step} failed (attempt ${dequeueCount}/${MAX_DEQUEUE_COUNT}): ${message}`,
      )
      if (dequeueCount >= MAX_DEQUEUE_COUNT || TERMINAL_ERROR.test(message)) {
        await markFailed(msg, message, context)
        return // consume the message — the failure is now recorded
      }
      throw e // let the host retry
    }
  },
})

/**
 * Poison-queue settlement — the last line of defense against silent hangs.
 * The host moves a genjobs message here only after every delivery died
 * WITHOUT the worker recording anything: in practice the 10-minute execution
 * kill, which aborts the process mid-call and skips the catch block entirely.
 * Without this trigger the job row and its document (a scope stuck
 * 'generating', a set mid-ingest, a hunting packet) would hang forever with
 * no error and no way for the UI to offer retry/delete. Settlement is
 * kind-aware via markFailed; checkpoints are untouched, so retry resumes.
 */
app.storageQueue('genjobs-poison-worker', {
  queueName: 'genjobs-poison',
  connection: 'AzureWebJobsStorage',
  handler: async (queueItem: unknown, context: InvocationContext): Promise<void> => {
    let msg: JobMessage
    try {
      msg = parseJobMessage(queueItem)
    } catch (e) {
      context.error('genjobs-poison: dropping malformed message', queueItem, e)
      return
    }
    try {
      const job = await getJob(msg.jobId)
      if (job.status === 'complete' || job.status === 'cancelled') {
        context.log(`genjobs-poison: job ${msg.jobId} already ${job.status} — stale poison message dropped`)
        return
      }
    } catch (e) {
      // Job row gone (document deleted) — nothing to settle. Anything else
      // (transient table error) rethrows so the host redelivers.
      if ((e as { status?: number }).status === 404) return
      throw e
    }
    context.error(`genjobs-poison: settling job ${msg.jobId} ${msg.kind}/${msg.step} — every delivery died unrecorded`)
    await markFailed(
      msg,
      `The ${msg.kind}/${msg.step} step was killed by the platform's 10-minute execution cap on every attempt before it could record an error. Progress up to the last checkpoint is kept — retry resumes from there. If it keeps happening, narrow the request or lower CLAUDE_EFFORT.`,
      context,
    )
  },
})

function parseJobMessage(raw: unknown): JobMessage {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  if (typeof value !== 'object' || value === null) throw new Error('queue message is not an object')
  const m = value as Record<string, unknown>
  if (typeof m.jobId !== 'string' || typeof m.kind !== 'string' || typeof m.step !== 'string') {
    throw new Error('queue message missing jobId/kind/step')
  }
  return m as unknown as JobMessage
}

async function dispatch(msg: JobMessage, context: InvocationContext): Promise<void> {
  const route = `${msg.kind}/${msg.step}`
  context.log(`genjobs-worker: ${route} (job ${msg.jobId})`)
  switch (route) {
    case 'generate/plan':
      return generatePlanStep(msg, context)
    case 'generate/cards':
      return generateCardsStep(msg, context)
    case 'generate/finalize':
      return generateFinalizeStep(msg, context)
    case 'rerun/run':
      return rerunRunStep(msg, context)
    case 'proposal/run':
      return proposalRunStep(msg, context)
    case 'iterate/run':
      return iterateRunStep(msg, context)
    case 'apply-proposal/run':
      return applyProposalRunStep(msg, context)
    case 'ingest/run': // legacy queued messages route to extraction
    case 'ingest/extract':
      return extractRunStep(msg, context)
    case 'packet/hunt':
      return huntPacketStep(msg, context)
    case 'lsg/run':
      return lsgRunStep(msg, context)
    case 'ingest/lexicon':
      // The lexicon step was removed from the pipeline; settle legacy queued
      // messages cleanly instead of poisoning them.
      await mutateJob(msg.jobId, (r) => {
        r.status = 'complete'
        r.stagesDone = r.totalStages
        r.stage = 'Complete'
        pushLog(r, 'Lexicon step removed from the pipeline — nothing to do')
      })
      return
    default:
      throw new Error(`unknown job route: ${route}`)
  }
}

/**
 * Terminal failure: job → failed, then a kind-aware settlement of the document
 * state — only a failed `generate` may flip the scope to 'failed'; every other
 * kind restores/settles the state it was mutating so a perfectly good complete
 * scope (or published set) is never destroyed by a dead follow-up job.
 */
async function markFailed(msg: JobMessage, error: string, context: InvocationContext): Promise<void> {
  try {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'failed'
      r.stage = 'Failed'
      r.error = error
      pushLog(r, `Failed after ${MAX_DEQUEUE_COUNT} attempts: ${error}`)
    })
  } catch (e) {
    context.error(`genjobs-worker: could not mark job ${msg.jobId} failed`, e)
  }

  if (msg.kind === 'ingest') {
    await markIngestFailed(msg, error, context)
    return
  }
  if (msg.kind === 'packet') {
    await markPacketFailed(msg, error, context)
    return
  }
  if (msg.kind === 'lsg') {
    await markLsgFailed(msg, error, context)
    return
  }
  if (!msg.scopeId) return
  try {
    const settled = await mutateScope(msg.scopeId, (scope) => settleFailedScope(scope, msg, error))
    // A failed apply may have landed some units before dying (per-unit
    // commits); refresh the accept-time snapshot so the archived version
    // matches the live document instead of silently diverging from it.
    if (msg.kind === 'apply-proposal') await snapshotScope(settled)
  } catch (e) {
    context.error(`genjobs-worker: could not settle scope ${msg.scopeId} after job failure`, e)
  }
}

/** Kind-aware terminal-failure state (applied via mutateScope). */
function settleFailedScope(scope: Scope, msg: JobMessage, error: string): void {
  const proposalId = msg.payload ? String(msg.payload.proposalId ?? '') : ''
  const proposal: Proposal | undefined = proposalId
    ? scope.proposals.find((p) => p.id === proposalId)
    : undefined
  switch (msg.kind) {
    case 'generate':
      scope.status = 'failed'
      scope.error = error
      break
    case 'rerun':
      // The previous version is intact — return to it (version unchanged).
      scope.status = 'complete'
      delete scope.error
      scope.history.push({
        version: scope.version,
        date: today(),
        actor: scope.creator,
        event: 'Rerun failed',
        detail: error,
      })
      break
    case 'proposal':
      // Settle the proposal; scope status untouched.
      if (proposal) {
        proposal.status = 'abandoned'
        proposal.working = false
        proposal.rounds.push({ feedback: '', response: `Drafting failed: ${error}` })
      }
      break
    case 'iterate':
      // Proposal keeps its prior status; scope status untouched.
      if (proposal) {
        proposal.working = false
        proposal.rounds.push({
          feedback: msg.payload ? String(msg.payload.feedback ?? '') : '',
          response: `Revision failed: ${error}`,
        })
      }
      break
    case 'apply-proposal':
      // The accepted proposal stays accepted; scope returns to 'complete'.
      scope.status = 'complete'
      scope.history.push({
        version: scope.version,
        date: today(),
        actor: scope.creator,
        event: 'Revision apply failed',
        detail: error,
      })
      if (proposal) proposal.working = false
      break
  }
  scope.updated = today()
}

/**
 * Terminal packet-hunt failure: items found by completed batches are kept —
 * only the status flips, so the packet view can show partial evidence plus
 * the error instead of losing everything.
 */
async function markPacketFailed(msg: JobMessage, error: string, context: InvocationContext): Promise<void> {
  if (!msg.packetId) return
  try {
    if (!(await getPacketOrUndefined(msg.packetId))) return
    await mutatePacket(msg.packetId, (packet) => {
      if (packet.status === 'hunting') {
        packet.status = 'failed'
        packet.error = error
      }
      packet.updated = nowIso()
    })
  } catch (e) {
    context.error(`genjobs-worker: could not record hunt failure on packet ${msg.packetId}`, e)
  }
}

/**
 * Terminal LSG failure: settle the run 'failed' with the error so the UI can
 * surface it (checkpoints are kept — a future retry endpoint could resume).
 * The course registry is untouched: persist only happens on success.
 */
async function markLsgFailed(msg: JobMessage, error: string, context: InvocationContext): Promise<void> {
  if (!msg.lsgRunId) return
  try {
    await mutateLsgRun(msg.lsgRunId, (run) => {
      if (run.status === 'generating') {
        run.status = 'failed'
        run.error = error
      }
      run.updated = nowIso()
    })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status !== 404) context.error(`genjobs-worker: could not record failure on lsg run ${msg.lsgRunId}`, e)
  }
}

/**
 * Terminal ingest failure: the set stays unpublished, so surface a coverage
 * warning the frontend watches for (text starts with 'Ingestion failed').
 */
async function markIngestFailed(msg: JobMessage, error: string, context: InvocationContext): Promise<void> {
  if (!msg.setId) return
  try {
    if (!(await getSetOrUndefined(msg.setId))) return
    await mutateSet(msg.setId, (set) => {
      set.warnings.push({
        id: `${set.id}-ingfail-${Date.now()}`,
        text: `Ingestion failed: ${error}. Fix the uploads and retry.`,
        kind: 'gap',
        suggestion: 'Re-upload the affected document and re-run extraction; the pipeline resumes from the failed step.',
        acknowledged: false,
      })
      set.updated = today()
    })
  } catch (e) {
    context.error(`genjobs-worker: could not record ingest failure on set ${msg.setId}`, e)
  }
}
