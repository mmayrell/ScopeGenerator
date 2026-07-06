// Evidence Packets — a standalone web-hunting tool. Selection comes from the
// built-in standards catalog (src/data/packet-catalog.ts, loaded lazily) and a
// backend agent searches the public web for genuine released items. Nothing
// here touches standard sets or scopes.
import type { EvidencePacket, HuntedItem, PacketFramework, PacketStandard } from './types'

/** One catalog row — a PacketStandard tagged with its framework. */
export interface CatalogStandard extends PacketStandard {
  framework: PacketFramework
}

/**
 * Administration years with genuine released/sample grade 3–8 math materials
 * per framework — AI-researched against the official sources (NYSED/MCAS,
 * TEA, VDOE, FLDOE releases) and adversarially cross-checked per year.
 * Policy: only the past ten years, and never before 2017. 2020 is absent
 * everywhere (COVID cancellations — no releases exist).
 */
export const FRAMEWORKS: { key: PacketFramework; label: string; blurb: string; years: number[] }[] = [
  {
    key: 'ccss',
    label: 'Pure Common Core',
    blurb: 'CCSS-M · full SBAC sample-item bank, NY State, MCAS, Ohio, and California released materials',
    years: [2026, 2025, 2024, 2023, 2022, 2021, 2019, 2018, 2017],
  },
  {
    key: 'teks',
    label: 'Texas (TEKS)',
    blurb: 'STAAR released tests (TEA; redesigned 2023)',
    years: [2025, 2024, 2023, 2022, 2021, 2019, 2018, 2017],
  },
  {
    key: 'sol',
    label: 'Virginia (SOL)',
    blurb: '2023 standards · VDOE practice item sets (no full released tests since 2014)',
    years: [2025, 2018],
  },
  {
    key: 'best',
    label: 'Florida B.E.S.T.',
    blurb: 'FAST released tests and sample items (first administration spring 2023)',
    years: [2026, 2025, 2024, 2023],
  },
]

export const frameworkLabelOf = (key: PacketFramework): string =>
  FRAMEWORKS.find((f) => f.key === key)?.label ?? key.toUpperCase()

/** Released-item years available for a framework (never before 2017; at most the past ten years). */
export const yearsOf = (key: PacketFramework): number[] => FRAMEWORKS.find((f) => f.key === key)?.years ?? []

/** Grade options are fixed: grades 3 through 8. */
export const GRADE_RANGE = [3, 4, 5, 6, 7, 8]

/** Domains of a framework across the chosen grades, in catalog order. */
export function domainsOf(
  catalog: CatalogStandard[],
  framework: PacketFramework,
  grades: number[],
): { code: string; name: string; count: number }[] {
  const out: { code: string; name: string; count: number }[] = []
  const index = new Map<string, number>()
  for (const st of catalog) {
    if (st.framework !== framework || !grades.includes(st.grade)) continue
    const at = index.get(st.domain)
    if (at === undefined) {
      index.set(st.domain, out.length)
      out.push({ code: st.domain, name: st.domainName, count: 1 })
    } else {
      out[at].count++
    }
  }
  return out
}

/** Catalog standards matching the selection, in grade → code order (clearest in the flat picker). */
export function standardsOf(
  catalog: CatalogStandard[],
  framework: PacketFramework,
  grades: number[],
  domainCodes: string[],
): CatalogStandard[] {
  return catalog
    .filter(
      (st) =>
        st.framework === framework &&
        grades.includes(st.grade) &&
        (domainCodes.length === 0 || domainCodes.includes(st.domain)),
    )
    .sort((a, b) => a.grade - b.grade || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

// ---------------------------------------------------------------------------
// Coverage model for a hunted packet — rendered by the page and the Word export.
// ---------------------------------------------------------------------------

export interface PacketCoverageRow {
  standard: PacketStandard
  items: HuntedItem[]
  programs: string[]
  years: number[]
}

export interface PacketSection {
  grade: number
  domainName: string
  rows: PacketCoverageRow[]
}

export interface PacketCoverage {
  /** Grade → domain sections, standards in code order; only standards with items. */
  sections: PacketSection[]
  summaryRows: PacketCoverageRow[]
  /** Standards the agent found no released evidence for — documentation gaps. */
  gaps: PacketStandard[]
  /** Items whose alignment the agent inferred (never official). */
  unconfirmed: HuntedItem[]
  stats: { items: number; standardsCovered: number; standardsTotal: number; sources: number; yearSpan: string }
}

export function packetCoverageOf(packet: EvidencePacket): PacketCoverage {
  const byCode = new Map<string, HuntedItem[]>()
  for (const item of packet.items) {
    byCode.set(item.standardCode, [...(byCode.get(item.standardCode) ?? []), item])
  }
  for (const items of byCode.values()) {
    items.sort((a, b) => b.year - a.year || a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }))
  }

  const standards = packet.standards
    .slice()
    .sort(
      (a, b) =>
        a.grade - b.grade ||
        a.domain.localeCompare(b.domain) ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    )

  const rowOf = (standard: PacketStandard): PacketCoverageRow => {
    const items = byCode.get(standard.code) ?? []
    return {
      standard,
      items,
      programs: [...new Set(items.map((i) => i.program).filter(Boolean))],
      years: [...new Set(items.map((i) => i.year).filter((y) => y > 0))].sort((a, b) => a - b),
    }
  }

  const sections: PacketSection[] = []
  for (const st of standards) {
    const row = rowOf(st)
    if (row.items.length === 0) continue
    const last = sections[sections.length - 1]
    if (last && last.grade === st.grade && last.domainName === st.domainName) last.rows.push(row)
    else sections.push({ grade: st.grade, domainName: st.domainName, rows: [row] })
  }

  const summaryRows = sections.flatMap((s) => s.rows)
  const gaps = standards.filter((st) => (byCode.get(st.code) ?? []).length === 0)
  const unconfirmed = packet.items.filter((i) => i.alignment === 'ai-inferred')
  const sources = new Set(packet.items.map((i) => i.sourceUrl))
  const years = [...new Set(packet.items.map((i) => i.year).filter((y) => y > 0))].sort((a, b) => a - b)
  const yearSpan =
    years.length === 0 ? '—' : years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`

  return {
    sections,
    summaryRows,
    gaps,
    unconfirmed,
    stats: {
      items: packet.items.length,
      standardsCovered: summaryRows.length,
      standardsTotal: packet.standards.length,
      sources: sources.size,
      yearSpan,
    },
  }
}

/** Choice letter for facsimile rendering: 0 → 'A'. */
export const choiceLetter = (i: number): string => String.fromCharCode(65 + i)
