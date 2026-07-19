import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { cardContent, fieldMeta, scopeCardContext } from '../data/meta'
import { huntedToItemRecord } from '../packets'
import { scopeUnsettled, useScopePolling, useStore } from '../store'
import type { Citation, DecisionEntry, DecisionField, EvidencePacket, Lesson, Scope } from '../types'
import { breakNumberedList, Btn, capsStandardCodes, citationSourceLabel, CiteChips, GeneratedShot, ItemShot, Modal, Mono, Pill } from '../ui'
import DependencyMap from './DependencyMap'

const typeTone: Record<Lesson['type'], { label: string; tone: 'accent' | 'cite' | 'night' | 'green' | 'amber' }> = {
  'stein-exact': { label: 'stein-exact atom', tone: 'green' },
  'new-learning': { label: 'new-learning atom', tone: 'accent' },
  'test-rigor': { label: 'test-rigor atom', tone: 'amber' },
  bridge: { label: 'bridge', tone: 'night' },
  'application-tier': { label: 'application tier', tone: 'cite' },
  // Legacy types — scopes generated under Engine ≤ v4.2 only.
  preskill: { label: 'preskill', tone: 'amber' },
  representation: { label: 'representation', tone: 'green' },
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

// Scopes generated before decisions carried a `field` tag: place each entry by
// what its type governs; everything lesson-wide settles at the card level.
const legacyDecisionField: Record<DecisionEntry['type'], DecisionField> = {
  granularity: 'card',
  strategy: 'approach',
  boundary: 'boundary',
  ceiling: 'ceiling',
  contradiction: 'card',
  override: 'card',
  assumption: 'card',
}

/** One decision entry — the numbered row inside a black record band. */
function DecisionRow({ d }: { d: DecisionEntry }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[10.5px] font-semibold text-white/80">{d.n}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-white/90">{decisionLabel[d.type]}</span>
          <span className="rounded-[5px] border border-white/15 bg-white/5 px-1.5 py-px font-mono text-[10px] text-white/60">{d.rule}</span>
          {d.flags?.map((fl) => (
            <span key={fl} className="rounded-[5px] border border-amber-ink/40 bg-amber-ink/20 px-1.5 py-px font-mono text-[10px] text-amber-wash">{fl}</span>
          ))}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-white/75">
          {d.text}
          {/* hover a citation to read the exact sentences that drove the decision */}
          <CiteChips citations={d.citations} dark />
        </p>
      </div>
    </div>
  )
}

