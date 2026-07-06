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
import { PlanOutput, PlanUnit } from './schemas'

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
- D1 (Absence Policy): components without item evidence stay in scope; anticipated-evidence inference constructs the plausible ceiling, "flagged inferred on the card and fully reasoned in the Decision record", culminating in a generated ceiling exemplar (§7.12).
- D2: below-grade items are prerequisite evidence + rigor calibration; above-grade items citable only in Non-Goals/Progression Placement; neither generates new-learning atoms.
- P7 (Interpretive Stance Firewall): interpretive documents are "mined for sequencing, placement, prerequisites, boundaries, representation vocabulary, documented misconceptions, and worked problems — never for instructional stance." Method preferences conflicting with doctrine: Stein prevails, conflict logged.
- P8 (Assessment Evidence Format): "Every card states mastery as observable behavior — 'Students are able to: …' — never 'students will understand.' … no accuracy percentages, no rates, no problem counts." Fluency triggers flag the requirement; the rate itself is the app's.
- P9/A3 (Editing Splits bar): "an error pattern justifies a split only when it reveals a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise it intensifies modeling inside the atom, or seeds a bridge where the confusion is between two atoms."`

const APPENDIX_A = `Compiled granularity procedure (spec Appendix A — run per component; all decisions emit DecisionEntries):
- A1 Decompose: candidate atoms from decomposition keys (fallback: standard sub-parts), informed by clarifications, the set glossary, and the problem-type vocabulary on the item records.
- A2 Split Test (criteria verbatim): "new rule/strategy not previously taught · new vocabulary/concept label needing stabilization · new/hidden decision step changing the routine · unmastered representation/notation (first encounter of a normalized lexicon form) · high confusability with a look-alike skill · foundational preskill missing/weak · demand-band jump · documented error pattern (per P9)". Don't-split criteria: "same strategy steps · quantitative-only or context-only change · already-mastered representations · cumulative choose-among-mastered-routines goal."
- A3 Precedence & Tie-Breakers: "When split and don't-split criteria both genuinely fire, split criteria win." Tie-breakers in order: (1) new decision cues never before encountered → split; (2) can be rewritten with friendlier numbers/shorter text with the routine identical → don't split; (3) prerequisite gap that can't be refreshed quickly → split. The Editing Splits constraint caps error-pattern splits.
- A4 Bridges: "discrimination/selection/switching only, no new rules"; seeded also by integrative keys; placed after both parents independently mastered; confusables separated in time.
- A5 Modeling Scope: explicit modeling for new rules/misinterpretation risk, unmastered representations, high load/hidden steps, shaky preskills, look-alike confusion, fossilization-prone errors, demand jumps; extension for same-strategy/no-new-steps variation.
- A6 Validate: every atom satisfies the atom triple (start cue · single decision path · one response form).`

const SEQUENCING = `Sequencing & unit formation (spec Stage 4, doctrine-sourced ordering): "preskills before composites; easier before difficult; algorithm before required representations; confusables separated in time, bridges only after both parents independently mastered; within a concept cluster, the sacrificial first instance. Units are strand-coherent, traceable to the set's theme/emphasis statements or progression streams." Granularity and unit count are purely logic-driven; no calendar constraint.`

const CARD_RULES = `The fixed 13-field card (spec §7). EVERY field must be filled and EVERY field carries AT LEAST ONE citation drawn from the supplied evidence (uncited fields are rejected before QC):
1 standards — canonical ID(s) + normalized code(s) plus every governing decomposition key for this atom (or the sub-part partition used).
2 cluster — the standard's immediate parent grouping heading text verbatim; its job is context; no paraphrase.
3 emphasis — the designation under the set's emphasis source, "not designated where none exists — never guessed."
4 progression — two required layers: cross-grade (from interpretive documents) and within-course (the atoms immediately before and after in this skill's chain, by lesson reference).
5 prerequisites — each prerequisite tagged taught-in-course (lesson ref) or prior-grade.
6 boundary — "Explicit Included/Excluded lists in lexicon vocabulary with concrete parameters; excluded content points to where it lives instead when known; components running on inference marked inferred."
7 newLearning — REQUIRED FORMAT, the atom triple: "start cue (what the student sees that signals this routine) + single decision path/strategy (named) + one observable response form. One of each, written so a stranger could build the lesson from it." Two routines or two response forms fails QC automatically. Write it as "Start cue: … Decision path: … Response form: …".
8 approach — "Exactly one named strategy, selected per Stein (P3); then the modeling scope — cases explicitly modeled (the I Do → We Do set …) versus cases going straight to practice/extension." Begin new-learning approach fields with "Single strategy: <name>".
9 nonGoals — forward-looking "do not teach yet" exclusions with citations, each pointing to where the content will be taught when known.
10 ceiling — "Concrete parameters — number sizes, step counts, representation load, context complexity — in lexicon vocabulary, naming the hardest legitimate case. Inferred ceilings marked, with what they extrapolate from."
11 assessment — P8 format: "Students are able to: [observable behavior] [task parameters] [conditions]" — observable verbs only; fluency flag with trigger basis when applicable, or its absence stated with basis; no percentages, rates, or counts.
12 releasedItems — put the in-boundary item ids for this atom in itemRefs, ordered by closeness to ceiling; the field's content describes what is shown. "Contradiction-class items never appear here (ceiling citations only, in field 10). When no in-boundary item exists, the field carries a generated ceiling exemplar instead: one problem written at the rigor the corpus's assessments would demand, at the inferred ceiling, never exceeding the standard's boundary, unmistakably labeled 'Generated exemplar — not a released item', with its inference basis cited and the generation logged in the Decision record. The field is never empty." For such lessons: itemRefs is [], generatedExemplar is filled, and the releasedItems content must include the exact label text "Generated exemplar — not a released item".
13 decisions — numbered DecisionEntries, "terse, numbered, tagged with rule IDs (P#/A#), and cited", covering the required entry types: (1) granularity, (2) strategy selection with its Stein basis, (3) boundary & ceiling calls (overrides/pins logged), (4) contradictions & conflicts with both sides cited, (5) assumptions under thin evidence. "If a type had nothing to decide, say so in one clause rather than omitting silently."
Citations: { sourceType, label, locator, excerpt } — sourceType one of standards|items|decomposition|interpretive|engine|doctrine|admin-notes|sequence|performance-report; the excerpt quotes the actual evidence supplied. Use sourceType "sequence" for within-course chain references.
Headings, unit titles, and lesson titles in Title Case. Every field written under faultless communication — it must read one way only.`

const BLAST_RADIUS = `Blast radius (spec §8): "When a lesson splits or merges, the relational fields of adjacent and dependent lessons — Prerequisites, Lesson Boundary, Non-Goals, within-course Progression Placement — auto-regenerate, with the change noted in their Decision records; content fields untouched. Locked lessons are never silently mutated: relational updates queue as suggestions requiring approval."`

const EDITING_SPLITS = `Data-informed revision mapping (spec §8): "The tool maps the report onto framework actions using the engine's Editing Splits logic: splits where the reported errors reveal a new/unstable start cue, a new decision step, or a missing prerequisite; modeling intensification inside the atom where they don't; bridge insertion where the confusion runs between two atoms; ceiling or boundary adjustments where the report shows mis-set difficulty." Guardrails apply inside proposals: a change that collapses a boundary protected by a hard split criterion must carry a guardrail note citing the criterion instead of being silently proposed.`

const OUTPUT_DISCIPLINE = `Respond with a single JSON object matching the required schema exactly. No prose outside the JSON, no markdown fences.`

const systemCore = (role: string): string =>
  `You are the ScopeGenerator pipeline engine — ${role}. You turn a standard set's evidence corpus into strand-coherent units of atomized lessons under Direct Instruction doctrine (Stein, Kinder, Silbert & Carnine, Direct Instruction Mathematics, 5th ed., 2017 — the controlling method authority) and the Lesson Granularity & Modeling Scope framework.

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
    lexicon: set.lexicon,
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

// ---------------------------------------------------------------------------
// Stage prompts
// ---------------------------------------------------------------------------

export function planPrompt(set: StandardSet, scope: Scope): Prompt {
  const requestDescription =
    scope.request.mode === 'course'
      ? `Whole-course scope: cover every published content standard of the set that has evidence, over the full grade span (${set.gradeSpan}).`
      : scope.request.mode === 'standard'
        ? `Single-standard scope: only the standard "${scope.request.params}" and its skill chain (preskills, bridges, application tiers directly serving it).`
        : `Topic scope: the request "${scope.request.params}" — map it onto the set's hierarchy and include exactly the standards that constitute that topic.`

  return {
    system: systemCore(
      'Stages 2–4: scope resolution, atomization, and sequencing & unit formation',
    ),
    user: `Run Stages 2–4 for the scope request below.

Stage 2 — Scope Resolution: resolve the request to standards + governing decomposition keys (or the sub-part fallback), classify every supplied item per P2 against the governing standard's wording (contradiction detection per P1), and build the component evidence map (evidence status observed | inferred per component).

Stage 3 — Atomization:
${APPENDIX_A}

Stage 4 — Sequencing & Unit Formation:
${SEQUENCING}

${requestDescription}
${jsonBlock('scope_request', scope.request)}
${jsonBlock('standard_set_evidence', setEvidence(set))}
${jsonBlock('item_bank', set.items)}

Output: ordered units with lesson skeletons.
- Unit ids "U1", "U2", … in teaching order; lesson ids "<unitId>.L1", "<unitId>.L2", … in teaching order.
- Each unit: id, title (Title Case), rationale (traceable to theme/emphasis statements or progression streams, strand-coherent), strand, lessons.
- Each lesson skeleton: id, title (Title Case), type (new-learning | bridge | application-tier), evidenceStatus (observed | inferred | mixed), standardCodes (canonical and/or normalized codes this lesson serves), itemRefs (ids of in-boundary items from the item bank that attach to this atom — never contradiction-class or adjacent-grade items), planningNotes (the atomization reasoning to hand to card generation: which split criteria fired, single strategy expectation, ceiling inputs, contradiction events, inference basis when evidenceStatus is inferred).
- scopeDecisions: terse records of scope-level calls (P1 contradictions, P2 classifications, D1 inferences, partition used), each tagged with its rule id (P#/A#/D#).`,
  }
}

export function cardsPrompt(
  set: StandardSet,
  scope: Scope,
  plan: PlanOutput,
  unit: PlanUnit,
): Prompt {
  const codes = unit.lessons.flatMap((l) => l.standardCodes)
  const refs = unit.lessons.flatMap((l) => l.itemRefs)
  const evidenceItems = itemsForCodes(set, codes, refs)
  const planOverview = plan.units.map((u) => ({
    id: u.id,
    title: u.title,
    strand: u.strand,
    lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type })),
  }))

  return {
    system: systemCore('Stage 5: card generation for one unit'),
    user: `Generate the full unit "${unit.id} — ${unit.title}" with complete 13-field lesson cards, following the approved plan skeleton exactly (same lesson ids, same order, same types).

${CARD_RULES}

Additional requirements:
- evidence-locking is mandatory: generation returns { content, citations[] } per field; uncited fields are rejected pre-QC (spec §6 Stage 5).
- decision entries must carry rule ids (P#/A#/D#) and quote both sides on every contradiction.
- for lessons whose skeleton has no in-boundary itemRefs (evidenceStatus inferred), produce the generated ceiling exemplar per D1/§7.12 and label it exactly "Generated exemplar — not a released item" in the releasedItems content.
- bridge and application-tier lessons use §7.14 semantics: bridge newLearning = the selection/discrimination behavior, approach = mixed look-alike practice with no new rules modeled; application-tier newLearning = executing the mastered routine in the new demand band, boundary/ceiling inherited from the parent atom plus the triggering demand statement's scope.
- itemRefs may only contain ids present in the supplied item bank.

${jsonBlock('scope_request', scope.request)}
${jsonBlock('plan_overview', planOverview)}
${jsonBlock('unit_skeleton', unit)}
${jsonBlock('scope_decisions_from_plan', plan.scopeDecisions)}
${jsonBlock('standard_set_evidence', setEvidence(set))}
${jsonBlock('item_bank_subset', evidenceItems)}`,
  }
}

