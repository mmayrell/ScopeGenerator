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

export interface DecisionEntry {
  n: number
  type: DecisionType
  rule: string // P#/A#
  text: string
  citations: Citation[]
  flags?: ('thin-evidence' | 'ai-proposed' | 'inferred')[]
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
}

export interface Lesson {
  id: string // e.g. U3.L3
  title: string
  type: LessonType
  locked: boolean
  evidenceStatus: 'observed' | 'inferred' | 'mixed'
  fields: {
    standards: CardField
    cluster: CardField
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
  generatedExemplar?: GeneratedExemplar
  decisions: DecisionEntry[]
  pendingRelationalUpdate?: string // queued suggestion on a locked lesson
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
}

export interface Scope {
  id: string
  setId: string
  title: string
  request: { mode: 'course' | 'standard' | 'topic'; params: string }
  engineVersion: string
  doctrineVersions: string[]
  status: 'complete' | 'generating' | 'failed'
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

export interface ExemplarAsset {
  n: number
  asset: string
  linkedFrom: string
  role: string
  status: 'resolved' | 'pending'
  uploadedFile?: string
}

/** One governing framework document (engine or doctrine BrainLift). Locked as-is until the user edits. */
export interface FrameworkSection {
  kind: 'engine' | 'doctrine'
  name: string
  version: string
  updated: string
  content: string // rendered as lightweight markdown: '## ' headings, '- ' bullets, blank-line paragraphs
}

/** The full governing framework the tool runs under, persisted as one document. */
export interface FrameworkDoc {
  engine: FrameworkSection
  doctrine: FrameworkSection
  register: ExemplarAsset[]
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

export type JobKind = 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest'

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
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'lexicon' // 'run' for single-step kinds; 'lexicon' only for legacy queued messages
  scopeId?: string
  setId?: string
  unitIndex?: number // for step 'cards'
  payload?: Record<string, unknown> // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
