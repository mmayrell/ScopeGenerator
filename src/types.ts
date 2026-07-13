// Data model per spec §5

export type ArtifactRole =
  | 'standards'
  | 'items'
  | 'unpacking-structured'
  | 'unpacking-narrative'
  | 'progression'

export type CoverageDeclaration = 'census' | 'sample' | 'unknown'
export type ReviewStatus = 'parsed' | 'reviewed' | 'blocked'

export interface Artifact {
  id: string
  role: ArtifactRole
  fileName: string
  usageNotes: string
  reviewStatus: ReviewStatus
  blockingError?: string
  meta?: {
    sourceDescription?: string
    window?: string
    coverage?: CoverageDeclaration
    domainGradeTags?: string[]
    itemCount?: number
    tier?: 1 | 2
    /** Released-items extraction progress (runs lazily before first scope generation). */
    itemsExtracted?: boolean
    itemsExtractedPages?: number
    /** Persisted adaptive window size — survives handoffs so dense documents keep shrinking instead of looping. */
    itemsWindowPages?: number
  }
}

export interface CoverageWarning {
  id: string
  text: string
  acknowledged: boolean
  /** 'conflict' = cross-document scope conflict found at extraction; 'gap' = coverage gap. */
  kind?: 'gap' | 'conflict'
  /** The AI's suggested default resolution, determined while investigating the issue. */
  suggestion?: string
  /** How the user chose to resolve it; recorded and injected into the stages that consume it. */
  resolution?: string
  resolvedBy?: 'default' | 'custom'
}

export interface StandardNode {
  code: string // canonical
  norm: string // normalized join code
  label?: string // heading text for grouping levels
  wording?: string
  limits?: string[]
  fluency?: boolean
  emphasis?: 'Major' | 'Supporting' | 'Additional' | 'not designated'
  children?: StandardNode[]
}

export interface ItemRecord {
  id: string
  source: string
  test: string
  year: number
  itemNumber: number
  alignmentCode: string
  confidence: 'official' | 'ai-proposed' | 'confirmed'
  completeness: number // 0–1
  itemType: 'selected-response' | 'multi-part' | 'constructed-response'
  responseFormat: string
  representations: string[]
  problemTypes: string[]
  demandProfile: string
  scopeClass: 'in-boundary' | 'rigor-signal-only' | 'adjacent-grade'
  hasKey: boolean
  stem: string // text stand-in, used when no screenshot was extracted
  choices?: string[]
  /** Blob path of the extracted question screenshot (served via /api/item-image). */
  imagePath?: string
  /** 1-based PDF page the item was found on. */
  page?: number
}

export interface StandardSet {
  id: string
  name: string
  subject: string
  gradeSpan: string
  hierarchyLevels: string[]
  codingScheme: string
  codingNotes: string
  emphasisSource: string
  /**
   * Canonical identifier prefix for the framework (e.g. "CCSS.MATH.CONTENT").
   * Standard IDs render/export as <prefix>.<code>; empty/absent = bare code.
   */
  standardIdPrefix?: string
  /** Source organization, extracted from the standards document. */
  sourceOrganization?: string
  published: boolean
  archived?: boolean
  artifacts: Artifact[]
  warnings: CoverageWarning[]
  tree: StandardNode[]
  items: ItemRecord[]
  updated: string
}

export interface Citation {
  sourceType:
    | 'standards'
    | 'items'
    | 'decomposition'
    | 'interpretive'
    | 'engine'
    | 'doctrine'
    | 'admin-notes'
    | 'sequence'
    | 'performance-report'
  label: string // e.g. "CCSS 4.NBT.B.5" or "NY 2023 · Q17"
  locator: string
  excerpt: string
}

export type DecisionType =
  | 'granularity'
  | 'strategy'
  | 'boundary'
  | 'ceiling'
  | 'contradiction'
  | 'override'
  | 'assumption'

/**
 * The card field a decision governs — its record renders directly under that
 * field. 'card' = lesson-level calls (granularity, type, sequencing) rendered
 * in the trailing lesson-level record.
 */
export type DecisionField =
  | 'card'
  | 'standards'
  | 'cluster'
  | 'substandard'
  | 'objectives'
  | 'emphasis'
  | 'progression'
  | 'prerequisites'
  | 'boundary'
  | 'newLearning'
  | 'approach'
  | 'nonGoals'
  | 'ceiling'
  | 'assessment'
  | 'releasedItems'

