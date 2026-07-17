import {
  Citation,
  DecisionEntry,
  DecisionField,
  DecisionType,
  GeneratedExemplar,
  Lesson,
  LessonType,
  ProposalChange,
  VsgCaseClass,
  VsgSlide,
  VsgChannel,
  VsgInteraction,
  VsgSegmentKind,
  VsgTransferTest,
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
// The Atomization Guide's five lesson types (Types of Lessons).
const LESSON_TYPES = ['preskill', 'new-learning', 'representation', 'bridge', 'application-tier']
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
  studentFriendlyTitle: STR, // the title as a student sees it (CARD_RULES item 17)
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

// One direct dependency edge for the coherence webs (Atomization Guide §21.2):
// `on` is an earlier lesson id (same or earlier unit) or a prerequisite-node id
// from the unit's prereqs list; `carries` names the 1–3 ledger entries the
// dependency transmits ("is required by").
const PLAN_DEPENDENCY = obj({
  on: STR,
  carries: arr(STR),
})

const PLAN_LESSON = obj({
  id: STR,
  title: STR,
  type: enums(LESSON_TYPES),
  evidenceStatus: enums(EVIDENCE_STATUS),
  standardCodes: arr(STR),
  itemRefs: arr(STR),
  planningNotes: STR,
  // The lesson's single instructional objective, one sentence (web node metadata).
  objective: STR,
  // The lesson's new Cumulative Mastery Ledger entries: its objective plus any
  // vocabulary or representation explicitly taught inside it (guide §15).
  newEntries: arr(STR),
  // Direct dependencies per the atom-web edge rules (direct consumption ·
  // minimality/no transitive edges · order).
  dependsOn: arr(PLAN_DEPENDENCY),
  // 'inserted-by-triage' when Exclusion Triage Q2 exposed the missing atom.
  flags: arr(enums(['inserted-by-triage'])),
})

// One M(0) prerequisite node of a unit's atom web: the standing prerequisite
// set plus a separate flagged node per Triage-Q1-added prerequisite.
const PLAN_PREREQ = obj({
  id: STR, // "<unitId>.M0", "<unitId>.M0b", …
  label: STR,
  addedByTriage: BOOL,
})

/**
 * Planning pass 1 — the course map: scope resolution and unit architecture
 * WITHOUT lessons. Atomization runs per unit in later calls (pass 2), each
 * with its own output budget, so plan depth is never squeezed by what one
 * call can emit — the failure mode that produced under-atomized courses.
 */
export const COURSE_MAP_SCHEMA = obj({
  units: arr(
    obj({
      id: STR,
      title: STR,
      rationale: STR,
      strand: STR,
      // Grade-progression context (guide §23): this unit's topic plus the
      // prior-grade topic(s) that feed it and next-grade topic(s) that consume
      // it — short noun phrases at progressions-document grain, ≤3 per side.
      topic: STR,
      priorGradeTopics: arr(STR),
      nextGradeTopics: arr(STR),
      // Every most-granular content standard this unit owns (the atomization
      // pass runs the discovery process on exactly these).
      standardCodes: arr(STR),
    }),
  ),
  scopeDecisions: arr(STR),
})

/**
 * Planning pass 2 — one unit's atomization, ledger, item placement, and
 * dependency extraction. Deferrals cross unit boundaries via
 * placedDeferrals/deferredOut; the assembly pass threads them through.
 */
export const UNIT_PLAN_SCHEMA = obj({
  // The unit's M(0) prerequisite nodes (guide §21.1).
  prereqs: arr(PLAN_PREREQ),
  lessons: arr(PLAN_LESSON),
  // Pending items from EARLIER units placed into THIS unit (Deferral Rule).
  placedDeferrals: arr(obj({ itemRef: STR, lessonId: STR, justification: STR })),
  // This unit's items whose ledger check fails on a demand taught LATER —
  // carried forward; still unplaced after the last unit = end-of-course
  // exclusion (guide §16.2), logged at assembly.
  deferredOut: arr(obj({ itemRef: STR, missingDemands: arr(STR), note: STR })),
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


// ---------------------------------------------------------------------------
// Lesson Scope Generation (LSG) — create course vs partial edit
// ---------------------------------------------------------------------------

// Phase 1: the target lesson plan — course operation plus per-lesson operations
// and identity fields only (the DM fields fill in per batch in phase 2, so a
// full-course plan stays inside one call's output budget). lessonId '' = null
// (new lesson — the platform assigns the id); deactivationReason '' = null.
export const LSG_PLAN_SCHEMA = obj({
  courseOperation: enums(['CREATE', 'UPDATE']),
  targetCourse: obj({ courseName: STR, grade: STR, subject: STR, standardSet: STR }),
  lessons: arr(
    obj({
      lessonId: STR,
      operation: enums(['CREATE', 'UPDATE', 'DEACTIVATE']),
      unitName: STR,
      lessonOrder: INT,
      standardId: STR,
      lessonTitle: STR,
      deactivationReason: STR,
    }),
  ),
  planDecisions: arr(STR),
})

// Phase 2: the ten DM-bound scope fields for a batch of plan lessons — each
// echoes the `key` assigned in the prompt ("L1", "L2", …) for exact matching.
export const LSG_FIELDS_BATCH_SCHEMA = obj({
  lessons: arr(
    obj({
      key: STR,
      objectives: STR,
      assessmentBoundary: STR,
      difficultyCeiling: STR,
      prerequisites: STR,
      progressionPlacement: STR,
      newLearning: STR,
      instructionalApproach: STR,
      nonGoals: STR,
      assessmentEvidence: STR,
      releasedItems: STR,
    }),
  ),
})

export interface WireLsgPlanLesson {
  lessonId: string
  operation: 'CREATE' | 'UPDATE' | 'DEACTIVATE'
  unitName: string
  lessonOrder: number
  standardId: string
  lessonTitle: string
  deactivationReason: string
}

export interface WireLsgPlan {
  courseOperation: 'CREATE' | 'UPDATE'
  targetCourse: { courseName: string; grade: string; subject: string; standardSet: string }
  lessons: WireLsgPlanLesson[]
  planDecisions: string[]
}

export interface WireLsgFields {
  key: string
  objectives: string
  assessmentBoundary: string
  difficultyCeiling: string
  prerequisites: string
  progressionPlacement: string
  newLearning: string
  instructionalApproach: string
  nonGoals: string
  assessmentEvidence: string
  releasedItems: string
}

export interface WireLsgFieldsBatch {
  lessons: WireLsgFields[]
}

// ---------------------------------------------------------------------------
// Video Script Generator (playbook §2.5): script → segments → channel-tagged
// lines, with interactions as first-class objects (shared $defs). A segment's
// interaction objects are matched to its INTERACTION-channel lines BY ORDER —
// the Nth interaction belongs to the Nth INTERACTION line; index fields
// invite off-by-one hallucinations, order is deterministic. Conflicts
// (playbook §2.4) ride the same reply: a non-empty unresolved conflict list
// means NO script — the lesson pauses for reconciliation.
// ---------------------------------------------------------------------------

const VSG_INTERACTION = obj({
  type: enums(['mcq', 'numeric-entry', 'click-to-highlight', 'simple-drag']),
  prompt: STR,
  options: arr(STR),
  answer: STR,
  correctFeedback: STR,
  try1Hint: STR,
  try2ShowAndMoveOn: STR,
  resumeState: STR,
  modelAccess: BOOL,
  modelAccessNote: STR,
})

const VSG_LINE = obj({
  channel: enums(['SAY', 'TEXT', 'VISUAL', 'INTERACTION', 'NOTE']),
  content: STR,
  // "M:SS" moment the line lands — simultaneity = adjacent lines sharing a
  // stamp (playbook §2.5/§3); also powers the 30s-interaction-cadence QA.
  time: STR,
  // Two-digit slide number this line belongs to ("01"…), per §15 Formatting.
  slide: STR,
})

// §15 Formatting of the Script: every script is a sequence of numbered
// slides with a typed header. The slide registry lives at the script level;
// lines reference slides by number. Header metadata is production-only.
const VSG_SLIDE = obj({
  number: STR, // two-digit, "01"…
  title: STR, // student-facing; also the slide's opening [TEXT] line
  slideType: enums(['Opening', 'Concept', 'Example', 'Practice', 'Wrap']),
  canvas: enums(['NEW', 'CONTINUES']),
  continuesFrom: STR, // slide number when canvas is CONTINUES, '' when NEW
})

// Rulebook v2 skeleton (§15): opening (absorbs title+intro; title portion
// ≤10s per TIM 03) → i-do → we-do (either may repeat while the Transfer Test
// has unmet case classes) → optional discrimination pass → wrap.
const VSG_SEGMENT = obj({
  kind: enums(['opening', 'i-do', 'we-do', 'discrimination', 'wrap']),
  start: STR,
  end: STR,
  purpose: STR,
  lines: arr(ref('vsgLine')),
  interactions: arr(ref('vsgInteraction')),
})

const VSG_CONFLICT = obj({
  kind: enums(['card-internal', 'card-vs-doctrine', 'card-vs-playbook', 'steering']),
  summary: STR,
  sideA: STR,
  sideB: STR,
  proposal: STR,
  rationale: STR,
})

// The machine-readable coverage note (SEQ 10): every case class the strategy
// claims inside the boundary, taught here or deferred downstream by name.
const VSG_CASE_CLASS = obj({
  name: STR,
  status: enums(['taught', 'deferred']),
  where: STR,
})

export const VSG_SCRIPT_SCHEMA: Schema = {
  ...obj({
    conflicts: arr(ref('vsgConflict')),
    gradeBand: STR,
    durationEstimate: STR,
    slides: arr(ref('vsgSlide')),
    segments: arr(ref('vsgSegment')),
    formatRefs: arr(STR),
    coverageNote: arr(ref('vsgCaseClass')),
    transferTest: obj({
      stepsDemonstrated: BOOL,
      caseClassesShown: BOOL,
      decisionsPerformed: BOOL,
      note: STR,
    }),
    qa: obj({ hardFails: arr(STR), flags: arr(STR) }),
  }),
  $defs: {
    vsgLine: VSG_LINE,
    vsgSlide: VSG_SLIDE,
    vsgInteraction: VSG_INTERACTION,
    vsgSegment: VSG_SEGMENT,
    vsgConflict: VSG_CONFLICT,
    vsgCaseClass: VSG_CASE_CLASS,
  },
}

export interface WireVsgConflict {
  kind: 'card-internal' | 'card-vs-doctrine' | 'card-vs-playbook' | 'steering'
  summary: string
  sideA: string
  sideB: string
  proposal: string
  rationale: string
}

export interface WireVsgLine {
  channel: VsgChannel
  content: string
  time: string
  slide: string
}

export interface WireVsgSegment {
  kind: VsgSegmentKind
  start: string
  end: string
  purpose: string
  lines: WireVsgLine[]
  interactions: VsgInteraction[]
}

export interface WireVsgScript {
  conflicts: WireVsgConflict[]
  gradeBand: string
  durationEstimate: string
  slides: VsgSlide[]
  segments: WireVsgSegment[]
  formatRefs: string[]
  coverageNote: VsgCaseClass[]
  transferTest: VsgTransferTest
  qa: { hardFails: string[]; flags: string[] }
}

// ---------------------------------------------------------------------------
// Quality Control gates — Gates 2/3 return findings in the one-signal shape
// (machine-actionable, never prose alone); investigations return the
// six-step record. lessonId/field are '' for scope-level findings.
// ---------------------------------------------------------------------------

const QC_WIRE_FINDING = obj({
  /** The check that raised it, e.g. 'Quote fidelity', 'Split challenge'. */
  checkFamily: STR,
  /** The rule enforced: P1–P12, an engine rule tag, or the gate's own rule id. */
  ruleTag: STR,
  /** Lesson id (e.g. 'U3.L2') or '' for a scope-level finding. */
  lessonId: STR,
  /** Card field name (e.g. 'boundary') or '' when the finding is card-level. */
  field: STR,
  summary: STR,
  /** The citations / probe artifacts that establish the defect — a challenge is defeated by citations, never eloquence. */
  evidence: STR,
  severity: enums(['blocking', 'major', 'advisory']),
  /** Required change class + the verification that retires the finding. */
  repairContract: STR,
})

export const QC_FINDINGS_SCHEMA: Schema = obj({ findings: arr(QC_WIRE_FINDING) })

export interface WireQcFinding {
  checkFamily: string
  ruleTag: string
  lessonId: string
  field: string
  summary: string
  evidence: string
  severity: 'blocking' | 'major' | 'advisory'
  repairContract: string
}
export interface WireQcFindings {
  findings: WireQcFinding[]
}

export const QC_INVESTIGATION_SCHEMA: Schema = obj({
  verdicts: arr(
    obj({
      /** Echo of the flag id being ruled on. */
      flagId: STR,
      verdict: enums(['confirmed', 'not-confirmed']),
      /** Severity when confirmed; '' when not confirmed. */
      severity: enums(['blocking', 'major', 'advisory', '']),
      /** Why the scope is wrong (confirmed): stale calibration, evidence missed at generation, misapplied criterion, acknowledged corpus gap. '' when not confirmed. */
      rootCause: STR,
      /** Confirmed: the establishing evidence. Not confirmed: the citations that defend the original decision (the tool argues back). */
      rationale: STR,
    }),
  ),
  patternSweep: arr(
    obj({
      defectClass: STR,
      additionalCards: arr(obj({ lessonId: STR, field: STR, evidence: STR })),
    }),
  ),
  gateGaps: arr(
    obj({
      defectClass: STR,
      /** Which gate should have caught it. */
      gate: enums(['1', '2', '3', '4']),
      whyMissed: STR,
    }),
  ),
  proposedRepairs: arr(
    obj({
      lessonId: STR,
      field: STR,
      /** The current text being replaced (verbatim excerpt, trimmed). */
      currentExcerpt: STR,
      proposedText: STR,
      /** The repair's decision record, citing the investigation. */
      decisionRecord: STR,
    }),
  ),
})

export interface WireQcInvestigation {
  verdicts: {
    flagId: string
    verdict: 'confirmed' | 'not-confirmed'
    severity: 'blocking' | 'major' | 'advisory' | ''
    rootCause: string
    rationale: string
  }[]
  patternSweep: { defectClass: string; additionalCards: { lessonId: string; field: string; evidence: string }[] }[]
  gateGaps: { defectClass: string; gate: '1' | '2' | '3' | '4'; whyMissed: string }[]
  proposedRepairs: { lessonId: string; field: string; currentExcerpt: string; proposedText: string; decisionRecord: string }[]
}

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
  studentFriendlyTitle: string
  type: LessonType
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  fields: Record<keyof Lesson['fields'], WireCardField>
  itemRefs: string[]
  generatedExemplars: (GeneratedExemplar & { choices: string[] })[]
  sequencingRationale: string
  granularityRationale: string
  decisions: WireDecision[]
}

export interface PlanDependency {
  on: string
  carries: string[]
}

export interface PlanPrereq {
  id: string
  label: string
  addedByTriage: boolean
}

// The web-bearing fields are optional in the TS shape (though required by the
// schema) so plan checkpoints written by pre-dependency-mapping builds still
// resume — finalize guards every read.
export interface PlanLessonSkeleton {
  id: string
  title: string
  type: LessonType
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  standardCodes: string[]
  itemRefs: string[]
  planningNotes: string
  objective?: string
  newEntries?: string[]
  dependsOn?: PlanDependency[]
  flags?: 'inserted-by-triage'[]
}

export interface PlanUnit {
  id: string
  title: string
  rationale: string
  strand: string
  topic?: string
  priorGradeTopics?: string[]
  nextGradeTopics?: string[]
  prereqs?: PlanPrereq[]
  lessons: PlanLessonSkeleton[]
}

export interface PlanOutput {
  units: PlanUnit[]
  scopeDecisions: string[]
}

export interface CourseMapUnit {
  id: string
  title: string
  rationale: string
  strand: string
  topic: string
  priorGradeTopics: string[]
  nextGradeTopics: string[]
  standardCodes: string[]
}

export interface CourseMap {
  units: CourseMapUnit[]
  scopeDecisions: string[]
}

export interface PlacedDeferral {
  itemRef: string
  lessonId: string
  justification: string
}

export interface DeferredItem {
  itemRef: string
  missingDemands: string[]
  note: string
}

export interface UnitPlanOutput {
  prereqs: PlanPrereq[]
  lessons: PlanLessonSkeleton[]
  placedDeferrals: PlacedDeferral[]
  deferredOut: DeferredItem[]
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
  const studentFriendlyTitle = (w.studentFriendlyTitle ?? '').trim()
  return {
    id: w.id,
    title: w.title,
    ...(studentFriendlyTitle.length > 0 ? { studentFriendlyTitle } : {}),
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
