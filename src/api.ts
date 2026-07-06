// Typed HTTP client for the ScopeGenerator backend (docs/backend-architecture.md).
import type {
  EvidencePacket,
  FrameworkDoc,
  LibraryFile,
  LibraryRole,
  PacketFramework,
  PacketStandard,
  PacketSummary,
  Proposal,
  Scope,
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
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet'
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

  createScope: (setIds: string[], mode: 'course' | 'standard' | 'topic', params: string) =>
    // setId rides along for deploy-skew compatibility (an older API requires it).
    request<{ id: string; jobId: string }>('POST', '/scopes', { setId: setIds[0], setIds, mode, params }),

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

  /** URL for an item's question screenshot — <img> can't send headers, so the access code rides as a query param. */
  itemImageUrl: (setId: string, itemId: string): string =>
    `${API_BASE}/item-image/${encodeURIComponent(setId)}/${encodeURIComponent(itemId)}?code=${encodeURIComponent(getAccessCode() ?? '')}`,

  adminSeed: (force?: boolean) =>
    request<{ seeded: boolean; sets: number; scopes: number }>(
      'POST',
      `/ops/seed${force ? '?force=true' : ''}`,
    ),
}
