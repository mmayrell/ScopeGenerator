import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { systemArtifacts } from '../data/meta'
import { useStore, type JobStatus } from '../store'
import { Btn, Mono, Pill, Progress, SectionLabel } from '../ui'
import type { PacketSummary, StandardNode } from '../types'

const stages = [
  { n: 2, name: 'Scope Resolution', detail: 'Determining exactly what each standard teaches by resolving scope, organizing evidence, and mapping assessment items to instructional components.' },
  { n: 3, name: 'Atomization', detail: 'Breaking each standard into the smallest teachable lessons by identifying prerequisite skills, lesson boundaries, and instructional splits.' },
  { n: 4, name: 'Sequencing & Unit Formation', detail: 'Organizing lessons into a research-based instructional sequence that builds prerequisite knowledge and groups lessons into coherent units.' },
  { n: 5, name: 'Card Generation', detail: 'Filling the fixed 14-field schema, evidence-locked — {content, citations[]} per field; assembling Decision records; generating ceiling exemplars for inferred atoms…' },
  { n: 6, name: 'Auto-QC', detail: 'Coverage matrix, prerequisite chains, atom-triple format, single-strategy check, neighbor consistency, ceiling legality, theme coverage, released-items integrity…' },
]

// Map the job's human-readable stage label (e.g. "Stage 3–4 — Atomization & sequencing")
// onto the static stage list: [lo, hi] of the active spec-stage numbers.
function activeStageRange(job: JobStatus | null): [number, number] {
  if (!job) return [stages[0].n, stages[0].n]
  const m = /stages?\s*(\d+)\s*(?:[-–—]\s*(\d+))?/i.exec(job.stage)
  if (m) {
    const lo = Number(m[1])
    const hi = m[2] ? Number(m[2]) : lo
    return [lo, hi]
  }
  // No stage number in the label — fall back to fractional progress across the list.
  const frac = job.totalStages > 0 ? job.stagesDone / job.totalStages : 0
  const idx = Math.min(stages.length - 1, Math.floor(frac * stages.length))
  return [stages[idx].n, stages[idx].n]
}

function jobPct(job: JobStatus | null): number {
  if (!job || job.totalStages <= 0) return 3
  const unitFrac = job.totalUnits ? Math.min(1, (job.unitsDone ?? 0) / job.totalUnits) : 0
  const done = Math.min(job.totalStages, job.stagesDone + (job.status === 'complete' ? 0 : unitFrac))
  return Math.max(3, Math.min(100, (done / job.totalStages) * 100))
}

function flattenStandards(nodes: StandardNode[], out: { code: string; wording: string }[] = []) {
  for (const n of nodes) {
    // Canonical code, not the normalized join code — codes are written with capitals.
    if (n.wording) out.push({ code: n.code, wording: n.wording })
    if (n.children) flattenStandards(n.children, out)
  }
  return out
}

/** Standard codes are written with capital letters ("4.oa.a.1" → "4.OA.A.1"); free text passes through. */
function normalizeCodeText(text: string): string {
  return /^[a-z0-9]+([.\-–][a-z0-9]+)+$/i.test(text.trim()) ? text.trim().toUpperCase() : text
}

