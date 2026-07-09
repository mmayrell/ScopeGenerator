import { useCallback, useEffect, useRef, useState } from 'react'
import { NotFoundError, UnauthorizedError, api, clearAccessCode, type JobStatus } from '../api'
import type {
  LsgCourse,
  LsgCourseLesson,
  LsgLessonFields,
  LsgMode,
  LsgOperation,
  LsgOutputLesson,
  LsgRun,
  LsgRunSummary,
  LsgSnapshot,
} from '../types'
import { Btn, capsStandardCodes, Modal, Mono, Pill, SectionLabel } from '../ui'

// Lesson Scope Generation — create course vs partial edit. A standalone tool:
// the course registry is keyed by course NAME, a snapshot shows the current
// course state, and each run plans the target lessons with a per-lesson
// operation (CREATE | UPDATE | DEACTIVATE) that is persisted into the
// registry when generation completes.

const FRAMEWORKS = [
  { key: 'CCSS', label: 'Common Core (CCSS)' },
  { key: 'TEKS', label: 'Texas (TEKS)' },
  { key: 'SOL', label: 'Virginia (SOL)' },
  { key: 'B.E.S.T.', label: 'Florida (B.E.S.T.)' },
]
const GRADES = ['3', '4', '5', '6', '7', '8']

const FIELD_LABELS: [keyof LsgLessonFields, string][] = [
  ['objectives', 'Objectives'],
  ['assessmentBoundary', 'Assessment Boundary'],
  ['difficultyCeiling', 'Difficulty Ceiling'],
  ['prerequisites', 'Prerequisites'],
  ['progressionPlacement', 'Progression Placement'],
  ['newLearning', 'New Learning'],
  ['instructionalApproach', 'Instructional Approach'],
  ['nonGoals', 'Non-Goals'],
  ['assessmentEvidence', 'Assessment Evidence'],
  ['releasedItems', 'Released Items'],
]

/**
 * This standalone page calls the API directly (not through the store), so it
 * must honor the app-wide 401 rule itself: clear the stored code and reload —
 * the boot gate re-opens and re-prompts.
 */
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

const opPill = (op: LsgOperation) =>
  op === 'CREATE' ? <Pill tone="green">CREATE</Pill> : op === 'UPDATE' ? <Pill tone="accent">UPDATE</Pill> : <Pill tone="red">DEACTIVATE</Pill>

const runStatusPill = (status: LsgRun['status']) =>
  status === 'generating' ? <Pill tone="accent">Generating…</Pill> : status === 'complete' ? <Pill tone="green">Complete</Pill> : <Pill tone="red">Failed</Pill>

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

type View = { kind: 'list' } | { kind: 'builder' } | { kind: 'run'; id: string } | { kind: 'course'; id: string }

export default function LessonScopeGen() {
  const [view, setView] = useState<View>({ kind: 'list' })

  return view.kind === 'builder' ? (
    <Builder onLaunched={(id) => setView({ kind: 'run', id })} onBack={() => setView({ kind: 'list' })} />
  ) : view.kind === 'run' ? (
    <RunDetail id={view.id} onBack={() => setView({ kind: 'list' })} />
  ) : view.kind === 'course' ? (
    <CourseDetail id={view.id} onBack={() => setView({ kind: 'list' })} />
  ) : (
    <Overview onNew={() => setView({ kind: 'builder' })} onOpenRun={(id) => setView({ kind: 'run', id })} onOpenCourse={(id) => setView({ kind: 'course', id })} />
  )
}

// ---------------------------------------------------------------------------
// Overview — courses (the registry) and past runs
// ---------------------------------------------------------------------------

