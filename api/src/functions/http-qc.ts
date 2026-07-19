import { Lesson, QcCriterion, QcInvestigation, QcLocation, QcNote, QcNoteType, QcPlanStep, QcRepairDecision, StandardSet } from '../domain/types'
import { DECK_CONTEXT_SET, DEFAULT_CRITERIA } from '../data/qc-defaults'
import { getScope, mutateScope } from '../data/entities'
import {
  deleteQcDocs,
  getBar,
  getDeck,
  getInvestigationLog,
  getNoteLedger,
  getQcReportOrUndefined,
  listQcReports,
  mutateBar,
  mutateDeck,
  mutateInvestigationLog,
  mutateNoteLedger,
  mutateQcReport,
  toQcReportSummary,
} from '../data/qc'
import { createJob, latestQcJobForScope, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { getScopeEvidenceSet } from '../data/entities'
import { buildCheckContext, dryRunCriterion, testBarAgainstDeck } from '../pipeline/qc-bar'
import { HttpError } from '../shared/errors'
import { api, ok, readJson, requireParam } from '../shared/http'
import { ACTOR, newId, nowIso, today } from '../shared/util'

/**
 * Quality Control (contract §Quality Control — the QC Bar). The tab is the
 * AUTOMATIC report surface: generation produces a QC Report for every scope;
 * this API serves the reports, the note→investigation loop (accepting a card
 * repair APPLIES it as a new scope version), the sweep dispatch, and the Bar
 * itself (criteria, escalation plan, dry-run, test deck).
 */

const NOTE_TYPES: QcNoteType[] = ['rigor', 'granularity', 'sequencing', 'wording', 'evidence', 'contradiction', 'other']

// GET /api/qc → { reports: QcReportSummary[] }
api({
  name: 'qc-list',
  methods: ['GET'],
  route: 'qc',
  handler: async () => {
    const reports = await listQcReports()
    const summaries = await Promise.all(
      reports.map(async (report) => {
        const ledger = await getNoteLedger(report.scopeId)
        return toQcReportSummary(report, ledger.notes.filter((n) => n.status === 'open' || n.status === 'investigating').length)
      }),
    )
    return ok({ reports: summaries.sort((a, b) => b.updated.localeCompare(a.updated)) })
  },
})

// GET /api/qc/bar → { bar, deck } — the Bar page payload
// PUT /api/qc/bar { criteria?, escalationPlan? } → bar (barVersion bumps; applies to future generation)
api({
  name: 'qc-bar',
  methods: ['GET', 'PUT'],
  route: 'qc/bar',
  handler: async (req) => {
    if (req.method === 'GET') {
      const [bar, deck] = await Promise.all([getBar(), getDeck()])
      return ok({ bar, deck })
    }
    const body = await readJson<{ criteria?: QcCriterion[]; escalationPlan?: QcPlanStep[] }>(req)
    if (body.criteria !== undefined) {
      if (!Array.isArray(body.criteria) || body.criteria.length === 0) throw new HttpError(400, 'criteria must be a non-empty array')
      for (const c of body.criteria) {
        if (!c.id || !c.title || !c.rule) throw new HttpError(400, 'every criterion needs id, title, and rule')
        if (!['lesson', 'course'].includes(c.level)) throw new HttpError(400, `criterion ${c.id}: level must be lesson | course`)
        if (!['automatic', 'ai-judged'].includes(c.method)) throw new HttpError(400, `criterion ${c.id}: method must be automatic | ai-judged`)
        if (!['blocking', 'advisory'].includes(c.severity)) throw new HttpError(400, `criterion ${c.id}: severity must be blocking | advisory`)
      }
      const ids = body.criteria.map((c) => c.id)
      if (new Set(ids).size !== ids.length) throw new HttpError(400, 'criterion ids must be unique')
      // An automatic criterion is bound to a built-in check at a fixed level —
      // flipping the level would silently orphan the check while the rule
      // text still displays as enforced.
      const autoLevels = new Map(DEFAULT_CRITERIA.filter((c) => c.autoCheckId).map((c) => [c.autoCheckId as string, c.level]))
      for (const c of body.criteria) {
        if (c.autoCheckId) {
          const bound = autoLevels.get(c.autoCheckId)
          if (bound && c.level !== bound) {
            throw new HttpError(400, `criterion ${c.id}: its built-in check runs at ${bound} level — the level cannot change (disable it instead)`)
          }
        }
      }
    }
    if (body.escalationPlan !== undefined) {
      if (!Array.isArray(body.escalationPlan) || body.escalationPlan.length === 0 || body.escalationPlan.length > 8) {
        throw new HttpError(400, 'escalationPlan must be 1-8 steps')
      }
      if (body.escalationPlan.some((s) => !['revise', 'fresh-start'].includes(s))) {
        throw new HttpError(400, 'escalationPlan steps must be revise | fresh-start')
      }
    }
    const bar = await mutateBar((b) => {
      if (body.criteria !== undefined) {
        // Preserve accumulated stats across edits (the track record survives rewording).
        const priorStats = new Map(b.criteria.map((c) => [c.id, c.stats]))
        b.criteria = body.criteria!.map((c) => ({ ...c, stats: priorStats.get(c.id) ?? c.stats ?? { firstDraftFails: 0, judgedLessons: 0, redFlagInvolvements: 0 } }))
      }
      if (body.escalationPlan !== undefined) b.escalationPlan = body.escalationPlan!
    })
    return ok(bar)
  },
})

// POST /api/qc/bar/dry-run { criterionId?, rule?, title?, scopeId, lessonId } → QcDryRunResult
// Debug a criterion's wording against a real lesson card before it governs generation.
api({
  name: 'qc-bar-dry-run',
  methods: ['POST'],
  route: 'qc/bar/dry-run',
  handler: async (req) => {
    const body = await readJson<{ criterionId?: string; rule?: string; title?: string; scopeId?: string; lessonId?: string }>(req)
    const scopeId = String(body.scopeId ?? '')
    const lessonId = String(body.lessonId ?? '')
    if (!scopeId || !lessonId) throw new HttpError(400, 'scopeId and lessonId are required')
    const scope = await getScope(scopeId)
    const lesson = scope.units.flatMap((u) => u.lessons).find((l) => l.id === lessonId)
    if (!lesson) throw new HttpError(404, `no lesson ${lessonId} in scope ${scopeId}`)
    const bar = await getBar()
    let criterion: QcCriterion
    if (body.criterionId) {
      const found = bar.criteria.find((c) => c.id === body.criterionId)
      if (!found) throw new HttpError(404, `no criterion ${body.criterionId} on the bar`)
      criterion = found
    } else {
      const rule = String(body.rule ?? '').trim()
      if (!rule) throw new HttpError(400, 'either criterionId or a draft rule is required')
      criterion = {
        id: 'draft-criterion',
        title: String(body.title ?? 'Draft criterion').slice(0, 120),
        rule: rule.slice(0, 2000),
        level: 'lesson',
        method: 'ai-judged',
        severity: 'advisory',
        shownToWriter: false,
        enabled: true,
        stats: { firstDraftFails: 0, judgedLessons: 0, redFlagInvolvements: 0 },
      }
    }
    const set = await getScopeEvidenceSet(scope)
    const ctx = buildCheckContext(set, new Set())
    const result = await dryRunCriterion(criterion, lesson, ctx)
    return ok(result)
  },
})

// POST /api/qc/bar/test → QcDeckRunResult — run the current bar against the
// broken-card deck; per-criterion lastDeckRun stats update.
api({
  name: 'qc-bar-test',
  methods: ['POST'],
  route: 'qc/bar/test',
  handler: async () => {
    const [bar, deck] = await Promise.all([getBar(), getDeck()])
    if (deck.cards.length === 0) throw new HttpError(409, 'the test deck is empty')
    // The deck's own evidence context — the fixtures cite these codes, so
    // quote-fidelity/citation-resolution genuinely fire (an empty tree would
    // vacuously pass the miscited-quote card forever).
    const ctx = buildCheckContext(DECK_CONTEXT_SET as unknown as StandardSet, new Set())
    const result = await testBarAgainstDeck(bar, deck.cards, ctx)
    const at = nowIso()
    await mutateBar(
      (b) => {
        for (const c of b.criteria) {
          const relevant = result.perCard.filter((p) => p.expected.includes(c.id))
          if (relevant.length === 0) continue
          c.stats.lastDeckRun = {
            caught: relevant.filter((p) => p.caughtIds.includes(c.id)).length,
            missed: relevant.filter((p) => p.missedIds.includes(c.id)).length,
            at,
          }
        }
      },
      { bumpVersion: false },
    )
    return ok(result)
  },
})

// POST /api/qc/bar/deck { label, expectedCriterionIds, scopeId, lessonId } → QcDeckCard (201)
// Add a REAL card that taught you something to the deck.
// DELETE /api/qc/bar/deck/{cardId} → { ok } (added cards only — built-ins stay)
api({
  name: 'qc-bar-deck',
  methods: ['POST'],
  route: 'qc/bar/deck',
  handler: async (req) => {
    const body = await readJson<{ label?: string; expectedCriterionIds?: string[]; scopeId?: string; lessonId?: string }>(req)
    const label = String(body.label ?? '').slice(0, 400).trim()
    const expected = Array.isArray(body.expectedCriterionIds) ? body.expectedCriterionIds.map(String) : []
    if (!label || expected.length === 0) throw new HttpError(400, 'label and expectedCriterionIds are required')
    const scope = await getScope(String(body.scopeId ?? ''))
    const lesson = scope.units.flatMap((u) => u.lessons).find((l) => l.id === String(body.lessonId ?? ''))
    if (!lesson) throw new HttpError(404, 'no such lesson')
    const card = { id: newId('deck'), label, expectedCriterionIds: expected, lesson: lesson as Lesson, source: 'added' as const, added: nowIso() }
    await mutateDeck((d) => d.cards.push(card))
    return ok(card, 201)
  },
})

api({
  name: 'qc-bar-deck-delete',
  methods: ['DELETE'],
  route: 'qc/bar/deck/{cardId}',
  handler: async (req) => {
    const cardId = requireParam(req, 'cardId')
    await mutateDeck((d) => {
      const card = d.cards.find((c) => c.id === cardId)
      if (!card) throw new HttpError(404, `no deck card ${cardId}`)
      if (card.source === 'built-in') throw new HttpError(409, 'built-in deck cards cannot be removed — disable the criterion instead')
      d.cards = d.cards.filter((c) => c.id !== cardId)
    })
    return ok({ ok: true })
  },
})

// GET /api/qc/{scopeId} → { report, notes, investigations }
// DELETE /api/qc/{scopeId} → { ok } — delete the QC record (the scope is untouched)
api({
  name: 'qc-get-delete',
  methods: ['GET', 'DELETE'],
  route: 'qc/{scopeId}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    if (scopeId === 'bar') throw new HttpError(404, 'reserved')
    if (req.method === 'DELETE') {
      const job = await latestQcJobForScope(scopeId)
      if (job && (job.status === 'queued' || job.status === 'running')) {
        await mutateJob(job.jobId, (r) => {
          r.cancelRequested = true
          pushLog(r, 'QC docs deleted — the run stops at its next checkpoint')
        })
      }
      await deleteQcDocs(scopeId)
      return ok({ ok: true })
    }
    const report = await getQcReportOrUndefined(scopeId)
    if (!report) throw new HttpError(404, `no QC report for scope ${scopeId}`)
    const ledger = await getNoteLedger(scopeId)
    const log = await getInvestigationLog(scopeId)
    return ok({ report, notes: ledger.notes, investigations: log.investigations })
  },
})

