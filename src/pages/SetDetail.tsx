import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, type JobStatus } from '../api'
import { useStore } from '../store'
import { Btn, ItemShot, Modal, Mono, Pill, Progress, SectionLabel } from '../ui'
import type { ArtifactRole, ItemRecord, StandardNode } from '../types'

const roleLabel: Record<ArtifactRole, string> = {
  standards: 'Official standards document',
  items: 'Released items',
  'unpacking-structured': 'Unpacking — structured decomposition',
  'unpacking-narrative': 'Unpacking — narrative',
  progression: 'Progressions / vertical alignment',
}

const tabs = ['Configuration', 'Artifacts', 'Standards Tree', 'Item Bank', 'Alignment Queue', 'Lexicons'] as const

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
            {node.norm !== node.code && <Mono className="text-[11px] text-ink-3">→ {node.norm}</Mono>}
            {node.emphasis && node.emphasis !== 'not designated' && <Pill tone="accent">{node.emphasis}</Pill>}
            {node.fluency && <Pill tone="amber">fluency — P8</Pill>}
            {node.label && <span className="text-[13px] font-medium text-ink">{node.label}</span>}
          </div>
          {node.wording && <p className="mt-0.5 max-w-3xl font-display text-[13px] leading-relaxed text-ink-2">{node.wording}</p>}
          {node.limits?.map((lim, i) => (
            <div key={i} className="mt-1.5 flex max-w-3xl items-start gap-1.5 rounded-lg border border-rust/20 bg-rust-wash px-2.5 py-1.5">
              <span className="mt-px font-mono text-[10px] font-semibold text-rust uppercase">limit</span>
              <span className="text-[12px] leading-relaxed text-rust">{lim} <span className="opacity-70">Carries full P1 force.</span></span>
            </div>
          ))}
        </div>
      </div>
      {open && node.children?.map((c) => <TreeNode key={c.code} node={c} depth={depth + 1} />)}
    </div>
  )
}

function findWording(nodes: StandardNode[], norm: string): string | undefined {
  for (const n of nodes) {
    if (n.norm === norm && n.wording) return n.wording
    const hit = n.children && findWording(n.children, norm)
    if (hit) return hit
  }
  return undefined
}

