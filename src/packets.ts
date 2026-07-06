// Evidence packet model — how each standard has been assessed across the
// released items of the selected sets, organized grade → domain → standard.
// Pure data assembly: the Evidence Packets page renders it and the Word
// export serializes it.
import type { ItemRecord, StandardNode, StandardSet } from './types'

export interface PacketStandard {
  setId: string
  gradeLabel: string
  domainCode: string
  domainLabel: string
  code: string
  norm: string
  wording: string
}

export interface PacketItem {
  setId: string
  item: ItemRecord
  standard: PacketStandard
}

/** Set-scoped key for a standard — bare codes collide across sets. */
export const standardKeyOf = (st: Pick<PacketStandard, 'setId' | 'code'>): string => `${st.setId}|${st.code}`

export interface PacketSelection {
  setIds: string[]
  /** Empty array = all. */
  domainCodes: string[]
  /** Set-scoped standard keys (standardKeyOf). Empty array = all. */
  standardKeys: string[]
  /** Empty array = all. */
  years: number[]
  title: string
}

export interface PacketSummaryRow {
  setId: string
  code: string
  gradeLabel: string
  itemCount: number
  sources: string[]
  years: number[]
  evidenceKinds: string[]
}

export interface PacketSection {
  setId: string
  setName: string
  gradeLabel: string
  standards: { standard: PacketStandard; items: PacketItem[] }[]
}

export interface PacketModel {
  title: string
  setNames: string[]
  filtersUsed: string
  stats: { items: number; standards: number; sources: number; yearSpan: string }
  summaryRows: PacketSummaryRow[]
  sections: PacketSection[]
  /** Selected standards with zero in-scope items — documentation gaps, listed honestly. */
  gaps: PacketStandard[]
  /** In-scope items whose alignment is ai-proposed (never official). */
  unconfirmed: PacketItem[]
}

/** Every most-granular content standard of a set, tagged with its grade and domain grouping. */
export function packetStandardsOf(set: StandardSet): PacketStandard[] {
  const out: PacketStandard[] = []
  const collect = (nodes: StandardNode[], domain: { code: string; label: string }) => {
    for (const n of nodes) {
      const isStandard = !!n.wording && (!n.children || n.children.length === 0)
      if (isStandard) {
        out.push({
          setId: set.id,
          gradeLabel: set.gradeSpan,
          domainCode: domain.code,
          domainLabel: domain.label,
          code: n.code,
          norm: n.norm,
          wording: n.wording ?? '',
        })
      }
      if (n.children && n.children.length > 0) collect(n.children, domain)
    }
  }
  // Domain level: a tree with a single wording-less root is grade-rooted —
  // its CHILDREN are the domains (NBT, OA, …); otherwise the roots themselves
  // are the domains. Treating the grade root as a domain collapses the whole
  // set into one "domain" chip.
  const roots = set.tree
  const domainNodes =
    roots.length === 1 && !roots[0].wording && (roots[0].children?.length ?? 0) > 0 ? roots[0].children! : roots
  for (const d of domainNodes) {
    collect([d], { code: d.code, label: d.label ?? d.code })
  }
  // Ingested trees are model-extracted and unvalidated — a code emitted under
  // two domains would otherwise duplicate its whole section downstream. First
  // occurrence wins.
  const seen = new Set<string>()
  return out.filter((st) => {
    if (seen.has(st.code)) return false
    seen.add(st.code)
    return true
  })
}

const keyOf = (code: string) => code.toUpperCase()

/** Items of a set resolved to their standards (by alignment code or norm). */
export function packetItemsOf(set: StandardSet, standards: PacketStandard[]): PacketItem[] {
  const byCode = new Map<string, PacketStandard>()
  for (const st of standards) {
    byCode.set(keyOf(st.code), st)
    byCode.set(keyOf(st.norm), st)
  }
  const out: PacketItem[] = []
  for (const item of set.items) {
    const standard = byCode.get(keyOf(item.alignmentCode))
    if (standard) out.push({ setId: set.id, item, standard })
  }
  return out
}

const evidenceKind = (item: ItemRecord): string =>
  item.itemType === 'constructed-response' ? 'constructed response' : item.itemType === 'multi-part' ? 'multi-part' : 'selected response'

