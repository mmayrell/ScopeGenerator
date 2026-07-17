import { useCallback, useEffect, useRef, useState } from 'react'
import { UnauthorizedError, api, clearAccessCode } from '../api'
import { useStore } from '../store'
import type {
  QcFinding,
  QcFlag,
  QcFlagType,
  QcInvestigation,
  QcRun,
  QcRunSummary,
  QcSeverity,
} from '../types'
import { Btn, Modal, Pill, SectionLabel } from '../ui'

// Quality Control & Loop Engineering — the four-gate QC stack (replacing the
// rubric evaluations). Nothing in a scope is trusted because the generator
// wrote it; it is trusted because it survived the gates that check it, the
// flags that question it, and the trends that watch it. Everything here is
// READ-ONLY against the scope: investigations propose repair diffs and record
// accept/edit/reject as telemetry — application to the scope is a manual act.

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

/** Stop watching a dispatched run after this long — its job page has the error. */
const DISPATCH_WATCH_MS = 20 * 60 * 1000
const POLL_MS = 5000

const FLAG_TYPES: QcFlagType[] = ['rigor', 'granularity', 'sequencing', 'wording', 'evidence', 'other']
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

const verdictPill = (verdict: QcRun['verdict'] | 'running' | 'failed') =>
  verdict === 'clean' ? (
    <Pill tone="green">CLEAN</Pill>
  ) : verdict === 'advisories' ? (
    <Pill tone="amber">ADVISORIES</Pill>
  ) : verdict === 'quarantined' ? (
    <Pill tone="red">QUARANTINED</Pill>
  ) : verdict === 'running' ? (
    <Pill tone="accent">RUNNING</Pill>
  ) : (
    <Pill tone="red">FAILED</Pill>
  )

const severityPill = (s: QcSeverity) =>
  s === 'blocking' ? <Pill tone="red">blocking</Pill> : s === 'major' ? <Pill tone="amber">major</Pill> : <Pill tone="neutral">advisory</Pill>

const locText = (f: { location: QcFinding['location'] }): string =>
  [f.location.lessonId ?? f.location.unitId ?? 'scope', f.location.field].filter(Boolean).join(' · ')

interface DispatchWatch {
  prevUpdated: string
  startedAt: number
}

