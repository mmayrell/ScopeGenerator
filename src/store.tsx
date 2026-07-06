/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Proposal, Scope, StandardSet } from './types'
import {
  api,
  clearAccessCode,
  getAccessCode,
  NotFoundError,
  setAccessCode,
  UnauthorizedError,
  type JobStatus,
  type NewSetUploads,
  type RerunResult,
} from './api'
import { Btn } from './ui'

export type { JobStatus, NewSetUploads, RerunResult, UploadSlotValue } from './api'

/** A real file selected for upload, keyed by its NewSetUploads slot. */
export interface NewSetFile {
  role: keyof NewSetUploads
  file: File
}

interface Store {
  sets: StandardSet[]
  scopes: Scope[]
  loading: boolean
  error: string | null
  actionError: string | null
  clearActionError: () => void
  refresh: () => Promise<void>
  refreshScope: (id: string) => Promise<Scope | undefined>
  refreshSet: (id: string) => Promise<StandardSet | undefined>
  fetchJob: (scopeId: string) => Promise<JobStatus>
  createSet: (name: string, uploads: NewSetUploads, files?: NewSetFile[]) => Promise<string>
  acknowledgeWarning: (
    setId: string,
    warningId: string,
    resolution?: string,
    resolvedBy?: 'default' | 'custom',
  ) => Promise<void>
  confirmAlignment: (setId: string, itemId: string) => Promise<void>
  resolveArtifact: (setId: string, artifactId: string) => Promise<void>
  publishSet: (setId: string) => Promise<{ jobId?: string }>
  rerun: (scopeId: string, target: string, mode: string, override?: boolean) => Promise<RerunResult>
  createScope: (setIds: string[], mode: 'course' | 'standard' | 'topic', params: string) => Promise<string>
  submitReport: (scopeId: string, target: string, text: string) => Promise<Proposal>
  iterateProposal: (scopeId: string, proposalId: string, feedback: string) => Promise<void>
  resolveProposal: (scopeId: string, proposalId: string, accept: boolean) => Promise<void>
  deleteScope: (scopeId: string) => Promise<boolean>
  deleteSet: (setId: string) => Promise<boolean>
}

const Ctx = createContext<Store | null>(null)

export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

/** True while a scope still has server-side work in flight (generation, rerun, or a drafting proposal). */
export const scopeUnsettled = (s: Scope) =>
  s.status === 'generating' || s.proposals.some((p) => p.working || p.status === 'drafting')

/** Poll the given scopes' documents every 2s while mounted. Pass only the ids that are unsettled. */
export function useScopePolling(ids: string[]) {
  const { refreshScope } = useStore()
  const key = [...ids].sort().join('|')
  useEffect(() => {
    if (!key) return
    const targets = key.split('|')
    const t = setInterval(() => {
      for (const id of targets) void refreshScope(id)
    }, 2000)
    return () => clearInterval(t)
  }, [key, refreshScope])
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

// ---------- access gate ----------

function AccessGate({ error, onSubmit }: { error: string | null; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex h-screen items-center justify-center bg-paper px-6">
      <div className="animate-rise w-full max-w-sm rounded-2xl border border-hairline bg-panel p-8 shadow-(--shadow-float)">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-[15px] font-bold text-white">
            S
          </div>
          <div>
            <div className="font-display text-[15px] leading-5 font-semibold text-ink">Scope Generator</div>
            <div className="font-mono text-[10px] tracking-wide text-ink-3">evidence-locked scoping</div>
          </div>
        </div>
        <p className="mt-5 text-[13px] leading-relaxed text-ink-2">Enter the access code to continue.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) onSubmit(value.trim())
          }}
        >
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Access code"
            className="mt-3 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
          {error && <p className="mt-2 text-[12px] leading-snug text-rust">{error}</p>}
          <div className="mt-4 flex justify-end">
            <Btn kind="primary" disabled={!value.trim()}>
              Continue
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------- provider ----------

