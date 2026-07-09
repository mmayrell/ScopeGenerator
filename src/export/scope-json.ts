// JSON export for a scope — the canonical machine-readable version per the
// No-HITL spec ("Exporting the Scope"): ONE FLAT OBJECT PER LESSON CARD, every
// field a plain string. The export contains the fields that define the
// instructional scope and is intended for the downstream curriculum
// generation tools. Released items are represented as structured references
// in text form — metadata (source, year, item number, aligned standard)
// plus a persistent screenshot URL (long-lived read-only SAS links minted by
// the backend); generated exemplars carry their full text since no hosted
// asset exists for them. Decision Records are human-readable artifacts and
// are NOT included.
import { api } from '../api'
import { scopeCardContext, splitStandards } from '../data/meta'
import type { CardField, EvidencePacket, Lesson, Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'
import { resolveScopeItems, scopeImageItems, type ResolvedScopeItem } from './scope-csv'

// ---------------------------------------------------------------------------
// Export shape (spec "JSON Schema") — one object per lesson card
// ---------------------------------------------------------------------------

export interface ScopeLessonJson {
  subject: string
  course: string
  standardSet: string
  standardId: string
  standardDescription: string
  substandard: string
  lessonTitle: string
  objectives: string
  majorSupporting: string
  progressionPlacement: string
  prerequisites: string
  assessmentBoundary: string
  newLearning: string
  instructionalApproach: string
  nonGoals: string
  difficultyCeiling: string
  assessmentEvidence: string
  releasedItems: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const content = (f: CardField | undefined): string => (f?.content ?? '').trim()

/** One released-item reference line: metadata + persistent screenshot URL (+ source URL for packet items). */
function releasedItemLine(entry: ResolvedScopeItem, imageLinks: Record<string, string>): string {
  if (entry.kind === 'packet') {
    const { item } = entry
    const link = imageLinks[`${entry.packetId}/${item.id}`]
    return [
      [item.program || item.sourceName, item.year > 0 ? String(item.year) : '', item.itemNumber ? `Q${item.itemNumber}` : '']
        .filter(Boolean)
        .join(' · '),
      `aligned: ${item.standardCode} (${item.alignment === 'official' ? 'Official' : 'AI Inferred'})`,
      link ? `screenshot: ${link}` : 'no screenshot available',
      item.sourceUrl ? `source: ${item.sourceUrl}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const { it, setId } = entry
  const link = imageLinks[`${setId}/${it.id}`]
  return [
    `${it.test} · ${it.year} · Q${it.itemNumber}`,
    `aligned: ${it.alignmentCode} (${it.confidence === 'official' ? 'Official' : 'AI Inferred'})`,
    link ? `screenshot: ${link}` : 'no screenshot available',
  ].join(' · ')
}

/** Generated exemplars carry their full question text — no hosted asset exists for them. */
function exemplarLines(l: Lesson): string[] {
  const exemplars = l.generatedExemplars ?? (l.generatedExemplar ? [l.generatedExemplar] : [])
  return exemplars.map((ex) =>
    [
      'Generated exemplar — not a released item:',
      ex.stem,
      ...(ex.choices ?? []).filter((c) => c.trim()).map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`),
      ex.answer ? `Answer: ${ex.answer}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

function releasedItemsText(l: Lesson, itemsById: Map<string, ResolvedScopeItem>, imageLinks: Record<string, string>): string {
  const entries = l.itemRefs
    .map((rid) => itemsById.get(rid))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .map((entry) => releasedItemLine(entry, imageLinks))
  const blocks = [...entries, ...exemplarLines(l)]
  // Neither resolved items nor exemplars: the field's own content states the
  // situation (never empty per the card rules).
  return blocks.length > 0 ? blocks.join('\n\n') : content(l.fields.releasedItems)
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildScopeJson(
  scope: Scope,
  sets: StandardSet[],
  imageLinks: Record<string, string> = {},
  packet?: EvidencePacket,
): ScopeLessonJson[] {
  const itemsById = resolveScopeItems(scope, sets, packet)
  // Spec example: subject "Math", course "Grade 4 Mathematics", standardSet "CCSS".
  const { subject, course, standardSet } = scopeCardContext(scope, sets)
  return scope.units.flatMap((u) =>
    u.lessons.map((l): ScopeLessonJson => {
      const f = l.fields
      const { standardId, standardDescription } = splitStandards(content(f.standards))
      return {
        subject,
        course,
        standardSet,
        standardId,
        standardDescription,
        substandard: content(f.substandard),
        lessonTitle: l.title,
        objectives: content(f.objectives),
        majorSupporting: content(f.emphasis),
        progressionPlacement: content(f.progression),
        prerequisites: content(f.prerequisites),
        assessmentBoundary: content(f.boundary),
        newLearning: content(f.newLearning),
        instructionalApproach: content(f.approach),
        nonGoals: content(f.nonGoals),
        difficultyCeiling: content(f.ceiling),
        assessmentEvidence: content(f.assessment),
        releasedItems: releasedItemsText(l, itemsById, imageLinks),
      }
    }),
  )
}

/** Fetches the screenshot links, builds the JSON, and hands it to the browser as a download. */
export async function downloadScopeJson(scope: Scope, sets: StandardSet[], packet?: EvidencePacket): Promise<void> {
  const pairs = scopeImageItems(scope, sets, packet)
  const { links } = pairs.length > 0 ? await api.itemImageLinks(pairs) : { links: {} }
  const json = JSON.stringify(buildScopeJson(scope, sets, links, packet), null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const name = `${capsStandardCodes(scope.title).replace(/[\\/:*?"<>|]+/g, '-')}.json`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
