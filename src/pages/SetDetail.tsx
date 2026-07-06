import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, type JobStatus } from '../api'
import { useStore } from '../store'
import { Btn, Modal, Mono, Pill, Progress, SectionLabel } from '../ui'
import type { ArtifactRole, StandardNode } from '../types'

const roleLabel: Record<ArtifactRole, string> = {
  standards: 'Official standards document',
  items: 'Released items',
  'unpacking-structured': 'Unpacking — structured decomposition',
  'unpacking-narrative': 'Unpacking — narrative',
  progression: 'Progressions / vertical alignment',
}

const tabs = ['Configuration', 'Artifacts', 'Standards Tree', 'Alignment Issues', 'Lexicon'] as const

/**
 * Deterministic default resolution per gap class: the same warning text always
 * maps to the same suggested action, keyed on what kind of gap it names.
 */
function defaultResolution(text: string): string {
  if (/item evidence|no items?|release window/i.test(text)) {
    return 'Proceed under anticipated-evidence inference (D1): construct the plausible assessment evidence from analogous tested components in the same skill family, decomposition bounds, and interpretive worked problems; set inferred ceilings and flag every affected card inferred.'
  }
  if (/progression/i.test(text)) {
    return 'Place affected topics using the standards document’s own sequence and decomposition dependencies; cross-grade Progression Placement cites the standards wording only, and prerequisites come from in-course sequencing until a progression document is added.'
  }
  if (/structured decomposition|unpacking/i.test(text)) {
    return 'Fall back to standard sub-parts as the candidate-atom partition; every affected card cites the sub-part partition it used.'
  }
  if (/ingestion failed/i.test(text)) {
    return 'Re-upload the failed document and re-run publish; generation stays blocked for the affected components until ingestion completes.'
  }
  return 'Proceed under anticipated-evidence inference (D1) and flag every affected component inferred, with the inference basis stated in each Decision record.'
}