export function rerunLessonPrompt(
  set: StandardSet,
  scope: Scope,
  unit: Unit,
  lesson: Lesson,
): Prompt {
  const codes = lesson.fields.standards.content.match(/[0-9]+\.[A-Za-z]+(?:\.[A-Za-z0-9]+)*/g) ?? []
  const evidenceItems = itemsForCodes(set, codes, lesson.itemRefs)
  return {
    system: systemCore('rerun: regenerate one lesson card in place (Stage 5 re-entry)'),
    user: `Regenerate the lesson card "${lesson.id} — ${lesson.title}" in place at the same granularity (spec §6 rerun re-entry: "regenerate-in-place → Stage 5 for that card"). Keep the lesson id, type, and position in the chain; produce a fresh, fully cited 13-field card.

${CARD_RULES}

${jsonBlock('scope_request', scope.request)}
${jsonBlock('containing_unit', { id: unit.id, title: unit.title, strand: unit.strand, lessons: unit.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type, locked: l.locked })) })}
${jsonBlock('current_lesson_card', lesson)}
${jsonBlock('standard_set_evidence', setEvidence(set))}
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
): Prompt {
  const codes = unit.lessons.flatMap(
    (l) => l.fields.standards.content.match(/[0-9]+\.[A-Za-z]+(?:\.[A-Za-z0-9]+)*/g) ?? [],
  )
  const evidenceItems = itemsForCodes(
    set,
    codes,
    unit.lessons.flatMap((l) => l.itemRefs),
  )
  const lockedIds = unit.lessons.filter((l) => l.locked).map((l) => l.id)
  return {
    system: systemCore('rerun: re-atomize one unit at different granularity (Stages 3–6 re-entry, scoped)'),
    user: `Rerun unit "${unit.id} — ${unit.title}" at ${mode === 'split' ? 'MORE granularity (split)' : 'LESS granularity (merge)'} around the target "${target}" (spec §6: "lesson granularity change → Stage 3 scoped to affected atoms, then 4–6 locally").

${APPENDIX_A}

${BLAST_RADIUS}

${override ? `An explicit user override of a protected hard-split boundary is in force for this merge: execute the merge, and log the override in the affected lessons' Decision records (type "override", both sides cited, rule id of the overridden criterion).` : ''}

Rules:
- Return the unit's complete new lesson list in teaching order, with full 13-field cards for every lesson, renumbering ids as "${unit.id}.L1", "${unit.id}.L2", … .
- LOCKED lessons ${lockedIds.length > 0 ? `(${lockedIds.join(', ')})` : '(none in this unit)'} must be echoed back byte-for-byte UNCHANGED (same id, same content). For each locked lesson whose relational fields (Prerequisites, Lesson Boundary, Non-Goals, within-course Progression Placement) would need to change, add an entry to lockedSuggestions describing the queued relational update instead of mutating the lesson.
- Adjacent unlocked lessons: regenerate their relational fields and note the change in their Decision records; content fields untouched unless the split/merge itself demands it.
- Every field cited; decision entries carry rule ids (P#/A#).

${CARD_RULES}

${jsonBlock('scope_request', scope.request)}
${jsonBlock('current_unit', unit)}
${jsonBlock('standard_set_evidence', setEvidence(set))}
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
- ripple: one entry per affected adjacent/dependent lesson group describing the relational-field regeneration on acceptance, noting that locked lessons receive queued suggestions requiring approval.

${jsonBlock('performance_report', report)}
${jsonBlock('protected_boundaries', scope.protectedBoundaries ?? [])}
${jsonBlock('targeted_unit', unit ?? scope.units)}
${jsonBlock('scope_summary', { title: scope.title, request: scope.request, version: scope.version, units: scope.units.map((u) => ({ id: u.id, title: u.title, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, type: l.type, locked: l.locked })) })) })}
${jsonBlock('set_lexicon', set.lexicon)}`,
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
${jsonBlock('scope_summary', { title: scope.title, version: scope.version, units: scope.units.map((u) => ({ id: u.id, title: u.title, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, locked: l.locked })) })) })}`,
  }
}