export function buildPacketModel(sets: StandardSet[], selection: PacketSelection): PacketModel {
  const chosenSets = sets.filter((s) => selection.setIds.includes(s.id))
  const allStandards = chosenSets.flatMap(packetStandardsOf)
  const domainOk = (st: PacketStandard) =>
    selection.domainCodes.length === 0 || selection.domainCodes.includes(st.domainCode)
  const stdOk = (st: PacketStandard) =>
    selection.standardKeys.length === 0 || selection.standardKeys.includes(standardKeyOf(st))
  const selectedStandards = allStandards.filter((st) => domainOk(st) && stdOk(st))
  const selectedByKey = new Map(selectedStandards.map((st) => [standardKeyOf(st), st] as const))

  const yearOk = (item: ItemRecord) => selection.years.length === 0 || selection.years.includes(item.year)
  const items = chosenSets
    .flatMap((s) => packetItemsOf(s, selectedStandards.filter((st) => st.setId === s.id)))
    .filter((pi) => selectedByKey.has(`${pi.setId}|${pi.standard.code}`) && yearOk(pi.item))
    .sort((a, b) => a.standard.code.localeCompare(b.standard.code) || a.item.year - b.item.year || a.item.itemNumber - b.item.itemNumber)

  const itemsByStd = new Map<string, PacketItem[]>()
  for (const pi of items) {
    const k = `${pi.setId}|${pi.standard.code}`
    itemsByStd.set(k, [...(itemsByStd.get(k) ?? []), pi])
  }

  // Grade sections in set-selection order; standards in code order.
  const sections: PacketSection[] = []
  for (const set of chosenSets) {
    const stds = selectedStandards
      .filter((st) => st.setId === set.id)
      .sort((a, b) => a.domainCode.localeCompare(b.domainCode) || a.code.localeCompare(b.code))
      .map((standard) => ({ standard, items: itemsByStd.get(standardKeyOf(standard)) ?? [] }))
      .filter((entry) => entry.items.length > 0)
    if (stds.length > 0) sections.push({ setId: set.id, setName: set.name, gradeLabel: set.gradeSpan, standards: stds })
  }

  const summaryRows: PacketSummaryRow[] = sections.flatMap((sec) =>
    sec.standards.map(({ standard, items: sItems }) => ({
      setId: sec.setId,
      code: standard.code,
      gradeLabel: sec.gradeLabel,
      itemCount: sItems.length,
      sources: [...new Set(sItems.map((pi) => pi.item.test))],
      years: [...new Set(sItems.map((pi) => pi.item.year))].sort((a, b) => a - b),
      evidenceKinds: [...new Set(sItems.map((pi) => evidenceKind(pi.item)))],
    })),
  )

  const gaps = selectedStandards
    .filter((st) => (itemsByStd.get(standardKeyOf(st)) ?? []).length === 0)
    .sort((a, b) => a.code.localeCompare(b.code))
  const unconfirmed = items.filter((pi) => pi.item.confidence === 'ai-proposed')

  const sources = new Set(items.map((pi) => pi.item.test))
  const years = [...new Set(items.map((pi) => pi.item.year))].sort((a, b) => a - b)
  const yearSpan = years.length === 0 ? '—' : years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`
  const filterParts: string[] = [chosenSets.map((s) => s.name).join(' + ')]
  filterParts.push(selection.domainCodes.length === 0 ? 'all domains' : `${selection.domainCodes.length} domain(s)`)
  filterParts.push(selection.standardKeys.length === 0 ? 'all standards' : `${selection.standardKeys.length} standard(s)`)
  filterParts.push(selection.years.length === 0 ? 'all years' : selection.years.join(', '))

  return {
    title: selection.title.trim() || 'Mathematics Evidence Packet',
    setNames: chosenSets.map((s) => s.name),
    filtersUsed: filterParts.join(' · '),
    stats: {
      items: items.length,
      standards: sections.reduce((n, s) => n + s.standards.length, 0),
      sources: sources.size,
      yearSpan,
    },
    summaryRows,
    sections,
    gaps,
    unconfirmed,
  }
}

// Dev-only hook for end-to-end verification from the preview browser.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__buildPacketModel = buildPacketModel
}