export interface DecisionEntry {
  n: number
  type: DecisionType
  rule: string // P#/A#
  text: string
  citations: Citation[]
  flags?: ('thin-evidence' | 'ai-proposed' | 'inferred')[]
  /** Optional only for scopes generated before per-field records existed (the UI falls back to a type-based mapping). */
  field?: DecisionField
}

export interface CardField {
  content: string
  citations: Citation[]
  /**
   * The field's decision record: a self-contained prose explanation of why the
   * content reads the way it does — the evidence weighed, defaults overridden,
   * inferences and their bases. Optional only for scopes generated before
   * per-field rationales existed.
   */
  rationale?: string
  inferred?: boolean
}

/**
 * The five lesson types of the Atomization Guide ("Types of Lessons"):
 * preskill (prerequisite knowledge) · new-learning (a new behavior) ·
 * representation (a new way of expressing already-learned knowledge) ·
 * bridge (choosing between previously mastered atoms) · application-tier
 * (transfer of mastered knowledge into authentic problems).
 */
export type LessonType = 'preskill' | 'new-learning' | 'representation' | 'bridge' | 'application-tier'

export interface GeneratedExemplar {
  stem: string
  answer: string
  demandProfile: string
  basis: string
  /** Full selected-response choice set — distractors encode the atom's documented error patterns. */
  choices?: string[]
}

export interface Lesson {
  id: string // e.g. U3.L3
  title: string
  /** The title as a student sees it — concise, descriptive, on grade level (absent on scopes generated before the field existed). */
  studentFriendlyTitle?: string
  type: LessonType
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  fields: {
    standards: CardField
    cluster: CardField
    /** The verb-led atomized objective — the single teachable behavior this lesson owns (spec: Substandard / atomizedObjective). Optional only for scopes generated before the field existed. */
    substandard?: CardField
    /** Minimal-complete mastery objectives. Optional only for scopes generated before the field existed. */
    objectives?: CardField
    emphasis: CardField
    progression: CardField
    prerequisites: CardField
    boundary: CardField
    newLearning: CardField
    approach: CardField
    nonGoals: CardField
    ceiling: CardField
    assessment: CardField
    releasedItems: CardField
  }
  itemRefs: string[] // ItemRecord ids rendered in Released items
  /** Legacy single exemplar (pre-plural scopes); new generations fill generatedExemplars. */
  generatedExemplar?: GeneratedExemplar
  /** State-test-quality assessment exemplars for atoms with no directly aligned released item. */
  generatedExemplars?: GeneratedExemplar[]
  /**
   * Lesson-level decision record narrative (trailing card record), part 1:
   * why the units are ordered as they are around this lesson's unit, and why
   * the lesson holds its exact position in the teaching order. Optional only
   * on scopes generated before the narratives existed.
   */
  sequencingRationale?: string
  /**
   * Lesson-level decision record narrative, part 2: why this lesson is
   * exactly the granularity it is — and explicitly why not more granular and
   * why not less. Optional only on scopes generated before it existed.
   */
  granularityRationale?: string
  decisions: DecisionEntry[]
}

export interface Unit {
  id: string
  title: string
  rationale: string
  strand: string
  lessons: Lesson[]
}

// ---------------------------------------------------------------------------
// Coherence webs (Atomization Guide, Part IV) — navigable dependency maps
// emitted with every generated scope. Three tiers: an atom web per unit, one
// unit web for the course, one grade progression web (topic level). Every web
// is a DAG whose every edge reads "is required by"; the data object is the
// deliverable — any rendering must be regenerable from it alone.
// ---------------------------------------------------------------------------

export type WebNodeKind = 'lesson' | 'prerequisite' | 'unit' | 'topic'

export interface WebNode {
  id: string
  label: string
  kind: WebNodeKind
  /** Lesson type (atom webs) — one of the five LessonType values. */
  type?: string
  /** One-sentence objective (atom-web lesson nodes). */
  objective?: string
  /** Assessment source from the Item Alignment Map (atom-web lesson nodes). */
  assessment?: 'RELEASED' | 'GENERATED' | 'MIXED'
  /** Grade-progression column: 'prior' | 'this' | 'next' (topic nodes only). */
  grade?: string
  /** Triage repairs stay visible: Q2-inserted atoms and Q1-added prerequisites. */
  flags?: ('inserted-by-triage' | 'added-to-M0')[]
}