function ItemGroup({ code, items, wording, setId }: { code: string; items: ItemRecord[]; wording?: string; setId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/[0.02]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M3 1.5L7 5 3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Mono className="shrink-0 text-[13px] font-semibold text-accent-deep">{code}</Mono>
        {wording && <span className="min-w-0 truncate text-[12px] text-ink-3">{wording}</span>}
        <span className="ml-auto shrink-0">
          <Pill tone="neutral">
            {items.length} item{items.length === 1 ? '' : 's'}
          </Pill>
        </span>
      </button>
      {open && (
        <div className="animate-rise space-y-3 border-t border-hairline bg-paper/50 p-4">
          {items.map((it) => (
            <ItemShot key={it.id} item={it} imageUrl={it.imagePath ? api.itemImageUrl(setId, it.id) : undefined} />
          ))}
        </div>
      )}
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
    setFlowError(null)
    try {
      await api.buildLexicon(set.id)
      setJob(await api.getSetJob(set.id))
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : 'Could not start the lexicon build.')
    }
  }

  const retryJob = async () => {
    setFlowError(null)
    try {
      if (jobPhase === 'lexicon') await api.buildLexicon(set.id)
      else await api.ingestSet(set.id)
      setJob(await api.getSetJob(set.id))
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : 'Could not restart the job.')
    }
  }

  const publish = async () => {
    await publishSet(set.id)
  }

  const blocking = set.artifacts.filter((a) => a.reviewStatus === 'blocked')
  const unack = set.warnings.filter((w) => !w.acknowledged)
  const aiQueue = set.items.filter((it) => it.confidence === 'ai-proposed')
  const lexiconBuilt = set.lexicons.representations.length > 0 || set.lexicons.problemTypes.length > 0
  const canPublish = blocking.length === 0 && unack.length === 0
  // Uploaded sets publish automatically when the lexicon lands; the button is
  // for seeded sets and for a held auto-publish (blocked artifact at build time).
  const showPublish = !set.published && !jobActive && lexiconBuilt
  const readyForLexicon =
    !set.published && !jobActive && set.tree.length > 0 && unack.length === 0 && blocking.length === 0 && !lexiconBuilt

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

      {/* AI pipeline progress */}
      {jobActive && (
        <div className="animate-rise mt-6 rounded-2xl border border-accent/25 bg-accent-wash/40 p-5 shadow-(--shadow-lift)">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>
              {jobPhase === 'lexicon' ? 'AI Lexicon Build' : 'AI Extraction — Standards Tree, Item Bank & Conflict Check'}
            </SectionLabel>
            <Mono className="text-[11px] text-ink-3">
              {job.stagesDone}/{job.totalStages}
            </Mono>
          </div>
          <div className="mt-3">
            <Progress pct={(job.stagesDone / Math.max(1, job.totalStages)) * 100} />
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className="stage-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="font-medium">{job.stage}</span>
            {job.log.length > 0 && <span className="truncate text-ink-3">— {job.log[job.log.length - 1].detail}</span>}
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

      {readyForLexicon && (
        <div className="animate-rise mt-6 flex items-center justify-between gap-4 rounded-2xl border border-verdant/25 bg-verdant-wash/60 p-5">
          <div>
            <SectionLabel>Conflicts Resolved — Build the Lexicons</SectionLabel>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-2">
              AI reads every uploaded document under your recorded resolutions and builds exhaustive representation and
              problem-type vocabularies — every term cited to its governing standard, source document, and page. The
              set publishes when the build lands.
            </p>
          </div>
          <Btn kind="primary" onClick={() => void startLexicon()} className="shrink-0">
            Build Lexicon
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

      {/* coverage warnings */}
      {set.warnings.length > 0 && (
        <div className="mt-6 space-y-2">
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
              Recorded resolutions steer the stages that consume each gap and are surfaced to users whenever a scope
              request lands inside one.
            </p>
          )}
        </div>
      )}

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
            {t === 'Alignment Queue' && aiQueue.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-wash px-1.5 py-px font-mono text-[10px] text-amber-ink">{aiQueue.length}</span>
            )}
            {tab === t && <span className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <div className="py-7">
        {tab === 'Configuration' && (
          <div className="max-w-xl rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
            <SectionLabel>Hierarchy Level Names</SectionLabel>
            <div className="mt-1.5 text-[13.5px] font-medium text-ink">{set.hierarchyLevels.join(' → ')}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-ink-3">The UI and card fields use the set’s own vocabulary.</div>
          </div>
        )}

        {tab === 'Artifacts' && (
          <div className="max-w-4xl space-y-3">
            {set.artifacts.map((a) => (
              <div key={a.id} className={`rounded-xl border bg-panel p-4 shadow-(--shadow-lift) ${a.reviewStatus === 'blocked' ? 'border-rust/30' : 'border-hairline'}`}>
                <div className="flex items-center gap-2.5">
                  <Pill tone="night">{roleLabel[a.role]}</Pill>
                  <Mono className="text-[12.5px] font-medium text-ink">{a.fileName}</Mono>
                  {a.reviewStatus === 'blocked' && (
                    <span className="ml-auto">
                      <Pill tone="red">ingestion halted</Pill>
                    </span>
                  )}
                </div>
                {(() => {
                  // Placeholder values from older set-create versions are hidden;
                  // only real, declared metadata is worth a line.
                  const src = a.meta?.sourceDescription !== 'Uploaded release PDF' ? a.meta?.sourceDescription : undefined
                  const window = a.meta?.window !== 'declared at review' ? a.meta?.window : undefined
                  const coverage = a.meta?.coverage !== 'unknown' ? a.meta?.coverage : undefined
                  const hasAny = src || window || coverage || a.meta?.itemCount || a.meta?.domainGradeTags
                  return hasAny ? (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
                      {src && <span>{src}</span>}
                      {window && <span>window {window}</span>}
                      {coverage && (
                        <span>
                          coverage: <Mono className={coverage === 'census' ? 'text-verdant' : 'text-amber-ink'}>{coverage}</Mono>
                        </span>
                      )}
                      {a.meta?.itemCount ? <span>{a.meta.itemCount} items</span> : null}
                      {a.meta?.domainGradeTags && <span>tags: {a.meta.domainGradeTags.join(', ')}</span>}
                    </div>
                  ) : null
                })()}
                {a.usageNotes && (
                  <div className="mt-2.5 rounded-lg border border-cite/20 bg-cite-wash px-3 py-2 text-[12px] leading-relaxed text-cite">
                    <span className="font-mono text-[10px] font-semibold uppercase">usage notes · precedence 5</span> — {a.usageNotes}
                  </div>
                )}
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
                {jobActive ? 'AI extraction is running — the tree populates when it completes.' : 'Resolve the Coverage Gaps to populate.'}
              </p>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <SectionLabel>Parsed Standards — Limits Visible, Wording Verbatim</SectionLabel>
                  <span className="text-[11.5px] text-ink-3">Dual coding: canonical ID + normalized join code</span>
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

        {tab === 'Item Bank' && (
          <div className="max-w-4xl">
            {set.items.length === 0 ? (
              (() => {
                const sources = set.artifacts.filter((a) => a.role === 'items')
                return sources.length === 0 ? (
                  <p className="py-6 text-[13px] text-ink-3">No released-items document uploaded.</p>
                ) : (
                  <div className="space-y-2.5">
                    {sources.map((a) => (
                      <div key={a.id} className="rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
                        <div className="flex items-center gap-2.5">
                          <Pill tone="night">Released items</Pill>
                          <Mono className="text-[12.5px] font-medium text-ink">{a.fileName}</Mono>
                          <span className="ml-auto">
                            <Pill tone="accent">uploaded — items extract at publish</Pill>
                          </span>
                        </div>
                        {a.usageNotes && (
                          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{a.usageNotes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              <div className="space-y-2.5">
                {[...new Set(set.items.map((it) => it.alignmentCode))]
                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                  .map((code) => (
                    <ItemGroup
                      key={code}
                      code={code}
                      items={set.items.filter((it) => it.alignmentCode === code)}
                      wording={findWording(set.tree, code)}
                      setId={set.id}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Alignment Queue' && (
          <div className="max-w-4xl space-y-3">
            {aiQueue.length === 0 ? (
              <p className="py-6 text-[13px] text-ink-3">No AI-proposed alignments awaiting confirmation.</p>
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

        {tab === 'Lexicons' && (
          <div className="grid max-w-4xl grid-cols-2 gap-4">
            {(['representations', 'problemTypes'] as const).map((k) => (
              <div key={k} className="rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
                <SectionLabel>{k === 'representations' ? 'Representations' : 'Problem types'}</SectionLabel>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                  Shared controlled vocabulary — keeps the vision pass and the split logic reading the same term as the same thing.
                </p>
                <div className="mt-3 space-y-2">
                  {set.lexicons[k].length === 0 && <p className="text-[12.5px] text-ink-3">Not yet seeded.</p>}
                  {set.lexicons[k].map((t) => (
                    <div key={t.term} className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 last:border-0">
                      <div>
                        <Mono className="text-[12.5px] font-medium text-ink">{t.term}</Mono>
                        {t.aliases.length > 0 && <span className="ml-2 text-[11.5px] text-ink-3">aka {t.aliases.join(', ')}</span>}
                      </div>
                      {t.standard ? (
                        <Mono
                          className="shrink-0 cursor-help text-[10.5px] text-ink-3"
                          title={`${t.artifact ?? t.source}${t.page ? ` · p. ${t.page}` : ''}`}
                        >
                          {t.standard}
                        </Mono>
                      ) : (
                        <span className="shrink-0 text-[10.5px] text-ink-3">{t.source}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
