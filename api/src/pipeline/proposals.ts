import { InvocationContext } from '@azure/functions'
import { JobMessage, Lesson, Proposal, Scope } from '../domain/types'
import { getScope, getSet, mutateScope, snapshotScope } from '../data/entities'
import { mutateJob, pushLog } from '../data/jobs'
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
  const set = await getSet(scope.setId)

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
 * accepted change set; relational fields of adjacent lessons updated; locked
 * lessons queue suggestions. The version was already bumped (and history
 * written) at accept time; the snapshot is refreshed so the immutable version
 * reflects the applied change set.
 */
export async function applyProposalRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const { scope, proposal } = await loadProposal(msg)
  const set = await getSet(scope.setId)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = 'Stage 5 — Applying the accepted change set'
    pushLog(r, `Applying proposal ${proposal.id} on ${proposal.report.target}`)
  })

  const targetLessonId = proposal.report.target.match(/U\d+\.L\d+/)?.[0]
  const located = targetLessonId ? findLesson(scope.units, targetLessonId) : undefined
  const unit = located?.unit ?? scope.units.find((u) => proposal.report.target.startsWith(u.id))
  // No first-unit fallback: applying against the wrong unit would silently
  // no-op; failing loudly lets the worker's apply-proposal failure path
  // surface the error to the user.
  if (!unit) {
    throw new Error(
      `apply-proposal: target "${proposal.report.target}" resolves to neither a lesson nor a unit in scope ${scope.id}`,
    )
  }

  const out = await generateStructured<WireApplyOutput>({
    ...applyPrompt(scope, set, unit, proposal),
    schema: APPLY_SCHEMA,
    effort: 'medium', // interactive latency; fits the 10-min Consumption cap
  })

  const validItemIds = new Set(set.items.map((it) => it.id))
  const explicitTargets = new Set(
    proposal.changes.map((c) => c.target.match(/U\d+\.L\d+/)?.[0]).filter((t): t is string => !!t),
  )
  const updated = await mutateScope(scope.id, (s) => {
    const p = findProposalOn(s, proposal.id)
    const freshUnit = s.units.find((u) => u.id === unit.id)
    if (!freshUnit) throw new Error(`apply-proposal: unit ${unit.id} no longer exists in scope ${s.id}`)
    const byId = new Map(freshUnit.lessons.map((l) => [l.id, l] as const))
    for (const wire of out.lessons ?? []) {
      const existing = byId.get(wire.id)
      if (!existing) continue // ignore lessons outside the unit
      // Locked lessons are rewritten only when explicitly targeted by the accepted
      // change set — "acceptance is the approval the lock requires" (spec §8).
      if (existing.locked && !explicitTargets.has(existing.id)) continue
      const rewritten: Lesson = { ...toLesson(wire, validItemIds), id: existing.id, locked: existing.locked }
      byId.set(existing.id, rewritten)
    }
    for (const sug of out.lockedSuggestions ?? []) {
      const existing = byId.get(sug.lessonId)
      if (existing && existing.locked) {
        byId.set(sug.lessonId, { ...existing, pendingRelationalUpdate: sug.suggestion })
      }
    }
    freshUnit.lessons = freshUnit.lessons.map((l) => byId.get(l.id) ?? l)
    p.working = false
    s.updated = today()
  })
  await snapshotScope(updated) // refresh v<version> written at accept time

  await completeJob(msg.jobId, `Accepted change set applied to ${unit.id}; locked lessons queued ${out.lockedSuggestions?.length ?? 0} suggestion(s)`)
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
