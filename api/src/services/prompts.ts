import {
  Artifact,
  ItemRecord,
  Lesson,
  PerformanceReport,
  Proposal,
  Scope,
  StandardNode,
  StandardSet,
  Unit,
} from '../domain/types'
import { doctrineExcerptsFor, DoctrineQuery } from './doctrine'
import { PlanLessonSkeleton, PlanOutput, PlanUnit } from './schemas'

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
- P1 (Evidence Primacy & Contradiction Rule): "Released items are the primary empirical evidence for inclusion, emphasis, and difficulty, and they govern freely — except that the standard's wording and its stated assessment boundaries trump released-item evidence if and only if a contradiction exists. … On contradiction: the standard wins. The item is reclassified out-of-boundary … its demand profile still calibrates rigor but it cannot expand scope, seed atoms, or earn coverage credit. Every such event is logged in the card's Decision record with both sides cited."
- P2 (Item Scope Classification, content-based never code-based): classes are in-boundary | contradiction/rigor-signal-only | adjacent-grade.
- P3 (Single Strategy, Algorithm First, Stein Controlling): "Don't give students multiple strategies — give them the single best one; representations and manipulatives come after direct instruction of the algorithm, framed as applications of it, never as parallel computation paths." An Instructional Approach naming two computation strategies fails QC automatically.
- P4: "Decomposition clarifications and interpretive limits supply the default parameter bounds … Observed in-boundary item evidence overrides these defaults in either direction. … Every override and every pin is logged in the Decision record."
- D1 (Assessment Alignment Constraint — engine, governing): released items constrain WHAT is taught and HOW HARD — never lesson structure. A content component whose substance or difficulty never appears in the released assessment evidence is excluded from instruction, and every component's difficulty caps at the highest observed tested difficulty; each exclusion and cap is logged as a scope decision. But item absence at the ATOM level is a documentation gap, not evidence: atoms and preskills that constitute the scoped standards stay in the scope at full quality regardless of direct item alignment — evidence status inferred, ceiling inferred from the closest observed evidence, reasoned in the Decision record, and assessed through generated assessment exemplars (§7.13).
- D2: below-grade items are prerequisite evidence + rigor calibration; above-grade items citable only in Non-Goals/Progression Placement; neither generates new-learning atoms.
- P7 (Interpretive Stance Firewall): interpretive documents are "mined for sequencing, placement, prerequisites, boundaries, representation vocabulary, documented misconceptions, and worked problems — never for instructional stance." Method preferences conflicting with doctrine: Stein prevails, conflict logged.
- P8 (Assessment Evidence Format): "Every card states mastery as observable behavior — 'Students are able to: …' — never 'students will understand.' … no accuracy percentages, no rates, no problem counts." Fluency triggers flag the requirement; the rate itself is the app's.
- P9/A3 (Editing Splits bar): "an error pattern justifies a split only when it reveals a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise it intensifies modeling inside the atom, or seeds a bridge where the confusion is between two atoms."`

const APPENDIX_A = `Compiled granularity procedure (spec Appendix A — run per component; all decisions emit DecisionEntries):
- A1 Decompose: candidate atoms from decomposition keys (fallback: standard sub-parts), informed by clarifications and the problem-type vocabulary on the item records.
- A2 Split Test (criteria verbatim): "new rule/strategy not previously taught · new vocabulary/concept label needing stabilization · new/hidden decision step changing the routine · unmastered representation/notation (first encounter of a normalized representation form) · high confusability with a look-alike skill · foundational preskill missing/weak · demand-band jump (some lessons split for rigor) · objective overload (more objectives than one lesson can explicitly model — every objective a lesson claims must be modeled in it) · documented error pattern (per P9)". Don't-split criteria: "same strategy steps · quantitative-only or context-only change · already-mastered representations · cumulative choose-among-mastered-routines goal."
- A3 Precedence & Tie-Breakers: "When split and don't-split criteria both genuinely fire, split criteria win." Tie-breakers in order: (1) new decision cues never before encountered → split; (2) can be rewritten with friendlier numbers/shorter text with the routine identical → don't split; (3) prerequisite gap that can't be refreshed quickly → split. The Editing Splits constraint caps error-pattern splits.
- A4 Bridges: "discrimination/selection/switching only, no new rules"; seeded also by integrative keys; placed after both parents independently mastered; confusables separated in time.
- A5 Modeling Scope: explicit modeling for new rules/misinterpretation risk, unmastered representations, high load/hidden steps, shaky preskills, look-alike confusion, fossilization-prone errors, demand jumps; extension for same-strategy/no-new-steps variation.
- A6 Validate: every atom satisfies the atom triple (start cue · single decision path · one response form).`

const SEQUENCING = `Sequencing & unit formation (spec Stage 4, doctrine-sourced ordering): "preskills before composites; easier before difficult; algorithm before required representations; confusables separated in time, bridges only after both parents independently mastered; within a concept cluster, the sacrificial first instance. Units are strand-coherent, traceable to the set's theme/emphasis statements or progression streams." Granularity and unit count are purely logic-driven; no calendar constraint.`

const CARD_RULES = `The fixed 14-field card (spec §7). EVERY field must be filled. Fields 4–14 carry AT LEAST ONE citation drawn from the supplied evidence (uncited fields are rejected before QC); fields 1, 2, and 3 carry NO citations (citations: []) — they state the authority and the mastery definition directly. Never cite the same source twice on one field.
1 standards — the official standard this atom is aligned to: its canonical ID in official capitalization (e.g. 6.RP.A.3b), followed by the official wording of that standard quoted VERBATIM from the standards document — never paraphrased. When the lesson teaches only part of the standard, also name the exact substandard/subpart taught (lettered sub-part or governing decomposition key). Show the canonical code ONCE; do NOT append the normalized/join code (e.g. "(6.rp.a.3b)") — it is an internal matching key and repeating the same code is redundant. Format: "<CODE> — <verbatim standard wording>". Nothing else. No citations on this field.
2 cluster — the cluster's official wording quoted VERBATIM from the standards document; its job is context; never paraphrase. No citations on this field.
3 objectives — a concise, exhaustive numbered list of the observable learning objectives that define mastery of this lesson atom; each objective describes ONE specific skill or behavior students must demonstrate. Objectives are specific enough to precisely define what students are expected to learn, but never constrain assessment format, context, representation, or response type unless that constraint is itself part of the learning objective. The list must satisfy the MINIMAL-COMPLETE test — Complete: together, the objectives fully describe everything required for mastery of the lesson; Minimal: removing any objective would leave part of the intended mastery unspecified, while adding another would introduce unnecessary detail or duplicate an existing one. Objectives describe what students must be able to DO — not how that ability is assessed or taught: assessment format, difficulty, representations, contexts, and instructional method belong to other fields. QC on this field: the objective set is the smallest complete set that guarantees mastery; every Assessment Evidence statement (field 12) must trace to at least one objective; every objective must be assessable; no objective may exist solely to constrain question format, instructional method, or representation unless that constraint is itself part of the lesson boundary. If the objectives exceed what one lesson can model, the granularity is wrong (A2 objective overload) — never absorb extra objectives into one card. No citations on this field.
4 emphasis — the designation under the set's emphasis source, "not designated where none exists — never guessed."
5 progression — two required layers: cross-grade (from interpretive documents) and within-course (the atoms immediately before and after in this skill's chain, by lesson reference).
6 prerequisites — each prerequisite tagged taught-in-course (lesson ref) or prior-grade.
7 boundary — Explicit Included/Excluded lists in consistent set vocabulary with concrete parameters; excluded content points to where it lives instead when known. Components running on inference set the inferred flag — the inference itself (what it rests on, what it extrapolates from) is reasoned in a boundary-tagged decision entry, never narrated in the content.
8 newLearning — REQUIRED FORMAT, the atom triple: "start cue (what the student sees that signals this routine) + single decision path/strategy (named) + one observable response form. One of each, written so a stranger could build the lesson from it." Two routines or two response forms fails QC automatically. Write it as "Start cue: … Decision path: … Response form: …".
9 approach — "Exactly one named strategy, selected per Stein (P3); then the modeling scope — which specific cases are explicitly modeled for the student versus which cases go straight to independent practice/extension." Name the actual cases (numbers, magnitudes, contexts, formats) on each side; do NOT use gradual-release labels — no "I Do", "We Do", or "You Do" in the field content. Begin new-learning approach fields with "Single strategy: <name>".
10 nonGoals — forward-looking "do not teach yet" exclusions with citations, each pointing to where the content will be taught when known.
11 ceiling — Concrete parameters — number sizes, step counts, representation load, context complexity — in consistent set vocabulary, naming the hardest legitimate case. The content states ONLY the ceiling itself. An inferred ceiling sets the inferred flag; what it extrapolates from, and every override of a decomposition default, is reasoned in a ceiling-tagged decision entry — never in the field content.
12 assessment — P8 format: "Students are able to: [observable behavior] [task parameters] [conditions]" — observable verbs only; every statement traces to at least one objective in field 3; fluency flag with trigger basis when applicable, or its absence stated with basis; no percentages, rates, or counts.
13 releasedItems — put the in-boundary item ids for this atom in itemRefs, ordered by closeness to ceiling; the field's content describes what is shown. Contradiction-class items never appear here (ceiling citations only, in field 11). When no in-boundary released item aligns directly to this atom — expected for many legitimate atoms, with foundational and introductory lessons explicitly NOT exempt — the field carries GENERATED ASSESSMENT EXEMPLARS instead: one to three items representing what the state assessment would look like if it assessed this atom. Each exemplar must match official released items in professionalism, cognitive demand, item construction quality, distractor quality, and language precision (describe any visual or representation precisely in the stem), while staying strictly within this lesson's assessment boundary — never exceeding the scoped content to resemble more advanced released items. Selected-response exemplars carry a full choice set whose distractors encode the atom's documented error patterns; constructed-response exemplars carry choices: []. Each is unmistakably labeled 'Generated exemplar — not a released item', its basis cited, the generation logged in the Decision record. The field is never empty. For such lessons: itemRefs is [], generatedExemplars is filled (1–3), and the releasedItems content must include the exact label text "Generated exemplar — not a released item".
14 decisions — numbered DecisionEntries, "terse, numbered, tagged with rule IDs (P#/A#), and cited", covering the required entry types: (1) granularity, (2) strategy selection with its Stein basis, (3) boundary & ceiling calls (overrides/pins logged), (4) contradictions & conflicts with both sides cited, (5) assumptions under thin evidence. "If a type had nothing to decide, say so in one clause rather than omitting silently."
CLEAN-FIELD SEPARATION (binding — OVERRIDES any per-field clause that could be read otherwise): fields 1–13 state the WHAT thoroughly and never the WHY — no reasoning, no "because", no weighing of alternatives, no derivation narrative ("overrides the default", "extrapolated from", "inferred from the absence of"), no rule ids (P#/D#/A#), no naming of the documents that drove a choice. All of that lives exclusively in the decision entries. No card field content uses gradual-release labels ("I Do", "We Do", "You Do") — the modeling scope is stated as which concrete cases are modeled for the student versus which go to independent practice. Each DecisionEntry carries "field": the card field key its reasoning governs (standards|cluster|objectives|emphasis|progression|prerequisites|boundary|newLearning|approach|nonGoals|ceiling|assessment|releasedItems), or "card" for lesson-level calls (granularity, lesson type, sequencing). The record renders directly under its field, so every consequential choice inside a field's content must have a decision entry tagged to that field; strategy selection is field "approach", boundary calls "boundary", ceiling calls "ceiling", exemplar-generation logging "releasedItems".
Example — WRONG ceiling content: "Hardest case: 7110 ÷ 90. The four-digit cap overrides the decomposition's five-digit default per D1; the remainderless cap is INFERRED — extrapolated from the absence of remainder demand across observed items." RIGHT ceiling content: "Hardest legitimate case: four-digit dividend divided by a two-digit divisor with an exact quotient (7110 ÷ 90 = 79); all quotients remainderless." — with a ceiling-tagged decision entry carrying the D1 override, the inference, and its citations.
Citations: { sourceType, label, locator, excerpt } — sourceType one of standards|items|decomposition|interpretive|engine|doctrine|admin-notes|sequence|performance-report; the excerpt quotes VERBATIM the exact sentence(s) of the supplied evidence that drove the decision — a reader hovering the citation sees only this excerpt, so it must stand alone as the driving evidence, never a paraphrase. Use sourceType "sequence" for within-course chain references.
Headings, unit titles, and lesson titles in Title Case. Every field written under faultless communication — it must read one way only.`

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
Doctrine consultation — Direct Instruction Mathematics (5th ed., Stein, Kinder, Silbert & Carnine), the controlling method authority. The chapter excerpts below are the PRIMARY source for field 9 (Instructional Approach): select the single best strategy, its preskills, and the modeling scope FROM these instructional procedures and teaching formats — name the strategy the way the book teaches it, follow its recommended sequence and example selection, and cite the chapter (sourceType "doctrine", label = the chapter title). Where the excerpts do not cover the specific case, fall back to the doctrine principles in the system prompt.
<doctrine_excerpts>
${excerpts}
</doctrine_excerpts>
`
}

// The engine's foundational POVs (Lesson Granularity & Modeling Scope, v2 for
// ANY standard set) — binding on every generation stage; nothing below may
// contradict them. Granular Track Mode is a user-elected engine PARAMETER, so
// its finer split calibration must be authorized HERE (inside the binding
// block) — a granular clause placed only below would be dead on arrival
// against "no rule below overrides them".
const engineCore = (granular: boolean): string => `The governing engine's POVs are BINDING — no rule below overrides them:
- Lesson Granularity (Split vs. Don't Split): splits are justified only when instruction requires a new strategy, decision, representation, prerequisite, or other meaningful change in student behavior — not simply because problems become harder or use different numbers or contexts. A demand-band jump IS such a change: some lessons split for rigor.${
  granular
    ? ' USER-ELECTED CALIBRATION for this scope (Granular Track Mode, authorized by the engine): the user selected the engine\'s finest granularity setting, under which a change in the form of the numbers/inputs, the representation, or the likely error pattern IS a meaningful change in student behavior and splits — the GRANULAR TRACK MODE block below states the full calibration and governs granularity for this scope.'
    : ''
}
- Modeling Scope (Teach vs. Practice): every objective a lesson claims must be explicitly modeled in that lesson. A lesson that accumulates more objectives than one lesson can model MUST split — objective overload is a split trigger, exactly like a new decision step.
- The Assessment Alignment Constraint: instructional scope is constrained to what is demonstrably assessed. A component of a standard whose content or difficulty never appears in the supplied released assessment evidence is excluded from instruction — even when that introduces a prerequisite gap — and instruction caps at the highest observed tested difficulty. This targets content the assessment never reaches; it is NOT a licence to drop preskill, introductory, or scaffolding atoms that build toward an assessed skill. Those atoms lack only a directly-aligned item — a documentation gap, per the validation-evidence rule below — and they stay in the scope at full quality.
- Released items are VALIDATION evidence, never the source of lesson granularity: lesson boundaries come solely from the engine's split/don't-split criteria. Never merge, split, or omit an atom because released assessments happen to assess skills together, or fail to assess that atom directly. Many legitimate atoms — foundational and introductory lessons especially — have no directly aligned released item; that is a documentation gap, expected and normal, and it must never reduce the quality or completeness of the scope. Such atoms get generated assessment exemplars at released-test quality instead.`

const systemCore = (role: string, granular = false): string =>
  `You are the ScopeGenerator pipeline engine — ${role}. You turn a standard set's evidence corpus into strand-coherent units of atomized lessons under Direct Instruction doctrine (Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics, 5th ed., 2017 — the controlling method authority) and the Lesson Granularity & Modeling Scope framework.

${engineCore(granular)}

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
 * Granular Track Mode — the user's toggle on the scope request
 * (scope.request.granular). Atomization drops to the most granular Direct
 * Instruction skill level, synthesis tracks recombine the skills afterward,
 * and prior-grade prerequisites are assumed mastered (never generated).
 */
const GRANULAR_TRACKS = `GRANULAR TRACK MODE is ON for this scope (user-selected). It OVERRIDES the default granularity calibration — the A1–A6 procedure still runs, with these BINDING modifications:
- Scope lessons at the most granular Direct Instruction skill level before anything is combined into broader skills: a track is small enough that the student is practicing ONE clearly defined rule, decision, or response pattern at a time.
- A skill becomes its OWN track when it changes ANY of: (1) the rule students apply; (2) the form of the numbers or inputs; (3) the representation used; (4) the likelihood of a distinct error pattern; (5) the prerequisite knowledge required; (6) the decision students must make before solving. In this mode a change in number/input form ALONE justifies a split — the default "quantitative-only or context-only change → don't split" criterion is SUSPENDED — as does a representation change or a distinct error-pattern risk.
- SYNTHESIS TRACKS: after the granular tracks of a skill cluster are taught and mastered, include tracks that put the skills back together. A synthesis track requires the student to DECIDE which previously learned procedure applies — never told in advance. Model synthesis tracks as type 'bridge' (selection/discrimination across the cluster's mastered routines, no new rules modeled), placed only after every parent track is independently mastered; close each cluster with a cumulative mixed-practice synthesis track (e.g. "Mixed Practice: Fraction Addition").
- GRADE BOUNDARY (MOST IMPORTANT): tracks cover ONLY grade-appropriate, standard-specific skills. Every prerequisite from earlier grades is ASSUMED MASTERED — generate NO prior-grade prerequisite or refresher tracks; record that content in field 6 (Prerequisites) tagged prior-grade instead. Grade-level first-instance tracks stay (the within-grade skill chain is fully enumerated); below-grade re-teaching does not exist in this mode.
- Calibration example — the expected granularity for a 4th-grade fraction-addition cluster (16 tracks): Generate Equivalent Fractions Using Multiplication · Decompose Fractions Into Sums of Fractions With the Same Denominator · Decompose Mixed Numbers Into Wholes and Fractions · Add Proper Fractions With Like Denominators · Add Fractions Greater Than 1 With Like Denominators · Add Like-Denominator Fractions and Rename Answers Greater Than 1 · Add Mixed Numbers With Like Denominators, No Regrouping · Add Mixed Numbers With Like Denominators, With Regrouping · Add Mixed Numbers With Like Denominators by Converting to Fractions Greater Than 1 · Add Tenths and Hundredths by Renaming Tenths as Hundredths · Add Tenths and Hundredths With Sums Less Than 1 · Add Tenths and Hundredths With Sums Greater Than 1 · Solve Like-Denominator Fraction Addition Word Problems · Solve Mixed-Number Addition Word Problems With Like Denominators · Solve Tenths-and-Hundredths Addition Word Problems · Mixed Practice: Fraction Addition.`

/** The granular block when the scope's toggle is on; '' otherwise (safe to interpolate). */
const granularBlock = (scope: Scope): string => (scope.request.granular ? `\n${GRANULAR_TRACKS}\n` : '')

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

export function planPrompt(
  set: StandardSet,
  scope: Scope,
  sourceSets: StandardSet[] = [],
  userUploadNames: string[] = [],
): Prompt {
  const requestDescription =
    scope.request.mode === 'course'
      ? `Whole-course scope: cover every published content standard of the set over the full grade span (${set.gradeSpan}), TOGETHER WITH the full skill chain each standard requires. The introductory, foundational, and scaffolding atoms (preskills, first-instance lessons, bridges) that build toward each skill are FIRST-CLASS lessons and are included even when no released item aligns to them — released items are validation evidence, not the inclusion filter. D1 still governs component-level exclusion (drop specific content/difficulty the released evidence never assesses anywhere; cap difficulty at the highest observed tested difficulty), but the ABSENCE of a directly-aligned item for an atom is NOT such an exclusion — that is a documentation gap, and the atoms and preskills constituting the scoped standards stay at full quality with generated exemplars. Item presence gates how hard a lesson goes, never whether the atoms that build the assessed skills appear in the course.`
      : scope.request.mode === 'standard'
        ? `Standard scope: exactly the selected standard(s) "${scope.request.params}" and their skill chains (preskills, bridges, application tiers directly serving them). When several standards are selected, produce ONE coherent scope — a single sequenced set of units covering all of them together, ordered per the sequencing rules across the whole selection, never one disconnected mini-scope per standard.`
        : `Topic scope: the request "${scope.request.params}" — map it onto the set's hierarchy and include exactly the standards that constitute that topic.`

  return {
    system: systemCore(
      'Stages 2–4: scope resolution, atomization, and sequencing & unit formation',
      !!scope.request.granular,
    ),
    user: `Run Stages 2–4 for the scope request below.

Stage 2 — Scope Resolution: resolve the request to standards + governing decomposition keys (or the sub-part fallback), classify every supplied item per P2 against the governing standard's wording (contradiction detection per P1), and build the component evidence map. Apply D1 here for DIFFICULTY only: cap every component's difficulty at the highest observed tested difficulty and exclude specific harder content/difficulty the released evidence never assesses — log each cap and exclusion in scopeDecisions with its basis. Item absence NEVER drives structure and NEVER removes an atom: granularity comes solely from the A1–A6 procedure, and every atom or preskill that constitutes the scoped standards stays in the plan at full quality even when no released item aligns to it directly. You MUST enumerate the introductory, foundational, and scaffolding atoms (the first-instance lessons that introduce each new routine, the preskill lessons that build toward it, and the bridges between confusables) as their own lesson skeletons — these are the atoms most likely to lack a directly-aligned item, and they are exactly the ones that must not be dropped. Mark them evidenceStatus inferred; the cards fill the gap with generated assessment exemplars written at released-test quality. A plan that contains only item-backed atoms is a defect.

Stage 3 — Atomization:
${APPENDIX_A}
${granularBlock(scope)}
Stage 4 — Sequencing & Unit Formation:
${SEQUENCING}

${requestDescription}
${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${jsonBlock('scope_request', scope.request)}
${standardsEvidenceBlocks(set, sourceSets)}
${jsonBlock('item_bank', set.items)}

Output: ordered units with lesson skeletons.
- Unit ids "U1", "U2", … in teaching order; lesson ids "<unitId>.L1", "<unitId>.L2", … in teaching order.
- Each unit: id, title (Title Case), rationale (traceable to theme/emphasis statements or progression streams, strand-coherent), strand, lessons.
- Each lesson skeleton: id, title (Title Case), type (new-learning | bridge | application-tier), evidenceStatus (observed | inferred | mixed), standardCodes (canonical and/or normalized codes this lesson serves), itemRefs (ids of in-boundary items from the item bank that attach to this atom — never contradiction-class or adjacent-grade items), planningNotes (the atomization reasoning to hand to card generation: which split criteria fired, single strategy expectation, ceiling inputs, contradiction events, inference basis when evidenceStatus is inferred).
- Released-item coverage is MANDATORY but is NOT the inclusion filter: every in-boundary item in the item bank whose standard is in scope must be attached to exactly one lesson skeleton's itemRefs — the released test is the model for our assessments, and an unattached in-boundary item is a planning defect. Rigor-signal-only and adjacent-grade items are never attached. Coverage runs one way only: items must find a lesson, but lessons need NOT have items — the introductory and scaffolding lessons with itemRefs [] are expected and required, not omissions to be pruned.
- scopeDecisions: terse records of scope-level calls (P1 contradictions, P2 classifications, D1 inferences, partition used), each tagged with its rule id (P#/A#/D#).`,
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
    system: systemCore('Stage 5: card generation for one unit', !!scope.request.granular),
    user: `Generate complete 14-field lesson cards for the ${batch.length} lesson(s) of unit "${unit.id} — ${unit.title}" listed in batch_lessons, following the approved plan skeleton exactly (same lesson ids, same order, same types). Output ONLY the batch_lessons lessons — the unit's remaining lessons are produced by sibling calls; the full unit_skeleton is supplied so relational fields (Prerequisites, Progression Placement, Assessment Boundary, Non-Goals) can reference them by lesson id.

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: batch.map((l) => l.title), standardCodes: batch.flatMap((l) => l.standardCodes) })}${granularBlock(scope)}${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
Additional requirements:
- evidence-locking is mandatory: generation returns { content, citations[] } per field; uncited fields 4–14 are rejected pre-QC (spec §6 Stage 5); fields 1–3 return citations: [].
- decision entries must carry rule ids (P#/A#/D#) and quote both sides on every contradiction.
- for lessons whose skeleton has no in-boundary itemRefs (evidenceStatus inferred), produce 1–3 generated assessment exemplars per D1/§7.13 at released-test quality — distractor-quality choice sets for selected-response formats, strictly inside the lesson's assessment boundary — and label each exactly "Generated exemplar — not a released item" in the releasedItems content. Foundational and introductory lessons are not exempt.
- bridge and application-tier lessons use §7.14 semantics: bridge newLearning = the selection/discrimination behavior, approach = mixed look-alike practice with no new rules modeled; application-tier newLearning = executing the mastered routine in the new demand band, boundary/ceiling inherited from the parent atom plus the triggering demand statement's scope.
- itemRefs may only contain ids present in the supplied item bank.

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
    system: systemCore('rerun: regenerate one lesson card in place (Stage 5 re-entry)', !!scope.request.granular),
    user: `Regenerate the lesson card "${lesson.id} — ${lesson.title}" in place at the same granularity (spec §6 rerun re-entry: "regenerate-in-place → Stage 5 for that card"). Keep the lesson id, type, and position in the chain; produce a fresh 14-field card cited per the card rules (fields 4–14 cited; fields 1–3 citations: []).

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: [lesson.title], standardCodes: codes })}${granularBlock(scope)}${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${jsonBlock('scope_request', scope.request)}
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
    system: systemCore('rerun: re-atomize one unit at different granularity (Stages 3–6 re-entry, scoped)', !!scope.request.granular),
    user: `Rerun unit "${unit.id} — ${unit.title}" at ${mode === 'split' ? 'MORE granularity (split)' : 'LESS granularity (merge)'} around the target "${target}" (spec §6: "lesson granularity change → Stage 3 scoped to affected atoms, then 4–6 locally").${mode === 'split' ? ' A split still requires an A2 criterion to genuinely fire around the target (new strategy/decision/representation/prerequisite, demand-band jump, or objective overload — never merely harder numbers). If none fires, keep the granularity unchanged and record the refusal with its basis in the affected Decision records.' : ''}

${APPENDIX_A}
${granularBlock(scope)}${unionBlock(sourceSets)}${userUploadsBlock(userUploadNames)}
${BLAST_RADIUS}

${override ? `An explicit user override of a protected hard-split boundary is in force for this merge: execute the merge, and log the override in the affected lessons' Decision records (type "override", both sides cited, rule id of the overridden criterion).` : ''}

Rules:
- Return the unit's complete new lesson list in teaching order, with full 14-field cards for every lesson, renumbering ids as "${unit.id}.L1", "${unit.id}.L2", … .
- Adjacent lessons: regenerate their relational fields and note the change in their Decision records; content fields untouched unless the split/merge itself demands it.
- Fields 4–14 cited (fields 1–3 carry citations: []); decision entries carry rule ids (P#/A#).

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: unit.lessons.map((l) => l.title), standardCodes: codes })}

