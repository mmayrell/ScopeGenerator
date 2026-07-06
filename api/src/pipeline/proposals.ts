import { InvocationContext } from '@azure/functions'
import { JobMessage, Lesson, Proposal, Scope } from '../domain/types'
import { getScope, getScopeEvidenceSet, mutateScope, snapshotScope } from '../data/entities'
import { mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { applyPrompt, iteratePrompt, proposalPrompt } from '../services/prompts'
import {
  APPLY_SCHEMA,
  ITERATE_SCHEMA,
  PROPOSAL_SCHEMA,
  toLesson,
  toProposalChange,
  WireApplyOutput,
  WireIterateOutput,
  WireProposalOutput,
} from '../services/schemas'
import { today } from '../shared/util'
import { findLesson } from './qc'

/**
 * Kind `proposal` (contract §Other kinds): Claude maps the PerformanceReport
 * onto Editing-Splits logic (spec §8) → ProposalChange[] + ripple, replacing
 * the old keyword heuristic. Sets the proposal to `draft`, working: false.
 */
export async function proposalRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const { scope, proposal } = await loadProposal(msg)
  const set = await getScopeEvidenceSet(scope)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    // Singular 'Stage' — the frontend parses the label with /stage\s*(\d+)/i.
    r.stage = 'Stage 3–5 — Drafting proposal from the PerformanceReport'
    pushLog(r, `Mapping report on ${proposal.report.target} onto Editing-Splits logic`)
  })

  const out = await generateStructured<WireProposalOutput>({
    ...proposalPrompt(scope, set, proposal.report),
    schema: PROPOSAL_SCHEMA,
    effort: 'medium', // interactive latency; fits the 10-min Consumption cap
  })
  if (!out.changes || out.changes.length === 0) {
    throw new Error('proposal drafting produced an empty change set')
  }

  const changes = out.changes.map(toProposalChange)
  await mutateScope(scope.id, (s) => {
    const p = findProposalOn(s, proposal.id)
    p.changes = changes
    p.ripple = out.ripple
    p.status = 'draft'
    p.working = false
    s.updated = today()
  })

  await completeJob(msg.jobId, `Draft ready: ${changes.length} change(s), ${out.ripple.length} ripple entr${out.ripple.length === 1 ? 'y' : 'ies'}`)
  ctx.log(`proposal/run ${msg.jobId}: proposal ${proposal.id} drafted`)
}

/**
 * Kind `iterate`: Claude revises the draft given feedback → appends the
 * { feedback, response } round and may update the change set.
 */
export async function iterateRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const { scope, proposal } = await loadProposal(msg)
  const feedback = String((msg.payload ?? {}).feedback ?? '')

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = 'Revising proposal on user feedback'
    pushLog(r, `Iterating proposal ${proposal.id}`)
  })

  const out = await generateStructured<WireIterateOutput>({
    ...iteratePrompt(scope, proposal, feedback),
    schema: ITERATE_SCHEMA,
    effort: 'medium', // interactive latency; fits the 10-min Consumption cap
  })

  let rounds = 0
  await mutateScope(scope.id, (s) => {
    const p = findProposalOn(s, proposal.id)
    p.rounds.push({ feedback, response: out.response })
    if (out.changes && out.changes.length > 0) {
      p.changes = out.changes.map(toProposalChange)
    }
    p.working = false
    s.updated = today()
    rounds = p.rounds.length
  })

  await completeJob(msg.jobId, `Round ${rounds} appended${out.changes.length > 0 ? '; change set revised' : ''}`)
  ctx.log(`iterate/run ${msg.jobId}: proposal ${proposal.id} round ${rounds}`)
}

/**
 * Kind `apply-proposal`: Claude rewrites the targeted lesson fields per the
 * accepted change set; relational fields of adjacent lessons updated. The
 * version was already bumped (and history written) at accept time; the
 * snapshot is refreshed so the immutable version reflects the applied
 * change set.
 */
// Each per-unit apply call is unbatched and can realistically run 3-5 minutes
// (plus SDK backoff); stop starting new calls with this much of the invocation
// spent and re-enqueue for the rest — a call starting at the budget line still
// has ~5.5 minutes of the 10-minute functionTimeout to finish.
const APPLY_TIME_BUDGET_MS = 4.5 * 60 * 1000

/** The unit id a change target names: a lesson ref's unit, or a bare unit ref. */
const changeUnitId = (target: string): string | undefined =>
  target.match(/U\d+(?=\.L\d+)/)?.[0] ?? target.match(/\bU\d+\b/)?.[0]

