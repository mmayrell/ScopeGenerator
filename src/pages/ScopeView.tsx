import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { fieldMeta } from '../data/meta'
import { scopeUnsettled, useScopePolling, useStore } from '../store'
import type { DecisionEntry, Lesson, Proposal, Scope } from '../types'
import { Btn, capsStandardCodes, CiteChips, GeneratedShot, ItemShot, Modal, Mono, Pill, SectionLabel } from '../ui'

const typeTone: Record<Lesson['type'], { label: string; tone: 'accent' | 'cite' | 'night' }> = {
  'new-learning': { label: 'new-learning atom', tone: 'accent' },
  bridge: { label: 'bridge', tone: 'night' },
  'application-tier': { label: 'application tier', tone: 'cite' },
}

const decisionLabel: Record<DecisionEntry['type'], string> = {
  granularity: 'Granularity',
  strategy: 'Strategy Selection',
  boundary: 'Boundary & Ceiling',
  ceiling: 'Boundary & Ceiling',
  contradiction: 'Contradictions & Conflicts',
  override: 'Override',
  assumption: 'Thin-Evidence Assumptions',
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      {locked ? (
        <path d="M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9a1 1 0 011 1v5a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <path d="M4.5 7V5a3.5 3.5 0 016.8-1.2M3.5 7h9a1 1 0 011 1v5a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  )
}

// ---------- data-informed revision ----------

function RevisionDialog({ scope, lesson, onClose }: { scope: Scope; lesson: Lesson; onClose: () => void }) {
  const { submitReport, iterateProposal, resolveProposal, scopes } = useStore()
  const [text, setText] = useState('')
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const live = scopes.find((s) => s.id === scope.id)
  const proposal = live?.proposals.find((p) => p.id === proposalId)

  const submit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const p = await submitReport(scope.id, lesson.id, text)
      setProposalId(p.id)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not submit the report.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Update from Student Data" wide>
      {!proposal ? (
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Describe the instructional evidence—what lessons were involved, what feedback, observations, or student
            performance revealed, and any recurring patterns, misconceptions, or outcomes. Your report will be analyzed
            to generate evidence-based recommendations. All proposed changes are reviewed before anything is applied.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-hairline bg-panel px-3.5 py-3 text-[13px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
          {submitError && (
            <div className="rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{submitError}</div>
          )}
          <div className="flex justify-end">
            <Btn kind="primary" disabled={text.trim().length < 20 || submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </Btn>
          </div>
        </div>
      ) : (
        <ProposalView
          proposal={proposal}
          feedback={feedback}
          setFeedback={setFeedback}
          onIterate={() => {
            void iterateProposal(scope.id, proposal.id, feedback)
            setFeedback('')
          }}
          onResolve={(accept) => {
            void resolveProposal(scope.id, proposal.id, accept)
            onClose()
          }}
        />
      )}
    </Modal>
  )
}

function ProposalView({
  proposal,
  feedback,
  setFeedback,
  onIterate,
  onResolve,
}: {
  proposal: Proposal
  feedback: string
  setFeedback: (v: string) => void
  onIterate: () => void
  onResolve: (accept: boolean) => void
}) {
  const working = proposal.working || proposal.status === 'drafting'
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-rust/20 bg-rust-wash/60 p-3.5">
        <div className="flex items-center gap-2">
          <Pill tone="red">PerformanceReport</Pill>
          <span className="text-[11.5px] text-ink-3">{proposal.report.date} · {proposal.report.actor} · target {proposal.report.target}</span>
        </div>
        <p className="mt-2 font-display text-[13px] leading-relaxed text-ink-2 italic">“{proposal.report.text}”</p>
      </div>

      {working && (
        <div className="animate-rise flex items-center gap-3 rounded-xl border border-accent/25 bg-accent-wash/40 px-4 py-3">
          <span className="stage-pulse h-2 w-2 shrink-0 rounded-full bg-accent" />
          <p className="text-[12.5px] leading-relaxed text-accent-deep">
            {proposal.status === 'drafting'
              ? 'Drafting the change set — mapping the report onto the engine’s Editing-Splits logic. Nothing mutates until you accept.'
              : 'Revising the draft per your feedback — the round is appended when it completes.'}
          </p>
        </div>
      )}

      {proposal.changes.length > 0 && (
      <div>
        <SectionLabel>Draft change set — rendered as a diff, nothing mutated</SectionLabel>
        <div className="mt-2 space-y-3">
          {proposal.changes.map((ch, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-hairline">
              <div className="flex items-center gap-2 border-b border-hairline bg-paper/70 px-3.5 py-2">
                <Pill tone={ch.kind === 'split' ? 'accent' : 'neutral'}>{ch.kind}</Pill>
                <Mono className="text-[12px] font-medium text-ink">{ch.target}</Mono>
                <Mono className="ml-auto text-[10.5px] text-ink-3">{ch.rule}</Mono>
              </div>
              <div className="divide-y divide-hairline text-[12.5px] leading-relaxed">
                <div className="flex gap-2.5 bg-rust-wash/50 px-3.5 py-2.5">
                  <span className="font-mono font-semibold text-rust">−</span>
                  <span className="text-ink-2 line-through decoration-rust/40">{ch.before}</span>
                </div>
                <div className="flex gap-2.5 bg-verdant-wash/60 px-3.5 py-2.5">
                  <span className="font-mono font-semibold text-verdant">+</span>
                  <span className="text-ink">{ch.after}</span>
                </div>
              </div>
              <div className="border-t border-hairline px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">Rationale — </span>{ch.rationale}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {proposal.ripple.length > 0 && (
      <div>
        <SectionLabel>Ripple preview</SectionLabel>
        <ul className="mt-1.5 space-y-1">
          {proposal.ripple.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />{r}
            </li>
          ))}
        </ul>
      </div>
      )}

      {proposal.rounds.length > 0 && (
        <div>
          <SectionLabel>Iteration history</SectionLabel>
          <div className="mt-2 space-y-2.5">
            {proposal.rounds.map((r, i) => (
              <div key={i} className="space-y-1.5">
                <div className="ml-8 rounded-xl rounded-tr-sm bg-accent-wash px-3.5 py-2 text-[12.5px] leading-relaxed text-accent-deep">{r.feedback}</div>
                <div className="mr-8 rounded-xl rounded-tl-sm border border-hairline bg-panel px-3.5 py-2 text-[12.5px] leading-relaxed text-ink-2">{r.response}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-hairline pt-4">
        <div className="flex gap-2">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Reply with feedback to iterate…"
            className="flex-1 rounded-xl border border-hairline bg-panel px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
          <Btn disabled={working || feedback.trim().length < 4} onClick={onIterate}>Iterate</Btn>
        </div>
        <div className="flex items-center justify-between">
          <Btn kind="danger" disabled={working} onClick={() => onResolve(false)}>Abandon</Btn>
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-ink-3">Acceptance creates a new immutable version with the report attached.</span>
            <Btn kind="primary" disabled={working} onClick={() => onResolve(true)}>Accept proposal</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- the 13-field card ----------

function LessonCard({ scope, lesson }: { scope: Scope; lesson: Lesson }) {
  const { toggleLock, sets } = useStore()
  const [revisionOpen, setRevisionOpen] = useState(false)
  const set = sets.find((s) => s.id === scope.setId)
  const itemsById = useMemo(() => new Map(set?.items.map((i) => [i.id, i]) ?? []), [set])
  const tt = typeTone[lesson.type]

  return (
    <article className="animate-rise" key={lesson.id}>
      {/* card header */}
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Mono className="rounded-md bg-night px-2 py-0.5 text-[11.5px] font-semibold text-white">{lesson.id}</Mono>
            <Pill tone={tt.tone}>{tt.label}</Pill>
            <Pill tone={lesson.evidenceStatus === 'observed' ? 'green' : lesson.evidenceStatus === 'inferred' ? 'amber' : 'neutral'}>
              evidence: {lesson.evidenceStatus}
            </Pill>
            {lesson.locked && (
              <Pill tone="night"><LockIcon locked /> locked</Pill>
            )}
          </div>
          <h2 className="mt-2.5 max-w-2xl font-display text-[24px] leading-snug font-semibold tracking-tight text-ink">{lesson.title}</h2>
        </div>
        <div className="flex shrink-0 gap-2 pt-1">
          <Btn onClick={() => void toggleLock(scope.id, lesson.id)}>
            <LockIcon locked={!lesson.locked} />
            {lesson.locked ? 'Unlock' : 'Lock'}
          </Btn>
          <Btn kind="night" onClick={() => setRevisionOpen(true)}>Update with Feedback/Data</Btn>
        </div>
      </header>

      {/* fields 1–12 */}
      <div className="mt-7 overflow-hidden rounded-2xl border border-hairline bg-panel shadow-(--shadow-lift)">
        {fieldMeta.map((fm) => {
          const field = lesson.fields[fm.key]
          return (
            <section key={fm.key} className="group grid grid-cols-1 gap-2 border-b border-hairline px-6 py-4.5 last:border-0 hover:bg-paper/40 xl:grid-cols-[200px_1fr] xl:gap-6">
              <div className="pt-0.5">
                <div className="flex items-baseline gap-2">
                  <Mono className="text-[10.5px] text-ink-3">{String(fm.n).padStart(2, '0')}</Mono>
                  <span className="text-[12.5px] leading-snug font-semibold text-ink">{fm.label}</span>
                </div>
                <div className="mt-1 text-[11px] leading-snug text-ink-3">{fm.purpose}</div>
                {field.inferred && <div className="mt-1.5"><Pill tone="amber">inferred — D1</Pill></div>}
              </div>
              <div className="min-w-0">
                <p className="font-display text-[14px] leading-relaxed text-ink">
                  {field.content}
                  <CiteChips citations={field.citations} />
                </p>
                {fm.key === 'releasedItems' && (
                  <div className="mt-4 space-y-3">
                    {lesson.itemRefs.map((rid) => {
                      const it = itemsById.get(rid)
                      return it ? (
                        <ItemShot
                          key={rid}
                          item={it}
                          imageUrl={it.imagePath ? api.itemImageUrl(scope.setId, it.id) : undefined}
                        />
                      ) : null
                    })}
                    {lesson.generatedExemplar && (
                      <GeneratedShot
                        stem={lesson.generatedExemplar.stem}
                        answer={lesson.generatedExemplar.answer}
                        demandProfile={lesson.generatedExemplar.demandProfile}
                        basis={lesson.generatedExemplar.basis}
                      />
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}

        {/* field 13 — decision record */}
        <section className="grid grid-cols-1 gap-3 bg-night px-6 py-5 xl:grid-cols-[200px_1fr] xl:gap-6">
          <div className="pt-0.5">
            <div className="flex items-baseline gap-2">
              <Mono className="text-[10.5px] text-white/40">13</Mono>
              <span className="text-[12.5px] font-semibold text-white">Decision Record</span>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-white/45">The why, auditable — every consequential decision, reasoned on the card itself</div>
          </div>
          <div className="space-y-3.5">
            {lesson.decisions.map((d) => (
              <div key={d.n} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[10.5px] font-semibold text-white/80">{d.n}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-white/90">{decisionLabel[d.type]}</span>
                    <span className="rounded-[5px] border border-white/15 bg-white/5 px-1.5 py-px font-mono text-[10px] text-white/60">{d.rule}</span>
                    {d.flags?.map((fl) => (
                      <span key={fl} className="rounded-[5px] border border-amber-ink/40 bg-amber-ink/20 px-1.5 py-px font-mono text-[10px] text-amber-wash">{fl}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-white/75">{d.text}</p>
                  {d.citations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.citations.map((c, i) => (
                        <span key={i} className="rounded-[5px] border border-white/12 bg-white/5 px-1.5 py-px font-mono text-[10px] text-white/55" title={c.excerpt}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {revisionOpen && <RevisionDialog scope={scope} lesson={lesson} onClose={() => setRevisionOpen(false)} />}
    </article>
  )
}

// ---------- page ----------

export default function ScopeView() {
  const { id } = useParams()
  const { scopes, sets, deleteScope, createScope, refreshScope } = useStore()
  const nav = useNavigate()
  const scope = scopes.find((s) => s.id === id)
  const [sel, setSel] = useState<string | null>(null)
  const [qcOpen, setQcOpen] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [genAction, setGenAction] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const [lookedUp, setLookedUp] = useState(false)

  // While the scope is generating (initial run, rerun, apply-proposal) or a proposal is
  // drafting/iterating, poll its document every 2s until it settles.
  useScopePolling(scope && scopeUnsettled(scope) ? [scope.id] : [])

  // A missing scope may just be a failed refresh at navigation time — try one fetch
  // before declaring it not found.
  const missing = !scope
  useEffect(() => {
    if (!missing || !id) return
    let cancelled = false
    setLookedUp(false)
    void refreshScope(id).finally(() => {
      if (!cancelled) setLookedUp(true)
    })
    return () => {
      cancelled = true
    }
  }, [missing, id, refreshScope])

  if (!scope) {
    return lookedUp ? (
      <div className="p-10 text-ink-3">Scope not found.</div>
    ) : (
      <div className="p-10 text-ink-3">Loading scope…</div>
    )
  }
  const set = sets.find((s) => s.id === scope.setId)

  const genControl = async (action: 'pause' | 'resume' | 'cancel') => {
    setGenAction(action)
    try {
      if (action === 'pause') await api.pauseGeneration(scope.id)
      else if (action === 'resume') await api.resumeGeneration(scope.id)
      else await api.cancelGeneration(scope.id)
      await refreshScope(scope.id)
    } catch {
      /* surfaced via the store's action-error strip */
    } finally {
      setGenAction(null)
    }
  }

  if (scope.status === 'generating') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="stage-pulse mx-auto h-2.5 w-2.5 rounded-full bg-accent" />
          <p className="mt-3 text-[13px] text-ink-2">Generation in progress — units stream in as stages complete.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Btn disabled={genAction !== null} onClick={() => void genControl('pause')}>
              {genAction === 'pause' ? 'Pausing…' : 'Pause'}
            </Btn>
            <Btn kind="danger" disabled={genAction !== null} onClick={() => void genControl('cancel')}>
              {genAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  if (scope.status === 'paused') {
    return (
      <div className="flex h-full items-center justify-center px-10">
        <div className="animate-rise w-full max-w-lg rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill tone="amber">generation paused</Pill>
            <h1 className="font-display text-[18px] font-semibold text-ink">{capsStandardCodes(scope.title)}</h1>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            Progress is checkpointed — resuming continues exactly where the run left off.
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
            <Link to="/" className="text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Scopes</Link>
            <div className="flex gap-2">
              <Btn kind="danger" disabled={genAction !== null} onClick={() => void genControl('cancel')}>
                {genAction === 'cancel' ? 'Cancelling…' : 'Cancel generation'}
              </Btn>
              <Btn kind="primary" disabled={genAction !== null} onClick={() => void genControl('resume')}>
                {genAction === 'resume' ? 'Resuming…' : 'Resume'}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (scope.status === 'failed') {
    const retry = async () => {
      setRetrying(true)
      try {
        // Resume the same job first — its checkpoints skip all finished work.
        await api.resumeGeneration(scope.id)
        await refreshScope(scope.id)
        setRetrying(false)
      } catch {
        try {
          const newId = await createScope(scope.setId, scope.request.mode, scope.request.params)
          nav(`/scopes/${newId}`)
        } catch {
          setRetrying(false) // failure already surfaced via the store's action-error strip
        }
      }
    }
    return (
      <div className="flex h-full items-center justify-center px-10">
        <div className="animate-rise w-full max-w-lg rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill tone="red">generation failed</Pill>
            <h1 className="font-display text-[18px] font-semibold text-ink">{capsStandardCodes(scope.title)}</h1>
          </div>
          <div className="mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-3">
            <div className="font-mono text-[10px] font-semibold tracking-wide text-rust uppercase">error</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-rust">{scope.error ?? 'The generation job failed.'}</p>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
            The run is checkpointed server-side; retry resumes from the checkpoints, skipping everything already generated. Delete removes this failed scope.
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
            <Link to="/" className="text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Scopes</Link>
            <div className="flex gap-2">
              <Btn kind="danger" onClick={() => { void deleteScope(scope.id).then((ok) => { if (ok) nav('/') }) }}>Delete scope</Btn>
              <Btn kind="primary" disabled={retrying} onClick={() => void retry()}>{retrying ? 'Starting…' : 'Retry generation'}</Btn>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const allLessons = scope.units.flatMap((u) => u.lessons)
  if (allLessons.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-10">
        <div className="text-center">
          <p className="text-[13px] text-ink-3">This scope has no lessons.</p>
          <Link to="/" className="mt-3 inline-block text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Scopes</Link>
        </div>
      </div>
    )
  }
  const lesson = allLessons.find((l) => l.id === sel) ?? allLessons[0]
  const qcFlags = scope.qc.filter((q) => q.status !== 'pass')

  return (
    <div className="flex h-full">
      {/* unit / lesson rail */}
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-hairline bg-panel/60 px-4 py-6 xl:w-72">
        <Link to="/" className="px-2 text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Scopes</Link>
        <h1 className="mt-2 px-2 font-display text-[17px] leading-snug font-semibold text-ink">{capsStandardCodes(scope.title)}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-2">
          <Pill tone="neutral">v{scope.version}</Pill>
          <Pill tone={qcFlags.length ? 'amber' : 'green'}>{qcFlags.length ? `QC: ${qcFlags.length} flagged` : 'QC clean'}</Pill>
          {scope.proposals.some((p) => p.working || p.status === 'drafting') && (
            <Pill tone="accent">
              <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" /> proposal drafting
            </Pill>
          )}
        </div>
        <div className="mt-1.5 px-2 font-mono text-[10px] leading-relaxed text-ink-3">
          {scope.engineVersion.split(' (')[0]} · {(scope.doctrineVersions[0] ?? '—').split(' (')[0]}
        </div>
        <div className="mt-3 flex gap-1.5 px-2">
          <Btn className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setQcOpen(true)}>QC report</Btn>
          <Btn className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setHistOpen(true)}>History</Btn>
          <Btn kind="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setConfirmDelete(true)}>Delete</Btn>
        </div>

        <div className="mt-6 space-y-5">
          {scope.units.map((u) => (
            <div key={u.id}>
              <div className="px-2">
                <div className="flex items-baseline gap-2">
                  <Mono className="text-[10.5px] font-semibold text-ink-3">{u.id}</Mono>
                  <span className="text-[12.5px] font-semibold text-ink">{u.title}</span>
                </div>
                <div className="mt-0.5 text-[10.5px] text-ink-3">{u.strand}</div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                {u.lessons.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSel(l.id)}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      lesson.id === l.id ? 'bg-accent-wash text-accent-deep' : 'text-ink-2 hover:bg-ink/[0.035]'
                    }`}
                  >
                    <Mono className={`shrink-0 text-[10.5px] ${lesson.id === l.id ? 'text-accent-deep' : 'text-ink-3'}`}>{l.id.split('.')[1]}</Mono>
                    <span className="truncate text-[12.5px] leading-snug font-medium">{l.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {l.type === 'bridge' && <span className="h-1.5 w-1.5 rounded-full bg-night" title="bridge" />}
                      {l.type === 'application-tier' && <span className="h-1.5 w-1.5 rounded-full bg-cite" title="application tier" />}
                      {l.evidenceStatus !== 'observed' && <span className="h-1.5 w-1.5 rounded-full bg-amber-ink" title="inferred evidence" />}
                      {l.locked && <span className="text-ink-3"><LockIcon locked /></span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* card area */}
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-8 xl:px-10">
        {/* unit context strip */}
        {(() => {
          const unit = scope.units.find((u) => u.lessons.some((l) => l.id === lesson.id))
          return unit ? (
            <div className="mb-6 rounded-xl border border-hairline bg-panel/70 px-4 py-2.5 text-[12px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">{unit.id} · {unit.title}</span>
              <span className="text-ink-3"> — {unit.rationale}</span>
            </div>
          ) : null
        })()}
        <LessonCard scope={scope} lesson={lesson} />
        <div className="h-16" />
      </div>

      {/* QC modal */}
      <Modal open={qcOpen} onClose={() => setQcOpen(false)} title="Auto-QC Report" wide>
        <div className="space-y-2.5">
          {scope.qc.map((q) => (
            <div key={q.name} className="flex items-start gap-3 rounded-xl border border-hairline bg-panel p-3.5">
              <Pill tone={q.status === 'pass' ? 'green' : q.status === 'flag' ? 'amber' : 'red'}>{q.status}</Pill>
              <div>
                <div className="text-[13px] font-semibold text-ink">{q.name}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{q.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* history modal */}
      <Modal open={histOpen} onClose={() => setHistOpen(false)} title="Version History" wide>
        <div className="space-y-0">
          {[...scope.history].reverse().map((h, i) => (
            <div key={i} className="relative border-l-2 border-hairline pb-5 pl-5 last:pb-0">
              <span className={`absolute top-1 -left-[5px] h-2 w-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-hairline-2'}`} />
              <div className="flex items-center gap-2.5">
                <Mono className="text-[12px] font-semibold text-ink">v{h.version}</Mono>
                <span className="text-[13px] font-semibold text-ink">{h.event}</span>
                <span className="text-[11.5px] text-ink-3">{h.date} · {h.actor}</span>
              </div>
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-2">{h.detail}</p>
            </div>
          ))}
          {scope.proposals.filter((p) => p.status === 'accepted').length > 0 && (
            <p className="mt-4 border-t border-hairline pt-3 text-[11.5px] text-ink-3">
              Accepted proposals carry their PerformanceReport and full iteration history on the RerunEvent. Prior versions are retained; every version is immutable.
            </p>
          )}
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Scope?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This removes <span className="font-semibold text-ink">{capsStandardCodes(scope.title)}</span> and its {scope.history.length} versions for every user ({set?.name}). This is the one non-versioned operation.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          <Btn kind="danger" onClick={() => { void deleteScope(scope.id).then((ok) => { if (ok) nav('/') }) }}>Delete</Btn>
        </div>
      </Modal>
    </div>
  )
}
