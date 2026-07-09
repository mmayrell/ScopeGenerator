// JSON export for a scope — the canonical machine-readable version per the
// spec ("Exporting the Scope"): one structured object per lesson card, fields
// only (Decision Records are human-readable artifacts and are not included).
// Released items are structured references with persistent screenshot URLs
// (long-lived read-only SAS links minted by the backend); items from the
// scope's linked evidence packet also carry itemUrl — the original source
// document. Generated exemplars carry their full text since no hosted asset
// exists for them.
import { api } from '../api'
import type { CardField, EvidencePacket, Lesson, Scope, StandardSet, Unit } from '../types'
import { capsStandardCodes } from '../ui'
import { resolveScopeItems, scopeImageItems, type ResolvedScopeItem } from './scope-csv'

// ---------------------------------------------------------------------------
// Export shape (spec §6 "JSON Schema")
// ---------------------------------------------------------------------------

export interface ScopeJsonExport {
  scopeId: string
  courseTitle: string
  frameworks: string[]
  subject: string
  grade: string
  version: string
  engineVersion: string
  doctrineVersions: string[]
  lessons: LessonJson[]
}

export interface LessonJson {
  lessonCode: string
  lessonTitle: string
  lessonType: 'new-learning atom' | 'bridge' | 'application tier'
  evidenceBadge: 'observed' | 'inferred' | 'mixed'
  unit: { unitCode: string; unitTitle: string }
  standardAlignments: { framework: string; standardId: string; standardDescription: string }[]
  cluster: { clusterId: string; clusterDescription: string }
  majorSupporting: 'major' | 'supporting' | 'not designated'
  atomizedObjective: string
  objectives: string[]
  progressionPlacement: { crossGradePlacement: string }
  prerequisites: {
    description: string
    type: 'taught-in-course' | 'prior-grade' | 'assumed'
    lessonCode: string | null
    lessonTitle: string | null
  }[]
  assessmentBoundary: {
    included: string[]
    excluded: { description: string; taughtInsteadInLessonCode: string | null; taughtInsteadInLessonTitle: string | null }[]
  }
  newLearning: { startCue: string; decisionPath: string; responseForm: string }
  instructionalApproach: {
    namedStrategy: string
    modelingPlan: {
      explicitlyModeledCases: string[]
      straightToPracticeCases: string[]
      whatVaries: string[]
      whatStaysConstant: string[]
    }
  }
  nonGoals: { description: string; reason: string; taughtInsteadInLessonCode: string | null; taughtInsteadInLessonTitle: string | null }[]
  difficultyCeiling: { description: string; parameters: string[] }
  assessmentEvidence: { statement: string; taskParameters: string[]; conditions: string[] }[]
  releasedItems: {
    evidenceType: 'released item' | 'generated exemplar'
    source: string
    assessment: string
    year: number | null
    itemNumber: string | null
    alignedStandard: string
    alignmentType: 'official' | 'AI-inferred' | 'generated'
    screenshotUrl: string | null
    itemUrl: string | null
    /** Full item text — filled for generated exemplars (no hosted asset exists). */
    itemText: string | null
  }[]
}

// ---------------------------------------------------------------------------
// Prose → structure helpers (best effort — card fields are authored prose)
// ---------------------------------------------------------------------------

const LESSON_REF = /U\d+\.L\d+[a-z]?/g
const CODE_SHAPE = /(?:[A-Z]{1,3}\.)?[0-9]+\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*(?:\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*)*/

const content = (f: CardField | undefined): string => (f?.content ?? '').trim()

/** Split list-shaped prose: newline-separated first, then numbered runs, then semicolons. */
function splitList(text: string): string[] {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length > 1) return lines.map(stripBullet)
  const numbered = text.split(/(?=\b\d{1,2}[.)]\s)/).map((s) => s.trim()).filter(Boolean)
  if (numbered.length > 1) return numbered.map(stripBullet)
  return text
    .split(/;\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(stripBullet)
}

const stripBullet = (s: string): string => s.replace(/^(?:\d{1,2}[.)]\s*|[-•·]\s*)/, '').trim()

/** First within-course lesson reference in a text, resolved to its title. */
function lessonRef(text: string, titles: Map<string, string>): { code: string | null; title: string | null } {
  const code = text.match(LESSON_REF)?.[0] ?? null
  return { code, title: code ? (titles.get(code) ?? null) : null }
}

function parsePrerequisites(text: string, titles: Map<string, string>): LessonJson['prerequisites'] {
  return splitList(text).map((line) => {
    const type = /taught[- ]in[- ]course/i.test(line)
      ? ('taught-in-course' as const)
      : /prior[- ]grade|previous grade|grade \d\b/i.test(line)
        ? ('prior-grade' as const)
        : ('assumed' as const)
    const ref = lessonRef(line, titles)
    return { description: line, type: ref.code && type === 'assumed' ? 'taught-in-course' : type, lessonCode: ref.code, lessonTitle: ref.title }
  })
}