export default function NewScope() {
  const { sets, createScope, fetchJob, refreshScope } = useStore()
  const nav = useNavigate()
  const published = sets.filter((s) => s.published)
  const [setIds, setSetIds] = useState<string[]>(published[0] ? [published[0].id] : [])
  const [mode, setMode] = useState<'course' | 'standard' | 'topic'>('course')
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  // Released-question PDFs the user attaches to a topic request (optional).
  const [topicFiles, setTopicFiles] = useState<File[]>([])
  const topicFileInput = useRef<HTMLInputElement>(null)
  // One token per page visit: a failed launch retried re-uploads OVER the same
  // blobs instead of minting a new token per attempt (which orphaned the old
  // ones — nothing references a token until createScope succeeds).
  const uploadsToken = useRef<string>(crypto.randomUUID())
  const [topicMapped, setTopicMapped] = useState(false)
  // Optional released-items source: a settled evidence packet whose hunted
  // items (with captured screenshots) join the scope's item bank.
  const [packets, setPackets] = useState<PacketSummary[]>([])
  const [packetId, setPacketId] = useState<string>('')
  const [running, setRunning] = useState<string | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [genAction, setGenAction] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const navTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Selection order (matches the backend's requestedIds order for titles/params).
  const selectedSets = useMemo(
    () => setIds.map((id) => published.find((s) => s.id === id)).filter((s): s is (typeof published)[number] => !!s),
    [published, setIds],
  )
  // Union of every selected set's standards, deduped by canonical code.
  const standards = useMemo(() => {
    const seen = new Set<string>()
    const out: { code: string; wording: string }[] = []
    for (const st of selectedSets) {
      for (const entry of flattenStandards(st.tree)) {
        if (seen.has(entry.code)) continue
        seen.add(entry.code)
        out.push(entry)
      }
    }
    return out
  }, [selectedSets])

  const toggleSet = (id: string) =>
    setSetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Deselecting a set removes its codes from the visible list — prune them from
  // the selection too, or they would invisibly gate and submit.
  useEffect(() => {
    setSelectedCodes((prev) => {
      const visible = new Set(standards.map((st) => st.code))
      const pruned = prev.filter((c) => visible.has(c))
      return pruned.length === prev.length ? prev : pruned
    })
  }, [standards])
  const toggleCode = (code: string) =>
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))

  useEffect(() => () => clearTimeout(navTimer.current), [])

  // Settled repositories with items are eligible released-items sources.
  useEffect(() => {
    let cancelled = false
    void api
      .listPackets()
      .then((rows) => {
        if (!cancelled) setPackets(rows.filter((p) => p.status !== 'hunting' && p.itemCount > 0))
      })
      .catch(() => {
        /* the picker simply stays empty — packets are optional */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Poll the generation job every 2s while a run is active.
  useEffect(() => {
    if (!running || failure) return
    let cancelled = false
    let done = false
    const tick = async () => {
      if (done) return
      try {
        const j = await fetchJob(running)
        if (cancelled || done) return
        setJob(j)
        if (j.status === 'complete') {
          done = true
          clearInterval(t)
          await refreshScope(running)
          if (!cancelled) navTimer.current = setTimeout(() => nav(`/scopes/${running}`), 600)
        } else if (j.status === 'failed') {
          done = true
          clearInterval(t)
          setFailure(j.error ?? 'Generation failed.')
          void refreshScope(running) // the scope stays visible, marked failed
        }
        // 'cancelled' = paused: keep polling — resume flips the job back to queued.
      } catch {
        // transient poll failure — keep polling; a 401 re-opens the access gate via the store
      }
    }
    const t = setInterval(() => void tick(), 2000)
    void tick()
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [running, failure, fetchJob, refreshScope, nav])

  const run = async () => {
    const gradeSpans = [...new Set(selectedSets.map((s) => s.gradeSpan).filter(Boolean))].join(' + ')
    const params =
      mode === 'course'
        ? `${gradeSpans} (all published domains)`
        : mode === 'standard'
          ? selectedCodes.map(normalizeCodeText).join(', ')
          : normalizeCodeText(topic)
    setLaunching(true)
    setLaunchError(null)
    try {
      // Topic requests may carry released-question PDFs to model from: upload
      // them BEFORE creating the scope (generation starts on create).
      let uploads: { token: string; names: string[] } | undefined
      if (mode === 'topic' && topicFiles.length > 0) {
        const token = uploadsToken.current
        await Promise.all(topicFiles.map((f) => api.uploadScopePdf(token, f.name, f)))
        uploads = { token, names: topicFiles.map((f) => f.name) }
      }
      const id = await createScope(setIds, mode, params, uploads, packetId || undefined)
      setJob(null)
      setFailure(null)
      setRunning(id)
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Could not start the generation job.')
    } finally {
      setLaunching(false)
    }
  }

  const genControl = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!running) return
    setGenAction(action)
    try {
      if (action === 'pause') await api.pauseGeneration(running)
      else if (action === 'resume') await api.resumeGeneration(running)
      else {
        await api.cancelGeneration(running)
        await refreshScope(running)
        nav('/')
        return
      }
      setJob(await fetchJob(running))
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Could not update the generation job.')
    } finally {
      setGenAction(null)
    }
  }

  if (running) {
    const [lo, hi] = activeStageRange(job)
    const complete = job?.status === 'complete'
    const paused = job?.status === 'cancelled'
    return (
      <div className="mx-auto max-w-2xl px-10 py-16">
        <SectionLabel>Generating scope</SectionLabel>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">
          {mode === 'course' ? 'Full Course' : mode === 'standard' ? selectedCodes.map(normalizeCodeText).join(', ') : normalizeCodeText(topic)}
        </h1>
        <p className="mt-1 text-[13px] text-ink-2">
          {selectedSets.map((s) => s.name).join(' + ')} · {systemArtifacts.map((a) => `${a.kind === 'engine' ? 'Engine' : 'DI BrainLift'} ${a.version}`).join(' · ')}
        </p>
        <div className="mt-8 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Progress pct={complete ? 100 : jobPct(job)} />
          </div>
          <Mono className="shrink-0 text-[12.5px] font-semibold text-ink-2">
            {Math.round(complete ? 100 : jobPct(job))}%
          </Mono>
          {!complete && !failure && (
            paused ? (
              <>
                <Btn kind="primary" disabled={genAction !== null} onClick={() => void genControl('resume')} className="shrink-0">
                  {genAction === 'resume' ? 'Resuming…' : 'Resume'}
                </Btn>
                <Btn kind="danger" disabled={genAction !== null} onClick={() => void genControl('cancel')} className="shrink-0">
                  {genAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
                </Btn>
              </>
            ) : (
              <>
                <Btn disabled={genAction !== null} onClick={() => void genControl('pause')} className="shrink-0">
                  {genAction === 'pause' ? 'Pausing…' : 'Pause'}
                </Btn>
                <Btn kind="danger" disabled={genAction !== null} onClick={() => void genControl('cancel')} className="shrink-0">
                  {genAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
                </Btn>
              </>
            )
          )}
        </div>
        {paused && (
          <div className="animate-rise mt-3 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-amber-ink">
            <span className="font-mono text-[10px] font-semibold uppercase">paused</span> — progress is
            checkpointed; resume continues exactly where the run left off.
          </div>
        )}
        {job && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
            <Mono className="text-ink-2">{job.stage}</Mono>
            {job.status === 'queued' && <Pill tone="neutral">queued</Pill>}
            {typeof job.totalUnits === 'number' && job.totalUnits > 0 && (
              <Pill tone="accent">
                units {job.unitsDone ?? 0} / {job.totalUnits}
              </Pill>
            )}
          </div>
        )}
        <div className="mt-6 space-y-2.5">
          {stages.map((s) => {
            const state = failure
              ? s.n < lo
                ? 'done'
                : s.n <= hi
                  ? 'failed'
                  : 'pending'
              : complete || s.n < lo
                ? 'done'
                : s.n <= hi
                  ? 'active'
                  : 'pending'
            return (
              <div
                key={s.n}
                className={`flex items-start gap-3.5 rounded-xl border p-4 transition-all ${
                  state === 'done'
                    ? 'border-hairline bg-panel opacity-70'
                    : state === 'active'
                      ? 'animate-rise border-accent/25 bg-accent-wash/40 shadow-(--shadow-lift)'
                      : state === 'failed'
                        ? 'border-rust/25 bg-rust-wash/40'
                        : 'border-hairline bg-panel opacity-40'
                }`}
              >
                <span
                  className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                    state === 'done'
                      ? 'bg-verdant-wash text-verdant'
                      : state === 'active'
                        ? 'stage-pulse bg-accent text-white'
                        : state === 'failed'
                          ? 'bg-rust text-white'
                          : 'bg-ink/5 text-ink-3'
                  }`}
                >
                  {state === 'done' ? '✓' : state === 'failed' ? '✕' : s.n}
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">Stage {s.n} — {s.name}</div>
                  {state === 'active' && (
                    <>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s.detail}</p>
                      {typeof job?.totalUnits === 'number' && job.totalUnits > 0 && (
                        <p className="mt-1 font-mono text-[11px] text-ink-3">
                          units completed: {job.unitsDone ?? 0} / {job.totalUnits}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {failure && (
          <div className="animate-rise mt-6 rounded-xl border border-rust/25 bg-rust-wash px-4 py-3.5">
            <div className="font-mono text-[10px] font-semibold tracking-wide text-rust uppercase">generation failed</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-rust">{failure}</p>
            <div className="mt-3 flex items-center gap-2">
              <Btn onClick={() => nav(`/scopes/${running}`)}>View failed scope</Btn>
              <Btn
                onClick={() => {
                  setRunning(null)
                  setJob(null)
                  setFailure(null)
                }}
              >
                Back to request
              </Btn>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-10 py-12">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">New Scope</h1>
      <p className="mt-1 text-[13.5px] text-ink-2">Select a published standard set, choose what to scope, and run.</p>

      <div className="mt-8 space-y-6">
        <div>
          <SectionLabel>Standard set</SectionLabel>
          <div className="mt-2 space-y-2">
            {published.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                  setIds.includes(s.id) ? 'border-accent/40 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <input type="checkbox" checked={setIds.includes(s.id)} onChange={() => toggleSet(s.id)} className="accent-(--color-accent)" />
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">{s.name}</div>
                  <div className="text-[11.5px] text-ink-3">{s.artifacts.length} artifacts · published {s.updated}</div>
                </div>
              </label>
            ))}
            {published.length === 0 && <p className="text-[13px] text-ink-3">No published sets yet — publish one from Standard sets.</p>}
          </div>
          {setIds.length > 1 && (
            <div className="animate-rise mt-2 rounded-xl border border-accent/25 bg-accent-wash/40 px-4 py-2.5 text-[12px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">Cross-framework union:</span> one combined course covering every
              standard of each selected set. Standards unique to a set get their own lessons; standards that overlap
              across sets merge into one lesson with the assessment boundary widened to the broadest framework's demand
              — so completing the course means mastering every selected framework's standards to the fullest.
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Scope</SectionLabel>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(
              [
                { m: 'course', label: 'Course', note: 'A whole grade — every published domain' },
                { m: 'standard', label: 'Standard', note: 'Pick by code from the set’s tree' },
                { m: 'topic', label: 'Topic', note: 'Any hierarchy node, or free text mapped to standards' },
              ] as const
            ).map((o) => (
              <button
                key={o.m}
                onClick={() => setMode(o.m)}
                className={`cursor-pointer rounded-xl border p-3.5 text-left transition-all ${
                  mode === o.m ? 'border-accent/40 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <div className="text-[13.5px] font-semibold text-ink">{o.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{o.note}</div>
              </button>
            ))}
          </div>

          {mode === 'standard' && (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-hairline bg-panel p-2">
              {standards.map((s) => (
                <label
                  key={s.code}
                  className={`flex cursor-pointer items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 ${selectedCodes.includes(s.code) ? 'bg-accent-wash' : 'hover:bg-ink/[0.03]'}`}
                >
                  <input type="checkbox" checked={selectedCodes.includes(s.code)} onChange={() => toggleCode(s.code)} className="translate-y-px accent-(--color-accent)" />
                  <Mono className="shrink-0 text-[12px] font-semibold text-accent-deep">{s.code}</Mono>
                  <span className="truncate text-[12px] text-ink-2">{s.wording}</span>
                </label>
              ))}
            </div>
          )}

          {mode === 'topic' && (
            <div className="mt-3">
              <input
                value={topic}
                onChange={(e) => { setTopic(e.target.value); setTopicMapped(false) }}
                placeholder="e.g. multi-digit multiplication"
                className="w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
              {topic.trim().length > 3 && !topicMapped && (
                <div className="animate-rise mt-2 rounded-xl border border-hairline bg-panel p-3.5">
                  <SectionLabel>Mapping shown for confirmation</SectionLabel>
                  <p className="mt-1.5 text-[12.5px] text-ink-2">
                    “{topic}” maps to <Mono className="font-semibold text-accent-deep">4.NBT.5</Mono> and <Mono className="font-semibold text-accent-deep">4.NBT.6</Mono>{' '}
                    (multiplication and division chains) with the <Mono>4.OA.3</Mono> application tier.
                  </p>
                  <div className="mt-2.5"><Btn onClick={() => setTopicMapped(true)}>Confirm mapping</Btn></div>
                </div>
              )}
              {topicMapped && <div className="mt-2"><Pill tone="green">mapping confirmed — 4.NBT.5, 4.NBT.6 + 4.OA.3 tier</Pill></div>}

              <div className="mt-3 rounded-xl border border-hairline bg-panel p-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[13px] font-semibold text-ink">Released Questions (Optional)</div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">
                      Attach released questions for this topic — the generator classifies them as released-items
                      evidence and models its generated exemplars on them. PDF only, up to 4 files, 15 MB each.
                    </p>
                  </div>
                  <Btn onClick={() => topicFileInput.current?.click()} className="shrink-0">
                    {topicFiles.length ? 'Add more' : 'Upload PDF(s)'}
                  </Btn>
                </div>
                <input
                  ref={topicFileInput}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = [...(e.target.files ?? [])].filter(
                      (f) => (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') && f.size <= 15 * 1024 * 1024,
                    )
                    setTopicFiles((prev) => {
                      // Match the pipeline's 20 MB attachment budget — a file
                      // accepted here but budget-skipped server-side would be
                      // cited without being attached.
                      const merged = [...prev.filter((p) => !picked.some((f) => f.name === p.name)), ...picked].slice(0, 4)
                      let total = 0
                      return merged.filter((f) => (total += f.size) <= 18 * 1024 * 1024)
                    })
                    e.target.value = ''
                  }}
                />
                {topicFiles.length > 0 && (
                  <ul className="mt-2.5 space-y-1.5">
                    {topicFiles.map((f) => (
                      <li key={f.name} className="flex items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5">
                        <Mono className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{f.name}</Mono>
                        <span className="shrink-0 text-[10.5px] text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                        <button
                          onClick={() => setTopicFiles((prev) => prev.filter((p) => p.name !== f.name))}
                          className="cursor-pointer rounded p-0.5 text-ink-3 transition-colors hover:bg-ink/5 hover:text-rust"
                          title="Remove"
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {packets.length > 0 && (
          <div>
            <SectionLabel>Released-items source (optional)</SectionLabel>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
              Attach a Released Item Repository: its hunted items — with real screenshots where captured — join the
              item bank, appear on the lesson cards' Released Items fields, and carry screenshot links in the exports.
            </p>
            <div className="mt-2 space-y-2">
              {packets.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                    packetId === p.id ? 'border-accent/40 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel hover:border-hairline-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={packetId === p.id}
                    onChange={() => setPacketId((cur) => (cur === p.id ? '' : p.id))}
                    className="accent-(--color-accent)"
                  />
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink">{p.title}</div>
                    <div className="text-[11.5px] text-ink-3">
                      {p.frameworkLabel} · {p.itemCount} item{p.itemCount === 1 ? '' : 's'} · {p.standardCount} standard{p.standardCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {launchError && (
          <div className="animate-rise rounded-xl border border-rust/25 bg-rust-wash px-4 py-3 text-[12.5px] leading-relaxed text-rust">
            <span className="font-mono text-[10px] font-semibold uppercase">could not start</span> — {launchError}
          </div>
        )}

        <div className="flex items-center justify-end border-t border-hairline pt-5">
          <Btn
            kind="primary"
            disabled={launching || setIds.length === 0 || (mode === 'standard' && selectedCodes.length === 0) || (mode === 'topic' && !topicMapped)}
            onClick={() => void run()}
          >
            {launching ? 'Starting…' : 'Run generation'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
