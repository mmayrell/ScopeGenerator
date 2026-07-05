import {
  Citation,
  DecisionEntry,
  DecisionType,
  GeneratedExemplar,
  Lesson,
  LessonType,
  ProposalChange,
  Unit,
} from '../domain/types'

/**
 * JSON Schemas for Claude structured output (contract §Claude integration).
 *
 * Constraints honored throughout:
 * - `additionalProperties: false` and `required` on EVERY object
 * - no recursion — the StandardNode tree is a FLAT array with parentCode,
 *   rebuilt into a tree in code (see pipeline/ingest.ts)
 * - no min/max/minLength-style constraints (unsupported)
 *
 * Every property is listed in `required`; optionality is expressed with
 * null-unions (anyOf) or empty arrays/strings, then normalized into the
 * domain types by the converters at the bottom of this file.
 */
type Schema = Record<string, unknown>

const STR: Schema = { type: 'string' }
const INT: Schema = { type: 'integer' }
const NUM: Schema = { type: 'number' }
const BOOL: Schema = { type: 'boolean' }
const enums = (values: string[]): Schema => ({ type: 'string', enum: values })
const arr = (items: Schema): Schema => ({ type: 'array', items })
const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] })

const SOURCE_TYPES = [
  'standards',
  'items',
  'decomposition',
  'interpretive',
  'engine',
  'doctrine',
  'admin-notes',
  'sequence',
  'performance-report',
]
const DECISION_TYPES = [
  'granularity',
  'strategy',
  'boundary',
  'ceiling',
  'contradiction',
  'override',
  'assumption',
]
const DECISION_FLAGS = ['thin-evidence', 'ai-proposed', 'inferred']
const LESSON_TYPES = ['new-learning', 'bridge', 'application-tier']
const EVIDENCE_STATUS = ['observed', 'inferred', 'mixed']