// POST /api/qc/{scopeId}/sweep → { jobId } (202) — apply the CURRENT bar to an
// existing scope; the improved course saves as a NEW numbered version.
api({
  name: 'qc-sweep',
  methods: ['POST'],
  route: 'qc/{scopeId}/sweep',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    if (scope.status !== 'complete') throw new HttpError(409, 'only a completed scope can be swept')
    const inFlight = await latestQcJobForScope(scopeId)
    if (inFlight && (inFlight.status === 'queued' || inFlight.status === 'running')) {
      throw new HttpError(409, 'a QC job is already queued or running for this scope — wait for it to finish')
    }
    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'qc',
        scopeId,
        totalStages: scope.units.length + 1,
        stage: 'Queued',
        detail: `QC sweep dispatched for "${scope.title}"`,
      })
      await enqueueJob({ jobId, kind: 'qc', step: 'sweep', scopeId })
    } catch (e) {
      await mutateJob(jobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the sweep'
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId }, 202)
  },
})

// POST /api/qc/{scopeId}/notes { location?, type, note } → QcNote (201)
api({
  name: 'qc-note-create',
  methods: ['POST'],
  route: 'qc/{scopeId}/notes',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    const body = await readJson<{ location?: QcLocation; type?: string; note?: string }>(req)
    const type = String(body.type ?? '').trim() as QcNoteType
    if (!NOTE_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${NOTE_TYPES.join(' | ')}`)
    const text = String(body.note ?? '')
      .slice(0, 4000)
      .trim()
    if (text.length === 0) throw new HttpError(400, 'a note needs text — it is a question the investigation answers')
    const location: QcLocation = {}
    if (body.location?.unitId) location.unitId = String(body.location.unitId).slice(0, 40)
    if (body.location?.lessonId) location.lessonId = String(body.location.lessonId).slice(0, 40)
    if (body.location?.field) location.field = String(body.location.field).slice(0, 60)
    const note: QcNote = {
      id: newId('note'),
      location,
      type,
      note: text,
      scopeVersion: scope.updated,
      status: 'open',
      raised: nowIso(),
    }
    await mutateNoteLedger(scopeId, (l) => l.notes.push(note))
    return ok(note, 201)
  },
})

// DELETE /api/qc/{scopeId}/notes/{noteId} → { ok } — withdraw an OPEN note
api({
  name: 'qc-note-delete',
  methods: ['DELETE'],
  route: 'qc/{scopeId}/notes/{noteId}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const noteId = requireParam(req, 'noteId')
    await mutateNoteLedger(scopeId, (l) => {
      const note = l.notes.find((n) => n.id === noteId)
      if (!note) throw new HttpError(404, `no note ${noteId}`)
      if (note.status !== 'open') throw new HttpError(409, 'only an open note can be withdrawn — investigated notes are the audit trail')
      l.notes = l.notes.filter((n) => n.id !== noteId)
    })
    return ok({ ok: true })
  },
})

// POST /api/qc/{scopeId}/investigate { noteIds? } → { jobId, investigationId } (202)
api({
  name: 'qc-investigate',
  methods: ['POST'],
  route: 'qc/{scopeId}/investigate',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const scope = await getScope(scopeId)
    const body = await readJson<{ noteIds?: string[] }>(req).catch(() => ({}) as { noteIds?: string[] })
    const ledger = await getNoteLedger(scopeId)
    const wanted = Array.isArray(body.noteIds) && body.noteIds.length > 0 ? new Set(body.noteIds.map(String)) : undefined
    const targets = ledger.notes.filter((n) => n.status === 'open' && (wanted === undefined || wanted.has(n.id)))
    if (targets.length === 0) throw new HttpError(409, 'no open notes to investigate')

    const investigationId = newId('inv')
    const inv: QcInvestigation = {
      id: investigationId,
      scopeId,
      noteIds: targets.map((n) => n.id),
      status: 'running',
      verdicts: [],
      patternSweep: [],
      proposedRepairs: [],
      repairDecisions: [],
      proposedCriteria: [],
      contradictionReports: [],
      created: nowIso(),
      updated: nowIso(),
    }
    await mutateInvestigationLog(scopeId, (l) => l.investigations.push(inv))
    await mutateNoteLedger(scopeId, (l) => {
      for (const n of l.notes) if (inv.noteIds.includes(n.id)) n.status = 'investigating'
    })

    const jobId = newId('job')
    try {
      await createJob({
        jobId,
        kind: 'qc',
        scopeId,
        totalStages: 1,
        stage: 'Queued',
        detail: `Investigation of ${targets.length} note(s) on "${scope.title}"`,
      })
      await enqueueJob({ jobId, kind: 'qc', step: 'investigate', scopeId, payload: { investigationId } })
    } catch (e) {
      await mutateInvestigationLog(scopeId, (l) => {
        const target = l.investigations.find((i) => i.id === investigationId)
        if (target) {
          target.status = 'failed'
          target.error = 'Failed to dispatch the investigation job'
          target.updated = nowIso()
        }
      }).catch(() => undefined)
      await mutateNoteLedger(scopeId, (l) => {
        for (const n of l.notes) if (inv.noteIds.includes(n.id) && n.status === 'investigating') n.status = 'open'
      }).catch(() => undefined)
      await mutateJob(jobId, (r) => {
        r.status = 'failed'
        r.error = 'Failed to dispatch the investigation job'
      }).catch(() => undefined)
      throw e
    }
    return ok({ jobId, investigationId }, 202)
  },
})

// PUT /api/qc/{scopeId}/investigations/{invId}/repairs/{index} { decision, editedText?, reason }
// → QcInvestigation. ACCEPT (or EDIT) APPLIES THE REPAIR: the diff lands on
// the scope as a NEW numbered version (the old one is kept in history) —
// this is the explicitly requested regeneration path.
api({
  name: 'qc-repair-decision',
  methods: ['PUT'],
  route: 'qc/{scopeId}/investigations/{invId}/repairs/{index}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const invId = requireParam(req, 'invId')
    const index = Number(requireParam(req, 'index'))
    const body = await readJson<{ decision?: string; editedText?: string; reason?: string }>(req)
    const decision = String(body.decision ?? '').trim() as QcRepairDecision['decision']
    if (!['accept', 'edit', 'reject'].includes(decision)) throw new HttpError(400, 'decision must be accept | edit | reject')
    const reason = String(body.reason ?? '')
      .slice(0, 2000)
      .trim()
    if (reason.length === 0) throw new HttpError(400, 'every repair decision requires a reason')

    const log = await getInvestigationLog(scopeId)
    const inv = log.investigations.find((i) => i.id === invId)
    if (!inv) throw new HttpError(404, `no investigation ${invId}`)
    if (!Number.isInteger(index) || index < 0 || index >= inv.proposedRepairs.length) {
      throw new HttpError(400, `repair index out of range (0..${inv.proposedRepairs.length - 1})`)
    }
    if (inv.repairDecisions.some((d) => d.repairIndex === index && (d.decision === 'accept' || d.decision === 'edit') && d.appliedVersion !== undefined)) {
      throw new HttpError(409, 'this repair was already applied')
    }
    const repair = inv.proposedRepairs[index]
    const entry: QcRepairDecision = { repairIndex: index, decision, reason, decided: nowIso() }
    if (decision === 'edit') {
      const editedText = String(body.editedText ?? '').trim()
      if (editedText.length === 0) throw new HttpError(400, 'an edit decision carries the edited text')
      entry.editedText = editedText.slice(0, 12000)
    }

    if (decision === 'accept' || decision === 'edit') {
      const replacement = decision === 'edit' ? (entry.editedText as string) : repair.proposedText
      const updated = await mutateScope(scopeId, (s) => {
        const lesson = s.units.flatMap((u) => u.lessons).find((l) => l.id === repair.lessonId)
        if (!lesson) throw new HttpError(404, `lesson ${repair.lessonId} no longer exists in the scope`)
        const field = repair.field as keyof Lesson['fields']
        const target = lesson.fields[field]
        if (!target) throw new HttpError(400, `lesson ${repair.lessonId} has no field "${repair.field}"`)
        // Precise diffs only: a diff whose excerpt no longer matches the live
        // field must NOT clobber the whole field — the field has moved on
        // since the investigation ran.
        if (!target.content.includes(repair.currentExcerpt)) {
          throw new HttpError(
            409,
            `the diff no longer matches — "${repair.field}" on ${repair.lessonId} has changed since the investigation ran. Re-run the investigation for a fresh diff.`,
          )
        }
        target.content = target.content.replace(repair.currentExcerpt, replacement)
        target.rationale = `${(target.rationale ?? '').trim()}\nQC repair (investigation ${invId}): ${repair.decisionRecord}`.trim()
        s.version += 1
        s.updated = today()
        s.history.unshift({
          version: s.version,
          date: today(),
          actor: ACTOR,
          event: 'QC repair applied',
          detail: `${repair.lessonId} ${repair.field}: ${reason.slice(0, 160)} (investigation ${invId}; the previous version is retained in history)`,
        })
      })
      entry.appliedVersion = updated.version
      // The repaired scope should re-face the bar — flag the report stale so
      // the tab shows it, and let the user run the sweep when ready (a full
      // automatic re-sweep per repair would be disproportionate).
      await mutateQcReport(scopeId, (r) => {
        r.scopeVersion = updated.updated
      }).catch(() => undefined)
    }

    let updatedInv: QcInvestigation | undefined
    await mutateInvestigationLog(scopeId, (l) => {
      const target = l.investigations.find((i) => i.id === invId)
      if (!target) throw new HttpError(404, `no investigation ${invId}`)
      target.repairDecisions = [...target.repairDecisions.filter((d) => d.repairIndex !== index), entry]
      target.updated = nowIso()
      updatedInv = target
    })
    return ok(updatedInv)
  },
})

// PUT /api/qc/{scopeId}/investigations/{invId}/criteria/{index} { decision, reason }
// → QcInvestigation. Accepting a drafted criterion appends it to the bar AND
// adds the offending card to the test deck — your notes literally teach the bar.
api({
  name: 'qc-criterion-decision',
  methods: ['PUT'],
  route: 'qc/{scopeId}/investigations/{invId}/criteria/{index}',
  handler: async (req) => {
    const scopeId = requireParam(req, 'scopeId')
    const invId = requireParam(req, 'invId')
    const index = Number(requireParam(req, 'index'))
    const body = await readJson<{ decision?: string; reason?: string }>(req)
    const decision = String(body.decision ?? '').trim()
    if (!['accept', 'reject'].includes(decision)) throw new HttpError(400, 'decision must be accept | reject')
    const reason = String(body.reason ?? '')
      .slice(0, 2000)
      .trim()
    if (reason.length === 0) throw new HttpError(400, 'every decision requires a reason')

    const log = await getInvestigationLog(scopeId)
    const inv = log.investigations.find((i) => i.id === invId)
    if (!inv) throw new HttpError(404, `no investigation ${invId}`)
    if (!Number.isInteger(index) || index < 0 || index >= inv.proposedCriteria.length) {
      throw new HttpError(400, `criterion index out of range (0..${inv.proposedCriteria.length - 1})`)
    }
    const proposal = inv.proposedCriteria[index]
    if (proposal.decision) throw new HttpError(409, 'this proposal was already decided')

    if (decision === 'accept') {
      const id = `user-${proposal.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)}-${Date.now().toString(36).slice(-4)}`
      await mutateBar((b) => {
        b.criteria.push({
          id,
          title: proposal.title,
          rule: proposal.rule,
          level: proposal.level,
          method: 'ai-judged',
          severity: proposal.severity,
          shownToWriter: proposal.severity === 'blocking',
          enabled: true,
          stats: { firstDraftFails: 0, judgedLessons: 0, redFlagInvolvements: 0 },
        })
      })
      // The offending card joins the deck so this miss can never go undetected again.
      try {
        const scope = await getScope(scopeId)
        const lesson = scope.units.flatMap((u) => u.lessons).find((l) => l.id === proposal.offendingLessonId)
        if (lesson) {
          await mutateDeck((d) =>
            d.cards.push({
              id: newId('deck'),
              label: `From investigation ${invId}: ${proposal.title}`,
              expectedCriterionIds: [id],
              lesson,
              source: 'added',
              added: nowIso(),
            }),
          )
        }
      } catch {
        /* deck add is best-effort — the criterion itself landed */
      }
    }

    let updatedInv: QcInvestigation | undefined
    await mutateInvestigationLog(scopeId, (l) => {
      const target = l.investigations.find((i) => i.id === invId)
      if (!target) throw new HttpError(404, `no investigation ${invId}`)
      target.proposedCriteria[index] = { ...proposal, decision: { decision: decision as 'accept' | 'reject', reason, decided: nowIso() } }
      target.updated = nowIso()
      updatedInv = target
    })
    return ok(updatedInv)
  },
})
