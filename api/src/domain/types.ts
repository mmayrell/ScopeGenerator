// Data model per spec §5 — verbatim copy of src/types.ts with the contract edits
// (docs/backend-architecture.md → "Shared types"):
//   1. Scope.status gains 'failed'
//   2. Proposal.status gains 'drafting'
//   3. Proposal gains optional working?: boolean
//   4. Scope gains optional error?: string
// plus the contract-only backend types appended at the end (JobStatus, JobMessage,
// NewSetUploads, Scope.protectedBoundaries).

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
 * The five Kinds of Lessons of the Atomization Guide (Engine v4.3) — the
 * lesson's instructional purpose, never its importance/duration/position:
 * stein-exact (the exact lesson described in Stein's book — a direct
 * instructional match) · new-learning (one new behavior, defined by the atom
 * triple) · test-rigor (inserted to explicitly provide state testing rigor) ·
 * bridge (inserted where a split pair is confusable — the discrimination
 * itself, mixed look-alike practice, no new rules) · application-tier (an
 * already-mastered routine in a new demand band; boundary/ceiling inherit
 * from the parent atom). 'preskill' and 'representation' are LEGACY values —
 * found only on scopes generated under Engine ≤ v4.2, never emitted by new
 * generations (those atoms now type stein-exact or new-learning).
 */
export type LessonType = 'stein-exact' | 'new-learning' | 'test-rigor' | 'bridge' | 'application-tier' | 'preskill' | 'representation'

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
  /**
   * The student-facing title: easier to process WITHOUT losing mathematical
   * precision — same observable behavior, mathematical object, and
   * distinguishing constraints as `title`; no nicknames or invented strategy
   * names; may be identical to `title` when it is already clear and
   * grade-appropriate. The JSON export uses it as lessonTitle. Optional only
   * for scopes generated before the field existed.
   */
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
  /** Lesson type (atom webs) — one of the LessonType values. */
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
  working?: boolean // true while Claude is drafting/iterating/applying
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
    /** 'course' = complete course (whole grade); 'supplemental' = only the lessons of the target framework(s) that differ from or extend beyond the baseline set's core course. */
    mode: 'course' | 'standard' | 'topic' | 'supplemental'
    params: string
    /** Supplemental mode only: the set (among setIds) that is the core/baseline course (typically CCSS) — the other selected set(s) are the target framework(s) whose delta is scoped. */
    baselineSetId?: string
    /** User-entered course name (e.g. "Grade 4 Mathematics"). Optional only on scopes created before the field existed. */
    courseName?: string
    /** User-entered subject (e.g. "Mathematics"). Optional only on scopes created before the field existed. */
    subject?: string
    /** LEGACY (removed toggle) — present on scopes generated before granularity moved to the engine document; ignored by the pipeline. */
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
  creator: string
  updated: string
  protectedBoundaries?: string[][] // lesson-id pairs protected by a hard split criterion
  /**
   * The three-tier coherence webs (atom webs per unit, the unit web, the
   * grade progression web), built at finalize from the plan's dependency
   * extraction. Optional only on scopes generated before dependency mapping
   * existed. Self-contained: nodes carry their own labels/metadata, so the
   * webs render even if later reruns reshape the units.
   */
  coherence?: CoherenceWeb[]
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
// Backend contract types (docs/backend-architecture.md)
// ---------------------------------------------------------------------------

export interface UploadSlotValue {
  files: string[]
  notes: string
}

/** Mirrors the shape assembled by the New Standard Set flow (src/store.tsx). */
export interface NewSetUploads {
  standards: UploadSlotValue
  items: UploadSlotValue
  unpacking: UploadSlotValue
  progression: UploadSlotValue
}