// Lesson-bearing schemas share their subtrees via $defs/$ref: JS-object reuse
// below would be INLINED on JSON serialization, and 12 inlined copies of the
// CardField/Citation subtree per lesson blow past the API's constrained-decoding
// grammar-size limit ("The compiled grammar is too large", observed in prod).
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` })

const CITATION = obj({
  sourceType: enums(SOURCE_TYPES),
  label: STR,
  locator: STR,
  excerpt: STR,
})

const CARD_FIELD = obj({
  content: STR,
  citations: arr(ref('citation')),
  inferred: BOOL,
})

const DECISION = obj({
  n: INT,
  type: enums(DECISION_TYPES),
  rule: STR,
  text: STR,
  citations: arr(ref('citation')),
  flags: arr(enums(DECISION_FLAGS)),
})

const EXEMPLAR = obj({
  stem: STR,
  answer: STR,
  demandProfile: STR,
  basis: STR,
})

const LESSON = obj({
  id: STR,
  title: STR,
  type: enums(LESSON_TYPES),
  evidenceStatus: enums(EVIDENCE_STATUS),
  fields: obj({
    standards: ref('cardField'),
    cluster: ref('cardField'),
    emphasis: ref('cardField'),
    progression: ref('cardField'),
    prerequisites: ref('cardField'),
    boundary: ref('cardField'),
    newLearning: ref('cardField'),
    approach: ref('cardField'),
    nonGoals: ref('cardField'),
    ceiling: ref('cardField'),
    assessment: ref('cardField'),
    releasedItems: ref('cardField'),
  }),
  itemRefs: arr(STR),
  generatedExemplar: nullable(ref('exemplar')),
  decisions: arr(ref('decision')),
})

const LESSON_DEFS: Record<string, Schema> = {
  citation: CITATION,
  cardField: CARD_FIELD,
  decision: DECISION,
  exemplar: EXEMPLAR,
  lesson: LESSON,
}

const withLessonDefs = (root: Schema): Schema => ({ ...root, $defs: LESSON_DEFS })

const PLAN_LESSON = obj({
  id: STR,
  title: STR,
  type: enums(LESSON_TYPES),
  evidenceStatus: enums(EVIDENCE_STATUS),
  standardCodes: arr(STR),
  itemRefs: arr(STR),
  planningNotes: STR,
})

export const PLAN_SCHEMA = obj({
  units: arr(
    obj({
      id: STR,
      title: STR,
      rationale: STR,
      strand: STR,
      lessons: arr(PLAN_LESSON),
    }),
  ),
  scopeDecisions: arr(STR),
})

export const UNIT_CARDS_SCHEMA = withLessonDefs(
  obj({
    id: STR,
    title: STR,
    rationale: STR,
    strand: STR,
    lessons: arr(ref('lesson')),
  }),
)

export const RERUN_LESSON_SCHEMA = withLessonDefs(obj({ lesson: ref('lesson') }))

const LOCKED_SUGGESTION = obj({ lessonId: STR, suggestion: STR })

export const RERUN_UNIT_SCHEMA = withLessonDefs(
  obj({
    lessons: arr(ref('lesson')),
    lockedSuggestions: arr(LOCKED_SUGGESTION),
  }),
)

const PROPOSAL_CHANGE = obj({
  target: STR,
  kind: enums(['split', 'merge', 'modeling', 'ceiling', 'bridge', 'relational']),
  before: STR,
  after: STR,
  rationale: STR,
  rule: STR,
  guardrail: STR, // empty string when no protected boundary is touched
})

export const PROPOSAL_SCHEMA = obj({
  changes: arr(PROPOSAL_CHANGE),
  ripple: arr(STR),
})

export const ITERATE_SCHEMA = obj({
  response: STR,
  changes: arr(PROPOSAL_CHANGE), // empty array = keep the current change set
})

export const APPLY_SCHEMA = withLessonDefs(
  obj({
    lessons: arr(ref('lesson')), // full rewritten lessons for every lesson that changes
    lockedSuggestions: arr(LOCKED_SUGGESTION),
  }),
)

const LEXICON_TERM = obj({ term: STR, aliases: arr(STR), source: STR })

// Flat StandardNode list — parentCode '' marks a root; the tree is rebuilt in code.
export const INGEST_STANDARDS_SCHEMA = obj({
  nodes: arr(
    obj({
      code: STR,
      norm: STR,
      parentCode: STR,
      label: STR,
      wording: STR,
      limits: arr(STR),
      fluency: BOOL,
      emphasis: enums(['Major', 'Supporting', 'Additional', 'not designated']),
    }),
  ),
  representations: arr(LEXICON_TERM),
  problemTypes: arr(LEXICON_TERM),
  coverageWarnings: arr(STR),
  usageNotes: STR,
})

export const INGEST_ITEMS_SCHEMA = obj({
  items: arr(
    obj({
      source: STR,
      test: STR,
      year: INT,
      itemNumber: INT,
      alignmentCode: STR,
      confidence: enums(['official', 'ai-proposed']),
      completeness: NUM,
      itemType: enums(['selected-response', 'multi-part', 'constructed-response']),
      responseFormat: STR,
      representations: arr(STR),
      problemTypes: arr(STR),
      demandProfile: STR,
      scopeClass: enums(['in-boundary', 'rigor-signal-only', 'adjacent-grade']),
      hasKey: BOOL,
      stem: STR,
      choices: arr(STR),
    }),
  ),
  coverageWarnings: arr(STR),
  usageNotes: STR,
})

export const INGEST_NOTES_SCHEMA = obj({
  usageNotes: STR,
  coverageWarnings: arr(STR),
})

// ---------------------------------------------------------------------------
// Wire types mirroring the schemas, plus converters into the domain model
// ---------------------------------------------------------------------------

export interface WireCitation {
  sourceType: Citation['sourceType']
  label: string
  locator: string
  excerpt: string
}

export interface WireCardField {
  content: string
  citations: WireCitation[]
  inferred: boolean
}

export interface WireDecision {
  n: number
  type: DecisionType
  rule: string
  text: string
  citations: WireCitation[]
  flags: ('thin-evidence' | 'ai-proposed' | 'inferred')[]
}

export interface WireLesson {
  id: string
  title: string
  type: LessonType
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  fields: Record<keyof Lesson['fields'], WireCardField>
  itemRefs: string[]
  generatedExemplar: GeneratedExemplar | null
  decisions: WireDecision[]
}

export interface PlanLessonSkeleton {
  id: string
  title: string
  type: LessonType
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  standardCodes: string[]
  itemRefs: string[]
  planningNotes: string
}

export interface PlanUnit {
  id: string
  title: string
  rationale: string
  strand: string
  lessons: PlanLessonSkeleton[]
}

export interface PlanOutput {
  units: PlanUnit[]
  scopeDecisions: string[]
}

export interface WireUnitCards {
  id: string
  title: string
  rationale: string
  strand: string
  lessons: WireLesson[]
}

export interface LockedSuggestion {
  lessonId: string
  suggestion: string
}

export interface WireProposalChange {
  target: string
  kind: ProposalChange['kind']
  before: string
  after: string
  rationale: string
  rule: string
  guardrail: string
}

export interface WireProposalOutput {
  changes: WireProposalChange[]
  ripple: string[]
}

export interface WireIterateOutput {
  response: string
  changes: WireProposalChange[]
}

export interface WireApplyOutput {
  lessons: WireLesson[]
  lockedSuggestions: LockedSuggestion[]
}

export interface WireStandardNode {
  code: string
  norm: string
  parentCode: string
  label: string
  wording: string
  limits: string[]
  fluency: boolean
  emphasis: 'Major' | 'Supporting' | 'Additional' | 'not designated'
}

export interface WireIngestStandards {
  nodes: WireStandardNode[]
  representations: { term: string; aliases: string[]; source: string }[]
  problemTypes: { term: string; aliases: string[]; source: string }[]
  coverageWarnings: string[]
  usageNotes: string
}

export interface WireIngestItem {
  source: string
  test: string
  year: number
  itemNumber: number
  alignmentCode: string
  confidence: 'official' | 'ai-proposed'
  completeness: number
  itemType: 'selected-response' | 'multi-part' | 'constructed-response'
  responseFormat: string
  representations: string[]
  problemTypes: string[]
  demandProfile: string
  scopeClass: 'in-boundary' | 'rigor-signal-only' | 'adjacent-grade'
  hasKey: boolean
  stem: string
  choices: string[]
}

export interface WireIngestItems {
  items: WireIngestItem[]
  coverageWarnings: string[]
  usageNotes: string
}

export interface WireIngestNotes {
  usageNotes: string
  coverageWarnings: string[]
}

function toCardField(w: WireCardField) {
  return {
    content: w.content,
    citations: w.citations as Citation[],
    ...(w.inferred ? { inferred: true } : {}),
  }
}

export function toLesson(w: WireLesson, validItemIds: Set<string>): Lesson {
  const fields = {} as Lesson['fields']
  for (const key of Object.keys(w.fields) as (keyof Lesson['fields'])[]) {
    fields[key] = toCardField(w.fields[key])
  }
  const decisions: DecisionEntry[] = w.decisions.map((d) => ({
    n: d.n,
    type: d.type,
    rule: d.rule,
    text: d.text,
    citations: d.citations as Citation[],
    ...(d.flags.length > 0 ? { flags: d.flags } : {}),
  }))
  return {
    id: w.id,
    title: w.title,
    type: w.type,
    locked: false,
    evidenceStatus: w.evidenceStatus,
    fields,
    itemRefs: w.itemRefs.filter((id) => validItemIds.has(id)),
    ...(w.generatedExemplar ? { generatedExemplar: w.generatedExemplar } : {}),
    decisions,
  }
}

export function toUnit(w: WireUnitCards, validItemIds: Set<string>): Unit {
  return {
    id: w.id,
    title: w.title,
    rationale: w.rationale,
    strand: w.strand,
    lessons: w.lessons.map((l) => toLesson(l, validItemIds)),
  }
}

export function toProposalChange(w: WireProposalChange): ProposalChange {
  return {
    target: w.target,
    kind: w.kind,
    before: w.before,
    after: w.after,
    rationale: w.rationale,
    rule: w.rule,
    ...(w.guardrail.trim().length > 0 ? { guardrail: w.guardrail } : {}),
  }
}
