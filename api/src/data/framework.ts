import { ExemplarAsset, FrameworkDoc, FrameworkSection } from '../domain/types'
import { dataContainer } from './clients'
import { getJsonOrUndefined, putJson } from './blobs'
import { today } from '../shared/util'

// The governing framework the tool runs under, persisted as one blob document.
// GET returns the stored doc, or the built-in defaults below on first read.
// PUT replaces it; sections whose content changed get a version bump and a
// fresh `updated` stamp, and the doc then stays locked as-is until the next edit.

const FRAMEWORK_BLOB = 'system/framework.json'

const ENGINE_CONTENT = `## Purpose

This BrainLift decides two things and only two things for any standard set the tool is given: where lessons cut (granularity) and what inside each lesson is explicitly modeled (modeling scope). It is written to be standard-set-agnostic — every rule below reads against the selected standard set's own documents: its official standards wording, its released-item corpus, its structured decomposition, and its interpretive documents. No rule names a particular state, framework, or test.

## The Atom

A lesson teaches exactly one atom, and an atom is defined by its triple:

- Start cue — what the student sees that signals this routine and no other.
- Single decision path — one named strategy, executed the same way every time.
- One observable response form — the output a student produces.

If a candidate lesson needs two routines, two response forms, or an ambiguous cue, it is not one atom. No lesson leaves atomization without satisfying the triple.

## Split Criteria

Test every candidate boundary against these; a split requires cited evidence from the standard set's own corpus:

- New rule or strategy not previously taught.
- New vocabulary or concept label that needs stabilization before use.
- New or hidden decision step that changes the routine.
- Unmastered representation or notation — the first encounter of a normalized lexicon form.
- High confusability with a look-alike skill.
- Foundational preskill missing or weak.
- Demand-band jump — the same content at a categorically higher cognitive demand.
- Documented error pattern, from the corpus's interpretive documents, the doctrine's error inventories, or user notes.

## Don't-Split Criteria

- Same strategy steps throughout.
- Quantitative-only or context-only change — bigger numbers or a new surface story are not new learning.
- Representations already mastered earlier in the sequence.
- A cumulative goal of choosing among already-mastered routines — that is practice design, not a new atom.

## Precedence and Tie-Breakers

When split and don't-split criteria both genuinely fire, split criteria win. Real ambiguity goes to the tie-breakers, in order:

- Would a novice need new decision cues never before encountered? Split.
- Can the harder case be rewritten with friendlier numbers or shorter text while the routine stays identical? Don't split.
- Is there a prerequisite gap that cannot be refreshed quickly without new rules or explicit instruction? Split.

## The Editing Splits Constraint

Error patterns justify a split only when they reveal a new or unstable start cue, a new decision step or rule, or a missing prerequisite. Any other error pattern is fixed inside the atom — with contrast pairs, scaffolds, or re-sequenced practice — or, when the confusion runs between two atoms, with a bridge. This constraint caps every data-driven revision as much as every first generation.

## Bridges

Scan every split pair for confusability. A bridge lesson teaches discrimination, selection, and switching only — recognize which atom applies from the first cue and execute that routine cleanly without blending. Bridges introduce no new rules or methods, are placed only after both parent atoms are independently mastered, and keep confusable material separated in time everywhere else in the sequence.

## Modeling Scope

Inside each atom, partition the cases. Model explicitly (the worked and faded examples) wherever there is: a new rule or misinterpretation risk, an unmastered representation, high load or hidden steps, a shaky preskill, look-alike confusion, a foundational prerequisite, a fossilization-prone error, or a demand jump. Send to extension and ramped practice whatever keeps the same strategy with no new steps: mastered-representation rotation, familiar procedures over varied numbers and contexts, solid preskills, low confusability, no stable error pattern, the same demand band.

Between modeled examples, vary numbers and magnitude, surface contexts, order and format, and previously mastered representations; hold constant the strategy steps, unmastered representations, the demand band, and the reading load.

## The Assessment Alignment Constraint

The selected standard set's released-item corpus — whatever its source, over whatever window its uploads declare — is the primary empirical evidence of what is assessed and how hard. Observed items cap rigor: no atom's ceiling exceeds what the standards document's own wording and limits permit, and no ceiling is set above observed evidence without logging why. Where item evidence is absent for a component, the component stays in scope and its ceiling is inferred from analogous tested components, decomposition bounds, and interpretive worked problems — flagged as inferred everywhere it lands.`