function Overview({ onNew, onOpenRun, onOpenCourse }: { onNew: () => void; onOpenRun: (id: string) => void; onOpenCourse: (id: string) => void }) {
  const [runs, setRuns] = useState<LsgRunSummary[] | null>(null)
  const [courses, setCourses] = useState<LsgCourse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'run'; row: LsgRunSummary } | { kind: 'course'; row: LsgCourse } | null>(null)

  const load = useCallback(() => {
    Promise.all([api.listLsgRuns(), api.listLsgCourses()])
      .then(([r, c]) => {
        setRuns(r)
        setCourses(c)
        setError(null)
      })
      .catch((e: unknown) => {
        // Deploy-skew shim: an API without the LSG endpoints yet means "nothing here", not an error.
        if (e instanceof NotFoundError) {
          setRuns([])
          setCourses([])
          setError(null)
          return
        }
        setError(errText(e, 'Could not load lesson scope generation data.'))
      })
  }, [])
  useEffect(load, [load])

  const deleteTarget = confirmDelete
  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Lesson Scope Generation</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
            Create a full course, or update an existing one when only some lessons change. The course name is the key:
            a request against an existing course reads its current state through a snapshot and returns a per-lesson
            plan — CREATE, UPDATE, or DEACTIVATE — that is persisted into the course when generation completes.
          </p>
        </div>
        <Btn kind="primary" onClick={onNew}>New Run</Btn>
      </div>

      {error && <ErrorStrip text={error} />}

      <div className="mt-8">
        <SectionLabel>Courses</SectionLabel>
        <div className="mt-2 space-y-3">
          {(courses ?? []).map((c) => {
            const active = c.lessons.filter((l) => l.status === 'ACTIVE').length
            const inactive = c.lessons.length - active
            return (
              <div key={c.courseId} className="relative">
                <button
                  onClick={() => onOpenCourse(c.courseId)}
                  className="block w-full cursor-pointer rounded-2xl border border-hairline bg-panel p-5 pr-12 text-left shadow-(--shadow-lift) transition-colors hover:border-hairline-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[16px] font-semibold text-ink">{capsStandardCodes(c.courseName)}</span>
                    <Pill tone="neutral">{c.standardSet || c.curriculumFramework}</Pill>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3">
                    {c.subject} · Grade {c.grade} · {active} active lesson{active === 1 ? '' : 's'}
                    {inactive > 0 ? ` · ${inactive} deactivated` : ''} · updated {when(c.updated)}
                  </p>
                </button>
                <button
                  onClick={() => setConfirmDelete({ kind: 'course', row: c })}
                  className="absolute top-5 right-4 flex cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-rust/10 hover:text-rust"
                  title="Delete course"
                >
                  <TrashIcon />
                </button>
              </div>
            )
          })}
          {courses !== null && courses.length === 0 && (
            <div className="rounded-2xl border border-hairline bg-panel p-6 text-[13px] leading-relaxed text-ink-3">
              No courses yet. Run a FULL_COURSE generation and the course lands here, updatable by name from then on.
            </div>
          )}
          {courses === null && !error && <p className="text-[12.5px] text-ink-3">Loading courses…</p>}
        </div>
      </div>

      <div className="mt-10">
        <SectionLabel>Runs</SectionLabel>
        <div className="mt-2 space-y-3">
          {(runs ?? []).map((r) => (
            <div key={r.id} className="relative">
              <button
                onClick={() => onOpenRun(r.id)}
                className="block w-full cursor-pointer rounded-2xl border border-hairline bg-panel p-5 pr-12 text-left shadow-(--shadow-lift) transition-colors hover:border-hairline-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[15px] font-semibold text-ink">{capsStandardCodes(r.courseName)}</span>
                  <Pill tone={r.requestType === 'FULL_COURSE' ? 'night' : 'neutral'}>
                    {r.requestType === 'FULL_COURSE' ? 'Full course' : 'Partial edit'}
                  </Pill>
                  {runStatusPill(r.status)}
                </div>
                <p className="mt-1 text-[12px] text-ink-3">
                  {r.mode === 'FULL_COURSE' ? 'All lessons in scope' : 'Selected lessons only'}
                  {r.lessonCount > 0 ? ` · ${r.lessonCount} lesson operation${r.lessonCount === 1 ? '' : 's'}` : ''} · created {when(r.created)}
                </p>
                {r.status === 'failed' && r.error && <p className="mt-1 text-[11.5px] leading-relaxed text-rust">{r.error}</p>}
              </button>
              <button
                onClick={() => setConfirmDelete({ kind: 'run', row: r })}
                className="absolute top-5 right-4 flex cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-rust/10 hover:text-rust"
                title="Delete run"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          {runs !== null && runs.length === 0 && (
            <div className="rounded-2xl border border-hairline bg-panel p-6 text-[13px] leading-relaxed text-ink-3">
              No runs yet. Start one: name the course, pick full course or a partial edit, and describe the change.
            </div>
          )}
          {runs === null && !error && <p className="text-[12.5px] text-ink-3">Loading runs…</p>}
        </div>
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setConfirmDelete(null)}
        title={deleteTarget?.kind === 'course' ? 'Delete Course?' : 'Delete Run?'}
      >
        <p className="text-[13px] leading-relaxed text-ink-2">
          {deleteTarget?.kind === 'course' ? (
            <>
              This removes <span className="font-semibold text-ink">{capsStandardCodes(deleteTarget.row.courseName)}</span> and all its
              lessons from the registry, for every user. Runs that produced it are kept.
            </>
          ) : (
            <>This removes the run record. Courses it created or updated are untouched.</>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              const target = confirmDelete
              setConfirmDelete(null)
              if (!target) return
              if (target.kind === 'course') {
                setCourses((prev) => (prev ? prev.filter((c) => c.courseId !== target.row.courseId) : prev))
                api.deleteLsgCourse(target.row.courseId).catch(() => load())
              } else {
                setRuns((prev) => (prev ? prev.filter((r) => r.id !== target.row.id) : prev))
                api.deleteLsgRun(target.row.id).catch(() => load())
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

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8V4M5 4l.5 9a1 1 0 001 .95h3a1 1 0 001-.95L11 4M6.7 6.8v4.4M9.3 6.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ---------------------------------------------------------------------------
// Builder — course identity, snapshot lookup, scope, edit instruction
// ---------------------------------------------------------------------------

function Builder({ onLaunched, onBack }: { onLaunched: (id: string) => void; onBack: () => void }) {
  const [subject, setSubject] = useState('Mathematics')
  const [grade, setGrade] = useState('3')
  const [framework, setFramework] = useState('CCSS')
  const [courseName, setCourseName] = useState('')
  const [snapshot, setSnapshot] = useState<LsgSnapshot | null>(null)
  const [checking, setChecking] = useState(false)
  const [mode, setMode] = useState<LsgMode>('FULL_COURSE')
  const [includedLessons, setIncludedLessons] = useState<string[]>([])
  const [editInstruction, setEditInstruction] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The snapshot belongs to one exact course name — invalidate it on edit so
  // a stale "exists" panel can never describe a different course.
  const checkedName = useRef('')
  useEffect(() => {
    if (courseName.trim() !== checkedName.current) {
      setSnapshot(null)
      setMode('FULL_COURSE')
      setIncludedLessons([])
    }
  }, [courseName])

  const check = async () => {
    const name = courseName.trim()
    if (!name) return
    setChecking(true)
    setError(null)
    try {
      const snap = await api.lsgSnapshot(name)
      checkedName.current = name
      setSnapshot(snap)
      setIncludedLessons([])
    } catch (e) {
      setError(
        e instanceof NotFoundError
          ? 'The backend is still rolling out this feature — try again in a couple of minutes.'
          : errText(e, 'Could not look up the course.'),
      )
    } finally {
      setChecking(false)
    }
  }

  const activeLessons = (snapshot?.lessons ?? []).filter((l) => l.status === 'ACTIVE')
  const exists = snapshot?.courseExists === true
  const partial = mode === 'LESSONS'
  const canLaunch =
    courseName.trim().length > 0 &&
    snapshot !== null &&
    (!partial || includedLessons.length > 0) &&
    (!partial || editInstruction.trim().length > 0)

  const launch = async () => {
    if (!canLaunch || launching) return
    setLaunching(true)
    setError(null)
    try {
      const { run } = await api.createLsgRun({
        requestType: partial ? 'PARTIAL_UPDATE' : 'FULL_COURSE',
        courseContext: { subject: subject.trim() || 'Mathematics', grade, curriculumFramework: framework, courseName: courseName.trim() },
        generationScope: { mode, includedLessons: partial ? includedLessons : [], editInstruction: editInstruction.trim() },
      })
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

  const toggleLesson = (title: string) =>
    setIncludedLessons((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]))

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
      <h1 className="mt-4 font-display text-[28px] font-semibold tracking-tight text-ink">New Lesson Scope Run</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Name the course and look it up. A name that doesn't exist creates a new course; a name that does updates it in
        place — in full, or for selected lessons only.
      </p>

      {error && <ErrorStrip text={error} />}

      <div className="mt-8 space-y-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <SectionLabel>Subject</SectionLabel>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
          </div>
          <div>
            <SectionLabel>Curriculum Framework</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FRAMEWORKS.map((fw) => (
                <Chip key={fw.key} on={framework === fw.key} title={fw.label} onClick={() => setFramework(fw.key)}>
                  {fw.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>Grade</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GRADES.map((g) => (
              <Chip key={g} on={grade === g} onClick={() => setGrade(g)}>
                Grade {g}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Course Name</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            The primary key: the same name always updates the same course; a new name creates a new one.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder='e.g. "Grade 3 Mathematics NHITL"'
              className="w-full max-w-md rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
            <Btn disabled={!courseName.trim() || checking} onClick={() => void check()}>
              {checking ? 'Looking up…' : 'Look Up Course'}
            </Btn>
          </div>
          {snapshot !== null && (
            <div className={`animate-rise mt-3 rounded-xl border px-4 py-3 ${exists ? 'border-accent/25 bg-accent-wash' : 'border-verdant/25 bg-verdant-wash'}`}>
              {exists ? (
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  <Pill tone="accent">UPDATE</Pill>{' '}
                  <span className="ml-1 font-semibold text-ink">{capsStandardCodes(snapshot.course?.courseName ?? '')}</span> exists —{' '}
                  {activeLessons.length} active lesson{activeLessons.length === 1 ? '' : 's'}. This run updates it in place; there are no
                  course versions.
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  <Pill tone="green">CREATE</Pill> <span className="ml-1">No course with this name — the run creates it.</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Generation Scope</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip on={mode === 'FULL_COURSE'} onClick={() => setMode('FULL_COURSE')}>
              Full course
            </Chip>
            <Chip
              on={mode === 'LESSONS'}
              disabled={!exists}
              title={exists ? undefined : 'A partial edit needs an existing course — look one up first'}
              onClick={() => setMode('LESSONS')}
            >
              Selected lessons only
            </Chip>
          </div>
          {mode === 'FULL_COURSE' && exists && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              A full-course run against an existing course rebuilds the whole plan: matching lessons are updated, new
              lessons created, and existing lessons missing from the new plan deactivated.
            </p>
          )}
          {partial && (
            <div className="mt-3">
              <p className="text-[11.5px] text-ink-3">
                {includedLessons.length === 0 ? 'Pick the lessons this edit touches. ' : `${includedLessons.length} selected. `}
                Every other lesson stays untouched.
              </p>
              <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-hairline bg-panel/50 p-3">
                {activeLessons.map((l) => (
                  <Chip key={l.lessonId} on={includedLessons.includes(l.lessonTitle)} title={`${l.unitName} · ${capsStandardCodes(l.standardId)}`} onClick={() => toggleLesson(l.lessonTitle)}>
                    {l.lessonTitle}
                  </Chip>
                ))}
                {activeLessons.length === 0 && <p className="text-[12.5px] text-ink-3">This course has no active lessons.</p>}
              </div>
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Edit Instruction</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {partial
              ? 'Required — what should change on the selected lessons, e.g. "Tighten the assessment boundary to exclude estimating sums and differences."'
              : 'Optional — steering for the full-course plan, e.g. "Regenerate against current standards and pedagogy."'}
          </p>
          <textarea
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
        </div>

        <div className="flex items-center justify-between border-t border-hairline pt-5">
          <span className="text-[12.5px] text-ink-2">
            {snapshot === null
              ? 'Look up the course name to continue.'
              : exists
                ? partial
                  ? `Partial edit of ${includedLessons.length || 'no'} lesson${includedLessons.length === 1 ? '' : 's'}`
                  : 'Full-course update in place'
                : 'Full-course creation'}
          </span>
          <Btn kind="primary" disabled={!canLaunch || launching} onClick={() => void launch()}>
            {launching ? 'Dispatching…' : 'Generate Lesson Scope'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run detail — progress while generating, then the operations plan
// ---------------------------------------------------------------------------

const POLL_MS = 3000

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<LsgRun | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const lastStatus = useRef<LsgRun['status'] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await api.getLsgRun(id)
      setRun(r)
      setError(null)
      lastStatus.current = r.status
      if (r.status === 'generating') {
        try {
          setJob(await api.getLsgRunJob(id))
        } catch {
          /* job row can lag run creation — the run status carries the view */
        }
      }
      return r.status
    } catch (e) {
      if (e instanceof NotFoundError) {
        setRun(null)
        setError('This run was deleted.')
        lastStatus.current = null
        return 'failed' as const
      }
      setError(errText(e, 'Could not load the run.'))
      return lastStatus.current === 'generating' ? ('generating' as const) : ('failed' as const)
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
  }, [refresh])

  if (!run) {
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
        {error ? <ErrorStrip text={error} /> : <p className="mt-6 text-[12.5px] text-ink-3">Loading run…</p>}
      </div>
    )
  }

  const scopeLine = `${run.requestType === 'FULL_COURSE' ? 'Full course' : 'Partial edit'} · ${
    run.generationScope.mode === 'FULL_COURSE' ? 'all lessons in scope' : `${run.generationScope.includedLessons.length} lesson${run.generationScope.includedLessons.length === 1 ? '' : 's'} in scope`
  } · ${run.courseContext.subject}, Grade ${run.courseContext.grade}, ${run.courseContext.curriculumFramework}`

  // ---------- generating phase ----------
  if (run.status === 'generating') {
    const total = job?.totalStages ?? 3
    const done = job?.stagesDone ?? 0
    const logTail = (job?.log ?? []).slice(-5)
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
        {error && <ErrorStrip text={error} />}
        <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
          <SectionLabel>Lesson Scope Generation</SectionLabel>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(run.courseContext.courseName)}</h1>
          <div className="mt-4 flex items-center gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <span className="text-[13.5px] font-medium text-ink">Building the target lesson plan and scope fields</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
            {scopeLine}. You can leave this page and come back — the run continues on the server.
          </p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
            <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {job
              ? `${job.stage}${job.totalUnits ? ` · ${job.unitsDone ?? 0} of ${job.totalUnits} field batches` : ''}`
              : 'Starting up…'}
          </p>
          {logTail.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-hairline pt-3">
              {logTail.map((entry, i) => (
                <p key={`${entry.at}-${i}`} className="text-[11.5px] leading-relaxed text-ink-3">
                  <span className="text-ink-2">{when(entry.at)}</span> — {capsStandardCodes(entry.detail)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- settled run ----------
  const output = run.output
  const counts = { CREATE: 0, UPDATE: 0, DEACTIVATE: 0 }
  for (const l of output?.lessons ?? []) counts[l.operation]++
  const units: { name: string; lessons: LsgOutputLesson[] }[] = []
  for (const l of output?.lessons ?? []) {
    const u = units.find((x) => x.name === l.unitName)
    if (u) u.lessons.push(l)
    else units.push({ name: l.unitName, lessons: [l] })
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-center justify-between gap-3">
        <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
        {output && (
          <span className="text-[12px] text-ink-3">
            {counts.CREATE} create · {counts.UPDATE} update · {counts.DEACTIVATE} deactivate
          </span>
        )}
      </div>
      {error && <ErrorStrip text={error} />}
      {run.status === 'failed' && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
          The run failed: {run.error ?? 'unknown error'}. Start a new run with the same course name to try again.
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
        <SectionLabel>Lesson Scope Generation</SectionLabel>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(run.courseContext.courseName)}</h1>
          {output && (output.courseOperation === 'CREATE' ? <Pill tone="green">Course CREATE</Pill> : <Pill tone="accent">Course UPDATE</Pill>)}
          {run.applied && <Pill tone="night">Persisted</Pill>}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{scopeLine}.</p>
        {run.generationScope.editInstruction && (
          <p className="mt-2 border-l-2 border-hairline-2 pl-2.5 font-display text-[13px] leading-relaxed text-ink-2 italic">
            “{run.generationScope.editInstruction}”
          </p>
        )}
        {output && (
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            {output.targetCourse.standardSet} · {run.applied ? 'Course and lesson scope entities persisted to the registry.' : 'Output not yet persisted.'}
          </p>
        )}
      </div>

      {output &&
        units.map((u) => (
          <div key={u.name} className="mt-8">
            <div className="flex items-baseline justify-between border-b-2 border-ink/70 pb-1.5">
              <h2 className="font-display text-[19px] font-semibold text-ink">{u.name}</h2>
              <span className="text-[11.5px] text-ink-3">{u.lessons.length} lesson{u.lessons.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 space-y-3">
              {u.lessons.map((l, i) => (
                <OutputLessonCard key={`${l.lessonTitle}-${i}`} lesson={l} />
              ))}
            </div>
          </div>
        ))}
      <div className="h-16" />
    </div>
  )
}

function OutputLessonCard({ lesson }: { lesson: LsgOutputLesson }) {
  const [open, setOpen] = useState(false)
  const deactivated = lesson.operation === 'DEACTIVATE'
  return (
    <div className="rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
      <button onClick={() => setOpen((v) => !v)} className="block w-full cursor-pointer p-4 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-[11px] text-ink-3">{String(lesson.lessonOrder).padStart(2, '0')}</Mono>
          <span className={`font-display text-[14.5px] font-semibold ${deactivated ? 'text-ink-3 line-through' : 'text-ink'}`}>
            {lesson.lessonTitle}
          </span>
          {opPill(lesson.operation)}
          <Mono className="ml-auto text-[11px] text-ink-3">{capsStandardCodes(lesson.standardId)}</Mono>
        </div>
        {deactivated && lesson.deactivationReason && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{lesson.deactivationReason}</p>
        )}
        {lesson.lessonId && <p className="mt-1 font-mono text-[10px] text-ink-3">lessonId: {lesson.lessonId}</p>}
      </button>
      {open && !deactivated && (
        <div className="space-y-3 border-t border-hairline px-4 py-3.5">
          {FIELD_LABELS.map(([key, label]) => {
            const value = lesson[key]
            if (!value.trim()) return null
            return (
              <div key={key}>
                <div className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{label}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{capsStandardCodes(value)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Course detail — the registry's current state
// ---------------------------------------------------------------------------

function CourseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [course, setCourse] = useState<LsgCourse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getLsgCourse(id)
      .then((c) => {
        if (alive) setCourse(c)
      })
      .catch((e: unknown) => {
        if (alive) setError(errText(e, 'Could not load the course.'))
      })
    return () => {
      alive = false
    }
  }, [id])

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
        {error ? <ErrorStrip text={error} /> : <p className="mt-6 text-[12.5px] text-ink-3">Loading course…</p>}
      </div>
    )
  }

  const units: { name: string; lessons: LsgCourseLesson[] }[] = []
  for (const l of course.lessons) {
    const u = units.find((x) => x.name === l.unitName)
    if (u) u.lessons.push(l)
    else units.push({ name: l.unitName, lessons: [l] })
  }
  const active = course.lessons.filter((l) => l.status === 'ACTIVE').length

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <Btn onClick={onBack}>← Back to lesson scope generation</Btn>
      {error && <ErrorStrip text={error} />}
      <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
        <SectionLabel>Course</SectionLabel>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(course.courseName)}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {course.subject} · Grade {course.grade} · {course.standardSet || course.curriculumFramework} · {active} active lesson
          {active === 1 ? '' : 's'}
          {course.lessons.length - active > 0 ? ` · ${course.lessons.length - active} deactivated` : ''} · updated {when(course.updated)}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Updated in place by runs against this exact course name — there are no course versions.
        </p>
      </div>

      {units.map((u) => (
        <div key={u.name} className="mt-8">
          <div className="flex items-baseline justify-between border-b-2 border-ink/70 pb-1.5">
            <h2 className="font-display text-[19px] font-semibold text-ink">{u.name}</h2>
            <span className="text-[11.5px] text-ink-3">{u.lessons.length} lesson{u.lessons.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-3 space-y-3">
            {u.lessons.map((l) => (
              <CourseLessonCard key={l.lessonId} lesson={l} />
            ))}
          </div>
        </div>
      ))}
      <div className="h-16" />
    </div>
  )
}

function CourseLessonCard({ lesson }: { lesson: LsgCourseLesson }) {
  const [open, setOpen] = useState(false)
  const inactive = lesson.status === 'INACTIVE'
  return (
    <div className={`rounded-xl border border-hairline bg-panel shadow-(--shadow-lift) ${inactive ? 'opacity-60' : ''}`}>
      <button onClick={() => setOpen((v) => !v)} className="block w-full cursor-pointer p-4 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-[11px] text-ink-3">{String(lesson.lessonOrder).padStart(2, '0')}</Mono>
          <span className={`font-display text-[14.5px] font-semibold ${inactive ? 'text-ink-3 line-through' : 'text-ink'}`}>
            {lesson.lessonTitle}
          </span>
          {inactive ? <Pill tone="red">Inactive</Pill> : <Pill tone="green">Active</Pill>}
          <Mono className="ml-auto text-[11px] text-ink-3">{capsStandardCodes(lesson.standardId)}</Mono>
        </div>
        <p className="mt-1 font-mono text-[10px] text-ink-3">lessonId: {lesson.lessonId}</p>
      </button>
      {open && (
        <div className="space-y-3 border-t border-hairline px-4 py-3.5">
          {FIELD_LABELS.map(([key, label]) => {
            const value = lesson[key]
            if (!value.trim()) return null
            return (
              <div key={key}>
                <div className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{label}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{capsStandardCodes(value)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
