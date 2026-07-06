import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import {
  buildPacketModel,
  packetItemsOf,
  packetStandardsOf,
  standardKeyOf,
  type PacketModel,
  type PacketSelection,
} from '../packets'
import { useStore } from '../store'
import { Btn, capsStandardCodes, ItemShot, Mono, Pill, SectionLabel } from '../ui'

// Evidence Packets — how each standard has been assessed across the released
// items of the selected sets. Stepped builder (sets → domains → standards →
// years → title) over the evidence corpus, an on-page packet preview, and a
// Word download that converts cleanly to a Google Doc.

const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      on ? 'border-accent/40 bg-accent-wash text-accent-deep' : 'border-hairline bg-panel text-ink-2 hover:border-hairline-2'
    }`}
  >
    {children}
  </button>
)

// The four frameworks the repository organizes around. A published set files
// under one of them by its declared identity (scheme, source organization,
// name); everything not recognizably state-specific is pure Common Core.
const FRAMEWORKS = [
  { id: 'ccss', label: 'Pure Common Core' },
  { id: 'teks', label: 'Texas (TEKS)' },
  { id: 'sol', label: 'Virginia (SOL)' },
  { id: 'best', label: 'Florida B.E.S.T.' },
] as const
type FrameworkId = (typeof FRAMEWORKS)[number]['id']

const frameworkOf = (set: { name: string; codingScheme: string; codingNotes: string; sourceOrganization?: string }): FrameworkId => {
  const hay = `${set.name} ${set.codingScheme} ${set.codingNotes} ${set.sourceOrganization ?? ''}`.toLowerCase()
  if (/teks|texas|staar|§?\s*111\./.test(hay)) return 'teks'
  if (/\bsol\b|virginia/.test(hay)) return 'sol'
  if (/b\.?e\.?s\.?t\b|florida|ma\.k12/.test(hay)) return 'best'
  return 'ccss'
}

const gradeOrder = (g: string): number => {
  const m = /(\d+)/.exec(g)
  return m ? Number(m[1]) : /k/i.test(g) ? 0 : 99
}

export default function EvidencePackets() {
  const { sets } = useStore()
  const published = useMemo(() => sets.filter((s) => s.published), [sets])
  const [framework, setFramework] = useState<FrameworkId>('ccss')
  const [grades, setGrades] = useState<string[]>([])
  const [domainCodes, setDomainCodes] = useState<string[]>([])
  const [standardKeys, setStandardKeys] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [packet, setPacket] = useState<PacketModel | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const frameworkSets = useMemo(() => published.filter((s) => frameworkOf(s) === framework), [published, framework])
  const availableGrades = useMemo(
    () => [...new Set(frameworkSets.map((s) => s.gradeSpan))].sort((a, b) => gradeOrder(a) - gradeOrder(b)),
    [frameworkSets],
  )
  // Default to the first grade the framework offers; prune grades whose sets
  // disappeared (unpublish) so they can't linger as invisible filters.
  useEffect(() => {
    setGrades((prev) => {
      const visible = new Set(availableGrades)
      const pruned = prev.filter((g) => visible.has(g))
      if (pruned.length > 0) return pruned.length === prev.length ? prev : pruned
      return availableGrades.length > 0 ? [availableGrades[0]] : []
    })
  }, [availableGrades])

  const setIds = useMemo(
    () => frameworkSets.filter((s) => grades.includes(s.gradeSpan)).map((s) => s.id),
    [frameworkSets, grades],
  )
  const chosenSets = useMemo(() => published.filter((s) => setIds.includes(s.id)), [published, setIds])
  const allStandards = useMemo(() => chosenSets.flatMap(packetStandardsOf), [chosenSets])
  const domains = useMemo(() => {
    const seen = new Map<string, string>()
    for (const st of allStandards) if (!seen.has(st.domainCode)) seen.set(st.domainCode, st.domainLabel)
    return [...seen.entries()].map(([code, label]) => ({ code, label }))
  }, [allStandards])
  const domainFiltered = useMemo(
    () => allStandards.filter((st) => domainCodes.length === 0 || domainCodes.includes(st.domainCode)),
    [allStandards, domainCodes],
  )
  const availableYears = useMemo(() => {
    const inScope = new Set(domainFiltered.filter((st) => standardKeys.length === 0 || standardKeys.includes(standardKeyOf(st))).map(standardKeyOf))
    const ys = new Set<number>()
    for (const set of chosenSets) {
      for (const pi of packetItemsOf(set, domainFiltered.filter((st) => st.setId === set.id))) {
        if (inScope.has(`${pi.setId}|${pi.standard.code}`)) ys.add(pi.item.year)
      }
    }
    return [...ys].sort((a, b) => a - b)
  }, [chosenSets, domainFiltered, standardKeys])

  // Narrowing domains/standards can shrink the year list — prune selections
  // whose chip no longer renders, or they become invisible, un-clearable
  // filters that silently empty the packet.
  useEffect(() => {
    setYears((prev) => {
      const visible = new Set(availableYears)
      const pruned = prev.filter((y) => visible.has(y))
      return pruned.length === prev.length ? prev : pruned
    })
  }, [availableYears])

  const selection: PacketSelection = { setIds, domainCodes, standardKeys, years, title }
  const preview = useMemo(() => buildPacketModel(published, selection), [published, setIds, domainCodes, standardKeys, years, title]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const exportDoc = async () => {
    if (!packet) return
    setExporting(true)
    setExportError(null)
    try {
      const { downloadPacketDocx } = await import('../export/packet-docx')
      await downloadPacketDocx(packet)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not build the document.')
    } finally {
      setExporting(false)
    }
  }

  // ---------- packet preview ----------
  if (packet) {
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <div className="flex items-center justify-between gap-3">
          <Btn onClick={() => setPacket(null)}>← Back to builder</Btn>
          <span className="text-[12px] text-ink-3">
            {packet.stats.items} items · {packet.stats.standards} standards · {packet.stats.yearSpan}
          </span>
          <Btn kind="primary" disabled={exporting} onClick={() => void exportDoc()}>
            {exporting ? 'Preparing…' : 'Download Doc'}
          </Btn>
        </div>
        {exportError && (
          <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{exportError}</div>
        )}

        {/* cover */}
        <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
          <SectionLabel>Released Item Repository</SectionLabel>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(packet.title)}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            How each standard has been assessed across the released items in the evidence corpus — organized by grade
            and standard, with item screenshots, metadata, and alignment evidence.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [packet.stats.items, 'Assessment items'],
              [packet.stats.standards, 'Standards'],
              [packet.stats.sources, 'Sources'],
              [packet.stats.yearSpan, 'Administration years'],
            ].map(([v, l]) => (
              <div key={String(l)} className="rounded-xl border border-hairline bg-paper/60 px-3.5 py-2.5">
                <div className="font-display text-[20px] font-semibold text-ink">{v}</div>
                <div className="text-[11px] text-ink-3">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
            Selection scope: {packet.filtersUsed}. Item images are screenshots of official released materials as
            uploaded to the evidence corpus. Alignments marked ai-proposed are model-generated and are never official.
          </p>
        </div>

        {/* coverage summary */}
        <div className="mt-8">
          <SectionLabel>Coverage Summary</SectionLabel>
          {packet.summaryRows.length === 0 && (
            <p className="mt-2 rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
              No released-item evidence in the current selection — the standards below are documentation gaps.
            </p>
          )}
          {packet.summaryRows.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-hairline bg-paper/60 text-[10.5px] tracking-wide text-ink-3 uppercase">
                  <th className="px-3.5 py-2 font-semibold">Standard</th>
                  <th className="px-3 py-2 font-semibold">Grade</th>
                  <th className="px-3 py-2 font-semibold">Items</th>
                  <th className="px-3 py-2 font-semibold">Sources</th>
                  <th className="px-3 py-2 font-semibold">Years</th>
                  <th className="px-3 py-2 font-semibold">Evidence Types</th>
                </tr>
              </thead>
              <tbody>
                {packet.summaryRows.map((r) => (
                  <tr key={`${r.setId}-${r.code}`} className="border-b border-hairline last:border-0">
                    <td className="px-3.5 py-2"><Mono className="text-ink">{r.code}</Mono></td>
                    <td className="px-3 py-2 text-ink-2">{r.gradeLabel}</td>
                    <td className="px-3 py-2 text-ink-2">{r.itemCount}</td>
                    <td className="px-3 py-2 text-ink-2">{r.sources.join(', ')}</td>
                    <td className="px-3 py-2 text-ink-2">{r.years.join(', ')}</td>
                    <td className="px-3 py-2 text-ink-2">{r.evidenceKinds.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {packet.gaps.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3">
              <div className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">
                Standards With No Released-Item Evidence
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
                Documentation gaps, not unimportance: {packet.gaps.map((g) => g.code).join(', ')}
              </p>
            </div>
          )}
        </div>

        {/* grade sections */}
        {packet.sections.map((sec) => (
          <div key={sec.setId} className="mt-10">
            <div className="flex items-baseline justify-between border-b-2 border-ink/70 pb-1.5">
              <h2 className="font-display text-[20px] font-semibold text-ink">
                {sec.gradeLabel}
                {packet.sections.length > 1 && <span className="ml-2 text-[13px] font-normal text-ink-3">{sec.setName}</span>}
              </h2>
              <span className="text-[11.5px] text-ink-3">
                {sec.standards.length} standards · {sec.standards.reduce((n, s) => n + s.items.length, 0)} items
              </span>
            </div>
            {sec.standards.map(({ standard, items }) => (
              <div key={`${standard.setId}-${standard.code}`} className="mt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="rounded-md bg-night px-2 py-0.5 text-[11.5px] font-semibold text-white">{standard.code}</Mono>
                  <span className="text-[12px] text-ink-3">{standard.domainLabel}</span>
                  <Pill tone="neutral">{items.length} item{items.length === 1 ? '' : 's'}</Pill>
                </div>
                <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">{standard.wording}</p>
                <div className="mt-3 space-y-3">
                  {items.map((pi) => (
                    <div key={pi.item.id}>
                      <ItemShot
                        item={pi.item}
                        imageUrl={pi.item.imagePath ? api.itemImageUrl(pi.setId, pi.item.id) : undefined}
                      />
                      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
                        {pi.item.itemType} · {pi.item.responseFormat}
                        {pi.item.representations.length > 0 ? ` · ${pi.item.representations.join(', ')}` : ''}
                        {pi.item.hasKey ? ' · answer key available in the source document' : ''}
                        {pi.item.confidence === 'ai-proposed' ? ' · alignment ai-proposed (not official)' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {packet.unconfirmed.length > 0 && (
          <div className="mt-10 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3">
            <div className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">Items Without Confirmed Alignment</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
              {packet.unconfirmed.map((pi) => `${pi.item.test} ${pi.item.year} Q${pi.item.itemNumber} → ${pi.item.alignmentCode}`).join('; ')}
            </p>
          </div>
        )}
        <div className="h-16" />
      </div>
    )
  }

  // ---------- builder ----------
  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Evidence Packets</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Build a packet showing how each standard has been assessed across the released items in the evidence corpus —
        organized by grade and standard, with item screenshots, metadata, and alignment evidence.
      </p>

      <div className="mt-8 space-y-7">
        <div>
          <SectionLabel>Standard Set</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FRAMEWORKS.map((fw) => {
              const count = published.filter((s) => frameworkOf(s) === fw.id).length
              return (
                <Chip
                  key={fw.id}
                  on={framework === fw.id}
                  onClick={() => {
                    setFramework(fw.id)
                    setGrades([])
                    setDomainCodes([])
                    setStandardKeys([])
                    setYears([])
                  }}
                >
                  {fw.label}
                  {count > 0 && <span className="ml-1.5 text-[10.5px] opacity-60">{count}</span>}
                </Chip>
              )
            })}
          </div>
        </div>

        <div>
          <SectionLabel>Grade Level</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {availableGrades.map((g) => (
              <Chip key={g} on={grades.includes(g)} onClick={() => { setGrades((p) => toggle(p, g)); setDomainCodes([]); setStandardKeys([]); setYears([]) }}>
                {g}
              </Chip>
            ))}
            {availableGrades.length === 0 && (
              <p className="text-[12.5px] text-ink-3">
                No published sets for {FRAMEWORKS.find((f) => f.id === framework)?.label} yet — create and publish a
                standard set with this framework's documents to enable it.
              </p>
            )}
          </div>
        </div>

        <div>
          <SectionLabel>Domains</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">{domainCodes.length === 0 ? 'All domains included — narrow if needed.' : `${domainCodes.length} selected.`}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {domains.map((d) => {
              const labelCollides = domains.some((o) => o.code !== d.code && o.label === d.label)
              return (
                <Chip key={d.code} on={domainCodes.includes(d.code)} onClick={() => { setDomainCodes((p) => toggle(p, d.code)); setStandardKeys([]) }}>
                  {d.label}
                  {labelCollides && <Mono className="ml-1.5 text-[10px] opacity-60">{d.code}</Mono>}
                </Chip>
              )
            })}
            {domains.length === 0 && <p className="text-[12.5px] text-ink-3">Select a standard set to see its domains.</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Standards</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">{standardKeys.length === 0 ? 'All standards in the selected domains included.' : `${standardKeys.length} selected.`}</p>
          <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-hairline bg-panel/50 p-3">
            {domainFiltered.map((st) => (
              <Chip key={standardKeyOf(st)} on={standardKeys.includes(standardKeyOf(st))} onClick={() => setStandardKeys((p) => toggle(p, standardKeyOf(st)))}>
                <Mono className="text-[11px]">{st.code}</Mono>
              </Chip>
            ))}
            {domainFiltered.length === 0 && <p className="text-[12.5px] text-ink-3">Select a standard set to see its standards.</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Administration Years</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">{years.length === 0 ? 'All years included.' : `${years.length} selected.`}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {availableYears.map((y) => (
              <Chip key={y} on={years.includes(y)} onClick={() => setYears((p) => toggle(p, y))}>
                {y}
              </Chip>
            ))}
            {availableYears.length === 0 && <p className="text-[12.5px] text-ink-3">No released items in the current selection.</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Title</SectionLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mathematics Evidence Packet"
            className="mt-2 w-full max-w-md rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
        </div>

        <div className="flex items-center justify-between border-t border-hairline pt-5">
          <span className="text-[12.5px] text-ink-2">
            <span className="font-semibold text-ink">{preview.stats.items}</span> items ·{' '}
            <span className="font-semibold text-ink">{preview.stats.standards}</span> standards in scope
            {preview.gaps.length > 0 && <span className="text-ink-3"> · {preview.gaps.length} without items</span>}
          </span>
          <Btn kind="primary" disabled={preview.stats.items === 0 && preview.gaps.length === 0} onClick={() => setPacket(preview)}>
            Build packet
          </Btn>
        </div>
      </div>
    </div>
  )
}
