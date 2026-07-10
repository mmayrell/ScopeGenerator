import {
  Artifact,
  ItemRecord,
  Lesson,
  LsgCourseLesson,
  LsgRun,
  PerformanceReport,
  Proposal,
  Scope,
  StandardNode,
  StandardSet,
  Unit,
  VsgConflict,
} from '../domain/types'
import { getFramework } from '../data/framework'
import { VSG_PLAYBOOK_CONTENT, VSG_PLAYBOOK_NAME, VSG_PLAYBOOK_VERSION } from '../data/video-playbook'
import { doctrineExcerptsFor, DoctrineQuery } from './doctrine'
import { VideoDoctrine } from './formats'
import {
  CourseMap,
  DeferredItem,
  PlanLessonSkeleton,
  PlanOutput,
  PlanUnit,
  WireLsgPlan,
  WireLsgPlanLesson,
} from './schemas'

/**
 * Prompt assembly (spec §6: "Every stage prompt is assembled from: relevant
 * policies verbatim + compiled engine procedure + doctrine excerpts
 * (Stein-priority noted) + the consuming artifacts' usage notes + resolved
 * evidence"). Each prompt embeds short verbatim spec excerpts, the evidence
 * JSON, and the demanded output discipline.
 */
export interface Prompt {
  system: string
  user: string
}

/** Canonical-code shapes of every supported framework (see the rerun prompts' comment). */
const CODE_SHAPES = /(?:[A-Z]{1,3}\.)?[0-9]+\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*(?:\.[A-Za-z0-9]+(?:\([A-Za-z0-9]+\))*)*/g

const jsonBlock = (label: string, data: unknown): string =>
  `\n<${label}>\n${JSON.stringify(data, null, 1)}\n</${label}>\n`

// Slim whole-course unit/lesson listing — the sequencing narrative (card rule
// 16) needs the full unit order even when the call regenerates a single unit
// or lesson.
const scopeUnitsOverview = (scope: Scope): string =>
  jsonBlock(
    'scope_units_overview',
    scope.units.map((u) => ({
      id: u.id,
      title: u.title,
      strand: u.strand,
      lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type })),
    })),
  )

// ---------------------------------------------------------------------------
// Verbatim spec excerpts (short), quoted from SPEC.md
// ---------------------------------------------------------------------------

const PRECEDENCE = `Precedence chain (spec §2.1, role-based, applies to every generation decision):
1. The standards document is the boundary authority — "the official standard wording … defines the outer limit of instructional scope, and it exercises that authority only as a veto (the Contradiction Rule, P1)."
2. "Released items are the primary empirical evidence of what is assessed and how hard."
3. Structured decomposition "partitions standards into assessable components and supplies default parameter bounds."
4. Interpretive documents "place, connect, and inform — prerequisites, cross-grade placement, misconceptions, representation vocabulary — never instructional stance (P7)."
5. User usage notes "steer interpretation everywhere below the boundary and may pin bounds; they cannot cross the boundary."
Engine and doctrine sit outside this chain: they are the rules the evidence is processed under. Where doctrine sources or interpretive documents disagree on method, Stein's DI method prevails (P3).`

const POLICIES = `Governing policies (spec §3, key excerpts verbatim):
- P1 (Evidence First — but the Standard Holds the Veto): "Released items govern inclusion, emphasis, and difficulty freely — except when an item demands something the standard's own wording or stated boundaries exclude at this grade. Then, and only then, the standard wins: the item is set aside as a rigor signal and cannot expand scope. Cautious readings of a standard are never used to suppress real test evidence." Every such event is logged in the card's Decision record with both sides cited.
- P2 (Items Are Judged by Content, Never by Code): states revise standards while reusing the same numbering, so an item's printed alignment code cannot be trusted to carry meaning. Every item is classified by what it actually demands: in-boundary | rigor-signal-only (the veto case) | adjacent-grade.
- P3 (One Strategy, Algorithm First): "Students are not given a menu of methods — they are given the single best one, selected per Stein. Representations and manipulatives come after the algorithm is mastered, framed as interpretations of it, never as parallel ways to compute." An Instructional Approach naming two computation strategies fails QC automatically.
- P4 (Atomize the Entire Standard): "The tool does not limit lessons to skills explicitly named in the standard or unpacking document. It performs a full DI task analysis of the standard and generates any instructionally necessary in-between atoms, prerequisite micro-skills, bridges, and application tiers needed for mastery. These atoms stay inside the standard's boundary; they do not add new expectations, but make the full standard teachable, sequenced, and observable. The only restriction is that if an atom belongs in a previous unit or grade level, it is excluded."
- P5 (No Evidence is Not No Lesson): "When no released item tests a component, the component stays in scope. The tool infers the assessment evidence that would plausibly exist — from how sibling skills are tested and where the component sits developmentally — flags everything built on that inference as inferred, and writes a concrete exemplar problem at the inferred difficulty so the inference is inspectable, not abstract." The corpus coverage declaration weights the inference: absence in a census corpus argues the component is genuinely untested (developmentally-appropriate DI reasoning); absence in a sample corpus is weak evidence (extrapolate from analogous tested components).
- P6 (Other Grades' Items Know Their Place): below-grade items serve as prerequisite evidence and rigor calibration; above-grade items may be cited only when explaining what is deliberately not taught yet (Non-Goals/Progression Placement). Neither creates new lessons in this course.
- P7 (Progression Informs Placement, Never Pedagogy): interpretive documents are "mined for sequencing, prerequisites, vocabulary, documented misconceptions, and worked problems" — never for instructional stance. Where their method preferences conflict with doctrine, Stein prevails and the conflict is logged.
- P8 (Mastery is Observable Behavior): "Every card states mastery as 'Students are able to: …' — an observable performance under stated conditions. Never 'students will understand.' Task parameters (number ranges, step counts) belong to the scope; accuracy percentages and rates do not — the delivering application owns those thresholds." Fluency triggers flag the requirement and cite the trigger; the rate itself is the app's.
- P9/A3 (Error Patterns Shape Instruction; the Editing Splits bar): at generation only documented misconceptions count (Stein's error inventories, misconceptions in the evidence documents, user notes); reported student data is admissible at full strength through the revision workflow. "An error pattern justifies a split only when it reveals a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise it intensifies modeling inside the atom, or seeds a bridge where the confusion is between two atoms."
- P12 (Sequence by Instructional Dependency; Keep Units Coherent): "Lessons are ordered by the DI sequence required for mastery, not by the order standards appear in a document or by keeping all atoms from the same standard together. Atoms aligned to the same standard may be separated across the course when prerequisite readiness, confusability, representation demands, or application demands require other lessons to come first. However, each atom must still sit inside a coherent instructional unit."
- Interpretive bounds are defaults, not law (precedence chain, level 3): decomposition clarifications and interpretive limits supply the default parameter bounds; observed in-boundary item evidence overrides these defaults in either direction; usage notes may pin a bound. Every override and pin is logged in the Decision record.`

const APPENDIX_A = `Compiled atomization procedure (the engine document's Atomization Guide, run per standard; all decisions emit DecisionEntries):
- A1 Discover (the Atom Discovery Process — the engine's eight considerations, IN ORDER, per standard): (1) identify every observable student behavior (identify, compare, solve, represent, explain, classify, construct, justify — each distinct capability a candidate atom); (2) identify every distinct mathematical idea (each new concept a candidate atom); (3) identify every representation (a separate atom whenever students must learn to express or interpret meaning through it for the FIRST time, rather than merely use it); (4) identify vocabulary stabilization lessons (a vocabulary atom whenever a new academic term carries conceptual meaning before the procedure); (5) identify selection skills (whenever choosing the correct approach among previously learned procedures is itself new learning, a candidate atom); (6) identify prerequisite gaps (a preskill lesson whenever a candidate atom requires a prerequisite that belongs to the generated course but has not yet appeared — prerequisite instruction is NEVER embedded inside a later lesson; prior-grade prerequisites do not get preskill lessons); (7) validate instructional coverage and rigor (if released items or other admissible evidence reveal a documented in-scope instructional demand not yet explicitly taught, insert atoms until covered — word problems, modeling, and application tasks within scope are explicitly taught, never assumed); (8) identify bridge lessons (a lesson may combine multiple previously mastered skills only to teach ONE new capability: discrimination, comparison, selection, or integration).
- A2 Split Test (the engine's Split Decision Rules, verbatim): split into a new atom whenever instruction introduces "a new rule · a new algorithm · a new representation · a new vocabulary concept · a new decision point · a new prerequisite · a new discrimination · a new integration behavior" — plus objective overload (more objectives than one lesson can explicitly model; every objective a lesson claims must be modeled in it) and documented error patterns (per P9, subject to the Editing Splits bar). Do not split merely because numbers become larger. Don't-Split Rules: remain ONE atom when only "numbers become larger · context changes · wording changes · formatting changes · problem difficulty increases · additional practice is needed" — provided the cognitive routine remains identical. When split and don't-split readings both genuinely fire, split criteria win.
- A3 Atom Validation: every lesson satisfies ALL the atom conditions — one instructional objective, one observable behavior, one decision path, one start cue, one response form, one mastery criterion — and students never have to decide between two different procedures inside a single atom. Every lesson answers exactly one question: "What is the one new capability students acquire today?"
- A4 Lesson Types & Doctrines: type every lesson as preskill (prerequisite knowledge) | new-learning (a new behavior) | representation (a new way of expressing already-learned knowledge) | bridge (choosing between previously mastered atoms) | application-tier (transfer into authentic problems). Representation Doctrine: representations are instructional only when students must learn to interpret, construct, or choose them — otherwise they remain examples inside another lesson. Vocabulary Doctrine: words are never taught in isolation; vocabulary lessons exist only when the word introduces a new concept or misunderstanding it blocks later instruction. Bridge Doctrine: bridges never teach new mathematics — discrimination, selection, switching, coordination only; the title contains the competing atoms ("A vs. B") or the explicit selection behavior, never "Mixed Practice" or "Review"; placed only after both parents are independently mastered. Application Doctrine: applications never introduce new computational procedures — they increase demand through modeling, interpreting, justifying, contexts, and coordination of multiple atoms.
- A5 Modeling Scope: explicit modeling for new rules/misinterpretation risk, unmastered representations, high load/hidden steps, shaky preskills, look-alike confusion, fossilization-prone errors, demand jumps; extension for same-strategy/no-new-steps variation (the engine's minimum-viable-modeling rules).
- A6 Validate the graph: the finished sequence forms a coherent dependency graph — every lesson unlocks later learning, every dependency points forward, and no lesson appears before the knowledge it requires.`

const SEQUENCING = `Sequencing & unit formation (the engine document's Ordering rules — the shortest coherent instructional path to mastery, determined by documented instructional dependencies, DI doctrine, and admissible evidence, NEVER by the order of the standards document):
1. Prerequisites first — every lesson appears only after all required prerequisite knowledge has been taught or is expected from prior grades.
2. Teach one new capability at a time — later lessons may depend on multiple previously mastered capabilities but may not introduce multiple new ones.
3. Concepts before procedures — the concepts, vocabulary, and representations necessary to understand a procedure come before that procedure.
4. Explicit instruction before application — new procedures, algorithms, and decision skills are taught explicitly before independent application, word problems, or transfer.
5. Generalize before extending — expand the example range within the same generalization before introducing a new rule, capability, or decision.
6. Integrate only after mastery — bridges, cumulative review, and mixed practice only after the component atoms are mastered individually (confusables separated in time; within a concept cluster, the sacrificial first instance).
7. Evidence determines rigor — if admissible evidence demonstrates an untaught instructional demand, insert lessons before students are assessed on it.
8. Units follow coherent knowledge progressions — units group closely related atoms building toward a common mathematical idea; unit boundaries minimize prerequisite crossings and maximize instructional coherence, traceable to the set's theme/emphasis statements or progression streams.
9. The sequence forms a coherent dependency graph — every lesson unlocks later learning, every dependency points forward, no lesson appears before the knowledge it requires.
P12 — Sequence by Instructional Dependency; Keep Units Coherent: lessons are ordered by the DI sequence required for mastery, NOT by the order standards appear in a document or by keeping all atoms from the same standard together. Atoms aligned to the same standard MAY be separated across the course when prerequisite readiness, confusability, representation demands, or application demands require other lessons to come first — but each atom must still sit inside a coherent instructional unit: it belongs to the unit's strand, builds from nearby lessons, prepares for upcoming lessons, and makes sense as part of the unit's visible skill chain. Granularity and unit count are purely logic-driven; no calendar constraint.`