export interface WebEdge {
  from: string
  to: string
  /** The one-to-three skills that carry the dependency ("is required by"). */
  carries: string[]
}

export interface CoherenceWeb {
  level: 'atom' | 'unit' | 'grade'
  /** Unit id for atom webs; the course/scope for unit and grade webs. */
  scope: string
  /** Display title for the web (e.g. the unit title). */
  title: string
  nodes: WebNode[]
  edges: WebEdge[]
}

export interface QCCheck {
  name: string
  status: 'pass' | 'flag' | 'fail'
  detail: string
}

export interface ScopeVersion {
  version: number
  date: string
  actor: string
  event: string
  detail: string
}

export interface PerformanceReport {
  id: string
  target: string
  text: string
  actor: string
  date: string
}

export interface ProposalChange {
  target: string
  kind: 'split' | 'merge' | 'modeling' | 'ceiling' | 'bridge' | 'relational'
  before: string
  after: string
  rationale: string
  rule: string
  guardrail?: string // pushback text if the change collides with a protected boundary
}

export interface Proposal {
  id: string
  report: PerformanceReport
  changes: ProposalChange[]
  ripple: string[]
  status: 'drafting' | 'draft' | 'accepted' | 'abandoned'
  working?: boolean // true while Claude is drafting/iterating
  rounds: { feedback: string; response: string }[]
  /** Units whose accepted changes have been applied — written atomically with each unit's rewrite so a redelivered apply never re-applies. */
  appliedUnits?: string[]
}

export interface Scope {
  id: string
  setId: string
  /** All sets the scope draws evidence from (multi-select requests); setId is the first. */
  setIds?: string[]
  title: string
  request: {
    mode: 'course' | 'standard' | 'topic'
    params: string
    /** User-entered course name (e.g. "Grade 4 Mathematics"). Optional only on scopes created before the field existed. */
    courseName?: string
    /** User-entered subject (e.g. "Mathematics"). Optional only on scopes created before the field existed. */
    subject?: string
    /** LEGACY (removed toggle) — present on scopes generated before granularity moved to the engine document; display-only. */
    granular?: boolean
    /** Blob prefix token for user-uploaded released-question PDFs (scope-uploads/<token>/...) — topic requests. */
    uploadsToken?: string
    /** Display names of the uploaded PDFs (the blobs under the token are authoritative). */
    uploadNames?: string[]
    /** Evidence packet whose hunted items serve as this scope's released-items source. */
    packetId?: string
    /** Packet title at scope creation (display; the packet document is authoritative). */
    packetTitle?: string
  }
  engineVersion: string
  doctrineVersions: string[]
  status: 'complete' | 'generating' | 'paused' | 'failed'
  error?: string // populated when status === 'failed'
  version: number
  units: Unit[]
  qc: QCCheck[]
  history: ScopeVersion[]
  proposals: Proposal[]
  protectedBoundaries?: string[][] // lesson-id pairs protected by a hard split criterion
  /**
   * The three-tier coherence webs (atom webs per unit, the unit web, the
   * grade progression web), built at finalize from the plan's dependency
   * extraction. Optional only on scopes generated before dependency mapping
   * existed. Self-contained: nodes carry their own labels/metadata, so the
   * webs render even if later reruns reshape the units.
   */
  coherence?: CoherenceWeb[]
  creator: string
  updated: string
}

export interface SystemArtifact {
  id: string
  kind: 'engine' | 'doctrine'
  name: string
  version: string
  published: string
  note: string
}

/** One governing framework document (engine or doctrine BrainLift). Fixed as written — not editable or uploadable. */
export interface FrameworkSection {
  kind: 'engine' | 'doctrine'
  name: string
  description: string
  version: string
  updated: string
  content: string // rendered as lightweight markdown: '## ' headings, '- ' bullets, blank-line paragraphs
}

/** The governing framework the tool runs under. Read-only: new versions ship with the tool. */
export interface FrameworkDoc {
  engine: FrameworkSection
  doctrine: FrameworkSection
}

