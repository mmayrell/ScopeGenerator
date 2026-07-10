import { useCallback, useEffect, useState } from 'react'
import { UnauthorizedError, api, clearAccessCode } from '../api'
import { useStore } from '../store'
import type { ScopeEvaluationSummary } from '../types'
import { Btn, Pill, SectionLabel } from '../ui'

// Scope Evaluations — the rubric spreadsheet, embedded, plus the agent that
// fills it. Every generated scope is scored automatically against the
// rubrics that live IN the sheet's column headings (edit a rubric there and
// the next evaluation uses it — no deploy); the last three columns belong to
// the human SME and are never touched. Rows reach Google through an Apps
// Script webhook pasted once below.

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1HYeLKwtRv-PujoNowQ0CqMMUTfdazvhYXfKt2_IX-9w/edit?gid=0#gid=0'

/** Stop watching a dispatched evaluation after this long — its job page has the error. */
const DISPATCH_WATCH_MS = 15 * 60 * 1000
const POLL_MS = 5000

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

const verdictPill = (verdict: string) =>
  /fail/i.test(verdict) ? (
    <Pill tone="red">{verdict}</Pill>
  ) : /good enough/i.test(verdict) ? (
    <Pill tone="amber">{verdict}</Pill>
  ) : (
    <Pill tone="green">{verdict}</Pill>
  )

const APPS_SCRIPT = `function doPost(e) {
  var sheet = SpreadsheetApp.openById('1HYeLKwtRv-PujoNowQ0CqMMUTfdazvhYXfKt2_IX-9w').getSheets()[0];
  var body = JSON.parse(e.postData.contents);
  // body.values EXCLUDES the trailing SME columns, so this upsert can never
  // overwrite the human's entries. scopeId lives far right of every column.
  var ID_COL = 50;
  var last = sheet.getLastRow();
  var row = 0;
  if (last > 0) {
    var ids = sheet.getRange(1, ID_COL, last, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === body.scopeId) { row = i + 1; break; }
  }
  if (row === 0) row = last + 1;
  sheet.getRange(row, 1, 1, body.values.length).setValues([body.values]);
  sheet.getRange(row, ID_COL).setValue(body.scopeId);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`

/** A dispatched evaluation being watched: the row's `updated` at dispatch time (skew-immune "done" test) + a watch deadline. */
interface DispatchWatch {
  prevUpdated: string
  startedAt: number
}

