// Typed HTTP client for the ScopeGenerator backend (docs/backend-architecture.md).
import type {
  EvidencePacket,
  FrameworkDoc,
  LibraryFile,
  LibraryRole,
  LsgCourse,
  LsgDataModelLesson,
  LsgMode,
  LsgRequestType,
  LsgRun,
  LsgRunSummary,
  LsgSnapshot,
  PacketFramework,
  PacketStandard,
  PacketSummary,
  Proposal,
  Scope,
  ScopeEvaluationSummary,
  VideoScript,
  VsgCourseRow,
  VsgRun,
  VsgRunSummary,
  StandardSet,
} from './types'

// ---------- config ----------

const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:7071/api' : '/api')

export const ACCESS_CODE_KEY = 'scopegen-access-code'

export const getAccessCode = (): string | null => localStorage.getItem(ACCESS_CODE_KEY)
export const setAccessCode = (code: string) => localStorage.setItem(ACCESS_CODE_KEY, code)
export const clearAccessCode = () => localStorage.removeItem(ACCESS_CODE_KEY)

// ---------- errors ----------

export class UnauthorizedError extends Error {
  constructor(message = 'unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

// ---------- shared API shapes ----------

export interface JobStatus {
  jobId: string
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet' | 'lsg' | 'vsg' | 'lsg'
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  cancelRequested?: boolean
  stage: string // human-readable current stage, e.g. "Stage 3-4 - Atomization & sequencing"
  stagesDone: number
  totalStages: number
  unitsDone?: number // during card generation
  totalUnits?: number
  error?: string
  log: { at: string; stage: string; detail: string }[]
}

export interface UploadSlotValue {
  files: string[]
  notes: string
}

export interface NewSetUploads {
  standards: UploadSlotValue
  items: UploadSlotValue
  unpacking: UploadSlotValue
  progression: UploadSlotValue
}

export interface RerunResult {
  ok: boolean
  message: string
  guardrail?: { criterion: string; evidence: string }
  jobId?: string
}

// ---------- core fetch ----------

async function request<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = {}
  const code = getAccessCode()
  if (code) headers['x-access-code'] = code

  let payload: BodyInit | undefined
  if (raw !== undefined) {
    headers['content-type'] = 'application/pdf'
    payload = raw
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload })
  } catch {
    throw new Error('Network error - the API is unreachable.')
  }

  if (res.status === 401) throw new UnauthorizedError()
  if (res.status === 404) throw new NotFoundError()
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* non-JSON error body - keep the status message */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

// ---------- endpoints ----------

