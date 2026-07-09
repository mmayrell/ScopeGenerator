import {
  Citation,
  DecisionEntry,
  DecisionField,
  DecisionType,
  GeneratedExemplar,
  Lesson,
  LessonType,
  ProposalChange,
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
// The card field a decision governs ('card' = lesson-level: granularity, type, sequencing).
const DECISION_FIELDS = [
  'card',
  'standards',
  'cluster',
  'substandard',
  'objectives',
  'emphasis',
  'progression',
  'prerequisites',
  'boundary',
  'newLearning',
  'approach',
  'nonGoals',
  'ceiling',
  'assessment',
  'releasedItems',
]
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
  rationale: STR, // the field's decision record — detailed why-prose (see CARD_RULES)
  inferred: BOOL,
})

const DECISION = obj({
  n: INT,
  type: enums(DECISION_TYPES),
  field: enums(DECISION_FIELDS),
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
  choices: arr(STR), // full selected-response set (distractors encode error patterns); [] for constructed-response
})

const LESSON = obj({
  id: STR,
  title: STR,
  type: enums(LESSON_TYPES),
  evidenceStatus: enums(EVIDENCE_STATUS),
  fields: obj({
    standards: ref('cardField'),
    cluster: ref('cardField'),
    substandard: ref('cardField'),
    objectives: ref('cardField'),
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
  generatedExemplars: arr(ref('exemplar')), // 1-3 for atoms with no directly aligned item; [] otherwise
  sequencingRationale: STR, // lesson-level record part 1: why the units are ordered as they are and why this lesson sits where it does (see CARD_RULES)
  granularityRationale: STR, // lesson-level record part 2: why this exact granularity — why not more, why not less (see CARD_RULES)
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

// Cards generate in bounded lesson batches (unit metadata comes from the plan
// skeleton) so a large unit can never overflow the output-token budget.
export const UNIT_CARDS_BATCH_SCHEMA = withLessonDefs(obj({ lessons: arr(ref('lesson')) }))

export const RERUN_LESSON_SCHEMA = withLessonDefs(obj({ lesson: ref('lesson') }))

export const RERUN_UNIT_SCHEMA = withLessonDefs(obj({ lessons: arr(ref('lesson')) }))

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
  }),
)


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
  setMeta: obj({ subject: STR, grade: STR, sourceOrganization: STR, standardIdPrefix: STR }),
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
      page: INT,
      box: obj({ x: NUM, y: NUM, w: NUM, h: NUM }),
    }),
  ),
  coverageWarnings: arr(STR),
  usageNotes: STR,
})

export const INGEST_NOTES_SCHEMA = obj({
  usageNotes: STR,
  coverageWarnings: arr(STR),
})

export const INGEST_ITEM_COUNT_SCHEMA = obj({ itemCount: INT })

export const INGEST_CONFLICTS_SCHEMA = obj({
  warnings: arr(
    obj({
      text: STR,
      kind: enums(['gap', 'conflict']),
      suggestion: STR,
    }),
  ),
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
  rationale: string
  inferred: boolean
}

export interface WireDecision {
  n: number
  type: DecisionType
  field: DecisionField
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
  generatedExemplars: (GeneratedExemplar & { choices: string[] })[]
  sequencingRationale: string
  granularityRationale: string
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

export interface WireLessonBatch {
  lessons: WireLesson[]
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
  setMeta: { subject: string; grade: string; sourceOrganization: string; standardIdPrefix: string }
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
  page: number
  box: { x: number; y: number; w: number; h: number }
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

export interface WireItemCount {
  itemCount: number
}

export interface WireIngestConflicts {
  warnings: { text: string; kind: 'gap' | 'conflict'; suggestion: string }[]
}

function toCardField(w: WireCardField) {
  // The unconstrained fallback path does not guarantee the property exists.
  const rationale = (w.rationale ?? '').trim()
  return {
    content: w.content,
    citations: w.citations as Citation[],
    ...(rationale.length > 0 ? { rationale } : {}),
    ...(w.inferred ? { inferred: true } : {}),
  }
}

export function toLesson(w: WireLesson, validItemIds: Set<string>, fallbackItemRefs: string[] = []): Lesson {
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
    // Constrained decoding guarantees the enum, but the unconstrained fallback
    // path does not — anything unrecognized settles at the lesson level.
    field: (DECISION_FIELDS as string[]).includes(d.field) ? d.field : 'card',
  }))
  const exemplars = (w.generatedExemplars ?? [])
    .filter((e) => e.stem.trim().length > 0)
    .map(({ stem, answer, demandProfile, basis, choices }) => {
      const cleaned = choices.map((c) => c.trim()).filter((c) => c.length > 0)
      return { stem, answer, demandProfile, basis, ...(cleaned.length > 0 ? { choices: cleaned } : {}) }
    })
  // Item attachment is decided upstream (the plan skeleton, or the lesson
  // being rerun) and the model is instructed to echo it — but a garbled or
  // hallucinated id used to be dropped silently here, leaving a card whose
  // Released Items prose describes items that never render. Repair from the
  // caller's authoritative refs: keep the model's valid refs (its ordering is
  // meaningful — closeness to ceiling), then restore any valid authoritative
  // ref the model lost or mangled.
  const wireRefs = w.itemRefs.filter((id) => validItemIds.has(id))
  const restored = fallbackItemRefs.filter((id) => validItemIds.has(id) && !wireRefs.includes(id))
  // The unconstrained fallback path does not guarantee the narrative properties exist.
  const sequencingRationale = (w.sequencingRationale ?? '').trim()
  const granularityRationale = (w.granularityRationale ?? '').trim()
  return {
    id: w.id,
    title: w.title,
    type: w.type,
    evidenceStatus: w.evidenceStatus,
    fields,
    itemRefs: [...wireRefs, ...restored],
    ...(exemplars.length > 0 ? { generatedExemplars: exemplars } : {}),
    ...(sequencingRationale.length > 0 ? { sequencingRationale } : {}),
    ...(granularityRationale.length > 0 ? { granularityRationale } : {}),
    decisions,
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