const CARD_RULES = `The fixed lesson card (spec §7) — fourteen content fields in fixed order, plus the Decision Record (the per-field rationales, the numbered decision entries, and the two closing lesson-level narratives of item 16). EVERY field must be filled. Fields 5–14 carry AT LEAST ONE citation drawn from the supplied evidence (uncited fields are rejected before QC); fields 1–4 carry NO citations (citations: []) — they state the authority and the mastery definition directly. Never cite the same source twice on one field.
1 standards — the official standard this atom is aligned to: its canonical ID in official capitalization (e.g. 6.RP.A.3b), followed by the official wording of that standard quoted VERBATIM from the standards document — never paraphrased. When the lesson teaches only part of the standard, also name the exact sub-part taught (lettered sub-part or governing decomposition key). Show the canonical code ONCE; do NOT append the normalized/join code (e.g. "(6.rp.a.3b)") — it is an internal matching key and repeating the same code is redundant. Format: "<CODE> — <verbatim standard wording>". Nothing else. No citations on this field.
2 cluster — the cluster's official wording quoted VERBATIM from the standards document; its job is context; never paraphrase. No citations on this field.
3 substandard — a verb-led, lesson-level objective derived from the official standard: it names the SINGLE teachable behavior this lesson is responsible for teaching, specific enough to distinguish this atom from neighboring atoms, but broad enough to include all legitimate problem types, representations, and variations inside the lesson boundary. It is NOT official standards language, and it must not lock the lesson to one item format, one example type, or one assessment wording. One sentence. No citations on this field.
4 objectives — a concise, exhaustive numbered list of the observable learning objectives that define mastery of this lesson atom; each objective describes ONE specific skill or behavior students must demonstrate. Objectives are specific enough to precisely define what students are expected to learn, but never constrain assessment format, context, representation, or response type unless that constraint is itself part of the learning objective. The list must satisfy the MINIMAL-COMPLETE test — Complete: together, the objectives fully describe everything required for mastery of the lesson; Minimal: removing any objective would leave part of the intended mastery unspecified, while adding another would introduce unnecessary detail or duplicate an existing one. Objectives describe what students must be able to DO — not how that ability is assessed or taught: assessment format, difficulty, representations, contexts, and instructional method belong to other fields. QC on this field: the objective set is the smallest complete set that guarantees mastery; every Assessment Evidence statement (field 13) must trace to at least one objective; every objective must be assessable; no objective may exist solely to constrain question format, instructional method, or representation unless that constraint is itself part of the lesson boundary. If the objectives exceed what one lesson can model, the granularity is wrong (A2 objective overload) — never absorb extra objectives into one card. No citations on this field.
5 emphasis — the designation under the set's emphasis source, "not designated where none exists — never guessed."
6 progression — two required layers: cross-grade (from interpretive documents) and within-course (the atoms immediately before and after in this skill's chain, by lesson reference).
7 prerequisites — each prerequisite tagged taught-in-course (lesson ref) or prior-grade. FORMAT: one prerequisite per line (newline-separated), each line a single prerequisite phrase with its tag — no numbering, no bullet characters (the UI renders the bullets).
8 boundary — Explicit Included/Excluded lists in consistent set vocabulary with concrete parameters. State the boundary itself and NOTHING else: the content never says where excluded content lives (grade, course, unit, or lesson) — that relocation information belongs in the field's decision record (the rationale and a boundary-tagged decision entry), not the content. Components running on inference set the inferred flag — the inference itself (what it rests on, what it extrapolates from) is reasoned in a boundary-tagged decision entry, never narrated in the content.
9 newLearning — REQUIRED FORMAT, the atom triple: "start cue (what the student sees that signals this routine) + single decision path/strategy (named) + one observable response form. One of each, written so a stranger could build the lesson from it." Two routines or two response forms fails QC automatically. Write it as "Start cue: … Decision path: … Response form: …".
10 approach — "Exactly one named strategy, selected per Stein (P3); then the modeling scope — which specific cases are explicitly modeled for the student versus which cases go straight to independent practice/extension." Name the actual cases (numbers, magnitudes, contexts, formats) on each side; do NOT use gradual-release labels — no "I Do", "We Do", or "You Do" in the field content. Begin new-learning and preskill approach fields with "Single strategy: <name>".
11 nonGoals — forward-looking "do not teach yet" exclusions with citations, each pointing to where the content will be taught when known.
12 ceiling — Concrete parameters — number sizes, step counts, representation load, context complexity — in consistent set vocabulary, naming the hardest legitimate case. The content states ONLY the ceiling itself. An inferred ceiling sets the inferred flag; what it extrapolates from, and every override of a decomposition default, is reasoned in a ceiling-tagged decision entry — never in the field content.
13 assessment — P8 format: "Students are able to: [observable behavior] [task parameters] [conditions]" — observable verbs only; every statement traces to at least one objective in field 4; fluency flag with trigger basis when applicable, or its absence stated with basis; no percentages, rates, or counts.
14 releasedItems — itemRefs carries the items the plan's Item Alignment Algorithm PLACED (or DEFERRED) at this lesson under the engine's Placement Rule — Condition A (exact target match: the item's target demand matches this lesson's objective — same capability, same decision path, same response form) and Condition B (ledger containment: every embedded demand of the item is already taught by this point in the sequence, or sits in the explicit prerequisite list M(0)) — ordered by closeness to ceiling; the field's content describes what is shown and, per the Item Alignment Map schema, states each item's one-sentence justification (the target match and the ledger check). Rigor-signal-only items never appear here (ceiling citations only, in field 12); EXCLUDED items appear nowhere — exclusion is silent. When no released item is placed at this atom — expected for many legitimate atoms, with preskill, concept, and introductory lessons explicitly NOT exempt — the field carries GENERATED ASSESSMENT EXEMPLARS under the engine's Item Generation Doctrine: STATE RIGOR, LEDGER SCOPE. One to three items representing what the state assessment would look like if it assessed exactly this atom: each measures ONLY this lesson's objective (exactly one target demand), draws EVERY embedded demand from what has been taught by this lesson (plus M(0)) — never untaught vocabulary, untaught representations, or contexts requiring outside knowledge — and mirrors released-item conventions in professionalism, stem phrasing, response format, cognitive demand, distractor logic, and language precision (describe any visual or representation precisely in the stem — very descriptive stimulus descriptions of graphs, diagrams, and images). Never reduce rigor because the lesson is early: an early lesson's item covers a smaller scope at full state-level precision — smaller scope, not softer demand. Selected-response exemplars carry a full choice set whose distractors encode predictable student errors within TAUGHT content (never untaught skills); constructed-response exemplars carry choices: []. Each is unmistakably labeled 'Generated exemplar — not a released item', its basis cited, the generation logged in the Decision record. The field is never empty. For such lessons: itemRefs is [], generatedExemplars is filled (1–3), and the releasedItems content must include the exact label text "Generated exemplar — not a released item".
15 decisions — numbered DecisionEntries, "terse, numbered, tagged with rule IDs (P#/A#), and cited", covering the required entry types: (1) granularity, (2) strategy selection with its Stein basis, (3) boundary & ceiling calls (overrides/pins logged), (4) contradictions & conflicts with both sides cited, (5) assumptions under thin evidence. "If a type had nothing to decide, say so in one clause rather than omitting silently."
16 sequencingRationale & granularityRationale — two REQUIRED lesson-level narratives (top-level lesson properties, never card fields) that CLOSE the card's decision record; each is self-contained prose written to the same standard as the per-field rationales, typically 3–8 sentences, never empty and never boilerplate reusable on another lesson.
- sequencingRationale answers WHY THE UNITS ARE ORDERED THE WAY THEY ARE and why this lesson holds its exact position inside its unit. Two layers, both required: (a) the unit layer — name the units that precede and follow this lesson's unit (from the plan overview, by id and title) and the specific instructional dependencies that fix that order (which skills those units supply or consume, which confusables they separate), citing the sequencing rules actually applied (preskills before composites, easier before difficult, algorithm before required representations, confusables separated in time, bridges after both parents); (b) the lesson layer — which earlier lessons this one requires mastered (by lesson id), which later lessons depend on it, and why the position is forced rather than arbitrary. Ground both layers in the actual evidence of THIS scope — the progression documents, the prerequisite chain, the unit strands — never in generic sequencing platitudes.
- granularityRationale answers WHY THIS LESSON IS EXACTLY THIS GRANULARITY, arguing BOTH directions concretely: (a) why not LESS granular — name the neighboring atom(s) it was cut from and the specific engine Split Decision Rule that genuinely fired at each boundary (the new rule, new algorithm, new representation, new vocabulary concept, new decision point, new prerequisite, new discrimination, new integration behavior, or objective overload the neighbor carries that this atom does not), citing the engine document; (b) why not MORE granular — name the internal variation the lesson deliberately keeps together and the Don't-Split Rules holding it (only numbers becoming larger, context/wording/formatting changes, difficulty increases, or additional practice — the cognitive routine identical throughout). A narrative that argues only one direction, or that asserts criteria without naming the concrete content on each side of the boundary, is a defect.
PER-FIELD DECISION RECORD (rationale) — EVERY field 1–14 returns { content, citations, rationale, inferred }, rationale included on fields 1–4 even though they carry no citations. The rationale is that field's decision record: a clear, coherent, SELF-CONTAINED and THOROUGH explanation of why the content reads exactly the way it does — which evidence drove it, how the precedence chain settled competing sources, which defaults or alternatives were rejected or overridden and why, where excluded or deferred content lives, and what any inference rests on. Write it as flowing professional prose (typically 2–6 sentences) that a curriculum director can follow with no knowledge of this pipeline: name the evidence in plain words ("the standard's own wording", "the 2023 released test, question 17", "the decomposition's default parameter bounds") and, when a rule id appears, say in a few words what the rule is (e.g. "the standard-holds-the-veto rule (P1), under which the standard's wording wins"). When the governing authority is the engine document or the Direct Instruction doctrine (the BrainLift chapters supplied in this prompt), SAY SO by name — cite the engine rule or the doctrine chapter that drove the call (sourceType "engine" / "doctrine") rather than leaving the authority implicit. Every rationale must be SPECIFIC to this field on this lesson: it names the concrete content choices it justifies (the numbers, parameters, strategy, wording actually chosen) and the concrete alternatives rejected; a rationale generic enough to sit unchanged under a different field or a different lesson is a defect. Model the reasoning on the engine document's worked example ("Example: Granularity Build From Released STAAR Questions"): it names the evidence under review, states the criterion applied to it, and walks to the determination — so the reader can re-run the reasoning themselves. Every rationale follows that same arc: the evidence consulted → the rule or comparison applied → the conclusion the content states, including what was deliberately excluded or deferred and where it lives. The rationale never restates or paraphrases the field content — it explains it; a rationale that merely repeats the content is a defect. The numbered decision entries stay terse and rule-tagged; the rationale reads as the full story those entries compress.
CLEAN-FIELD SEPARATION (binding — OVERRIDES any per-field clause that could be read otherwise): fields 1–14 state the WHAT thoroughly and never the WHY — no reasoning, no "because", no weighing of alternatives, no derivation narrative ("overrides the default", "extrapolated from", "inferred from the absence of"), no rule ids (P#/A#), no naming of the documents that drove a choice. All of that lives exclusively in the decision record — the per-field rationale and the numbered decision entries. No card field content uses gradual-release labels ("I Do", "We Do", "You Do") — the modeling scope is stated as which concrete cases are modeled for the student versus which go to independent practice. Each DecisionEntry carries "field": the card field key its reasoning governs (standards|cluster|substandard|objectives|emphasis|progression|prerequisites|boundary|newLearning|approach|nonGoals|ceiling|assessment|releasedItems), or "card" for lesson-level calls (granularity, lesson type, sequencing). The record renders directly under its field, so every consequential choice inside a field's content must have a decision entry tagged to that field; strategy selection is field "approach", boundary calls "boundary", ceiling calls "ceiling", exemplar-generation logging "releasedItems".
Example — WRONG ceiling content: "Hardest case: 7110 ÷ 90. The four-digit cap overrides the decomposition's five-digit default per P1; the remainderless cap is INFERRED — extrapolated from the absence of remainder demand across observed items." RIGHT ceiling content: "Hardest legitimate case: four-digit dividend divided by a two-digit divisor with an exact quotient (7110 ÷ 90 = 79); all quotients remainderless." — with a ceiling-tagged decision entry carrying the override, the inference, and its citations.
Citations: { sourceType, label, locator, excerpt } — sourceType one of standards|items|decomposition|interpretive|engine|doctrine|admin-notes|sequence|performance-report; the excerpt quotes VERBATIM the exact sentence(s) of the supplied evidence that drove the decision — a reader hovering the citation sees only this excerpt, so it must stand alone as the driving evidence, never a paraphrase. Use sourceType "sequence" for within-course chain references.
Headings, unit titles, and lesson titles in Title Case. Lesson titles follow the engine's How Lessons Are Named rules: the shortest string that says what the lesson covers and what makes it unique — lead with the observable behavior, carry a constraint only when a sibling lesson differs on it, no pedagogy filler ("Introduction to", "Exploring"); a reader scanning only the lesson names must be able to tell every lesson apart and predict what each covers. Every field written under faultless communication — it must read one way only.`

