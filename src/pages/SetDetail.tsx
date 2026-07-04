import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useStore } from '../store'
import { Btn, ItemShot, Mono, Pill, SectionLabel } from '../ui'
import type { ArtifactRole, ItemRecord, StandardNode } from '../types'

const roleLabel: Record<ArtifactRole, string> = {
  standards: 'Official standards document',
  items: 'Released items',
  'unpacking-structured': 'Unpacking — structured decomposition',
  'unpacking-narrative': 'Unpacking — narrative',
  progression: 'Progressions / vertical alignment',
}

const tabs = ['Configuration', 'Artifacts', 'Standards Tree', 'Item Bank', 'Alignment Queue', 'Lexicons'] as const

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

function ItemGroup({ code, items, wording }: { code: string; items: ItemRecord[]; wording?: string }) {
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
            <ItemShot key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SetDetail() {
  const { id } = useParams()
  const { sets, acknowledgeWarning, confirmAlignment, resolveArtifact, publishSet } = useStore()
  const [tab, setTab] = useState<(typeof tabs)[number]>('Configuration')
  const set = sets.find((s) => s.id === id)
  if (!set) return <div className="p-10 text-ink-3">Standard set not found.</div>

  const blocking = set.artifacts.filter((a) => a.reviewStatus === 'blocked')
  const unack = set.warnings.filter((w) => !w.acknowledged)
  const aiQueue = set.items.filter((it) => it.confidence === 'ai-proposed')
  const canPublish = blocking.length === 0 && unack.length === 0

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
        {!set.published && (
          <Btn kind="primary" disabled={!canPublish} onClick={() => publishSet(set.id)}>Publish set</Btn>
        )}
      </div>

      {/* coverage warnings */}
      {set.warnings.length > 0 && (
        <div className="mt-6 space-y-2">
          {set.warnings.map((w) => (
            <div
              key={w.id}
              className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 ${
                w.acknowledged ? 'border-hairline bg-panel' : 'border-amber-ink/25 bg-amber-wash'
              }`}
            >
              <div className="flex items-center gap-2.5 text-[12.5px]">
                <span className={`font-mono text-[10px] font-semibold uppercase ${w.acknowledged ? 'text-ink-3' : 'text-amber-ink'}`}>
                  {w.acknowledged ? 'acknowledged' : 'coverage gap'}
                </span>
                <span className={w.acknowledged ? 'text-ink-3' : 'text-amber-ink'}>{w.text}</span>
              </div>
              {!w.acknowledged && (
                <Btn onClick={() => acknowledgeWarning(set.id, w.id)}>Acknowledge</Btn>
              )}
            </div>
          ))}
          {set.warnings.some((w) => w.acknowledged) && (
            <p className="px-1 text-[11.5px] text-ink-3">
              Acknowledged gaps drive anticipated-evidence inference downstream (D1) and are surfaced to users whenever a scope request lands inside one.
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
                {a.meta?.sourceDescription && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
                    <span>{a.meta.sourceDescription}</span>
                    {a.meta.window && <span>window {a.meta.window}</span>}
                    {a.meta.coverage && (
                      <span>
                        coverage: <Mono className={a.meta.coverage === 'census' ? 'text-verdant' : 'text-amber-ink'}>{a.meta.coverage}</Mono>{' '}
                        <span className="text-ink-3">(weights D1 inference)</span>
                      </span>
                    )}
                    {a.meta.itemCount && <span>{a.meta.itemCount} items</span>}
                    {a.meta.domainGradeTags && <span>tags: {a.meta.domainGradeTags.join(', ')}</span>}
                  </div>
                )}
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
            <div className="mb-1 flex items-center justify-between">
              <SectionLabel>Parsed Standards — Limits Visible, Wording Verbatim</SectionLabel>
              <span className="text-[11.5px] text-ink-3">Dual coding: canonical ID + normalized join code</span>
            </div>
            <p className="mb-3 text-[11.5px] leading-relaxed text-ink-3">
              Content standards only — every most-granular standard is listed with its exact text. Practice, process,
              and implementation standards (Mathematical Practices, TEKS process standards, and similar framework-wide
              expectations) are excluded at ingestion.
            </p>
            {set.tree.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-3">No standards parsed yet.</p>
            ) : (
              set.tree.map((n) => <TreeNode key={n.code} node={n} depth={0} />)
            )}
          </div>
        )}

        {tab === 'Item Bank' && (
          <div className="max-w-4xl">
            {set.items.length === 0 ? (
              <p className="py-6 text-[13px] text-ink-3">No items ingested.</p>
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
                      <span className="shrink-0 text-[10.5px] text-ink-3">{t.source}</span>
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
