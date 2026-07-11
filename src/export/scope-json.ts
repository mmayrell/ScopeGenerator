// JSON export for a scope — the canonical machine-readable version, shaped as
// a course-operation envelope so every JSON the tool downloads (scope
// generator exports and Lesson Scope Generation run outputs) follows one
// schema: { courseOperation, targetCourse, lessons[] }. A scope export is
// always a full course creation, so courseOperation is "CREATE", every lesson
// carries operation "CREATE" with lessonId/deactivationReason null (the
// platform assigns lessonIds on persist). Lesson Scope Edits runs download
// their own output, where each lesson states CREATE | UPDATE | DEACTIVATE.
// Released items are represented as structured references in text form —
// metadata (source, year, item number, aligned standard) plus a persistent
// screenshot URL (long-lived read-only SAS links minted by the backend);
// generated exemplars carry their full text since no hosted asset exists for
// them. Decision Records are human-readable artifacts and are NOT included.
import { api } from '../api'
import { scopeCardContext, splitStandards } from '../data/meta'
import type { CardField, EvidencePacket, Lesson, LsgOutput, LsgOutputLesson, Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'
import { resolveScopeItems, scopeImageItems, type ResolvedScopeItem } from './scope-csv'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const content = (f: CardField | undefined): string => (f?.content ?? '').trim()

/** Same slug rule as the backend course registry (api/src/data/lsg.ts) — the same course name always yields the same courseId. */
function courseIdFromName(courseName: string): string {
  const slug = courseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled-course'
}

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

/** All released-item references and exemplars as one string (blank line between entries) per the schema. */
function releasedItemsText(l: Lesson, itemsById: Map<string, ResolvedScopeItem>, imageLinks: Record<string, string>): string {
  const entries = l.itemRefs
    .map((rid) => itemsById.get(rid))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .map((entry) => releasedItemLine(entry, imageLinks))
  const blocks = [...entries, ...exemplarLines(l)]
  // Neither resolved items nor exemplars: the field's own content states the
  // situation (never empty per the card rules).
  return (blocks.length > 0 ? blocks : [content(l.fields.releasedItems)].filter(Boolean)).join('\n\n')
}

// ---------------------------------------------------------------------------
// Assembly — the course-operation envelope
// ---------------------------------------------------------------------------

export function buildScopeJson(
  scope: Scope,
  sets: StandardSet[],
  imageLinks: Record<string, string> = {},
  packet?: EvidencePacket,
): LsgOutput {
  const itemsById = resolveScopeItems(scope, sets, packet)
  const { subject, course, standardSet, prefixFor } = scopeCardContext(scope, sets)
  const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const gradeSpan = sets.find((s) => ids.includes(s.id))?.gradeSpan ?? ''
  const grade = (gradeSpan.match(/\d+/) ?? course.match(/\d+/) ?? [''])[0]
  // lessonOrder counts through the whole course, not within each unit.
  let courseLessonNumber = 0
  const lessons = scope.units.flatMap((u) =>
    u.lessons.map((l): LsgOutputLesson => {
      courseLessonNumber += 1
      const f = l.fields
      // standardId is forced into canonical <Standard Set Prefix>.<Standard Code> format.
      const { standardId } = splitStandards(content(f.standards), prefixFor)
      return {
        lessonId: null,
        operation: 'CREATE',
        unitName: u.title,
        lessonOrder: courseLessonNumber,
        standardId,
        // The JSON is the student-facing deliverable: the student-friendly
        // title stands in for the engineering title (older scopes without
        // the field fall back).
        lessonTitle: (l.studentFriendlyTitle ?? '').trim() || l.title,
        deactivationReason: null,
        objectives: content(f.objectives),
        assessmentBoundary: content(f.boundary),
        difficultyCeiling: content(f.ceiling),
        prerequisites: content(f.prerequisites),
        progressionPlacement: content(f.progression),
        newLearning: content(f.newLearning),
        instructionalApproach: content(f.approach),
        nonGoals: content(f.nonGoals),
        assessmentEvidence: content(f.assessment),
        releasedItems: releasedItemsText(l, itemsById, imageLinks),
      }
    }),
  )
  return {
    courseOperation: 'CREATE',
    targetCourse: {
      courseId: courseIdFromName(course),
      courseName: course,
      grade,
      subject,
      standardSet,
    },
    lessons,
  }
}

/** Serializes a value and hands it to the browser as a .json download. */
export function saveJsonFile(name: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Fetches the screenshot links, builds the JSON, and hands it to the browser as a download. */
export async function downloadScopeJson(scope: Scope, sets: StandardSet[], packet?: EvidencePacket): Promise<void> {
  const pairs = scopeImageItems(scope, sets, packet)
  const { links } = pairs.length > 0 ? await api.itemImageLinks(pairs) : { links: {} }
  saveJsonFile(capsStandardCodes(scope.title), buildScopeJson(scope, sets, links, packet))
}
