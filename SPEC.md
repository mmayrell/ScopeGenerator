# Scope Generation Tool

**System Specification — v1**

---

## 1. Purpose

The Scope Generator turns any standard set's evidence corpus into a fully scoped course: strand-coherent units of atomized lessons, each specified by a fixed 13-field card, generated under Direct Instruction doctrine and the Lesson Granularity & Modeling Scope framework, with every card field evidence-locked to its sources and every consequential decision reasoned on the card itself.

Users create a standard set by naming it and uploading its documents — the official standards document plus the evidence corpus (released items, unpacking, progressions) — each upload carrying free-text notes on how the system should use it. The system makes no assumptions about which standards these are: CCSS, TEKS, another state's set, or any coherent standards document a user uploads. Users select a published standard set, request a scope (whole course, single standard, or topic), review the generated result, and rerun any part at more or less granularity. Scopes are saved, versioned, and auditable.

Downstream lesson anatomy (assumed consumer of every card): a concise article with key concepts → a fully worked example → a faded worked example in which the student completes each step → independent practice ramping in difficulty. The card is a script for the authors (human or AI) of that anatomy. Per the doctrine of faultless communication, the burden sits with the scope, not the lesson author: every field must read one way only.

## 2. Architecture: Data, Engine, Doctrine

Three layers of authority, three kinds of objects:

- **Data** (per standard set, user-uploaded): the official standards document and its evidence corpus. Data is evidence — parsed, indexed, and cited; never obeyed as instruction. Artifacts fill roles (§4), and any PDF that can serve a role is admissible.
- **Engine** (versioned system artifact): the Lesson Granularity & Modeling Scope BrainLift — where lessons cut and what gets explicitly modeled. Compiled into the executable procedure in Appendix A.
- **Doctrine** (versioned system artifacts, plural): the Direct Instruction BrainLift and future BrainLifts — how the cut material is taught, ordered, and assessed. Controlling authority for instructional method: Stein, Kinder, Silbert & Carnine, *Direct Instruction Mathematics* (5th ed., 2017), as operationalized in the doctrine BrainLifts. Where doctrine sources or interpretive documents disagree on method, Stein's DI method prevails.

Every generated scope records the engine and doctrine versions it ran under.

### 2.1 Precedence Chain (role-based; applies to every generation decision)

1. **The standards document is the boundary authority.** The official standard wording — including any assessment boundaries, limits, footnotes, or in/exclusion clauses stated within the standards document itself — defines the outer limit of instructional scope, and it exercises that authority only as a veto (the Contradiction Rule, P1).
2. **Released items are the primary empirical evidence** of what is assessed and how hard. They are used to the fullest extent they exist, from whatever sources the user uploads.
3. **Structured decomposition** (the unpacking role) partitions standards into assessable components and supplies default parameter bounds.
4. **Interpretive documents** (progressions, narrative unpacking) place, connect, and inform — prerequisites, cross-grade placement, misconceptions, representation vocabulary — never instructional stance (P7).
5. **User usage notes** (entered at upload) steer interpretation everywhere below the boundary and may pin bounds; they cannot cross the boundary.

Engine and doctrine sit outside this chain: they are not evidence about the standard set; they are the rules the evidence is processed under.

## 3. Governing Policies