function WarningRow({
  warning,
  onResolve,
  disabled = false,
}: {
  warning: {
    id: string
    text: string
    acknowledged: boolean
    kind?: 'gap' | 'conflict'
    suggestion?: string
    resolution?: string
    resolvedBy?: 'default' | 'custom'
  }
  onResolve: (resolution: string, resolvedBy: 'default' | 'custom') => Promise<void>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [localBusy, setLocalBusy] = useState(false)
  const busy = localBusy || disabled
  // The AI's investigated suggestion when extraction produced one; the
  // deterministic per-class fallback otherwise.
  const suggested = warning.suggestion?.trim() || defaultResolution(warning.text)
  const label = warning.kind === 'conflict' ? 'scope conflict' : 'coverage gap'

  const apply = (resolution: string, resolvedBy: 'default' | 'custom') => {
    setLocalBusy(true)
    void onResolve(resolution, resolvedBy).finally(() => setLocalBusy(false))
  }

  if (warning.acknowledged) {
    return (
      <div className="rounded-xl border border-hairline bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-[12.5px]">
          <span className="font-mono text-[10px] font-semibold text-verdant uppercase">
            resolved{warning.resolvedBy ? ` — ${warning.resolvedBy}` : ''}
          </span>
          <span className="text-ink-3">{warning.text}</span>
        </div>
        {warning.resolution && (
          <p className="mt-1.5 border-l-2 border-verdant/30 pl-2.5 text-[12px] leading-relaxed text-ink-2">
            {warning.resolution}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border px-4 py-2.5 ${
        warning.kind === 'conflict' ? 'border-rust/25 bg-rust-wash' : 'border-amber-ink/25 bg-amber-wash'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-[12.5px]">
          <span
            className={`font-mono text-[10px] font-semibold uppercase ${
              warning.kind === 'conflict' ? 'text-rust' : 'text-amber-ink'
            }`}
          >
            {label}
          </span>
          <span className={warning.kind === 'conflict' ? 'text-rust' : 'text-amber-ink'}>{warning.text}</span>
        </div>
        {!open && <Btn onClick={() => setOpen(true)}>Resolve</Btn>}
      </div>
      {open && (
        <div className="animate-rise mt-3 space-y-2.5 border-t border-ink/10 pt-3">
          <div className="rounded-lg border border-hairline bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionLabel>{warning.suggestion ? 'Suggested Resolution' : 'Default Resolution'}</SectionLabel>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{suggested}</p>
              </div>
              <Btn kind="primary" disabled={busy} onClick={() => apply(suggested, 'default')} className="shrink-0">
                Use Default
              </Btn>
            </div>
          </div>
          <div className="rounded-lg border border-hairline bg-panel p-3">
            <SectionLabel>Or Resolve Your Own Way</SectionLabel>
            <div className="mt-1.5 flex gap-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Describe how the system should handle this gap…"
                className="flex-1 rounded-lg border border-hairline bg-panel px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
              <Btn disabled={busy || custom.trim().length < 10} onClick={() => apply(custom.trim(), 'custom')}>
                Apply
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TreeNode({ node, depth }: { node: StandardNode; depth: number }) {
  const [open, setOpen] = useState(true)
  const hasKids = !!node.children?.length
  return (
    <div>
      <div
        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${hasKids ? 'cursor-pointer hover:bg-ink/[0.03]' : ''}`}
        style={{ marginLeft: depth * 18 }}
        onClick={() => hasKids && setOpen(!open)}
      >
        {hasKids ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`mt-1.5 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}>
            <path d="M3 1.5L7 5 3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-hairline-2" />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-[12px] font-semibold text-accent-deep">{node.code}</Mono>
            {node.emphasis && node.emphasis !== 'not designated' && <Pill tone="accent">{node.emphasis}</Pill>}
            {node.label && <span className="text-[13px] font-medium text-ink">{node.label}</span>}
          </div>
          {node.wording && <p className="mt-0.5 max-w-3xl font-display text-[13px] leading-relaxed text-ink-2">{node.wording}</p>}
          {node.limits?.map((lim, i) => (
            <div key={i} className="mt-1.5 flex max-w-3xl items-start gap-1.5 rounded-lg border border-rust/20 bg-rust-wash px-2.5 py-1.5">
              <span className="mt-px font-mono text-[10px] font-semibold text-rust uppercase">limit</span>
              <span className="text-[12px] leading-relaxed text-rust">{lim}</span>
            </div>
          ))}
        </div>
      </div>
      {open && node.children?.map((c) => <TreeNode key={c.code} node={c} depth={depth + 1} />)}
    </div>
  )
}

export default function SetDetail() {
  const { id } = useParams()
  const { sets, scopes, acknowledgeWarning, confirmAlignment, resolveArtifact, publishSet, refreshSet, deleteSet } = useStore()
  const [tab, setTab] = useState<(typeof tabs)[number]>('Configuration')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [resolvingAll, setResolvingAll] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [lexStarting, setLexStarting] = useState(false)
  const nav = useNavigate()
  const set = sets.find((s) => s.id === id)
  const setId = set?.id
  const jobActive = !!job && job.kind === 'ingest' && (job.status === 'queued' || job.status === 'running')
  const jobPhase: 'extract' | 'lexicon' = job?.stage.startsWith('Lexicon') ? 'lexicon' : 'extract'

  // Latest ingest job for this set — one fetch on mount, so a running
  // extraction/lexicon build is picked up after navigation or reload.
  useEffect(() => {
    if (!setId) return
    let cancelled = false
    api.getSetJob(setId).then(
      (j) => {
        if (!cancelled) setJob(j)
      },
      () => {
        if (!cancelled) setJob(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [setId])

  // While a job runs, poll job + set every 2s; one final set refresh on settle.
  useEffect(() => {
    if (!setId || !jobActive) return
    const t = setInterval(() => {
      api.getSetJob(setId).then(setJob, () => {})
      void refreshSet(setId)
    }, 2000)
    return () => {
      clearInterval(t)
      void refreshSet(setId)
    }
  }, [setId, jobActive, refreshSet])

  if (!set) return <div className="p-10 text-ink-3">Standard set not found.</div>

  const startLexicon = async () => {
    if (lexStarting) return
    setLexStarting(true)
    setFlowError(null)
    try {
      await api.buildLexicon(set.id)
      setJob(await api.getSetJob(set.id))
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : 'Could not start the lexicon build.')
    } finally {
      setLexStarting(false)
    }
  }

  const retryJob = async () => {
    setFlowError(null)
    setStopping(false)
    try {
      if (jobPhase === 'lexicon') await api.buildLexicon(set.id)
      else await api.ingestSet(set.id)
      setJob(await api.getSetJob(set.id))
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : 'Could not restart the job.')
    }
  }

  const stopExtraction = async () => {
    setFlowError(null)
    setStopping(true)
    try {
      await api.stopIngest(set.id)
    } catch (e) {
      setStopping(false)
      setFlowError(e instanceof Error ? e.message : 'Could not stop the job.')
    }
  }

  const publish = async () => {
    await publishSet(set.id)
  }

  const blocking = set.artifacts.filter((a) => a.reviewStatus === 'blocked')
  const unack = set.warnings.filter((w) => !w.acknowledged)
  const aiQueue = set.items.filter((it) => it.confidence === 'ai-proposed')
  // `?? []` guards the deploy-skew window where the API still serves the legacy shape.
  const lexicon = set.lexicon ?? []
  const lexiconBuilt = lexicon.length > 0
  const canPublish = blocking.length === 0 && unack.length === 0
  // Uploaded sets publish automatically when the lexicon lands; the button is
  // for seeded sets and for a held auto-publish (blocked artifact at build time).
  const showPublish = !set.published && !jobActive && lexiconBuilt
  const readyForLexicon =
    !set.published &&
    !jobActive &&
    set.tree.length > 0 &&
    unack.length === 0 &&
    aiQueue.length === 0 &&
    blocking.length === 0 &&
    !lexiconBuilt

  // Lifecycle stepper: where the set is between upload and publish, and what to do next.
  const extractActive = jobActive && jobPhase === 'extract'
  const lexActive = jobActive && jobPhase === 'lexicon'
  const extractionDone = set.tree.length > 0
  const resolveOutstanding = unack.length + aiQueue.length
  type StepState = 'done' | 'active' | 'error' | 'pending'
  const steps: { label: string; state: StepState; tab: (typeof tabs)[number] }[] = [
    { label: 'Uploaded\nDocuments', state: 'done', tab: 'Artifacts' },
    {
      label: 'AI\nExtraction',
      state: extractActive
        ? 'active'
        : extractionDone
          ? 'done'
          : job?.status === 'failed' && jobPhase === 'extract'
            ? 'error'
            : 'pending',
      tab: 'Standards Tree',
    },
    {
      label: 'Alignment\nIssues',
      state: !extractionDone || extractActive ? 'pending' : resolveOutstanding > 0 ? 'active' : 'done',
      tab: 'Alignment Issues',
    },
    {
      label: 'Build\nLexicon',
      state: lexActive ? 'active' : lexiconBuilt ? 'done' : job?.status === 'failed' && jobPhase === 'lexicon' ? 'error' : 'pending',
      tab: 'Lexicon',
    },
    { label: 'Publish', state: set.published ? 'done' : 'pending', tab: 'Configuration' },
  ]

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <Link to="/sets" className="text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Standard sets</Link>
      <div className="mt-2 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">{set.name}</h1>
            {set.published ? <Pill tone="green">published</Pill> : <Pill tone="amber">draft</Pill>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Btn kind="danger" disabled={jobActive} onClick={() => setConfirmDelete(true)}>Delete</Btn>
          {showPublish && (
            <Btn kind="primary" disabled={!canPublish} onClick={() => void publish()}>Publish set</Btn>
          )}
        </div>
      </div>

      {/* lifecycle steps */}
      {!set.published && (
        <div className="mt-6 rounded-2xl border border-hairline bg-panel px-5 py-4 shadow-(--shadow-lift)">
          <div className="flex items-start">
            {steps.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setTab(s.tab)}
                className="group flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
              >
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <div className="flex w-full items-center gap-2">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                        s.state === 'done'
                          ? 'bg-verdant-wash text-verdant'
                          : s.state === 'active'
                            ? 'stage-pulse bg-accent text-white'
                            : s.state === 'error'
                              ? 'bg-rust-wash text-rust'
                              : 'bg-ink/5 text-ink-3'
                      }`}
                    >
                      {s.state === 'done' ? '✓' : s.state === 'error' ? '!' : i + 1}
                    </span>
                    {i < steps.length - 1 && (
                      <span className={`h-px flex-1 ${s.state === 'done' ? 'bg-verdant/30' : 'bg-hairline-2'}`} />
                    )}
                  </div>
                  <div
                    className={`mt-2 text-[12px] leading-snug font-semibold whitespace-pre-line ${
                      s.state === 'pending' ? 'text-ink-3' : s.state === 'error' ? 'text-rust' : 'text-ink'
                    } group-hover:text-accent-deep`}
                  >
                    {s.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI pipeline progress */}
      {jobActive && (
        <div className="animate-rise mt-6 rounded-2xl border border-accent/25 bg-accent-wash/40 p-5 shadow-(--shadow-lift)">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>
              {jobPhase === 'lexicon' ? 'AI Lexicon Build' : 'Extracting standards and checking for alignment conflicts.'}
            </SectionLabel>
            <div className="flex items-center gap-3">
              <Mono className="text-[11px] text-ink-3">
                {job.stagesDone}/{job.totalStages}
              </Mono>
              <Btn
                kind="danger"
                className="!px-2.5 !py-1 !text-[11.5px]"
                disabled={stopping || job.cancelRequested === true}
                onClick={() => void stopExtraction()}
              >
                {stopping || job.cancelRequested ? 'Stopping…' : 'Stop'}
              </Btn>
            </div>
          </div>
          <div className="mt-3">
            <Progress pct={(job.stagesDone / Math.max(1, job.totalStages)) * 100} />
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className="stage-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="font-medium">{jobPhase === 'lexicon' ? 'Lexicon building in progress' : job.stage}</span>
          </div>
        </div>
      )}

      {job?.status === 'failed' && !set.published && !jobActive && (
        <div className="animate-rise mt-6 flex items-center justify-between gap-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-3">
          <div className="text-[12.5px] leading-relaxed text-rust">
            <span className="font-mono text-[10px] font-semibold uppercase">
              {jobPhase === 'lexicon' ? 'lexicon build failed' : 'extraction failed'}
            </span>{' '}
            — {job.error ?? 'the job died before completing.'}
          </div>
          <Btn onClick={() => void retryJob()}>Retry</Btn>
        </div>
      )}

      {job?.status === 'cancelled' && !set.published && !jobActive && (
        <div className="animate-rise mt-6 flex items-center justify-between gap-4 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3">
          <div className="text-[12.5px] leading-relaxed text-amber-ink">
            <span className="font-mono text-[10px] font-semibold uppercase">
              {jobPhase === 'lexicon' ? 'lexicon build stopped' : 'extraction stopped'}
            </span>{' '}
            — halted by user; already-extracted results are kept.
          </div>
          <Btn onClick={() => void retryJob()}>Resume</Btn>
        </div>
      )}

      {readyForLexicon && (
        <div className="animate-rise mt-6 flex items-center justify-between gap-4 rounded-2xl border border-verdant/25 bg-verdant-wash/60 p-5">
          <div>
            <SectionLabel>Conflicts Resolved — Build the Lexicon</SectionLabel>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-2">
              AI reads every uploaded document under your recorded resolutions and builds one comprehensive glossary of
              student-facing, grade-appropriate vocabulary — every term cited to its governing standard, source
              document, and page.
            </p>
          </div>
          <Btn kind="primary" disabled={lexStarting} onClick={() => void startLexicon()} className="shrink-0">
            {lexStarting ? 'Starting…' : 'Build Lexicon'}
          </Btn>
        </div>
      )}

      {flowError && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] text-rust">
          {flowError}
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Standard Set?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This removes <span className="font-semibold text-ink">{set.name}</span>, its {set.artifacts.length} uploaded
          artifacts, parsed standards, and item bank.{' '}
          {(() => {
            const n = scopes.filter((sc) => sc.setId === set.id).length
            return n > 0
              ? `${n} scope${n > 1 ? 's' : ''} generated from this set will remain viewable, but the set can no longer serve new scope requests.`
              : 'No scopes have been generated from this set.'
          })()}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          <Btn
            kind="danger"
            disabled={deleting}
            onClick={() => {
              setDeleting(true)
              void deleteSet(set.id).then((okd) => {
                setDeleting(false)
                if (okd) nav('/sets')
                else setConfirmDelete(false)
              })
            }}
          >
            {deleting ? 'Deleting…' : 'Delete set'}
          </Btn>
        </div>
      </Modal>

      {/* tabs */}
      <div className="mt-8 flex gap-1 border-b border-hairline">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative cursor-pointer px-3.5 pb-2.5 text-[13px] font-medium transition-colors ${
              tab === t ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t}
            {t === 'Alignment Issues' && resolveOutstanding > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-wash px-1.5 py-px font-mono text-[10px] text-amber-ink">{resolveOutstanding}</span>
            )}
            {tab === t && <span className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <div className="py-7">
        {tab === 'Configuration' && (
          <div className="max-w-xl rounded-xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
            <div className="space-y-3">
              {(
                [
                  { label: 'Standard Set Name', value: set.name },
                  {
                    label: 'Status',
                    value: set.archived ? 'Archived' : set.published ? 'Active' : 'Draft',
                    pill: set.archived ? 'neutral' : set.published ? 'green' : 'amber',
                  },
                  { label: 'Subject', value: set.subject },
                  { label: 'Grade', value: set.gradeSpan },
                  { label: 'Source Organization', value: set.sourceOrganization },
                ] as { label: string; value?: string; pill?: 'green' | 'amber' | 'neutral' }[]
              ).map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-hairline pb-2.5 last:border-0 last:pb-0">
                  <SectionLabel>{row.label}</SectionLabel>
                  {row.pill ? (
                    <Pill tone={row.pill}>{row.value}</Pill>
                  ) : (
                    <span className={`text-right text-[13.5px] font-medium ${row.value && row.value !== 'To be configured' ? 'text-ink' : 'text-ink-3'}`}>
                      {row.value && row.value !== 'To be configured'
                        ? row.value
                        : extractActive
                          ? 'extracting from the standards document…'
                          : 'extracted from the standards document'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Artifacts' && (
          <div className="max-w-4xl space-y-3">
            {set.artifacts.map((a) => (
              <div key={a.id} className={`rounded-xl border bg-panel p-4 shadow-(--shadow-lift) ${a.reviewStatus === 'blocked' ? 'border-rust/30' : 'border-hairline'}`}>
                <div className="flex items-center gap-2.5">
                  <Pill tone="night">{roleLabel[a.role]}</Pill>
                  <Mono className="text-[12.5px] font-medium text-ink">{a.fileName}</Mono>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {(a.meta?.itemCount ?? 0) > 0 && (
                      <span className="text-[12px] text-ink-3">{a.meta?.itemCount} items</span>
                    )}
                    {a.reviewStatus === 'blocked' && <Pill tone="red">ingestion halted</Pill>}
                  </span>
                </div>
                {(() => {
                  // Placeholder values from older set-create versions are hidden;
                  // only real, declared metadata is worth a line.
                  const src = a.meta?.sourceDescription !== 'Uploaded release PDF' ? a.meta?.sourceDescription : undefined
                  const window = a.meta?.window !== 'declared at review' ? a.meta?.window : undefined
                  const coverage = a.meta?.coverage !== 'unknown' ? a.meta?.coverage : undefined
                  const hasAny = src || window || coverage || a.meta?.domainGradeTags
                  return hasAny ? (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
                      {src && <span>{src}</span>}
                      {window && <span>window {window}</span>}
                      {coverage && (
                        <span>
                          coverage: <Mono className={coverage === 'census' ? 'text-verdant' : 'text-amber-ink'}>{coverage}</Mono>
                        </span>
                      )}
                      {a.meta?.domainGradeTags && <span>tags: {a.meta.domainGradeTags.join(', ')}</span>}
                    </div>
                  ) : null
                })()}
                {(() => {
                  // Show only the user's own notes — the AI's appended
                  // 'Ingestion notes: …' stay in the data (they steer
                  // generation) but are not display copy.
                  const marker = a.usageNotes.indexOf('Ingestion notes: ')
                  const human = (marker >= 0 ? a.usageNotes.slice(0, marker) : a.usageNotes).trim()
                  return human ? (
                    <div className="mt-2.5 rounded-lg border border-cite/20 bg-cite-wash px-3 py-2 text-[12px] leading-relaxed text-cite">
                      <span className="font-mono text-[10px] font-semibold uppercase">usage notes</span> — {human}
                    </div>
                  ) : null
                })()}
                {a.blockingError && (
                  <div className="mt-2.5 flex items-start justify-between gap-4 rounded-lg border border-rust/25 bg-rust-wash px-3 py-2.5">
                    <div className="text-[12.5px] leading-relaxed text-rust">
                      <span className="font-mono text-[10px] font-semibold uppercase">blocking error</span> — {a.blockingError}
                    </div>
                    <Btn onClick={() => resolveArtifact(set.id, a.id)}>Correct declaration</Btn>
                  </div>
                )}
              </div>
            ))}
            <p className="px-1 text-[11.5px] leading-relaxed text-ink-3">
              Every upload carries usage notes that steer the generation stages consuming it.
            </p>
          </div>
        )}

        {tab === 'Standards Tree' && (
          <div className="max-w-4xl rounded-xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
            {set.tree.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-ink-2">
                {jobActive
                  ? 'AI extraction is running — the tree populates when it completes.'
                  : 'The standards tree extracts directly from the official standards document — run extraction to populate it.'}
              </p>
            ) : (
              <>
                <div className="mb-1">
                  <SectionLabel>Parsed Standards — Limits Visible, Wording Verbatim</SectionLabel>
                </div>
                <p className="mb-3 text-[11.5px] leading-relaxed text-ink-3">
                  Content standards only — every most-granular standard is listed with its exact text. Practice,
                  process, and implementation standards (Mathematical Practices, TEKS process standards, and similar
                  framework-wide expectations) are excluded at ingestion.
                </p>
                {set.tree.map((n) => <TreeNode key={n.code} node={n} depth={0} />)}
              </>
            )}
          </div>
        )}

        {tab === 'Alignment Issues' && (
          <div className="max-w-4xl space-y-3">
            {set.warnings.length > 0 && (
              <div className="space-y-2">
                {unack.length > 1 && (
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-[11.5px] text-ink-3">
                      {unack.length} to resolve — or apply every suggested default at once
                    </span>
                    <Btn
                      disabled={resolvingAll}
                      onClick={() => {
                        setResolvingAll(true)
                        void (async () => {
                          for (const w of set.warnings.filter((x) => !x.acknowledged)) {
                            // Re-check against the server so a resolution applied
                            // concurrently (or by a prior loop iteration's refresh)
                            // is never overwritten with the default.
                            try {
                              const fresh = await api.getSet(set.id)
                              const current = fresh.warnings.find((x) => x.id === w.id)
                              if (!current || current.acknowledged) continue
                            } catch {
                              /* on read failure, fall through and resolve */
                            }
                            await acknowledgeWarning(
                              set.id,
                              w.id,
                              w.suggestion?.trim() || defaultResolution(w.text),
                              'default',
                            )
                          }
                        })().finally(() => setResolvingAll(false))
                      }}
                    >
                      {resolvingAll ? 'Resolving…' : 'Use Default for All'}
                    </Btn>
                  </div>
                )}
                {set.warnings.map((w) => (
                  <WarningRow
                    key={w.id}
                    warning={w}
                    disabled={resolvingAll}
                    onResolve={(resolution, resolvedBy) => acknowledgeWarning(set.id, w.id, resolution, resolvedBy)}
                  />
                ))}
                {set.warnings.some((w) => w.acknowledged) && (
                  <p className="px-1 text-[11.5px] text-ink-3">
                    Recorded resolutions steer the stages that consume each gap and are surfaced to users whenever a
                    scope request lands inside one.
                  </p>
                )}
              </div>
            )}
            {set.warnings.length === 0 && aiQueue.length === 0 ? (
              jobActive ? (
                <div className="rounded-xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
                  <p className="py-6 text-center text-[13.5px] text-ink-2">
                    AI extraction is running — scoping conflicts will populate once it completes.
                  </p>
                </div>
              ) : set.tree.length === 0 ? (
                <p className="py-6 text-[13px] text-ink-3">Alignment issues populate after AI extraction.</p>
              ) : (
                <p className="py-6 text-[13px] text-ink-3">No alignment issues — the documents agree.</p>
              )
            ) : (
              aiQueue.map((it) => (
                <div key={it.id} className="rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Mono className="text-[12.5px] font-medium text-ink">{it.test} · {it.year} · Q{it.itemNumber}</Mono>
                      <p className="mt-1.5 max-w-xl font-display text-[13.5px] leading-relaxed text-ink-2">{it.stem}</p>
                      <div className="mt-2 text-[12px] text-ink-3">
                        Proposed: <Mono className="text-accent-deep">{it.alignmentCode}</Mono> · completeness {Math.round(it.completeness * 100)}% · {it.demandProfile}
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-ink-3">
                        Usable in generation while unconfirmed (D14) — reliance is flagged in QC and stated in the Decision record of any card that uses it.
                      </p>
                    </div>
                    <Btn kind="primary" onClick={() => confirmAlignment(set.id, it.id)}>Confirm alignment</Btn>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'Lexicon' && !lexiconBuilt && (
          <div className="max-w-4xl rounded-xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
            <div className="py-6 text-center">
              <p className="text-[13.5px] leading-relaxed text-ink-2">
                {extractActive
                  ? 'AI extraction is running — once it completes, resolve the scope conflicts and confirm the AI-proposed alignments; the lexicon generates after that.'
                  : lexActive
                    ? 'AI is building the lexicon now — one comprehensive glossary of student-facing vocabulary, every term cited to its standard, document, and page.'
                    : extractionDone && resolveOutstanding > 0
                      ? `Extraction is complete — resolve the remaining ${[
                          unack.length > 0 ? `${unack.length} conflict${unack.length === 1 ? '' : 's'}` : '',
                          aiQueue.length > 0 ? `${aiQueue.length} alignment check${aiQueue.length === 1 ? '' : 's'}` : '',
                        ]
                          .filter(Boolean)
                          .join(' and ')} in the Alignment Issues tab to generate the lexicon.`
                      : readyForLexicon
                        ? 'All checks are resolved — the lexicon is ready to generate.'
                        : 'The lexicon generates after extraction and the alignment checks.'}
              </p>
              {readyForLexicon && (
                <div className="mt-4 flex justify-center">
                  <Btn kind="primary" disabled={lexStarting} onClick={() => void startLexicon()}>
                    {lexStarting ? 'Starting…' : 'Build Lexicon'}
                  </Btn>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'Lexicon' && lexiconBuilt && (
          <div className="max-w-4xl rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>Glossary — {lexicon.length} Terms</SectionLabel>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                  Student-facing, grade-appropriate vocabulary drawn from every uploaded document — the shared
                  controlled vocabulary every later stage speaks.
                </p>
              </div>
              {/* Mirror the build-lexicon endpoint's gates — otherwise the button 409s. */}
              {!jobActive && blocking.length === 0 && unack.length === 0 && aiQueue.length === 0 && (
                <Btn disabled={lexStarting} onClick={() => void startLexicon()} className="shrink-0">
                  {lexStarting ? 'Starting…' : 'Rebuild'}
                </Btn>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {[...lexicon]
                .sort((a, b) => a.term.localeCompare(b.term))
                .map((t) => (
                  <div key={t.term} className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 last:border-0">
                    <div>
                      <Mono className="text-[12.5px] font-medium text-ink">{t.term}</Mono>
                      {t.aliases.length > 0 && <span className="ml-2 text-[11.5px] text-ink-3">aka {t.aliases.join(', ')}</span>}
                    </div>
                    {t.standard ? (
                      <Mono className="shrink-0 text-[10.5px] text-ink-3">{t.standard}</Mono>
                    ) : (
                      <span className="shrink-0 text-[10.5px] text-ink-3">{t.source}</span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