function parseBoundary(text: string, titles: Map<string, string>): LessonJson['assessmentBoundary'] {
  const inc = /included?\s*:\s*([\s\S]*?)(?=\bexcluded?\s*:|$)/i.exec(text)?.[1] ?? ''
  const exc = /excluded?\s*:\s*([\s\S]*)$/i.exec(text)?.[1] ?? ''
  const included = inc ? splitList(inc) : exc ? [] : splitList(text)
  const excluded = splitList(exc).map((line) => {
    const ref = lessonRef(line, titles)
    return { description: line, taughtInsteadInLessonCode: ref.code, taughtInsteadInLessonTitle: ref.title }
  })
  return { included, excluded }
}

function parseNewLearning(text: string): LessonJson['newLearning'] {
  const startCue = /start cue\s*:\s*([\s\S]*?)(?=decision path\s*:|response form\s*:|$)/i.exec(text)?.[1]?.trim() ?? ''
  const decisionPath = /decision path\s*:\s*([\s\S]*?)(?=response form\s*:|$)/i.exec(text)?.[1]?.trim() ?? ''
  const responseForm = /response form\s*:\s*([\s\S]*)$/i.exec(text)?.[1]?.trim() ?? ''
  return startCue || decisionPath || responseForm
    ? { startCue, decisionPath, responseForm }
    : { startCue: text, decisionPath: '', responseForm: '' }
}

function parseApproach(text: string): LessonJson['instructionalApproach'] {
  const namedStrategy = /single strategy\s*:\s*([^.;\n]+)/i.exec(text)?.[1]?.trim() ?? ''
  const seg = (re: RegExp): string[] => {
    const m = re.exec(text)?.[1]?.trim()
    return m ? splitList(m) : []
  }
  const stops = String.raw`(?=\b(?:modeled explicitly|explicitly modeled|practice[- ]only|straight to practice|vary|hold constant|held constant)\s*:|$)`
  const explicitlyModeledCases = seg(new RegExp(String.raw`(?:modeled explicitly|explicitly modeled)\s*:\s*([\s\S]*?)${stops}`, 'i'))
  const straightToPracticeCases = seg(new RegExp(String.raw`(?:practice[- ]only|straight to practice)\s*:\s*([\s\S]*?)${stops}`, 'i'))
  const whatVaries = seg(new RegExp(String.raw`\bvary\s*:\s*([\s\S]*?)${stops}`, 'i'))
  const whatStaysConstant = seg(new RegExp(String.raw`\bhold(?:s)? constant\s*:\s*([\s\S]*?)${stops}`, 'i'))
  const parsedAny = explicitlyModeledCases.length + straightToPracticeCases.length + whatVaries.length + whatStaysConstant.length > 0
  return {
    namedStrategy,
    modelingPlan: parsedAny
      ? { explicitlyModeledCases, straightToPracticeCases, whatVaries, whatStaysConstant }
      : { explicitlyModeledCases: [text], straightToPracticeCases: [], whatVaries: [], whatStaysConstant: [] },
  }
}

function parseNonGoals(text: string, titles: Map<string, string>): LessonJson['nonGoals'] {
  return splitList(text).map((line) => {
    const ref = lessonRef(line, titles)
    return { description: line, reason: '', taughtInsteadInLessonCode: ref.code, taughtInsteadInLessonTitle: ref.title }
  })
}

function parseAssessmentEvidence(text: string): LessonJson['assessmentEvidence'] {
  const statements = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const merged = statements.length > 0 ? statements : [text]
  return merged.map((statement) => ({ statement, taskParameters: [], conditions: [] }))
}

function parseStandards(text: string, frameworks: string[]): LessonJson['standardAlignments'] {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const source = lines.length > 0 ? lines : [text]
  return source.map((line) => {
    const standardId = line.match(CODE_SHAPE)?.[0] ?? ''
    const standardDescription = line
      .replace(standardId, '')
      .replace(/^[\s—–\-:]+/, '')
      .trim()
    const framework = frameworks.find((f) => f && line.toLowerCase().includes(f.toLowerCase())) ?? frameworks[0] ?? ''
    return { framework, standardId, standardDescription }
  })
}

function majorSupporting(text: string): LessonJson['majorSupporting'] {
  if (/not designated/i.test(text)) return 'not designated'
  if (/\bmajor\b/i.test(text) && !/\bsupporting\b/i.test(text)) return 'major'
  if (/\bsupporting\b/i.test(text) && !/\bmajor\b/i.test(text)) return 'supporting'
  return 'not designated'
}