export function StoreProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<string | null>(() => getAccessCode())
  const [authError, setAuthError] = useState<string | null>(null)
  const [sets, setSets] = useState<StandardSet[]>([])
  const [scopes, setScopes] = useState<Scope[]>([])
  const [loading, setLoading] = useState<boolean>(() => getAccessCode() !== null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Any UnauthorizedError anywhere clears the stored code and re-opens the gate.
  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearAccessCode()
        setCodeState(null)
        setAuthError('Access code rejected — enter it again.')
      }
      throw e
    }
  }, [])

  const upsertSet = useCallback(
    (doc: StandardSet) =>
      setSets((prev) => (prev.some((s) => s.id === doc.id) ? prev.map((s) => (s.id === doc.id ? doc : s)) : [...prev, doc])),
    [],
  )

  const upsertScope = useCallback(
    (doc: Scope) =>
      setScopes((prev) => (prev.some((s) => s.id === doc.id) ? prev.map((s) => (s.id === doc.id ? doc : s)) : [...prev, doc])),
    [],
  )

  const patchScope = useCallback(
    (id: string, fn: (s: Scope) => Scope) => setScopes((prev) => prev.map((s) => (s.id === id ? fn(s) : s))),
    [],
  )

  // Per-scope mutation sequence: every action that applies a server-returned scope doc bumps it,
  // so an in-flight refreshScope started before the bump discards its now-stale snapshot.
  const scopeSeq = useRef(new Map<string, number>())
  const bumpScopeSeq = useCallback((id: string) => {
    scopeSeq.current.set(id, (scopeSeq.current.get(id) ?? 0) + 1)
  }, [])

  // Fire-and-forget mutations: 401 re-opens the gate; other failures surface in the action-error strip.
  const mutate = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await guard(fn)
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) setActionError(errMessage(e))
      }
    },
    [guard],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await guard(() => api.bootstrap())
      setSets(data.sets)
      setScopes(data.scopes)
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [guard])

  useEffect(() => {
    if (code) void refresh()
  }, [code, refresh])

  const refreshScope = useCallback(
    async (id: string): Promise<Scope | undefined> => {
      const seq = scopeSeq.current.get(id) ?? 0
      try {
        const doc = await guard(() => api.getScope(id))
        // A mutation applied a newer doc while this fetch was in flight — drop the stale snapshot.
        if ((scopeSeq.current.get(id) ?? 0) !== seq) return undefined
        upsertScope(doc)
        return doc
      } catch (e) {
        // A scope deleted elsewhere would otherwise poll as a ghost forever — drop it on 404.
        if (e instanceof NotFoundError) setScopes((prev) => prev.filter((s) => s.id !== id))
        return undefined // transient poll failure (or 401, handled by guard) — callers keep polling
      }
    },
    [guard, upsertScope],
  )

  const refreshSet = useCallback(
    async (id: string): Promise<StandardSet | undefined> => {
      try {
        const doc = await guard(() => api.getSet(id))
        upsertSet(doc)
        return doc
      } catch {
        return undefined
      }
    },
    [guard, upsertSet],
  )

  const fetchJob = useCallback(
    (scopeId: string) => guard(() => api.getScopeJob(scopeId)),
    [guard],
  )

  const createSet = useCallback(
    async (name: string, uploads: NewSetUploads, files?: NewSetFile[]): Promise<string> => {
      const { id } = await guard(() => api.createSet(name, uploads))
      if (files?.length) {
        // Upload the real PDF bytes, then kick off extraction immediately — the
        // standards tree, item bank (with screenshots), and cross-document
        // conflict pass run as soon as the uploads land.
        const failed: string[] = []
        await Promise.all(
          files.map((f) =>
            guard(() => api.uploadPdf(id, f.role, f.file.name, f.file)).catch((e) => {
              if (!(e instanceof UnauthorizedError)) failed.push(f.file.name)
            }),
          ),
        )
        if (failed.length > 0) {
          setActionError(
            `Upload failed for ${failed.join(', ')} — extraction will fail until they are re-uploaded (recreate the set with those files).`,
          )
        } else {
          await guard(() => api.ingestSet(id)).catch((e) => {
            if (!(e instanceof UnauthorizedError)) setActionError(errMessage(e))
          })
        }
      }
      await refreshSet(id)
      return id
    },
    [guard, refreshSet],
  )

  const acknowledgeWarning = useCallback(
    (setId: string, warningId: string, resolution?: string, resolvedBy?: 'default' | 'custom') =>
      mutate(async () => upsertSet(await api.acknowledgeWarning(setId, warningId, resolution, resolvedBy))),
    [mutate, upsertSet],
  )

  const confirmAlignment = useCallback(
    (setId: string, itemId: string) => mutate(async () => upsertSet(await api.confirmAlignment(setId, itemId))),
    [mutate, upsertSet],
  )

  const resolveArtifact = useCallback(
    (setId: string, artifactId: string) => mutate(async () => upsertSet(await api.resolveArtifact(setId, artifactId))),
    [mutate, upsertSet],
  )

  const publishSet = useCallback(
    async (setId: string): Promise<{ jobId?: string }> => {
      try {
        const res = await guard(() => api.publishSet(setId))
        upsertSet(res.set)
        return { jobId: res.jobId }
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) setActionError(errMessage(e))
        return {}
      }
    },
    [guard, upsertSet],
  )

  const rerun = useCallback(
    (scopeId: string, target: string, mode: string, override?: boolean): Promise<RerunResult> =>
      guard(() => api.rerun(scopeId, target, mode, override)),
    [guard],
  )

  const createScope = useCallback(
    async (setIds: string[], mode: 'course' | 'standard' | 'topic', params: string): Promise<string> => {
      const { id } = await guard(() => api.createScope(setIds, mode, params))
      await refreshScope(id) // pull the new 'generating' document into state
      return id
    },
    [guard, refreshScope],
  )

  const submitReport = useCallback(
    async (scopeId: string, target: string, text: string): Promise<Proposal> => {
      const proposal = await guard(() => api.submitReport(scopeId, target, text))
      bumpScopeSeq(scopeId)
      patchScope(scopeId, (sc) => ({
        ...sc,
        proposals: [...sc.proposals.filter((p) => p.id !== proposal.id), proposal],
      }))
      return proposal
    },
    [guard, patchScope, bumpScopeSeq],
  )

  const iterateProposal = useCallback(
    (scopeId: string, proposalId: string, feedback: string) =>
      mutate(async () => {
        const p = await api.iterateProposal(scopeId, proposalId, feedback)
        bumpScopeSeq(scopeId)
        patchScope(scopeId, (sc) => ({ ...sc, proposals: sc.proposals.map((x) => (x.id === p.id ? p : x)) }))
      }),
    [mutate, patchScope, bumpScopeSeq],
  )

  const resolveProposal = useCallback(
    (scopeId: string, proposalId: string, accept: boolean) =>
      mutate(async () => {
        const doc = await api.resolveProposal(scopeId, proposalId, accept)
        bumpScopeSeq(scopeId)
        upsertScope(doc)
      }),
    [mutate, upsertScope, bumpScopeSeq],
  )

  const deleteScope = useCallback(
    async (scopeId: string): Promise<boolean> => {
      try {
        await guard(() => api.deleteScope(scopeId))
        bumpScopeSeq(scopeId) // an in-flight poll must not resurrect the deleted scope
        setScopes((prev) => prev.filter((s) => s.id !== scopeId))
        return true
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) setActionError(errMessage(e))
        return false
      }
    },
    [guard, bumpScopeSeq],
  )

  const deleteSet = useCallback(
    async (setId: string): Promise<boolean> => {
      try {
        await guard(() => api.deleteSet(setId))
        setSets((prev) => prev.filter((s) => s.id !== setId))
        return true
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) setActionError(errMessage(e))
        return false
      }
    },
    [guard],
  )

  const store: Store = {
    sets,
    scopes,
    loading,
    error,
    actionError,
    clearActionError: () => setActionError(null),
    refresh,
    refreshScope,
    refreshSet,
    fetchJob,
    createSet,
    acknowledgeWarning,
    confirmAlignment,
    resolveArtifact,
    publishSet,
    rerun,
    createScope,
    submitReport,
    iterateProposal,
    resolveProposal,
    deleteScope,
    deleteSet,
  }

  if (!code) {
    return (
      <AccessGate
        error={authError}
        onSubmit={(c) => {
          setAccessCode(c)
          setAuthError(null)
          setCodeState(c)
        }}
      />
    )
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