const LEDGER_AND_ALIGNMENT = `The Cumulative Mastery Ledger & the Item Alignment Algorithm (the engine document's Placement Doctrine — run AFTER ordering is final, BEFORE emitting the plan; the placement decisions become each lesson skeleton's itemRefs):
- Build the ledger: M(0) = the explicit prerequisite list per unit — prior-grade skills students are accountable for, each verified as activatable in under two minutes; NOTHING enters M(0) by assumption. M(L) = M(L−1) + Lesson L's new entries (its objective plus any vocabulary or representation explicitly taught inside it). The ledger is the SOLE authority on "have students learned X by Lesson L?" — if X is not in M(L), the answer is no, regardless of how plausible "they probably know it" feels.
- Decompose every in-boundary item: exactly ONE target demand (the single behavior the item is designed to elicit) plus a complete embedded-demand list across the six categories — computations, representations (to read or construct), vocabulary, decisions, coordinations of procedures, contextual knowledge.
- The Placement Rule — PLACE item i at Lesson L if and only if BOTH hold. Condition A (exact target match): the item's primary instructional target matches Lesson L's objective — same capability, same decision path, same response form. Condition B (ledger containment): every required embedded demand of the item is contained in M(L). No partial credit, no "close enough".
- The Deferral Rule: Condition A matches L but B fails on a demand taught LATER → DEFER the item to the earliest later review, bridge, or application lesson where B passes.
- The Coordination Rule: a multi-atom item (choosing between procedures, or coordinating several mastered atoms) may only be placed at a bridge or application-tier lesson.
- The No-Forcing Rule: lessons are NEVER distorted to absorb items — an item that fits no lesson is triaged, deferred, or excluded; the sequence is repaired only when triage proves an in-scope demand is genuinely untaught.
- End-of-Course Exclusion: an item requiring a demand taught later in the course that is NOT a documented prerequisite of the matched lesson's objective is EXCLUDED from lesson alignment (treated as end-of-course/cumulative assessment) — cumulative items never distort the atomization.
- The Exclusion Triage Rule (when an embedded demand never enters the ledger — mandatory order): Q1 prior-grade content? Activatable in under two minutes → add it to M(0) as a SEPARATE prereq entry flagged addedByTriage and re-place; needs explicit reteaching → insert a preskill lesson, rebuild the ledger, re-place. Q2 within the standard's scope but taught nowhere? The item exposed a missing atom — re-run discovery on that demand, insert the atom flagged "inserted-by-triage", rebuild the ledger, re-place all affected items (multiple items orphaned by the same demand are strong evidence the atom is missing). Q3 beyond the standard and the grade → EXCLUDE, silently: excluded items get NO itemRefs entry and NO annotation anywhere. The triage is the feedback loop through which item alignment audits the atomization itself.
- Lessons with zero placed items are EXPECTED and stay at full quality: the cards stage writes GENERATED items for them under the Item Generation Doctrine — state rigor, ledger scope (P5).`

const WEB_EXTRACTION = `Dependency extraction for the coherence webs (the engine document's Output 3 — emitted with the plan; the webs render from this data alone):
- Per lesson, dependsOn: the DIRECT dependencies of its new learning, per the atom-web edge rules — (1) direct consumption: the dependency's ledger entry is used in this lesson's start cue, its procedure, or its response form; (2) minimality: NO transitive edges — if A → B → C, add A → C only if C consumes A beyond what B transmits; (3) order: every dependency names an EARLIER lesson id (same or earlier unit) or a prereq id from this unit's prereqs list. Each dependency's carries names the 1–3 specific ledger entries it transmits (e.g. "equivalent-ratio procedure"). Structural requirements: every lesson except the very first has ≥1 dependency; every bridge has one incoming dependency from EACH competing atom (≥2); every application-tier lesson depends on each atom it coordinates; every representation lesson depends on the atom whose knowledge it re-expresses; prereq (M(0)) nodes connect only to the atoms that consume them — never to Lesson 1 by default.
- Per unit, prereqs: the unit's M(0) nodes — id "<unitId>.M0" for the standing prerequisite set (label summarizing the prior-grade skills), plus one SEPARATE entry per Triage-Q1-added prerequisite (ids "<unitId>.M0b", "<unitId>.M0c", …, addedByTriage true) so repairs stay visible. addedByTriage false for the standing set.
- Per unit, grade-progression context (topics ONLY — short noun phrases at the grain of a progressions document, e.g. "fraction division", "ratios and rates"; never skills, lessons, or items): topic = this unit's topic; priorGradeTopics = the topic(s) from the grade before that feed it (≤3, from the progression documents; when progressions are silent, the source grade of the unit's dominant M(0) entries defines it); nextGradeTopics = the topic(s) in the grade after that consume it (≤3). Derive from the progression/interpretive evidence and cite decisions in scopeDecisions; infer a relationship only on clear, converging evidence.`

const BLAST_RADIUS = `Blast radius (spec §8): "When a lesson splits or merges, the relational fields of adjacent and dependent lessons — Prerequisites, Assessment Boundary, Non-Goals, within-course Progression Placement — auto-regenerate, with the change noted in their Decision records; content fields untouched."`

const EDITING_SPLITS = `Data-informed revision mapping (spec §8): "The tool maps the report onto framework actions using the engine's Editing Splits logic: splits where the reported errors reveal a new/unstable start cue, a new decision step, or a missing prerequisite; modeling intensification inside the atom where they don't; bridge insertion where the confusion runs between two atoms; ceiling or boundary adjustments where the report shows mis-set difficulty." Guardrails apply inside proposals: a change that collapses a boundary protected by a hard split criterion must carry a guardrail note citing the criterion instead of being silently proposed.`

const OUTPUT_DISCIPLINE = `Respond with a single JSON object matching the required schema exactly. No prose outside the JSON, no markdown fences.`

/**
 * The doctrine-consultation block for card-writing stages: the matching
 * chapter excerpts from Direct Instruction Mathematics (5th ed.) — the
 * Instructional Approach is selected FROM the book's procedures and formats,
 * not paraphrased from memory. Empty when no chapter matches (fallback: the
 * doctrine principles in the system prompt still apply).
 */
const doctrineBlock = (q: DoctrineQuery): string => {
  const excerpts = doctrineExcerptsFor(q)
  if (!excerpts) return ''
  return `
Doctrine consultation — Direct Instruction Mathematics (5th ed., Stein, Kinder, Silbert & Carnine), the controlling method authority. The chapter excerpts below are the PRIMARY source for field 10 (Instructional Approach): select the single best strategy, its preskills, and the modeling scope FROM these instructional procedures and teaching formats — name the strategy the way the book teaches it, and follow its recommended sequence and example selection.
CITING THE TEXTBOOK IS MANDATORY where these excerpts govern a decision. On every new-learning lesson whose topic the excerpts cover: (a) the approach field carries a doctrine citation, and (b) the strategy-selection decision entry (type "strategy", field "approach") carries a doctrine citation naming its Stein basis. Doctrine citations use sourceType "doctrine", label = the chapter title (e.g. "Direct Instruction Mathematics (5th ed.), ch. Division"), locator = the most specific location inside the excerpt that drove the call — the teaching format number and name (e.g. "Format 10.4: Division with Two-Digit Divisors"), the Instructional Sequence and Assessment Chart row, or the section heading — and excerpt = the verbatim sentence(s) of the excerpt that drove it. The same applies wherever the excerpts drive OTHER decisions: preskill choices they name (prerequisites), problem-type sequences they prescribe (progression, boundary, ceiling), and documented error patterns they inventory (newLearning, modeling scope, distractor design) are cited the same way. Where the excerpts do not cover the specific case, fall back to the doctrine principles in the system prompt (cite the doctrine framework document itself) and say so in the rationale.
<doctrine_excerpts>
${excerpts}
</doctrine_excerpts>
`
}

// The governing engine document (Lesson Granularity & Modeling Scope, from
// data/framework.ts) — embedded IN FULL in every generation stage's system
// prompt. Its split / don't-split criteria, tie-breakers, bridge rules,
// editing-splits bar, modeling scope, and worked examples are the sole
// authority for lesson granularity; nothing below may contradict it.
const engineDocBlock = (): string => {
  const engine = getFramework().engine
  return `The governing engine document — "${engine.name}" (${engine.version}) — is BINDING on every generation decision; no rule below overrides it. Lesson granularity (the atom conditions, the Atom Discovery Process, the Split and Don't-Split Decision Rules), lesson types, ordering, the Cumulative Mastery Ledger, released-item placement (the Placement Rule, Deferral, Coordination, No-Forcing, Exclusion Triage), item generation (state rigor, ledger scope), the coherence-web rules, and modeling scope are all determined from THIS document's rules and examples. Its terms carry exact meanings — do not substitute intuitive readings. The document in full:
<engine_document>
${engine.content}
</engine_document>
Engine-level addendum (equally binding): every objective a lesson claims must be explicitly modeled in that lesson — a lesson that accumulates more objectives than one lesson can model MUST split (objective overload is a split trigger, exactly like a new decision step).`
}

// The doctrine framework document (the DI BrainLift compiled from Stein et
// al.) — embedded in full in every generation stage's system prompt. It is
// the operative summary of the controlling method authority; the topical
// chapter excerpts (doctrineBlock) supply the book's actual procedures on
// card-writing stages. Citable as sourceType "doctrine".
const doctrineDocBlock = (): string => {
  const doctrine = getFramework().doctrine
  return `The doctrine document — "${doctrine.name}" (${doctrine.version}, compiled from Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics, 5th ed., 2017) — governs every instructional-method decision. When a decision rests on one of its principles, cite it (sourceType "doctrine", label "${doctrine.name} (${doctrine.version})", locator = the section heading). The document in full:
<doctrine_document>
${doctrine.content}
</doctrine_document>`
}

const systemCore = (role: string): string =>
  `You are the ScopeGenerator pipeline engine — ${role}. You turn a standard set's evidence corpus into strand-coherent units of atomized lessons under Direct Instruction doctrine (Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics, 5th ed., 2017 — the controlling method authority) and the Curriculum Atomization, Item Alignment & Coherence Guide (the engine document below).

${engineDocBlock()}

${doctrineDocBlock()}

${PRECEDENCE}

${POLICIES}

${OUTPUT_DISCIPLINE}`

// ---------------------------------------------------------------------------
// Evidence serialization
// ---------------------------------------------------------------------------

function flattenTree(nodes: StandardNode[], out: StandardNode[] = []): StandardNode[] {
  for (const n of nodes) {
    out.push(n)
    if (n.children) flattenTree(n.children, out)
  }
  return out
}

function setEvidence(set: StandardSet): Record<string, unknown> {
  return {
    name: set.name,
    subject: set.subject,
    gradeSpan: set.gradeSpan,
    hierarchyLevels: set.hierarchyLevels,
    codingScheme: set.codingScheme,
    codingNotes: set.codingNotes,
    emphasisSource: set.emphasisSource,
    tree: set.tree,
    artifactUsageNotes: set.artifacts.map((a) => ({
      role: a.role,
      fileName: a.fileName,
      usageNotes: a.usageNotes,
      meta: a.meta ?? {},
    })),
    acknowledgedCoverageWarnings: set.warnings.map((w) => w.text),
  }
}

function itemsForCodes(set: StandardSet, codes: string[], itemRefs: string[]): ItemRecord[] {
  const wanted = new Set(codes.map((c) => c.toUpperCase()))
  const refSet = new Set(itemRefs)
  const flat = flattenTree(set.tree)
  const normsForWanted = new Set<string>()
  for (const node of flat) {
    if (wanted.has(node.code.toUpperCase()) || wanted.has(node.norm.toUpperCase())) {
      normsForWanted.add(node.norm.toUpperCase())
      normsForWanted.add(node.code.toUpperCase())
    }
  }
  return set.items.filter(
    (it) =>
      refSet.has(it.id) ||
      wanted.has(it.alignmentCode.toUpperCase()) ||
      normsForWanted.has(it.alignmentCode.toUpperCase()),
  )
}

