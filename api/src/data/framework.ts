import { FrameworkDoc } from '../domain/types'

// The governing framework the tool runs under — the engine and doctrine
// documents, fixed as compiled here. They are not editable or uploadable:
// new versions ship with the tool, and every generated scope records the
// versions it ran under (ENGINE_VERSION / DOCTRINE_VERSIONS in shared/util.ts
// must stay in step with the versions below).
//
// Engine v4.0 is compiled from "The Curriculum Atomization, Item Alignment &
// Coherence Guide — A Direct Instruction Framework for Decomposing Standards
// into Teachable Lessons, Aligning State-Level Assessment Items, and Mapping
// Coherence Across Lessons, Units, and Grades". Its rules are carried here
// with their exact meanings; do not substitute intuitive readings.

const ENGINE_CONTENT = `## Purpose

The purpose of atomization is to transform an academic standard into the smallest instructionally complete sequence of lessons that allows every student to master the standard through explicit teaching. This framework produces three coupled outputs:

- Output 1 — The Lesson Sequence: the ordered set of instructional atoms, each teaching exactly one new thing.
- Output 2 — The Item Alignment Map: for every lesson, assessment material at state-test rigor that measures exactly that lesson's objective using only skills already taught. Released items are placed only where they match perfectly; lessons with no perfect match receive generated items.
- Output 3 — The Coherence Webs: navigable dependency maps at three levels — an atom web for every unit, a unit web for the course, and a grade progression web showing only the immediate prerequisite topic from the previous grade and the immediate successor topic in the next grade. Dependencies are derived from the reference library, the Achieve the Core Coherence Map, and other authoritative progression resources. Relationships are inferred only when supported by clear, converging evidence from multiple independent sources.

Atomization is not simply breaking standards into smaller pieces. It is the process of identifying every new behavior, decision, representation, vocabulary concept, prerequisite, discrimination, and integration performance that must be explicitly taught. The resulting scope is instructional — not topical.

Item alignment is not distributing released items evenly across lessons. It is the process of proving, item by item, that every skill an item demands has already been taught by the time the item appears — and relocating, repairing the scope around, or excluding any item for which that proof fails.

Coherence mapping is not decoration. It is the process of making every dependency — atom to atom, unit to unit, grade to grade — explicit, checkable, and navigable, in the manner of a standards coherence map.

## Definitions

These terms are used with exact meanings throughout. Do not substitute intuitive readings.

- Atom — the smallest lesson satisfying all seven conditions in "What Is an Atom".
- Released item — a publicly released state assessment item. Used as evidence of tested performance (atom discovery) and as candidate lesson assessment material (item alignment).
- Target demand — the single behavior a released item is designed to elicit. Every item has exactly one target demand. Placement requires it to match exactly one lesson objective.
- Embedded demand (side skill) — any additional knowledge or skill the item requires beyond the target demand: a computation, a representation to read or construct, a vocabulary term, a decision, a coordination of procedures, or contextual knowledge.
- Cumulative Mastery Ledger, M(L) — the complete set of skills explicitly taught in Lessons 1 through L, plus the explicitly listed prerequisites, M(0). The ledger is the sole authority on what students have learned at any point in the sequence.
- PLACED — the item passed both placement conditions and is assigned to a lesson.
- GENERATED — an item written new for a lesson that has no qualifying released item: state rigor, ledger scope.
- EXCLUDED — the item is removed after Exclusion Triage confirms that an unmet instructional demand lies beyond the standard's scope or requires a later-taught skill that is not a prerequisite of the lesson's focal objective. If the later-taught skill is a documented prerequisite of the focal objective, the item remains admissible. Exclusion is silent.
- Coherence web — a navigable dependency graph in which every edge means "is required by". Modeled on grade-to-grade coherence maps. Always a DAG: no cycles, every edge points from earlier to later.
- Atom web (Tier 1) — one per unit. Nodes are the unit's lessons plus its M(0) entries; edges are direct knowledge dependencies.
- Unit web (Tier 2) — one per grade or course. Nodes are units; edges are lifted from atom-level dependencies by the Lift Rule.
- Grade progression web (Tier 3) — topic-level context only. For each unit: the topic from the grade before that feeds it and the topic in the grade after that it feeds. Topics — never skills, lessons, or items.
- Direct dependency (edge) — A → B exists only if B's new learning consumes A's ledger entry directly, not through an intermediate atom.
- Lift Rule — a unit edge U → V exists only if at least one atom-level dependency or M(0) consumption crosses from U into V.

## What Is an Atom?

An instructional atom is the smallest lesson that can satisfy all of the following:

- One instructional objective
- One observable behavior
- One decision path
- One start cue
- One response form
- One mastery criterion
- Students never have to decide between two different procedures inside a single atom.

## The Goal

Every lesson should answer exactly one question: "What is the one new capability students acquire today?" A lesson may involve multiple previously learned skills only when they are combined to teach a single new capability (e.g., discrimination, comparison, selection, or integration). It must not introduce multiple independent new capabilities.

## Sources of Evidence

Atomization begins with evidence. Evidence is gathered from: official standards, standard progressions, unpacking documents, released assessment items, Direct Instruction doctrine, and approved prerequisite documents.

Released items play two distinct roles, and the roles must never be confused:

- During atom discovery: items are evidence of observable performance. They reveal the behaviors, representations, and decisions the state actually tests.
- During item alignment: items are candidate assessment material to be verified and placed into specific lessons.

Standards define instructional boundaries. Direct Instruction defines instructional doctrine. Released items define tested performance. Progressions define cross-grade coherence. Items never define lessons — they are evidence, not curriculum — and lessons are never distorted to absorb items (the No-Forcing Rule).

## The Atom Discovery Process

For every standard, make the following considerations in order.

- 1 — Identify every observable student behavior. Examples: identify, compare, solve, represent, explain, classify, construct, justify. Each distinct capability becomes a candidate atom.
- 2 — Identify every distinct mathematical idea. Examples (ratio standard): ratio, equivalent ratio, unit rate, proportional relationship. Each new concept becomes a candidate atom.
- 3 — Identify every representation. Examples: table, graph, number line, equation, tape diagram, area model. Representations become separate atoms whenever students must learn to express or interpret meaning for the first time through that representation rather than merely use it.
- 4 — Identify vocabulary stabilization lessons. If a new academic term carries conceptual meaning before students can perform the procedure, create a vocabulary atom. Examples: proportional, constant of proportionality, equivalent.
- 5 — Identify selection skills. Ask: "Must students choose among multiple previously learned procedures or concepts before solving?" Whenever selecting the correct approach is itself new learning, create a candidate atom.
- 6 — Identify prerequisite gaps. Whenever a candidate atom requires a prerequisite that is part of the generated course but has not yet appeared in the instructional sequence, insert a prerequisite (preskill) lesson. Do not generate preskill lessons for prerequisite knowledge assigned to earlier grades or outside the selected standards. Prerequisite instruction is never embedded inside a later lesson.
- 7 — Validate instructional coverage and rigor. Ask: "Does this sequence fully prepare students for the demonstrated rigor of the standard?" If released assessment items or other admissible evidence reveal a documented instructional demand that is not yet explicitly taught, insert additional atoms until every in-scope demand is covered. When problem solving, word problems, mathematical modeling, or other application tasks are within the standard's scope, they must be explicitly taught rather than assumed. Do not create new atoms solely because numbers become larger or examples become more numerous when the underlying generalization remains unchanged.
- 8 — Identify bridge lessons. A lesson may combine multiple previously mastered skills only to teach one new instructional capability. The prerequisite skills are not new learning; they are coordinated in service of a single objective (e.g., discrimination, comparison, selection, or integration). A lesson must not introduce more than one independent new capability.

## Split Decision Rules (the Split Decision Framework)

Split into a new atom whenever instruction introduces:

- a new rule/strategy not previously taught (requires explicit demonstration with clean worked examples and contrasting non-examples before practice)
- a new vocabulary or concept label that must be stabilized before the procedure (examples/non-examples without computation)
- a new or hidden decision step that changes the routine (like-denominator vs unlike-denominator fraction addition: finding the common denominator is a new step)
- a new integration behavior requiring coordination of previously mastered atoms (strategy selection across a mixed set; no new computational procedures)
- an unmastered representation or notation (students cannot yet map the symbols/graph/table to meaning; the encoding must be modeled before scaffolds fade)
- high confusability with a look-alike skill (needs discrimination training with side-by-side non-examples: similarity vs congruency)
- a foundational preskill missing or weak (the prerequisite must be taught and stabilized before the composite routine)
- a demand-band jump (e.g. selection vs construction; bare computation → real-world problems)
- a data-driven error pattern — a systematic, high-frequency misconception needing error-based modeling before independent practice (the placeholder-zero pattern in 3,204 × 203: nominally the same algorithm as the no-zero case, but the systematic error warrants its own micro-lesson)

Do not split merely because numbers become larger.

## Don't Split Rules

Remain one atom when only:

- the strategy steps are the same as taught (no new decisions)
- numbers become larger (or benign decimals/fractions enter)
- context changes
- wording changes
- formatting changes
- problem difficulty increases
- additional practice is needed
- already-mastered representations are being used
- mixed practice requires no new strategy-selection behavior because the relevant integration atom is already mastered

…provided the cognitive routine remains identical.

## Tie-Breakers (edge cases)

- Would a novice need new decision cues — never seen before — to start or choose steps? → Split.
- Can the item be rewritten with friendlier numbers or shorter text and the routine stays identical? → Don't split.
- Is there a prerequisite gap that cannot be refreshed quickly without new rules or explicit instruction and practice? → Split (teach and stabilize the prerequisite first).

## Editing Splits (the error-pattern bar)

High-frequency or systematic errors inform what must be taught explicitly — not automatically whether an atom splits. Errors justify splitting only when analysis reveals a new or unstable start cue/problem type, a new decision step or rule, or a missing prerequisite that must be taught and stabilized first. Otherwise, errors are addressed through improved modeling, contrast cases, scaffolding, or sequencing within the same atom.

## Types of Lessons

Each lesson type has a typical assessment source in the Item Alignment Map. "Typical" is a prior, not a rule — the Placement Rule always decides.

- Preskill — teaches prerequisite knowledge.
- New Learning — teaches a new behavior.
- Representation — teaches a new way of expressing already-learned knowledge.
- Bridge — teaches choosing between previously mastered atoms.
- Application — teaches transfer of mastered knowledge into authentic problems.

## Ordering

The generator orders lessons to produce the shortest coherent instructional path to mastery. Sequence is determined by documented instructional dependencies, Direct Instruction doctrine, and admissible evidence — not by the order of the standards document.

- 1. Prerequisites first. Every lesson appears only after all required prerequisite knowledge has been taught or is expected from prior grades.
- 2. Teach one new capability at a time. Each lesson introduces exactly one new instructional capability. Later lessons may depend on multiple previously mastered capabilities but may not introduce multiple new ones.
- 3. Concepts before procedures. Introduce the concepts, vocabulary, and representations that are necessary to understand a procedure before teaching that procedure.
- 4. Explicit instruction before application. New procedures, algorithms, and decision skills are taught explicitly before students are expected to apply them independently, solve word problems, or transfer them to novel situations.
- 5. Generalize before extending. Expand the range of examples within the same instructional generalization before introducing a new rule, capability, or decision.
- 6. Integrate only after mastery. Bridge lessons, cumulative review, and mixed practice occur only after the component atoms have been mastered individually.
- 7. Evidence determines rigor. If admissible evidence demonstrates an instructional demand that has not yet been explicitly taught, insert additional lessons before students are assessed on that demand.
- 8. Units follow coherent knowledge progressions. Units group closely related atoms that build toward a common mathematical idea. Unit boundaries should minimize prerequisite crossings and maximize instructional coherence.
- 9. The sequence forms a coherent dependency graph. Every lesson unlocks later learning, every dependency points forward, and no lesson appears before the knowledge it requires.

## Representation Doctrine

Representations are instructional only when students must learn how to interpret them, how to construct them, or how to choose them. Otherwise they remain examples inside another lesson.

Alignment consequence: a released item that merely displays a representation students must read or build has an embedded representation demand. The item cannot be placed before the lesson that teaches that representation.

## Vocabulary Doctrine

Vocabulary exists to reduce cognitive load. Words are never taught in isolation. Vocabulary lessons exist only when the word introduces a new concept or when misunderstanding the word blocks later instruction.

Alignment consequence: academic vocabulary inside an item stem or answer choices is an embedded demand. An item using "unit rate" cannot be placed before the lesson that stabilizes "unit rate".

## Bridge Doctrine

Bridge lessons never teach new mathematics. They teach discrimination, selection, switching, and coordination. Typical bridge lessons include: area vs. perimeter, ratio vs. rate, mean vs. median, equation vs. inequality, multiplication vs. division.

A bridge lesson title should contain the competing atoms ("A vs. B") or the explicit selection behavior ("Choose the Appropriate Representation"), never a generic phrase like "Mixed Practice" or "Review". That keeps every bridge lesson instructionally precise and independently assessable.

Alignment consequence: any released item that requires choosing between procedures may only be placed at a bridge, application, or mixed-performance lesson (the Coordination Rule). Web consequence: every bridge node receives one incoming edge from each competing atom.

## Application Doctrine

Applications never introduce new computational procedures. They increase demand by requiring students to model, interpret, justify, solve contexts, and coordinate multiple atoms.

Alignment consequence: released items most often appear in their original, unmodified form at application and mixed-performance lessons, because state items typically demand exactly this coordination. Web consequence: every application node receives an edge from each atom it coordinates.

## The Cumulative Mastery Ledger

The ledger is the formal device that makes item placement checkable rather than intuitive.

- Construction Rule 1. M(0) is the explicit prerequisite list: prior-grade skills students are accountable for, each verified as activatable in under two minutes. Nothing enters M(0) by assumption.
- Construction Rule 2. M(L) = M(L−1) plus Lesson L's new entries: its objective, plus any vocabulary or representation explicitly taught inside it.
- Construction Rule 3. Build the ledger after sequencing and before any item work. Every placement decision reads from it.
- Construction Rule 4. The ledger is the sole authority for every question of the form "Have students learned X by Lesson L?" If X is not in M(L), the answer is no — regardless of how plausible "they probably know it" feels.

## Released Item Placement Doctrine

Core principle: an item belongs to a lesson only if it measures that lesson's objective and demands nothing that is untaught.

Item Decomposition — interrogate every released item the way the discovery process interrogates a standard. Identify its target demand (the single behavior the item is designed to elicit) and its embedded demands — every additional requirement, across six categories: computations, representations (to read or construct), vocabulary, decisions, coordinations of procedures, and contextual knowledge.

The Placement Rule — PLACE item i at Lesson L if and only if both conditions hold:

- Condition A (Exact target match): the item's primary instructional target matches Lesson L's objective — same capability, same decision path, and same response form.
- Condition B (Ledger containment): every required embedded instructional demand of the item is contained in M(L).

If either condition fails, the item is not placed at Lesson L. There is no partial credit and no "close enough".

The Deferral Rule — when Condition A matches Lesson L but Condition B fails on a demand taught LATER in the course, the item is DEFERRED: it is placed at the earliest later review, bridge, or application lesson where Condition B passes.

The Coordination Rule — a multi-atom item (one requiring students to choose between procedures or coordinate several mastered atoms) may only be placed at a bridge, application, or mixed-performance lesson.

The No-Forcing Rule — lessons are never distorted to absorb items. An item that fits no lesson is triaged, deferred, or excluded; the sequence is repaired only when the triage proves an in-scope demand is genuinely untaught.

End-of-Course Exclusion — if an item requires an instructional demand that is taught later in the course and is not a documented prerequisite of the lesson's objective, the item is excluded from lesson alignment. Such items are treated as end-of-course or cumulative assessments rather than evidence for placement within the instructional sequence. A later skill that is actually a prerequisite (e.g., a discrimination lesson requiring two previously taught operations) can influence placement appropriately; a later, unrelated skill that simply appears because the state wrote an end-of-course item does not force the item later in the sequence — it is excluded from lesson alignment instead. That prevents cumulative released items from distorting the atomization while still allowing legitimate prerequisite relationships to affect placement.

## The Exclusion Triage Rule

Applies when an embedded demand never enters the ledger — it appears in no lesson and no listed prerequisite. Do not immediately discard the item. Run this triage, in order:

- Triage Question 1 — Is the demand prior-grade content? If the skill belongs to an earlier grade's standards, students are already accountable for it. If it can be activated in under two minutes, add it explicitly to M(0) and re-run placement for the item. If it requires explicit reteaching, create a preskill lesson (Discovery step 6), rebuild the ledger, and re-run placement.
- Triage Question 2 — Is the demand within the current standard's scope? If the skill falls inside the standard being atomized but appears in no lesson, the item has exposed a candidate missing atom. Re-run the discovery process on that demand. If the standard implies it, add the atom to the sequence, rebuild the ledger, and re-run placement for all affected items. Multiple items orphaned by the same demand are strong evidence that the atom is missing.
- Triage Question 3 — Is the demand beyond the standard? If the skill lies outside the standard and outside the grade, EXCLUDE the item. Exclusion is silent: excluded items receive no annotation in the Item Alignment Map. The Grade Progression Web will usually show where the demand lives — typically a next-grade topic.

The order is mandatory: prior-grade first, in-scope second, exclusion last. The triage is the feedback loop through which item alignment audits the atomization itself — orphaned items are one of the strongest signals that the lesson sequence has a gap.

## Item Generation Doctrine

Trigger: any lesson with zero PLACED items after the Item Alignment Algorithm completes.

Governing rule: state rigor, ledger scope. Generated items match the precision, format, and cognitive demand of the state's released items while drawing every skill exclusively from M(L). Every generated item must:

- Measure only the lesson's objective — exactly one target demand.
- Draw every embedded demand from M(L).
- Mirror released-item conventions: stem phrasing, response formats (multiple choice, multi-select, gridded response), and distractor logic of the state's released items.
- Build distractors from predictable student errors within taught content — never from untaught skills.

Prohibitions: never introduce untaught vocabulary, untaught representations, or contexts requiring outside knowledge. Never reduce rigor because the lesson is early — an early lesson's item covers a smaller scope at full state-level precision. Smaller scope, not softer demand.

## The Item Alignment Algorithm

Run after ordering is complete. Execute the steps in order; loop where directed.

- Step A — Build the ledger. M(0) = the explicit prerequisite list; M(L) = M(L−1) + Lesson L's new entries.
- Step B — Decompose every released item. One target demand + a complete embedded-demand list per item.
- Step C — Match targets (Condition A). For each item, find the lesson whose objective exactly matches the item's target demand. If no lesson matches, send the item to Exclusion Triage.
- Step D — Check the ledger (Condition B). Pass → PLACED at the matched lesson (subject to the Coordination Rule). Fail on a demand taught later → DEFERRED; place per the Deferral Rule. Fail on a demand that never enters the ledger → Exclusion Triage.
- Step E — Apply triage outcomes. Prerequisite added to M(0) or atom added to the sequence → rebuild the ledger and re-run Steps C–D for every affected item. Demand beyond the standard → EXCLUDED.
- Step F — Generate. Every lesson with zero placed items receives generated items per the Item Generation Doctrine.
- Step G — Validate and emit. Check every placement and generated item, then emit the Item Alignment Map. For each lesson the map records: lesson number, title, and lesson type; objective and new ledger entries; assessment source (RELEASED, GENERATED, or MIXED); each item, with a one-sentence justification stating the target match and the ledger check.

## Coherence Web Doctrine

Webs are renderings of the ledger, not a second source of truth. Every edge must be justifiable by a ledger entry and the dependencies established during atomization and item alignment. If a web seems to need an edge the ledger cannot justify, the sequence is wrong — fix the sequence, then re-render the web. Never edit a web directly.

Three tiers, three altitudes:

- Atom web (Tier 1) — a teacher planning tomorrow's lesson sees exactly what today's atom requires and unlocks.
- Unit web (Tier 2) — a coach sequencing the year sees which units feed which, and what skills carry each dependency.
- Grade progression web (Tier 3) — anyone asking "where does this come from and where does it go" sees the topic from the grade before and the topic in the grade after. Nothing more.

Every web at every tier is a directed acyclic graph: no cycles, and every edge points from earlier to later. Every edge at every tier reads the same way: "is required by".

## The Atom Web — One Per Unit

Nodes: one node per lesson in the unit's final sequence; one node for the unit's standing M(0) prerequisite set; a separate, flagged node for every prerequisite added by Triage Q1, so repairs stay visible. Node metadata: number, title, lesson type, objective (one sentence), assessment source, and a triage flag if the atom was inserted by Triage Q2.

Edge Rules — draw A → B only when all three conditions hold:

- Direct consumption. B's new learning uses A's ledger entry in its start cue, its procedure, or its response form.
- Minimality. The dependency is not already carried through an intermediate atom. No transitive edges: if A → B → C exists, add A → C only if C consumes A beyond what B transmits.
- Order. A precedes B in the sequence, or A is an M(0) node.

Structural Requirements:

- Every lesson except the first has at least one incoming edge.
- Every bridge has one incoming edge from each competing atom — at least two.
- Every application receives an edge from each atom it coordinates.
- Every representation lesson receives an edge from the atom whose knowledge it re-expresses.
- M(0) nodes connect only to the atoms that consume them — never to Lesson 1 by default.

## The Unit Web — One Per Grade or Course

Nodes: every unit in the scope and sequence, in teaching order. Node metadata: unit number, title, primary standards, atom count.

The Lift Rule — draw U → V if and only if at least one of the following holds: an atom in V directly consumes a skill taught by an atom in U, or V's M(0) contains entries that are taught in U rather than in a prior grade.

Label every unit edge with the one to three skills that carry the dependency — for example, "carries: equivalent ratios, unit rates". An unlabeled unit edge is unverifiable and therefore invalid. Minimality applies at this tier too: no transitive unit edges.

The Orphan Check — a unit with no incoming edges and no prior-grade feed in the progression web is either truly foundational or mis-sequenced. Verify against the progressions document before accepting it.

## The Grade Progression Web — Topic Level

Purpose: context, not instruction. For every unit it answers exactly two questions: what topic from the grade before feeds this unit, and what topic in the grade after consumes it.

Nodes are topics — short noun phrases at the grain of a progressions document: "fraction division", "ratios and rates", "proportional relationships". Never skills, never lessons, never items.

Structure: one row per unit — prior-grade topic(s) (grade N−1) → this unit's topic (grade N) → next-grade topic(s) (grade N+1). A grade-level rollup may combine all rows into a single three-column view for the whole year.

Sources and limits: topics come from official standards progressions; when progressions are silent, the source grade of the unit's dominant M(0) entries defines the prior-grade topic. No more than three topics per side per unit. No edges between topics within the same grade — that is the unit web's job. No skill-level or item-level detail at this tier, ever.

## The Web Construction Algorithm

Run after the Item Alignment Algorithm has completed for every unit.

- Step A — Extract dependencies. For each lesson in each unit, list the ledger entries its new learning directly consumes. This list exists implicitly from the ledger and the placement work; make it explicit.
- Step B — Emit each atom web. Verify the DAG property and the structural requirements.
- Step C — Lift to the unit web. Apply the Lift Rule across all units. Label carrying skills on every edge. Run the Orphan Check.
- Step D — Attach grade context from the progressions documents for grade N−1 and grade N+1.
- Step E — Validate and regenerate. Whenever triage inserts an atom or adds a prerequisite, rebuild the ledger first, then regenerate every affected web. Webs are always downstream of the ledger.

The reference interaction for rendering is a coherence-map web — the focused node centered, everything it requires fanning in from the left, everything it unlocks fanning out to the right, with every node clickable to re-center. The data object, not the drawing, is the deliverable; the drawing must be regenerable from the object alone.

## Atomize the Entire Standard (P4)

The tool does not limit lessons to skills explicitly named in the standard or unpacking document. It performs a full Direct Instruction task analysis of the standard and generates any instructionally necessary in-between atoms, prerequisite micro-skills, bridges, and application tiers needed for mastery. These atoms stay inside the standard's boundary; they do not add new expectations, but make the full standard teachable, sequenced, and observable. The only restriction is that if an atom belongs in a previous unit or grade level, it is excluded.

## No Evidence is Not No Lesson (P5)

When no released item is PLACED at a lesson, the lesson stays in scope. The lesson receives generated items under the Item Generation Doctrine — state rigor, ledger scope — flagged as generated with the inference basis stated, so the inference is inspectable, not abstract. The absence of a particular performance in the released sample is never interpreted as evidence that the performance is never assessed.

## Modeling Scope

After granularity is set, we decide the teaching scope inside the atom — what is explicitly modeled vs. left to practice.

Within the atom (lesson), there may be a breadth of content spanning different difficulty levels. Aligned to direct instruction, not all content warrants full modeling. Grounded in learning science (worked-example effect, cognitive load theory, explicit instruction), minimum viable modeling targets only the steps and cases that form or revise schemas and prevent common novice errors. We model the smallest set of exemplars needed to cue decisions, make invisible thinking visible, and enable rapid transfer, then fade support. The rest moves directly to independent practice (Stein et al., 2017).

Building on that principle of minimum viable modeling, vary only surface features between "I Do" and "We Do" to promote transfer, and hold the routine constant so novices attend to the same decision path.

What to vary between "I Do" and "We Do":

- Numbers and magnitude — scale values (small to large), include boundary cases that still use the same steps.
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

Explicit modeling is necessary for: new rule/strategy or clear misinterpretation risk; unmastered representation (first time seeing a form); high cognitive load / multiple hidden steps; preskill missing or shaky; look-alike confusion likely; foundational prerequisite for later learning; error-prone skill where mistakes fossilize; jump in cognitive demand (procedural to application/modeling).

Extension is sufficient for: same strategy as taught with no new steps; representation already mastered; single, familiar procedure repeated with varied numbers/contexts only; preskills solid; low confusability; non-foundational variant of the same atom; stable error pattern absent; same demand band within the atom.

## How Lessons Are Named

Lesson titles are intentionally engineered: the shortest string that says what the lesson covers and what makes it unique.

- Lead with the observable behavior ("Round Multi-Digit Whole Numbers to Any Place").
- Carry a constraint only when a sibling lesson differs on it ("…by a One-Digit Number" exists because a two-digit-multiplier sibling does).
- Ban pedagogy filler — no "Introduction to", no "Exploring".
- A bridge title contains the competing atoms ("A vs. B") or the explicit selection behavior — never "Mixed Practice" or "Review".
- A reader scanning only the lesson names must be able to tell every lesson apart and predict what each covers.

## Worked Example: CCSS 6.RP.A.3 — The Full Pipeline

The doctrine above, demonstrated on one real standard — "Use ratio and rate reasoning to solve real-world and mathematical problems". Every lesson boundary, placement, deferral, exclusion, and edge is justified by doctrine, not intuition.

Discovery (steps 1–5): observable behaviors listed (read/write/interpret ratios, generate equivalent ratios, use ratio tables, find/compare unit rates, solve ratio/rate/percent problems, convert units, solve applications); concepts identified (ratio, rate, unit rate, equivalent ratio, percent, proportional relationship); representations identified (ratio notation, tables, double number lines, coordinate graphs, equations); hidden decisions found — "flour for 20 muffins" vs "flour for 1 muffin" use the same numbers but different start cues and decision paths (equivalent ratio vs unit rate), therefore different atoms; prerequisites checked — fraction simplification verified activatable, so it enters M(0) rather than becoming a preskill lesson.

Split decisions (step 6): read ratios — No (same concept as writing, no new decision path); write ratios in three forms — No (same routine, different notation); interpret ratios — Yes (new conceptual understanding before procedures); generate equivalent ratios — Yes (new procedure requiring explicit modeling); use ratio tables — Yes (new representation); find unit rates — Yes (new concept and computational rule); compare unit rates — Yes (new decision behavior); solve one-step ratio problems — No (same computational routine in context); solve multi-step ratio problems — No (same mathematics with increased coordination; reserved for an application lesson).

Sequencing, bridges, applications (steps 7–9): Understand Ratios → Write Ratios → Interpret Ratios → Generate Equivalent Ratios → Represent Ratios Using Tables → Solve Equivalent Ratio Problems → Understand Unit Rates → Find Unit Rates → Compare Unit Rates; bridges "Equivalent Ratios vs. Unit Rates" and "Choose the Appropriate Ratio Representation" (selection only, no new mathematics); applications "Solve One-Step Ratio Word Problems" and "Solve Multi-Step Ratio Problems". First pass: 13 lessons.

Ledger (step 10): M(0) = whole-number multiplication and division; fraction simplification. Each lesson's new entries recorded (e.g. L1 ratio concept + vocabulary "ratio"; L4 equivalent-ratio procedure + vocabulary "equivalent"; L5 ratio tables read/construct; L8 unit-rate computation).

Item placement (step 11) — seven released items through the algorithm:

- R1 (which table shows the relationship): target = construct/identify a ratio table; embedded = ratio concept (L1), notation (L2). PLACED at Lesson 5 — Condition A matches L5's objective, all demands in M(5).
- R2 (flour for 20 muffins): target = solve an equivalent-ratio problem in context. PLACED at Lesson 6.
- R3 (which is the better buy): compare unit rates; embedded decimal division NOT in the ledger → TRIAGE Q1: decimal division is Grade 5 content, activatable in under two minutes → added to M(0), flagged; re-run: PLACED at Compare Unit Rates.
- R4 (unit rate from a graph): embedded demand "reading a coordinate graph of a ratio relationship" NOT in the ledger → TRIAGE Q2: graphing ratio relationships is inside 6.RP.A.3 but no lesson teaches it — candidate missing atom CONFIRMED → Representation lesson "Graph Ratio Relationships" inserted after tables (flagged inserted-by-triage); ledger rebuilt; re-run: PLACED.
- R5 (which equation represents the proportional relationship): proportional equations are 7.RP.A.2c — Q1 no, Q2 no → TRIAGE Q3: EXCLUDED, silently.
- R6 (complete the ratio table, pool-tagged to equivalent ratios): Condition A matches Lesson 4, Condition B fails at L4 (tables enter the ledger at L5) → DEFERRED to the earliest later application lesson where B passes (One-Step Applications).
- R7 (tickets for $100): multi-step, coordinates unit-rate computation + equivalent-ratio reasoning → Coordination Rule: Application only. PLACED at the final application lesson.

Note what the triage produced: R3 repaired the prerequisite list, R4 repaired the scope itself, and R5 was excluded only after both repair questions failed. The item pool audited the atomization.

Final map (steps 12–13): 14 lessons; every lesson without a placed released item carries GENERATED items at state rigor over ledger scope (e.g. Lesson 2 "Write Ratios": "A basket holds 5 pears and 3 plums. Which shows the ratio of pears to plums? A. 3:5 B. 5:3 C. 5:8 D. 8:5" — distractors encode order reversal and part-to-whole errors; every skill inside M(2); full state rigor over a two-lesson scope).

Coherence webs (step 14): the atom web's edge list is all direct consumptions with no transitive edges — there is no L4 → L6 edge, because tables (L5) carry the equivalent-ratio dependency into graphing. M(0) → L4 carries fraction simplification; the flagged M(0)+ node → Compare Unit Rates carries decimal division; both bridges receive one incoming edge per competing atom; applications receive an edge per coordinated atom. The unit web lifts "Unit 1 Ratios and Rates → Unit 2 Percents" carrying unit rates and ratio tables. The grade progression row reads: fraction operations and division (Grade 5) → ratios and rates (Grade 6) → proportional relationships (Grade 7) — which is exactly where R5's excluded demand becomes visible again.

## Example: Granularity Build From Released STAAR Questions

To cover STAAR problems involving real-world application of comparing fractions, the released problems include: finding a fraction greater/less than a given fraction; identifying which comparison is true from a word problem; given a fraction model, determining which inequality is true; identifying true comparisons from tables.

Determining lesson granularity: granularity is driven by the smallest new behavior (atom) the lesson can provide. Some problems compare two explicitly given fractions; others require determining WHICH fractions to compare — a new decision step with additional steps and higher cognitive load. The split rules fire (a new or hidden decision step), so the lesson splits into two: "Word Problems Involving Identifying Correct Fraction Comparisons" and "Word Problems Involving Comparing Multiple Fractions".

Determining which problems to model — for each lesson, the minimum viable modeling set: Lesson 1 models EASY (fraction model → which inequality is true), MEDIUM (identifying correct comparisons from a word problem with two or three fractions), HARD (a table with 4–5 values → which comparison is true); Lesson 2 models EASY (finding a fraction greater/less than a given fraction) and MEDIUM (a table with qualitative answer choices requiring multiple comparisons). Problems that look different but measure the same mastered skill, differ only in formatting, or sit at the same rigor over already-mastered representations go straight to practice.`

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
      name: 'Curriculum Atomization, Item Alignment & Coherence Guide',
      description:
        'The academic specification for the curriculum scope generator, compiled from the Curriculum Atomization, Item Alignment & Coherence Guide — a Direct Instruction framework for decomposing standards into teachable lessons, aligning state-level assessment items, and mapping coherence across lessons, units, and grades. It defines the atom conditions, the discovery process, split and don\u2019t-split rules, the five lesson types, ordering rules, the Cumulative Mastery Ledger, the released-item Placement Rule and Exclusion Triage, the Item Generation Doctrine, and the three-tier coherence webs that govern how standards-aligned curriculum scopes are produced.',
      // v4.1 (2026-07-16): Split Decision Rules expanded to the No-HITL
      // Curriculum Scope Generator Specification's nine named criteria
      // (adding demand-band jump and data-driven error pattern), Don't-Split
      // gains already-mastered representations and mastered-integration mixed
      // practice, and the Tie-Breakers + Editing Splits (error-pattern bar)
      // sections are now formal engine text.
      version: 'v4.1',
      updated: '2026-07-16',
      content: ENGINE_CONTENT,
    },
    doctrine: {
      kind: 'doctrine',
      name: 'Direct Instruction Framework',
      description:
        'The foundational instructional text that establishes the Direct Instruction principles used by the generator. It defines the instructional doctrine, lesson design, sequencing, mastery expectations, error correction, and teaching practices that govern how curriculum is atomized, ordered, and taught.',
      version: 'v1.8',
      updated: '2026-04-19',
      content: DOCTRINE_CONTENT,
    },
  }
}