// ---------------------------------------------------------------------------
// Evidence packets — a standalone web-hunting tool. Packets are NOT connected
// to standard sets or scopes: they carry their own built-in standards catalog
// selection and are filled by a backend agent that searches the public web for
// genuine released assessment items.
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
  /** Assessment program, e.g. 'STAAR Grade 4 Mathematics'. */
  program: string
  /** Administration or publication year; 0 when the source does not say. */
  year: number
  /** Question number or label in the source document; '' when unknown. */
  itemNumber: string
  itemType: 'selected-response' | 'constructed-response' | 'multi-part'
  stem: string
  choices: string[] // empty for constructed response
  /** Correct answer as published; '' when the source publishes no key. */
  answer: string
  sourceUrl: string
  /** Title of the document or page the item came from. */
  sourceName: string
  /** 'official' only when the source itself maps the item to the standard code. */
  alignment: 'official' | 'ai-inferred'
  notes: string
  /**
   * Key of the HuntSource this item was transcribed from (document-first
   * hunt). Absent on gap-sweep items and on items hunted before sources
   * existed.
   */
  sourceKey?: string
  /**
   * Blob paths (screenshots container, `<packetId>/<itemId>/<n>.png`) of the
   * item's actual screenshots, cropped out of the source PDF by the capture
   * phase. Absent when capture has not run or the item could not be located.
   */
  screenshotPaths?: string[]
}

/**
 * A released-test document the discovery phase cataloged — the unit of
 * transcription. One entry per (document, grade): the transcription phase
 * opens the document and transcribes EVERY in-scope item it holds.
 */
export interface HuntSource {
  /** Stable key `${grade}|${normalized url}` — checkpointing across executions. */
  key: string
  program: string
  year: number
  grade: number
  url: string
  title: string
  /** Item count the release page/document states, when it does; 0 = unknown. */
  expectedItems: number
  note: string
}