/**
 * User-attached released-question PDFs (topic requests) — the generation call
 * carries them as native document blocks; this block tells the model what
 * they are and how they rank as evidence.
 */
/** `names` MUST be the files actually attached to this call (loadScopeUploadDocs order) — never the request's display metadata, which can diverge when a blob is missing or budget-skipped. */
const userUploadsBlock = (names: string[]): string => {
  if (names.length === 0) return ''
  return `
USER-SUPPLIED RELEASED QUESTIONS: ${names.length === 1 ? 'one PDF document is' : `${names.length} PDF documents are`} attached to this request, in this exact order: ${names.map((n, i) => `document ${i + 1} = "${n}"`).join('; ')}. The user uploaded ${names.length === 1 ? 'it' : 'them'} with this scope request as released questions to model from. Treat them as released-items evidence for this scope: classify their items per P2 against the scoped standards; they calibrate demand, inform boundaries and ceilings, and are PRIMARY models for the generated assessment exemplars on this topic (construction quality, distractor style, language precision, visual conventions). They are NOT in the set's item bank, so their items never enter itemRefs — reference them in field content and cite them with sourceType "items", label "User upload: <fileName>" (the file names above, matched by attachment order), locator by page/question number. Cite ONLY these attached documents — never a file name from the request metadata that is not in the list above.
`
}

/**
 * Cross-framework union mode — active whenever a scope draws on more than one
 * standard set (e.g. a CCSS set + a TEKS set). One combined course covering
 * every standard of every selected set: unique standards get their own
 * lessons, overlapping standards merge with the assessment boundary widened
 * to the union of the frameworks' demands.
 */
const unionBlock = (sourceSets: StandardSet[]): string => {
  if (sourceSets.length < 2) return ''
  const names = sourceSets.map((s, i) => `Set ${i + 1} = "${s.name}" (scheme: ${s.codingScheme})`).join(' · ')
  return `
CROSS-FRAMEWORK UNION MODE is ON — this scope draws on ${sourceSets.length} standard sets (${names}) and must produce ONE combined course after which a student has mastered EVERY standard of EVERY selected set to its fullest demand. BINDING rules:
- CROSSWALK FIRST (content-based, never code-based — the P2 philosophy): classify every most-granular content standard of each set as (a) unique to its set, or (b) overlapping specific standard(s) of the other set(s) — the same skill substance, judged from the official wordings. Log every classification in scopeDecisions.
- UNIQUE standards get their own lessons from their set's evidence, exactly as normal.
- OVERLAPPING standards merge into ONE lesson chain — never parallel duplicate lessons for the same skill. Field 1 (Standard) of a merged lesson lists EVERY aligned standard: each framework's canonical code and verbatim wording, labeled with its set name.
- BOUNDARY UNION: a merged lesson's assessment boundary and ceiling are the UNION of the aligned standards' demands — wherever one framework's parameters exceed the other's, the lesson teaches and assesses the WIDER demand. Example: one framework limits denominators to 2, 3, 4, 5 and the other allows 2, 3, 4, 5, 8 → the merged lesson covers denominators 2, 3, 4, 5, AND 8. The Included list states the union parameters plainly, and every widening is recorded in a boundary-tagged decision entry citing BOTH standards.
- The boundary-authority veto (P1) runs against the UNION: content is in-boundary when ANY selected set's standard wording includes it; a contradiction exists only when demand exceeds EVERY selected framework's boundary for that skill.
- Emphasis (field 4): where the frameworks' designations differ, state each framework's designation by set name; 'not designated' only where NO selected set designates.
- Items: classify and attach against the union boundary of a lesson's aligned standards; the released-item coverage rule runs across every selected set's item bank.
- Sequencing: ONE coherent course — the union skill set ordered by the sequencing rules; never one framework's course appended after the other's.
- COVERAGE IS THE COMPLETION TEST: the plan is defective if any most-granular content standard of ANY selected set lacks a covering lesson (each lesson skeleton's standardCodes must make the covering standards traceable, using each framework's own codes).`
}

/**
 * The standards evidence for the prompt: per-set blocks (framework-labeled)
 * when union mode is active — the crosswalk needs to know which framework
 * each tree belongs to, which the merged corpus erases — else the single
 * merged block.
 */
const standardsEvidenceBlocks = (set: StandardSet, sourceSets: StandardSet[]): string =>
  sourceSets.length >= 2
    ? sourceSets.map((s, i) => jsonBlock(`standard_set_${i + 1}_evidence`, setEvidence(s))).join('')
    : jsonBlock('standard_set_evidence', setEvidence(set))

// ---------------------------------------------------------------------------
// Stage prompts
// ---------------------------------------------------------------------------

/** The mode-specific scope charter — shared by both planning passes. */
const requestDescriptionOf = (set: StandardSet, scope: Scope): string =>
  scope.request.mode === 'course'
    ? `Whole-course scope: cover every published content standard of the set over the full grade span (${set.gradeSpan}), TOGETHER WITH the full skill chain each standard requires (P4 — atomize the entire standard). The introductory, foundational, and scaffolding atoms (preskills, first-instance lessons, bridges, application tiers) that build toward each skill are FIRST-CLASS lessons and are included even when no released item aligns to them — no evidence is not no lesson (P5); released items are demand evidence, never the inclusion filter. Untested components stay in scope on flagged inference with generated exemplars. Released-item demand profiles calibrate how hard each lesson goes (never past the standard's own limits, P1), never whether the atoms that build the assessed skills appear in the course.`
    : scope.request.mode === 'standard'
      ? `Standard scope: exactly the selected standard(s) "${scope.request.params}" and their skill chains (preskills, bridges, application tiers directly serving them). When several standards are selected, produce ONE coherent scope — a single sequenced set of units covering all of them together, ordered per the sequencing rules across the whole selection, never one disconnected mini-scope per standard.`
      : `Topic scope: the request "${scope.request.params}" — map it onto the set's hierarchy and include exactly the standards that constitute that topic.`

/**
 * Planning pass 1 — the course map. Scope resolution and unit architecture
 * WITHOUT lesson skeletons: atomization runs per unit in dedicated follow-up
 * calls (unitPlanPrompt), each with its own full output budget. This is what
 * lets a full course atomize at guide depth — a single whole-course planning
 * call must compress its plan into one output window and produced
 * under-atomized courses (~60 lessons where guide fidelity demands 100+).
 */
export function courseMapPrompt(
  set: StandardSet,
  scope: Scope,
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  // Compact corpus digest — scope-level review only; the per-unit calls get
  // the full records for their own standards.
  const itemDigest = set.items.map((it) => ({
    id: it.id,
    alignmentCode: it.alignmentCode,
    scopeClass: it.scopeClass,
    demandProfile: it.demandProfile,
  }))
  return {
    system: systemCore(
      'planning pass 1 of 2 — Stage 2 scope resolution and course architecture: unit formation, unit ordering, and grade-progression topics (atomization follows per unit)',
    ),
    user: `Build the COURSE MAP for the scope request below. This is planning pass 1: resolve the scope and architect the units — NO lesson skeletons yet. Atomization (Stage 3), the ledger, and item placement run in dedicated follow-up calls, ONE PER UNIT, on exactly the standards this map assigns to each unit — so a standard this map drops is a standard the course will never teach, and COVERAGE IS THE COMPLETION TEST: the map is defective if any in-scope most-granular content standard is missing from every unit's standardCodes.

Responsibilities, in order:
1. Scope resolution (Stage 2): resolve the request to every most-granular content standard in scope (governing decomposition keys or the sub-part fallback).
2. Corpus review: item_digest below carries every extracted item's P2 classification and demand profile. Log scope-level calls in scopeDecisions — P1 veto events (rigor-signal-only items and what they signal), corpus coverage observations, partition rationale. Do NOT place items — the per-unit calls run the Item Alignment Algorithm with the full records.
3. Unit formation (the engine's Ordering rule 8): units group closely related atoms building toward a common mathematical idea; unit boundaries minimize prerequisite crossings and maximize instructional coherence, traceable to the set's theme/emphasis statements or progression streams. Assign EVERY resolved standard to exactly ONE unit's standardCodes (its most-granular code, verbatim from the evidence).
4. UNIT SIZE IS BINDING: each unit must atomize comfortably inside one follow-up call. At guide depth (the engine document's worked example: ONE standard → 14 lessons) that means AT MOST 3–4 most-granular standards per unit — fewer when a standard is dense (multi-part, representation-heavy). Prefer MORE, SMALLER, strand-coherent units over fewer large ones; a 2-standard unit is normal, an 8-standard unit is a defect.
5. Unit ordering (the engine's Ordering rules): prerequisites first, concepts before procedures, confusables separated, the sequence a coherent dependency graph — never the order of the standards document.
6. Grade-progression context per unit (guide §23 — topics ONLY, short noun phrases at progressions-document grain, ≤3 per side, [] when the evidence genuinely names none): topic, priorGradeTopics, nextGradeTopics.

${requestDescriptionOf(set, scope)}
${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${jsonBlock('scope_request', scope.request)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('item_digest', itemDigest)}

Output:
- units: in teaching order, ids "U1", "U2", …; each { id, title (Title Case), rationale (strand-coherent, traceable to theme/emphasis statements or progression streams), strand, topic, priorGradeTopics, nextGradeTopics, standardCodes }.
- scopeDecisions: terse records of scope-level calls (P1 vetoes, P2 corpus observations, the partition used, unit-formation and ordering rationale, grade-progression topic sources${sourceSets.length >= 2 ? ', and EVERY union crosswalk classification — each standard unique-to-set or overlapping, per the union rules' : ''}), each tagged with its rule id (P#/A#).`,
  }
}

/**
 * Planning pass 2 — one unit's full plan: atomization (A1–A6 per standard),
 * within-unit ordering, the Cumulative Mastery Ledger (seeded with every
 * prior unit's entries), the Item Alignment Algorithm over this unit's items
 * (deferrals thread across units), and dependency extraction.
 */
