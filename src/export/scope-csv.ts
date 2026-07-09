// CSV export for a scope — one row per lesson, one column per card field
// (the 18-field card). Fields only, deliberately: no citations, no
// rationales, no decision records. Released items appear as hosted
// screenshot links (long-lived read-only SAS URLs minted by the backend) so
// anyone the spreadsheet is shared with can open the screenshots without
// holding the app access code. Items may come from the sets' item banks or
// from the scope's linked evidence packet (request.packetId) — packet lines
// also carry the original source URL.
import { api } from '../api'
import { cardContent, fieldMeta, scopeCardContext } from '../data/meta'
import type { EvidencePacket, HuntedItem, ItemRecord, Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'

// Field columns carry the EXACT on-card field labels (fieldMeta.label, e.g.
// "Assessment Boundary") — never shortened or re-cased keys, so downstream
// tooling always sees the same field names the app shows. Lesson title is
// card field 07, so it is not repeated as a metadata column.
const HEADER = [
  'scope_id',
  'scope_title',
  'scope_version',
  'unit_id',
  'unit_title',
  'strand',
  'lesson_id',
  'lesson_type',
  'evidence_status',
  ...fieldMeta.map((fm) => fm.label),
]

/**
 * RFC 4180 quoting (every cell quoted, inner quotes doubled) plus formula
 * neutralization: Excel and Sheets evaluate a cell beginning with = + - or @
 * even when quoted, so those get a leading apostrophe — the standard CSV
 * injection mitigation.
 */
const cell = (value: string): string => {
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${neutralized.replace(/"/g, '""')}"`
}

/** An itemRef resolved to its owner: a set's item bank or the linked packet. */
export type ResolvedScopeItem =
  | { kind: 'set'; setId: string; it: ItemRecord }
  | { kind: 'packet'; packetId: string; item: HuntedItem }

/** Every screenshot-bearing itemRef in the scope, as an image-links request entry. */
export function scopeImageItems(
  scope: Scope,
  sets: StandardSet[],
  packet?: EvidencePacket,
): { setId?: string; packetId?: string; itemId: string }[] {
  const itemsById = resolveScopeItems(scope, sets, packet)
  const pairs: { setId?: string; packetId?: string; itemId: string }[] = []
  const seen = new Set<string>()
  for (const u of scope.units) {
    for (const l of u.lessons) {
      for (const rid of l.itemRefs) {
        const entry = itemsById.get(rid)
        if (!entry || seen.has(rid)) continue
        seen.add(rid)
        if (entry.kind === 'set' && entry.it.imagePath) {
          pairs.push({ setId: entry.setId, itemId: entry.it.id })
        } else if (entry.kind === 'packet' && (entry.item.screenshotPaths?.length ?? 0) > 0) {
          pairs.push({ packetId: entry.packetId, itemId: entry.item.id })
        }
      }
    }
  }
  return pairs
}

/** Items resolve across every set the scope draws on plus the linked packet, keeping the owner id. */
export function resolveScopeItems(
  scope: Scope,
  sets: StandardSet[],
  packet?: EvidencePacket,
): Map<string, ResolvedScopeItem> {
  const scopeSetIds = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((st) => scopeSetIds.includes(st.id))
  const entries: (readonly [string, ResolvedScopeItem])[] = scopeSets.flatMap((st) =>
    st.items.map((it) => [it.id, { kind: 'set', setId: st.id, it } as const] as const),
  )
  for (const item of packet?.items ?? []) {
    entries.push([item.id, { kind: 'packet', packetId: packet!.id, item }])
  }
  return new Map(entries)
}

export function buildScopeCsv(
  scope: Scope,
  sets: StandardSet[],
  imageLinks: Record<string, string> = {},
  packet?: EvidencePacket,
): string {
  const itemsById = resolveScopeItems(scope, sets, packet)
  const ctx = scopeCardContext(scope, sets)

  const rows = [HEADER.map(cell).join(',')]
  for (const u of scope.units) {
    for (const l of u.lessons) {
      // released_items: one line per item — its identity plus the screenshot
      // link (packet items add the original source URL). Lessons with no
      // resolved items keep the field's content (which states the
      // generated-exemplar situation).
      const itemLines = l.itemRefs
        .map((rid) => itemsById.get(rid))
        .filter((entry) => !!entry)
        .map((entry) => {
          if (entry.kind === 'packet') {
            const { item } = entry
            const link = imageLinks[`${entry.packetId}/${item.id}`]
            const head = [item.program || item.sourceName, item.year > 0 ? String(item.year) : '', item.itemNumber ? `Q${item.itemNumber}` : '']
              .filter(Boolean)
              .join(' ')
            return `${head}${link ? `: ${link}` : ' (no screenshot available)'} — source: ${item.sourceUrl}`
          }
          const { it, setId } = entry
          const link = imageLinks[`${setId}/${it.id}`]
          return `${it.test} ${it.year} Q${it.itemNumber}${link ? `: ${link}` : ' (no screenshot available)'}`
        })
      const fieldCells = fieldMeta.map((fm) =>
        fm.key === 'releasedItems' && itemLines.length > 0 ? itemLines.join('\n') : cardContent(fm.key, l, ctx),
      )
      rows.push(
        [
          scope.id,
          capsStandardCodes(scope.title),
          `v${scope.version}`,
          u.id,
          u.title,
          u.strand,
          l.id,
          l.type,
          l.evidenceStatus,
          ...fieldCells,
        ]
          .map(cell)
          .join(','),
      )
    }
  }
  return rows.join('\r\n')
}

/** Fetches the screenshot links, builds the CSV, and hands it to the browser as a download. */
export async function downloadScopeCsv(scope: Scope, sets: StandardSet[], packet?: EvidencePacket): Promise<void> {
  const pairs = scopeImageItems(scope, sets, packet)
  const { links } = pairs.length > 0 ? await api.itemImageLinks(pairs) : { links: {} }
  // BOM so Excel opens the UTF-8 content (em dashes, ≤, ×) correctly.
  const blob = new Blob(['﻿' + buildScopeCsv(scope, sets, links, packet)], { type: 'text/csv;charset=utf-8' })
  const name = `${capsStandardCodes(scope.title).replace(/[\\/:*?"<>|]+/g, '-')}.csv`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Dev-only hook for end-to-end verification from the preview browser.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__buildScopeCsv = buildScopeCsv
}