export function applyPrompt(
  scope: Scope,
  set: StandardSet,
  unit: Unit,
  proposal: Proposal,
): Prompt {
  const lockedIds = unit.lessons.filter((l) => l.locked).map((l) => l.id)
  return {
    system: systemCore('data-informed revision: apply an accepted proposal (Stage 5 re-entry, scoped to the change set)'),
    user: `The proposal below was ACCEPTED. Rewrite the targeted lesson fields per the accepted change set, and regenerate the relational fields (Prerequisites, Lesson Boundary, Non-Goals, within-course Progression Placement) of adjacent/dependent lessons in the unit, noting each change in the lesson's Decision record with a citation of sourceType "performance-report".

${BLAST_RADIUS}

Rules:
- Return in lessons ONLY the lessons that change (full 13-field cards, unchanged fields carried over verbatim); lessons you omit stay as they are.
- LOCKED lessons ${lockedIds.length > 0 ? `(${lockedIds.join(', ')})` : '(none in this unit)'} must NOT appear in lessons; put their queued relational updates in lockedSuggestions instead ("acceptance is the approval the lock requires" applies to lessons named as proposal targets — a locked lesson explicitly targeted by an accepted change MAY be rewritten and returned in lessons).
- Every rewritten field keeps ≥1 citation; the PerformanceReport is citable as sourceType "performance-report".

${CARD_RULES}

${jsonBlock('accepted_proposal', proposal)}
${jsonBlock('targeted_unit', unit)}
${jsonBlock('set_lexicon', set.lexicon)}
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

Dual coding: emit a canonical ID per the set's official scheme AND a normalized join code per the set's normalization conventions (declared coding scheme: ${set.codingScheme || 'detect from the document'}).

User usage notes for this artifact (precedence level 5 — steering below the boundary): ${artifact?.usageNotes || '(none)'}

Output:
- nodes: a FLAT array of every hierarchy node (grouping levels and standards), each with { code, norm, parentCode ('' for top-level nodes), label (heading text for grouping levels, '' otherwise), wording (verbatim standard text, '' for pure grouping nodes), limits (attached in-document limits, [] if none), fluency, emphasis ('not designated' unless the document states designations) }. Do NOT nest — the tree is rebuilt from parentCode.
- setMeta: the document's own identity — { subject (e.g. "Mathematics"), grade (e.g. "Grade 4"), sourceOrganization (the publishing body as the document names it, e.g. "Common Core State Standards Initiative" or a state education agency) }.
- representations / problemTypes: lexicon seed terms harvested from glossaries and taxonomy tables ({ term, aliases, source }).
- coverageWarnings: ONLY contradictions or genuinely unreadable content inside THIS document — e.g. the document identifies as a different framework/grade than the set declares, or standards whose wording could not be captured. One sentence each, naming the specific standards affected. Do NOT flag partial coverage or absences (other documents cover their own subsets by design), boilerplate, formatting notes, or metadata quibbles. At most 3; [] when nothing rises to that bar.
- usageNotes: a one-paragraph description of how the document parsed (hierarchy detected, coding scheme, where limits live).`,
  }
}