export function unitPlanPrompt(
  set: StandardSet,
  scope: Scope,
  map: CourseMap,
  unitIndex: number,
  priorUnits: { id: string; lessons: PlanLessonSkeleton[] }[],
  pendingDeferrals: (DeferredItem & { fromUnit: string })[],
  /**
   * The unit's item records, partitioned IN CODE (pipeline
   * partitionItemsByUnit) so every in-scope item reaches exactly one unit
   * call — includes coarse-grain-aligned items this unit owns and the
   * records behind pendingDeferrals.
   */
  evidenceItems: ItemRecord[],
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  const unit = map.units[unitIndex]
  // The prior units' ledger contributions, compact: one line per lesson. The
  // sole authority on "taught before this unit" (guide §15).
  const ledgerLines = priorUnits.flatMap((u) =>
    u.lessons.map(
      (l) =>
        `${l.id} [${l.type}] ${l.title} — objective: ${l.objective ?? l.planningNotes.slice(0, 120)}${
          l.newEntries && l.newEntries.length > 0 ? ` — new entries: ${l.newEntries.join('; ')}` : ''
        }`,
    ),
  )
  return {
    system: systemCore(
      'planning pass 2 of 2 — Stages 3–4 for ONE unit: atomization (the Atom Discovery Process), sequencing, the Cumulative Mastery Ledger, the Item Alignment Algorithm, and dependency extraction for the coherence webs',
    ),
    user: `Plan unit ${unit.id} — "${unit.title}" ONLY, following the engine document's pipeline strictly and in order: atom discovery → split decisions → ordering → the Cumulative Mastery Ledger → the Item Alignment Algorithm (with Exclusion Triage repairs looping back into the sequence) → dependency extraction. The course map below fixes this unit's standards, its position in the course, and its neighbors; sibling calls plan the other units.

Stage 3 — Atomization. Run the Atom Discovery Process EXPLICITLY AND SEPARATELY FOR EACH standard in unit_assignment.standardCodes — all eight considerations, in order, per standard:
${APPENDIX_A}
DEPTH DISCIPLINE (binding):
- Calibrate atomization DEPTH to the engine document's worked example ("Worked Example: CCSS 6.RP.A.3"): ONE standard yielded 14 lessons — concept and vocabulary atoms (Understand Ratios), notation atoms (Write Ratios), interpretation atoms, first-instance procedure atoms (Generate Equivalent Ratios, Find Unit Rates), representation atoms (Represent Ratios Using Tables, Graph Ratio Relationships), decision atoms (Compare Unit Rates), two bridges, and two application tiers — each justified by a named split rule. A partition that collapses a standard into one or two catch-all lessons is under-atomized; a partition that splits on quantitative-only variation (bigger numbers, changed context or wording, more practice) is over-atomized.
- A standard that resolves to fewer than three lessons is PRESUMPTIVELY under-atomized: it is legitimate only when the standard is genuinely a single atom, and its planningNotes must name the Don't-Split rules holding each would-be boundary together (the distinct behaviors, concepts, representations, vocabulary, decisions, and applications the standard names, and why each shares the same cognitive routine). Silence is a defect.
- You MUST enumerate the introductory, foundational, and scaffolding atoms (the preskill lessons, the concept/vocabulary atoms, the first-instance lessons that introduce each new routine, the representation atoms, the bridges between confusables, and the application tiers) as their own lesson skeletons — these are the atoms most likely to lack a directly-aligned item, and they are exactly the ones that must not be dropped (P4, P5). Item absence NEVER drives structure and NEVER removes an atom: mark them evidenceStatus inferred; the cards fill the gap with generated assessment exemplars at state rigor over ledger scope. A unit plan that contains only item-backed atoms is a defect.

Stage 4 — Ordering within the unit:
${SEQUENCING}

Stage 4b — Ledger & Item Placement (this produces itemRefs, placedDeferrals, deferredOut):
${LEDGER_AND_ALIGNMENT}
Cross-unit mechanics for THIS call:
- cumulative_ledger below lists EVERY lesson of the prior units (id, type, title, objective, new entries). The ledger for this unit starts from those entries plus this unit's M(0) prereqs — it is the sole authority on "taught before this unit"; if a skill is not there and not in M(0), it is untaught, no matter how plausible.
- Decompose every in-boundary item in item_bank_subset now (one TARGET demand + complete EMBEDDED demands across the six categories: computations, representations to read or construct, vocabulary, decisions, coordinations of procedures, contextual knowledge), then run the Placement Rule against this unit's lessons.
- An item whose Condition B fails on a demand this unit does not teach but a LATER unit's standards plausibly cover (see course_map) → emit a deferredOut entry ({ itemRef, missingDemands, note }) instead of forcing it; the later unit's call sees it as a pending deferral. Never place an item whose embedded demands are untaught.
- pending_deferrals below carries items deferred FROM earlier units. For each: if this unit teaches the missing demands, place it per the Placement Rule at the earliest qualifying review/bridge/application lesson — emit { itemRef, lessonId, justification } in placedDeferrals (lessonId must be one of THIS unit's lessons; do NOT also list it in a lesson's itemRefs — assembly merges it). If it still cannot be placed, ignore it — it stays pending for later units, and items pending after the last unit become end-of-course exclusions automatically.
- Exclusion Triage outcomes: Q1 prior-grade prerequisite → a SEPARATE prereqs entry flagged addedByTriage, then re-place. Q2 missing in-scope atom → insert the atom into THIS unit flagged "inserted-by-triage", rebuild, re-place. Q3 beyond the standard and grade → EXCLUDE silently, logged ONLY in scopeDecisions.

Stage 4c — Dependency Extraction (this produces dependsOn and prereqs):
${WEB_EXTRACTION}
dependsOn edges may name EARLIER lessons of THIS unit, lessons of PRIOR units (by their ids in cumulative_ledger), or this unit's prereq node ids — never later lessons.

${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${jsonBlock('scope_request', scope.request)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('course_map', map)}
${jsonBlock('unit_assignment', unit)}
${jsonBlock('cumulative_ledger', ledgerLines)}
${jsonBlock('pending_deferrals', pendingDeferrals)}
${jsonBlock('item_bank_subset', evidenceItems)}

Output:
- lessons: this unit's complete lesson skeletons in teaching order, ids "${unit.id}.L1", "${unit.id}.L2", … . Each: id, title (Title Case, engineered per the engine's How Lessons Are Named rules: the shortest string that says what the lesson covers and what makes it unique — lead with the observable behavior, carry a constraint only when a sibling lesson differs on it, no pedagogy filler like "Introduction to" or "Exploring"; bridge titles carry the competing atoms "A vs. B" or the explicit selection behavior, never "Mixed Practice" or "Review"), type (preskill | new-learning | representation | bridge | application-tier, per the engine's Types of Lessons), evidenceStatus (observed | inferred | mixed), standardCodes (canonical and/or normalized codes this lesson serves), itemRefs (the items PLACED or DEFERRED-IN here by the Stage 4b algorithm — never rigor-signal-only, adjacent-grade, or EXCLUDED items), planningNotes (the reasoning to hand to card generation: which split rules fired — and for any standard kept under three lessons, the Don't-Split defense — the item placement justifications in one sentence each (target match + ledger check), single strategy expectation, ceiling inputs, contradiction events, inference basis when evidenceStatus is inferred), objective (ONE sentence — the lesson's single instructional objective), newEntries (the lesson's new ledger entries: its objective plus vocabulary/representations explicitly taught in it), dependsOn (Stage 4c edges), flags (["inserted-by-triage"] only when Triage Q2 inserted this atom, else []).
- prereqs: the unit's M(0) nodes — id "${unit.id}.M0" for the standing prerequisite set (label summarizing the prior-grade skills), plus one SEPARATE entry per Triage-Q1-added prerequisite (ids "${unit.id}.M0b", "${unit.id}.M0c", …, addedByTriage true).
- placedDeferrals / deferredOut: per the cross-unit mechanics above ([] when none).
- Released-item coverage is MANDATORY but is NOT the inclusion filter: every in-boundary item in item_bank_subset aligned to this unit's standards must be PLACED at exactly one lesson's itemRefs, DEFERRED out, or EXCLUDED by triage with the exclusion logged in scopeDecisions — an item that is none of these is a planning defect. Coverage runs one way only: items must find a lesson or an exclusion, but lessons need NOT have items.
- scopeDecisions: terse records of this unit's calls (P1 vetoes, P5 inferences, triage outcomes — every Q1 M(0) addition, Q2 atom insertion, and Q3 exclusion with its basis), each tagged with its rule id (P#/A#).`,
  }
}

export function cardsPrompt(
  set: StandardSet,
  scope: Scope,
  plan: PlanOutput,
  unit: PlanUnit,
  batch: PlanLessonSkeleton[],
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  const codes = batch.flatMap((l) => l.standardCodes)
  const refs = batch.flatMap((l) => l.itemRefs)
  const evidenceItems = itemsForCodes(set, codes, refs)
  const planOverview = plan.units.map((u) => ({
    id: u.id,
    title: u.title,
    strand: u.strand,
    lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type })),
  }))

  return {
    system: systemCore('Stage 5: card generation for one unit'),
    user: `Generate complete lesson cards (all fourteen card fields plus per-field decision records) for the ${batch.length} lesson(s) of unit "${unit.id} — ${unit.title}" listed in batch_lessons, following the approved plan skeleton exactly (same lesson ids, same order, same types). Output ONLY the batch_lessons lessons — the unit's remaining lessons are produced by sibling calls; the full unit_skeleton is supplied so relational fields (Prerequisites, Progression Placement, Assessment Boundary, Non-Goals) can reference them by lesson id.

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: batch.map((l) => l.title), standardCodes: batch.flatMap((l) => l.standardCodes) })}${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
Additional requirements:
- evidence-locking is mandatory: generation returns { content, citations[], rationale } per field; uncited fields 5–14 are rejected pre-QC (spec §6 Stage 5); fields 1–4 return citations: [] but still carry a full rationale.
- decision entries must carry rule ids (P#/A#/D#) and quote both sides on every contradiction.
- for lessons whose skeleton has no placed itemRefs (evidenceStatus inferred), produce 1–3 generated assessment exemplars under the engine's Item Generation Doctrine — STATE RIGOR, LEDGER SCOPE: each measures only this lesson's objective, draws every embedded demand from skills taught by this point in the sequence (plus the explicit prerequisites), mirrors released-item conventions, and builds distractors from predictable student errors within taught content — and label each exactly "Generated exemplar — not a released item" in the releasedItems content. Preskill, concept, and introductory lessons are not exempt; never reduce rigor because the lesson is early (smaller scope, not softer demand).
- lesson-type semantics (the engine's Types of Lessons): preskill newLearning = the prerequisite skill itself, taught explicitly (never embedded in a later lesson); representation newLearning = the new mapping between mathematical meaning and the representation's form (interpret and/or construct), approach models the representation over already-mastered content; bridge newLearning = the selection/discrimination behavior between the competing mastered atoms, approach = mixed look-alike practice with no new rules modeled (bridges never teach new mathematics); application-tier newLearning = executing the mastered routine(s) in the authentic demand band (modeling, interpreting, justifying, multi-atom coordination — never a new computational procedure), boundary/ceiling inherited from the parent atom(s) plus the triggering demand statement's scope.
- itemRefs may only contain ids present in the supplied item bank. Item attachment was decided at planning: each lesson's itemRefs must be its skeleton's itemRefs from batch_lessons with every id COPIED VERBATIM (character-for-character — the ids render the item screenshots, so a mistyped id silently loses the item), reordered by closeness to ceiling. Never invent, alter, or drop an id.

${jsonBlock('scope_request', scope.request)}
${jsonBlock('plan_overview', planOverview)}
${jsonBlock('unit_skeleton', unit)}
${jsonBlock('batch_lessons', batch)}
${jsonBlock('scope_decisions_from_plan', plan.scopeDecisions)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('item_bank_subset', evidenceItems)}`,
  }
}

export function rerunLessonPrompt(
  set: StandardSet,
  scope: Scope,
  unit: Unit,
  lesson: Lesson,
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  // Code shapes across frameworks: CCSS 4.NF.B.3 · TEKS 4.3A / 6.2(A) /
  // 111.26(b)(4)(A) · SOL 3.NS.1 · B.E.S.T. MA.4.NSO.1.1. Union-mode merged
  // lessons list several frameworks' codes in field 1 — a CCSS-only pattern
  // silently dropped the other framework's items from the rerun evidence.
  // Over-matching is harmless (recall-side supply; a non-code just matches no
  // items); under-matching loses evidence.
  const codes = lesson.fields.standards.content.match(CODE_SHAPES) ?? []
  const evidenceItems = itemsForCodes(set, codes, lesson.itemRefs)
  return {
    system: systemCore('rerun: regenerate one lesson card in place (Stage 5 re-entry)'),
    user: `Regenerate the lesson card "${lesson.id} — ${lesson.title}" in place at the same granularity (spec §6 rerun re-entry: "regenerate-in-place → Stage 5 for that card"). Keep the lesson id, type, and position in the chain; produce a fresh card cited per the card rules (fields 5–14 cited; fields 1–4 citations: []).

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: [lesson.title], standardCodes: codes })}${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${jsonBlock('scope_request', scope.request)}
${scopeUnitsOverview(scope)}
${jsonBlock('containing_unit', { id: unit.id, title: unit.title, strand: unit.strand, lessons: unit.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type })) })}
${jsonBlock('current_lesson_card', lesson)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('item_bank_subset', evidenceItems)}`,
  }
}

export function rerunUnitPrompt(
  set: StandardSet,
  scope: Scope,
  unit: Unit,
  mode: 'split' | 'merge',
  target: string,
  override: boolean,
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  const codes = unit.lessons.flatMap((l) => l.fields.standards.content.match(CODE_SHAPES) ?? [])
  const evidenceItems = itemsForCodes(
    set,
    codes,
    unit.lessons.flatMap((l) => l.itemRefs),
  )
  return {
    system: systemCore('rerun: re-atomize one unit at different granularity (Stages 3–6 re-entry, scoped)'),
    user: `Rerun unit "${unit.id} — ${unit.title}" at ${mode === 'split' ? 'MORE granularity (split)' : 'LESS granularity (merge)'} around the target "${target}" (spec §6: "lesson granularity change → Stage 3 scoped to affected atoms, then 4–6 locally").${mode === 'split' ? ' A split still requires an A2 Split Decision Rule to genuinely fire around the target (a new rule, algorithm, representation, vocabulary concept, decision point, prerequisite, discrimination, or integration behavior, or objective overload — never merely because numbers become larger or difficulty increases). If none fires, keep the granularity unchanged and record the refusal with its basis in the affected Decision records.' : ''}

${APPENDIX_A}
${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${BLAST_RADIUS}

${override ? `An explicit user override of a protected hard-split boundary is in force for this merge: execute the merge, and log the override in the affected lessons' Decision records (type "override", both sides cited, rule id of the overridden criterion).` : ''}

Rules:
- Return the unit's complete new lesson list in teaching order, with full lesson cards for every lesson, renumbering ids as "${unit.id}.L1", "${unit.id}.L2", … .
- Adjacent lessons: regenerate their relational fields and note the change in their Decision records; content fields untouched unless the split/merge itself demands it.
- Fields 5–14 cited (fields 1–4 carry citations: []); decision entries carry rule ids (P#/A#).

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: unit.lessons.map((l) => l.title), standardCodes: codes })}