export default function QualityControl() {
  const { scopes } = useStore()
  const [runs, setRuns] = useState<QcRunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [dispatched, setDispatched] = useState<Record<string, DispatchWatch>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ run: QcRun; flags: QcFlag[]; investigations: QcInvestigation[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<QcRunSummary | null>(null)
  const [pickScope, setPickScope] = useState('')
  // Mirrors openId for async guards: a slow detail response for a previously
  // opened run must never replace the currently open one.
  const openIdRef = useRef<string | null>(null)
  const setOpen = (id: string | null) => {
    openIdRef.current = id
    setOpenId(id)
    if (id === null) setDetail(null)
  }

  const load = useCallback(
    () =>
      api
        .listQcRuns()
        .then((d) => {
          setRuns(d.runs)
          setError(null)
        })
        .catch((e: unknown) => setError(errText(e, 'Could not load the QC runs.'))),
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

  // Poll while any run is dispatched/running, or while the open report has a
  // live investigation (investigations are separate jobs that never touch
  // the run record's status). A dispatched watch retires only when the run
  // has BOTH left 'running' AND moved past its pre-dispatch `updated` stamp —
  // before the worker writes the running shell the row still shows the OLD
  // completed run, which must not retire the watch on the first tick.
  const investigationLive =
    (detail?.investigations ?? []).some((i) => i.status === 'running') ||
    (detail?.flags ?? []).some((f) => f.status === 'investigating')
  useEffect(() => {
    const watching = Object.keys(dispatched).length > 0 || (runs ?? []).some((r) => r.status === 'running') || investigationLive
    if (!watching) return
    const t = window.setInterval(() => {
      void api
        .listQcRuns()
        .then((d) => {
          setRuns(d.runs)
          setDispatched((cur) => {
            const next = { ...cur }
            for (const [scopeId, watch] of Object.entries(cur)) {
              const row = d.runs.find((r) => r.scopeId === scopeId)
              const done = row && row.updated !== watch.prevUpdated && row.status !== 'running'
              if (done || Date.now() - watch.startedAt > DISPATCH_WATCH_MS) delete next[scopeId]
            }
            return next
          })
          if (openIdRef.current) loadDetail(openIdRef.current)
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [dispatched, runs, investigationLive, loadDetail])

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

  const dispatchRun = (scopeId: string) =>
    withBusy(`run:${scopeId}`, async () => {
      const prev = runs?.find((r) => r.scopeId === scopeId)?.updated ?? ''
      await api.runQcGates(scopeId)
      setDispatched((d) => ({ ...d, [scopeId]: { prevUpdated: prev, startedAt: Date.now() } }))
      await load()
    })

  const runnableScopes = scopes.filter((s) => s.status === 'complete' && !(runs ?? []).some((r) => r.scopeId === s.id))

  // Trends strip — the aggregate view every signal lands on. v1 aggregates
  // the stored run summaries; per-rule-tag trend curves are a later surface.
  const trend =
    runs && runs.length > 0
      ? {
          total: runs.length,
          clean: runs.filter((r) => r.verdict === 'clean' && r.status === 'complete').length,
          advisories: runs.filter((r) => r.verdict === 'advisories').length,
          quarantined: runs.filter((r) => r.verdict === 'quarantined').length,
          findings: runs.reduce((n, r) => n + r.findingCount, 0),
          blocking: runs.reduce((n, r) => n + r.blockingCount, 0),
          openFlags: runs.reduce((n, r) => n + r.openFlagCount, 0),
        }
      : null

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-ink">Quality Control</h1>
          <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-ink-2">
            Generation proposes; QC disposes. Every scope passes four ordered gates — structural validation, evidence
            verification, adversarial review, stability &amp; confidence — and every quality event lands as a finding.
            Raise flags on anything that looks wrong; an investigation re-derives the decision and either confirms it
            into a finding or argues back with citations. Nothing here ever edits a generated scope.
          </p>
        </div>
        {runnableScopes.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={pickScope}
              onChange={(e) => setPickScope(e.target.value)}
              className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-[13px] text-ink outline-none focus:border-accent/40"
            >
              <option value="">Run the gates on…</option>
              {runnableScopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <Btn kind="primary" disabled={!pickScope || busy.has(`run:${pickScope}`)} onClick={() => void dispatchRun(pickScope).then(() => setPickScope(''))}>
              Run QC
            </Btn>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] text-rust">{error}</div>
      )}

      {trend && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-hairline bg-panel px-5 py-3">
          <SectionLabel>Trends</SectionLabel>
          <span className="text-[12.5px] text-ink-2">
            {trend.total} scope{trend.total === 1 ? '' : 's'} under QC
          </span>
          <Pill tone="green">{trend.clean} clean</Pill>
          <Pill tone="amber">{trend.advisories} with advisories</Pill>
          <Pill tone="red">{trend.quarantined} quarantined</Pill>
          <span className="text-[12.5px] text-ink-2">
            {trend.findings} finding{trend.findings === 1 ? '' : 's'} ({trend.blocking} blocking) · {trend.openFlags} open flag
            {trend.openFlags === 1 ? '' : 's'}
          </span>
          <span className="ml-auto text-[11.5px] text-ink-3">Autonomy level: L0 — instrumented review (every action recorded)</span>
        </div>
      )}

      {runs === null ? (
        <p className="mt-8 text-[13px] text-ink-2">Loading…</p>
      ) : runs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-hairline bg-panel p-8 text-center">
          <p className="text-[13.5px] text-ink-2">
            No QC runs yet. New generations pass the gates automatically; run them on an existing scope with the picker above.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-panel">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                <th className="px-4 py-2.5">Scope</th>
                <th className="px-3 py-2.5">Verdict</th>
                <th className="px-3 py-2.5">Findings</th>
                <th className="px-3 py-2.5">Quarantined</th>
                <th className="px-3 py-2.5">Open flags</th>
                <th className="px-3 py-2.5">Last run</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.scopeId} className="border-b border-hairline/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{r.scopeTitle}</td>
                  <td className="px-3 py-2.5">{verdictPill(r.status === 'complete' ? r.verdict : r.status)}</td>
                  <td className="px-3 py-2.5 text-ink-2">
                    {r.findingCount}
                    {r.blockingCount > 0 && <span className="text-rust"> ({r.blockingCount} blocking)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{r.quarantinedCount || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-2">{r.openFlagCount || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-3">{when(r.updated)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Btn onClick={() => setOpen(r.scopeId)}>Open report</Btn>
                      <Btn disabled={busy.has(`run:${r.scopeId}`) || r.status === 'running'} onClick={() => void dispatchRun(r.scopeId)}>
                        Re-run gates
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

      {openId && detail && (
        <QcReport
          detail={detail}
          onClose={() => setOpen(null)}
          onChanged={() => {
            loadDetail(openId)
            void load()
          }}
          onError={(e) => setError(e)}
          busy={busy}
          withBusy={withBusy}
        />
      )}

      {confirmDelete && (
        <Modal open title="Delete this QC record?" onClose={() => setConfirmDelete(null)}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Permanently deletes the QC report, the flag ledger, and every investigation for “{confirmDelete.scopeTitle}”.
            The scope itself is untouched. A run in flight stops at its next checkpoint.
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// The QC Report detail view — gates, findings ledger, confidence, flags,
// investigations.
// ---------------------------------------------------------------------------

function QcReport({
  detail,
  onClose,
  onChanged,
  onError,
  busy,
  withBusy,
}: {
  detail: { run: QcRun; flags: QcFlag[]; investigations: QcInvestigation[] }
  onClose: () => void
  onChanged: () => void
  onError: (e: string) => void
  busy: Set<string>
  withBusy: (key: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { run, flags, investigations } = detail
  const [gateFilter, setGateFilter] = useState<number | 0>(0)
  const [sevFilter, setSevFilter] = useState<QcSeverity | ''>('')
  const [flagForm, setFlagForm] = useState<{ lessonId: string; field: string; type: QcFlagType; note: string }>({
    lessonId: '',
    field: '',
    type: 'other',
    note: '',
  })

  const filtered = run.findings.filter(
    (f) => (gateFilter === 0 || f.gate === gateFilter) && (sevFilter === '' || f.severity === sevFilter),
  )
  const openFlags = flags.filter((f) => f.status === 'open')
  const lessonIds = [...new Set(run.confidences.map((c) => c.lessonId))]
  const bands = {
    high: run.confidences.filter((c) => c.band === 'high').length,
    medium: run.confidences.filter((c) => c.band === 'medium').length,
    low: run.confidences.filter((c) => c.band === 'low').length,
  }
  const lowCards = run.confidences.filter((c) => c.band === 'low').sort((a, b) => a.score - b.score)

  const raiseFlag = () =>
    withBusy(`flag:${run.scopeId}`, async () => {
      try {
        await api.raiseQcFlag(run.scopeId, {
          location: {
            ...(flagForm.lessonId ? { lessonId: flagForm.lessonId } : {}),
            ...(flagForm.field ? { field: flagForm.field } : {}),
          },
          type: flagForm.type,
          note: flagForm.note.trim(),
        })
        setFlagForm({ lessonId: '', field: '', type: 'other', note: '' })
        onChanged()
      } catch (e) {
        onError(errText(e, 'Could not raise the flag.'))
      }
    })

  return (
    <Modal open title={`QC Report — ${run.scopeTitle}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        {verdictPill(run.status === 'complete' ? run.verdict : run.status)}
        <Pill tone="neutral">{run.findings.length} findings</Pill>
        {run.quarantinedCards.length > 0 && <Pill tone="red">{run.quarantinedCards.length} cards quarantined</Pill>}
        <Pill tone="neutral">scope version {when(run.scopeVersion)}</Pill>
        <span className="text-[11.5px] text-ink-3">
          {run.qcStackVersion} · seeded-defect catch rate: {run.seededCatchRate}
        </span>
      </div>

      {run.quarantinedCards.length > 0 && (
        <div className="mt-3 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
          <span className="font-semibold">Quarantine.</span> Blocking findings stand on {run.quarantinedCards.join(', ')} — the
          scope should not be treated as publishable until they are repaired (regenerate the owning lessons via Lesson Scope
          Edits, then re-run the gates) or explicitly overridden with a recorded reason.
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {run.gates.map((g) => (
          <div key={g.gate} className="rounded-xl border border-hairline bg-paper p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-ink">
                Gate {g.gate} — {g.name}
              </span>
              {g.status === 'pass' ? <Pill tone="green">pass</Pill> : g.status === 'findings' ? <Pill tone="amber">{g.findingCount}</Pill> : <Pill tone="neutral">skipped</Pill>}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{g.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <SectionLabel>Findings Ledger</SectionLabel>
        <select
          value={gateFilter}
          onChange={(e) => setGateFilter(Number(e.target.value))}
          className="rounded-lg border border-hairline bg-panel px-2 py-1 text-[12px] text-ink-2 outline-none"
        >
          <option value={0}>All gates</option>
          {[1, 2, 3, 4].map((g) => (
            <option key={g} value={g}>
              Gate {g}
            </option>
          ))}
        </select>
        <select
          value={sevFilter}
          onChange={(e) => setSevFilter(e.target.value as QcSeverity | '')}
          className="rounded-lg border border-hairline bg-panel px-2 py-1 text-[12px] text-ink-2 outline-none"
        >
          <option value="">All severities</option>
          <option value="blocking">Blocking</option>
          <option value="major">Major</option>
          <option value="advisory">Advisory</option>
        </select>
        <span className="text-[12px] text-ink-3">
          {filtered.length} of {run.findings.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">No findings{run.findings.length > 0 ? ' under this filter' : ' — the scope passed clean'}.</p>
      ) : (
        <div className="mt-2 max-h-[340px] space-y-2 overflow-y-auto pr-1">
          {filtered.map((f) => (
            <div key={f.id} className="rounded-xl border border-hairline bg-paper p-3">
              <div className="flex flex-wrap items-center gap-2">
                {severityPill(f.severity)}
                <Pill tone="cite">{f.ruleTag}</Pill>
                <span className="text-[11.5px] text-ink-3">
                  Gate {f.gate} · {f.checkFamily} · {locText(f)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] font-medium text-ink">{f.summary}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{f.evidence}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                <span className="font-semibold uppercase">Repair contract:</span> {f.repairContract}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <SectionLabel>Card Confidence (Gate 4)</SectionLabel>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Pill tone="green">{bands.high} high</Pill>
          <Pill tone="amber">{bands.medium} medium</Pill>
          <Pill tone="red">{bands.low} low</Pill>
          <span className="text-[11.5px] text-ink-3">The score routes review; it never edits content.</span>
        </div>
        {lowCards.length > 0 && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
            Watch hardest:{' '}
            {lowCards
              .slice(0, 8)
              .map((c) => `${c.lessonId} (${c.score})`)
              .join(', ')}
            {lowCards.length > 8 ? ', …' : ''}
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Flag Ledger</SectionLabel>
          <span className="text-[12px] text-ink-3">
            Flags cost nothing to raise — nothing happens until you run the investigation. A flag is a question, not an order.
          </span>
          {openFlags.length > 0 && (
            <Btn
              kind="night"
              disabled={busy.has(`inv:${run.scopeId}`)}
              onClick={() =>
                void withBusy(`inv:${run.scopeId}`, async () => {
                  try {
                    await api.investigateQc(run.scopeId)
                    onChanged()
                  } catch (e) {
                    onError(errText(e, 'Could not start the investigation.'))
                  }
                })
              }
            >
              Run investigation ({openFlags.length} open)
            </Btn>
          )}
        </div>
        {flags.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {flags.map((f) => (
              <div key={f.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-hairline bg-paper px-3 py-2 text-[12.5px]">
                {f.status === 'open' ? (
                  <Pill tone="neutral">open</Pill>
                ) : f.status === 'investigating' ? (
                  <Pill tone="accent">investigating</Pill>
                ) : f.status === 'confirmed' ? (
                  <Pill tone="red">confirmed{f.resolution?.severity ? ` · ${f.resolution.severity}` : ''}</Pill>
                ) : (
                  <Pill tone="green">not confirmed</Pill>
                )}
                <Pill tone="cite">{f.type}</Pill>
                <span className="text-ink-3">{locText(f)}</span>
                <span className="min-w-[200px] flex-1 text-ink-2">{f.note}</span>
                {f.resolution && <span className="w-full text-[11.5px] leading-relaxed text-ink-3">{f.resolution.rationale}</span>}
                {f.status === 'open' && (
                  <button
                    className="cursor-pointer text-[11.5px] text-rust hover:underline"
                    onClick={() =>
                      void withBusy(`wf:${f.id}`, async () => {
                        try {
                          await api.withdrawQcFlag(run.scopeId, f.id)
                          onChanged()
                        } catch (e) {
                          onError(errText(e, 'Could not withdraw the flag.'))
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
            value={flagForm.lessonId}
            onChange={(e) => setFlagForm((s) => ({ ...s, lessonId: e.target.value }))}
            placeholder="Lesson (blank = scope)"
            className="w-[170px] rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
          />
          <datalist id="qc-lessons">
            {lessonIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <select
            value={flagForm.field}
            onChange={(e) => setFlagForm((s) => ({ ...s, field: e.target.value }))}
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
            value={flagForm.type}
            onChange={(e) => setFlagForm((s) => ({ ...s, type: e.target.value as QcFlagType }))}
            className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12.5px] text-ink-2 outline-none"
          >
            {FLAG_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={flagForm.note}
            onChange={(e) => setFlagForm((s) => ({ ...s, note: e.target.value }))}
            placeholder='Your question, e.g. "This ceiling looks low against STAAR 2024"'
            className="min-w-[260px] flex-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
          />
          <Btn disabled={flagForm.note.trim().length === 0 || busy.has(`flag:${run.scopeId}`)} onClick={() => void raiseFlag()}>
            Raise flag
          </Btn>
        </div>
      </div>

      {investigations.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Investigations</SectionLabel>
          <p className="mt-1 text-[11.5px] text-ink-3">
            Repairs are proposals with decision records — accepting one records your verdict as telemetry; nothing is ever
            applied to the scope automatically. Apply accepted diffs by hand via Lesson Scope Edits, then re-run the gates.
          </p>
          <div className="mt-2 space-y-3">
            {investigations
              .slice()
              .reverse()
              .map((inv) => (
                <Investigation key={inv.id} inv={inv} scopeId={run.scopeId} busy={busy} withBusy={withBusy} onChanged={onChanged} onError={onError} />
              ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function Investigation({
  inv,
  scopeId,
  busy,
  withBusy,
  onChanged,
  onError,
}: {
  inv: QcInvestigation
  scopeId: string
  busy: Set<string>
  withBusy: (key: string, fn: () => Promise<void>) => Promise<void>
  onChanged: () => void
  onError: (e: string) => void
}) {
  const [reasonFor, setReasonFor] = useState<{ index: number; decision: 'accept' | 'edit' | 'reject' } | null>(null)
  const [reason, setReason] = useState('')
  const [editedText, setEditedText] = useState('')

  const decisionOn = (index: number) => inv.repairDecisions.find((d) => d.repairIndex === index)

  const submit = () =>
    reasonFor &&
    withBusy(`rep:${inv.id}:${reasonFor.index}`, async () => {
      try {
        await api.decideQcRepair(scopeId, inv.id, reasonFor.index, {
          decision: reasonFor.decision,
          reason: reason.trim(),
          ...(reasonFor.decision === 'edit' ? { editedText: editedText.trim() } : {}),
        })
        setReasonFor(null)
        setReason('')
        setEditedText('')
        onChanged()
      } catch (e) {
        onError(errText(e, 'Could not record the decision.'))
      }
    })

  return (
    <div className="rounded-xl border border-hairline bg-paper p-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        {inv.status === 'running' ? <Pill tone="accent">running</Pill> : inv.status === 'failed' ? <Pill tone="red">failed</Pill> : <Pill tone="green">complete</Pill>}
        <span>
          {when(inv.created)} · {inv.flagIds.length} flag{inv.flagIds.length === 1 ? '' : 's'}
        </span>
        {inv.error && <span className="text-rust">{inv.error}</span>}
      </div>
      {inv.verdicts.length > 0 && (
        <div className="mt-2 space-y-1">
          {inv.verdicts.map((v) => (
            <p key={v.flagId} className="text-[12.5px] leading-relaxed text-ink-2">
              {v.verdict === 'confirmed' ? (
                <span className="font-semibold text-rust">Confirmed{v.severity ? ` (${v.severity})` : ''}:</span>
              ) : (
                <span className="font-semibold text-verdant">Defended:</span>
              )}{' '}
              {v.rationale}
              {v.rootCause && (
                <span className="text-ink-3">
                  {' '}
                  — root cause: {v.rootCause}
                </span>
              )}
            </p>
          ))}
        </div>
      )}
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
      {inv.gateGaps.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Gate gaps (regression cases)</span>
          {inv.gateGaps.map((g, i) => (
            <p key={i} className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
              Gate {g.gate} missed “{g.defectClass}” — {g.whyMissed}
            </p>
          ))}
        </div>
      )}
      {inv.proposedRepairs.length > 0 && (
        <div className="mt-2 space-y-2">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Proposed repairs (diffs — never auto-applied)</span>
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
                      {d.decision === 'accept' ? 'accepted' : d.decision === 'edit' ? 'accepted with edits' : 'rejected'}
                    </Pill>
                  )}
                </div>
                <p className="mt-1.5 border-l-2 border-rust/40 pl-2 text-[12px] leading-relaxed text-ink-3 line-through">{r.currentExcerpt}</p>
                <p className="mt-1 border-l-2 border-verdant/40 pl-2 text-[12px] leading-relaxed text-ink">{d?.editedText ?? r.proposedText}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{r.decisionRecord}</p>
                {d ? (
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    Decision recorded {when(d.decided)}: {d.reason}
                  </p>
                ) : reasonFor?.index === i ? (
                  <div className="mt-2 space-y-1.5">
                    {reasonFor.decision === 'edit' && (
                      <textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        placeholder="Your edited replacement text"
                        rows={3}
                        className="w-full rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (required — every action is telemetry)"
                        className="min-w-[240px] flex-1 rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/40"
                      />
                      <Btn
                        kind="primary"
                        disabled={reason.trim().length === 0 || (reasonFor.decision === 'edit' && editedText.trim().length === 0) || busy.has(`rep:${inv.id}:${i}`)}
                        onClick={() => void submit()}
                      >
                        Record
                      </Btn>
                      <Btn onClick={() => setReasonFor(null)}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <Btn onClick={() => setReasonFor({ index: i, decision: 'accept' })}>Accept</Btn>
                    <Btn onClick={() => { setReasonFor({ index: i, decision: 'edit' }); setEditedText(r.proposedText) }}>Edit</Btn>
                    <Btn kind="danger" onClick={() => setReasonFor({ index: i, decision: 'reject' })}>
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