export const api = {
  health: () => request<{ ok: boolean; version: string }>('GET', '/health'),

  bootstrap: () => request<{ sets: StandardSet[]; scopes: Scope[] }>('GET', '/bootstrap'),

  getSet: (id: string) => request<StandardSet>('GET', `/sets/${encodeURIComponent(id)}`),

  createSet: (name: string, uploads: NewSetUploads) =>
    request<{ id: string }>('POST', '/sets', { name, uploads }),

  uploadPdf: (setId: string, role: string, fileName: string, file: Blob) =>
    request<{ blobPath: string }>(
      'PUT',
      `/uploads/${encodeURIComponent(setId)}/${encodeURIComponent(role)}/${encodeURIComponent(fileName)}`,
      undefined,
      file,
    ),

  acknowledgeWarning: (setId: string, warningId: string, resolution?: string, resolvedBy?: 'default' | 'custom') =>
    request<StandardSet>('POST', `/sets/${encodeURIComponent(setId)}/acknowledge-warning`, {
      warningId,
      resolution,
      resolvedBy,
    }),

  confirmAlignment: (setId: string, itemId: string) =>
    request<StandardSet>('POST', `/sets/${encodeURIComponent(setId)}/confirm-alignment`, { itemId }),

  resolveArtifact: (setId: string, artifactId: string) =>
    request<StandardSet>('POST', `/sets/${encodeURIComponent(setId)}/resolve-artifact`, { artifactId }),

  publishSet: (setId: string) =>
    request<{ set: StandardSet; jobId?: string }>('POST', `/sets/${encodeURIComponent(setId)}/publish`),

  ingestSet: (setId: string) => request<{ jobId: string }>('POST', `/sets/${encodeURIComponent(setId)}/ingest`),

  getSetJob: (setId: string) => request<JobStatus>('GET', `/sets/${encodeURIComponent(setId)}/job`),

  stopIngest: (setId: string) => request<{ jobId: string }>('POST', `/sets/${encodeURIComponent(setId)}/stop-ingest`),

  pauseGeneration: (scopeId: string) =>
    request<{ jobId: string }>('POST', `/scopes/${encodeURIComponent(scopeId)}/pause-generation`),

  resumeGeneration: (scopeId: string) =>
    request<{ jobId: string }>('POST', `/scopes/${encodeURIComponent(scopeId)}/resume-generation`),

  cancelGeneration: (scopeId: string) =>
    request<{ scope: Scope }>('POST', `/scopes/${encodeURIComponent(scopeId)}/cancel-generation`),

  createScope: (
    setIds: string[],
    mode: 'course' | 'standard' | 'topic',
    params: string,
    courseName: string,
    subject: string,
    uploads?: { token: string; names: string[] },
    packetId?: string,
  ) =>
    // setId rides along for deploy-skew compatibility (an older API requires it).
    request<{ id: string; jobId: string }>('POST', '/scopes', {
      setId: setIds[0],
      setIds,
      mode,
      params,
      courseName,
      subject,
      uploadsToken: uploads?.token,
      uploadNames: uploads?.names,
      packetId,
    }),

  /** Released-question PDFs attached to a topic request — uploaded BEFORE createScope (generation starts on create). */
  uploadScopePdf: (token: string, fileName: string, file: Blob) =>
    request<{ blobPath: string }>(
      'PUT',
      `/scope-uploads/${encodeURIComponent(token)}/${encodeURIComponent(fileName)}`,
      undefined,
      file,
    ),

  getScope: (id: string) => request<Scope>('GET', `/scopes/${encodeURIComponent(id)}`),

  getScopeJob: (id: string) => request<JobStatus>('GET', `/scopes/${encodeURIComponent(id)}/job`),

  rerun: (scopeId: string, target: string, mode: string, override?: boolean) =>
    request<RerunResult>('POST', `/scopes/${encodeURIComponent(scopeId)}/rerun`, { target, mode, override }),

  submitReport: (scopeId: string, target: string, text: string) =>
    request<Proposal>('POST', `/scopes/${encodeURIComponent(scopeId)}/reports`, { target, text }),

  iterateProposal: (scopeId: string, proposalId: string, feedback: string) =>
    request<Proposal>(
      'POST',
      `/scopes/${encodeURIComponent(scopeId)}/proposals/${encodeURIComponent(proposalId)}/iterate`,
      { feedback },
    ),

  resolveProposal: (scopeId: string, proposalId: string, accept: boolean) =>
    request<Scope>(
      'POST',
      `/scopes/${encodeURIComponent(scopeId)}/proposals/${encodeURIComponent(proposalId)}/resolve`,
      { accept },
    ),

  deleteScope: (id: string) => request<{ ok: true }>('DELETE', `/scopes/${encodeURIComponent(id)}`),

  deleteSet: (id: string) => request<{ ok: true }>('DELETE', `/sets/${encodeURIComponent(id)}`),

  getFramework: () => request<FrameworkDoc>('GET', '/framework'),

  // ---- Evidence Packets (standalone web-hunting tool) ----

  createPacket: (body: {
    title: string
    framework: PacketFramework
    frameworkLabel: string
    grades: number[]
    years: number[]
    standards: PacketStandard[]
  }) => request<{ packet: EvidencePacket; jobId: string }>('POST', '/packets', body),

  listPackets: () => request<PacketSummary[]>('GET', '/packets'),

  getPacket: (id: string) => request<EvidencePacket>('GET', `/packets/${encodeURIComponent(id)}`),

  getPacketJob: (id: string) => request<JobStatus>('GET', `/packets/${encodeURIComponent(id)}/job`),

  stopPacket: (id: string) => request<{ jobId: string }>('POST', `/packets/${encodeURIComponent(id)}/stop`),

  retryPacket: (id: string) => request<{ jobId: string }>('POST', `/packets/${encodeURIComponent(id)}/retry`),

  deletePacket: (id: string) => request<{ ok: true }>('DELETE', `/packets/${encodeURIComponent(id)}`),

  // ---- Lesson Scope Generation (create course vs partial edit) ----

  /** Course Snapshot API — "does not exist" is a first-class answer, never a 404. */
  lsgSnapshot: (courseName: string) =>
    request<LsgSnapshot>('GET', `/lsg/snapshot?courseName=${encodeURIComponent(courseName)}`),

  listLsgCourses: () => request<LsgCourse[]>('GET', '/lsg/courses'),

  getLsgCourse: (id: string) => request<LsgCourse>('GET', `/lsg/courses/${encodeURIComponent(id)}`),

  deleteLsgCourse: (id: string) => request<{ ok: true }>('DELETE', `/lsg/courses/${encodeURIComponent(id)}`),

  createLsgRun: (body: {
    requestType: LsgRequestType
    courseContext: { subject: string; grade: string; curriculumFramework: string; courseName: string }
    generationScope: { mode: LsgMode; includedLessons: string[]; editInstruction: string }
    /** A published scope to edit — seeds the course state when the registry has no course under the name. */
    sourceScopeId?: string
    /** An uploaded existing data model — seeds the course state (wins over sourceScopeId). */
    dataModel?: { name: string; lessons: LsgDataModelLesson[] }
  }) => request<{ run: LsgRun; jobId: string }>('POST', '/lsg/runs', body),

  listLsgRuns: () => request<LsgRunSummary[]>('GET', '/lsg/runs'),

  getLsgRun: (id: string) => request<LsgRun>('GET', `/lsg/runs/${encodeURIComponent(id)}`),

  getLsgRunJob: (id: string) => request<JobStatus>('GET', `/lsg/runs/${encodeURIComponent(id)}/job`),

  deleteLsgRun: (id: string) => request<{ ok: true }>('DELETE', `/lsg/runs/${encodeURIComponent(id)}`),

  /** Mechanical registry import (no generation): a published scope's lessons become the named course. */
  importScopeCourse: (scopeId: string, courseName: string) =>
    request<{ course: LsgCourse }>('POST', '/lsg/courses/import-scope', { scopeId, courseName }),

  // ---- Video Script Generator ----

  listVsgCourses: () => request<VsgCourseRow[]>('GET', '/vsg/courses'),

  createVsgRun: (body: { courseId: string; lessonIds: string[]; steering: string }) =>
    request<{ run: VsgRun; jobId: string }>('POST', '/vsg/runs', body),

  listVsgRuns: () => request<VsgRunSummary[]>('GET', '/vsg/runs'),

  getVsgRun: (id: string) => request<VsgRun>('GET', `/vsg/runs/${encodeURIComponent(id)}`),

  getVsgRunJob: (id: string) => request<JobStatus>('GET', `/vsg/runs/${encodeURIComponent(id)}/job`),

  deleteVsgRun: (id: string) => request<{ ok: true }>('DELETE', `/vsg/runs/${encodeURIComponent(id)}`),

  deleteVsgLessons: (runId: string, lessonIds: string[]) =>
    request<{ ok: true; removed: number; runDeleted: boolean }>(
      'POST',
      `/vsg/runs/${encodeURIComponent(runId)}/delete-lessons`,
      { lessonIds },
    ),

  reconcileVsgLesson: (
    runId: string,
    lessonId: string,
    resolutions: { conflictId: string; resolution: string; resolvedBy: 'default' | 'custom' }[],
  ) =>
    request<{ jobId: string }>('POST', `/vsg/runs/${encodeURIComponent(runId)}/reconcile`, {
      lessonId,
      resolutions,
    }),

  regenerateVsgLesson: (runId: string, lessonId: string) =>
    request<{ jobId: string }>('POST', `/vsg/runs/${encodeURIComponent(runId)}/regenerate`, { lessonId }),

  getVideoScript: (courseId: string, lessonId: string) =>
    request<VideoScript>('GET', `/vsg/scripts/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`),

  // ---- Scope Evaluations (rubric-sheet QC) ----

  listEvals: () =>
    request<{ sheetUrl: string; connected: boolean; evaluations: ScopeEvaluationSummary[] }>('GET', '/evals'),

  setEvalsWebhook: (webhookUrl: string) =>
    request<{ connected: boolean }>('PUT', '/evals/config', { webhookUrl }),

  runEval: (scopeId: string) => request<{ jobId: string }>('POST', `/evals/${encodeURIComponent(scopeId)}/run`),

  pushEval: (scopeId: string) => request<{ exported: boolean }>('POST', `/evals/${encodeURIComponent(scopeId)}/push`),

  // ---- Reference Library (framework → grade → four document slots) ----

  listLibrary: () => request<{ files: LibraryFile[] }>('GET', '/library'),

  uploadLibraryFile: (framework: PacketFramework, grade: number, role: LibraryRole, fileName: string, file: Blob) =>
    request<{ file: LibraryFile }>(
      'PUT',
      `/library/${framework}/${grade}/${role}/${encodeURIComponent(fileName)}`,
      undefined,
      file,
    ),

  deleteLibraryFile: (framework: PacketFramework, grade: number, role: LibraryRole, fileName: string) =>
    request<{ ok: true }>('DELETE', `/library/${framework}/${grade}/${role}/${encodeURIComponent(fileName)}`),

  /** URL that opens a library PDF in a browser tab — the access code rides as a query param (no headers on navigations). */
  libraryFileUrl: (framework: PacketFramework, grade: number, role: LibraryRole, fileName: string): string =>
    `${API_BASE}/library-file/${framework}/${grade}/${role}/${encodeURIComponent(fileName)}?code=${encodeURIComponent(getAccessCode() ?? '')}`,

  /** URL that downloads a framework source PDF (engine/doctrine) — a navigation, so the access code rides as a query param; the API 302s to a short-lived blob SAS. */
  frameworkFileUrl: (kind: 'engine' | 'doctrine'): string =>
    `${API_BASE}/framework-file/${kind}?code=${encodeURIComponent(getAccessCode() ?? '')}`,

  /** URL for an item's question screenshot — <img> can't send headers, so the access code rides as a query param. */
  itemImageUrl: (setId: string, itemId: string): string =>
    `${API_BASE}/item-image/${encodeURIComponent(setId)}/${encodeURIComponent(itemId)}?code=${encodeURIComponent(getAccessCode() ?? '')}`,

  /** URL for a hunted packet item's captured screenshot (n is 1-based) — same ?code= mechanism as itemImageUrl. */
  packetItemImageUrl: (packetId: string, itemId: string, n = 1): string =>
    `${API_BASE}/packet-item-image/${encodeURIComponent(packetId)}/${encodeURIComponent(itemId)}/${n}?code=${encodeURIComponent(getAccessCode() ?? '')}`,

  /**
   * Long-lived read-only SAS links to item screenshots, keyed
   * "<setId>/<itemId>" (set item bank) or "<packetId>/<itemId>" (packet hunt
   * captures). Used by the CSV/JSON exports: unlike itemImageUrl, these carry
   * no access code, so a shared file's links are safe to distribute.
   */
  itemImageLinks: (items: { setId?: string; packetId?: string; itemId: string }[]) =>
    request<{ links: Record<string, string> }>('POST', '/item-image-links', { items }),

  adminSeed: (force?: boolean) =>
    request<{ seeded: boolean; sets: number; scopes: number }>(
      'POST',
      `/ops/seed${force ? '?force=true' : ''}`,
    ),
}