/** Full citation list inside an expanded decision record — every citation visible with its excerpt, no hover needed. */
function CitationList({ citations }: { citations: Citation[] }) {
  // One entry per source, like CiteChips: a duplicate label reads as an error.
  const unique = citations.filter((c, i) => citations.findIndex((o) => o.label === c.label) === i)
  if (unique.length === 0) return null
  return (
    <div className="space-y-2">
      {unique.map((c, i) => (
        <div key={i} className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[5px] border border-white/15 bg-white/5 px-1.5 py-px font-mono text-[10px] text-white/60">
              {citationSourceLabel(c.sourceType)}
            </span>
            <span className="text-[12px] font-medium text-white/85">{c.label}</span>
            <Mono className="ml-auto text-[10px] text-white/40">{c.locator}</Mono>
          </div>
          <p className="mt-1.5 border-l-2 border-white/15 pl-2.5 font-display text-[12.5px] leading-relaxed text-white/70 italic">{c.excerpt}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * The black record band under each field — collapsed to a single row until
 * clicked, then the full why: the rationale prose, every citation in full,
 * and the field's logged decision entries.
 */
function DecisionRecord({
  title,
  purpose,
  rationale,
  narratives = [],
  citations,
  entries,
  expectRationale = false,
}: {
  title: string
  purpose: string
  rationale?: string
  /** Labeled lesson-level narratives (sequencing / granularity) — rendered before citations and entries. */
  narratives?: { label: string; text: string }[]
  citations: Citation[]
  entries: DecisionEntry[]
  /** Per-field records explain a missing rationale (pre-rationale scopes); the lesson-level record never has one. */
  expectRationale?: boolean
}) {
  const [open, setOpen] = useState(false)
  const uniqueCites = citations.filter((c, i) => citations.findIndex((o) => o.label === c.label) === i)
  const shownNarratives = narratives.filter((nv) => nv.text.trim().length > 0)
  const empty = !rationale && shownNarratives.length === 0 && uniqueCites.length === 0 && entries.length === 0
  const counts = [
    uniqueCites.length > 0 ? `${uniqueCites.length} citation${uniqueCites.length === 1 ? '' : 's'}` : null,
    entries.length > 0 ? `${entries.length} decision${entries.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="border-b border-hairline bg-night last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-6 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          className={`shrink-0 text-white/50 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.08em] text-white/85 uppercase">{title}</span>
        <span className="hidden truncate text-[10.5px] text-white/40 sm:inline">{purpose}</span>
        {counts && <Mono className="ml-auto shrink-0 pl-2 text-[10px] text-white/45">{counts}</Mono>}
      </button>
      {open && (
        <div className="animate-rise space-y-4 px-6 pt-1 pb-5">
          {rationale && <p className="max-w-3xl text-[13px] leading-relaxed whitespace-pre-line text-white/80">{rationale}</p>}
          {shownNarratives.map((nv) => (
            <div key={nv.label} className="max-w-3xl">
              <div className="text-[10.5px] font-semibold tracking-[0.08em] text-white/50 uppercase">{nv.label}</div>
              <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-white/80">{nv.text}</p>
            </div>
          ))}
          {!rationale && expectRationale && !empty && (
            <p className="text-[12px] leading-relaxed text-white/50">
              No narrative rationale on this field — this scope predates per-field rationales; the citations and decisions below still carry the record.
            </p>
          )}
          {empty && <p className="text-[12px] leading-relaxed text-white/50">Nothing recorded.</p>}
          <CitationList citations={citations} />
          {entries.length > 0 && (
            <div className="space-y-3.5">
              {entries.map((d) => (
                <DecisionRow key={d.n} d={d} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// One bullet per prerequisite: new scopes emit one per line; legacy scopes
// packed them into semicolon-separated prose.
const prerequisiteItems = (content: string): string[] => {
  const lines = content
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const items = lines.length > 1 ? lines : lines.flatMap((line) => line.split(/;\s+/))
  return items.map((s) => s.trim()).filter(Boolean)
}

// ---------- the 18-field card ----------

function LessonCard({ scope, lesson, lessonNumber, packet }: { scope: Scope; lesson: Lesson; lessonNumber: number; packet?: EvidencePacket }) {
  const { sets } = useStore()
  // Items resolve across every set the scope draws on (multi-select) plus the
  // linked evidence packet — each entry carries its own image URL (set items
  // via /item-image, packet items via /packet-item-image).
  const itemsById = useMemo(() => {
    const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
    const scopeSets = sets.filter((st) => ids.includes(st.id))
    const entries = scopeSets.flatMap((st) =>
      st.items.map(
        (it) =>
          [it.id, { it, imageUrl: it.imagePath ? api.itemImageUrl(st.id, it.id) : undefined }] as const,
      ),
    )
    const packetEntries = (packet?.items ?? []).map(
      (h) =>
        [
          h.id,
          {
            it: huntedToItemRecord(h),
            imageUrl:
              h.screenshotPaths && h.screenshotPaths.length > 0
                ? api.packetItemImageUrl(packet!.id, h.id, 1)
                : undefined,
          },
        ] as const,
    )
    return new Map([...entries, ...packetEntries])
  }, [sets, scope.setIds, scope.setId, packet])
  const tt = typeTone[lesson.type]

  // Each field's record renders directly under it; lesson-level calls
  // (granularity, type, sequencing) close the card. Cluster is no longer a
  // card field (18-field spec), so cluster-tagged entries join the
  // lesson-level record rather than disappearing.
  const decisionsByField = useMemo(() => {
    const map = new Map<DecisionField, DecisionEntry[]>()
    for (const d of lesson.decisions) {
      const raw: DecisionField = d.field ?? legacyDecisionField[d.type] ?? 'card'
      const f: DecisionField = raw === 'cluster' ? 'card' : raw
      map.set(f, [...(map.get(f) ?? []), d])
    }
    return map
  }, [lesson.decisions])

  // Header fields 01–03 derive from the scope's standard set(s).
  const ctx = useMemo(() => scopeCardContext(scope, sets), [scope, sets])

  return (
    <article className="animate-rise" key={lesson.id}>
      {/* card header */}
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Mono className="rounded-md bg-night px-2 py-0.5 text-[11.5px] font-semibold text-white">Lesson {lessonNumber}</Mono>
            <Mono className="rounded-md border border-hairline bg-paper px-2 py-0.5 text-[11.5px] text-ink-3">{lesson.id}</Mono>
            <Pill tone={tt.tone}>{tt.label}</Pill>
            <Pill tone={lesson.evidenceStatus === 'observed' ? 'green' : lesson.evidenceStatus === 'inferred' ? 'amber' : 'neutral'}>
              evidence: {lesson.evidenceStatus}
            </Pill>
          </div>
          <h2 className="mt-2.5 max-w-2xl font-display text-[24px] leading-snug font-semibold tracking-tight text-ink">{lesson.title}</h2>
        </div>
      </header>

      {/* fields 01–19, each backed field followed by its own decision record */}
      <div className="mt-7 overflow-hidden rounded-2xl border border-hairline bg-panel shadow-(--shadow-lift)">
        {fieldMeta.map((fm) => {
          // Derived header fields (Subject, Course, Standard Set, Standard ID,
          // Lesson Title) have no stored field of their own; the record of a
          // backed field renders beneath it. Scopes generated before a field
          // existed (e.g. Objectives) lack it.
          const record = fm.record ? lesson.fields[fm.record] : undefined
          const content = cardContent(fm.key, lesson, ctx) || '—'
          const fieldDecisions = fm.record ? decisionsByField.get(fm.record) : undefined
          return (
            <Fragment key={fm.key}>
            <section className="group grid grid-cols-1 gap-2 border-b border-hairline px-6 py-4.5 last:border-0 hover:bg-paper/40 xl:grid-cols-[200px_1fr] xl:gap-6">
              <div className="pt-0.5">
                <div className="flex items-baseline gap-2">
                  <Mono className="text-[10.5px] text-ink-3">{String(fm.n).padStart(2, '0')}</Mono>
                  <span className="text-[12.5px] leading-snug font-semibold text-ink">{fm.label}</span>
                </div>
                <div className="mt-1 text-[11px] leading-snug text-ink-3">{fm.purpose}</div>
                {record?.inferred && <div className="mt-1.5"><Pill tone="amber">inferred — P5</Pill></div>}
              </div>
              <div className="min-w-0">
                {/* Citations live in the field's decision record below, keeping the content clean. */}
                {fm.key === 'prerequisites' ? (
                  <ul className="space-y-1.5">
                    {prerequisiteItems(content).map((p, i) => (
                      <li key={i} className="flex items-start gap-2.5 font-display text-[14px] leading-relaxed text-ink">
                        <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  /* whitespace-pre-line renders the enumeration breaks from breakNumberedList */
                  <p className="font-display text-[14px] leading-relaxed whitespace-pre-line text-ink">
                    {breakNumberedList(content)}
                  </p>
                )}
                {fm.key === 'releasedItems' && (
                  <div className="mt-4 space-y-3">
                    {lesson.itemRefs.map((rid) => {
                      const entry = itemsById.get(rid)
                      // Never fail silently: an unresolved ref (deleted set or
                      // packet, stale data) renders as an explicit gap so the
                      // prose above never claims items the reader cannot see.
                      return entry ? (
                        <ItemShot key={rid} item={entry.it} imageUrl={entry.imageUrl} />
                      ) : (
                        <div key={rid} className="rounded-xl border border-dashed border-hairline-2 bg-paper/60 px-4 py-3">
                          <p className="text-[12px] leading-relaxed text-ink-3">
                            A released item is attached here (<Mono className="text-[11px]">{rid}</Mono>) but its record
                            could not be loaded — its source set or evidence packet may have been deleted.
                          </p>
                        </div>
                      )
                    })}
                    {(lesson.generatedExemplars ?? (lesson.generatedExemplar ? [lesson.generatedExemplar] : [])).map(
                      (ex, i) => (
                        <GeneratedShot
                          key={i}
                          stem={ex.stem}
                          answer={ex.answer}
                          demandProfile={ex.demandProfile}
                          basis={ex.basis}
                          choices={ex.choices}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            </section>
            {fm.record && (
              <DecisionRecord
                title="Decision Record"
                purpose={`Why ${fm.label} reads the way it does`}
                rationale={record?.rationale}
                citations={record?.citations ?? []}
                entries={fieldDecisions ?? []}
                expectRationale
              />
            )}
            </Fragment>
          )
        })}

        {/* lesson-level decision record — granularity/type/sequencing, plus any
            entry not tied to a single field (legacy scopes route contradictions,
            overrides, and assumptions here too) */}
        <DecisionRecord
          title="Lesson Decision Record"
          purpose="Calls that shape the whole card — unit ordering, lesson granularity, lesson type, and any decision not tied to a single field"
          narratives={[
            { label: 'Why This Unit Order & Lesson Position', text: lesson.sequencingRationale ?? '' },
            { label: 'Why This Granularity — Not More, Not Less', text: lesson.granularityRationale ?? '' },
          ]}
          citations={[]}
          entries={decisionsByField.get('card') ?? []}
        />
      </div>
    </article>
  )
}

// ---------- page ----------

export default function ScopeView() {
  const { id } = useParams()
  const { scopes, sets, deleteScope, createScope, refreshScope, refreshSet } = useStore()
  const nav = useNavigate()
  const scope = scopes.find((s) => s.id === id)
  const [sel, setSel] = useState<string | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [genAction, setGenAction] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const [lookedUp, setLookedUp] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // The linked evidence packet (released-items source), fetched once — its
  // hunted items resolve the scope's packet itemRefs for rendering/exports.
  const [packet, setPacket] = useState<EvidencePacket | undefined>(undefined)
  const packetId = scope?.request.packetId
  useEffect(() => {
    if (!packetId) return
    let cancelled = false
    void api
      .getPacket(packetId)
      .then((p) => {
        if (!cancelled) setPacket(p)
      })
      .catch(() => {
        /* packet deleted after scope creation — items degrade to unresolved refs */
      })
    return () => {
      cancelled = true
    }
  }, [packetId])

  // Download CSV: one row per lesson, one column per field plus a trailing
  // scoping_rationale column (the lesson's granularity/scoping decisions with
  // their cited evidence), released items as hosted screenshot links.
  // Fetching those links is a network round-trip, hence the Preparing state.
  const exportCsv = async () => {
    if (!scope) return
    setExporting('csv')
    setExportError(null)
    try {
      const { downloadScopeCsv } = await import('../export/scope-csv')
      await downloadScopeCsv(scope, sets, packet)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not build the CSV.')
    } finally {
      setExporting(null)
    }
  }

  // Download JSON: the canonical machine-readable scope — the course-operation
  // envelope ({ courseOperation, targetCourse, lessons[] }, every lesson
  // operation CREATE), released items as structured references with
  // persistent screenshot URLs.
  const exportJson = async () => {
    if (!scope) return
    setExporting('json')
    setExportError(null)
    try {
      const { downloadScopeJson } = await import('../export/scope-json')
      await downloadScopeJson(scope, sets, packet)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not build the JSON export.')
    } finally {
      setExporting(null)
    }
  }

  // While the scope is generating (initial run, rerun, apply-proposal) or a proposal is
  // drafting/iterating, poll its document every 2s until it settles.
  useScopePolling(scope && scopeUnsettled(scope) ? [scope.id] : [])

  // Released items are extracted onto the SET documents lazily, during the
  // scope's own generation — a set copy loaded at bootstrap (before or during
  // that run) has no item records, so every itemRef would silently resolve to
  // nothing and the Released Items screenshots would not render. Re-pull the
  // scope's sets once the scope is viewable as complete.
  const scopeStatus = scope?.status
  const scopeSetKey = scope ? (scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]).join('|') : ''
  useEffect(() => {
    if (scopeStatus !== 'complete' || !scopeSetKey) return
    for (const setId of scopeSetKey.split('|')) void refreshSet(setId)
  }, [scopeStatus, scopeSetKey, refreshSet])

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
            <Link to="/scopes" className="text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Curriculum Scopes</Link>
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
          // Carry the FULL request — dropping the uploads token would
          // regenerate a topic scope without its released-question PDFs
          // (the blobs still exist under the token; deleteScopeDocs skips a
          // token another scope still references), and dropping packetId would
          // regenerate without the linked repository's released items.
          const newId = await createScope(
            scope.setIds?.length ? scope.setIds : [scope.setId],
            scope.request.mode,
            scope.request.params,
            scope.request.courseName ?? '',
            scope.request.subject ?? '',
            scope.request.uploadsToken
              ? { token: scope.request.uploadsToken, names: scope.request.uploadNames ?? [] }
              : undefined,
            scope.request.packetId,
            scope.request.baselineSetId,
          )
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
            <Link to="/scopes" className="text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Curriculum Scopes</Link>
            <div className="flex gap-2">
              <Btn kind="danger" onClick={() => { void deleteScope(scope.id).then((ok) => { if (ok) nav('/scopes') }) }}>Delete scope</Btn>
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
          <Link to="/scopes" className="mt-3 inline-block text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Curriculum Scopes</Link>
        </div>
      </div>
    )
  }
  const lesson = allLessons.find((l) => l.id === sel) ?? allLessons[0]
  // Lessons are numbered through the whole course (not restarting per unit).
  const courseLessonNumber = new Map(allLessons.map((l, i) => [l.id, i + 1]))
  return (
    <div className="flex h-full">
      {/* unit / lesson rail */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-hairline bg-panel/60 px-4 py-6 xl:w-80">
        <Link to="/scopes" className="px-2 text-[12px] font-medium text-ink-3 hover:text-accent-deep">← Curriculum Scopes</Link>
        <h1 className="mt-2 px-2 font-display text-[17px] leading-snug font-semibold text-ink">{capsStandardCodes(scope.title)}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-2">
          {scope.request.packetId && <Pill tone="cite">repository items</Pill>}
          {scope.proposals.some((p) => p.working || p.status === 'drafting') && (
            <Pill tone="accent">
              <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" /> proposal drafting
            </Pill>
          )}
        </div>
        <div className="mt-1.5 px-2 font-mono text-[10px] leading-relaxed text-ink-3">
          {scope.engineVersion.split(' (')[0]} · {(scope.doctrineVersions[0] ?? '—').split(' (')[0]}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 px-2">
          <Btn kind="night" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setMapOpen(true)}>Dependency Map</Btn>
          <Btn className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setHistOpen(true)}>History</Btn>
          <Btn className="!px-2.5 !py-1 !text-[11.5px]" disabled={exporting !== null} onClick={() => void exportCsv()}>
            {exporting === 'csv' ? 'Preparing…' : 'Download CSV'}
          </Btn>
          <Btn className="!px-2.5 !py-1 !text-[11.5px]" disabled={exporting !== null} onClick={() => void exportJson()}>
            {exporting === 'json' ? 'Preparing…' : 'Download JSON'}
          </Btn>
          <Btn kind="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setConfirmDelete(true)}>Delete</Btn>
        </div>
        {exportError && (
          <p className="mt-2 px-2 text-[11px] leading-snug text-rust">{exportError}</p>
        )}

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
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      lesson.id === l.id ? 'bg-accent-wash text-accent-deep' : 'text-ink-2 hover:bg-ink/[0.035]'
                    }`}
                  >
                    <Mono className={`shrink-0 text-[10.5px] leading-snug ${lesson.id === l.id ? 'text-accent-deep' : 'text-ink-3'}`}>L{courseLessonNumber.get(l.id)}</Mono>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug font-medium">{l.title}</span>
                    <span className="mt-1 ml-auto flex shrink-0 items-center gap-1">
                      {l.type === 'stein-exact' && <span className="h-1.5 w-1.5 rounded-full bg-verdant" title="stein-exact" />}
                      {l.type === 'test-rigor' && <span className="h-1.5 w-1.5 rounded-full border border-amber-ink" title="test rigor" />}
                      {l.type === 'preskill' && <span className="h-1.5 w-1.5 rounded-full border border-amber-ink" title="preskill (legacy type)" />}
                      {l.type === 'representation' && <span className="h-1.5 w-1.5 rounded-full bg-verdant" title="representation (legacy type)" />}
                      {l.type === 'bridge' && <span className="h-1.5 w-1.5 rounded-full bg-night" title="bridge" />}
                      {l.type === 'application-tier' && <span className="h-1.5 w-1.5 rounded-full bg-cite" title="application tier" />}
                      {l.evidenceStatus !== 'observed' && <span className="h-1.5 w-1.5 rounded-full bg-amber-ink" title="inferred evidence" />}
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
        {/* unit heading */}
        {(() => {
          const unit = scope.units.find((u) => u.lessons.some((l) => l.id === lesson.id))
          if (!unit) return null
          const n = /(\d+)/.exec(unit.id)?.[1] ?? unit.id
          return (
            <h1 className="mb-6 font-display text-[30px] leading-tight font-semibold tracking-tight text-ink">
              Unit {n}: {unit.title}
            </h1>
          )
        })()}
        <LessonCard scope={scope} lesson={lesson} lessonNumber={courseLessonNumber.get(lesson.id) ?? 1} packet={packet} />
        <div className="h-16" />
      </div>

      {/* dependency map — full-screen coherence webs */}
      {mapOpen && <DependencyMap scope={scope} onClose={() => setMapOpen(false)} />}

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
          <Btn kind="danger" onClick={() => { void deleteScope(scope.id).then((ok) => { if (ok) nav('/scopes') }) }}>Delete</Btn>
        </div>
      </Modal>
    </div>
  )
}
