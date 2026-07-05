import { Scope } from '../domain/types'

/**
 * Guardrails (contract §Guardrails): the check is synchronous and data-driven
 * off scope.protectedBoundaries; the decline message/criterion/evidence
 * replicate src/store.tsx rerun() exactly.
 */
export interface GuardrailDecline {
  message: string
  guardrail: { criterion: string; evidence: string }
}

// Exact criterion/evidence strings from src/store.tsx — they cite the seed's
// 4.NBT.5 evidence, so they apply ONLY to the seeded U3.L3/U3.L4 pair; derived
// pairs get a generic criterion/evidence below. The pair list itself is
// data-driven per scope.
const GUARDRAIL_CRITERION = 'A2 — new/hidden decision step changing the routine'
const GUARDRAIL_EVIDENCE =
  'Evidence Statement keys 4.NBT.5-1 vs 4.NBT.5-2: placing and aligning a second partial row with its placeholder zero is a new decision step absent from the one-digit-multiplier routine. Engine zero-multiplier precedent: split criteria win.'

/**
 * A merge target hits a protected pair [a, b] iff it IS one of the pair's
 * lessons or their containing unit — exact matches only (startsWith would make
 * the pair 'U3.L3' also block 'U3.L30').
 */
export function findProtectedPair(scope: Scope, target: string): [string, string] | undefined {
  for (const pair of scope.protectedBoundaries ?? []) {
    if (pair.length < 2) continue
    const [a, b] = pair
    const unitId = a.split('.')[0]
    if (target === a || target === b || target === unitId) return [a, b]
  }
  return undefined
}

export function declineMerge(pair: [string, string]): GuardrailDecline {
  const isSeededPair = pair[0] === 'U3.L3' && pair[1] === 'U3.L4'
  return {
    message: `Declined: this merge would collapse the ${pair[0]} / ${pair[1]} boundary, which is protected by a hard split criterion.`,
    guardrail: isSeededPair
      ? { criterion: GUARDRAIL_CRITERION, evidence: GUARDRAIL_EVIDENCE }
      : {
          criterion: "A2 — hard split criterion recorded in this boundary's Decision record",
          evidence: `The ${pair[0]} / ${pair[1]} boundary carries a hard split criterion in its Decision record; merging across it requires an explicit override. Engine precedent: split criteria win.`,
        },
  }
}