export function ingestItemsPrompt(set: StandardSet, artifact: Artifact | undefined): Prompt {
  return {
    system: ingestSystem('released-items extraction pipeline (Tier 2 — arbitrary released-item PDFs)'),
    user: `Extract every assessment item from the attached released-items PDF for the set "${set.name}" (${set.gradeSpan}).

Tier-2 pipeline (spec §4.2): document triage → item segmentation → metadata extraction (state/test/year, item numbers, per-item alignment from item maps or inline annotations) → alignment resolution (official where the document supplies it; otherwise ai-proposed) → characterization (item type, response format, representations and problem types in lexicon terms, demand profile) → opportunistic capture (answer keys, rubrics) → completeness scoring.

Rules:
- page: the 1-based PDF page the item appears on. box: the item's bounding region on that page as PERCENTAGES of page width/height ({ x, y, w, h }, origin top-left) — cover the full question including its art and answer choices, nothing from neighboring items. These drive the screenshot crop; when you cannot localize an item confidently, set box to { x: 0, y: 0, w: 100, h: 100 } (full page) rather than guessing tightly.
- stem: a faithful TEXT STAND-IN for the item (search fallback when the screenshot fails); include choices for selected-response items.
- alignmentCode: exactly ONE code, NORMALIZED to the set's join scheme — never a state-prefixed variant (e.g. "NY-4.MD.3" → "4.MD.3", cluster letters merged per the set's normalization conventions). The item bank, P2 classification, and coverage all join on this code; record any differing exact state code inside demandProfile only if it matters. confidence "official" only when the document itself supplies the alignment, else "ai-proposed" (D14: usable in generation, flagged, queued for confirmation).
- Items the source aligns to MULTIPLE standards are assigned to the LATEST standard in the instructional sequence — the first point at which students would reasonably possess ALL prerequisite knowledge and skills the item requires. Never assign an item to an earlier standard when answering it depends on content taught later; name the governing (latest) standard as alignmentCode.
- scopeClass per P2 (content-based, never code-based) against the set's standards wording: in-boundary | rigor-signal-only (P1 contradiction) | adjacent-grade (officially aligned to another grade of the same set).
- completeness: 0–1 score per record.
- demandProfile: concrete difficulty parameters (number sizes, step counts, representation load, context complexity).

Known glossary vocabulary to reuse for representations/problemTypes terms:${jsonBlock('lexicon', set.lexicon)}
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
      : `a progression document (spec §4.4). Chunk by grade + heading anchored on inline standard codes. Three harvests: the representation lexicon; documented misconceptions (P9 evidence); worked problems as secondary rigor evidence when item evidence is thin — always cited as secondary, never scope-expanding. Stance firewall per P7: mine for sequencing, placement, prerequisites, boundaries, representation vocabulary, misconceptions, and worked problems — never for instructional stance.`
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

/**
 * Lexicon build (runs only after every conflict/gap is resolved). One
 * comprehensive glossary of student-facing, grade-appropriate vocabulary,
 * every term cited to its governing standard + artifact + page.
 */
export function ingestLexiconPrompt(set: StandardSet): Prompt {
  const resolutions = set.warnings
    .filter((w) => w.acknowledged && w.resolution)
    .map((w) => `${w.text} → RESOLVED: ${w.resolution}`)
  return {
    system: ingestSystem(
      'glossary builder. The glossary is the controlled vocabulary every later stage speaks — a vision pass term and a progression term must resolve to the same normalized entry or the split logic misfires.',
    ),
    user: `Build the vocabulary glossary for the set "${set.name}" (${set.gradeSpan}). The attached PDFs are the set's uploaded documents, in artifact-list order.

Build ONE comprehensive glossary of the STUDENT-FACING, GRADE-APPROPRIATE mathematical vocabulary for this set — every term a ${set.gradeSpan} student is expected to read, hear, say, or use in instruction and on assessments within the scope of these standards: concept and operation names, comparison and reasoning words students themselves use, geometry, measurement, fraction, place-value, and data/graph vocabulary, the names of representations and tools students are taught by name (number line, area model, array, tape diagram, protractor), and notation students must read.

Rules:
- The admission test for every candidate term: would it reasonably appear in a ${set.gradeSpan} student's math glossary, word wall, or textbook — AND is it inside the scope of this set's standards? Both must hold.
- STUDENT-FACING is a hard filter. A term that appears only in teacher guides, standards wording, item specifications, or evidence statements does not belong, however central it is to the framework. Excluded: "valid chain of reasoning with equals signs", "multiplicative comparison structure", "assessment boundary", "additive reasoning". Included: "equal groups", "compare", "equation", "remainder".
- GRADE-APPROPRIATE is a hard filter: exclude vocabulary above the grade's expectations. Below-grade terms still in everyday use at this grade stay ("addition" is still ${set.gradeSpan} vocabulary).
- Exhaustive within those filters: sweep the standards wording, the released items (item stems and answer choices are the strongest evidence of what students actually face), the unpacking and progression documents, and every glossary or reference sheet in the corpus. A qualifying term used anywhere in the corpus must appear, once, normalized, with its aliases collected onto one entry. Aim for completeness over brevity — a thin glossary misfires the split logic downstream.
- term: the normalized student-facing form. aliases: every variant/synonym the documents use.
- standard: the single most-governing standard code for the term (normalized join code, e.g. "4.NF.3") — shown as the term's citation.
- artifact: the file name of the uploaded document that best evidences the term. page: the 1-based PDF page in that document where it appears. These are revealed on hover — they must be real locations, not guesses.
- source: one short phrase of context (e.g. "standards glossary", "item stems 2022–2024", "progression worked examples").
- Respect the user's recorded gap/conflict resolutions below — terms from scope the resolutions excluded do not belong in the glossary.

Recorded resolutions:${jsonBlock('resolutions', resolutions)}
Parsed standards tree (digest):${jsonBlock('tree', flattenTreeDigest(set.tree).slice(0, 400))}
Artifact list (index order matches the attached documents):${jsonBlock('artifacts', set.artifacts.map((a) => a.fileName))}

Output terms: [{ term, aliases, standard, artifact, page, source }], normalized, deduplicated, in alphabetical order by term.`,
  }
}

function flattenTreeDigest(nodes: StandardSet['tree'], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.wording) out.push(`${n.norm}: ${n.wording.slice(0, 120)}`)
    if (n.children) flattenTreeDigest(n.children, out)
  }
  return out
}
