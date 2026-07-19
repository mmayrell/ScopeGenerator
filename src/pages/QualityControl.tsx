import { useCallback, useEffect, useRef, useState } from 'react'
import { UnauthorizedError, api, clearAccessCode } from '../api'
import { useStore } from '../store'
import type {
  QcBar,
  QcCriterion,
  QcDeck,
  QcDeckRunResult,
  QcDryRunResult,
  QcInvestigation,
  QcLessonResult,
  QcNote,
  QcNoteType,
  QcPlanStep,
  QcReport,
  QcReportSummary,
} from '../types'
import { Btn, Modal, Pill, SectionLabel } from '../ui'

// Quality Control — the QC Bar. Generation drafts every card against the
// bar's blocking criteria, an independent judge grades each card, failing
// cards run the bounded revise → fresh-start loop, and the report lands here
// automatically. The Bar tab is the user-editable rubric: criteria, the
// escalation plan, dry-run, and the broken-card test deck.

const errText = (e: unknown, fallback: string): string => {
  if (e instanceof UnauthorizedError) {
    clearAccessCode()
    window.location.reload()
    return 'Access code rejected — enter it again.'
  }
  return e instanceof Error ? e.message : fallback
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const POLL_MS = 5000

const NOTE_TYPES: QcNoteType[] = ['rigor', 'granularity', 'sequencing', 'wording', 'evidence', 'contradiction', 'other']
const CARD_FIELDS = [
  'standards',
  'cluster',
  'substandard',
  'objectives',
  'emphasis',
  'progression',
  'prerequisites',
  'boundary',
  'newLearning',
  'approach',
  'nonGoals',
  'ceiling',
  'assessment',
  'releasedItems',
]

const statusPill = (r: QcReportSummary | QcReport) =>
  r.status === 'running' ? (
    <Pill tone="accent">RUNNING</Pill>
  ) : r.status === 'failed' ? (
    <Pill tone="red">FAILED</Pill>
  ) : r.redFlagCount > 0 ? (
    <Pill tone="red">
      {r.redFlagCount} RED FLAG{r.redFlagCount === 1 ? '' : 'S'}
    </Pill>
  ) : r.advisoryCount > 0 ? (
    <Pill tone="amber">{r.advisoryCount} ADVISORIES</Pill>
  ) : (
    <Pill tone="green">PASSED</Pill>
  )

export default function QualityControl() {
  const [tab, setTab] = useState<'reports' | 'bar'>('reports')
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-ink">Quality Control</h1>
          <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-ink-2">
            Every card is written against the QC Bar, graded by an independent judge, and revised until it passes — or
            arrives with a red flag explaining exactly what it couldn&apos;t fix. Reports appear here automatically for
            every generated scope.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-hairline bg-panel p-1">
          {(['reports', 'bar'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
                tab === t ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {t === 'reports' ? 'Reports' : 'The QC Bar'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'reports' ? <ReportsTab /> : <BarTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports tab — the automatic output of every generation + sweeps.
// ---------------------------------------------------------------------------

function ReportsTab() {
  const { scopes } = useStore()
  const [reports, setReports] = useState<QcReportSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ report: QcReport; notes: QcNote[]; investigations: QcInvestigation[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<QcReportSummary | null>(null)
  const openIdRef = useRef<string | null>(null)
  const setOpen = (id: string | null) => {
    openIdRef.current = id
    setOpenId(id)
    if (id === null) setDetail(null)
  }

  const load = useCallback(
    () =>
      api
        .listQcReports()
        .then((d) => {
          setReports(d.reports)
          setError(null)
        })
        .catch((e: unknown) => setError(errText(e, 'Could not load the QC reports.'))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  const loadDetail = useCallback((scopeId: string) => {
    api
      .getQc(scopeId)
      .then((d) => {
        if (openIdRef.current === scopeId) setDetail(d)
      })
      .catch((e: unknown) => setError(errText(e, 'Could not load the QC report.')))
  }, [])
  useEffect(() => {
    if (openId) loadDetail(openId)
  }, [openId, loadDetail])

  // Poll while anything is live: a running report (generation/sweep in
  // flight) or a running investigation on the open report.
  const live =
    (reports ?? []).some((r) => r.status === 'running') ||
    (detail?.investigations ?? []).some((i) => i.status === 'running') ||
    (detail?.notes ?? []).some((n) => n.status === 'investigating')
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => {
      void load()
      if (openIdRef.current) loadDetail(openIdRef.current)
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [live, load, loadDetail])

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(key))
    try {
      await fn()
    } catch (e) {
      setError(errText(e, 'The action failed.'))
    } finally {
      setBusy((b) => {
        const next = new Set(b)
        next.delete(key)
        return next
      })
    }
  }

  const sweepables = scopes.filter((s) => s.status === 'complete' && !(reports ?? []).some((r) => r.scopeId === s.id))

  return (
    <>
      {error && <div className="mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] text-rust">{error}</div>}

      {reports === null ? (
        <p className="mt-8 text-[13px] text-ink-2">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-hairline bg-panel p-8 text-center">
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            No reports yet — every new generation produces one automatically.
            {sweepables.length > 0 && ' For scopes generated before the bar existed, run a QC sweep below.'}
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-panel">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                <th className="px-4 py-2.5">Scope</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Passed first try</th>
                <th className="px-3 py-2.5">Open notes</th>
                <th className="px-3 py-2.5">Origin</th>
                <th className="px-3 py-2.5">Bar</th>
                <th className="px-3 py-2.5">Updated</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.scopeId} className="border-b border-hairline/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{r.scopeTitle}</td>
                  <td className="px-3 py-2.5">{statusPill(r)}</td>
                  <td className="px-3 py-2.5 text-ink-2">
                    {r.lessonCount > 0 ? `${r.passedFirstTry}/${r.lessonCount}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{r.openNoteCount || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-3">{r.origin}</td>
                  <td className="px-3 py-2.5 text-ink-3">v{r.barVersion}</td>
                  <td className="px-3 py-2.5 text-ink-3">{when(r.updated)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Btn onClick={() => setOpen(r.scopeId)}>Open</Btn>
                      <Btn
                        disabled={busy.has(`sweep:${r.scopeId}`) || r.status === 'running'}
                        onClick={() =>
                          void withBusy(`sweep:${r.scopeId}`, async () => {
                            await api.sweepQc(r.scopeId)
                            await load()
                          })
                        }
                      >
                        Run QC sweep
                      </Btn>
                      <Btn kind="danger" onClick={() => setConfirmDelete(r)}>
                        Delete
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sweepables.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-panel px-5 py-3">
          <SectionLabel>Pre-Bar Scopes</SectionLabel>
          <span className="text-[12.5px] text-ink-2">Bring an existing scope up to the current bar:</span>
          {sweepables.slice(0, 6).map((s) => (
            <Btn
              key={s.id}
              disabled={busy.has(`sweep:${s.id}`)}
              onClick={() =>
                void withBusy(`sweep:${s.id}`, async () => {
                  await api.sweepQc(s.id)
                  await load()
                })
              }
            >
              Sweep “{s.title.length > 34 ? `${s.title.slice(0, 34)}…` : s.title}”
            </Btn>
          ))}
        </div>
      )}

      {openId && detail && (
        <ReportDetail
          detail={detail}
          onClose={() => setOpen(null)}
          onChanged={() => {
            loadDetail(openId)
            void load()
          }}
          onError={setError}
          busy={busy}
          withBusy={withBusy}
        />
      )}

      {confirmDelete && (
        <Modal open title="Delete this QC record?" onClose={() => setConfirmDelete(null)}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Permanently deletes the report, notes, and investigations for “{confirmDelete.scopeTitle}”. The scope itself
            (including any versions QC produced) is untouched.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
            <Btn
              kind="danger"
              disabled={busy.has(`del:${confirmDelete.scopeId}`)}
              onClick={() =>
                void withBusy(`del:${confirmDelete.scopeId}`, async () => {
                  await api.deleteQc(confirmDelete.scopeId)
                  if (openIdRef.current === confirmDelete.scopeId) setOpen(null)
                  setConfirmDelete(null)
                  await load()
                })
              }
            >
              Delete permanently
            </Btn>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The report detail — per-lesson chips, red-flag reports, top failing
// criteria, notes + investigations.
// ---------------------------------------------------------------------------

function ReportDetail({
  detail,
  onClose,
  onChanged,
  onError,
  busy,
  withBusy,
}: {
  detail: { report: QcReport; notes: QcNote[]; investigations: QcInvestigation[] }
  onClose: () => void
  onChanged: () => void
  onError: (e: string) => void
  busy: Set<string>
  withBusy: (key: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { report, notes, investigations } = detail
  const [openFlag, setOpenFlag] = useState<QcLessonResult | null>(null)
  const [noteForm, setNoteForm] = useState<{ lessonId: string; field: string; type: QcNoteType; note: string }>({
    lessonId: '',
    field: '',
    type: 'other',
    note: '',
  })
  const openNotes = notes.filter((n) => n.status === 'open')

  const raiseNote = () =>
    withBusy(`note:${report.scopeId}`, async () => {
      try {
        await api.raiseQcNote(report.scopeId, {
          location: {
            ...(noteForm.lessonId ? { lessonId: noteForm.lessonId } : {}),
            ...(noteForm.field ? { field: noteForm.field } : {}),
          },
          type: noteForm.type,
          note: noteForm.note.trim(),
        })
        setNoteForm({ lessonId: '', field: '', type: 'other', note: '' })
        onChanged()
      } catch (e) {
        onError(errText(e, 'Could not leave the note.'))
      }
    })

  return (
    <Modal open title={`QC Report — ${report.scopeTitle}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        {statusPill(report)}
        <Pill tone="neutral">
          {report.passedFirstTry}/{report.lessons.length} passed first try
        </Pill>
        <Pill tone="neutral">graded against bar v{report.barVersion}</Pill>
        <Pill tone="neutral">{report.origin === 'sweep' ? 'QC sweep' : 'generation'}</Pill>
        {report.error && <span className="text-[12px] text-rust">{report.error}</span>}
      </div>

      {report.topFailingCriteria.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Top Failing Criteria</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {report.topFailingCriteria.map((t) => (
              <Pill key={t.criterionId} tone="amber">
                {t.title} · {t.failCount}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {report.courseFindings.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Course Check</SectionLabel>
          <div className="mt-1.5 space-y-1.5">
            {report.courseFindings.map((f, i) => (
              <div key={i} className="rounded-xl border border-hairline bg-paper px-3 py-2 text-[12.5px]">
                {f.severity === 'blocking' ? <Pill tone="red">course red flag</Pill> : <Pill tone="amber">advisory</Pill>}{' '}
                <span className="font-medium text-ink">{f.title}:</span> <span className="text-ink-2">{f.evidence}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <SectionLabel>Lessons</SectionLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {report.lessons.map((l) => (
            <button
              key={l.lessonId}
              onClick={() => (l.redFlag ? setOpenFlag(l) : undefined)}
              title={`${l.title} — ${l.status === 'red-flag' ? 'red flag (click for the report)' : `passed (attempt ${l.attempts})`}${l.advisories.length > 0 ? `, ${l.advisories.length} advisories` : ''}`}
              className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors ${
                l.status === 'red-flag'
                  ? 'cursor-pointer border-rust/30 bg-rust-wash text-rust hover:border-rust/60'
                  : l.attempts > 1
                    ? 'border-amber-ink/25 bg-amber-wash text-amber-ink'
                    : 'border-verdant/25 bg-verdant-wash text-verdant'
              }`}
            >
              {l.lessonId}
              {l.status === 'red-flag' ? ' ⚑' : l.attempts > 1 ? ` ·${l.attempts}` : ''}
              {l.advisories.length > 0 ? ` a${l.advisories.length}` : ''}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          Green = passed first try · amber = passed after revision (·n attempts) · red ⚑ = red-flagged (best version kept;
          click for the Red Flag Report) · aN = advisories.
        </p>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Notes</SectionLabel>
          <span className="text-[12px] text-ink-3">
            Jot what bothers you — notes cost nothing and change nothing until you run the investigation.
          </span>
          {openNotes.length > 0 && (
            <Btn
              kind="night"
              disabled={busy.has(`inv:${report.scopeId}`)}
              onClick={() =>
                void withBusy(`inv:${report.scopeId}`, async () => {
                  try {
                    await api.investigateQc(report.scopeId)
                    onChanged()
                  } catch (e) {
                    onError(errText(e, 'Could not start the investigation.'))
                  }
                })
              }
            >
              Run investigation ({openNotes.length} open)
            </Btn>
          )}
        </div>
        {notes.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {notes.map((n) => (
              <div key={n.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-hairline bg-paper px-3 py-2 text-[12.5px]">
                {n.status === 'open' ? (
                  <Pill tone="neutral">open</Pill>
                ) : n.status === 'investigating' ? (
                  <Pill tone="accent">investigating</Pill>
                ) : n.status === 'confirmed' ? (
                  <Pill tone="red">confirmed{n.resolution?.rootCause ? ` → ${n.resolution.rootCause}` : ''}</Pill>
                ) : (
                  <Pill tone="green">defended</Pill>
                )}
                <Pill tone="cite">{n.type}</Pill>
                <span className="text-ink-3">{[n.location.lessonId ?? 'scope', n.location.field].filter(Boolean).join(' · ')}</span>
                <span className="min-w-[200px] flex-1 text-ink-2">{n.note}</span>
                {n.resolution && <span className="w-full text-[11.5px] leading-relaxed text-ink-3">{n.resolution.rationale}</span>}
                {n.status === 'open' && (
                  <button
                    className="cursor-pointer text-[11.5px] text-rust hover:underline"
                    onClick={() =>
                      void withBusy(`wn:${n.id}`, async () => {
                        try {
                          await api.withdrawQcNote(report.scopeId, n.id)
                          onChanged()
                        } catch (e) {
                          onError(errText(e, 'Could not withdraw the note.'))
                        }
                      })
                    }
                  >
                    withdraw
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            list="qc-lessons"
            value={noteForm.lessonId}
            onChange={(e) => setNoteForm((s) => ({ ...s, lessonId: e.target.value }))}
            placeholder="Lesson (blank = scope)"
            className="w-[160px] rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
          />
          <datalist id="qc-lessons">
            {report.lessons.map((l) => (
              <option key={l.lessonId} value={l.lessonId} />
            ))}
          </datalist>
          <select
            value={noteForm.field}
            onChange={(e) => setNoteForm((s) => ({ ...s, field: e.target.value }))}
            className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12.5px] text-ink-2 outline-none"
          >
            <option value="">Whole card</option>
            {CARD_FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={noteForm.type}
            onChange={(e) => setNoteForm((s) => ({ ...s, type: e.target.value as QcNoteType }))}
            className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12.5px] text-ink-2 outline-none"
          >
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={noteForm.note}
            onChange={(e) => setNoteForm((s) => ({ ...s, note: e.target.value }))}
            placeholder='What bothers you, e.g. "this ceiling feels low against the released items"'
            className="min-w-[240px] flex-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
          />
          <Btn disabled={noteForm.note.trim().length === 0 || busy.has(`note:${report.scopeId}`)} onClick={() => void raiseNote()}>
            Leave note
          </Btn>
        </div>
      </div>

      {investigations.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Investigations</SectionLabel>
          <p className="mt-1 text-[11.5px] text-ink-3">
            Accepting a card repair APPLIES it — the scope gets a new numbered version (the old one is kept). Accepting a
            drafted criterion adds it to the bar and its card to the test deck. Contradiction reports are yours to rule on.
          </p>
          <div className="mt-2 space-y-3">
            {investigations
              .slice()
              .reverse()
              .map((inv) => (
                <Investigation key={inv.id} inv={inv} scopeId={report.scopeId} withBusy={withBusy} onChanged={onChanged} onError={onError} />
              ))}
          </div>
        </div>
      )}

      {openFlag && openFlag.redFlag && (
        <Modal open title={`Red Flag — ${openFlag.lessonId} ${openFlag.title}`} onClose={() => setOpenFlag(null)}>
          <div className="space-y-3 text-[12.5px] leading-relaxed">
            <p>
              <span className="font-semibold text-ink">Why the loop stopped:</span>{' '}
              <span className="text-ink-2">
                {openFlag.redFlag.whyStopped === 'attempts-exhausted'
                  ? 'the escalation plan ran out of attempts.'
                  : openFlag.redFlag.whyStopped === 'stalled'
                    ? 'two revisions in a row made no progress.'
                    : 'a fresh start came back no better than the best earlier attempt.'}
              </span>
            </p>
            {openFlag.redFlag.neverPassed.length > 0 && (
              <p>
                <span className="font-semibold text-ink">Never passed:</span>{' '}
                <span className="text-ink-2">{openFlag.redFlag.neverPassed.join(', ')} — a real problem in the card, or a criterion impossible as written.</span>
              </p>
            )}
            {openFlag.redFlag.fighting && (
              <p>
                <span className="font-semibold text-ink">Fighting criteria:</span>{' '}
                <span className="text-ink-2">
                  “{openFlag.redFlag.fighting[0]}” vs “{openFlag.redFlag.fighting[1]}” — fixing one kept breaking the other.
                </span>
              </p>
            )}
            <div>
              <span className="font-semibold text-ink">Attempt history:</span>
              <div className="mt-1 space-y-0.5">
                {openFlag.redFlag.attemptHistory.map((a) => (
                  <p key={a.attempt} className="font-mono text-[11.5px] text-ink-2">
                    #{a.attempt} {a.kind}: {a.note}
                  </p>
                ))}
              </div>
            </div>
            <p className="rounded-xl border border-hairline bg-paper px-3 py-2 text-ink-2">
              <span className="font-semibold text-ink">Recommendation:</span> {openFlag.redFlag.recommendation}
            </p>
            <div className="flex justify-end">
              <Btn
                disabled={busy.has(`deck:${openFlag.lessonId}`)}
                onClick={() =>
                  void withBusy(`deck:${openFlag.lessonId}`, async () => {
                    try {
                      await api.addQcDeckCard({
                        label: `Red flag on ${openFlag.lessonId} "${openFlag.title}": ${openFlag.redFlag!.whyStopped}`,
                        expectedCriterionIds:
                          openFlag.redFlag!.neverPassed.length > 0
                            ? openFlag.redFlag!.neverPassed
                            : [...new Set(openFlag.redFlag!.attemptHistory.flatMap((a) => a.failedBlocking))],
                        scopeId: report.scopeId,
                        lessonId: openFlag.lessonId,
                      })
                      onError('') // clear
                      setOpenFlag(null)
                    } catch (e) {
                      onError(errText(e, 'Could not add the card to the deck.'))
                    }
                  })
                }
              >
                Add this card to the test deck
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function Investigation({
  inv,
  scopeId,
  withBusy,
  onChanged,
  onError,
}: {
  inv: QcInvestigation
  scopeId: string
  withBusy: (key: string, fn: () => Promise<void>) => Promise<void>
  onChanged: () => void
  onError: (e: string) => void
}) {
  const [reasonFor, setReasonFor] = useState<{ kind: 'repair' | 'criterion'; index: number; decision: 'accept' | 'edit' | 'reject' } | null>(null)
  const [reason, setReason] = useState('')
  const [editedText, setEditedText] = useState('')

  const submit = () =>
    reasonFor &&
    withBusy(`dec:${inv.id}:${reasonFor.kind}:${reasonFor.index}`, async () => {
      try {
        if (reasonFor.kind === 'repair') {
          await api.decideQcRepair(scopeId, inv.id, reasonFor.index, {
            decision: reasonFor.decision,
            reason: reason.trim(),
            ...(reasonFor.decision === 'edit' ? { editedText: editedText.trim() } : {}),
          })
        } else {
          await api.decideQcCriterion(scopeId, inv.id, reasonFor.index, {
            decision: reasonFor.decision === 'reject' ? 'reject' : 'accept',
            reason: reason.trim(),
          })
        }
        setReasonFor(null)
        setReason('')
        setEditedText('')
        onChanged()
      } catch (e) {
        onError(errText(e, 'Could not record the decision.'))
      }
    })

  const decisionOn = (index: number) => inv.repairDecisions.find((d) => d.repairIndex === index)

  return (
    <div className="rounded-xl border border-hairline bg-paper p-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        {inv.status === 'running' ? <Pill tone="accent">running</Pill> : inv.status === 'failed' ? <Pill tone="red">failed</Pill> : <Pill tone="green">complete</Pill>}
        <span>
          {when(inv.created)} · {inv.noteIds.length} note{inv.noteIds.length === 1 ? '' : 's'}
        </span>
        {inv.error && <span className="text-rust">{inv.error}</span>}
      </div>
      {inv.verdicts.map((v) => (
        <p key={v.noteId} className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
          {v.verdict === 'confirmed' ? (
            <span className="font-semibold text-rust">Confirmed{v.rootCause ? ` → the ${v.rootCause}` : ''}:</span>
          ) : (
            <span className="font-semibold text-verdant">Defended:</span>
          )}{' '}
          {v.rationale}
        </p>
      ))}
      {inv.patternSweep.some((p) => p.additionalCards.length > 0) && (
        <div className="mt-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Pattern sweep</span>
          {inv.patternSweep
            .filter((p) => p.additionalCards.length > 0)
            .map((p, i) => (
              <p key={i} className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
                {p.defectClass}: {p.additionalCards.map((c) => `${c.lessonId} (${c.field})`).join(', ')}
              </p>
            ))}
        </div>
      )}

      {inv.contradictionReports.length > 0 && (
        <div className="mt-2 space-y-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Contradiction reports (you make the ruling)</span>
          {inv.contradictionReports.map((c, i) => (
            <div key={i} className="rounded-lg border border-hairline bg-panel p-2.5 text-[12px] leading-relaxed">
              <p className="border-l-2 border-hairline-2 pl-2 text-ink-2 italic">
                “{c.passageA.quote}” <span className="text-ink-3 not-italic">— {c.passageA.citation}</span>
              </p>
              <p className="mt-1 border-l-2 border-hairline-2 pl-2 text-ink-2 italic">
                “{c.passageB.quote}” <span className="text-ink-3 not-italic">— {c.passageB.citation}</span>
              </p>
              <p className="mt-1 text-ink-2">
                <span className="font-semibold text-ink">Reading taken:</span> {c.readingTaken}
              </p>
              {c.affectedLessons.length > 0 && <p className="text-ink-3">Also affected: {c.affectedLessons.join(', ')}</p>}
            </div>
          ))}
        </div>
      )}

      {inv.proposedCriteria.length > 0 && (
        <div className="mt-2 space-y-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Drafted criteria (your notes teach the bar)</span>
          {inv.proposedCriteria.map((c, i) => (
            <div key={i} className="rounded-lg border border-hairline bg-panel p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-medium text-ink">{c.title}</span>
                <Pill tone="neutral">{c.level}</Pill>
                <Pill tone={c.severity === 'blocking' ? 'red' : 'amber'}>{c.severity}</Pill>
                {c.decision && <Pill tone={c.decision.decision === 'accept' ? 'green' : 'red'}>{c.decision.decision}ed</Pill>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{c.rule}</p>
              {c.decision ? (
                <p className="mt-1 text-[11.5px] text-ink-3">
                  {when(c.decision.decided)}: {c.decision.reason}
                </p>
              ) : reasonFor?.kind === 'criterion' && reasonFor.index === i ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (required)"
                    className="min-w-[220px] flex-1 rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
                  />
                  <Btn kind="primary" disabled={reason.trim().length === 0} onClick={() => void submit()}>
                    Record
                  </Btn>
                  <Btn onClick={() => setReasonFor(null)}>Cancel</Btn>
                </div>
              ) : (
                <div className="mt-2 flex gap-1.5">
                  <Btn onClick={() => setReasonFor({ kind: 'criterion', index: i, decision: 'accept' })}>Accept onto the bar</Btn>
                  <Btn kind="danger" onClick={() => setReasonFor({ kind: 'criterion', index: i, decision: 'reject' })}>
                    Reject
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {inv.proposedRepairs.length > 0 && (
        <div className="mt-2 space-y-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Proposed repairs — accepting APPLIES the diff as a new scope version
          </span>
          {inv.proposedRepairs.map((r, i) => {
            const d = decisionOn(i)
            return (
              <div key={i} className="rounded-lg border border-hairline bg-panel p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                  <Pill tone="neutral">
                    {r.lessonId} · {r.field}
                  </Pill>
                  {d && (
                    <Pill tone={d.decision === 'reject' ? 'red' : 'green'}>
                      {d.decision === 'reject' ? 'rejected' : `applied${d.appliedVersion ? ` → v${d.appliedVersion}` : ''}`}
                    </Pill>
                  )}
                </div>
                <p className="mt-1.5 border-l-2 border-rust/40 pl-2 text-[12px] leading-relaxed text-ink-3 line-through">{r.currentExcerpt}</p>
                <p className="mt-1 border-l-2 border-verdant/40 pl-2 text-[12px] leading-relaxed text-ink">{d?.editedText ?? r.proposedText}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{r.decisionRecord}</p>
                {d ? (
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    {when(d.decided)}: {d.reason}
                  </p>
                ) : reasonFor?.kind === 'repair' && reasonFor.index === i ? (
                  <div className="mt-2 space-y-1.5">
                    {reasonFor.decision === 'edit' && (
                      <textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (required)"
                        className="min-w-[220px] flex-1 rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
                      />
                      <Btn
                        kind="primary"
                        disabled={reason.trim().length === 0 || (reasonFor.decision === 'edit' && editedText.trim().length === 0)}
                        onClick={() => void submit()}
                      >
                        {reasonFor.decision === 'reject' ? 'Record rejection' : 'Apply as new version'}
                      </Btn>
                      <Btn onClick={() => setReasonFor(null)}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <Btn onClick={() => setReasonFor({ kind: 'repair', index: i, decision: 'accept' })}>Accept</Btn>
                    <Btn
                      onClick={() => {
                        setReasonFor({ kind: 'repair', index: i, decision: 'edit' })
                        setEditedText(r.proposedText)
                      }}
                    >
                      Edit
                    </Btn>
                    <Btn kind="danger" onClick={() => setReasonFor({ kind: 'repair', index: i, decision: 'reject' })}>
                      Reject
                    </Btn>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The Bar tab — criteria, escalation plan, dry-run, test deck.
// ---------------------------------------------------------------------------

function BarTab() {
  const { scopes } = useStore()
  const [bar, setBar] = useState<QcBar | null>(null)
  const [deck, setDeck] = useState<QcDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<QcCriterion | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [deckResult, setDeckResult] = useState<QcDeckRunResult | null>(null)
  const [dryRun, setDryRun] = useState<{ criterionId: string; scopeId: string; lessonId: string } | null>(null)
  const [dryResult, setDryResult] = useState<QcDryRunResult | null>(null)

  const load = useCallback(
    () =>
      api
        .getQcBar()
        .then((d) => {
          setBar(d.bar)
          setDeck(d.deck)
          setError(null)
        })
        .catch((e: unknown) => setError(errText(e, 'Could not load the bar.'))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  const save = async (criteria: QcCriterion[], escalationPlan?: QcPlanStep[]): Promise<boolean> => {
    setBusy(true)
    try {
      const updated = await api.saveQcBar({ criteria, ...(escalationPlan ? { escalationPlan } : {}) })
      setBar(updated)
      setError(null)
      return true
    } catch (e) {
      setError(errText(e, 'Could not save the bar.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!bar) return <p className="mt-8 text-[13px] text-ink-2">{error ?? 'Loading…'}</p>

  const failRate = (c: QcCriterion): string =>
    c.stats.judgedLessons > 0 ? `${Math.round((100 * c.stats.firstDraftFails) / c.stats.judgedLessons)}%` : '—'

  return (
    <>
      {error && <div className="mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] text-rust">{error}</div>}

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-panel px-5 py-3">
        <Pill tone="night">bar v{bar.barVersion}</Pill>
        <span className="text-[12.5px] text-ink-2">
          Escalation plan: {bar.escalationPlan.join(' → ')} — edits apply to everything generated after you save; existing
          scopes are never silently rewritten (use Run QC sweep).
        </span>
        <div className="ml-auto flex gap-2">
          <Btn
            disabled={busy}
            onClick={() => {
              const next = window.prompt('Escalation plan (comma-separated: revise, fresh-start)', bar.escalationPlan.join(', '))
              if (!next) return
              const steps = next
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s === 'revise' || s === 'fresh-start') as QcPlanStep[]
              if (steps.length === 0) return
              void save(bar.criteria, steps)
            }}
          >
            Edit plan
          </Btn>
          <Btn
            kind="night"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              api
                .testQcBar()
                .then((r) => {
                  setDeckResult(r)
                  void load()
                })
                .catch((e: unknown) => setError(errText(e, 'The deck test failed.')))
                .finally(() => setBusy(false))
            }}
          >
            Test the bar ({deck?.cards.length ?? 0} deck cards)
          </Btn>
          <Btn
            kind="primary"
            onClick={() => {
              setIsNew(true)
              setEditing({
                id: `user-criterion-${Date.now().toString(36).slice(-5)}`,
                title: '',
                rule: '',
                level: 'lesson',
                method: 'ai-judged',
                severity: 'advisory',
                shownToWriter: true,
                enabled: true,
                stats: { firstDraftFails: 0, judgedLessons: 0, redFlagInvolvements: 0 },
              })
            }}
          >
            Add criterion
          </Btn>
        </div>
      </div>

      {deckResult && (
        <div className="mt-3 rounded-2xl border border-hairline bg-panel px-5 py-3 text-[12.5px]">
          <div className="flex items-center gap-2">
            <SectionLabel>Deck Run</SectionLabel>
            <Pill tone={deckResult.missed === 0 ? 'green' : 'red'}>
              caught {deckResult.caught} · missed {deckResult.missed}
            </Pill>
            <button className="ml-auto cursor-pointer text-[11.5px] text-ink-3 hover:underline" onClick={() => setDeckResult(null)}>
              dismiss
            </button>
          </div>
          {deckResult.perCard.map((p) => (
            <p key={p.deckCardId} className="mt-1 text-ink-2">
              {p.missedIds.length === 0 ? '✓' : '✗'} {p.label}{' '}
              {p.missedIds.length > 0 && <span className="text-rust">missed: {p.missedIds.join(', ')}</span>}
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-hairline bg-panel">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-hairline text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
              <th className="px-4 py-2.5">Criterion</th>
              <th className="px-3 py-2.5">Level</th>
              <th className="px-3 py-2.5">Method</th>
              <th className="px-3 py-2.5">Severity</th>
              <th className="px-3 py-2.5">Writer sees it</th>
              <th className="px-3 py-2.5" title="First-draft fail rate · red-flag involvements · last deck run">
                Track record
              </th>
              <th className="px-3 py-2.5">On</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {bar.criteria.map((c) => (
              <tr key={c.id} className={`border-b border-hairline/60 last:border-0 ${c.enabled ? '' : 'opacity-45'}`}>
                <td className="max-w-[380px] px-4 py-2">
                  <span className="font-medium text-ink">{c.title}</span>
                  <p className="truncate text-[11.5px] text-ink-3" title={c.rule}>
                    {c.rule}
                  </p>
                </td>
                <td className="px-3 py-2 text-ink-2">{c.level}</td>
                <td className="px-3 py-2 text-ink-2">{c.method === 'automatic' ? 'automatic' : 'AI-judged'}</td>
                <td className="px-3 py-2">{c.severity === 'blocking' ? <Pill tone="red">blocking</Pill> : <Pill tone="neutral">advisory</Pill>}</td>
                <td className="px-3 py-2 text-ink-2">{c.shownToWriter ? 'yes' : 'no'}</td>
                <td className="px-3 py-2 text-[11.5px] text-ink-3">
                  {failRate(c)} first-draft fails · {c.stats.redFlagInvolvements} red flags
                  {c.stats.lastDeckRun ? ` · deck ${c.stats.lastDeckRun.caught}/${c.stats.lastDeckRun.caught + c.stats.lastDeckRun.missed}` : ''}
                </td>
                <td className="px-3 py-2">
                  <button
                    className="cursor-pointer text-[12px] text-accent hover:underline"
                    onClick={() => void save(bar.criteria.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)))}
                  >
                    {c.enabled ? 'on' : 'off'}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    <Btn
                      onClick={() => {
                        setDryResult(null)
                        setDryRun({ criterionId: c.id, scopeId: '', lessonId: '' })
                      }}
                    >
                      Dry-run
                    </Btn>
                    <Btn
                      onClick={() => {
                        setIsNew(false)
                        setEditing({ ...c })
                      }}
                    >
                      Edit
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal open title={isNew ? 'Add a criterion' : `Edit — ${editing.title || editing.id}`} onClose={() => setEditing(null)}>
          <div className="space-y-2.5 text-[12.5px]">
            <input
              value={editing.title}
              onChange={(e) => setEditing((s) => s && { ...s, title: e.target.value })}
              placeholder="Title (short)"
              className="w-full rounded-lg border border-hairline bg-panel px-2.5 py-1.5 outline-none focus:border-accent/40"
            />
            <textarea
              value={editing.rule}
              onChange={(e) => setEditing((s) => s && { ...s, rule: e.target.value })}
              placeholder='The failure condition, written for a strict grader: "Fail this card if…"'
              rows={4}
              className="w-full rounded-lg border border-hairline bg-panel px-2.5 py-1.5 outline-none focus:border-accent/40"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={editing.level}
                disabled={editing.method === 'automatic'}
                title={editing.method === 'automatic' ? 'Bound to a built-in check at this level' : undefined}
                onChange={(e) => setEditing((s) => s && { ...s, level: e.target.value as 'lesson' | 'course' })}
                className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-ink-2 outline-none disabled:opacity-50"
              >
                <option value="lesson">lesson</option>
                <option value="course">course</option>
              </select>
              <select
                value={editing.severity}
                onChange={(e) => setEditing((s) => s && { ...s, severity: e.target.value as 'blocking' | 'advisory' })}
                className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-ink-2 outline-none"
              >
                <option value="blocking">blocking — must be revised until it passes</option>
                <option value="advisory">advisory — noted in the report</option>
              </select>
              <label className="flex items-center gap-1.5 text-ink-2">
                <input type="checkbox" checked={editing.shownToWriter} onChange={(e) => setEditing((s) => s && { ...s, shownToWriter: e.target.checked })} />
                shown to the writer
              </label>
              <label className="flex items-center gap-1.5 text-ink-2">
                <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing((s) => s && { ...s, enabled: e.target.checked })} />
                enabled
              </label>
            </div>
            {editing.method === 'automatic' && (
              <p className="text-[11.5px] text-ink-3">
                This is a built-in mechanical check — the rule text describes it (and shows to the writer); the check itself
                is code. Severity/enabled/shown are yours to change.
              </p>
            )}
            <div className="flex justify-end gap-2">
              {!isNew && !editing.autoCheckId && (
                <Btn
                  kind="danger"
                  disabled={busy}
                  onClick={() => {
                    void save(bar.criteria.filter((x) => x.id !== editing.id)).then((okSave) => okSave && setEditing(null))
                  }}
                >
                  Remove
                </Btn>
              )}
              <Btn onClick={() => setEditing(null)}>Cancel</Btn>
              <Btn
                kind="primary"
                disabled={busy || editing.title.trim().length === 0 || editing.rule.trim().length === 0}
                onClick={() => {
                  const next = isNew ? [...bar.criteria, editing] : bar.criteria.map((x) => (x.id === editing.id ? editing : x))
                  void save(next).then((okSave) => okSave && setEditing(null))
                }}
              >
                Save — applies to future generation
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {dryRun && (
        <Modal open title="Dry-run a criterion" onClose={() => setDryRun(null)}>
          <p className="text-[12.5px] text-ink-2">
            Point “{bar.criteria.find((c) => c.id === dryRun.criterionId)?.title}” at any existing lesson and see exactly
            what the judge would say — before it governs generation.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={dryRun.scopeId}
              onChange={(e) => setDryRun((s) => s && { ...s, scopeId: e.target.value, lessonId: '' })}
              className="min-w-[220px] rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12.5px] text-ink-2 outline-none"
            >
              <option value="">Pick a scope…</option>
              {scopes
                .filter((s) => s.status === 'complete')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
            <select
              value={dryRun.lessonId}
              onChange={(e) => setDryRun((s) => s && { ...s, lessonId: e.target.value })}
              className="min-w-[180px] rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12.5px] text-ink-2 outline-none"
            >
              <option value="">Pick a lesson…</option>
              {(scopes.find((s) => s.id === dryRun.scopeId)?.units ?? []).flatMap((u) =>
                u.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} — {l.title.slice(0, 44)}
                  </option>
                )),
              )}
            </select>
            <Btn
              kind="primary"
              disabled={!dryRun.scopeId || !dryRun.lessonId || busy}
              onClick={() => {
                setBusy(true)
                setDryResult(null)
                api
                  .dryRunQcCriterion({ criterionId: dryRun.criterionId, scopeId: dryRun.scopeId, lessonId: dryRun.lessonId })
                  .then(setDryResult)
                  .catch((e: unknown) => setError(errText(e, 'The dry-run failed.')))
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Judging…' : 'Run'}
            </Btn>
          </div>
          {dryResult && (
            <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-paper p-3 text-[12.5px] leading-relaxed">
              <div>{dryResult.pass ? <Pill tone="green">PASS</Pill> : <Pill tone="red">FAIL</Pill>}</div>
              <p className="text-ink-2">
                <span className="font-semibold text-ink">The judge&apos;s work:</span> {dryResult.workShown}
              </p>
              {dryResult.evidence && (
                <p className="text-ink-2">
                  <span className="font-semibold text-ink">Evidence:</span> {dryResult.evidence}
                </p>
              )}
              {dryResult.revisionInstruction && (
                <p className="text-ink-2">
                  <span className="font-semibold text-ink">Revision comment:</span> {dryResult.revisionInstruction}
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