Written as executable rules; each pipeline stage receives its relevant policies verbatim. Rule identifiers (P#, D#, A#) form the citable rule inventory: they appear where they are evidence — Decision records, QC reports, guardrail citations — and never as explanatory chrome in user-facing screens.

**P1 — Evidence Primacy and the Contradiction Rule.** Released items are the primary empirical evidence for inclusion, emphasis, and difficulty, and they govern freely — except that the standard's wording and its stated assessment boundaries trump released-item evidence if and only if a contradiction exists. Contradiction defined: an item's demand requires something the standard's wording or an explicit boundary stated in the standards document excludes at this grade/course, or exceeds an explicit limit stated there. Exceeding a default bound from an interpretive or decomposition document is not a contradiction — it is a permitted override, executed and logged. On contradiction: the standard wins. The item is reclassified out-of-boundary and handled per P2 — its demand profile still calibrates rigor but it cannot expand scope, seed atoms, or earn coverage credit. Every such event is logged in the card's Decision record with both sides cited. Absent a contradiction, the standard's wording is never used to preemptively discount or suppress item evidence: conservative readings do not cap ceilings; observed evidence does.

**P2 — Item Scope Classification (content-based, never code-based).** States revise and re-code standards while reusing numbering, so alignment codes cannot be trusted to carry boundary meaning. At scope-resolution time, each item's vision-derived demand profile is checked against the governing standard's wording and classified: **in-boundary** (attaches to atoms; sets ceilings; serves as assessment exemplars) · **contradiction / rigor-signal-only** (the P1 case: contributes its demand profile to the difficulty ceiling of the nearest in-boundary atom in its skill family, and nothing else) · **adjacent-grade** (officially aligned by its source to a standard from another grade/course of the same set).

**D1 — Absence Policy.** When item evidence is absent for a component, the component stays in scope and the system performs anticipated-evidence inference: it constructs the assessment evidence that would plausibly exist — extrapolating from how analogous components in the same skill family are tested, from decomposition bounds, from interpretive worked problems, and from the component's developmental placement — and scaffolds the difficulty ramp toward that inferred ceiling under DI ordering. The inference is flagged **inferred** on the card and fully reasoned in the Decision record. The corpus coverage declaration weights the inference: absence in a census corpus argues the component is genuinely untested, shifting the inference toward developmentally-appropriate DI reasoning; absence in a sample corpus is weak evidence, favoring extrapolation from analogous tested components. The inference culminates concretely: the card's Released Items field carries a generated ceiling exemplar demonstrating the inferred rigor (§7.12).

**D2 — Adjacent-Grade Handling.** Below-grade items → prerequisite evidence + rigor calibration for the nearest in-boundary standard; above-grade items → citable only in Non-Goals/Progression Placement. Neither generates new-learning atoms in this course.

**P3 — Single Strategy, Algorithm First, Stein Controlling.** Don't give students multiple strategies — give them the single best one; representations and manipulatives come after direct instruction of the algorithm, framed as applications of it, never as parallel computation paths. Every atom's Instructional Approach names exactly one strategy, selected per Stein's DI method. Where a standard, decomposition statement, or item evidence requires an alternative technique or representation, it is scoped as a post-mastery application atom, taught only to the depth the evidence demands, sequenced after algorithmic mastery. QC hook: an Instructional Approach naming two computation strategies fails automatically.

**P4 — Interpretive Bounds Are Defaults, Not Law.** Decomposition clarifications and interpretive limits supply the default parameter bounds and the descriptive vocabulary for difficulty. Observed in-boundary item evidence overrides these defaults in either direction. Usage notes may pin a bound where it must not move. Only the standards document itself contradicts (P1). Every override and every pin is logged in the Decision record.

**P5 — Corpus Generalization Clause.** Everywhere the engine text says "released STAAR tests from the years selected by Alpha," the system reads: the released-item corpus of the selected standard set, as uploaded, over the window(s) its sources declare. Same rule, portable across standard sets and any mix of item sources.

**P6 — DOK Firewall (two-sided).** BrainLift documents use DOK headings solely as an organizational convention; at ingestion these are stripped to section labels and never read as rigor signals. Conversely, genuine cognitive-demand tags found in interpretive documents are admissible rigor evidence for Difficulty Ceiling. Hard firewall between the two meanings.

**P7 — Interpretive Stance Firewall (symmetric).** Interpretive documents are mined for sequencing, placement, prerequisites, boundaries, representation vocabulary, documented misconceptions, and worked problems — never for instructional stance. Pedagogical commentary in an interpretive document is recorded as inadmissible-for-Instructional-Approach, citable as context only, even when it agrees with doctrine. Where an interpretive document's method preference conflicts with doctrine, Stein's DI method prevails (P3) and the conflict is logged in the Decision record.

**P8 — Assessment Evidence Format.** Every card states mastery as observable behavior — "Students are able to: …" — never "students will understand." The scope defines the task; the delivering application defines the thresholds and administration. Task parameters (number ranges, step counts, representation load) stay, because they are scope. Performance thresholds do not: no accuracy percentages, no rates, no problem counts — the adaptive app owns those and applies its own mastery bar (90% at the app level). When fluency is triggered — fluency/automaticity language in the governing standard's wording, a fluency-designated decomposition statement, or usage notes — the field flags the fluency requirement and its doctrinal basis; the rate itself is the app's.

**P9 — Error-Pattern Evidence: Documents at Generation, Reported Data on Revision.** At generation, the engine's error-pattern criterion fires only on documented misconceptions: (a) usage notes, (b) Stein et al., or (c) the corpus itself. After deployment, student data becomes admissible the moment a user reports it through the data-informed revision workflow (§8): the report becomes the cited evidence (a PerformanceReport) and the criterion evaluates it at full strength. In both cases the Editing Splits bar gates: an error pattern justifies a split only when it reveals a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise it intensifies modeling inside the atom, or seeds a bridge where the confusion is between two atoms. There is no automated data integration; the human report is the interface.

**P10 — Trusted Uploads, Strict on Fit.** Users upload high-quality, already-reviewed PDFs; the system treats them as curated evidence. There is **no artifact-level human review step**: no parse-verification screens, no per-artifact approval, no review status. Two safeguards remain, both system-detected:

- **Fit validation (blocking).** Every artifact's detected identity — standard set / coding scheme, grade or course, role — is cross-checked against the set's declaration. Mismatches halt ingestion of that artifact with an explicit error until resolved by re-upload or corrected declaration: codes that don't resolve in the set's scheme; a detected grade/course contradicting the declared one; content that doesn't match its role slot. The validation unit is the artifact, not the item: items officially aligned to an adjacent grade inside a correctly-graded source are legitimate (P2 handles them).
- **Coverage warnings (required acknowledgment).** Grade levels within the set's span with no item evidence, domain × grade progression gaps, absent structured decomposition. The user must acknowledge each gap before publish; acknowledged gaps drive anticipated-evidence inference downstream (D1) and are surfaced to users whenever a scope request lands inside one.

Format tolerance: the system never rejects an upload for format reasons and never discards usable evidence because metadata is incomplete; ingestion extracts maximally, scores completeness per record, and states reliance on degraded or AI-proposed evidence in the Decision record rather than silently omitting it.

**P11 — Content Standards Only.** The standards parser analyzes only content standards — standards that teach assessable mathematical knowledge or procedures (number, operations, algebra, geometry, measurement, statistics, probability, and comparable content strands such as personal financial literacy where the set includes them). It excludes, at ingestion, all standards that describe how students should think, communicate, justify, model, persevere, or solve problems: Mathematical Practice (MP) standards, Standards for Mathematical Practice (SMP), Process Standards, Mathematical Processes, Habits of Mind, and similar framework-wide expectations. Excluded standards are not parsed into the tree, cannot seed atoms, and cannot earn coverage credit. Completeness requirement: every most-granular content standard in the document — down to lettered sub-parts — is captured with its exact code and exact verbatim wording; a parser that drops any is defective.

## 4. Artifact Roles & Ingestion

Artifacts fill roles, not formats. A standard set is created in one step (§10): a name plus one or more PDFs in each of four role slots, each slot carrying the user's free-text usage notes ("Only use the Grade 5 content."). Notes are injected as standing steering instructions into the stages that consume that artifact (precedence level 5). Ingestion runs at publish time and is trusted (P10): no human verification pass.

### 4.1 Role: Official Standard Document (required)

The boundary authority and structure source. The parser targets, generically:

- The set's hierarchy, whatever its shape and level names (grade → domain → cluster → standard → sub-part; or grade → strand → knowledge-and-skills statement → expectation). The UI and card fields use the set's own vocabulary.
- **Every most-granular content standard, verbatim** — full code and exact standard text at every level, down to lettered sub-parts, under the P11 content-standards-only rule. Practice/process/implementation standards are excluded at ingestion.
- All in-document limits: footnotes, parenthetical constraints, "including/excluding" clauses, stated assessment boundaries. Limit capture is a named requirement — a parser that drops them silently corrupts the boundary authority. Limits attach to their level and carry full P1 force.
- Grade/course-level emphasis or theme statements where the document provides them; stored as citable rationale for unit formation.
- Any glossary or taxonomy tables; harvested into the lexicons (§4.6).
- Fluency language flags on standards whose wording triggers P8.

Dual coding (the join design): ingestion emits a canonical ID per the set's official scheme and a normalized join code per the set's normalization conventions. All other artifacts join on the normalized code; finer alignment (sub-parts/expectations) is preserved where sources carry it.

This release handles grade-organized standard sets (elementary/middle). Course-organized sets (high-school conceptual categories or course-based sets) need course definitions and are future work.

### 4.2 Role: Released Items Document (one or more uploads)

The corpus is the union of all uploaded item sources for the set. Per-upload metadata: source description, test name(s), window covered, and a coverage declaration — census | sample | unknown — which weights anticipated-evidence inference per corpus (D1).

Tiered ingestion:

- **Tier 1 — Known contract.** Sources matching the recommended compilation format (Appendix E) parse deterministically.
- **Tier 2 — Arbitrary released-item PDFs (the general path).** An AI extraction pipeline: document triage → item segmentation (vision + layout analysis isolates each item as image regions) → metadata extraction (state/test/year, item numbers, per-item alignment from item maps or inline annotations) → alignment resolution (official where supplied; otherwise ai-proposed, queued for user confirmation) → vision characterization (item type, response format, representations and problem types in lexicon terms, demand profile) → opportunistic capture (answer keys, rubrics, scoring guides, point values, when present) → completeness scoring & dedupe.

**D14 — AI-Proposed Alignment Usage.** Items with unconfirmed ai-proposed alignment are usable in generation, flagged in QC and stated in the Decision record of any card that relies on them. The Alignment Queue lists them for one-click confirmation; a set may be configured to require confirmation first.

Scope classification (P2) is assigned at scope-resolution time against the standard wording, then cached per standard set. Multi-part items are one record with parts noted. Items the source aligns to multiple standards are assigned to the latest standard in the instructional sequence — the first point at which students would reasonably possess all prerequisite knowledge and skills the item requires; an item is never assigned to an earlier standard when answering it depends on content taught later.

### 4.3 Role: Unpacking Document (one or more uploads)

Each upload is typed at ingestion:

- **Structured decomposition** — keyed statements partitioning standards into assessable components, with clarifications/limits and possibly type designations (content vs reasoning vs modeling vs integrative) and emphasis groupings. Decomposition keys are the candidate-atom partition; clarifications are the default parameter bounds and difficulty vocabulary (P4); reasoning/modeling-type statements are demand bands, not content atoms; statements scoped to prior-grade content feed Prerequisites, never new learning; integrative statements seed bridge lessons.
- **Narrative interpretation** — prose unpacking. Indexed for retrieval; genuine cognitive-demand tags admissible per P6; documented misconceptions admissible per P9; subject to the P7 stance firewall.

Fallback: a set whose decomposition proves unusable falls back to standard sub-parts as the candidate-atom partition; every card cites which partition it used.

### 4.4 Role: Progression Document (one or more uploads)

Documents describing how topics develop across grades. Tagged with the domains/strands and grade span each covers; a completeness check at publish raises domain × grade gaps as coverage warnings (P10). Ingestion chunks by grade + heading, anchored on inline standard codes; page images retained for figures and worked examples. Three harvests: the representation lexicon; documented misconceptions (P9 evidence); worked problems as secondary rigor evidence when item evidence is thin — always cited as secondary, never scope-expanding. Consumption: Progression Placement, Prerequisites, Non-Goals, unit skeleton. Stance firewall per P7.

### 4.5 Emphasis Designations

The Major/Supporting/Additional field (§7.3) requires a weight scheme. Ingestion detects the set's emphasis source automatically — a decomposition document's groupings, a dedicated emphasis/blueprint document, or designations stated in the standards document — and usage notes may pin or supply one. If no source exists, the field reads **not designated** and Stage 4 weighting falls back to progression-based ordering alone.

### 4.6 Lexicons (per standard set, living)

Two controlled vocabularies: representations and problem types. Seeded from whatever exists — standards-document glossaries and taxonomy tables, progression vocabulary, doctrine problem-type inventories — and grown from accumulated item characterizations. Consumers: the vision pass, demand profiles, the split logic, modeling-scope vary/hold-constant, Difficulty Ceiling language. Shared lexicons keep a vision pass's term and a progression's term from reading as different things and misfiring the split logic.

### 4.7 Engine & Doctrine Artifacts

Uploaded and versioned as system artifacts, not per standard set. DOK headings stripped per P6. The engine ships with its compiled procedure (Appendix A); recompilation is part of publishing a new engine version. Doctrine is plural-ready; Stein et al. (2017) is the controlling method authority within the doctrine layer (P3). Ingestion also extracts every embedded hyperlink from engine and doctrine documents into the Exemplar Asset Register (Appendix F); unresolved entries are flagged, non-blocking.

## 5. Data Model

- **StandardSet** — id, name, hierarchy configuration (level names), coding scheme (canonical + normalization rules), emphasis-source declaration, artifact list, publish status, ingestion QC report.
- **Artifact** — role (standards | items | unpacking-structured | unpacking-narrative | progression), file, usage notes (user-entered at upload), role-specific metadata (items: source description, window, coverage declaration; progressions: domain × grade-band tags). No review status: the only per-artifact state is a blocking fit-validation error.
- **StandardRecord** — canonical ID, normalized join code, level path, parent-grouping heading text, full verbatim wording, sub-parts, attached limits (with level), fluency flag, emphasis designation, theme/emphasis-statement links. Content standards only (P11).
- **DecompositionStatement** — key, type (content | reasoning | modeling | integrative), grouping/emphasis tag, statement text, clarifications[], parent normalized code(s).
- **ItemRecord** — id, upload ref, source/test/year, item number, exact source alignment code, alignment {code, confidence: official | ai-proposed | confirmed}, completeness score, image(s), characterization {item type, response format, representations[], problem types[], demand profile, number ranges}, key/rubric/points (when captured), cached scope class (P2), provenance.
- **GeneratedExemplar** — {lesson ref, stem, correct answer, demand profile, inference-basis citations, mandatory "Generated exemplar — not a released item" label}. Produced in Stage 5 for atoms with evidence status inferred; stored apart from ItemRecords and never mistakable for one.
- **InterpretiveChunk** — artifact ref, grade, heading anchor, standard codes cited, text, page images, harvested {representations, misconceptions, worked problems}.
- **Lexicon** — representations; problem types. Normalized terms + aliases + source citations.
- **Scope** — id, standard-set ref, request {mode: course | standard | topic; params}, engine version, doctrine versions[], status, ordered units[], version history, QC report.
- **Unit** — id, title, rationale (strand / theme / stream citations), ordered lessons[].
- **Lesson** — id, type (new-learning atom | bridge | application-tier), the 13 card fields, per-field provenance (citations: source type, artifact, locator, excerpt), lock status.
- **Citation** — {source_type, artifact_id, locator, excerpt}. Every card field carries ≥1; compiled-procedure and doctrine rules are citable sources for decisions they force.
- **DecisionEntry** — {decision type: granularity | strategy | boundary | ceiling | contradiction | override | assumption, rule applied (P#/D#/A#), sides cited, resolution, confidence flags (thin-evidence, ai-proposed reliance)}. Lessons carry an ordered list; field 13 renders it.
- **PerformanceReport** — {scope/unit/lesson refs, report text, actor, timestamp}. A citable evidence source in Decision records.
- **Proposal** — {trigger, draft change set, ripple preview, iteration history, status: draft | accepted | abandoned}. Nothing in a proposal mutates the scope until accepted.
- **RerunEvent** — scope version delta: target, mode, guardrail collisions + overrides, ripple set, timestamp, actor; for data-informed revisions, the attached PerformanceReport and full proposal history.

## 6. Generation Pipeline

Six stages; outputs checkpointed; stages 3–5 parallelize and checkpoint per unit; failed runs resume. Every stage prompt is assembled from: relevant policies verbatim + compiled engine procedure + doctrine excerpts (Stein-priority noted) + the consuming artifacts' usage notes + resolved evidence + few-shot exemplars from the Exemplar Asset Register.

- **Stage 1 — Ingest** (publish time). Parse per §4 roles (content standards only, P11); tiered item ingestion with alignment-confirmation queue; build records and lexicons; completeness checks; batch the vision pass; publish.
- **Stage 2 — Scope Resolution** (run time). Resolve the request to StandardRecords + governing decomposition keys (or sub-part partition) + the item subset + interpretive chunks. Classify every item per P2 (contradiction detection per P1; cache). Produce the component evidence map: per assessable component — evidence status (observed | inferred), the evidence itself, ceiling inputs, and any contradiction events.
- **Stage 3 — Atomization.** Run the compiled procedure (Appendix A) over the evidence map: candidate atoms → split/don't-split with cited evidence → tie-breakers → vocabulary micro-lessons and preskill splits → bridge candidates → demand-band handling → modeling-scope pass. Every boundary decision emits DecisionEntries.
- **Stage 4 — Sequencing & Unit Formation.** Doctrine-sourced ordering: preskills before composites; easier before difficult; algorithm before required representations; confusables separated in time, bridges only after both parents independently mastered; within a concept cluster, the sacrificial first instance — easiest sibling first with full modeling, later siblings as reduced-modeling transfer lessons. Units are strand-coherent (strand over spiral), traceable to the set's theme/emphasis statements or progression streams, ordered by progression dependencies with high-weight strands anchoring the sequence. Granularity and count are purely logic-driven; no calendar constraint — students work self-paced, so the scope owes mastery structure, not pacing.
- **Stage 5 — Card Generation.** Fill the fixed 13-field schema per §7. Evidence-locking mandatory: generation returns {content, citations[]} per field; uncited fields rejected pre-QC. Field 13 assembled from accumulated DecisionEntries. For inferred atoms, Stage 5 also produces the generated ceiling exemplar. Faultless-communication style rule applies to the card itself.
- **Stage 6 — Auto-QC.** Run §9 checks; attach the QC report; save as version 1.

Rerun re-entry: lesson granularity change → Stage 3 scoped to affected atoms, then 4–6 locally; regenerate-in-place → Stage 5 for that card; unit rerun → Stages 3–6 for the unit; full rerun → Stages 2–6; data-informed revision → a proposal built from Stages 3–5 scoped to the report's targets, applied only on acceptance.

## 7. Card Field Generation Rules

Fixed schema, fixed order — thirteen fields. Every field: sources → rule → QC, with citations. Bridge and application-tier lessons use the same schema with §7.14 semantics. Field labels below are the normative display headings; all headings render in Title Case (§11.1).

1. **Standard.** Canonical ID of the governing standard(s), plus the concise list of objectives that will prove mastery for this atom. The list may include scaffolded objectives.
2. **Cluster.** The standard's immediate parent grouping in the set's hierarchy, heading text verbatim. Its job is context; no paraphrase.
3. **Major / Supporting.** The standard's designation under the set's emphasis source (§4.5), with any weight signal that source provides; **not designated** where none exists — never guessed. Determines Stage 4 instructional weight.
4. **Progression Placement.** Two required layers: cross-grade (from interpretive documents) and within-course (the atoms immediately before and after in this skill's chain, by lesson reference). QC: within-course references resolve to real lessons.
5. **Prerequisites.** Sources: interpretive prose and cross-domain edges; prior atoms in sequence; below-grade item evidence (D2). Each prerequisite tagged **taught-in-course** (lesson ref) or **prior-grade**. QC: chain validity.
6. **Assessment Boundary.** From the component evidence map: standard wording + attached limits, decomposition defaults, in-boundary item evidence, P1 application. Explicit Included/Excluded lists in lexicon vocabulary with concrete parameters; excluded content points to where it lives instead when known; components running on inference marked **inferred**.
7. **New Learning.** Required format — the atom triple: **start cue** (what the student sees that signals this routine) + **single decision path/strategy** (named) + **one observable response form**. One of each, written so a stranger could build the lesson from it. QC: more than one new learning focus fails automatically.
8. **Instructional Approach.** Exactly one named strategy, selected per Stein (P3) when available; then the modeling scope — cases explicitly modeled (the I Do → We Do set: vary numbers/magnitude, surface contexts, order/format, mastered representations; hold constant strategy steps, unmastered representations, demand band, reading load) versus cases going straight to practice/extension. Modeled cases populate the worked + faded examples; extension cases populate ramped practice only. Sacrificial-first-instance modulation across siblings applies. QC: single-strategy check.
9. **Non-Goals.** Forward-looking "do not teach yet" exclusions with citations: adjacent methods, later representations, above-boundary demands — what an author could plausibly drift into. Each entry cited, pointing to where the content will be taught when known.
10. **Difficulty Ceiling.** In P1/P4 order: decomposition defaults → in-boundary item demand profiles (override either direction) → standards-document limits (absolute) → secondary evidence and D1 inference where observed evidence is absent → contradiction-class items mapped in per P2. Concrete parameters — number sizes, step counts, representation load, context complexity — in lexicon vocabulary, naming the hardest legitimate case. Inferred ceilings marked, with what they extrapolate from.
11. **Assessment Evidence.** P8 format — "Students are able to: [observable behavior] [task parameters] [conditions]" — observable verbs only; conditions included (ceiling difficulty, unassisted); fluency flag with trigger basis when applicable, or its absence stated with basis; no percentages, rates, or counts.
12. **Released Items (If Applicable).** The in-boundary items attached to this atom, rendered as their exact screenshots, each captioned test · year · question number (plus alignment confidence), ordered by closeness to ceiling. Contradiction-class items never appear here (ceiling citations only, in field 10). When no in-boundary item exists, the field carries a **generated ceiling exemplar** instead: one problem written at the rigor the corpus's assessments would demand, at the inferred ceiling, never exceeding the standard's boundary, unmistakably labeled *Generated exemplar — not a released item*, with its inference basis cited and the generation logged in the Decision record. **The field is never empty.**
13. **Decision Record.** The reasoning for every consequential decision on this card, rendered from the DecisionEntries. Required entry types: (1) granularity — which split/don't-split criteria fired, which tie-breakers arbitrated, with evidence; (2) strategy selection — the single strategy and its Stein basis; (3) boundary & ceiling calls — absence-policy application, every override of a decomposition default, every pin; (4) contradictions & conflicts — every standard-trumps-item event, every doctrine-vs-interpretive stance conflict, each with both sides cited and the rule applied; (5) assumptions under thin evidence — reliance on secondary rigor evidence, unconfirmed AI-proposed alignments, or anticipated-evidence inference, including what the inference extrapolated from. Entries are terse, numbered, tagged with rule IDs, and cited. If a type had nothing to decide, say so in one clause rather than omitting silently. QC: field present and non-empty; every contradiction entry cites both sides.

**7.14 Bridge and Application-Tier Semantics.** Bridge: New Learning = the selection/discrimination behavior — recognize which atom applies from the first cue, execute that single routine cleanly without blending; Instructional Approach = mixed look-alike practice engineered to trigger the confusion, no new rules or methods modeled; prior atoms appear as discrimination examples. Application-tier: New Learning = executing the mastered routine in the new demand band; boundary and ceiling inherit from the parent atom plus the triggering demand statement's scope.

**7.15 Lesson Naming Convention.** The lesson name is the shortest string that says what the lesson covers and what makes it unique. It is derived from the atom triple: the decision path's observable behavior plus only the boundary parameters that separate this atom from its nearest siblings.

- **Lead with the skill** — verb + object, naming the observable behavior: "Round Multi-Digit Whole Numbers to Any Place."
- **Carry only the distinguishing constraints.** Include a parameter (number range, multiplier size, representation, method) only when a sibling atom differs on it — the constraint is what tells two lessons apart: "Multiply Up to a Four-Digit Number by a One-Digit Number, Standard Algorithm" vs. its sibling "Multiply Two Two-Digit Numbers, Standard Algorithm." If no sibling differs on a parameter, the name omits it.
- **Omit everything else.** No grade, no standard code, no cluster language, no difficulty qualifiers, and no pedagogy filler — never "Introduction to," "Understanding," "Exploring," or "Practice with." The card's other fields carry that information; the name does not repeat it.
- **Type prefixes.** Bridges are named "Bridge: [the discrimination choice]" ("Bridge: One-Digit or Two-Digit Multiplier? Choose and Execute"). Application-tier lessons are named "Application: [the demand band over the mastered skill]" or by the interpretation demand itself ("Interpret the Algorithm: Equations, Arrays, and Area Models").
- **Uniqueness test.** Within a scope, no two lessons may share a name, and a reader seeing only the sequence's names must be able to tell every lesson apart and predict what each covers. Most names should land in roughly five to ten words; a longer name is acceptable only when a distinguishing constraint requires it.
- Names are headings and render in Title Case (§11.1).

## 8. Rerun, Locking, Versioning

Targets: whole scope · unit · lesson. Modes: more granular (split) · less granular (merge) · regenerate (same granularity) · data-informed revision (propose → review → accept).

**Guardrails — rerun is a negotiation with the framework.** A merge that collapses a boundary protected by a hard split criterion is not silently executed: the tool declines with the cited criterion and evidence. Explicit override is allowed, logged in the RerunEvent, recorded in the affected Decision records, and flagged in QC.

**Data-informed revision (propose → review → accept).** (1) The user describes what the data showed — which lessons, what error patterns or outcomes — captured as a PerformanceReport. (2) The tool maps the report onto framework actions using the engine's Editing Splits logic: splits where the reported errors reveal a new/unstable start cue, a new decision step, or a missing prerequisite; modeling intensification inside the atom where they don't; bridge insertion where the confusion runs between two atoms; ceiling or boundary adjustments where the report shows mis-set difficulty. (3) The tool returns a proposal — a draft change set rendered as a diff against the current version, with ripple preview and Decision record entries citing the report — and nothing mutates. (4) The user accepts (creating a new immutable version with the report and proposal history attached to the RerunEvent) or replies with feedback, and the tool re-proposes — iterating until acceptance or abandonment. Guardrails apply inside proposals. Locked lessons may appear in proposals, because acceptance is the approval the lock requires.

**Blast radius.** When a lesson splits or merges, the relational fields of adjacent and dependent lessons — Prerequisites, Assessment Boundary, Non-Goals, within-course Progression Placement — auto-regenerate, with the change noted in their Decision records; content fields untouched. Locked lessons are never silently mutated: relational updates queue as suggestions requiring approval.

**Locking.** Users lock approved lessons; locks persist across reruns.

**Versioning.** Every rerun produces a new immutable scope version with a diff view; prior versions retained. Delete removes the scope with confirmation.

## 9. Auto-QC Checks

1. **Coverage matrix** keyed on decomposition keys where present, else standard components: every in-scope content key lands in ≥1 atom; reasoning/modeling demands tracked as tiers or application lessons; integrative keys tracked to bridges; no orphan atoms.
2. **Prerequisite-chain validity:** every prerequisite resolves to an earlier lesson or a prior-grade tag.
3. **Atom-triple format** on New Learning.
4. **Single-strategy check** on Instructional Approach.
5. **Neighbor consistency:** boundaries/non-goals never contradict adjacent lessons' new learning; split pairs + bridge partition cleanly.
6. **Ceiling legality:** every ceiling within standards-document limits and P1 evidence.
7. **Theme coverage:** every grade-level theme/emphasis statement (where the set provides them) traceable to ≥1 unit.
8. **Citation completeness:** no field without provenance; inferred-evidence and unconfirmed-alignment reliance surfaced, not buried.
9. **Decision-record integrity:** field 13 present and non-empty on every card; every contradiction entry cites both sides; every P4 override and guardrail override logged.
10. **Released-items integrity:** the field is never empty — observed item screenshots captioned test · year · question number, or a generated ceiling exemplar carrying its label, inference basis, and an in-boundary ceiling.

## 10. Admin Experience

**Creating a standard set** is a single flow — **New Standard Set** — with five inputs:

1. **Standard Set Name** (text).
2. **Official Standard Document** — one or more PDFs.
3. **Progression Document** — one or more PDFs.
4. **Released Items Document** — one or more PDFs.
5. **Unpacking Document** — one or more PDFs.

Each document slot carries an always-visible open-text field for usage notes — the user's instructions on how the system should use those documents (e.g., "Only use the Grade 5 content."; "Treat as sample, not census."). All four document roles are required at creation; the set card is created as a draft the moment the uploads complete.

After creation, the set detail page shows:

- **Configuration** — the hierarchy level names only. Coding scheme and emphasis source are detected at ingestion and steerable via usage notes; they are not user-facing configuration.
- **Artifacts** — each upload with its role, file name, item-source metadata (description, window, coverage declaration), and its usage notes. No review status (P10): the only per-artifact state is a blocking fit-validation error, shown with an explicit message and a corrected-declaration / re-upload path.
- **Standards Tree** — every most-granular content standard with its exact code and verbatim text, fully expanded by default; cluster/grouping headings verbatim; in-document limits displayed inline at the level they attach to, visually distinguished; emphasis designations and fluency flags as badges. A standing note states the P11 rule: content standards only; practice/process/implementation standards excluded at ingestion.
- **Item Bank** — item screenshots grouped by standard code, one collapsible group per standard, **starting collapsed**. Each group header shows the code, the standard's wording, and an item count; expanding reveals the item screenshots, each captioned test · year · question number with alignment-confidence and scope-class badges and the demand profile.
- **Alignment Queue** — AI-proposed alignments awaiting one-click confirmation (D14).
- **Lexicons** — the two controlled vocabularies with aliases and source citations.

Coverage warnings appear at the top of the set page; each must be acknowledged before publish. **Publish** is enabled exactly when no blocking errors remain and all warnings are acknowledged; the gating is enforced by the control itself, not explained in on-screen policy text.

Separately: manage engine and doctrine versions (upload → recompile → publish; existing scopes keep recorded versions).

## 11. User Experience

Select a published standard set → choose scope: **Course** (a grade) · **Standard** (pick by code from the set's tree — any most-granular content standard, including sub-parts) · **Topic** (any node of the set's hierarchy, or free text mapped to standards with the mapping shown for confirmation) → run (staged progress across Stages 2–6, units stream in, resumable) → review: units → 13-field cards — item screenshots rendered inline — with per-field provenance on demand and the Decision record in full view → lock / rerun (with guardrails) / update from student data (§8) / delete.

If a request lands inside acknowledged coverage gaps, the run screen says so before generation: affected components will run on anticipated-evidence inference (D1), flagged on their cards.

Scopes are public view: every user can view every saved scope and its full provenance. Modification rights — rerun, lock, accept proposals, delete — remain with the scope's creator and admins.

### 11.1 Interface Style Rules

- **All headings are Title Case** — page titles, section and card-field headings, tab labels, modal titles, pipeline stage names, and unit/lesson titles. Body prose, field descriptions, and button labels are sentence case.
- **Rule identifiers are not interface copy.** P#/D#/A# rule IDs appear where they are evidence — Decision records, QC report details, guardrail citations — never as explanatory text on admin or upload screens.
- Standard codes, join codes, file names, and item captions render in monospace. Released-item screenshots are visually distinct from generated exemplars; the generated-exemplar label and amber treatment are mandatory (§7.12).

## 12. Build & Implementation Notes

- Release scope: grade-organized standard sets; any released-item PDF sources (tiered ingestion); one engine + one doctrine document versioned, plural-ready; Stein-priority encoded in doctrine prompts.
- Jobs: whole-course generation is a long job — queue, per-stage and per-unit checkpoints, resumability, streaming. Vision passes batched at ingestion.
- Prompt assembly per §6. Few-shot exemplars come from the Exemplar Asset Register (Appendix F), auto-extracted at ingestion; unresolved entries non-blocking.
- Evidence-locking implementation: structured output {content, citations[], decision_entries[]} per field; validators reject uncited fields and empty Decision records pre-QC.
- **Front end:** React 19 + Vite + TypeScript + Tailwind CSS v4, hash routing. The domain store (`src/store.tsx`) is the seam where the pipeline backend slots in: every UI action maps 1:1 to an API call; the staged-generation view maps to the real queued job's checkpoints. Repository: `github.com/mmayrell/ScopeGenerator`.
- Interoperability seam: card schema kept exportable (near-isomorphic to standards-extension structures such as CASE); no work in this release beyond not foreclosing it.

---

## Appendix A — Compiled Granularity Procedure (Engine v. current)

Executed in Stage 3 per component, against the component evidence map. All decisions emit DecisionEntries.

- **A1. Decompose.** Candidate atoms from decomposition keys (fallback: standard sub-parts), informed by clarifications and the problem-type lexicon.
- **A2. Split Test.** For each candidate boundary, test the eight split criteria with cited evidence: new rule/strategy not previously taught · new vocabulary/concept label needing stabilization · new/hidden decision step changing the routine · unmastered representation/notation (first encounter of a normalized lexicon form) · high confusability with a look-alike skill · foundational preskill missing/weak · demand-band jump · documented error pattern (per P9). Don't-split criteria: same strategy steps · quantitative-only or context-only change · already-mastered representations · cumulative choose-among-mastered-routines goal.
- **A3. Precedence & Tie-Breakers.** When split and don't-split criteria both genuinely fire, split criteria win. Real ambiguity goes to the tie-breakers in order: (1) would a novice need new decision cues never before encountered? → split; (2) can it be rewritten with friendlier numbers/shorter text with the routine identical? → don't split; (3) is there a prerequisite gap that can't be refreshed quickly without new rules or explicit instruction? → split. The Editing Splits constraint caps error-pattern splits: errors justify a split only on a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise fix modeling, contrasts, or scaffolding inside the atom.
- **A4. Bridges.** Scan split pairs for confusability; insert bridge lessons (discrimination/selection/switching only, no new rules), seeded also by integrative keys; placement deferred to Stage 4 (after both parents mastered; confusables separated in time).
- **A5. Modeling Scope.** Inside each atom, partition cases: explicit modeling necessary (new rule or misinterpretation risk · unmastered representation · high load/hidden steps · shaky preskill · look-alike confusion · foundational prerequisite · fossilization-prone errors · demand jump) versus extension sufficient (same strategy, no new steps · mastered-representation rotation · familiar procedure with varied numbers/contexts · solid preskills · low confusability · non-foundational variant · no stable error pattern · same demand band). Feeds field 8 and the vary/hold-constant plan.
- **A6. Validate.** Every atom satisfies the atom triple (start cue · single decision path · one response form) before leaving Stage 3.

## Appendix B — Normative Card Schema

The thirteen fields of §7, fixed order, fixed Title Case labels: Standard(s) · Cluster · Major / Supporting / Additional Work · Progression Placement · Prerequisites · Assessment Boundary · New Learning · Instructional Approach · Non-Goals · Difficulty Ceiling · Assessment Evidence · Released Items (If Applicable) · Decision Record. Every field written under faultless communication — it must read one way only — and every field carries citations. A worked illustration (CCSS 4.NBT.5, "Multiply Up to a Four-Digit Number by a One-Digit Number, Standard Algorithm") ships as seed content in the reference implementation and is normative for the card's shape, illustrative in its content.

## Appendix C — Reference Profile: CCSS (informative)

Standards document: the canonical CCSS Math standards. Hierarchy: grade → domain → cluster → standard → sub-part; canonical IDs carry cluster letters; normalized join code grade.domain.number merges cluster letters (sub-parts join as e.g. 4.NF.3a). In-document limits live in footnotes (Grade 3 NF denominators 2, 3, 4, 6, 8; Grade 4 NF adds 5, 10, 12, 100; Grade 4 NBT ≤ 1,000,000). Grade intros supply critical areas (theme statements); the glossary's situation tables seed the problem-type lexicon; "fluently" standards trigger P8. The Standards for Mathematical Practice are excluded per P11. Structured decomposition: Evidence Statement tables (CCSSO 2019) — Type I keys = candidate-atom partition; Type II/III = demand bands; Int keys = bridge seeds. Emphasis source: the sub-claim column with point allocations as weight signal. Progressions: the University of Arizona CCSS Progressions. Released items: any Common Core-aligned state's releases; state framework revisions that reuse CCSS numbering are precisely why P2 classification is content-based.

## Appendix D — Reference Profile: TEKS / STAAR (informative)

Standards document: TEKS Mathematics (TAC §111); hierarchy: grade → strand → knowledge-and-skills statement → expectation; codes like 6.3(C) normalize to 6.3C; limits live in the wording's including/excluding clauses. §111.26(b)(1) mathematical process standards are excluded per P11; all content strands including personal financial literacy are parsed. Emphasis source: Readiness/Supporting designations → Readiness ≈ Major. Structured decomposition: assessed-curriculum / field-guide documents where used, else sub-part fallback. Progressions: the state's vertical alignment documents. Released items: STAAR released forms; release-year forms are effectively complete → coverage declaration census, which weights absence inference toward developmentally-appropriate DI reasoning (D1).

## Appendix E — Recommended Compilation Format (informative; Tier-1 fast path)

A curated per-grade compilation parses deterministically: page 1 — sources, window, coverage caveats (parsed to corpus metadata, including the census/sample declaration); contents table — items per normalized code; sections headed `<normalized code> (N items — state codes: …)`, adjacent-grade sections included; per item — a three-line header (state/agency/source document/item number · exact state code + framework label · source URL) followed by the item screenshot(s). Optional additions welcomed: answer keys, rubrics, point values (§4.2 captures them).

## Appendix F — Exemplar Asset Register (living)

The list of all documents linked from engine and doctrine artifacts, auto-extracted at ingestion. Entries resolve when the linked document is uploaded; unresolved entries are flagged but non-blocking. Resolved assets serve as few-shot exemplars in Stage 3 and Stage 5 prompt assembly (§12).
