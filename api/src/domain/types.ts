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
  inferred?: boolean
}

export type LessonType = 'new-learning' | 'bridge' | 'application-tier'

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
    /** Minimal-complete mastery objectives (field 3). Optional only for scopes generated before the field existed. */
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
  decisions: DecisionEntry[]
}

export interface Unit {
  id: string
  title: string
  rationale: string
  strand: string
  lessons: Lesson[]
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
  request: { mode: 'course' | 'standard' | 'topic'; params: string }
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

export type JobKind = 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet'

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
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'lexicon' | 'hunt' // 'run' for single-step kinds; 'lexicon' only for legacy queued messages; 'hunt' for kind 'packet'
  scopeId?: string
  setId?: string
  packetId?: string
  unitIndex?: number // for step 'cards'
  payload?: Record<string, unknown> // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