export default function ScopeEvaluations() {
  const { scopes } = useStore()
  const [connected, setConnected] = useState(false)
  const [evals, setEvals] = useState<ScopeEvaluationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [webhook, setWebhook] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [dispatched, setDispatched] = useState<Record<string, DispatchWatch>>({})

  const load = useCallback(
    () =>
      api
        .listEvals()
        .then((d) => {
          setConnected(d.connected)
          setEvals(d.evaluations)
          setError(null)
        })
        .catch((e: unknown) => setError(errText(e, 'Could not load the evaluations.'))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  // While any dispatched evaluation is outstanding, poll for its row.
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
        const nextSet = new Set(b)
        nextSet.delete(key)
        return nextSet
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

  const evaluated = new Set((evals ?? []).map((e) => e.scopeId))
  const unevaluated = scopes.filter((s) => s.status === 'complete' && !evaluated.has(s.id))

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Scope Evaluations</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-ink-2">
            Every generated scope gets a row: an evaluation agent scores it against the rubric written into each
            column heading of the sheet, fills the row, and computes the verdict — the last three columns stay blank
            for the SME. Edit a rubric in the sheet and the next evaluation scores against it.
          </p>
        </div>
        <Btn kind="primary" onClick={() => window.open(SHEET_URL, '_blank', 'noopener,noreferrer')}>
          Open in Google Sheets
        </Btn>
      </div>

      {error && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}

      {/* connection strip */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-panel px-4 py-3">
        {connected ? <Pill tone="green">Sheet Writing Connected</Pill> : <Pill tone="amber">Sheet Writing Not Connected</Pill>}
        <span className="text-[12px] text-ink-3">
          {connected
            ? 'Evaluation rows write to the sheet automatically.'
            : 'Evaluations run and store here; rows reach the sheet once the webhook is connected.'}
        </span>
        <button
          onClick={() => setShowSetup((s) => !s)}
          className="ml-auto cursor-pointer text-[12px] font-medium text-accent-deep hover:underline"
        >
          {showSetup ? 'Hide setup' : connected ? 'Change connection' : 'Connect the sheet (2 minutes)'}
        </button>
      </div>

      {showSetup && (
        <div className="mt-3 rounded-xl border border-hairline bg-panel/50 p-4">
          <SectionLabel>Connect Sheet Writing</SectionLabel>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2">
            <li>Open the sheet → Extensions → Apps Script, and paste this code (replaces everything):</li>
          </ol>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-hairline bg-night p-3 text-[11px] leading-relaxed text-white">{APPS_SCRIPT}</pre>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2" start={2}>
            <li>Deploy → New deployment → type "Web app" → Execute as <span className="font-semibold">Me</span>, access <span className="font-semibold">Anyone</span> → Deploy.</li>
            <li>Copy the web-app URL and paste it here:</li>
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="w-full max-w-xl rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
            <Btn
              kind="primary"
              disabled={busy.has('connect') || !webhook.trim()}
              onClick={() =>
                void act('connect', async () => {
                  await api.setEvalsWebhook(webhook.trim())
                  setShowSetup(false)
                  setWebhook('')
                })
              }
            >
              {busy.has('connect') ? 'Saving…' : 'Save Connection'}
            </Btn>
          </div>
        </div>
      )}

      {/* evaluation rows */}
      <div className="mt-8">
        <SectionLabel>Evaluations</SectionLabel>
        <div className="mt-2 space-y-2">
          {(evals ?? []).map((ev) => (
            <div key={ev.scopeId} className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-panel px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">{ev.scopeTitle}</span>
              {verdictPill(ev.autoVerdict)}
              <span className="text-[11.5px] text-ink-3">
                {ev.failCount} fail{ev.failCount === 1 ? '' : 's'}
                {ev.hardGateFails.length > 0 ? ` · hard gates: ${ev.hardGateFails.join(', ')}` : ''} · avg {ev.averageScore || '—'} ·{' '}
                {when(ev.updated)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {dispatched[ev.scopeId] && <Pill tone="amber">Evaluating…</Pill>}
                {ev.exportStatus === 'exported' ? (
                  <Pill tone="green">In Sheet</Pill>
                ) : (
                  <>
                    <Pill tone="amber">Pending Export</Pill>
                    {connected && (
                      <Btn
                        disabled={busy.has(`push-${ev.scopeId}`)}
                        onClick={() => void act(`push-${ev.scopeId}`, () => api.pushEval(ev.scopeId))}
                      >
                        {busy.has(`push-${ev.scopeId}`) ? 'Pushing…' : 'Push to Sheet'}
                      </Btn>
                    )}
                  </>
                )}
                <Btn disabled={busy.has(`run-${ev.scopeId}`) || dispatched[ev.scopeId] !== undefined} onClick={() => runEval(ev.scopeId)}>
                  {busy.has(`run-${ev.scopeId}`) ? 'Dispatching…' : 'Re-evaluate'}
                </Btn>
              </div>
              {ev.exportError && <p className="w-full text-[11.5px] text-rust">Last push failed: {ev.exportError}</p>}
            </div>
          ))}
          {evals !== null && evals.length === 0 && (
            <p className="rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
              No evaluations yet — they run automatically when a scope finishes generating, or evaluate an existing
              scope below.
            </p>
          )}
          {evals === null && !error && <p className="text-[12.5px] text-ink-3">Loading evaluations…</p>}
        </div>
        {unevaluated.length > 0 && (
          <div className="mt-3 rounded-xl border border-hairline bg-panel/50 px-4 py-3">
            <p className="text-[11.5px] text-ink-3">Published scopes without an evaluation:</p>
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

      {/* the sheet itself */}
      <div className="mt-8">
        <SectionLabel>The Rubric Sheet</SectionLabel>
        <div className="mt-2 overflow-hidden rounded-2xl border border-hairline bg-panel shadow-(--shadow-lift)">
          <iframe src={SHEET_URL} title="Scope evaluation rubric sheet" className="h-[72vh] w-full border-0" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Editing requires being signed into a Google account with access — otherwise use "Open in Google Sheets".
          The SME, SME Verdict, and SME Notes columns are yours; the agent never writes them.
        </p>
      </div>
      <div className="h-16" />
    </div>
  )
}