export interface EvidencePacket {
  id: string
  title: string
  framework: PacketFramework
  frameworkLabel: string
  grades: number[]
  /** Preferred administration years; [] = any year. */
  years: number[]
  standards: PacketStandard[]
  status: 'hunting' | 'complete' | 'failed' | 'cancelled'
  error?: string
  items: HuntedItem[]
  /** Hunt-batch keys already searched — checkpointing across 10-minute executions. */
  doneBatches: string[]
  /**
   * Released-test documents the discovery phase cataloged. undefined = the
   * discovery phase has not run yet (also the state a deepen re-hunt resets
   * to so discovery re-catalogs; doneSources keeps transcribed documents
   * from being paid for twice).
   */
  sources?: HuntSource[]
  /** Keys of sources fully transcribed — checkpointing across executions. */
  doneSources?: string[]
  /** Screenshot-capture group keys already processed — checkpointing across executions. */
  doneShots?: string[]
  /**
   * The job that currently owns the hunt. A retry re-dispatches with a new
   * job id; a superseded execution (stale cancel, redelivered message) must
   * abandon at its next checkpoint instead of mutating the packet. Optional
   * only for packets created before the field existed.
   */
  huntJobId?: string
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
// (3–8), living as blobs under uploads/library/... . Listing is derived from
// storage (no index document).
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
// Video Script Generator (VSG) — turns generated lesson cards into
// production-ready scripts for 2-5 minute (by grade band) DI math videos with checked student
// interactions, per the versioned "No-HITL DI Video Script Generator Playbook".
// Courses come from the LSG registry; scripts are stored per (course, lesson)
// with a version, stamped with the playbook + doctrine versions they ran
// under. Conflict handling is flag → propose → reconcile: generation never
// silently resolves a contradiction in its inputs.
// ---------------------------------------------------------------------------

/** Script line channels (playbook §3) — every line carries exactly one. */
export type VsgChannel = 'SAY' | 'TEXT' | 'VISUAL' | 'INTERACTION' | 'NOTE'

export type VsgInteractionType = 'mcq' | 'numeric-entry' | 'click-to-highlight' | 'simple-drag'

/** A checked student interaction (playbook §8) — structured, never prose. */
export interface VsgInteraction {
  type: VsgInteractionType
  /** Names exactly what is asked, restating the on-screen question. */
  prompt: string
  /** MCQ options in order (letter IDs implied by position); [] for other types. */
  options: string[]
  /** Accepted answer: the correct option letter, the numeric answer, or the target/move description. */
  answer: string
  correctFeedback: string
  /** Try-1 pinpoint hint — the ONLY authored retry (INT 18, rulebook v2.4): a second wrong answer auto-shows the correct step. */
  try1Hint: string
  /** Legacy try-2 show-and-move-on line — only on scripts generated before rulebook v2.4. */
  try2ShowAndMoveOn?: string
  /** The exact frame state on resume. */
  resumeState: string
  /** Whether "Replay last step / Show model" is offered (false only for lesson-independent checks). */
  modelAccess: boolean
  /** What the model replay shows, or why access is not needed. */
  modelAccessNote: string
}

/** One channel-tagged script line; INTERACTION lines carry the structured block. */
export interface VsgLine {
  channel: VsgChannel
  /** The line's content (for INTERACTION lines: a one-line label, e.g. "3 of 7 · Numeric entry · step result"). */
  content: string
  /** "M:SS" moment the line lands (simultaneous lines share a stamp). */
  time?: string
  /** Two-digit slide number ("01"…) per §15 Formatting — absent on scripts stored before slides existed. */
  slide?: string
  interaction?: VsgInteraction
}

/**
 * One numbered slide of the §15 Formatting contract — one stable
 * learner-facing canvas with one instructional focus. The header fields are
 * production metadata, never shown or spoken to the student; `title` is the
 * student-facing slide title (also the slide's opening [TEXT] line).
 */
export interface VsgSlide {
  /** Two-digit slide number, "01"… */
  number: string
  title: string
  slideType: 'Opening' | 'Concept' | 'Example' | 'Practice' | 'Wrap'
  canvas: 'NEW' | 'CONTINUES'
  /** The slide this canvas continues from when canvas is CONTINUES; '' when NEW. */
  continuesFrom: string
}

/**
 * Rulebook v2 skeleton (§15): the opening absorbs the old title+intro
 * (title portion ≤ 10s inside it, TIM 03), the discrimination pass is a
 * first-class optional segment, and extra i-do/we-do segments may repeat
 * before the wrap when the Transfer Test needs more examples. Legacy kinds
 * 'title'/'intro' survive on scripts stored before v2.
 */
export type VsgSegmentKind = 'opening' | 'i-do' | 'we-do' | 'discrimination' | 'wrap' | 'title' | 'intro'

export interface VsgSegment {
  kind: VsgSegmentKind
  /** Timing estimate "M:SS" from the grade profile's words-per-minute. */
  start: string
  end: string
  /** What this segment accomplishes (one line). */
  purpose: string
  lines: VsgLine[]
}

/**
 * One case class the taught strategy claims inside the card's boundary —
 * the machine-readable coverage note (rulebook SEQ 09–SEQ 11): taught in
 * this video, or deferred downstream (named, never silently dropped).
 */
export interface VsgCaseClass {
  /** The case class in concrete terms (e.g. "regroup from the ones column"). */
  name: string
  status: 'taught' | 'deferred'
  /** Where it is taught (segment) or where it is deferred to (quiz mixed set, later lesson, practice). */
  where: string
}

/** The Transfer Test verdict (rulebook SEQ 09) — the sufficiency bar the script was built to. */
export interface VsgTransferTest {
  /** Every step of the strategy demonstrated on at least one example. */
  stepsDemonstrated: boolean
  /** Every claimed case class shown at least once (or deferred in the coverage note). */
  caseClassesShown: boolean
  /** The student performed every decision and computation type under guidance. */
  decisionsPerformed: boolean
  /** One-line note when any leg is false (what is missing and why). */
  note: string
}

/**
 * A flagged input contradiction (playbook §13.4). Since rulebook v2.5 these
 * auto-resolve in-run with the authority-stack default (Stein strictly
 * supreme; resolvedBy 'default') — user reconciliation ('custom') survives
 * only on legacy runs. Always recorded on the script header, never silent.
 */
export interface VsgConflict {
  id: string
  kind: 'card-internal' | 'card-vs-doctrine' | 'card-vs-playbook' | 'steering'
  /** One line: why generation cannot proceed cleanly. */
  summary: string
  /** Both sides, citing the exact fields / doctrine formats-pages involved. */
  sideA: string
  sideB: string
  /** The proposed default resolution (always offered). */
  proposal: string
  /** One-line rationale derived from the precedence rules. */
  rationale: string
  /** Filled when reconciled. */
  resolution?: string
  resolvedBy?: 'default' | 'custom'
  resolvedAt?: string
}

/** One production-ready video script for one lesson (the production contract). */
export interface VideoScript {
  courseId: string
  lessonId: string
  /**
   * The run that authored this stored version — the ownership proof for
   * permanent deletion. Version numbers recycle after a delete (the counter
   * lives in the blob), so only this id can say whose script the blob holds.
   * Optional: scripts stored before the field existed lack it.
   */
  runId?: string
  lessonTitle: string
  unitName: string
  standardId: string
  /** Grade-band profile applied (rulebook GRADE table), e.g. "4-5". */
  gradeBand: string
  /** Total run-time estimate "M:SS" — length is an OUTPUT (TIM 01): typical 2–5 min by band, >6:00 flags granularity. */
  durationEstimate: string
  /** The §15 slide registry (lines reference these by number) — absent on scripts stored before slides existed. */
  slides?: VsgSlide[]
  segments: VsgSegment[]
  interactionCount: number
  /** Stein formats consulted, page-stamped (e.g. "Format 7.6 — ADDING TWO NUMERALS WITH RENAMING (p. 213)"). */
  formatRefs: string[]
  /** The coverage note (SEQ 10): every case class taught or deferred. Absent on pre-v2 scripts. */
  coverageNote?: VsgCaseClass[]
  /** The Transfer Test verdict (SEQ 09). Absent on pre-v2 scripts. */
  transferTest?: VsgTransferTest
  /** Programmatic QA results (rulebook §17, findings cite rule IDs): hard-fail findings + review flags. */
  qa: { hardFails: string[]; flags: string[] }
  /** Reconciled conflicts recorded in the script header (both sides, rule, resolution, who). */
  conflictsResolved: VsgConflict[]
  playbookVersion: string
  doctrineVersion: string
  /** The Mathematical Language Style Guide version the script generated under. Absent on scripts generated before the guide was adopted. */
  langGuideVersion?: string
  /** Per (course, lesson) version counter. */
  version: number
  created: string
}

export type VsgLessonStatus = 'pending' | 'generating' | 'needs-reconciliation' | 'complete' | 'failed'

/** Per-lesson state inside a run; the script itself lives in its own blob. */
export interface VsgRunLesson {
  lessonId: string
  lessonTitle: string
  unitName: string
  lessonOrder: number
  status: VsgLessonStatus
  /**
   * Exclusive-claim stamp: set when an execution takes the lesson. A
   * 'generating' lesson is reclaimable only when this is stale (host-killed
   * execution) — concurrent duplicate deliveries must not double-generate.
   */
  claimedAt?: string
  error?: string
  /** Open + resolved conflicts for this lesson (resolutions persist and pre-fill regeneration). */
  conflicts: VsgConflict[]
  /** Version of the script this run produced (set when status is complete). */
  scriptVersion?: number
  /** The produced script's total run time "M:SS" (set when status is complete) — the run list shows it. */
  durationEstimate?: string
}

export interface VsgRun {
  id: string
  courseId: string
  courseName: string
  subject: string
  grade: string
  standardSet: string
  /** Optional user steering — steers below doctrine, never overrides it. */
  steering: string
  status: 'generating' | 'needs-reconciliation' | 'complete' | 'failed'
  error?: string
  lessons: VsgRunLesson[]
  playbookVersion: string
  doctrineVersion: string
  created: string
  updated: string
}

/** Slim row for the run list (scripts are large; the list stays light). */
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
// The QC Bar (spec: "Scope Generator: Quality Control and Loop Engineering",
// adopted 2026-07-17 — supersedes the four-gate on-demand system). The Bar is
// the USER-EDITABLE rubric every lesson card and course must satisfy: the
// writer drafts with the blocking criteria in hand, an independent judge
// cold-reads every card against the bar during generation, failing cards run
// the bounded revise → fresh-start escalation plan, and the survivors either
// pass or carry an explicit red flag. The QC Report per scope is produced
// automatically by generation; "Run QC sweep" applies the current bar to an
// existing scope as a NEW numbered version. Notes + investigations route
// confirmed problems to their real cause: the card (repair diff — accepting
// APPLIES it as a new version and re-checks), the bar (drafted criterion +
// deck card), or the specifications (contradiction report).
// ---------------------------------------------------------------------------

/** Blocking: the card must be revised until this passes. Advisory: noted in the report, never forces revision. */
export type QcSeverity = 'blocking' | 'advisory'

/** Where a note/finding lives: scope-level when all fields are absent. */
export interface QcLocation {
  unitId?: string
  lessonId?: string
  field?: string
}

/** One criterion of the QC Bar — a rubric line for a strict grader. */
export interface QcCriterion {
  id: string
  title: string
  /** The rule as written: the failure condition the judge applies and (when shownToWriter) the writer drafts against. */
  rule: string
  level: 'lesson' | 'course'
  /** Automatic = a built-in mechanical check (autoCheckId names it); ai-judged = the rule text applied by the independent judge. */
  method: 'automatic' | 'ai-judged'
  /** Binds an automatic criterion to its built-in mechanical check. */
  autoCheckId?: string
  severity: QcSeverity
  /** Whether the rule appears in the writer's rubric — prevention beats repair; leave off for pure tests the writer can't study for. */
  shownToWriter: boolean
  enabled: boolean
  /** Track record, accumulated by generation runs and deck tests. */
  stats: {
    firstDraftFails: number
    /** How many lessons this criterion has judged (denominator for the fail rate). */
    judgedLessons: number
    redFlagInvolvements: number
    lastDeckRun?: { caught: number; missed: number; at: string }
  }
}

/** The escalation plan: the bounded order of repair attempts after a failed check. */
export type QcPlanStep = 'revise' | 'fresh-start'

/** The QC Bar document — ONE per deployment, versioned on every save; reports record the barVersion they were graded against. */
export interface QcBar {
  barVersion: number
  criteria: QcCriterion[]
  escalationPlan: QcPlanStep[]
  updated: string
}

/** A deliberately broken card in the test deck, labeled with what the bar should catch. */
export interface QcDeckCard {
  id: string
  label: string
  expectedCriterionIds: string[]
  lesson: Lesson
  source: 'built-in' | 'added'
  added: string
}

export interface QcDeck {
  cards: QcDeckCard[]
  updated: string
}

/** One criterion failure (or advisory) recorded on a check. */
export interface QcFindingLite {
  criterionId: string
  title: string
  severity: QcSeverity
  /** The judge's evidence ("the boundary says X, which permits reading Y") or the mechanical check's detail. */
  evidence: string
  /** The concrete revision instruction (ai-judged failures). */
  revisionInstruction?: string
}

/** One entry of a red-flagged card's attempt history. */
export interface QcAttempt {
  attempt: number
  kind: 'draft' | 'revise' | 'fresh-start'
  /** Blocking criterion ids that failed on this attempt. */
  failedBlocking: string[]
  note: string
}

/** Built to answer "what should I do about this card?" fast. */
export interface QcRedFlagReport {
  whyStopped: 'attempts-exhausted' | 'stalled' | 'fresh-start-no-better'
  /** Criteria that failed on EVERY attempt — a real problem, or a criterion impossible as written. */
  neverPassed: string[]
  /** Two criteria the card ping-ponged between, when detected. */
  fighting?: [string, string]
  attemptHistory: QcAttempt[]
  recommendation: string
}

/** Per-lesson outcome in the QC Report. */
export interface QcLessonResult {
  lessonId: string
  title: string
  status: 'passed' | 'red-flag'
  /** Attempts consumed (1 = passed on the first draft). */
  attempts: number
  advisories: QcFindingLite[]
  /** Every criterion the FIRST DRAFT failed (advisories included) — feeds the top-failing-criteria table and the bar's track record. */
  firstDraftFailedIds?: string[]
  redFlag?: QcRedFlagReport
}

/**
 * The QC Report — one per scope, produced automatically by generation (origin
 * 'generation') or by Run QC sweep on an existing scope (origin 'sweep',
 * which saves the improved scope as a NEW numbered version).
 */
export interface QcReport {
  scopeId: string
  scopeTitle: string
  origin: 'generation' | 'sweep'
  status: 'running' | 'complete' | 'failed'
  error?: string
  /** The bar version this report was graded against. */
  barVersion: number
  /** scope.updated when the report finished — the scope version it attaches to. */
  scopeVersion: string
  lessons: QcLessonResult[]
  /** Course-level failures no single lesson could fix (course red flags) + course advisories. */
  courseFindings: QcFindingLite[]
  passedFirstTry: number
  redFlagCount: number
  advisoryCount: number
  topFailingCriteria: { criterionId: string; title: string; failCount: number }[]
  created: string
  updated: string
}

export type QcNoteType = 'rigor' | 'granularity' | 'sequencing' | 'wording' | 'evidence' | 'contradiction' | 'other'

/** A human note on a field/card/unit/scope — costs nothing, changes nothing, until an investigation runs. */
export interface QcNote {
  id: string
  location: QcLocation
  type: QcNoteType
  note: string
  scopeVersion: string
  status: 'open' | 'investigating' | 'confirmed' | 'defended'
  raised: string
  resolution?: {
    investigationId: string
    verdict: 'confirmed' | 'defended'
    /** Confirmed: the evidence + where it was routed. Defended: the citations that justify the original decision. */
    rationale: string
    rootCause?: 'card' | 'bar' | 'specifications'
  }
}

export interface QcNoteLedger {
  scopeId: string
  notes: QcNote[]
  updated: string
}

/** Accept/edit/reject on a proposed repair. ACCEPTING APPLIES IT: the fix lands as a new scope version and re-runs the bar before the report updates. */
export interface QcRepairDecision {
  repairIndex: number
  decision: 'accept' | 'edit' | 'reject'
  editedText?: string
  reason: string
  decided: string
  /** Set when an accepted repair was applied: the scope version it produced. */
  appliedVersion?: number
}

/** A proposed card repair — a before/after diff. */
export interface QcProposedRepair {
  lessonId: string
  field: string
  currentExcerpt: string
  proposedText: string
  decisionRecord: string
}

/** A criterion the investigation drafted because the bar should have caught the confirmed problem. */
export interface QcProposedCriterion {
  title: string
  rule: string
  level: 'lesson' | 'course'
  severity: QcSeverity
  /** Lesson whose defect taught the bar — added to the test deck on accept. */
  offendingLessonId: string
  decision?: { decision: 'accept' | 'reject'; reason: string; decided: string }
}

/** The card faithfully reflects a genuine contradiction in the source documents — the ruling is the human's; the fix happens upstream. */
export interface QcContradictionReport {
  passageA: { quote: string; citation: string }
  passageB: { quote: string; citation: string }
  readingTaken: string
  affectedLessons: string[]
}

export interface QcInvestigation {
  id: string
  scopeId: string
  noteIds: string[]
  status: 'running' | 'complete' | 'failed'
  error?: string
  verdicts: {
    noteId: string
    verdict: 'confirmed' | 'defended'
    /** Confirmed problems route to their real cause: card | bar | specifications. */
    rootCause?: 'card' | 'bar' | 'specifications'
    rationale: string
  }[]
  /** Confirmed defect classes swept across the whole scope — unnoted cards carrying the same defect. */
  patternSweep: { defectClass: string; additionalCards: { lessonId: string; field: string; evidence: string }[] }[]
  proposedRepairs: QcProposedRepair[]
  repairDecisions: QcRepairDecision[]
  proposedCriteria: QcProposedCriterion[]
  contradictionReports: QcContradictionReport[]
  created: string
  updated: string
}

export interface QcInvestigationLog {
  scopeId: string
  investigations: QcInvestigation[]
  updated: string
}

/** Slim row for the QC reports list. */
export interface QcReportSummary {
  scopeId: string
  scopeTitle: string
  origin: QcReport['origin']
  status: QcReport['status']
  barVersion: number
  lessonCount: number
  passedFirstTry: number
  redFlagCount: number
  advisoryCount: number
  openNoteCount: number
  updated: string
}

export type JobKind = 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet' | 'lsg' | 'vsg' | 'eval' | 'qc'

export interface JobStatus {
  jobId: string
  kind: JobKind
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  /** Set by POST /sets/{id}/stop-ingest; the worker halts at its next checkpoint. */
  cancelRequested?: boolean
  stage: string // human-readable current stage, e.g. "Stage 3–4 — Atomization & sequencing"
  stagesDone: number // 0..totalStages
  totalStages: number
  unitsDone?: number // during card generation
  totalUnits?: number
  error?: string
  log: { at: string; stage: string; detail: string }[]
}

/** Queue message on `genjobs` (JSON, base64-encoded on the wire). */
export interface JobMessage {
  jobId: string
  kind: JobKind
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'lexicon' | 'hunt' | 'investigate' | 'sweep' // 'run' for single-step kinds (incl. 'lsg', 'vsg'); kind 'qc' uses 'sweep' (bar sweep of an existing scope) and 'investigate'; 'lexicon'/'run'-for-qc only for legacy queued messages; 'hunt' for kind 'packet'
  scopeId?: string
  setId?: string
  packetId?: string
  lsgRunId?: string // for kind 'lsg'
  vsgRunId?: string // for kind 'vsg'
  unitIndex?: number // for step 'cards'
  payload?: Record<string, unknown> // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
