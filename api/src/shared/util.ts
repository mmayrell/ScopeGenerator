/** Fixed actor string — real user identity is a v1 non-goal (contract §Non-goals). */
export const ACTOR = 'doreen.mayrell@learnwith.ai'

/** Engine/doctrine version strings recorded on every generated scope (seed conventions). */
export const ENGINE_VERSION = 'Engine v2.3 (compiled 2026-05-28)'
export const DOCTRINE_VERSIONS = ['DI BrainLift v1.8 (Stein et al. 2017)']

export const today = (): string => new Date().toISOString().slice(0, 10)

export const nowIso = (): string => new Date().toISOString()

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