export async function applyProposalRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const started = Date.now()
  const { scope, proposal } = await loadProposal(msg)
  const set = await getScopeEvidenceSet(scope)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = 'Stage 5 — Applying the accepted change set'
    pushLog(r, `Applying proposal ${proposal.id} on ${proposal.report.target}`)
  })

  // Resolve the affected units: the union of the report target (a lesson's
  // unit, or a unit) and every unit the accepted change set names — a change
  // target carries either a lesson ref or a bare unit ref. Changes whose
  // target names neither are logged loudly as skipped; if NOTHING resolves,
  // fail loudly rather than silently no-op against the wrong unit.
  const targetLessonId = proposal.report.target.match(/U\d+\.L\d+/)?.[0]
  const located = targetLessonId ? findLesson(scope.units, targetLessonId) : undefined
  const direct = located?.unit ?? scope.units.find((u) => proposal.report.target.startsWith(u.id))
  const unitIds = new Set<string>(direct ? [direct.id] : [])
  const skippedTargets: string[] = []
  for (const c of proposal.changes) {
    const uid = changeUnitId(c.target)
    if (uid && scope.units.some((u) => u.id === uid)) unitIds.add(uid)
    else if (!direct) skippedTargets.push(c.target)
  }
  const affected = scope.units.filter((u) => unitIds.has(u.id))
  if (skippedTargets.length > 0) {
    await mutateJob(msg.jobId, (r) =>
      pushLog(r, `Accepted change(s) skipped — target names no unit in this scope: ${skippedTargets.join(' | ')}`),
    )
    ctx.warn(`apply-proposal ${msg.jobId}: ${skippedTargets.length} change(s) with unresolvable targets skipped`)
  }
  if (affected.length === 0) {
    throw new Error(
      `apply-proposal: target "${proposal.report.target}" and the accepted change set resolve to no unit in scope ${scope.id}`,
    )
  }

  // A redelivered or re-enqueued attempt must never re-apply a unit — the
  // change set is not idempotent against its own output. The authoritative
  // checkpoint is proposal.appliedUnits, written ATOMICALLY with each unit's
  // rewrite inside the same mutateScope commit (the job row copy is a log).
  const done = new Set<string>(proposal.appliedUnits ?? [])
  const remaining = affected.filter((u) => !done.has(u.id))

  const validItemIds = new Set(set.items.map((it) => it.id))
  let processed = 0
  for (const unit of remaining) {
    if (processed > 0 && Date.now() - started > APPLY_TIME_BUDGET_MS) {
      await enqueueJob({ jobId: msg.jobId, kind: msg.kind, step: msg.step, scopeId: msg.scopeId, payload: msg.payload })
      await mutateJob(msg.jobId, (r) =>
        pushLog(r, `Applied to ${processed} unit(s) this pass — continuing with the remaining ${remaining.length - processed} in a fresh invocation`),
      )
      ctx.log(`apply-proposal/run ${msg.jobId}: time budget reached — re-enqueued for remaining units`)
      return
    }
    const out = await generateStructured<WireApplyOutput>({
      ...applyPrompt(scope, set, unit, proposal),
      schema: APPLY_SCHEMA,
      effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      // Bounded below the 64k default: an output large enough to need more
      // cannot finish streaming inside the invocation anyway, so fail fast
      // (truncation is terminal in the worker) instead of riding into the
      // host-timeout kill that records nothing.
      maxTokens: 40000,
    })

    await mutateScope(scope.id, (s) => {
      const p = findProposalOn(s, proposal.id)
      if ((p.appliedUnits ?? []).includes(unit.id)) return // another attempt won the race
      const freshUnit = s.units.find((u) => u.id === unit.id)
      if (!freshUnit) throw new Error(`apply-proposal: unit ${unit.id} no longer exists in scope ${s.id}`)
      const byId = new Map(freshUnit.lessons.map((l) => [l.id, l] as const))
      for (const wire of out.lessons ?? []) {
        const existing = byId.get(wire.id)
        if (!existing) continue // ignore lessons outside the unit
        byId.set(existing.id, { ...toLesson(wire, validItemIds), id: existing.id } satisfies Lesson)
      }
      freshUnit.lessons = freshUnit.lessons.map((l) => byId.get(l.id) ?? l)
      p.appliedUnits = [...(p.appliedUnits ?? []), unit.id]
      s.updated = today()
    })
    done.add(unit.id)
    processed++
    await mutateJob(msg.jobId, (r) => pushLog(r, `Accepted changes applied to ${unit.id}`))
  }

  const updated = await mutateScope(scope.id, (s) => {
    findProposalOn(s, proposal.id).working = false
    s.updated = today()
  })
  await snapshotScope(updated) // refresh v<version> written at accept time

  await completeJob(msg.jobId, `Accepted change set applied to ${[...done].join(', ') || 'no units'}`)
  ctx.log(`apply-proposal/run ${msg.jobId}: proposal ${proposal.id} applied`)
}

async function loadProposal(msg: JobMessage): Promise<{ scope: Scope; proposal: Proposal }> {
  if (!msg.scopeId) throw new Error(`${msg.kind} message missing scopeId`)
  const proposalId = String((msg.payload ?? {}).proposalId ?? '')
  const scope = await getScope(msg.scopeId)
  return { scope, proposal: findProposalOn(scope, proposalId) }
}

function findProposalOn(scope: Scope, proposalId: string): Proposal {
  const proposal = scope.proposals.find((p) => p.id === proposalId)
  if (!proposal) throw new Error(`proposal ${proposalId} not found on scope ${scope.id}`)
  return proposal
}

async function completeJob(jobId: string, detail: string): Promise<void> {
  await mutateJob(jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(r, detail)
  })
}