${jsonBlock('scope_request', scope.request)}
${scopeUnitsOverview(scope)}
${jsonBlock('current_unit', unit)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('item_bank_subset', evidenceItems)}`,
  }
}

export function proposalPrompt(
  scope: Scope,
  set: StandardSet,
  report: PerformanceReport,
): Prompt {
  const unit = scope.units.find((u) => report.target.startsWith(u.id))
  return {
    system: systemCore('data-informed revision: draft a proposal from a PerformanceReport (spec §8)'),
    user: `A user filed a PerformanceReport. Map it onto framework actions using the engine's Editing Splits logic and draft a change set. Nothing mutates until acceptance — this is a proposal.

${EDITING_SPLITS}

Rules:
- The PerformanceReport is admissible error-pattern evidence at full strength (P9); cite it as the evidence basis in each change's rationale.
- Each change: target ("<lessonId> · <Field Title>"), kind (split | merge | modeling | ceiling | bridge | relational), before (the current state, quoted or summarized from the actual card), after (the concrete proposed state), rationale (why the Editing Splits bar is or is not met), rule (e.g. "P9 / A3 (Editing Splits)").
- If a change would collapse a protected hard-split boundary (see protected_boundaries), keep the change but fill its guardrail field with the pushback text citing the criterion; otherwise guardrail is "".
- ripple: one entry per affected adjacent/dependent lesson group describing the relational-field regeneration on acceptance.

${jsonBlock('performance_report', report)}
${jsonBlock('protected_boundaries', scope.protectedBoundaries ?? [])}
${jsonBlock('targeted_unit', unit ?? scope.units)}
${jsonBlock('scope_summary', { title: scope.title, request: scope.request, version: scope.version, units: scope.units.map((u) => ({ id: u.id, title: u.title, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type })) })) })}`,
  }
}

export function iteratePrompt(scope: Scope, proposal: Proposal, feedback: string): Prompt {
  return {
    system: systemCore('data-informed revision: iterate a draft proposal on user feedback (spec §8)'),
    user: `The user replied to the draft proposal below with feedback. Re-check the implied action against the Editing Splits bar and the protected boundaries, then respond.

${EDITING_SPLITS}

Rules:
- response: a direct, evidence-grounded reply to the feedback. If the feedback asks for a merge that crosses a protected boundary, decline inside the proposal, citing the hard split criterion, and note that explicit override remains available on acceptance and would be logged and QC-flagged. If it asks for a split the report's evidence does not justify, explain which Editing Splits criteria are unmet and deepen the in-atom fix instead.
- changes: if the draft change set should be revised, return the COMPLETE revised change set (same shape as before, guardrail "" when none); if the change set stands unchanged, return an empty array.

${jsonBlock('current_proposal', proposal)}
${jsonBlock('user_feedback', feedback)}
${jsonBlock('protected_boundaries', scope.protectedBoundaries ?? [])}
${jsonBlock('scope_summary', { title: scope.title, version: scope.version, units: scope.units.map((u) => ({ id: u.id, title: u.title, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title })) })) })}`,
  }
}

export function applyPrompt(
  scope: Scope,
  set: StandardSet,
  unit: Unit,
  proposal: Proposal,
): Prompt {
  return {
    system: systemCore('data-informed revision: apply an accepted proposal (Stage 5 re-entry, scoped to the change set)'),
    user: `The proposal below was ACCEPTED. Rewrite the targeted lesson fields per the accepted change set, and regenerate the relational fields (Prerequisites, Assessment Boundary, Non-Goals, within-course Progression Placement) of adjacent/dependent lessons in the unit, noting each change in the lesson's Decision record with a citation of sourceType "performance-report".

${BLAST_RADIUS}

Rules:
- Return in lessons ONLY the lessons that change (full lesson cards, unchanged fields carried over verbatim); lessons you omit stay as they are. Apply only the changes whose targets fall inside this unit — changes targeting other units are handled by sibling calls.
- Every rewritten field 5–14 keeps ≥1 citation (fields 1–4 stay citations: []); the PerformanceReport is citable as sourceType "performance-report".

${CARD_RULES}
${doctrineBlock({
  unitTitle: unit.title,
  strand: unit.strand,
  lessonTitles: unit.lessons.map((l) => l.title),
  // Codes from the lessons' Standard fields (as the rerun prompts do) — an
  // empty list dropped the CCSS-domain signal from chapter matching here.
  standardCodes: unit.lessons.flatMap((l) => l.fields.standards.content.match(CODE_SHAPES) ?? []),
})}

${jsonBlock('accepted_proposal', proposal)}
${scopeUnitsOverview(scope)}
${jsonBlock('targeted_unit', unit)}
${jsonBlock('item_bank_subset', itemsForCodes(set, [], unit.lessons.flatMap((l) => l.itemRefs)))}`,
  }
}

// ---------------------------------------------------------------------------
// Scope Evaluation prompts — the rubric text comes from the evaluation
// spreadsheet's column headings, fetched at evaluation time. The agent's job
// is to APPLY each rubric exactly as written, not to invent criteria.
// ---------------------------------------------------------------------------

export function evalScorePrompt(
  bandName: string,
  columns: { heading: string; rubric: string; hardGate: boolean }[],
  evidence: Record<string, unknown>,
): Prompt {
  return {
    system: `You are the ScopeGenerator quality-evaluation agent. You score ONE generated scope against a fixed set of rubric columns from the team's evaluation spreadsheet. Each rubric below is the COMPLETE and BINDING scoring instruction for its column — apply it exactly as written (including its own scoring scale and any categorical terms it defines); never substitute your own criteria, never average away specific defects you can name.

Scoring discipline:
- verdict: exactly "3", "2", or "1" per the rubric's scale — except where a rubric defines its own categorical terms (e.g. Accurate / Inaccurate), in which case use that term verbatim.
- Judge from the supplied evidence ONLY. Where the evidence is a SAMPLE of the scope's lessons, score the sample and treat a defect found in the sample as representative; do not speculate beyond it.
- note: one line per defect or deviation, naming the specific lesson/unit and the concrete problem ("U3.L4 objectives include a percentage threshold"); '' when the column is a clean pass. A score of 2 or 1 with an empty note is a defect in YOUR output.
- Echo each column's heading EXACTLY as given.

${OUTPUT_DISCIPLINE}`,
    user: `Score the ${bandName} rubric columns for the scope below. One entry per column, headings echoed exactly, in the given order.

${columns.map((c) => `<rubric_column heading="${c.heading}"${c.hardGate ? ' hard-gate="true"' : ''}>\n${c.rubric}\n</rubric_column>`).join('\n')}

${Object.entries(evidence)
  .map(([label, data]) => jsonBlock(label, data))
  .join('')}`,
  }
}

// ---------------------------------------------------------------------------
// Ingestion prompts (Stage 1)
// ---------------------------------------------------------------------------

const ingestSystem = (role: string): string =>
  `You are the ScopeGenerator ingestion pipeline (Stage 1, spec §4) — ${role}. Ingestion is trusted (P10): uploads are curated evidence; extract maximally, never discard usable evidence because metadata is incomplete, and state degraded/AI-proposed reliance instead of silently omitting it.

${OUTPUT_DISCIPLINE}`

export function ingestStandardsPrompt(set: StandardSet, artifact: Artifact | undefined): Prompt {
  return {
    system: ingestSystem('official standards document parser'),
    user: `Parse the attached official standards PDF for the set "${set.name}" (${set.subject}, ${set.gradeSpan}).

P11 — Content Standards Only (spec §3, verbatim): "The standards parser analyzes only content standards — standards that teach assessable mathematical knowledge or procedures … It excludes, at ingestion, all standards that describe how students should think, communicate, justify, model, persevere, or solve problems: Mathematical Practice (MP) standards, Standards for Mathematical Practice (SMP), Process Standards, Mathematical Processes, Habits of Mind, and similar framework-wide expectations. … Completeness requirement: every most-granular content standard in the document — down to lettered sub-parts — is captured with its exact code and exact verbatim wording; a parser that drops any is defective."

Limit capture (spec §4.1): capture "all in-document limits: footnotes, parenthetical constraints, 'including/excluding' clauses, stated assessment boundaries" and attach each to the level it belongs to — dropping them silently corrupts the boundary authority. RESOLVE cross-references: a limit that is only a pointer ("See Glossary, Table 2.", "See footnote 5", an appendix reference) is defective — downstream stages never see the glossary. Follow the reference inside this same PDF and emit the substantive constraint it resolves to, e.g. a pointer to a glossary table of problem situations becomes a limit enumerating the specific situation types/subtypes the standard is limited to at this grade (including any shading/annotation the table applies to this grade). Keep the source traceable by prefixing the resolved text with the reference (e.g. "Glossary, Table 2: …"). Only if the referenced material is genuinely absent from the attached PDF, keep the verbatim pointer and note the gap in coverageWarnings. Flag fluency language per P8. Capture grade/course-level emphasis or theme statements as labels on grouping nodes where present.

Dual coding: emit a canonical ID per the set's official scheme AND a normalized join code per the set's normalization conventions (declared coding scheme: ${set.codingScheme || 'detect from the document'}). Both keep CAPITAL letters ("4.OA.A.1", never "4.oa.a.1") — normalization merges structural differences, it never lowercases.

User usage notes for this artifact (precedence level 5 — steering below the boundary): ${artifact?.usageNotes || '(none)'}

Output:
- nodes: a FLAT array of every hierarchy node (grouping levels and standards), each with { code, norm, parentCode ('' for top-level nodes), label (heading text for grouping levels, '' otherwise), wording (verbatim standard text, '' for pure grouping nodes), limits (attached in-document limits, [] if none), fluency, emphasis ('not designated' unless the document states designations) }. Do NOT nest — the tree is rebuilt from parentCode.
- setMeta: the document's own identity — { subject (e.g. "Mathematics"), grade (e.g. "Grade 4"), sourceOrganization (the publishing body as the document names it, e.g. "Common Core State Standards Initiative" or a state education agency), standardIdPrefix (the framework's official dot-delimited identifier prefix that precedes each canonical code to form the full standard identifier <prefix>.<code>, e.g. "CCSS.MATH.CONTENT" so 4.NBT.B.5 identifies as CCSS.MATH.CONTENT.4.NBT.B.5; when the framework publishes no such prefix, derive the conventional one from the framework acronym and subject, e.g. "TEKS.MATH" — NEVER leave it empty: every standard identifier must be expressible as <prefix>.<code>) }.
- coverageWarnings: ONLY contradictions or genuinely unreadable content inside THIS document — e.g. the document identifies as a different framework/grade than the set declares, or standards whose wording could not be captured. One sentence each, naming the specific standards affected. Do NOT flag partial coverage or absences (other documents cover their own subsets by design), boilerplate, formatting notes, or metadata quibbles. At most 3; [] when nothing rises to that bar.
- usageNotes: a one-paragraph description of how the document parsed (hierarchy detected, coding scheme, where limits live).`,
  }
}

export function ingestItemsPrompt(
  set: StandardSet,
  artifact: Artifact | undefined,
  pageStart: number,
  pageEnd: number,
): Prompt {
  return {
    system: ingestSystem('released-items extraction pipeline (Tier 2 — arbitrary released-item PDFs)'),
    user: `Extract every assessment item whose question BEGINS on PDF pages ${pageStart}–${pageEnd} (inclusive, 1-based) of the attached released-items PDF for the set "${set.name}" (${set.gradeSpan}). Items beginning outside that page window are handled by sibling calls — skip them entirely.

Tier-2 pipeline (spec §4.2): document triage → item segmentation → metadata extraction (state/test/year, item numbers, per-item alignment from item maps or inline annotations) → alignment resolution (official where the document supplies it; otherwise ai-proposed) → characterization (item type, response format, representations and problem types in consistent vocabulary terms, demand profile) → opportunistic capture (answer keys, rubrics) → completeness scoring.

