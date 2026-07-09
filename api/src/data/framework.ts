import { FrameworkDoc } from '../domain/types'

// The governing framework the tool runs under — the engine and doctrine
// documents, fixed as compiled here. They are not editable or uploadable:
// new versions ship with the tool, and every generated scope records the
// versions it ran under (ENGINE_VERSION / DOCTRINE_VERSIONS in shared/util.ts
// must stay in step with the versions below).

const ENGINE_CONTENT = `## Context

Instructional standards define what students are expected to learn, but they rarely define how instruction should be organized into lessons. Standards say what students must learn, but they do not say where one lesson ends and the next begins, what "hard enough" looks like, or which method to teach. The Scope Generator performs that translation — systematically, from evidence, and in writing. This engine establishes the instructional design rules used to make those decisions.

Grounded in the principles of Direct Instruction, it defines a consistent, evidence-based procedure for decomposing standards into the smallest meaningful teachable units while preserving conceptual coherence and minimizing unnecessary cognitive load. The resulting lesson scope becomes the canonical instructional blueprint used throughout the curriculum generation pipeline.

The framework makes two foundational instructional decisions:

- Lesson Granularity (Split vs. Don't Split) — determines whether content should be taught as separate lessons or as variations within a single lesson. Splits are justified only when instruction requires a new strategy, decision, representation, prerequisite, integration behavior, or other meaningful change in student behavior — not simply because problems become harder or use different numbers or contexts.
- Modeling Scope (Teach vs. Practice) — determines, within each lesson, which examples require explicit modeling and guided instruction and which can be introduced directly through practice because they apply the same mastered strategy under surface-level variation.

Together, these decisions transform standards and assessment evidence into a coherent lesson architecture. That architecture serves as the instructional foundation for downstream artifacts — including lesson cards, worked examples, assessments, interventions, adaptive pathways, and future curriculum revisions.

## Alignment to Track Design

Within this curriculum architecture, an atom is the smallest teachable unit — introduced by a clear start cue, guided by a single decision path/strategy, and demonstrated through one observable response form — defined as follows:

- The tracks/strands described in this architecture control when atoms recur (spacing/interleaving/maintenance).
- Lessons plug into tracks/strands but are authored independently of scheduling.
- This guide identifies how a single lesson is built to be durable and transferable.

## Atomize the Entire Standard (P4)

The tool does not limit lessons to skills explicitly named in the standard or unpacking document. It performs a full Direct Instruction task analysis of the standard and generates any instructionally necessary in-between atoms, prerequisite micro-skills, bridges, and application tiers needed for mastery. These atoms stay inside the standard's boundary; they do not add new expectations, but make the full standard teachable, sequenced, and observable. The only restriction is that if an atom belongs in a previous unit or grade level, it is excluded.

## No Evidence is Not No Lesson (P5)

When no released item tests a component, the component stays in scope. The tool infers the assessment evidence that would plausibly exist — from how sibling skills are tested and where the component sits developmentally — flags everything built on that inference as inferred, and writes a concrete exemplar problem at the inferred difficulty so the inference is inspectable, not abstract.

## Released Item Demand Analysis

Released items are interpreted as a representative sample of observable assessment evidence — empirical evidence of the types of performances students are expected to demonstrate, not an exhaustive specification of the assessment and never curriculum authority. Instructional decisions rest on consistent patterns across the available evidence rather than any single released question, and the official standards continue to define the outer boundary of instructional scope.

- For each released item, when available, the analysis may identify: prerequisite atoms required; integration behaviors required; strategy-selection demands; representation demands; discrimination demands; common misconception patterns reflected in distractors; expected level of rigor and cognitive coordination.
- Patterns that recur across multiple released items provide stronger evidence than isolated examples. These recurring demands may justify integration lessons that explicitly teach students to coordinate previously mastered atoms into authentic assessment performance.
- The absence of a particular performance in the released sample is never interpreted as evidence that the performance is never assessed. Decisions rest on converging evidence across the standards, progressions, unpacking documents, and recurring patterns in released items — never on the absence of any single item type.

## Granularity: Split Criteria

Split when any of the following holds — each criterion paired with its canonical example:

- New rule/strategy not previously taught (requires explicit demonstration) — moving from identifying proportional relationships to finding the constant of proportionality needs a split because students must learn a new rule and see clean worked examples with contrasting non-examples before practice.
- New vocabulary / concept label that must be stabilized before the procedure — for "identify proportional relationships," students may need a separate micro-lesson on what "proportional" means (constant ratio) with examples/non-examples without doing computations.
- New/hidden decision step changes the routine (requires task analysis and guided practice on the new step) — adding fractions with like denominators needs to be split from adding fractions with unlike denominators because the change requires first finding the least common denominator before adding.
- New integration behavior requiring coordination of previously mastered atoms — students can solve one-step addition and subtraction problems independently but cannot determine which operation applies in a mixed set of word problems. A separate integration lesson teaches strategy selection without introducing new computational procedures.
- Unmastered representation/notation (students can't yet map symbols/graphs/tables to meaning; needs modeling plus scaffolding fades) — representing sample space with a tree diagram needs to be separate from representing sample space in a table, because a new representation changes how information is encoded and must be modeled before scaffolds are faded.
- High confusability with a look-alike skill (needs discrimination training: side-by-side non-examples) — similarity and congruency must be introduced separately because students require a discrimination rule with contrasted non-examples to prevent persistent mix-ups.
- Foundational preskill missing/weak (explicit prerequisite skill must be taught prior) — solving two-step equations with negatives needs a split when integer operations haven't been explicitly taught, because the prerequisite must be taught and stabilized before the composite routine.
- Demand-band jump (e.g. selection vs construction) — from mathematical area calculations to real-world problems.
- Data-driven error pattern (systematic/high-frequency misconception; needs error-based modeling before independent practice) — in multi-digit multiplication where the multiplier contains one or more zeros (e.g. 3,204 × 203), if item data commonly showed a large spike of answers off by a factor of 10 or 100 because students omit or misplace placeholder zeros and misalign partial products, that would call for a micro-lesson to cover it explicitly. Although the algorithm is nominally the same as the no-zero case (normally "Don't Split: quantitative change only"), the systematic error pattern warrants a separate micro-lesson.

## Granularity: Don't-Split Criteria

- Same strategy steps as taught (no new decisions) — finding area of rectangles and squares by multiplying side lengths.
- Changes are quantitative only (bigger numbers, benign decimals/fractions) or a change in context — solving one-step equations with different integers/decimals using the same inverse-operation routine.
- Uses already-mastered representations — identifying functions across tables/graphs/points after each representation has been taught.
- Mixed practice that requires no new strategy-selection behavior because students have already mastered the relevant integration atom — after students complete the operation-selection integration lesson, mixed addition/subtraction/multiplication/division practice does not require another lesson.

## Granularity: Tie-Breakers

For edge cases, apply in order:

- Would a novice need new decision cues to start/choose steps they have never been exposed to previously? Yes = Split. (In statistics, if students must select mean absolute deviation vs. range to describe variability, split into three lessons: mean absolute deviation, range, and choosing the appropriate measure for a context and justifying the choice.)
- Can I rewrite with friendlier numbers/shorter text and the routine stays identical? Yes = Don't Split. (A lesson that includes both 1 cm : 3.2 m and 1 : 4 scale drawings doesn't need to split; both use the same proportion routine and only differ in difficulty.)
- Is there a prerequisite gap that cannot be refreshed quickly without new rules or explicit instruction/practice? Yes = Split. (In a lesson solving two-digit by one-digit multiplication word problems, if the student hasn't been exposed to the standard algorithm yet, split the lesson to include the explicit instruction and then support the mastery via answer explanations.)
- Would successful performance require coordinating multiple previously mastered atoms in a way students have not yet been explicitly taught? Yes = Split into an integration lesson. (Examples: choosing the correct operation; selecting the appropriate representation; deciding which previously mastered algorithm applies; interpreting a released-item style prompt; rejecting plausible distractors based on common misconceptions.)

## Bridge Lessons

Sometimes, when a single skill gets split into two atoms, we also need a third, cumulative lesson whose only job is to recombine them.

- In this bridge lesson, students learn to (1) recognize which atom applies from the very first cue in the problem and then (2) execute the correct single routine cleanly — without blending steps from the other atom.
- Importantly, this lesson does not introduce new rules or methods; it's purely about training discrimination, selection, and switching under mixed practice, using look-alike items that are designed to trigger common confusions.
- While spaced repetition and cumulative review often address this naturally over time, some topics benefit from a more targeted recombination lesson — especially in areas where students reliably confuse approaches (for example, area vs. perimeter, or deciding between addition vs. multiplication).
- Bridge lessons may also prepare students for authentic mathematical performances: they teach students to coordinate previously mastered atoms into composite performances such as strategy selection, representation selection, discrimination among similar solution paths, or multi-step reasoning. Released assessment items serve as empirical evidence for identifying which of these composite performances are commonly expected, but they do not define the existence of integration lessons.

## Editing Splits

High-frequency or systematic errors inform what must be taught explicitly, not automatically whether an atom must be split.

Errors justify splitting only when analysis reveals:

- a new or unstable start cue/problem type,
- a new decision step or rule, or
- a missing prerequisite that must be taught and stabilized first.

Otherwise, errors should be addressed through improved modeling, contrasts, scaffolding, or sequencing within the same atom.

## Modeling Scope

After granularity is set, we decide the teaching scope inside the atom — what is explicitly modeled vs. left to practice.

Within the atom (lesson), there may be a breadth of content spanning different difficulty levels. Aligned to direct instruction, not all content warrants full modeling. Grounded in learning science (worked-example effect, cognitive load theory, explicit instruction), minimum viable modeling targets only the steps and cases that form or revise schemas and prevent common novice errors. We model the smallest set of exemplars needed to cue decisions, make invisible thinking visible, and enable rapid transfer, then fade support. The rest moves directly to independent practice (Stein et al., 2017).

Building on that principle of minimum viable modeling, vary only surface features between "I Do" and "We Do" to promote transfer, and hold the routine constant so novices attend to the same decision path.

What to vary between "I Do" and "We Do":

- Numbers and magnitude — scale values (small to large), include boundary cases that still use the same steps (e.g. sums crossing 1 but not requiring a new conversion rule if that rule was not taught yet).
- Surface contexts — swap story frames (recipes, distance, prices) that don't change the mathematical action.
- Order/format — commuted order (a+b vs b+a), item stems (fill-in/select/short-answer) that preserve the same response mode.
- Previously mastered representations — tables/graphs/arrays only if those representations are mastered.

What to hold constant between "I Do" and "We Do":

- Strategy steps (no new rules).
- Unmastered representations (save for a new atom).
- Cognitive demand band (don't jump from procedural to modeling unless that's the split).
- Reading load (avoid language complexity that becomes the new barrier).

## Explicit Teaching vs. Extension

Direct Instruction draws a clear line between what must be explicitly taught and what can be treated as extension once the core routine is stable. When a problem introduces a new rule, a new representation, or a likely misinterpretation, instruction should model and secure the strategy before expecting independent transfer (Stein et al., 2017).

Explicit modeling is necessary for:

- New rule/strategy or clear misinterpretation risk.
- Unmastered representation (first time seeing a form: e.g. mapping, coordinate plane).
- High cognitive load / multiple hidden steps (teach steps, then fade).
- Preskill missing or shaky (reteach preskill, then composite skill).
- Look-alike confusion likely (similar types require discrimination).
- Foundational prerequisite for later learning (must be stable).
- Error-prone skill where mistakes fossilize (e.g. place value, fraction operations).
- Jump in cognitive demand (procedural to application/modeling).

Extension is sufficient for:

- Same strategy as taught; no new steps added.
- Representation already mastered; rotate representations to show invariance.
- Single, familiar procedure repeated; vary numbers/contexts only.
- Preskills solid; current item sits on mastered foundations.
- Low confusability; include a quick discrimination item but no new modeling.
- Non-foundational variant of the same atom.
- Stable error pattern absent; prior accuracy holds in practice.
- Same demand band (all procedural or all application) within the atom.

## Example: Granularity Build From Released STAAR Questions

To cover STAAR problems involving real-world application of comparing fractions, the released problems include the following question types:

- Finding a fraction greater/less than a given fraction.
- Identifying which comparison is true from a word problem.
- Given a fraction model, determine which inequality is true.
- Identifying true comparisons from tables.

Determining lesson granularity: granularity is driven by the smallest new behavior (atom), or skill, that the lesson can provide. Applying the checklist, one criterion is met — the task has multiple hidden steps / high cognitive load. Some of the problems involve comparing two fractions at a time that are explicitly given to the student, while other problems involve making determinations of which fractions to use in comparison; that carries a significantly higher cognitive load as well as additional steps. This suggests the lesson should be split. The most efficient way to split, so as not to violate the checklist, is to divide the lesson into two:

- Word Problems Involving Identifying Correct Fraction Comparisons.
- Word Problems Involving Comparing Multiple Fractions.

Determining which problems to model — for each of the two lessons, determine the minimum viable modeling set that aligns to the desired characteristics:

- Lesson 1 (identifying correct fraction comparisons) — model explicitly: EASY, given a fraction model, determine which inequality is true; MEDIUM, identifying correct comparisons from a word problem with two or three fractions; HARD, given a table with 4 or 5 values, determine which comparison is true.
- Lesson 2 (comparing multiple fractions) — model explicitly: EASY, finding a fraction greater or less than another given fraction; MEDIUM, use a table with qualitative answer choices, requiring multiple comparisons.

Problems that do not require explicit modeling:

- A prompt that looks different but measures the same skill — evaluating which comparisons are true. Students with solid mastery of this skill should be able to answer correctly.
- A question with slightly different formatting (such as bullets) that is essentially the same as the word problems containing three fractions where students identify the true comparison.
- A problem whose rigor matches the broader problem set and the underlying skill demands — finding a number less than a given number is already covered in other problems, and it is written in a familiar, already-mastered representation.`

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

/** The fixed framework — read-only; there is no save path. */
export function getFramework(): FrameworkDoc {
  return {
    engine: {
      kind: 'engine',
      name: 'Lesson Granularity & Modeling Scope (v3 — No-HITL specification)',
      description:
        'Provides the governing principles and decision rules for determining lesson granularity and modeling scope in direct instruction curriculum design — split/don\'t-split criteria, integration lessons, released-item demand analysis, and full-standard atomization.',
      version: 'v3',
      updated: '2026-07-08',
      content: ENGINE_CONTENT,
    },
    doctrine: {
      kind: 'doctrine',
      name: 'Direct Instruction BrainLift (Stein et al. 2017)',
      description:
        'The controlling method authority for instruction is Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics (5th edition, 2017), as operationalized here.',
      version: 'v1.8',
      updated: '2026-04-19',
      content: DOCTRINE_CONTENT,
    },
  }
}
