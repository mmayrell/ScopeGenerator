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
    mode: 'course' | 'standard' | 'topic'
    params: string
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
export interface LsgOutputLesson extends LsgLessonFields {
  /** Echoed snapshot lessonId for UPDATE/DEACTIVATE; null for CREATE — the platform assigns one on persist. */
  lessonId: string | null
  operation: LsgOperation
  unitName: string
  lessonOrder: number
  standardId: string
  lessonTitle: string
  deactivationReason: string | null
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
// production-ready scripts for ~3-minute DI math videos with checked student
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
  /** Try-1 pinpoint hint. */
  try1Hint: string
  /** Try-2: show the step and move on. */
  try2ShowAndMoveOn: string
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
  interaction?: VsgInteraction
}

export type VsgSegmentKind = 'title' | 'intro' | 'i-do' | 'we-do' | 'wrap'

export interface VsgSegment {
  kind: VsgSegmentKind
  /** Timing estimate "M:SS" from the grade profile's words-per-minute. */
  start: string
  end: string
  /** What this segment accomplishes (one line). */
  purpose: string
  lines: VsgLine[]
}

/** A flagged input contradiction (playbook §2.4) — resolved by the user, never silently. */
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
  /** Grade-band profile applied (playbook §7), e.g. "3-5". */
  gradeBand: string
  /** Total run-time estimate "M:SS" (≤ 3:00). */
  durationEstimate: string
  segments: VsgSegment[]
  interactionCount: number
  /** Stein formats consulted, page-stamped (e.g. "Format 7.6 — ADDING TWO NUMERALS WITH RENAMING (p. 213)"). */
  formatRefs: string[]
  /** Programmatic QA results (playbook §12): hard-fail findings + review flags. */
  qa: { hardFails: string[]; flags: string[] }
  /** Reconciled conflicts recorded in the script header (both sides, rule, resolution, who). */
  conflictsResolved: VsgConflict[]
  playbookVersion: string
  doctrineVersion: string
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
// Scope Evaluations — after every scope generation, an evaluation agent
// scores the scope against the rubric spreadsheet's column headings (the
// rubrics live IN the sheet, fetched at evaluation time, so editing the
// sheet retunes the agent without a deploy) and appends a row. The last
// three columns (SME / SME Verdict / SME Notes) belong to the human reviewer
// and are always left blank. Writes reach Google through a user-provided
// Apps Script webhook; evaluations compute and store locally either way.
// ---------------------------------------------------------------------------

/** One evaluated rubric column: the sheet heading's first line + the agent's cell value. */
export interface EvalCell {
  heading: string
  /** The cell value: '3' | '2' | '1', or the rubric's own categorical term (e.g. 'Accurate'). */
  verdict: string
  /** One-line note (only defects/deviations carry one; '' otherwise). */
  note: string
}

export interface ScopeEvaluation {
  scopeId: string
  scopeTitle: string
  /** The sheet row in column order, truncated BEFORE the trailing SME columns (never pushed). */
  values: string[]
  /** Headings the row was built against (same truncation) — the push endpoint 409s on drift. */
  headings?: string[]
  cells: EvalCell[]
  /** Computed results: fails, hard-gate fails (bold ** headings scored 1), average, verdict. */
  failCount: number
  hardGateFails: string[]
  averageScore: string
  autoVerdict: string
  /** 'pending-export' until the webhook accepts the row; 'exported' after. */
  exportStatus: 'pending-export' | 'exported'
  exportError?: string
  created: string
  updated: string
}

/** Slim row for the evaluations list. */
export interface ScopeEvaluationSummary {
  scopeId: string
  scopeTitle: string
  autoVerdict: string
  failCount: number
  hardGateFails: string[]
  averageScore: string
  exportStatus: ScopeEvaluation['exportStatus']
  exportError?: string
  updated: string
}

export type JobKind = 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet' | 'lsg' | 'vsg' | 'eval'

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
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'lexicon' | 'hunt' // 'run' for single-step kinds (incl. kinds 'lsg' and 'vsg'); 'lexicon' only for legacy queued messages; 'hunt' for kind 'packet'
  scopeId?: string
  setId?: string
  packetId?: string
  lsgRunId?: string // for kind 'lsg'
  vsgRunId?: string // for kind 'vsg'
  unitIndex?: number // for step 'cards'
  payload?: Record<string, unknown> // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