Rules:
- page: the 1-based PDF page the item appears on. box: the item's bounding region on that page as PERCENTAGES of page width/height ({ x, y, w, h }, origin top-left) — cover the full question including its art and answer choices, nothing from neighboring items. These drive the screenshot crop; when you cannot localize an item confidently, set box to { x: 0, y: 0, w: 100, h: 100 } (full page) rather than guessing tightly.
- stem: a faithful TEXT STAND-IN for the item (search fallback when the screenshot fails); include choices for selected-response items.
- alignmentCode: exactly ONE code, NORMALIZED to the set's join scheme — never a state-prefixed variant (e.g. "NY-4.MD.3" → "4.MD.3", cluster letters merged per the set's normalization conventions). The item bank, P2 classification, and coverage all join on this code; record any differing exact state code inside demandProfile only if it matters. confidence "official" only when the document itself supplies the alignment, else "ai-proposed" (D14: usable in generation, flagged, queued for confirmation).
- Items the source aligns to MULTIPLE standards are assigned to the LATEST standard in the instructional sequence — the first point at which students would reasonably possess ALL prerequisite knowledge and skills the item requires. Never assign an item to an earlier standard when answering it depends on content taught later; name the governing (latest) standard as alignmentCode.
- scopeClass per P2 (content-based, never code-based) against the set's standards wording: in-boundary | rigor-signal-only (P1 contradiction) | adjacent-grade (officially aligned to another grade of the same set).
- completeness: 0–1 score per record.
- demandProfile: concrete difficulty parameters (number sizes, step counts, representation load, context complexity).

Set standards tree (for P2 classification):${jsonBlock('tree', set.tree)}
User usage notes for this artifact (declares source description, window, coverage): ${artifact?.usageNotes || '(none)'}

Output also:
- coverageWarnings: ONLY apparent contradictions between this document and the declared set — items aligned to codes that do not resolve in the set's scheme, to a different grade/course, or to a different framework variant. It is EXPECTED that items cover only a subset of the standards; absence of items for a standard or domain is NOT a warning (a later cross-document pass checks what nothing covers). One sentence each, naming the specific items/standards. At most 3; [] when nothing rises to that bar.
- usageNotes: a one-paragraph corpus description (source, window covered, census|sample|unknown declaration and why).`,
  }
}

export function ingestNotesPrompt(
  set: StandardSet,
  artifact: Artifact | undefined,
  role: 'unpacking' | 'progression',
): Prompt {
  const roleText =
    role === 'unpacking'
      ? `an unpacking document (spec §4.3). Type it at ingestion: structured decomposition (keyed statements partitioning standards into assessable components, with clarifications/limits, type designations, emphasis groupings) or narrative interpretation (prose, indexed for retrieval; genuine cognitive-demand tags admissible as rigor evidence — BrainLift-style DOK headings are organizational labels only, never rigor signals; documented misconceptions admissible per P9; subject to the P7 stance firewall).`
      : `a progression document (spec §4.4). Chunk by grade + heading anchored on inline standard codes. Three harvests: representation vocabulary; documented misconceptions (P9 evidence); worked problems as secondary rigor evidence when item evidence is thin — always cited as secondary, never scope-expanding. Stance firewall per P7: mine for sequencing, placement, prerequisites, boundaries, representation vocabulary, misconceptions, and worked problems — never for instructional stance.`
  return {
    system: ingestSystem(`${role} document indexer`),
    user: `Index the attached PDF for the set "${set.name}" (${set.gradeSpan}). It fills the role of ${roleText}

Existing usage notes from the uploader: ${artifact?.usageNotes || '(none)'}

Output:
- usageNotes: an enriched usage-notes paragraph for this artifact — what the document contains, which standards/domains/grades it covers, which harvests it supports (decomposition keys / demand bands / misconceptions / worked problems / representation vocabulary), and any P7 stance-firewall or DOK-labeling cautions. This text steers the stages that consume the artifact.
- coverageWarnings: ONLY apparent contradictions between this document and the declared set — it partitions/bounds/places standards in ways that conflict with what the set's declared framework and grade actually SAY. It is EXPECTED that this document covers only a subset of the standards (absences are NOT warnings — a later cross-document pass checks what nothing covers), and EXPECTED that it may use a state-prefixed or re-lettered coding scheme for the same framework (code differences resolve by normalization and are NOT warnings). One sentence each. At most 3; [] when nothing rises to that bar.`,
  }
}

export function ingestItemCountPrompt(set: StandardSet, artifact: Artifact | undefined): Prompt {
  return {
    system: ingestSystem('released-items counter'),
    user: `Count the assessment items in the attached released-items PDF for the set "${set.name}" (${set.gradeSpan}).

An item is one distinct numbered question/task presented to students. Count a multi-part item (parts A/B/C under one number) ONCE. Do not count instructions pages, answer keys, rubrics, or reference sheets as items.

User usage notes for this artifact: ${artifact?.usageNotes || '(none)'}

Output itemCount: the total number of items in this document.`,
  }
}

/**
 * Cross-document scope-conflict pass, run once after every upload has been
 * extracted. Consolidates the per-document candidate warnings and hunts for
 * conflicts BETWEEN the documents about scope. Every emitted warning carries
 * the AI's suggested default resolution, decided after weighing the issue.
 */
export function ingestConflictsPrompt(set: StandardSet, candidateWarnings: string[]): Prompt {
  const treeDigest = flattenTreeDigest(set.tree).slice(0, 400)
  const itemDigest = set.items.map((it) => `${it.test} ${it.year} Q${it.itemNumber} → ${it.alignmentCode} (${it.scopeClass})`)
  return {
    system: ingestSystem(
      'cross-document scope-conflict detector. You investigate each potential issue and determine the best way forward before suggesting it.',
    ),
    user: `All documents for the set "${set.name}" (${set.gradeSpan}) have been extracted. Find the conflicts BETWEEN the documents regarding scope, and consolidate the candidate coverage gaps below into a final, concise list.

${PRECEDENCE}

Flag EXACTLY two things and nothing else:

1. Contradictions among the documents (kind "conflict"):
- A state adjustment that materially ALTERS the canonical framework: a standard added, removed, re-worded, re-bounded, or moved across grades, or limits that differ — anywhere the documents leave two competing versions of what a standard says or covers. NOT the mere mixture of state-variant and canonical documents: that mixture is EXPECTED (states rename, re-letter, and lightly edit canonical frameworks), and finding where an edit changes scope is this check's purpose, not a defect to report in itself. NEVER flag coding-scheme differences alone (e.g. "NY-4.MD.3" for "4.MD.3") — codes resolve by normalization, not by a warning.
- Item alignments that reference standards the parsed tree does not contain, or a different grade/course of the same framework.
- Unpacking/progression documents that partition or bound standards in ways the standards document's own wording contradicts.
- Documents disagreeing about grade placement, included sub-parts, or in-document limits.

2. Gaps that NO document covers (kind "gap"): a standard or domain in the parsed tree that none of the uploaded documents — items, unpacking, or progressions — touches at all, when that leaves its handling genuinely unclear.

SUBSET COVERAGE IS NEVER A GAP. Every artifact is expected to cover only part of the standards — an items document with items for some standards, a progression covering some domains, an unpacking that partitions a subset: all normal, none flaggable. The standards document defines the universe; the other documents are subsets of it by design. Flag an absence only when it is absent from EVERY document. Never flag boilerplate, formatting, metadata, or anything the system already handles by inference or sub-part fallback.

For every warning, set suggestion to YOUR recommended default resolution — one or two sentences, concrete and executable, decided after weighing the evidence on both sides. BINDING RULE: when the issue is strict/canonical Common Core versus a state-adjusted variant of Common Core, the suggestion is ALWAYS to follow strict canonical Common Core (the canonical wording, codes, and limits govern; state adjustments are recorded as citable context only).

Candidate warnings from per-document extraction (dedupe, drop the unimportant, keep at most 6 total):${jsonBlock('candidates', candidateWarnings)}
Parsed standards tree (digest):${jsonBlock('tree', treeDigest)}
Extracted item alignments:${jsonBlock('items', itemDigest)}
Artifacts and their usage notes:${jsonBlock('artifacts', set.artifacts.map((a) => ({ role: a.role, file: a.fileName, notes: a.usageNotes })))}

Output warnings: [{ text, kind, suggestion }] — text is one sentence naming the specific documents/standards affected; ordered most consequential first; [] if the documents genuinely agree.`,
  }
}

function flattenTreeDigest(nodes: StandardSet['tree'], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.wording) out.push(`${n.norm}: ${n.wording.slice(0, 120)}`)
    if (n.children) flattenTreeDigest(n.children, out)
  }
  return out
}

// ---------------------------------------------------------------------------
// Lesson Scope Generation prompts (create course vs partial edit)
// ---------------------------------------------------------------------------

const lsgSystem = (role: string): string =>
  `You are Lesson Scope Generation (LSG) — ${role}. LSG owns the pedagogical plan for a course: it reads the current course state from a snapshot, builds the target lesson plan for the request, matches it against the existing lessons, and returns a course operation plus per-lesson operations. It never writes the database and never generates lesson content — downstream components consume its output.

${engineDocBlock()}

There is no uploaded evidence corpus on this request: work from your knowledge of the named curriculum framework's OFFICIAL published standards (codes and wording) for the stated subject and grade. Standard IDs must be genuine codes of that framework — never invented. Where you are uncertain of a code's exact form, use the framework's documented conventions and stay consistent.

${OUTPUT_DISCIPLINE}`

const MATCHING_RULES = `Matching rules (binding — Decision 4: the platform owns lesson identity):
- No existing course → courseOperation CREATE; every lesson operation CREATE with lessonId "".
- Existing course found → courseOperation UPDATE.
- A target lesson that matches an existing snapshot lesson (same teachable skill, judged by content — title, standard, and unit, not string equality) → echo that lesson's lessonId VERBATIM and set operation UPDATE.
- A target lesson with no match → operation CREATE with lessonId "".
- An existing IN-SCOPE lesson missing from the new plan → operation DEACTIVATE with its existing lessonId and a concrete deactivationReason.
- An existing lesson OUTSIDE the requested partial scope → omit from the output entirely (it stays untouched).`

export function lsgPlanPrompt(run: LsgRun): Prompt {
  const scopeText =
    run.generationScope.mode === 'FULL_COURSE'
      ? `FULL_COURSE: plan the complete course — every unit and lesson a student needs to master the framework's official content standards for this subject and grade, atomized and sequenced per the engine document. ALL existing lessons are in scope: any existing lesson that does not survive into the new plan must be DEACTIVATED per the matching rules.`
      : `LESSONS (partial edit): ONLY these existing lessons are in scope: ${run.generationScope.includedLessons.map((t) => `"${t}"`).join(', ')}. Plan the target state of exactly those lessons under the edit instruction — update them, split/replace them (CREATE the replacements + DEACTIVATE the originals), or deactivate them, as the instruction and the engine rules demand. Every other existing lesson is OUT of scope and must be omitted from the output.`

  return {
    system: lsgSystem('target-plan construction: decide the course operation and the per-lesson operations'),
    user: `Build the target lesson plan for the request below, then match it against the course snapshot.

${MATCHING_RULES}

Generation scope — ${scopeText}

Edit instruction from the requester: "${run.generationScope.editInstruction || '(none — plan from the framework and the engine rules alone)'}"

Rules:
- Lesson granularity, sequencing, and unit formation follow the engine document (atomize fully; preskills before composites; confusables separated; bridges after both parents).
- unitName groups lessons into coherent strand units (Title Case); lessonOrder is the global 1-based teaching order across the whole output; lessonTitle follows the engine's How Lessons Are Named rules (Title Case, shortest string that says what the lesson covers and what makes it unique).
- standardId: the single governing official standard code for the lesson's atom (the framework's canonical form, e.g. "3.NBT.A.1" or "3.2(A)").
- For UPDATE lessons, keep unitName/lessonOrder/lessonTitle aligned with the updated target state (they may change), but the lessonId is ALWAYS the snapshot's id, verbatim.
- deactivationReason: "" except on DEACTIVATE lessons, where it names the concrete reason (superseded by which lesson, out of scope since when, and why).
- targetCourse: courseName EXACTLY as requested (it is the course's primary key — never normalize or improve it); grade and subject from the request; standardSet a display label like "Texas (TEKS) — Grade 3".
- planDecisions: terse records of the consequential calls — the matching decisions (which snapshot lessons matched which targets and why), split/merge/deactivation reasoning, and any ambiguity in the edit instruction and how you resolved it.

${jsonBlock('request', { requestType: run.requestType, courseContext: run.courseContext, generationScope: run.generationScope })}
${jsonBlock('course_snapshot', run.snapshot ?? { courseExists: false, course: null, lessons: [] })}`,
  }
}

