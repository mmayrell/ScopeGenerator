import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { NotFoundError, UnauthorizedError, api, clearAccessCode, type JobStatus } from '../api'
import { useStore } from '../store'
import type {
  LsgCourse,
  VideoScript,
  VsgChannel,
  VsgConflict,
  VsgInteraction,
  VsgRun,
  VsgRunLesson,
  VsgRunSummary,
} from '../types'
import { Btn, capsStandardCodes, Modal, Mono, Pill, SectionLabel } from '../ui'

// Video Script Generator — turns generated lesson cards into production-ready
// scripts for 2-5 minute (by grade band; sufficiency governs, rulebook TIM 01)
// DI math videos with checked student interactions.
// Pick a published scope, multi-select lessons (grouped by unit),
// generate; each lesson's script renders channel-colored per the playbook
// (§3) and conflicts pause per lesson for flag → propose → reconcile.

/** Mirrors the backend cap (http-vsg MAX_LESSONS_PER_RUN) so the error surfaces before launch. */
const MAX_LESSONS_PER_RUN = 60

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

const Chip = ({ on, disabled, title, children, onClick }: { on: boolean; disabled?: boolean; title?: string; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    title={title}
    className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      disabled
        ? 'cursor-not-allowed border-hairline bg-panel/50 text-ink-3 opacity-60'
        : on
          ? 'cursor-pointer border-accent/40 bg-accent-wash text-accent-deep'
          : 'cursor-pointer border-hairline bg-panel text-ink-2 hover:border-hairline-2'
    }`}
  >
    {children}
  </button>
)

const ErrorStrip = ({ text }: { text: string }) => (
  <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{text}</div>
)

const runStatusPill = (status: VsgRun['status']) =>
  status === 'generating' ? (
    <Pill tone="accent">Generating…</Pill>
  ) : status === 'complete' ? (
    <Pill tone="green">Complete</Pill>
  ) : status === 'needs-reconciliation' ? (
    <Pill tone="amber">Needs Reconciliation</Pill>
  ) : (
    <Pill tone="red">Failed</Pill>
  )

const lessonStatusPill = (status: VsgRunLesson['status']) =>
  status === 'complete' ? (
    <Pill tone="green">Script Ready</Pill>
  ) : status === 'needs-reconciliation' ? (
    <Pill tone="amber">Needs Reconciliation</Pill>
  ) : status === 'failed' ? (
    <Pill tone="red">Failed</Pill>
  ) : (
    <Pill tone="accent">{status === 'generating' ? 'Writing…' : 'Queued'}</Pill>
  )

// Playbook §3 channel colors — the channel owns its color everywhere.
const CHANNEL_STYLE: Record<VsgChannel, { tag: string; text: string }> = {
  SAY: { tag: 'bg-night text-white', text: 'text-ink' },
  TEXT: { tag: 'bg-blue-700 text-white', text: 'text-blue-800' },
  VISUAL: { tag: 'bg-green-700 text-white', text: 'text-green-800' },
  INTERACTION: { tag: 'bg-purple-700 text-white', text: 'text-purple-800' },
  NOTE: { tag: 'bg-gray-400 text-white', text: 'text-gray-500 italic' },
}

const SEGMENT_LABELS: Record<string, string> = {
  opening: 'Opening',
  'i-do': 'I Do',
  'we-do': 'We Do',
  discrimination: 'Discrimination Pass',
  wrap: 'Wrap',
  // Legacy kinds on scripts generated before rulebook v2.
  title: 'Title',
  intro: 'Intro',
}

type View = { kind: 'list' } | { kind: 'builder' } | { kind: 'run'; id: string }

export default function VideoScriptGen() {
  const [view, setView] = useState<View>({ kind: 'list' })

  return view.kind === 'builder' ? (
    <Builder onLaunched={(id) => setView({ kind: 'run', id })} onBack={() => setView({ kind: 'list' })} />
  ) : view.kind === 'run' ? (
    <RunDetail id={view.id} onBack={() => setView({ kind: 'list' })} />
  ) : (
    <Overview onNew={() => setView({ kind: 'builder' })} onOpenRun={(id) => setView({ kind: 'run', id })} />
  )
}

// ---------------------------------------------------------------------------
// Overview — past runs
// ---------------------------------------------------------------------------

function Overview({ onNew, onOpenRun }: { onNew: () => void; onOpenRun: (id: string) => void }) {
  const [runs, setRuns] = useState<VsgRunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VsgRunSummary | null>(null)

  const load = useCallback(() => {
    api
      .listVsgRuns()
      .then((list) => {
        setRuns(list)
        setError(null)
      })
      .catch((e: unknown) => {
        // Deploy-skew shim: an API without the vsg endpoints yet means "no runs".
        if (e instanceof NotFoundError) {
          setRuns([])
          setError(null)
          return
        }
        setError(errText(e, 'Could not load runs.'))
      })
  }, [])
  useEffect(load, [load])

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Video Script Generator</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
            Turn generated lesson cards into production-ready scripts for 2–5 minute Direct Instruction videos with
            checked student interactions — explicit model first, then guided participation. Scripts follow Stein's
            teaching formats and the versioned playbook; conflicting inputs pause per lesson for your reconciliation.
          </p>
        </div>
        <Btn kind="primary" onClick={onNew}>New Run</Btn>
      </div>

      {error && <ErrorStrip text={error} />}

      <div className="mt-8 space-y-3">
        {(runs ?? []).map((r) => (
          <div key={r.id} className="relative">
            <button
              onClick={() => onOpenRun(r.id)}
              className="block w-full cursor-pointer rounded-2xl border border-hairline bg-panel p-5 pr-12 text-left shadow-(--shadow-lift) transition-colors hover:border-hairline-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[16px] font-semibold text-ink">{r.courseName}</span>
                {runStatusPill(r.status)}
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                {r.lessonCount} lesson{r.lessonCount === 1 ? '' : 's'} · {r.completeCount} script{r.completeCount === 1 ? '' : 's'} ready
                {r.needsReconciliationCount > 0 ? ` · ${r.needsReconciliationCount} awaiting reconciliation` : ''} · created {when(r.created)}
              </p>
              {r.status === 'failed' && r.error && <p className="mt-1 text-[11.5px] leading-relaxed text-rust">{r.error}</p>}
            </button>
            <button
              onClick={() => setConfirmDelete(r)}
              className="absolute top-5 right-4 flex cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-rust/10 hover:text-rust"
              title="Delete run"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8V4M5 4l.5 9a1 1 0 001 .95h3a1 1 0 001-.95L11 4M6.7 6.8v4.4M9.3 6.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
        {runs !== null && runs.length === 0 && (
          <div className="rounded-2xl border border-hairline bg-panel p-6 text-[13px] leading-relaxed text-ink-3">
            No runs yet. Start one: pick a generated course, select lessons, and the generator writes a color-coded
            video script for each.
          </div>
        )}
        {runs === null && !error && <p className="text-[12.5px] text-ink-3">Loading runs…</p>}
      </div>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete Run?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This permanently deletes the run for <span className="font-semibold text-ink">{confirmDelete?.courseName}</span>{' '}
          and the stored script documents of every lesson in it. This cannot be undone — download anything you want to
          keep first.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              const target = confirmDelete
              setConfirmDelete(null)
              if (target) {
                setRuns((prev) => (prev ? prev.filter((r) => r.id !== target.id) : prev))
                api.deleteVsgRun(target.id).catch(() => load())
              }
            }}
          >
            Delete
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Builder — pick a PUBLISHED SCOPE, multi-select its lessons, generate. The
// backing course syncs mechanically (instant, no generation) when a scope is
// picked, so Step 2 always offers all of the scope's lessons, and deleted
// scopes never appear (the list comes live from the scopes store).
// ---------------------------------------------------------------------------

/** Mirrors the backend courseIdFromName — the scope title keys its backing course. */
const slugOf = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-course'

function Builder({ onLaunched, onBack }: { onLaunched: (id: string) => void; onBack: () => void }) {
  const { scopes } = useStore()
  const published = scopes.filter((s) => s.status === 'complete')
  const [scopeId, setScopeId] = useState('')
  const [course, setCourse] = useState<LsgCourse | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [steering, setSteering] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Picking a scope syncs its backing course; when a live video-script run
  // blocks the sync (409 guard), fall back to the course as it stands.
  useEffect(() => {
    if (!scopeId) return
    const sc = scopes.find((s) => s.id === scopeId)
    if (!sc) return
    let stale = false // scope A's slow response must not land under scope B's selection
    setCourse(null)
    setSelected(new Set())
    setSyncing(true)
    setError(null)
    api
      .importScopeCourse(sc.id, sc.title)
      .then(({ course: synced }) => {
        if (!stale) setCourse(synced)
      })
      .catch(async (e: unknown) => {
        try {
          const existing = await api.getLsgCourse(slugOf(sc.title))
          if (!stale) setCourse(existing)
        } catch {
          if (!stale) {
            setError(
              e instanceof NotFoundError
                ? 'The backend is still rolling out this feature — try again in a couple of minutes.'
                : errText(e, 'Could not prepare the course.'),
            )
          }
        }
      })
      .finally(() => {
        if (!stale) setSyncing(false)
      })
    return () => {
      stale = true
    }
    // Keyed on the scope id alone — `scopes` re-derives every store refresh
    // and must not re-trigger the sync mid-selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId])

  const active = (course?.lessons ?? []).filter((l) => l.status === 'ACTIVE').sort((a, b) => a.lessonOrder - b.lessonOrder)
  const units: { unitName: string; lessons: typeof active }[] = []
  for (const l of active) {
    const u = units.find((x) => x.unitName === l.unitName)
    if (u) u.lessons.push(l)
    else units.push({ unitName: l.unitName, lessons: [l] })
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const launch = async () => {
    if (!course) return
    setLaunching(true)
    setError(null)
    try {
      const { run } = await api.createVsgRun({ courseId: course.courseId, lessonIds: [...selected], steering })
      onLaunched(run.id)
    } catch (e) {
      setError(
        e instanceof NotFoundError
          ? 'The backend is still rolling out this feature — try again in a couple of minutes.'
          : errText(e, 'Could not start the run.'),
      )
      setLaunching(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <Btn onClick={onBack}>← Back to runs</Btn>
      <h1 className="mt-4 font-display text-[28px] font-semibold tracking-tight text-ink">New Video Script Run</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Pick a published scope, select the lessons to script, and generate. Each selected lesson becomes one
        production-ready video script: lesson card + Stein's teaching formats + the playbook.
      </p>

      {error && <ErrorStrip text={error} />}

      <div className="mt-8 space-y-7">
        <div>
          <SectionLabel>Step 1 — Published Scope</SectionLabel>
          <div className="mt-2 space-y-2">
            {published.map((s) => (
              <button
                key={s.id}
                onClick={() => setScopeId(s.id)}
                className={`block w-full cursor-pointer rounded-xl border p-4 text-left transition-colors ${
                  scopeId === s.id ? 'border-accent/40 bg-accent-wash' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-ink">{s.title}</span>
                  <span className="text-[11.5px] text-ink-3">
                    {s.units.length} unit{s.units.length === 1 ? '' : 's'} ·{' '}
                    {s.units.reduce((n, u) => n + u.lessons.length, 0)} lessons
                  </span>
                </div>
              </button>
            ))}
            {published.length === 0 && (
              <p className="rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
                No published scopes yet — generate a scope first; it appears here the moment it completes.
              </p>
            )}
          </div>
        </div>

        {scopeId && (
          <div>
            <SectionLabel>Step 2 — Lessons</SectionLabel>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {selected.size === 0
                ? `All ${active.length} of the scope's lessons are available — select the ones to script. `
                : `${selected.size} selected of ${active.length}. `}
              {active.length > 0 && (
                <span className="inline-flex items-center gap-2">
                  <button
                    onClick={() => setSelected(new Set(active.map((l) => l.lessonId)))}
                    className="cursor-pointer font-medium text-accent-deep hover:underline"
                  >
                    Select all
                  </button>
                  {selected.size > 0 && (
                    <button
                      onClick={() => setSelected(new Set())}
                      className="cursor-pointer font-medium text-ink-3 hover:text-ink-2 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </span>
              )}
            </p>
            {syncing && <p className="mt-2 text-[12.5px] text-ink-3">Syncing the scope's lessons…</p>}
            {!course && !syncing && <p className="mt-2 text-[12.5px] text-ink-3">Loading lessons…</p>}
            <div className="mt-2 space-y-4">
              {units.map((u) => {
                const allOn = u.lessons.every((l) => selected.has(l.lessonId))
                return (
                  <div key={u.unitName} className="rounded-xl border border-hairline bg-panel/50 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-semibold text-ink">{u.unitName}</span>
                      <button
                        onClick={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            for (const l of u.lessons) {
                              if (allOn) next.delete(l.lessonId)
                              else next.add(l.lessonId)
                            }
                            return next
                          })
                        }
                        className="cursor-pointer text-[11.5px] font-medium text-accent-deep hover:underline"
                      >
                        {allOn ? 'Clear unit' : 'Select all'}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {u.lessons.map((l) => (
                        <Chip
                          key={l.lessonId}
                          on={selected.has(l.lessonId)}
                          title={`${capsStandardCodes(l.standardId)} · lesson ${l.lessonOrder}`}
                          onClick={() => toggle(l.lessonId)}
                        >
                          {l.lessonTitle}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {scopeId && (
          <div>
            <SectionLabel>Steering Instruction (Optional)</SectionLabel>
            <p className="mt-0.5 text-[11.5px] text-ink-3">Steers below doctrine — it may tighten, never override the playbook or the card's boundary.</p>
            <textarea
              value={steering}
              onChange={(e) => setSteering(e.target.value)}
              rows={3}
              placeholder="e.g. Keep the We Do example under 20 seconds per step; prefer numeric entry throughout."
              className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-hairline pt-5">
          <span className="text-[12.5px] text-ink-2">
            <span className="font-semibold text-ink">{selected.size}</span> lesson{selected.size === 1 ? '' : 's'} to script
            {selected.size > MAX_LESSONS_PER_RUN && (
              <span className="text-rust"> · at most {MAX_LESSONS_PER_RUN} per run — split into multiple runs</span>
            )}
          </span>
          <Btn
            kind="primary"
            disabled={selected.size === 0 || selected.size > MAX_LESSONS_PER_RUN || launching}
            onClick={() => void launch()}
          >
            {launching ? 'Dispatching…' : 'Generate Scripts'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run detail — per-lesson progress, reconciliation, script viewer
// ---------------------------------------------------------------------------

const POLL_MS = 3000

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<VsgRun | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [pollNonce, setPollNonce] = useState(0)

  const refresh = useCallback(async (): Promise<VsgRun['status'] | 'gone'> => {
    try {
      const r = await api.getVsgRun(id)
      setRun(r)
      setError(null)
      if (r.status === 'generating') {
        try {
          setJob(await api.getVsgRunJob(id))
        } catch {
          /* job row can lag creation */
        }
      }
      return r.status
    } catch (e) {
      if (e instanceof NotFoundError) {
        setRun(null)
        setError('This run was deleted.')
        return 'gone'
      }
      setError(errText(e, 'Could not load the run.'))
      return 'generating'
    }
  }, [id])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const status = await refresh()
      if (alive && status === 'generating') timer.current = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer.current)
    }
  }, [refresh, pollNonce])

  const restartPolling = () => {
    setRun((prev) => (prev ? { ...prev, status: 'generating' } : prev))
    setPollNonce((n) => n + 1)
  }

  const [deleteMode, setDeleteMode] = useState(false)
  const [toDelete, setToDelete] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // The 3s poll keeps mutating lesson statuses under an open selection: a
  // checked pending lesson the worker just claimed would become a disabled
  // checkbox that can never be unchecked (and would 409 every delete), and
  // lessons removed by another tab would leave stale ids that skew the
  // whole-run check. Prune the selection to currently-deletable lessons.
  useEffect(() => {
    if (!run) return
    setToDelete((prev) => {
      if (prev.size === 0) return prev
      const selectable = new Set(run.lessons.filter((l) => l.status !== 'generating').map((l) => l.lessonId))
      const next = new Set([...prev].filter((id) => selectable.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [run])

  const toggleDelete = (lessonId: string) =>
    setToDelete((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })

  const deleteSelection = async () => {
    setConfirmOpen(false)
    setDeleting(true)
    setError(null)
    try {
      const { runDeleted } = await api.deleteVsgLessons(id, [...toDelete])
      if (runDeleted) {
        onBack()
        return
      }
      setDeleteMode(false)
      setToDelete(new Set())
      await refresh()
    } catch (e) {
      setError(errText(e, 'Could not delete the selected scripts.'))
    } finally {
      setDeleting(false)
    }
  }

  const [exportingAll, setExportingAll] = useState(false)
  const downloadAll = async (r: VsgRun) => {
    setExportingAll(true)
    setError(null)
    try {
      const ready = [...r.lessons].filter((l) => l.status === 'complete').sort((a, b) => a.lessonOrder - b.lessonOrder)
      // allSettled, not all: a script deleted through another run must not
      // sink the whole export. ONLY a 404 counts as "deleted" — auth and
      // transient failures rethrow so they surface (and 401 re-gates)
      // instead of masquerading as deletions in an incomplete document.
      const settled = await Promise.allSettled(ready.map((l) => api.getVideoScript(r.courseId, l.lessonId)))
      const hardFailure = settled.find(
        (s): s is PromiseRejectedResult => s.status === 'rejected' && !(s.reason instanceof NotFoundError),
      )
      if (hardFailure) throw hardFailure.reason
      const scripts = settled.filter((s): s is PromiseFulfilledResult<VideoScript> => s.status === 'fulfilled').map((s) => s.value)
      if (scripts.length === 0) throw new Error('No stored scripts found for this run — they may have been deleted.')
      const { downloadAllScriptsDocx } = await import('../export/script-docx')
      await downloadAllScriptsDocx(r.courseName, scripts)
      const missing = ready.length - scripts.length
      if (missing > 0) {
        setError(`${missing} script${missing === 1 ? ' was' : 's were'} no longer stored (deleted elsewhere) and ${missing === 1 ? 'was' : 'were'} skipped.`)
      }
    } catch (e) {
      setError(errText(e, 'Could not build the combined document.'))
    } finally {
      setExportingAll(false)
    }
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <Btn onClick={onBack}>← Back to runs</Btn>
        {error ? <ErrorStrip text={error} /> : <p className="mt-6 text-[12.5px] text-ink-3">Loading run…</p>}
      </div>
    )
  }

  const unitGroups: { unitName: string; lessons: VsgRunLesson[] }[] = []
  for (const l of [...run.lessons].sort((a, b) => a.lessonOrder - b.lessonOrder)) {
    const g = unitGroups.find((x) => x.unitName === l.unitName)
    if (g) g.lessons.push(l)
    else unitGroups.push({ unitName: l.unitName, lessons: [l] })
  }
  const done = run.lessons.filter((l) => l.status !== 'pending' && l.status !== 'generating').length
  const deletable = run.lessons.filter((l) => l.status !== 'generating')
  // Membership, not size: stale selection ids (pruned above, but never trust
  // a count) must not make the modal promise a whole-run delete it won't do.
  const wholeRun = run.lessons.length > 0 && run.lessons.every((l) => toDelete.has(l.lessonId))

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-center justify-between gap-3">
        <Btn onClick={onBack}>← Back to runs</Btn>
        <div className="flex items-center gap-2">
          {deleteMode ? (
            <>
              <button
                onClick={() =>
                  setToDelete((prev) =>
                    prev.size === deletable.length ? new Set() : new Set(deletable.map((l) => l.lessonId)),
                  )
                }
                className="cursor-pointer text-[12px] font-medium text-accent-deep hover:underline"
              >
                {toDelete.size === deletable.length && deletable.length > 0 ? 'Clear selection' : 'Select all'}
              </button>
              <Btn
                onClick={() => {
                  setDeleteMode(false)
                  setToDelete(new Set())
                }}
              >
                Cancel
              </Btn>
              <Btn kind="danger" disabled={toDelete.size === 0 || deleting} onClick={() => setConfirmOpen(true)}>
                {deleting ? 'Deleting…' : `Delete Selected (${toDelete.size})`}
              </Btn>
            </>
          ) : (
            <>
              {run.lessons.some((l) => l.status === 'complete') && (
                <Btn kind="primary" disabled={exportingAll} onClick={() => void downloadAll(run)}>
                  {exportingAll ? 'Preparing…' : 'Download All Scripts'}
                </Btn>
              )}
              <Btn onClick={() => setDeleteMode(true)}>Delete…</Btn>
              {runStatusPill(run.status)}
            </>
          )}
        </div>
      </div>
      {deleteMode && (
        <p className="mt-3 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12px] leading-relaxed text-rust">
          Select the scripts to remove from this run, or use "Select all" and Delete Selected to remove the whole
          run. Lessons currently generating can't be selected.
        </p>
      )}
      {error && <ErrorStrip text={error} />}

      <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
        <SectionLabel>Video Scripts</SectionLabel>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{run.courseName}</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
          {run.subject} · Grade {run.grade} · {run.standardSet} · {run.lessons.length} lesson{run.lessons.length === 1 ? '' : 's'} ·{' '}
          {run.playbookVersion} · {run.doctrineVersion}
          {run.steering ? (
            <>
              {' '}· steering: <span className="italic">“{run.steering}”</span>
            </>
          ) : null}
        </p>
        {run.status === 'generating' && (
          <>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700"
                style={{ width: `${run.lessons.length > 0 ? Math.round((done / run.lessons.length) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-3">
              {done} of {run.lessons.length} lessons settled{job ? ` · ${job.stage}` : ''}
            </p>
            {(job?.log ?? []).slice(-4).map((entry, i) => (
              <p key={`${entry.at}-${i}`} className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                <span className="text-ink-2">{when(entry.at)}</span> — {capsStandardCodes(entry.detail)}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="mt-8 space-y-8">
        {unitGroups.map((g) => (
          <div key={g.unitName}>
            <div className="border-b-2 border-ink/70 pb-1.5">
              <h2 className="font-display text-[18px] font-semibold text-ink">{g.unitName}</h2>
            </div>
            <div className="mt-3 space-y-3">
              {g.lessons.map((l) =>
                deleteMode ? (
                  <div key={l.lessonId} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={toDelete.has(l.lessonId)}
                      disabled={l.status === 'generating'}
                      onChange={() => toggleDelete(l.lessonId)}
                      title={l.status === 'generating' ? 'Generating — wait for it to settle' : `Select ${l.lessonTitle}`}
                      className="mt-5 size-4 shrink-0 cursor-pointer accent-rust disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <LessonRow run={run} lesson={l} onChanged={restartPolling} />
                    </div>
                  </div>
                ) : (
                  <LessonRow key={l.lessonId} run={run} lesson={l} onChanged={restartPolling} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={wholeRun ? 'Delete This Run?' : 'Delete Selected Scripts?'}
      >
        <p className="text-[13px] leading-relaxed text-ink-2">
          {wholeRun ? (
            <>
              Every lesson is selected, so this permanently deletes the whole run for{' '}
              <span className="font-semibold text-ink">{run.courseName}</span> and its stored scripts.
            </>
          ) : (
            <>
              This permanently deletes <span className="font-semibold text-ink">{toDelete.size}</span> script
              {toDelete.size === 1 ? '' : 's'} — the lesson{toDelete.size === 1 ? '' : 's'} leave{toDelete.size === 1 ? 's' : ''} this
              run and the stored script document{toDelete.size === 1 ? '' : 's'} {toDelete.size === 1 ? 'is' : 'are'} deleted.
            </>
          )}{' '}
          This cannot be undone — download anything you want to keep first.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmOpen(false)}>Cancel</Btn>
          <Btn kind="danger" onClick={() => void deleteSelection()}>
            Delete
          </Btn>
        </div>
      </Modal>
      <div className="h-16" />
    </div>
  )
}

function LessonRow({ run, lesson, onChanged }: { run: VsgRun; lesson: VsgRunLesson; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [script, setScript] = useState<VideoScript | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadScript = async () => {
    if (script) {
      setOpen((o) => !o)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setScript(await api.getVideoScript(run.courseId, lesson.lessonId))
      setOpen(true)
    } catch (e) {
      setError(errText(e, 'Could not load the script.'))
    } finally {
      setLoading(false)
    }
  }

  const regenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.regenerateVsgLesson(run.id, lesson.lessonId)
      setScript(null)
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(errText(e, 'Could not regenerate.'))
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    setError(null)
    try {
      const s = script ?? (await api.getVideoScript(run.courseId, lesson.lessonId))
      setScript(s)
      const { downloadScriptDocx } = await import('../export/script-docx')
      await downloadScriptDocx(s)
    } catch (e) {
      setError(errText(e, 'Could not build the document.'))
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold text-ink">{lesson.lessonTitle}</span>
          {lessonStatusPill(lesson.status)}
          {lesson.durationEstimate && <span className="text-[11px] text-ink-3">{lesson.durationEstimate}</span>}
        </div>
        <div className="flex items-center gap-2">
          {lesson.status === 'complete' && (
            <>
              <Btn onClick={() => void loadScript()} disabled={loading}>
                {loading ? 'Loading…' : open ? 'Hide Script' : 'View Script'}
              </Btn>
              <Btn onClick={() => void download()}>Download Doc</Btn>
            </>
          )}
          {(lesson.status === 'complete' || lesson.status === 'failed') && (
            <Btn disabled={busy} onClick={() => void regenerate()}>
              {busy ? 'Restarting…' : 'Regenerate'}
            </Btn>
          )}
        </div>
      </div>
      {lesson.status === 'failed' && lesson.error && (
        <p className="mt-2 text-[12px] leading-relaxed text-rust">{lesson.error}</p>
      )}
      {error && <p className="mt-2 text-[12px] leading-relaxed text-rust">{error}</p>}

      {lesson.status === 'needs-reconciliation' && <ReconcilePanel run={run} lesson={lesson} onChanged={onChanged} />}

      {open && script && <ScriptViewer script={script} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reconciliation — flag → propose → reconcile (playbook §2.4)
// ---------------------------------------------------------------------------

function ReconcilePanel({ run, lesson, onChanged }: { run: VsgRun; lesson: VsgRunLesson; onChanged: () => void }) {
  const openConflicts = lesson.conflicts.filter((c) => !c.resolution)
  const [choices, setChoices] = useState<Record<string, { custom: boolean; text: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A chosen-but-empty custom answer must never silently fall back to the
  // default — the submit stays disabled until it's typed or the default is
  // re-selected.
  const incomplete = openConflicts.some((c) => {
    const choice = choices[c.id]
    return choice?.custom === true && choice.text.trim().length === 0
  })

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.reconcileVsgLesson(
        run.id,
        lesson.lessonId,
        openConflicts.map((c) => {
          const choice = choices[c.id]
          return choice?.custom && choice.text.trim().length > 0
            ? { conflictId: c.id, resolution: choice.text.trim(), resolvedBy: 'custom' as const }
            : { conflictId: c.id, resolution: c.proposal, resolvedBy: 'default' as const }
        }),
      )
      onChanged()
    } catch (e) {
      setError(errText(e, 'Could not submit the reconciliation.'))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-ink/25 bg-amber-wash p-4">
      <div className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">
        Inputs Conflict — Reconcile To Continue
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
        Generation never silently resolves a contradiction. Accept each proposed default or enter your own handling;
        the resolution is recorded in the script's header and pre-fills regeneration. A resolution can relax playbook
        defaults but never crosses the card's Assessment Boundary or Non-Goals and never introduces a second strategy.
      </p>
      <div className="mt-3 space-y-4">
        {openConflicts.map((c) => {
          const choice = choices[c.id] ?? { custom: false, text: '' }
          return (
            <div key={c.id} className="rounded-lg border border-hairline bg-panel p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="amber">{c.kind}</Pill>
                <span className="text-[12.5px] font-semibold text-ink">{capsStandardCodes(c.summary)}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-paper/60 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">Side A: </span>
                  {capsStandardCodes(c.sideA)}
                </div>
                <div className="rounded-md bg-paper/60 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">Side B: </span>
                  {capsStandardCodes(c.sideB)}
                </div>
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  checked={!choice.custom}
                  onChange={() => setChoices((p) => ({ ...p, [c.id]: { custom: false, text: choice.text } }))}
                  className="mt-1"
                />
                <span className="text-[12.5px] leading-relaxed text-ink">
                  <span className="font-semibold">Accept the proposed default: </span>
                  {capsStandardCodes(c.proposal)}
                  <span className="block text-[11.5px] text-ink-3">{capsStandardCodes(c.rationale)}</span>
                </span>
              </label>
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  checked={choice.custom}
                  onChange={() => setChoices((p) => ({ ...p, [c.id]: { custom: true, text: choice.text } }))}
                  className="mt-1"
                />
                <span className="w-full text-[12.5px] text-ink">
                  <span className="font-semibold">My own handling:</span>
                  <textarea
                    value={choice.text}
                    onChange={(e) => setChoices((p) => ({ ...p, [c.id]: { custom: true, text: e.target.value } }))}
                    rows={2}
                    placeholder="How should the script handle this?"
                    className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
                  />
                </span>
              </label>
            </div>
          )
        })}
      </div>
      {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-3">
        {incomplete && <span className="text-[11.5px] text-amber-ink">Type your handling (or re-select the default) to continue.</span>}
        <Btn kind="primary" disabled={busy || incomplete} onClick={() => void submit()}>
          {busy ? 'Submitting…' : 'Reconcile & Generate'}
        </Btn>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Script viewer — channel-colored per playbook §3
// ---------------------------------------------------------------------------

function ScriptViewer({ script }: { script: VideoScript }) {
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
        <Pill tone="night">{script.durationEstimate || '—'}</Pill>
        <Pill tone="neutral">{script.interactionCount} interactions</Pill>
        <Pill tone="neutral">grade band {script.gradeBand}</Pill>
        <span>
          {script.playbookVersion} · {script.doctrineVersion}
          {script.langGuideVersion ? ` · ${script.langGuideVersion}` : ''} · v{script.version}
        </span>
      </div>
      {script.formatRefs.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          Stein formats followed: {script.formatRefs.map((f) => capsStandardCodes(f)).join(' · ')}
        </p>
      )}
      {script.qa.hardFails.length > 0 && (
        <div className="mt-3 rounded-lg border border-rust/25 bg-rust-wash px-3 py-2 text-[12px] leading-relaxed text-rust">
          <span className="font-semibold">Unresolved hard QA failures: </span>
          {script.qa.hardFails.join(' · ')}
        </div>
      )}
      {script.qa.flags.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-ink/25 bg-amber-wash px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-amber-ink">Review flags: </span>
          {script.qa.flags.join(' · ')}
        </div>
      )}
      {script.conflictsResolved.length > 0 && (
        <div className="mt-2 rounded-lg border border-hairline bg-paper/60 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">Reconciled conflicts: </span>
          {script.conflictsResolved.map((c: VsgConflict) => `${c.summary} → ${c.resolution} (${c.resolvedBy})`).join(' · ')}
        </div>
      )}
      {script.transferTest && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
          <Pill tone={script.transferTest.stepsDemonstrated && script.transferTest.caseClassesShown && script.transferTest.decisionsPerformed ? 'green' : 'red'}>
            Transfer Test {script.transferTest.stepsDemonstrated && script.transferTest.caseClassesShown && script.transferTest.decisionsPerformed ? 'passes' : 'FAILS'}
          </Pill>
          <span className="text-ink-3">
            steps {script.transferTest.stepsDemonstrated ? '✓' : '✗'} · case classes {script.transferTest.caseClassesShown ? '✓' : '✗'} · student decisions{' '}
            {script.transferTest.decisionsPerformed ? '✓' : '✗'}
            {script.transferTest.note ? ` — ${script.transferTest.note}` : ''}
          </span>
        </div>
      )}
      {(script.coverageNote ?? []).length > 0 && (
        <div className="mt-2 rounded-lg border border-hairline bg-paper/60 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">Coverage note: </span>
          {(script.coverageNote ?? [])
            .map((c) => `${c.name} — ${c.status === 'taught' ? `taught (${c.where})` : `deferred → ${c.where}`}`)
            .join(' · ')}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {script.segments.map((seg, si) => {
          const slideOf = new Map((script.slides ?? []).map((sl) => [sl.number, sl]))
          // The header renders where a slide starts (once per slide-number
          // change within the segment).
          let lastSlide = ''
          return (
            <div key={si}>
              <div className="flex items-baseline gap-2 border-b border-hairline pb-1">
                <span className="font-display text-[14px] font-semibold text-ink">{SEGMENT_LABELS[seg.kind] ?? seg.kind}</span>
                <Mono className="text-[11px] text-ink-3">
                  {seg.start}–{seg.end}
                </Mono>
                <span className="text-[11px] text-ink-3">{seg.purpose}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {seg.lines.map((line, li) => {
                  const slide = line.slide && line.slide !== lastSlide ? slideOf.get(line.slide) : undefined
                  if (line.slide) lastSlide = line.slide
                  return (
                    <Fragment key={li}>
                      {slide && (
                        <div className="mt-3 flex flex-wrap items-baseline gap-2 rounded-lg bg-night px-3 py-1.5 first:mt-0">
                          <Mono className="text-[10px] font-semibold text-white/70">SLIDE {slide.number}</Mono>
                          <span className="text-[12px] font-semibold text-white">{slide.title}</span>
                          <span className="text-[10px] text-white/60">
                            {slide.slideType} · canvas {slide.canvas === 'CONTINUES' ? `continues from ${slide.continuesFrom}` : 'new'}
                          </span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        {line.time && <Mono className="mt-0.5 w-9 shrink-0 text-right text-[10px] text-ink-3">{line.time}</Mono>}
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide ${CHANNEL_STYLE[line.channel].tag}`}>
                          {line.channel}
                        </span>
                        {line.interaction ? (
                          <InteractionBlock label={line.content} interaction={line.interaction} />
                        ) : (
                          <p className={`text-[12.5px] leading-relaxed whitespace-pre-wrap ${CHANNEL_STYLE[line.channel].text}`}>{line.content}</p>
                        )}
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InteractionBlock({ label, interaction }: { label: string; interaction: VsgInteraction }) {
  return (
    <div className="w-full rounded-lg border border-purple-700/25 bg-purple-700/5 px-3 py-2">
      <p className="text-[12px] font-semibold text-purple-800">{label}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink">
        <span className="font-semibold">Prompt: </span>
        {interaction.prompt}
      </p>
      {interaction.options.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {interaction.options.map((opt, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">{String.fromCharCode(65 + i)}.</span> {opt}
            </p>
          ))}
        </div>
      )}
      <p className="mt-1 text-[12px] text-ink-2">
        <span className="font-semibold text-verdant">Answer:</span> {interaction.answer}
      </p>
      <div className="mt-1.5 space-y-0.5 border-t border-purple-700/15 pt-1.5 text-[11.5px] leading-relaxed text-ink-2">
        <p>
          <span className="font-semibold">Correct:</span> {interaction.correctFeedback}
        </p>
        <p>
          <span className="font-semibold">Try 1:</span> {interaction.try1Hint}
        </p>
        {/* Try 2 only exists on scripts generated before rulebook v2.4 (single-retry ladder). */}
        {interaction.try2ShowAndMoveOn && (
          <p>
            <span className="font-semibold">Try 2:</span> {interaction.try2ShowAndMoveOn}
          </p>
        )}
        <p>
          <span className="font-semibold">Resume:</span> {interaction.resumeState}
        </p>
        <p>
          <span className="font-semibold">Show model:</span> {interaction.modelAccess ? 'available' : 'not offered'} — {interaction.modelAccessNote}
        </p>
      </div>
    </div>
  )
}