${jsonBlock('scope_request', scope.request)}
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
- Return in lessons ONLY the lessons that change (full 14-field cards, unchanged fields carried over verbatim); lessons you omit stay as they are. Apply only the changes whose targets fall inside this unit — changes targeting other units are handled by sibling calls.
- Every rewritten field 4–14 keeps ≥1 citation (fields 1–3 stay citations: []); the PerformanceReport is citable as sourceType "performance-report".

${CARD_RULES}
${doctrineBlock({ unitTitle: unit.title, strand: unit.strand, lessonTitles: unit.lessons.map((l) => l.title), standardCodes: [] })}

${jsonBlock('accepted_proposal', proposal)}
${jsonBlock('targeted_unit', unit)}
${jsonBlock('item_bank_subset', itemsForCodes(set, [], unit.lessons.flatMap((l) => l.itemRefs)))}`,
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

Limit capture (spec §4.1): capture "all in-document limits: footnotes, parenthetical constraints, 'including/excluding' clauses, stated assessment boundaries" and attach each to the level it belongs to — dropping them silently corrupts the boundary authority. Flag fluency language per P8. Capture grade/course-level emphasis or theme statements as labels on grouping nodes where present.

Dual coding: emit a canonical ID per the set's official scheme AND a normalized join code per the set's normalization conventions (declared coding scheme: ${set.codingScheme || 'detect from the document'}). Both keep CAPITAL letters ("4.OA.A.1", never "4.oa.a.1") — normalization merges structural differences, it never lowercases.

User usage notes for this artifact (precedence level 5 — steering below the boundary): ${artifact?.usageNotes || '(none)'}

Output:
- nodes: a FLAT array of every hierarchy node (grouping levels and standards), each with { code, norm, parentCode ('' for top-level nodes), label (heading text for grouping levels, '' otherwise), wording (verbatim standard text, '' for pure grouping nodes), limits (attached in-document limits, [] if none), fluency, emphasis ('not designated' unless the document states designations) }. Do NOT nest — the tree is rebuilt from parentCode.
- setMeta: the document's own identity — { subject (e.g. "Mathematics"), grade (e.g. "Grade 4"), sourceOrganization (the publishing body as the document names it, e.g. "Common Core State Standards Initiative" or a state education agency) }.
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
      ? `an unpacking document (spec §4.3). Type it at ingestion: structured decomposition (keyed statements partitioning standards into assessable components, with clarifications/limits, type designations, emphasis groupings) or narrative interpretation (prose, indexed for retrieval; genuine cognitive-demand tags admissible per P6; documented misconceptions admissible per P9; subject to the P7 stance firewall).`
      : `a progression document (spec §4.4). Chunk by grade + heading anchored on inline standard codes. Three harvests: representation vocabulary; documented misconceptions (P9 evidence); worked problems as secondary rigor evidence when item evidence is thin — always cited as secondary, never scope-expanding. Stance firewall per P7: mine for sequencing, placement, prerequisites, boundaries, representation vocabulary, misconceptions, and worked problems — never for instructional stance.`
  return {
    system: ingestSystem(`${role} document indexer`),
    user: `Index the attached PDF for the set "${set.name}" (${set.gradeSpan}). It fills the role of ${roleText}

Existing usage notes from the uploader: ${artifact?.usageNotes || '(none)'}

Output:
- usageNotes: an enriched usage-notes paragraph for this artifact — what the document contains, which standards/domains/grades it covers, which harvests it supports (decomposition keys / demand bands / misconceptions / worked problems / representation vocabulary), and any P6/P7 firewall cautions. This text steers the stages that consume the artifact.
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
