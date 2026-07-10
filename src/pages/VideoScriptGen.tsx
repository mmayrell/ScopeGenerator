import { useCallback, useEffect, useRef, useState } from 'react'
import { NotFoundError, UnauthorizedError, api, clearAccessCode, type JobStatus } from '../api'
import { useStore } from '../store'
import type {
  LsgCourse,
  Scope,
  VideoScript,
  VsgChannel,
  VsgConflict,
  VsgCourseRow,
  VsgInteraction,
  VsgRun,
  VsgRunLesson,
  VsgRunSummary,
} from '../types'
import { Btn, capsStandardCodes, Modal, Mono, Pill, SectionLabel } from '../ui'

// Video Script Generator — turns generated lesson cards into production-ready
// scripts for ~3-minute DI math videos with checked student interactions.
// Pick a course from the registry, multi-select lessons (grouped by unit),
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
  title: 'Title',
  intro: 'Intro',
  'i-do': 'I Do',
  'we-do': 'We Do',
  wrap: 'Wrap',
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
            Turn generated lesson cards into production-ready scripts for ~3-minute Direct Instruction videos with
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
          This removes the run record for <span className="font-semibold text-ink">{confirmDelete?.courseName}</span>.
          Scripts already written stay stored per lesson and remain reachable from newer runs.
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
// Builder — pick a course, multi-select lessons grouped by unit, generate
// ---------------------------------------------------------------------------