// ---------------------------------------------------------------------------
// Evidence packets — a standalone web-hunting tool. Packets are NOT connected
// to standard sets or scopes: they carry their own built-in standards catalog
// selection and are filled by a backend agent that searches the public web for
// genuine released assessment items. Mirrors api/src/domain/types.ts.
// ---------------------------------------------------------------------------

export type PacketFramework = 'ccss' | 'teks' | 'sol' | 'best'

/** One standard chosen from the built-in packet catalog (official wording). */
export interface PacketStandard {
  code: string
  grade: number // 3..8
  domain: string // short domain code within the framework, e.g. 'NBT', 'PFA'
  domainName: string
  text: string
}

/** A released/sample assessment item the web-hunting agent found online. */
export interface HuntedItem {
  id: string
  standardCode: string
  program: string // assessment program, e.g. 'STAAR Grade 4 Mathematics'
  year: number // administration/publication year; 0 when the source does not say
  itemNumber: string // question number or label in the source; '' when unknown
  itemType: 'selected-response' | 'constructed-response' | 'multi-part'
  stem: string
  choices: string[] // empty for constructed response
  answer: string // correct answer as published; '' when the source publishes no key
  sourceUrl: string
  sourceName: string // title of the document or page the item came from
  alignment: 'official' | 'ai-inferred' // 'official' only when the source maps the item to the code
  notes: string
  sourceKey?: string // key of the HuntSource this item was transcribed from; absent on gap-sweep items
  screenshotPaths?: string[] // screenshots-container blob paths of the captured screenshots (in order)
}

/** A released-test document the discovery phase cataloged — the unit of transcription. */
export interface HuntSource {
  key: string // stable `${grade}|${normalized url}` (backend checkpointing)
  program: string
  year: number
  grade: number
  url: string
  title: string
  expectedItems: number // item count the release page states, when it does; 0 = unknown
  note: string
}

export interface EvidencePacket {
  id: string
  title: string
  framework: PacketFramework
  frameworkLabel: string
  grades: number[]
  years: number[] // preferred administration years; [] = any
  standards: PacketStandard[]
  status: 'hunting' | 'complete' | 'failed' | 'cancelled'
  error?: string
  items: HuntedItem[]
  doneBatches: string[] // hunt-batch keys already searched (backend checkpointing)
  sources?: HuntSource[] // released-test documents cataloged by discovery; undefined = discovery not run
  doneSources?: string[] // keys of sources fully transcribed (backend checkpointing)
  doneShots?: string[] // screenshot-capture group keys already processed (backend checkpointing)
  huntJobId?: string // the job that currently owns the hunt (backend ownership token)
  created: string
  updated: string
}

/** Slim row for the packet list view (items can be large; the list stays light). */
export interface PacketSummary {
  id: string
  title: string
  framework: PacketFramework
  frameworkLabel: string
  grades: number[]
  years: number[]
  status: EvidencePacket['status']
  error?: string
  standardCount: number
  itemCount: number
  created: string
  updated: string
}

// ---------------------------------------------------------------------------
// Reference Library — the document repository behind the tool. The four
// document sets a standard set is built from, filed per framework and grade
// (3–8). Mirrors api/src/domain/types.ts.
// ---------------------------------------------------------------------------

export type LibraryRole = 'standards' | 'progression' | 'items' | 'unpacking'

export interface LibraryFile {
  framework: PacketFramework
  grade: number // 3..8
  role: LibraryRole
  fileName: string
  size: number // bytes
  updated: string // ISO timestamp
}

// ---------------------------------------------------------------------------
// Lesson Scope Generation (LSG) — create course vs partial edit (design doc
// "Lesson Scope Generation: Create Course vs Partial Edit"). A course registry
// keyed by course NAME, a snapshot of current course state, and runs whose
// output carries a per-lesson operation (CREATE | UPDATE | DEACTIVATE) that
// the orchestrator persists into the registry. Standalone: no coupling to
// standard sets, scopes, or packets. Mirrors api/src/domain/types.ts.
// ---------------------------------------------------------------------------

export type LsgOperation = 'CREATE' | 'UPDATE' | 'DEACTIVATE'
export type LsgRequestType = 'FULL_COURSE' | 'PARTIAL_UPDATE'
export type LsgMode = 'FULL_COURSE' | 'LESSONS'

