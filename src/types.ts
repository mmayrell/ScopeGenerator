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
  }
}

export interface CoverageWarning {
  id: string
  text: string
  acknowledged: boolean
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

export interface LexiconTerm {
  term: string
  aliases: string[]
  source: string
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
  stem: string // rendered stand-in for the item screenshot
  choices?: string[]
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
  published: boolean
  artifacts: Artifact[]
  warnings: CoverageWarning[]
  tree: StandardNode[]
  items: ItemRecord[]
  lexicons: { representations: LexiconTerm[]; problemTypes: LexiconTerm[] }
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
  status: 'draft' | 'accepted' | 'abandoned'
  rounds: { feedback: string; response: string }[]
}

export interface Scope {
  id: string
  setId: string
  title: string
  request: { mode: 'course' | 'standard' | 'topic'; params: string }
  engineVersion: string
  doctrineVersions: string[]
  status: 'complete' | 'generating'
  version: number
  units: Unit[]
  qc: QCCheck[]
  history: ScopeVersion[]
  proposals: Proposal[]
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

export interface ExemplarAsset {
  n: number
  asset: string
  linkedFrom: string
  role: string
  status: 'resolved' | 'pending'
}