const LESSON_TYPE_LABEL: Record<Lesson['type'], LessonJson['lessonType']> = {
  'new-learning': 'new-learning atom',
  bridge: 'bridge',
  'application-tier': 'application tier',
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** One released-item export entry from a resolved itemRef (set bank or linked packet). */
function releasedItemJson(entry: ResolvedScopeItem, imageLinks: Record<string, string>): LessonJson['releasedItems'][number] {
  if (entry.kind === 'packet') {
    const { item } = entry
    return {
      evidenceType: 'released item' as const,
      source: item.sourceName || item.sourceUrl,
      assessment: item.program || item.sourceName,
      year: item.year || null,
      itemNumber: item.itemNumber || null,
      alignedStandard: item.standardCode,
      alignmentType: item.alignment === 'official' ? ('official' as const) : ('AI-inferred' as const),
      screenshotUrl: imageLinks[`${entry.packetId}/${item.id}`] ?? null,
      itemUrl: item.sourceUrl || null,
      itemText: item.stem || null,
    }
  }
  const { it, setId } = entry
  return {
    evidenceType: 'released item' as const,
    source: it.source,
    assessment: it.test,
    year: it.year || null,
    itemNumber: it.itemNumber ? String(it.itemNumber) : null,
    alignedStandard: it.alignmentCode,
    alignmentType: it.confidence === 'official' ? ('official' as const) : ('AI-inferred' as const),
    screenshotUrl: imageLinks[`${setId}/${it.id}`] ?? null,
    itemUrl: null,
    itemText: it.stem || null,
  }
}

function lessonJson(
  unit: Unit,
  l: Lesson,
  frameworks: string[],
  titles: Map<string, string>,
  itemsById: Map<string, ResolvedScopeItem>,
  imageLinks: Record<string, string>,
): LessonJson {
  const f = l.fields
  const releasedItems: LessonJson['releasedItems'] = l.itemRefs
    .map((rid) => itemsById.get(rid))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .map((entry) => releasedItemJson(entry, imageLinks))
  for (const ex of l.generatedExemplars ?? (l.generatedExemplar ? [l.generatedExemplar] : [])) {
    releasedItems.push({
      evidenceType: 'generated exemplar',
      source: 'Generated exemplar — not a released item',
      assessment: '',
      year: null,
      itemNumber: null,
      alignedStandard: parseStandards(content(f.standards), frameworks)[0]?.standardId ?? '',
      alignmentType: 'generated',
      screenshotUrl: null,
      itemUrl: null,
      itemText: [ex.stem, ...(ex.choices ?? []), ex.answer ? `Answer: ${ex.answer}` : ''].filter(Boolean).join('\n'),
    })
  }
  return {
    lessonCode: l.id,
    lessonTitle: l.title,
    lessonType: LESSON_TYPE_LABEL[l.type],
    evidenceBadge: l.evidenceStatus,
    unit: { unitCode: unit.id, unitTitle: unit.title },
    standardAlignments: parseStandards(content(f.standards), frameworks),
    cluster: { clusterId: '', clusterDescription: content(f.cluster) },
    majorSupporting: majorSupporting(content(f.emphasis)),
    atomizedObjective: content(f.substandard),
    objectives: splitList(content(f.objectives)),
    progressionPlacement: { crossGradePlacement: content(f.progression) },
    prerequisites: parsePrerequisites(content(f.prerequisites), titles),
    assessmentBoundary: parseBoundary(content(f.boundary), titles),
    newLearning: parseNewLearning(content(f.newLearning)),
    instructionalApproach: parseApproach(content(f.approach)),
    nonGoals: parseNonGoals(content(f.nonGoals), titles),
    difficultyCeiling: { description: content(f.ceiling), parameters: [] },
    assessmentEvidence: parseAssessmentEvidence(content(f.assessment)),
    releasedItems,
  }
}

export function buildScopeJson(
  scope: Scope,
  sets: StandardSet[],
  imageLinks: Record<string, string> = {},
  packet?: EvidencePacket,
): ScopeJsonExport {
  const scopeSetIds = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((st) => scopeSetIds.includes(st.id))
  const itemsById = resolveScopeItems(scope, sets, packet)
  const frameworks = scopeSets.map((s) => s.name)
  const titles = new Map(scope.units.flatMap((u) => u.lessons.map((l) => [l.id, l.title] as const)))
  return {
    scopeId: scope.id,
    courseTitle: capsStandardCodes(scope.title),
    frameworks,
    subject: scopeSets[0]?.subject ?? '',
    grade: scopeSets[0]?.gradeSpan ?? '',
    version: `v${scope.version}`,
    engineVersion: scope.engineVersion,
    doctrineVersions: scope.doctrineVersions,
    lessons: scope.units.flatMap((u) => u.lessons.map((l) => lessonJson(u, l, frameworks, titles, itemsById, imageLinks))),
  }
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
