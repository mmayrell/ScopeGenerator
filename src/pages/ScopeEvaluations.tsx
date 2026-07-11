import { useCallback, useEffect, useRef, useState } from 'react'
import { UnauthorizedError, api, clearAccessCode } from '../api'
import { useStore } from '../store'
import type { EvalCell, EvalRubricColumn, ScopeEvaluation, ScopeEvaluationSummary } from '../types'
import { Btn, Modal, Pill, SectionLabel } from '../ui'

// Scope Evaluations — the built-in rubric QC layer. Every generated scope is
// scored automatically against the rubric compiled into the backend
// (api/src/data/eval-rubric.ts): the agent fills every rubric column with a
// verdict + note, results are computed per the verdict rule, and the SME
// records their own verdict here. Runs are deletable and the whole table
// exports as CSV.

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

/** Stop watching a dispatched evaluation after this long — its job page has the error. */
const DISPATCH_WATCH_MS = 15 * 60 * 1000
const POLL_MS = 5000

const SME_VERDICTS = ['FAIL', 'PASS — GOOD', 'PASS — GOOD ENOUGH']

const verdictPill = (verdict: string) =>
  /fail/i.test(verdict) ? (
    <Pill tone="red">{verdict}</Pill>
  ) : /good enough/i.test(verdict) ? (
    <Pill tone="amber">{verdict}</Pill>
  ) : (
    <Pill tone="green">{verdict}</Pill>
  )

const scoreTone = (verdict: string): string => {
  const v = verdict.trim()
  if (v === '3' || /^accurate$/i.test(v)) return 'bg-moss/10 text-moss-deep'
  if (v === '2') return 'bg-amber-500/10 text-amber-700'
  if (v === '1' || /^inaccurate$/i.test(v)) return 'bg-rust/10 text-rust'
  return 'bg-ink/5 text-ink-2'
}

/** Heading matcher tolerant of sheet-era suffixes ('Major/Supporting *If applicable '). */
const normHeading = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const headingsMatch = (a: string, b: string): boolean => {
  const na = normHeading(a)
  const nb = normHeading(b)
  return na === nb || na.startsWith(nb) || nb.startsWith(na)
}

// RFC 4180 quoting plus formula neutralization (mirrors scope-csv.ts): Excel
// and Sheets evaluate a cell beginning with = + - or @ even when quoted, and
// these cells carry model- and SME-authored free text.
const csvField = (v: string): string => {
  const neutralized = /^[=+\-@]/.test(v) ? `'${v}` : v
  return `"${neutralized.replace(/"/g, '""')}"`
}

