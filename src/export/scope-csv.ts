// CSV export for a scope — one row per lesson, with the card's data carried
// as JSON in the final column so downstream tooling can parse it directly.
// Clean like the Doc export: field contents, items, and exemplars — no
// citations, no decision records.
import { fieldMeta } from '../data/meta'
import type { Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'

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
  'lesson_json',
]

/**
 * RFC 4180 quoting (every cell quoted, inner quotes doubled) plus formula
 * neutralization: Excel and Sheets evaluate a cell beginning with = + - or @
 * even when quoted, so those get a leading apostrophe — the standard CSV
 * injection mitigation. lesson_json always starts with '{', so downstream
 * JSON parsing is unaffected.
 */
const cell = (value: string): string => {
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${neutralized.replace(/"/g, '""')}"`
}

export function buildScopeCsv(scope: Scope, sets: StandardSet[]): string {
  const scopeSetIds = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((st) => scopeSetIds.includes(st.id))
  const itemsById = new Map(scopeSets.flatMap((st) => st.items.map((it) => [it.id, it] as const)))

  const rows = [HEADER.map(cell).join(',')]
  for (const u of scope.units) {
    for (const l of u.lessons) {
      const fields: Record<string, string> = {}
      for (const fm of fieldMeta) fields[fm.key] = l.fields[fm.key].content
      // Item refs whose source set was deleted can no longer resolve — list
      // them explicitly so downstream tooling can tell "never had items" from
      // "items lost with their set".
      const unresolvedItemRefs = l.itemRefs.filter((rid) => !itemsById.has(rid))
      const exemplars = l.generatedExemplars ?? (l.generatedExemplar ? [l.generatedExemplar] : [])
      const lessonJson = {
        fields,
        releasedItems: l.itemRefs
          .map((rid) => itemsById.get(rid))
          .filter((it) => !!it)
          .map((it) => ({
            test: it.test,
            year: it.year,
            itemNumber: it.itemNumber,
            alignmentCode: it.alignmentCode,
            stem: it.stem,
            ...(it.choices ? { choices: it.choices } : {}),
          })),
        ...(unresolvedItemRefs.length > 0 ? { unresolvedItemRefs } : {}),
        ...(exemplars.length > 0 ? { generatedExemplars: exemplars } : {}),
      }
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
          JSON.stringify(lessonJson),
        ]
          .map(cell)
          .join(','),
      )
    }
  }
  return rows.join('\r\n')
}

/** Builds the CSV and hands it to the browser as a download. */
export function downloadScopeCsv(scope: Scope, sets: StandardSet[]): void {
  // BOM so Excel opens the UTF-8 content (em dashes, ≤, ×) correctly.
  const blob = new Blob(['﻿' + buildScopeCsv(scope, sets)], { type: 'text/csv;charset=utf-8' })
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
