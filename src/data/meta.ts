// Static UI/system metadata — not seed data. The app imports this at runtime;
// src/data/seed.ts stays reserved for the backend seed export. Framework
// names/versions mirror the fixed documents in api/src/data/framework.ts.
import type { Lesson, Scope, StandardNode, StandardSet, SystemArtifact } from '../types'
import { capsStandardCodes } from '../ui'

export const systemArtifacts: SystemArtifact[] = [
  { id: 'sys-engine', kind: 'engine', name: 'Lesson Granularity & Modeling Scope (v3 — No-HITL specification)', version: 'v3', published: '2026-07-08', note: 'Fixed with the tool. Split, don’t-split, integration-lesson, and modeling-scope rules for any standard set; full-standard atomization (P4) and no-evidence-is-not-no-lesson (P5).' },
  { id: 'sys-doctrine', kind: 'doctrine', name: 'Direct Instruction BrainLift (Stein et al. 2017)', version: 'v1.8', published: '2026-04-19', note: 'Controlling method authority. Stein-priority encoded in all doctrine prompts.' },
]

// ---------------------------------------------------------------------------
// The 18-field lesson card (No-HITL spec §6 "Reading a Lesson Card").
// Fields 01–03 and 07 are derived from scope/set metadata and the lesson
// title; 04–05 split the stored standards field ("<CODE> — <verbatim
// wording>") into id and description. The rest map 1:1 onto Lesson['fields'].
// Cluster remains in the data model (and in generation) but is not a card
// field under the current spec.
// ---------------------------------------------------------------------------

export type LessonFieldKey = keyof Lesson['fields']

export type CardKey =
  | LessonFieldKey
  | 'subject'
  | 'course'
  | 'standardSet'
  | 'standardId'
  | 'standardDescription'
  | 'lessonTitle'

export interface CardFieldMeta {
  key: CardKey
  n: number
  label: string
  purpose: string
  /**
   * The Lesson field whose decision record (rationale, citations, decision
   * entries) renders beneath this card row. Derived header fields carry none;
   * the standards field's record renders once, under Standard Description.
   */
  record?: LessonFieldKey
}

export const fieldMeta: CardFieldMeta[] = [
  { key: 'subject', n: 1, label: 'Subject', purpose: 'The academic content area of the generated scope' },
  { key: 'course', n: 2, label: 'Course', purpose: 'The course the scope is written for' },
  { key: 'standardSet', n: 3, label: 'Standard Set', purpose: 'Which standard set the scope is built from (e.g. CCSS, TEKS, combined)' },
  { key: 'standardId', n: 4, label: 'Standard ID', purpose: 'The standard identifier in canonical format (<Standard Set Prefix>.<Standard Code>), e.g. CCSS.MATH.CONTENT.4.NBT.B.5' },
  { key: 'standardDescription', n: 5, label: 'Standard Description', purpose: 'The official standard wording, verbatim', record: 'standards' },
  { key: 'substandard', n: 6, label: 'Substandard', purpose: 'The single teachable behavior this lesson is responsible for teaching', record: 'substandard' },
  { key: 'lessonTitle', n: 7, label: 'Lesson Title', purpose: 'The shortest verb-led title that names the atom this lesson teaches' },
  { key: 'objectives', n: 8, label: 'Objectives', purpose: 'The minimal-complete set of observable objectives that define mastery of this atom', record: 'objectives' },
  { key: 'emphasis', n: 9, label: 'Major / Supporting', purpose: 'Determines instructional weight in sequencing', record: 'emphasis' },
  { key: 'progression', n: 10, label: 'Progression Placement', purpose: 'Situates the atom in the vertical story', record: 'progression' },
  { key: 'prerequisites', n: 11, label: 'Prerequisites', purpose: 'What must already be secure before this lesson', record: 'prerequisites' },
  { key: 'boundary', n: 12, label: 'Assessment Boundary', purpose: 'The atom’s edges', record: 'boundary' },
  { key: 'newLearning', n: 13, label: 'New Learning', purpose: 'The one thing this lesson teaches', record: 'newLearning' },
  { key: 'approach', n: 14, label: 'Instructional Approach', purpose: 'How students are taught to do the problems', record: 'approach' },
  { key: 'nonGoals', n: 15, label: 'Non-Goals', purpose: 'Drift protection — what not to accidentally teach yet', record: 'nonGoals' },
  { key: 'ceiling', n: 16, label: 'Difficulty Ceiling', purpose: 'What “hard” can look like without leaving the grade', record: 'ceiling' },
  { key: 'assessment', n: 17, label: 'Assessment Evidence', purpose: 'What mastery looks like', record: 'assessment' },
  { key: 'releasedItems', n: 18, label: 'Released Items (If Applicable)', purpose: 'The empirical anchors — shown, not cited', record: 'releasedItems' },
]