function buildCsv(rubric: EvalRubricColumn[], records: ScopeEvaluation[]): string {
  const cols = rubric.filter((c) => c.role !== 'sme')
  const smeCols = rubric.filter((c) => c.role === 'sme')
  const groups = [...cols.map((c) => c.group), ...smeCols.map((c) => c.group)]
  const heads = [...cols.map((c) => c.heading), ...smeCols.map((c) => c.heading)]
  const rows = records.map((ev) => {
    const stored = ev.headings ?? []
    const valueFor = (heading: string): string => {
      const i = stored.findIndex((h) => headingsMatch(h, heading))
      return i >= 0 ? (ev.values[i] ?? '') : ''
    }
    return [...cols.map((c) => valueFor(c.heading)), ev.sme ?? '', ev.smeVerdict ?? '', ev.smeNotes ?? '']
  })
  return [groups, heads, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')
}

function downloadCsv(content: string, fileName: string): void {
  // BOM so Excel opens the UTF-8 content (em dashes in the verdicts) correctly.
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface DispatchWatch {
  prevUpdated: string
  startedAt: number
}

export default function ScopeEvaluations() {
  const { scopes } = useStore()
  const [rubric, setRubric] = useState<EvalRubricColumn[]>([])
  const [evals, setEvals] = useState<ScopeEvaluationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [dispatched, setDispatched] = useState<Record<string, DispatchWatch>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScopeEvaluation | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ScopeEvaluationSummary | null>(null)
  // Mirrors openId for async guards: a slow getEval response for a
  // previously opened run must never replace the currently open one.
  const openIdRef = useRef<string | null>(null)
  const setOpen = (id: string | null) => {
    openIdRef.current = id
    setOpenId(id)
  }

  const load = useCallback(
    () =>
      api
        .listEvals()
        .then((d) => {
          setRubric(d.rubric)
          setEvals(d.evaluations)
          setError(null)
        })
        .catch((e: unknown) => setError(errText(e, 'Could not load the evaluations.'))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  // While any dispatched evaluation is outstanding, poll for its result.
  const watching = Object.keys(dispatched).length > 0
  useEffect(() => {
    if (!watching) return
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [watching, load])

  // A watch ends when the row's `updated` moves past its dispatch-time value
  // (or the watch times out — the evaluation failed server-side).
  useEffect(() => {
    if (!evals) return
    setDispatched((d) => {
      const entries = Object.entries(d)
      if (entries.length === 0) return d
      const next: Record<string, DispatchWatch> = {}
      let changed = false
      for (const [id, w] of entries) {
        const ev = evals.find((e) => e.scopeId === id)
        const done = ev !== undefined && ev.updated !== w.prevUpdated
        const expired = Date.now() - w.startedAt > DISPATCH_WATCH_MS
        if (done || expired) changed = true
        else next[id] = w
      }
      return changed ? next : d
    })
  }, [evals])

  // Refresh the open details view when its evaluation completes a re-run.
  useEffect(() => {
    if (!openId || !evals) return
    const summary = evals.find((e) => e.scopeId === openId)
    if (summary && detail && summary.updated !== detail.updated) {
      api
        .getEval(openId)
        .then((d) => {
          if (openIdRef.current === d.scopeId) setDetail(d)
        })
        .catch(() => undefined)
    }
  }, [evals, openId, detail])

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(key))
    setError(null)
    try {
      await fn()
      await load()
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

  const runEval = (scopeId: string) =>
    void act(`run-${scopeId}`, async () => {
      await api.runEval(scopeId)
      setDispatched((d) => ({
        ...d,
        [scopeId]: {
          prevUpdated: evals?.find((e) => e.scopeId === scopeId)?.updated ?? '',
          startedAt: Date.now(),
        },
      }))
    })

  const openDetails = (scopeId: string) => {
    if (openId === scopeId) {
      setOpen(null)
      setDetail(null)
      return
    }
    setOpen(scopeId)
    setDetail(null)
    api
      .getEval(scopeId)
      .then((d) => {
        if (openIdRef.current === d.scopeId) setDetail(d)
      })
      .catch((e: unknown) => setError(errText(e, 'Could not load the evaluation details.')))
  }

  const exportCsv = () =>
    void act('csv', async () => {
      const ids = (evals ?? []).map((e) => e.scopeId)
      if (ids.length === 0) throw new Error('No evaluations to export yet.')
      const records = await Promise.all(ids.map((id) => api.getEval(id)))
      downloadCsv(buildCsv(rubric, records), `scope-evaluations-${new Date().toISOString().slice(0, 10)}.csv`)
    })

  const evaluated = new Set((evals ?? []).map((e) => e.scopeId))
  const unevaluated = scopes.filter((s) => s.status === 'complete' && !evaluated.has(s.id))

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Scope Evaluations</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-ink-2">
            Every generated scope gets a validation run: an evaluation agent scores it against the built-in rubric —
            column by column, hard gates marked — computes the verdict, and explains every deduction. Open a run to
            read the details and record the SME verdict.
          </p>
        </div>
        <Btn kind="primary" disabled={busy.has('csv') || (evals ?? []).length === 0} onClick={exportCsv}>
          {busy.has('csv') ? 'Building…' : 'Download CSV'}
        </Btn>
      </div>

      {error && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}

      {/* evaluation runs */}
      <div className="mt-8">
        <SectionLabel>Validation Runs</SectionLabel>
        <div className="mt-2 space-y-2">
          {(evals ?? []).map((ev) => (
            <div key={ev.scopeId} className="rounded-xl border border-hairline bg-panel">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-[13px] font-semibold text-ink">{ev.scopeTitle}</span>
                {verdictPill(ev.autoVerdict)}
                {ev.smeVerdict && (
                  <span className="flex items-center gap-1 text-[11px] text-ink-3">
                    SME: {verdictPill(ev.smeVerdict)}
                  </span>
                )}
                <span className="text-[11.5px] text-ink-3">
                  {ev.failCount} fail{ev.failCount === 1 ? '' : 's'}
                  {ev.hardGateFails.length > 0 ? ` · hard gates: ${ev.hardGateFails.join(', ')}` : ''} · avg{' '}
                  {ev.averageScore || '—'} · {when(ev.updated)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {dispatched[ev.scopeId] && <Pill tone="amber">Evaluating…</Pill>}
                  <Btn onClick={() => openDetails(ev.scopeId)}>{openId === ev.scopeId ? 'Hide Details' : 'View Details'}</Btn>
                  <Btn disabled={busy.has(`run-${ev.scopeId}`) || dispatched[ev.scopeId] !== undefined} onClick={() => runEval(ev.scopeId)}>
                    {busy.has(`run-${ev.scopeId}`) ? 'Dispatching…' : 'Re-evaluate'}
                  </Btn>
                  <Btn
                    kind="danger"
                    disabled={dispatched[ev.scopeId] !== undefined || busy.has(`delete-${ev.scopeId}`)}
                    onClick={() => setConfirmDelete(ev)}
                  >
                    Delete
                  </Btn>
                </div>
              </div>
              {openId === ev.scopeId && (
                <div className="border-t border-hairline px-4 py-4">
                  {detail && detail.scopeId === ev.scopeId ? (
                    <EvalDetails
                      key={ev.scopeId}
                      rubric={rubric}
                      detail={detail}
                      saving={busy.has(`sme-${ev.scopeId}`)}
                      onSaveSme={(body) =>
                        void act(`sme-${ev.scopeId}`, async () => {
                          await api.saveEvalSme(ev.scopeId, body)
                          setDetail(await api.getEval(ev.scopeId))
                        })
                      }
                    />
                  ) : (
                    <p className="text-[12.5px] text-ink-3">Loading details…</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {evals !== null && evals.length === 0 && (
            <p className="rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
              No validation runs yet — they run automatically when a scope finishes generating, or run one on an
              existing course below.
            </p>
          )}
          {evals === null && !error && <p className="text-[12.5px] text-ink-3">Loading evaluations…</p>}
        </div>

        {unevaluated.length > 0 && (
          <div className="mt-3 rounded-xl border border-hairline bg-panel/50 px-4 py-3">
            <p className="text-[11.5px] text-ink-3">Run a validation on a generated course:</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {unevaluated.map((s) => (
                <Btn key={s.id} disabled={busy.has(`run-${s.id}`) || dispatched[s.id] !== undefined} onClick={() => runEval(s.id)}>
                  {busy.has(`run-${s.id}`)
                    ? 'Dispatching…'
                    : dispatched[s.id]
                      ? `Evaluating "${s.title}"…`
                      : `Evaluate "${s.title}"`}
                </Btn>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete This Validation Run?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This permanently deletes the evaluation of{' '}
          <span className="font-semibold text-ink">{confirmDelete?.scopeTitle}</span>, including any SME entries on
          it. The scope itself is untouched, and a fresh evaluation can be run at any time.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              const target = confirmDelete
              setConfirmDelete(null)
              if (target) {
                if (openId === target.scopeId) {
                  setOpen(null)
                  setDetail(null)
                }
                void act(`delete-${target.scopeId}`, () => api.deleteEval(target.scopeId))
              }
            }}
          >
            Delete
          </Btn>
        </div>
      </Modal>
      <div className="h-16" />
    </div>
  )
}

function EvalDetails({
  rubric,
  detail,
  saving,
  onSaveSme,
}: {
  rubric: EvalRubricColumn[]
  detail: ScopeEvaluation
  saving: boolean
  onSaveSme: (body: { sme: string; smeVerdict: string; smeNotes: string }) => void
}) {
  const [sme, setSme] = useState(detail.sme ?? '')
  const [smeVerdict, setSmeVerdict] = useState(detail.smeVerdict ?? '')
  const [smeNotes, setSmeNotes] = useState(detail.smeNotes ?? '')
  // Unsaved edits survive detail refreshes (a re-evaluation completing while
  // the SME is typing must not wipe the draft) — the form only re-syncs from
  // the server when it is pristine.
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty) return
    setSme(detail.sme ?? '')
    setSmeVerdict(detail.smeVerdict ?? '')
    setSmeNotes(detail.smeNotes ?? '')
  }, [detail, dirty])

  const cellFor = (heading: string): EvalCell | undefined =>
    detail.cells.find((c) => headingsMatch(c.heading, heading))
  const valueFor = (heading: string): string => {
    const stored = detail.headings ?? []
    const i = stored.findIndex((h) => headingsMatch(h, heading))
    return i >= 0 ? (detail.values[i] ?? '') : ''
  }
  const adminCols = rubric.filter((c) => c.role === 'admin')
  const bands = [
    { name: 'Lesson-Specific Fields', cols: rubric.filter((c) => c.role === 'rubric' && /lesson/i.test(c.group)) },
    { name: 'Course-Specific Fields', cols: rubric.filter((c) => c.role === 'rubric' && !/lesson/i.test(c.group)) },
  ]
  const jsonUrl = valueFor('JSON')
  const notes = valueFor('AI-QC Notes')

  return (
    <div className="space-y-5">
      {/* administrative details */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-2">
        {adminCols.map((c) =>
          c.heading === 'JSON' ? (
            jsonUrl ? (
              <a key={c.heading} href={jsonUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-deep hover:underline">
                Scope JSON ↗
              </a>
            ) : null
          ) : (
            <span key={c.heading}>
              <span className="text-ink-3">{c.heading}:</span> <span className="font-medium text-ink">{valueFor(c.heading) || '—'}</span>
            </span>
          ),
        )}
      </div>

      {/* rubric bands */}
      {bands.map((band) => (
        <div key={band.name}>
          <SectionLabel>{band.name}</SectionLabel>
          <div className="mt-1.5 overflow-hidden rounded-xl border border-hairline">
            {band.cols.map((col, i) => {
              const cell = cellFor(col.heading)
              return (
                <div
                  key={col.heading}
                  className={`flex flex-wrap items-start gap-3 px-3.5 py-2.5 ${i % 2 === 1 ? 'bg-panel/60' : 'bg-panel'}`}
                >
                  <div className="w-52 shrink-0">
                    <span className="text-[12.5px] font-semibold text-ink" title={col.rubric}>
                      {col.heading}
                    </span>
                    {col.hardGate && <span className="ml-1.5 rounded bg-rust/10 px-1 py-0.5 text-[9.5px] font-bold tracking-wide text-rust">HARD GATE</span>}
                  </div>
                  <span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-[12px] font-bold ${scoreTone(cell?.verdict ?? '')}`}>
                    {cell?.verdict ?? '—'}
                  </span>
                  <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">{cell?.note || <span className="text-ink-3">No defects noted.</span>}</p>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* results */}
      <div>
        <SectionLabel>Results</SectionLabel>
        <div className="mt-1.5 rounded-xl border border-hairline bg-panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {verdictPill(detail.autoVerdict)}
            <span className="text-[12px] text-ink-2">
              {detail.failCount} fail{detail.failCount === 1 ? '' : 's'} · hard gate fails:{' '}
              {detail.hardGateFails.length > 0 ? detail.hardGateFails.join(', ') : 'none'} · average{' '}
              {detail.averageScore || '—'}
            </span>
          </div>
          {notes && <pre className="mt-2.5 font-sans whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{notes}</pre>}
        </div>
      </div>

      {/* SME entry */}
      <div>
        <SectionLabel>SME Review</SectionLabel>
        <div className="mt-1.5 rounded-xl border border-hairline bg-panel px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={sme}
              onChange={(e) => {
                setSme(e.target.value)
                setDirty(true)
              }}
              placeholder="SME (your name or initials)"
              className="w-56 rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
            <select
              value={smeVerdict}
              onChange={(e) => {
                setSmeVerdict(e.target.value)
                setDirty(true)
              }}
              className="cursor-pointer rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none focus:border-accent/40"
            >
              <option value="">SME verdict…</option>
              {SME_VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {detail.smeUpdated && <span className="text-[11px] text-ink-3">last saved {when(detail.smeUpdated)}</span>}
          </div>
          <textarea
            value={smeNotes}
            onChange={(e) => {
              setSmeNotes(e.target.value)
              setDirty(true)
            }}
            rows={3}
            placeholder="SME notes — agreements, disagreements, required changes…"
            className="mt-2.5 w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
          <div className="mt-2 flex justify-end">
            <Btn
              kind="primary"
              disabled={saving}
              onClick={() => {
                setDirty(false)
                onSaveSme({ sme, smeVerdict, smeNotes })
              }}
            >
              {saving ? 'Saving…' : 'Save SME Review'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
