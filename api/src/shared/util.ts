/** Fixed actor string — real user identity is a v1 non-goal (contract §Non-goals). */
export const ACTOR = 'doreen.mayrell@learnwith.ai'

/** Engine/doctrine version strings recorded on every generated scope — must stay in step with the fixed documents in data/framework.ts and data/lang-guide.ts. Index 0 stays the DI BrainLift (VSG runs stamp DOCTRINE_VERSIONS[0] as their doctrineVersion). */
export const ENGINE_VERSION = 'Engine v4.3 (adopted 2026-07-18)'
export const DOCTRINE_VERSIONS = [
  'DI BrainLift v1.8 (Stein et al. 2017)',
  'Mathematical Language Style Guide, Grades K-8 v1.0 (adopted 2026-07-16)',
]

/** The QC stack version printed in every QC Report (spec: the report carries the exact stack version that ran). */
export const QC_STACK_VERSION = 'QC Stack v1.0 — Quality Control and Loop Engineering (adopted 2026-07-16); seeded-defect suite v0'

export const today = (): string => new Date().toISOString().slice(0, 10)

export const nowIso = (): string => new Date().toISOString()

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Standard codes are always written with capital letters: uppercase code-like
 * tokens ("4.oa.a.1" → "4.OA.A.1", "k.cc.1" → "K.CC.1") inside free text,
 * leaving ordinary words untouched. Mirrors capsStandardCodes in src/ui.tsx.
 */
export const capsStandardCodes = (text: string): string =>
  text.replace(/\b(?:\d+[A-Za-z0-9]*|[Kk]|HS[A-Za-z]{0,3})(?:\.[A-Za-z0-9]+)+\b/g, (m) => m.toUpperCase())