// ---------------------------------------------------------------------------
// Derived-content resolution — shared by the card view, the CSV export, and
// the canonical JSON export so all three present the same 18 fields.
// ---------------------------------------------------------------------------

/** Card header values derived from the scope's request and standard set(s). */
export interface ScopeCardContext {
  subject: string
  course: string
  standardSet: string
  /** Canonical identifier prefix for a given standard code (its owning set's standardIdPrefix). */
  prefixFor: (code: string) => string
}

/** Collects every canonical/normalized code of a set's tree, uppercased. */
function treeCodes(nodes: StandardNode[], out: Set<string>): Set<string> {
  for (const n of nodes) {
    if (n.code) out.add(n.code.toUpperCase())
    if (n.norm) out.add(n.norm.toUpperCase())
    if (n.children) treeCodes(n.children, out)
  }
  return out
}

export function scopeCardContext(scope: Scope, sets: StandardSet[]): ScopeCardContext {
  const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((s) => ids.includes(s.id))
  // Subject and course come from the user's scope request; scopes created
  // before the fields existed fall back to the first set's metadata.
  const subject = scope.request.subject?.trim() || (scopeSets[0]?.subject ?? '')
  const course =
    scope.request.courseName?.trim() ||
    [scopeSets[0]?.gradeSpan ?? '', scopeSets[0]?.subject ?? ''].filter(Boolean).join(' ')
  // Union scopes mix frameworks: resolve each code's prefix through the set
  // whose tree owns it; codes not found fall back to the first set's prefix.
  const byCode = scopeSets.map((s) => ({ codes: treeCodes(s.tree, new Set<string>()), prefix: s.standardIdPrefix ?? '' }))
  const defaultPrefix = scopeSets[0]?.standardIdPrefix ?? ''
  return {
    subject,
    course,
    standardSet: scopeSets.map((s) => s.name).join(' + '),
    prefixFor: (code) => byCode.find((e) => e.codes.has(code.toUpperCase()))?.prefix ?? defaultPrefix,
  }
}

const CODE_SHAPE = /(?:[A-Z]{1,3}\.)?[0-9]+\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*(?:\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*)*/

/**
 * Forces the canonical identifier format <Standard Set Prefix>.<Standard Code>
 * (e.g. CCSS.MATH.CONTENT.4.NBT.B.5). Codes already carrying the prefix, and
 * sets that declare none, pass through unchanged.
 */
export function canonicalStandardId(code: string, prefixFor?: (code: string) => string): string {
  const prefix = prefixFor?.(code) ?? ''
  if (!prefix || code.toUpperCase().startsWith(`${prefix.toUpperCase()}.`)) return code
  return `${prefix}.${code}`
}

/**
 * The standards field is authored as "<CODE> — <verbatim wording>", one line
 * per aligned standard (union-mode merged lessons list several). Split it
 * into the id(s) and the wording(s); multiple alignments join with "; " for
 * ids and blank-line separation for wordings. Ids are forced into canonical
 * <Standard Set Prefix>.<Standard Code> format when prefixFor is supplied.
 */
export function splitStandards(
  text: string,
  prefixFor?: (code: string) => string,
): { standardId: string; standardDescription: string } {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const source = lines.length > 0 ? lines : [text]
  const ids: string[] = []
  const descriptions: string[] = []
  for (const line of source) {
    const code = line.match(CODE_SHAPE)?.[0] ?? ''
    if (code) ids.push(canonicalStandardId(capsStandardCodes(code), prefixFor))
    const description = line
      .replace(code, '')
      .replace(/^[\s—–\-:;·]+/, '')
      .trim()
    if (description) descriptions.push(description)
  }
  return {
    standardId: capsStandardCodes(ids.join('; ')),
    standardDescription: descriptions.join('\n\n') || text.trim(),
  }
}

/** The display/export content of one card field for one lesson. */
export function cardContent(key: CardKey, lesson: Lesson, ctx: ScopeCardContext): string {
  switch (key) {
    case 'subject':
      return ctx.subject
    case 'course':
      return ctx.course
    case 'standardSet':
      return ctx.standardSet
    case 'lessonTitle':
      return lesson.title
    case 'standardId':
      return splitStandards(lesson.fields.standards?.content ?? '', ctx.prefixFor).standardId
    case 'standardDescription':
      return splitStandards(lesson.fields.standards?.content ?? '').standardDescription
    default:
      return (lesson.fields[key]?.content ?? '').trim()
  }
}