const DOCTRINE_CONTENT = `## Authority

The controlling method authority for instruction is Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics (5th edition, 2017), as operationalized here. Where any interpretive document, progression, or commentary prefers a different method — for any standard set — this doctrine prevails, and the conflict is logged on the affected card.

## Faultless Communication

Every instructional communication must be constructed so it can be misread only one way: the intended way. The burden sits with the material, never the learner. In this tool that burden extends to the scope itself — every card field must read one way only, because the card is the script for whoever authors the lesson.

## Single Best Strategy

Do not give students multiple strategies for the same problem class. Select the single most generalizable strategy — the one that handles the widest range of cases with the fewest decisions — and teach it to mastery. Where a standard's wording, a decomposition statement, or item evidence requires an alternative technique or representation, teach it after algorithmic mastery, framed as an interpretation or application of the mastered routine, never as a parallel computation path.

## Algorithm Before Representation

Representations and manipulatives come after direct instruction of the algorithm. They illustrate and explain a routine the student already owns; they are never the computation path. A representation appearing in assessment evidence is taught to the depth the evidence demands and no further.

## The Instructional Sequence

- I Do — full modeling of the routine on carefully chosen cases, with every decision voiced.
- We Do — guided execution with the scaffold fading step by step.
- You Do — independent practice ramping from the modeled cases toward the ceiling.

Downstream, this maps onto the assumed lesson anatomy: a concise article with the key concepts, a fully worked example, a faded worked example the student completes, and independent practice ramping in difficulty.

## Sequencing Rules

- Preskills before the composite skills that consume them.
- Easier skills before harder ones, wherever the dependency graph allows.
- Confusable skills separated in time; the bridge that discriminates them comes only after both are independently mastered.
- Within a concept cluster, the sacrificial first instance: the easiest sibling is taught first with full modeling, and later siblings become reduced-modeling transfer lessons.
- Cumulative review threads mastered skills through later practice so nothing decays unseen.

## Mastery as Observable Behavior

Mastery is always stated as observable behavior — students are able to do a named task, over a named problem class, under named conditions. Never "understand," never "appreciate." The scope defines the task and its parameters; the delivering application owns the thresholds — accuracy bars, rates, and counts do not belong in instructional specifications.

## Error Patterns

At design time, only documented misconceptions are admissible evidence: the doctrine's own error inventories, misconceptions recorded in the standard set's interpretive documents, and user notes. Fossilization-prone errors — the ones that survive if unaddressed — are modeled explicitly with contrast cases rather than left to practice. After deployment, reported student data is admissible the moment a human reports it, at full strength, subject to the Editing Splits constraint on what an error pattern can justify.`

const DEFAULT_REGISTER: ExemplarAsset[] = [
  {
    n: 1,
    asset: 'Example of Lesson Granularity Build from Released Assessment Items',
    linkedFrom: 'Lesson Granularity & Modeling Scope BrainLift',
    role: 'Few-shot anchor: Stage 3 atomization',
    status: 'resolved',
  },
  {
    n: 2,
    asset: 'Example of Lesson Granularity + Modeling Determination',
    linkedFrom: 'Lesson Granularity & Modeling Scope BrainLift',
    role: 'Few-shot anchor: Stages 3–5 (modeling scope, card fill)',
    status: 'pending',
  },
  {
    n: 3,
    asset: 'DI Mathematics format library (ch. 9–12 excerpts)',
    linkedFrom: 'Direct Instruction BrainLift',
    role: 'Few-shot anchor: Stage 5 approach fields',
    status: 'resolved',
  },
]

export function defaultFramework(): FrameworkDoc {
  return {
    engine: {
      kind: 'engine',
      name: 'Lesson Granularity & Modeling Scope BrainLift',
      version: 'v2.3',
      updated: '2026-05-28',
      content: ENGINE_CONTENT,
    },
    doctrine: {
      kind: 'doctrine',
      name: 'Direct Instruction BrainLift (Stein et al. 2017)',
      version: 'v1.8',
      updated: '2026-04-19',
      content: DOCTRINE_CONTENT,
    },
    register: DEFAULT_REGISTER,
  }
}

export async function getFramework(): Promise<FrameworkDoc> {
  return (await getJsonOrUndefined<FrameworkDoc>(dataContainer(), FRAMEWORK_BLOB)) ?? defaultFramework()
}

/** Bumps vMAJOR.MINOR → vMAJOR.(MINOR+1); passes through anything it can't parse. */
function bumpVersion(v: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(v.trim())
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : v
}

/**
 * Persists the framework. A section whose content or name changed gets a version
 * bump and a fresh `updated` stamp (recompilation is part of publishing a new
 * version); the register is stored as sent.
 */
export async function saveFramework(incoming: FrameworkDoc): Promise<FrameworkDoc> {
  const current = await getFramework()
  const stamp = (prev: FrameworkSection, next: FrameworkSection): FrameworkSection =>
    next.content !== prev.content || next.name !== prev.name
      ? { ...next, version: bumpVersion(prev.version), updated: today() }
      : { ...next, version: prev.version, updated: prev.updated }
  const doc: FrameworkDoc = {
    engine: stamp(current.engine, { ...incoming.engine, kind: 'engine' }),
    doctrine: stamp(current.doctrine, { ...incoming.doctrine, kind: 'doctrine' }),
    register: incoming.register.map((e, i) => ({ ...e, n: i + 1 })),
  }
  await putJson(dataContainer(), FRAMEWORK_BLOB, doc)
  return doc
}