function Builder({ onLaunched, onBack }: { onLaunched: (id: string) => void; onBack: () => void }) {
  const { scopes } = useStore()
  const [courses, setCourses] = useState<VsgCourseRow[] | null>(null)
  const [courseId, setCourseId] = useState<string>('')
  // Bumped when an import refreshes the ALREADY-selected course — same id,
  // new content, so the id alone can't retrigger the load effect.
  const [courseNonce, setCourseNonce] = useState(0)
  const [course, setCourse] = useState<LsgCourse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [steering, setSteering] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCourses = useCallback(() => {
    api
      .listVsgCourses()
      .then(setCourses)
      .catch((e: unknown) => {
        if (e instanceof NotFoundError) {
          setCourses([])
          return
        }
        setError(errText(e, 'Could not load the course registry.'))
      })
  }, [])
  useEffect(loadCourses, [loadCourses])

  useEffect(() => {
    if (!courseId) return
    let stale = false // course A's slow response must not land under course B's selection
    setCourse(null)
    setSelected(new Set())
    api
      .getLsgCourse(courseId)
      .then((c) => {
        if (!stale) setCourse(c)
      })
      .catch((e: unknown) => {
        if (!stale) setError(errText(e, 'Could not load the course.'))
      })
    return () => {
      stale = true
    }
  }, [courseId, courseNonce])

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
    setLaunching(true)
    setError(null)
    try {
      const { run } = await api.createVsgRun({ courseId, lessonIds: [...selected], steering })
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
        Pick a generated course, select the lessons to script, and generate. Each selected lesson becomes one
        production-ready video script: lesson card + Stein's teaching formats + the playbook.
      </p>

      {error && <ErrorStrip text={error} />}

      <div className="mt-8 space-y-7">
        <div>
          <SectionLabel>Step 1 — Course</SectionLabel>
          <div className="mt-2 space-y-2">
            {(courses ?? []).map((c) => (
              <button
                key={c.courseId}
                onClick={() => setCourseId(c.courseId)}
                className={`block w-full cursor-pointer rounded-xl border p-4 text-left transition-colors ${
                  courseId === c.courseId ? 'border-accent/40 bg-accent-wash' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-ink">{c.courseName}</span>
                  <span className="text-[11.5px] text-ink-3">
                    {c.subject} · Grade {c.grade} · {c.standardSet} · {c.activeLessonCount} active lesson{c.activeLessonCount === 1 ? '' : 's'}
                  </span>
                </div>
              </button>
            ))}
            {courses !== null && courses.length === 0 && (
              <p className="rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
                The course registry is empty — import a published scope below, or generate a course in Lesson Scope
                Edits.
              </p>
            )}
            {courses === null && <p className="text-[12.5px] text-ink-3">Loading courses…</p>}
          </div>
          <ImportScopePanel
            scopes={scopes}
            onImported={(id) => {
              loadCourses()
              setCourseId(id)
              setCourseNonce((n) => n + 1) // same-id refresh must reload Step 2
            }}
          />
        </div>

        {courseId && (
          <div>
            <SectionLabel>Step 2 — Lessons</SectionLabel>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {selected.size === 0 ? 'Select the lessons to script.' : `${selected.size} selected.`}
            </p>
            {!course && <p className="mt-2 text-[12.5px] text-ink-3">Loading lessons…</p>}
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

        {courseId && (
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

/**
 * Course missing, or its lesson count stale against a newer scope? The
 * registry only updates through LSG runs — this panel imports a published
 * scope's lessons MECHANICALLY (no generation, instant): matched lessons keep
 * their ids and take the scope's content, absentees deactivate.
 */
function ImportScopePanel({ scopes, onImported }: { scopes: Scope[]; onImported: (courseId: string) => void }) {
  const published = scopes.filter((s) => s.status === 'complete')
  const [scopeId, setScopeId] = useState('')
  const [name, setName] = useState('')
  // The prefill follows the picked scope until the user types a name of
  // their own — switching chips must never leave scope A's title silently
  // targeting an import of scope B (an existing name is an in-place update).
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (published.length === 0) return null

  const pick = (id: string) => {
    setScopeId(id)
    const sc = published.find((s) => s.id === id)
    if (sc && !nameTouched) setName(sc.title)
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const { course } = await api.importScopeCourse(scopeId, name.trim())
      setScopeId('')
      setName('')
      setNameTouched(false)
      onImported(course.courseId)
    } catch (e) {
      setError(
        e instanceof NotFoundError
          ? 'The backend is still rolling out this feature — try again in a couple of minutes.'
          : errText(e, 'Could not import the scope.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-panel/50 p-4">
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        Course missing, or showing fewer lessons than its latest scope? Import a published scope — the course takes
        the scope's lessons instantly (no generation). Importing under an existing course name refreshes that course
        in place.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {published.map((s) => (
          <Chip key={s.id} on={scopeId === s.id} onClick={() => pick(s.id)}>
            {s.title} · {s.units.reduce((n, u) => n + u.lessons.length, 0)} lessons
          </Chip>
        ))}
      </div>
      {scopeId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameTouched(true)
            }}
            placeholder="Course name (existing name updates that course)"
            className="w-full max-w-md rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
          <Btn kind="primary" disabled={busy || !name.trim()} onClick={() => void run()}>
            {busy ? 'Importing…' : 'Import as Course'}
          </Btn>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
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

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-center justify-between gap-3">
        <Btn onClick={onBack}>← Back to runs</Btn>
        {runStatusPill(run.status)}
      </div>
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
              {g.lessons.map((l) => (
                <LessonRow key={l.lessonId} run={run} lesson={l} onChanged={restartPolling} />
              ))}
            </div>
          </div>
        ))}
      </div>
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
          {lesson.scriptVersion !== undefined && <span className="text-[11px] text-ink-3">v{lesson.scriptVersion}</span>}
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
          {script.playbookVersion} · {script.doctrineVersion} · v{script.version}
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

      <div className="mt-4 space-y-5">
        {script.segments.map((seg, si) => (
          <div key={si}>
            <div className="flex items-baseline gap-2 border-b border-hairline pb-1">
              <span className="font-display text-[14px] font-semibold text-ink">{SEGMENT_LABELS[seg.kind] ?? seg.kind}</span>
              <Mono className="text-[11px] text-ink-3">
                {seg.start}–{seg.end}
              </Mono>
              <span className="text-[11px] text-ink-3">{seg.purpose}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {seg.lines.map((line, li) => (
                <div key={li} className="flex items-start gap-2">
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
              ))}
            </div>
          </div>
        ))}
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
        <p>
          <span className="font-semibold">Try 2:</span> {interaction.try2ShowAndMoveOn}
        </p>
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