export function lsgFieldsPrompt(
  run: LsgRun,
  plan: WireLsgPlan,
  batch: { key: string; lesson: WireLsgPlanLesson }[],
): Prompt {
  const overview = plan.lessons.map((l) => ({
    unitName: l.unitName,
    lessonOrder: l.lessonOrder,
    lessonTitle: l.lessonTitle,
    standardId: l.standardId,
    operation: l.operation,
  }))
  // Existing field content is the baseline for UPDATE lessons — the edit
  // instruction modifies it; everything it does not touch carries over.
  const snapshotByLessonId = new Map((run.snapshot?.lessons ?? []).map((l) => [l.lessonId, l]))
  const currentState = batch
    .filter((b) => b.lesson.lessonId && snapshotByLessonId.has(b.lesson.lessonId))
    .map((b) => ({ key: b.key, current: snapshotByLessonId.get(b.lesson.lessonId) }))

  return {
    system: lsgSystem('lesson scope field generation for a batch of planned lessons'),
    user: `Write the ten lesson-scope fields for each of the ${batch.length} lesson(s) in batch_lessons (echo each lesson's key verbatim). The full plan overview is supplied so relational fields (prerequisites, progression placement, non-goals) can reference sibling lessons by title.

Field rules (each field is a plain string; every field filled — never empty):
- objectives: a concise numbered list of the observable mastery objectives ("Students are able to: …" behaviors); minimal-complete — together they fully define mastery, none is redundant.
- assessmentBoundary: explicit Included/Excluded lists with concrete parameters (number ranges, step counts, representation load).
- difficultyCeiling: the hardest legitimate case, stated with concrete parameters.
- prerequisites: one prerequisite per line, each tagged taught-in-course (naming the lesson) or prior-grade.
- progressionPlacement: cross-grade placement (where this skill comes from and goes) plus the within-course chain (the lessons immediately before and after in this skill's chain, by title).
- newLearning: the atom triple — "Start cue: … Decision path: … Response form: …".
- instructionalApproach: exactly ONE named strategy (begin with "Single strategy: <name>"), then the modeling scope — which concrete cases are explicitly modeled versus which go straight to independent practice. No gradual-release labels.
- nonGoals: forward-looking "do not teach yet" exclusions, each naming where the content is taught when known.
- assessmentEvidence: "Students are able to: [observable behavior] [task parameters] [conditions]" statements; no percentages or rates.
- releasedItems: what assessment of this atom looks like — reference genuine released items of the framework's assessment program when you know them by year/number, else describe 1–2 representative assessment tasks labeled "Generated exemplar — not a released item".

For UPDATE lessons, current_lesson_state carries the lesson's existing fields: apply the edit instruction to them — change exactly what it demands and carry everything else over (improved wording is fine; changed meaning is not).

Edit instruction from the requester: "${run.generationScope.editInstruction || '(none)'}"

${jsonBlock('request', { requestType: run.requestType, courseContext: run.courseContext, generationScope: run.generationScope })}
${jsonBlock('plan_overview', overview)}
${jsonBlock('batch_lessons', batch)}
${jsonBlock('current_lesson_state', currentState)}`,
  }
}

// ---------------------------------------------------------------------------
// Video Script Generator prompts
// ---------------------------------------------------------------------------

const vsgSystem = (): string =>
  `You are the Video Script Generator — you turn ONE generated lesson card into a production-ready script for a roughly three-minute Direct Instruction math video with checked student interactions: explicit model first (I Do), then guided participation through side-panel interactions (We Do). Independent practice is deliberately absent — the mastery quiz owns it. Controlling method authority: Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics (5th ed., 2017). Your job is fidelity plus translation to the delivery context (automated, self-paced, one student) — never invention of alternative pedagogy. Where any guidance conflicts with Stein's method, Stein prevails.

The playbook below is BINDING on every scripting decision — script channels, the video skeleton and timing, format translation, grade-band profiles, interaction design, language and tone, visual design, the per-lesson pipeline, and QA:
<video_playbook name="${VSG_PLAYBOOK_NAME}" version="${VSG_PLAYBOOK_VERSION}">
${VSG_PLAYBOOK_CONTENT}
</video_playbook>

${doctrineDocBlock()}

${OUTPUT_DISCIPLINE}`

/**
 * One generation call per lesson. `doctrine` carries the page-targeted Stein
 * retrieval (verbatim format scripts + chapter guidance); `resolutions` are
 * previously reconciled conflicts (playbook §2.4) that must be applied, not
 * re-flagged.
 */
export function vsgScriptPrompt(
  course: { courseName: string; subject: string; grade: string; standardSet: string },
  lesson: LsgCourseLesson,
  gradeBand: string,
  doctrine: VideoDoctrine | undefined,
  steering: string,
  resolutions: VsgConflict[],
): Prompt {
  const doctrineBlockText =
    doctrine && doctrine.formats.length > 0
      ? `Stein doctrine for this lesson's skill family — chapter "${doctrine.chapterTitle}".${
          doctrine.nearestOnly
            ? ' NO format title matched this lesson: the scripts below are the family\'s NEAREST formats, supplied for wording style and question cadence ONLY (playbook §5.4) — follow the lesson card\'s Instructional Approach for the strategy and modeled cases, and never borrow these formats\' content.'
            : ' The format script(s) below are the PRIMARY source: adapt the teacher wording nearly verbatim per the translation table (§5.1), keep the step order intact, and draw correction wording from the format\'s own correction scripts.'
        }
${doctrine.formats
  .map((f) => `<stein_format id="${f.id}" title="${f.title}" page="${f.page}">\n${f.text}\n</stein_format>`)
  .join('\n')}
<chapter_guidance chapter="${doctrine.chapterTitle}">
${doctrine.chapterExcerpt}
</chapter_guidance>`
      : doctrine
        ? `No teaching-format script is available for this lesson (chapter "${doctrine.chapterTitle}") — follow the lesson card's Instructional Approach for the strategy and modeled cases, the chapter guidance below for procedures and error patterns, and the playbook's design principles for wording and cadence (§11). formatRefs must be [] — never cite a format you were not given. Note the missing format in qa.flags.
<chapter_guidance chapter="${doctrine.chapterTitle}">
${doctrine.chapterExcerpt}
</chapter_guidance>`
        : `No doctrine chapter matched this lesson's skill family — follow the lesson card's Instructional Approach for the strategy and the playbook's design principles for wording, cadence, and corrections (§11). formatRefs must be []. Say so in qa.flags.`

  return {
    system: vsgSystem(),
    user: `Write the video script for the lesson below, following the playbook's per-lesson pipeline (§11) in order: assemble context → retrieve doctrine (supplied below) → plan examples → draft I Do from the format's Part A → build We Do from the format's Part B/C question sequence → write intro and wrap → language pass → visual pass → tag and time → self-QC (§12).

CONFLICT SCAN FIRST (playbook §2.4 — generation never silently resolves a contradiction): before writing anything, check the assembled inputs for conflicts — card-internal (approach vs. non-goals, objectives/evidence beyond the boundary or ceiling, prerequisites later in course order), card-vs-doctrine (the card's single strategy differs from the Stein format for this skill family — doctrine normally prevails but the card is evidence-locked: never auto-override, flag it), card-vs-playbook (modeled cases cannot fit 3:00, an interaction type beyond MVP is required, production exceeds the grade profile), and steering-vs-any (steering may tighten, never override). If ANY unresolved conflict exists: fill \`conflicts\` (each with both sides citing the exact fields and doctrine format/page, a proposed default resolution, and a one-line precedence rationale) and emit \`segments\`: [], \`gradeBand\` and \`durationEstimate\`: "" — do NOT write a script alongside conflicts. resolved_conflicts below are SETTLED: apply each resolution exactly and do not re-flag them; a user resolution may relax playbook defaults but never crosses the card's Assessment Boundary or Non-Goals and never introduces a second strategy. RECORDED HOUSE STYLES are likewise settled and never flagged — in particular the §8.1 division read-aloud order (expressions read as written, deviating from Stein's divisor-first reading).

Output rules (schema-shaped):
- segments: title → intro → i-do → we-do → wrap, in order, with "M:SS" start/end within the playbook's budgets (grade band "${gradeBand}"; total ≤ 3:00; title ≤ 10s). A dropped segment (e.g. second example cut by §4's decision rules) is justified in qa.flags.
- Every line carries exactly ONE channel (SAY | TEXT | VISUAL | INTERACTION | NOTE) per §3 — narration in complete spoken sentences; TEXT numerals and short labels only; VISUAL one-canvas choreography (animate only the delta, exact synchronization, highlights fade); NOTE for timing/freeze/asset directions, never teaching content.
- Every line carries time: the "M:SS" moment it lands, non-decreasing through the script. Simultaneity is expressed by adjacent lines sharing the same stamp (§3) — a TEXT value appears at the exact stamp its SAY line speaks it (§10). Segment start/end must agree with their lines' stamps. These stamps are the synchronization contract downstream audio/animation systems execute, and the ≤30-second interaction cadence is checked against them.
- INTERACTION lines: content is a one-line label "N of M · <type> · <what it checks>", and the segment's \`interactions\` array carries the full structured objects IN THE SAME ORDER as that segment's INTERACTION lines (the Nth object belongs to the Nth INTERACTION line). Each object: type per the §8.2 decision tree (numeric entry beats MCQ for computation), prompt naming exactly what is asked, options (MCQ only, letter IDs implied by position; distractors = documented misconceptions from the format/chapter's error patterns), accepted answer, correct-feedback line, try-1 pinpoint hint, try-2 show-the-step-and-move-on, exact resume state, and modelAccess (true with a note naming what replays, unless the check is lesson-independent — then false with the reason).
- 3–10 interactions total, scaled to length (§8.1 "When to interact" — where a residual "3–7" figure survives elsewhere in the playbook (§1's Hard Rules, §4's global limits, §8.4, §12's checklist), §8.1's 3–10 PREVAILS); never more than 30 seconds of running time without one; NONE during the title card; placement per the §8.1 skeleton (intro 0–1 preskill retrieval · 1 check after the full model, or 1 per chunk of a chunked model · 2–6 We Do micro-checks · 1–2 instant checks in the discrimination pass, which lives inside late We Do / the wrap per §5's Part C mapping · wrap 0–1 instant). The per-segment maxima never justify exceeding the 3–10 total.
- §8.1 "The Rules" is the operative interaction rulebook: choreograph every pause per its when-to-interact rules; type selection per "Choosing the type"; stems per "Writing the prompt"; options/answers per "Options and answers"; feedback ladders per "Feedback and corrections"; UI per "UI and continuity".
- Student-facing language (§8.1 "Student-facing language"): read expressions AS WRITTEN in symbol order ("2,352 divided by 42" — the recorded house style; inside algorithm steps the format's step wording still applies). Internal vocabulary NEVER reaches the student — no "start cue", "decision path", "atom", "I Do / We Do", "discrimination", "interaction", "boundary", "ceiling" in any SAY/TEXT line, prompt, or feedback: translate to student terms.
- The I Do models the card's New Learning triple exactly — state the start cue explicitly; one strategy only (the card's); identical step wording across examples.
- Example selection: I Do mid-difficulty unambiguous; We Do at or near the Difficulty Ceiling inside the Assessment Boundary; discrimination examples where the boundary allows; released items calibrate demand but are NEVER reproduced — write parallel problems at the same demand.
- formatRefs: one entry per Stein format actually followed, exactly "Format <id> — <TITLE> (p. <page>)" using the ids/pages supplied above ([] when none matched).
- qa: run the §12 checklist yourself. FIX every hard-fail before emitting — hardFails lists only violations you genuinely could not avoid (expected: []); flags carries review-level notes (dropped segments, timing near limits, doctrine gaps).
- gradeBand: "${gradeBand}". durationEstimate: total "M:SS" from the grade profile's words-per-minute.

${jsonBlock('course_context', { ...course, gradeBand })}
${jsonBlock('lesson_card', lesson)}
${doctrineBlockText}
${steering.trim().length > 0 ? `\nSteering instruction from the user (steers below doctrine, never overrides it): "${steering.trim()}"\n` : ''}
${jsonBlock('resolved_conflicts', resolutions)}`,
  }
}