/** The DM-bound lesson scope fields the LSG generates (design doc §3, output lessons). */
export interface LsgLessonFields {
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

/** A lesson as persisted in the course registry — the platform owns lessonId (Decision 4). */
export interface LsgCourseLesson extends LsgLessonFields {
  lessonId: string
  unitName: string
  lessonTitle: string
  standardId: string
  lessonOrder: number
  status: 'ACTIVE' | 'INACTIVE'
}

/** One course in the registry. The primary key is the course NAME (Decision 2) — courseId is its slug. */
export interface LsgCourse {
  courseId: string
  courseName: string
  subject: string
  grade: string
  curriculumFramework: string
  /** Display label, e.g. "Texas (TEKS) — Grade 3". */
  standardSet: string
  lessons: LsgCourseLesson[]
  created: string
  updated: string
}

/** Course Snapshot API response (Decision 3) — read-only current course/lesson state. */
export interface LsgSnapshot {
  courseExists: boolean
  course: {
    courseId: string
    courseName: string
    subject: string
    grade: string
    curriculumFramework: string
  } | null
  lessons: LsgCourseLesson[]
}

/** One lesson of the LSG output: operation + identity + generated fields (design doc §3). */
export interface LsgOutputLesson extends Omit<LsgLessonFields, 'releasedItems'> {
  /** Echoed snapshot lessonId for UPDATE/DEACTIVATE; null for CREATE — the platform assigns one on persist. */
  lessonId: string | null
  operation: LsgOperation
  unitName: string
  lessonOrder: number
  /** EXACTLY ONE standard — the most relevant, most granular code of the set. Never a list. */
  standardId: string
  lessonTitle: string
  deactivationReason: string | null
  /** STRICT RULE: released items are ALWAYS an array — one entry per item reference or exemplar. */
  releasedItems: string[]
}

export interface LsgOutput {
  courseOperation: 'CREATE' | 'UPDATE'
  targetCourse: {
    courseId: string | null
    courseName: string
    grade: string
    subject: string
    standardSet: string
  }
  lessons: LsgOutputLesson[]
}

/**
 * One lesson row of an uploaded existing data model (the canonical JSON
 * export shape, keys normalized client-side; missing fields arrive as '').
 * Seeds the course snapshot when the registry has no course under the name.
 */
export interface LsgDataModelLesson extends LsgLessonFields {
  lessonTitle: string
  unitName: string
  standardId: string
  lessonOrder: number
}

/** One Lesson Scope Generation run (the component contract's input + captured snapshot + output). */
export interface LsgRun {
  id: string
  requestType: LsgRequestType
  courseContext: {
    subject: string
    grade: string
    curriculumFramework: string
    courseName: string
  }
  generationScope: {
    mode: LsgMode
    /** Lesson titles selected from the snapshot (mode LESSONS); [] for FULL_COURSE. */
    includedLessons: string[]
    editInstruction: string
  }
  /** Where the pre-edit course state came from when the registry had no course under the name: a published scope or an uploaded data model. */
  source?: { scopeId?: string; scopeTitle?: string; dataModelName?: string }
  status: 'generating' | 'complete' | 'failed'
  error?: string
  /** Snapshot captured when the run was created — stable across worker retries. */
  snapshot?: LsgSnapshot
  output?: LsgOutput
  /** True once the orchestrator persisted the output into the course registry. */
  applied?: boolean
  created: string
  updated: string
}

/** Slim row for the run list (outputs can be large; the list stays light). */
export interface LsgRunSummary {
  id: string
  requestType: LsgRequestType
  courseName: string
  mode: LsgMode
  status: LsgRun['status']
  error?: string
  lessonCount: number
  created: string
  updated: string
}

// ---------------------------------------------------------------------------
// Video Script Generator (VSG). Mirrors api/src/domain/types.ts.
// ---------------------------------------------------------------------------

export type VsgChannel = 'SAY' | 'TEXT' | 'VISUAL' | 'INTERACTION' | 'NOTE'

export type VsgInteractionType = 'mcq' | 'numeric-entry' | 'click-to-highlight' | 'simple-drag'

export interface VsgInteraction {
  type: VsgInteractionType
  prompt: string
  options: string[]
  answer: string
  correctFeedback: string
  try1Hint: string
  try2ShowAndMoveOn: string
  resumeState: string
  modelAccess: boolean
  modelAccessNote: string
}

export interface VsgLine {
  channel: VsgChannel
  content: string
  time?: string // "M:SS" moment the line lands (simultaneous lines share a stamp)
  interaction?: VsgInteraction
}

/** Rulebook v2 kinds plus legacy 'title'/'intro' (scripts stored before v2). */
export type VsgSegmentKind = 'opening' | 'i-do' | 'we-do' | 'discrimination' | 'wrap' | 'title' | 'intro'

export interface VsgSegment {
  kind: VsgSegmentKind
  start: string
  end: string
  purpose: string
  lines: VsgLine[]
}

export interface VsgCaseClass {
  name: string
  status: 'taught' | 'deferred'
  where: string
}

export interface VsgTransferTest {
  stepsDemonstrated: boolean
  caseClassesShown: boolean
  decisionsPerformed: boolean
  note: string
}

export interface VsgConflict {
  id: string
  kind: 'card-internal' | 'card-vs-doctrine' | 'card-vs-playbook' | 'steering'
  summary: string
  sideA: string
  sideB: string
  proposal: string
  rationale: string
  resolution?: string
  resolvedBy?: 'default' | 'custom'
  resolvedAt?: string
}

export interface VideoScript {
  courseId: string
  lessonId: string
  /** The run that authored this stored version (absent on scripts stored before the field existed). */
  runId?: string
  lessonTitle: string
  unitName: string
  standardId: string
  gradeBand: string
  durationEstimate: string
  segments: VsgSegment[]
  interactionCount: number
  formatRefs: string[]
  /** Rulebook v2 coverage note (SEQ 10) — absent on pre-v2 scripts. */
  coverageNote?: VsgCaseClass[]
  /** Rulebook v2 Transfer Test verdict (SEQ 09) — absent on pre-v2 scripts. */
  transferTest?: VsgTransferTest
  qa: { hardFails: string[]; flags: string[] }
  conflictsResolved: VsgConflict[]
  playbookVersion: string
  doctrineVersion: string
  version: number
  created: string
}

export type VsgLessonStatus = 'pending' | 'generating' | 'needs-reconciliation' | 'complete' | 'failed'

export interface VsgRunLesson {
  lessonId: string
  lessonTitle: string
  unitName: string
  lessonOrder: number
  status: VsgLessonStatus
  claimedAt?: string // backend exclusive-claim stamp
  error?: string
  conflicts: VsgConflict[]
  scriptVersion?: number
  /** The produced script's total run time "M:SS" (set when the lesson completes). */
  durationEstimate?: string
}

export interface VsgRun {
  id: string
  courseId: string
  courseName: string
  subject: string
  grade: string
  standardSet: string
  steering: string
  status: 'generating' | 'needs-reconciliation' | 'complete' | 'failed'
  error?: string
  lessons: VsgRunLesson[]
  playbookVersion: string
  doctrineVersion: string
  created: string
  updated: string
}

export interface VsgRunSummary {
  id: string
  courseName: string
  status: VsgRun['status']
  error?: string
  lessonCount: number
  completeCount: number
  needsReconciliationCount: number
  created: string
  updated: string
}

// ---------------------------------------------------------------------------
// Scope Evaluations — the built-in rubric QC layer. Mirrors
// api/src/domain/types.ts and api/src/data/eval-rubric.ts.
// ---------------------------------------------------------------------------

export interface EvalRubricColumn {
  group: string
  heading: string
  rubric: string
  hardGate: boolean
  role: 'admin' | 'rubric' | 'results' | 'sme'
}

export interface EvalCell {
  heading: string
  verdict: string
  note: string
}

export interface ScopeEvaluation {
  scopeId: string
  scopeTitle: string
  values: string[]
  headings?: string[]
  cells: EvalCell[]
  failCount: number
  hardGateFails: string[]
  averageScore: string
  autoVerdict: string
  sme?: string
  smeVerdict?: string
  smeNotes?: string
  smeUpdated?: string
  created: string
  updated: string
}

export interface ScopeEvaluationSummary {
  scopeId: string
  scopeTitle: string
  autoVerdict: string
  failCount: number
  hardGateFails: string[]
  averageScore: string
  smeVerdict?: string
  updated: string
}

/** GET /vsg/courses row — the LSG registry shaped for the course picker. */
export interface VsgCourseRow {
  courseId: string
  courseName: string
  subject: string
  grade: string
  standardSet: string
  activeLessonCount: number
  updated: string
}
