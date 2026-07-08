// CSV export for a scope — one row per lesson, one column per card field.
// Fields only, deliberately: no citations, no rationales, no decision records.
// Released items appear as hosted screenshot links (long-lived read-only SAS
// URLs minted by the backend) so anyone the spreadsheet is shared with can
// open the screenshots without holding the app access code.
import { api } from '../api'
import { fieldMeta } from '../data/meta'
import type { Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'

// Field columns carry the EXACT on-card field labels (fieldMeta.label, e.g.
// "Assessment Boundary") — never shortened or re-cased keys, so downstream
// tooling always sees the same field names the app shows.
const HEADER = [
  'scope_id',
  'scope_title',
  'scope_version',
  'unit_id',
  'unit_title',
  'strand',
  'lesson_id',
  'lesson_title',
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

/** Every (setId, itemId) pair in the scope that has a screenshot to link. */
export function scopeImageItems(scope: Scope, sets: StandardSet[]): { setId: string; itemId: string }[] {
  const itemsById = resolveItems(scope, sets)
  const pairs: { setId: string; itemId: string }[] = []
  const seen = new Set<string>()
  for (const u of scope.units) {
    for (const l of u.lessons) {
      for (const rid of l.itemRefs) {
        const entry = itemsById.get(rid)
        if (!entry || !entry.it.imagePath || seen.has(rid)) continue
        seen.add(rid)
        pairs.push({ setId: entry.setId, itemId: entry.it.id })
      }
    }
  }
  return pairs
}

/** Items resolve across every set the scope draws on, keeping the owning set id. */
function resolveItems(scope: Scope, sets: StandardSet[]) {
  const scopeSetIds = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((st) => scopeSetIds.includes(st.id))
  return new Map(scopeSets.flatMap((st) => st.items.map((it) => [it.id, { it, setId: st.id }] as const)))
}

export function buildScopeCsv(
  scope: Scope,
  sets: StandardSet[],
  imageLinks: Record<string, string> = {},
): string {
  const itemsById = resolveItems(scope, sets)

  const rows = [HEADER.map(cell).join(',')]
  for (const u of scope.units) {
    for (const l of u.lessons) {
      // released_items: one line per item — its identity plus the screenshot
      // link. Lessons with no resolved items keep the field's content (which
      // states the generated-exemplar situation).
      const itemLines = l.itemRefs
        .map((rid) => itemsById.get(rid))
        .filter((entry) => !!entry)
        .map(({ it, setId }) => {
          const link = imageLinks[`${setId}/${it.id}`]
          return `${it.test} ${it.year} Q${it.itemNumber}${link ? `: ${link}` : ' (no screenshot available)'}`
        })
      const fieldCells = fieldMeta.map((fm) =>
        fm.key === 'releasedItems' && itemLines.length > 0
          ? itemLines.join('\n')
          : (l.fields[fm.key]?.content ?? ''),
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
          l.title,
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
export async function downloadScopeCsv(scope: Scope, sets: StandardSet[]): Promise<void> {
  const pairs = scopeImageItems(scope, sets)
  const { links } = pairs.length > 0 ? await api.itemImageLinks(pairs) : { links: {} }
  // BOM so Excel opens the UTF-8 content (em dashes, ≤, ×) correctly.
  const blob = new Blob(['﻿' + buildScopeCsv(scope, sets, links)], { type: 'text/csv;charset=utf-8' })
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
