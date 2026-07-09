# Scope Generation Tool

**System Specification — v2 (aligned to the No-HITL Curriculum Scope Generator Specification)**

---

## 1. Purpose

The Scope Generator turns any standard set's evidence corpus into a fully scoped course: strand-coherent units of atomized lessons, each specified by a fixed eighteen-field lesson card plus a Decision Record, generated under Direct Instruction doctrine and the Lesson Granularity & Modeling Scope framework (Engine v3), with every card field evidence-locked to its sources and every consequential decision reasoned on the card itself. It is evidence-locked — every field is supported by evidence whenever explicit evidence exists; where the documents do not directly answer a curriculum decision, the AI derives the most defensible inference by reconciling the surrounding evidence with the Direct Instruction framework, traceably. And it shows its reasoning — consequential decisions are written on the card itself.

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

Twelve written policies govern every generation run; each pipeline stage receives its relevant policies verbatim. Rule identifiers (P#, A#) form the citable rule inventory: they appear where they are evidence — Decision records, QC reports, guardrail citations — and never as explanatory chrome in user-facing screens.

**P1 — Evidence First, but the Standard Holds the Veto.** Released items govern inclusion, emphasis, and difficulty freely — except when an item demands something the standard's own wording or stated boundaries exclude at this grade. Then, and only then, the standard wins: the item is set aside as a rigor signal and cannot expand scope. Contradiction defined: an item's demand requires something the standard's wording or an explicit boundary stated in the standards document excludes at this grade/course, or exceeds an explicit limit stated there. Exceeding a default bound from an interpretive or decomposition document is not a contradiction — it is a permitted override, executed and logged. Every veto event is logged in the card's Decision record with both sides cited. Cautious readings of a standard are never used to suppress real test evidence: conservative readings do not cap ceilings; observed evidence does.

**P2 — Items Are Judged by Content, Never by Code.** States revise standards while reusing the same numbering, so an item's printed alignment code cannot be trusted to carry meaning. At scope-resolution time, each item's vision-derived demand profile is checked against the governing standard's wording and classified: **in-boundary** (attaches to atoms; sets ceilings; serves as assessment exemplars) · **rigor-signal-only** (the P1 veto case: contributes its demand profile to the difficulty ceiling of the nearest in-boundary atom in its skill family, and nothing else) · **adjacent-grade** (officially aligned by its source to a standard from another grade/course of the same set).

**P3 — One Strategy, Algorithm First.** Students are not given a menu of methods — they are given the single best one, selected per Stein. Representations and manipulatives come after the algorithm is mastered, framed as interpretations of it, never as parallel ways to compute. Every atom's Instructional Approach names exactly one strategy. Where a standard, decomposition statement, or item evidence requires an alternative technique or representation, it is scoped as a post-mastery application atom, taught only to the depth the evidence demands, sequenced after algorithmic mastery. QC hook: an Instructional Approach naming two computation strategies fails automatically.

**P4 — Atomize the Entire Standard.** The tool does not limit lessons to skills explicitly named in the standard or unpacking document. It performs a full DI task analysis of the standard and generates any instructionally necessary in-between atoms, prerequisite micro-skills, bridges, and application tiers needed for mastery. These atoms stay inside the standard's boundary; they do not add new expectations, but make the full standard teachable, sequenced, and observable. The only restriction is that if an atom belongs in a previous unit or grade level, it is excluded.

**P5 — No Evidence is Not No Lesson.** When no released item tests a component, the component stays in scope. The tool infers the assessment evidence that would plausibly exist — from how sibling skills are tested and where the component sits developmentally — flags everything built on that inference as **inferred**, and writes a concrete exemplar problem at the inferred difficulty so the inference is inspectable, not abstract. The corpus coverage declaration weights the inference: absence in a census corpus argues the component is genuinely untested, shifting the inference toward developmentally-appropriate DI reasoning; absence in a sample corpus is weak evidence, favoring extrapolation from analogous tested components. The inference culminates concretely: the card's Released Items field carries a generated ceiling exemplar demonstrating the inferred rigor (§7.14).

**P6 — Other Grades' Items Know Their Place.** Below-grade items serve as prerequisite evidence and rigor calibration; above-grade items may be cited only when explaining what is deliberately *not* taught yet (Non-Goals / Progression Placement). Neither creates new lessons in this course.

**P7 — Progression Informs Placement, Never Pedagogy.** Interpretive documents are mined for sequencing, prerequisites, vocabulary, documented misconceptions, and worked problems. Their opinions about *how to teach* are context, not doctrine: pedagogical commentary is recorded as inadmissible-for-Instructional-Approach, citable as context only, even when it agrees with doctrine. Where an interpretive document's method preference conflicts with doctrine, Stein prevails (P3) and the conflict is logged in the Decision record.

**P8 — Mastery is Observable Behavior.** Every card states mastery as "Students are able to: …" — an observable performance under stated conditions. Never "students will understand." Task parameters (number ranges, step counts, representation load) belong to the scope; accuracy percentages and rates do not — the delivering application owns those thresholds. When a standard's wording demands fluency (or a fluency-designated decomposition statement or usage note triggers it), the card flags it and cites the trigger; the rate itself is the app's.

**P9 — Error Patterns Shape Instruction, Then Data Refines It.** At generation time, only documented misconceptions count — Stein's error inventories, misconceptions recorded in the evidence documents, or user-provided notes. These error patterns are used to design plausible distractors, corrective feedback, contrast cases, explicit modeling, bridge lessons, and, when justified, additional atoms. After deployment, real student data becomes admissible through the revision workflow (§8) and may revise the scope at full strength. In both cases the Editing Splits bar gates: an error pattern justifies a split only when it reveals a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise it intensifies modeling inside the atom, or seeds a bridge where the confusion is between two atoms. There is no automated data integration; the human report is the interface.

**P10 — Trusted Uploads, Strict on Fit.** Users upload high-quality, already-reviewed PDFs; the system treats them as curated evidence. There is **no artifact-level human review step**. Two safeguards remain, both system-detected:

- **Fit validation (blocking).** Every artifact's detected identity — standard set / coding scheme, grade or course, role — is cross-checked against the set's declaration. Mismatches halt ingestion of that artifact with an explicit error until resolved by re-upload or corrected declaration. The validation unit is the artifact, not the item: items officially aligned to an adjacent grade inside a correctly-graded source are legitimate (P2 handles them).
- **Coverage warnings (required acknowledgment).** Grade levels within the set's span with no item evidence, domain × grade progression gaps, absent structured decomposition. The user must acknowledge each gap before publish; acknowledged gaps drive anticipated-evidence inference downstream (P5) and are surfaced to users whenever a scope request lands inside one.

Format tolerance: the system never rejects an upload for format reasons and never discards usable evidence because metadata is incomplete; ingestion extracts maximally, scores completeness per record, and states reliance on degraded or AI-proposed evidence in the Decision record rather than silently omitting it.

**P11 — Content Standards Only.** The standards parser analyzes only content standards — standards that teach assessable mathematical knowledge or procedures. It excludes, at ingestion, all standards that describe how students should think, communicate, justify, model, persevere, or solve problems: Mathematical Practice (MP) standards, Standards for Mathematical Practice (SMP), Process Standards, Mathematical Processes, Habits of Mind, and similar framework-wide expectations. Excluded standards are not parsed into the tree, cannot seed atoms, and cannot earn coverage credit. Completeness requirement: every most-granular content standard in the document — down to lettered sub-parts — is captured with its exact code and exact verbatim wording; a parser that drops any is defective.

**P12 — Sequence by Instructional Dependency; Keep Units Coherent.** Lessons are ordered by the DI sequence required for mastery, not by the order standards appear in a document or by keeping all atoms from the same standard together. Atoms aligned to the same standard may be separated across the course when prerequisite readiness, confusability, representation demands, or application demands require other lessons to come first. However, each atom must still sit inside a coherent instructional unit: it should belong to the unit's strand, build from nearby lessons, prepare for upcoming lessons, and make sense as part of the unit's visible skill chain.

**Supplementary implementation rules** (below the twelve policies, carrying the same citation discipline):

- **Adjacent-grade handling** (operationalizes P6): below-grade items → prerequisite evidence + rigor calibration for the nearest in-boundary standard; above-grade items → citable only in Non-Goals/Progression Placement; neither generates new-learning atoms.
- **Corpus generalization:** everywhere the engine text discusses released state tests, the system reads: the released-item corpus of the selected standard set, as uploaded, over the window(s) its sources declare — portable across standard sets and any mix of item sources.
- **DOK firewall (two-sided):** BrainLift-style DOK headings are organizational labels only, stripped at ingestion and never read as rigor signals; genuine cognitive-demand tags in interpretive documents are admissible rigor evidence for Difficulty Ceiling.
- **Interpretive bounds are defaults, not law:** decomposition clarifications and interpretive limits supply the default parameter bounds and the descriptive vocabulary for difficulty; observed in-boundary item evidence overrides these defaults in either direction; usage notes may pin a bound where it must not move; only the standards document itself vetoes (P1). Every override and pin is logged.
- **Released Item Demand Analysis:** released items are a representative sample of observable assessment evidence, never an exhaustive specification and never curriculum authority. Per item, the analysis may identify prerequisite atoms, integration behaviors, strategy-selection/representation/discrimination demands, misconception patterns in distractors, and rigor. Patterns recurring across items outweigh isolated examples and may justify integration lessons; the absence of a performance in the released sample is never evidence the performance is never assessed.

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

The corpus is the union of all uploaded item sources for the set. Per-upload metadata: source description, test name(s), window covered, and a coverage declaration — census | sample | unknown — which weights anticipated-evidence inference per corpus (P5).

Tiered ingestion:

- **Tier 1 — Known contract.** Sources matching the recommended compilation format (Appendix E) parse deterministically.
- **Tier 2 — Arbitrary released-item PDFs (the general path).** An AI extraction pipeline: document triage → item segmentation (vision + layout analysis isolates each item as image regions) → metadata extraction (state/test/year, item numbers, per-item alignment from item maps or inline annotations) → alignment resolution (official where supplied; otherwise ai-proposed, queued for user confirmation) → vision characterization (item type, response format, representations and problem types in lexicon terms, demand profile) → opportunistic capture (answer keys, rubrics, scoring guides, point values, when present) → completeness scoring & dedupe.

**D14 — AI-Proposed Alignment Usage.** Items with unconfirmed ai-proposed alignment are usable in generation, flagged in QC and stated in the Decision record of any card that relies on them. The Alignment Queue lists them for one-click confirmation; a set may be configured to require confirmation first.

Scope classification (P2) is assigned at scope-resolution time against the standard wording, then cached per standard set. Multi-part items are one record with parts noted. Items the source aligns to multiple standards are assigned to the latest standard in the instructional sequence — the first point at which students would reasonably possess all prerequisite knowledge and skills the item requires; an item is never assigned to an earlier standard when answering it depends on content taught later.

### 4.3 Role: Unpacking Document (one or more uploads)

Each upload is typed at ingestion:

- **Structured decomposition** — keyed statements partitioning standards into assessable components, with clarifications/limits and possibly type designations (content vs reasoning vs modeling vs integrative) and emphasis groupings. Decomposition keys are the candidate-atom partition; clarifications are the default parameter bounds and difficulty vocabulary (interpretive bounds are defaults, not law); reasoning/modeling-type statements are demand bands, not content atoms; statements scoped to prior-grade content feed Prerequisites, never new learning; integrative statements seed bridge lessons.
- **Narrative interpretation** — prose unpacking. Indexed for retrieval; genuine cognitive-demand tags admissible as rigor evidence (DOK firewall); documented misconceptions admissible per P9; subject to the P7 stance firewall.

Fallback: a set whose decomposition proves unusable falls back to standard sub-parts as the candidate-atom partition; every card cites which partition it used.

### 4.4 Role: Progression Document (one or more uploads)

Documents describing how topics develop across grades. Tagged with the domains/strands and grade span each covers; a completeness check at publish raises domain × grade gaps as coverage warnings (P10). Ingestion chunks by grade + heading, anchored on inline standard codes; page images retained for figures and worked examples. Three harvests: the representation lexicon; documented misconceptions (P9 evidence); worked problems as secondary rigor evidence when item evidence is thin — always cited as secondary, never scope-expanding. Consumption: Progression Placement, Prerequisites, Non-Goals, unit skeleton. Stance firewall per P7.

### 4.5 Emphasis Designations

The Major / Supporting field (§7.5) requires a weight scheme. Ingestion detects the set's emphasis source automatically — a decomposition document's groupings, a dedicated emphasis/blueprint document, or designations stated in the standards document — and usage notes may pin or supply one. If no source exists, the field reads **not designated** and Stage 4 weighting falls back to progression-based ordering alone.

### 4.6 Lexicons (per standard set, living)

Two controlled vocabularies: representations and problem types. Seeded from whatever exists — standards-document glossaries and taxonomy tables, progression vocabulary, doctrine problem-type inventories — and grown from accumulated item characterizations. Consumers: the vision pass, demand profiles, the split logic, modeling-scope vary/hold-constant, Difficulty Ceiling language. Shared lexicons keep a vision pass's term and a progression's term from reading as different things and misfiring the split logic.

### 4.7 Engine & Doctrine Artifacts

Uploaded and versioned as system artifacts, not per standard set. DOK headings stripped per the DOK firewall. The engine ships with its compiled procedure (Appendix A); recompilation is part of publishing a new engine version. Doctrine is plural-ready; Stein et al. (2017) is the controlling method authority within the doctrine layer (P3). Ingestion also extracts every embedded hyperlink from engine and doctrine documents into the Exemplar Asset Register (Appendix F); unresolved entries are flagged, non-blocking.

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
- **Lesson** — id, type (new-learning atom | bridge | application-tier), the 14 card fields, per-field provenance (citations: source type, artifact, locator, excerpt) and per-field rationale, lock status.
- **Citation** — {source_type, artifact_id, locator, excerpt}. Every card field carries ≥1; compiled-procedure and doctrine rules are citable sources for decisions they force.
- **DecisionEntry** — {decision type: granularity | strategy | boundary | ceiling | contradiction | override | assumption, governed field (one of the 14 card-field keys, or `card` for lesson-level calls), rule applied (P#/A#), sides cited, resolution, confidence flags (thin-evidence, ai-proposed reliance)}. Lessons carry an ordered list; the Decision Record renders each entry directly beneath the field it governs.
- **PerformanceReport** — {scope/unit/lesson refs, report text, actor, timestamp}. A citable evidence source in Decision records.
- **Proposal** — {trigger, draft change set, ripple preview, iteration history, status: draft | accepted | abandoned}. Nothing in a proposal mutates the scope until accepted.
- **RerunEvent** — scope version delta: target, mode, guardrail collisions + overrides, ripple set, timestamp, actor; for data-informed revisions, the attached PerformanceReport and full proposal history.

## 6. Generation Pipeline

Six stages; outputs checkpointed; stages 3–5 parallelize and checkpoint per unit; failed runs resume. Every stage prompt is assembled from: relevant policies verbatim + compiled engine procedure + doctrine excerpts (Stein-priority noted) + the consuming artifacts' usage notes + resolved evidence + few-shot exemplars from the Exemplar Asset Register.

- **Stage 1 — Ingest** (publish time). Parse per §4 roles (content standards only, P11); tiered item ingestion with alignment-confirmation queue; build records and lexicons; completeness checks; batch the vision pass; publish.
- **Stage 2 — Scope Resolution** (run time). Resolve the request to StandardRecords + governing decomposition keys (or sub-part partition) + the item subset + interpretive chunks. Classify every item per P2 (contradiction detection per P1; cache). Produce the component evidence map: per assessable component — evidence status (observed | inferred), the evidence itself, ceiling inputs, and any contradiction events.
- **Stage 3 — Atomization.** Run the compiled procedure (Appendix A) over the evidence map: candidate atoms → split/don't-split with cited evidence → tie-breakers → vocabulary micro-lessons and preskill splits → bridge candidates → demand-band handling → modeling-scope pass. Every boundary decision emits DecisionEntries.
- **Stage 4 — Sequencing & Unit Formation.** Doctrine-sourced ordering: preskills before composites; easier before difficult; algorithm before required representations; confusables separated in time, bridges only after both parents independently mastered; within a concept cluster, the sacrificial first instance — easiest sibling first with full modeling, later siblings as reduced-modeling transfer lessons. Units are strand-coherent (strand over spiral), traceable to the set's theme/emphasis statements or progression streams, ordered by progression dependencies with high-weight strands anchoring the sequence. Granularity and count are purely logic-driven; no calendar constraint — students work self-paced, so the scope owes mastery structure, not pacing.
- **Stage 5 — Card Generation.** Fill the fixed 14-field schema per §7. Evidence-locking mandatory: generation returns {content, citations[], rationale} per field; uncited fields rejected pre-QC. The Decision Record is assembled from the per-field rationales plus the accumulated DecisionEntries. For inferred atoms, Stage 5 also produces the generated ceiling exemplar. Faultless-communication style rule applies to the card itself.
- **Stage 6 — Auto-QC.** Run §9 checks; attach the QC report; save as version 1.

Rerun re-entry: lesson granularity change → Stage 3 scoped to affected atoms, then 4–6 locally; regenerate-in-place → Stage 5 for that card; unit rerun → Stages 3–6 for the unit; full rerun → Stages 2–6; data-informed revision → a proposal built from Stages 3–5 scoped to the report's targets, applied only on acceptance.

## 7. Card Field Generation Rules

Fixed schema, fixed order — fourteen content fields plus the Decision Record. Every field: sources → rule → QC, with citations. Bridge and application-tier lessons use the same schema with §7.15 semantics. Field labels below are the normative display headings; all headings render in Title Case (§11.1).

**Clean-field separation.** Fields 1–14 state the *what* thoroughly and never the *why*: no reasoning, no weighing of alternatives, no naming of the documents or rules that drove a choice. All reasoning lives in the Decision Record, whose entries each carry the card field they govern and render directly beneath that field as a collapsible record band — there is a decision record for every single field; lesson-level entries (granularity, lesson type, sequencing) render as the card's closing band. Hovering a decision citation shows the exact source sentences that drove the decision.

1. **Standard.** Canonical ID of the official standard(s) this atom is aligned to, with the official standard wording — and, when the lesson teaches only part of a standard, the exact sub-part taught. Nothing else.
2. **Cluster.** The standard's immediate parent grouping in the set's hierarchy, heading text verbatim. Its job is context; no paraphrase.
3. **Substandard.** A verb-led, lesson-level objective derived from the official standard. It names the single teachable behavior this lesson is responsible for teaching, specific enough to distinguish this atom from neighboring atoms, but broad enough to include all legitimate problem types, representations, and variations inside the lesson boundary. It is not official standards language and must not lock the lesson to one item format, one example type, or one assessment wording. (Export key: `atomizedObjective`.)
4. **Objectives.** A concise, exhaustive list of the observable learning objectives that define mastery of this lesson atom. Each objective describes one specific skill or behavior students must demonstrate. Objectives are specific enough to precisely define what students are expected to learn, but do not unnecessarily constrain assessment format, context, representation, or response type unless those are themselves part of the learning objective. The list must satisfy the **minimal-complete test** — *Complete:* together, the objectives fully describe everything required for mastery of the lesson; *Minimal:* removing any objective would leave part of the lesson's intended mastery unspecified, while adding additional objectives would introduce unnecessary detail or duplicate existing objectives. Objectives describe what students must be able to do — not how that ability will be assessed or taught: assessment format, difficulty, representations, contexts, and instructional method belong elsewhere in the Lesson Card. QC: the objective set is the smallest complete set that guarantees mastery; every assessment evidence statement must trace to at least one objective; every objective must be assessable; no objective may exist solely to constrain question format, instructional method, or representation unless that constraint is itself part of the lesson boundary.
5. **Major / Supporting.** The standard's designation under the set's emphasis source (§4.5), with any weight signal that source provides; **not designated** where none exists — never guessed. Determines Stage 4 instructional weight.
6. **Progression Placement.** Two required layers: cross-grade (from interpretive documents) and within-course (the atoms immediately before and after in this skill's chain, by lesson reference). QC: within-course references resolve to real lessons.
7. **Prerequisites.** Sources: interpretive prose and cross-domain edges; prior atoms in sequence; below-grade item evidence (P6). Each prerequisite tagged **taught-in-course** (lesson ref) or **prior-grade**. QC: chain validity.
8. **Assessment Boundary.** From the component evidence map: standard wording + attached limits, decomposition defaults, in-boundary item evidence, P1 application. Explicit Included/Excluded lists in lexicon vocabulary with concrete parameters; excluded content points to where it lives instead when known; components running on inference marked **inferred**.
9. **New Learning.** Required format — the atom triple: **start cue** (what the student sees that signals this routine) + **single decision path/strategy** (named) + **one observable response form**. One of each, written so a stranger could build the lesson from it. QC: more than one new learning focus fails automatically.
10. **Instructional Approach.** Exactly one named strategy, selected per Stein (P3) when available; then the modeling scope — which concrete cases are explicitly modeled for the student (vary numbers/magnitude, surface contexts, order/format, mastered representations; hold constant strategy steps, unmastered representations, demand band, reading load) versus which cases go straight to independent practice/extension. Modeled cases populate the worked + faded examples; extension cases populate ramped practice only. Sacrificial-first-instance modulation across siblings applies. The field content names the cases in plain terms and does **not** use gradual-release labels ("I Do", "We Do", "You Do"). QC: single-strategy check.
11. **Non-Goals.** Forward-looking "do not teach yet" exclusions with citations: adjacent methods, later representations, above-boundary demands — what an author could plausibly drift into. Each entry cited, pointing to where the content will be taught when known.
12. **Difficulty Ceiling.** In precedence order: decomposition defaults → in-boundary item demand profiles (override either direction) → standards-document limits (absolute) → secondary evidence and P5 inference where observed evidence is absent → rigor-signal-only items mapped in per P2. Concrete parameters — number sizes, step counts, representation load, context complexity — in lexicon vocabulary, naming the hardest legitimate case. Inferred ceilings marked, with what they extrapolate from.
13. **Assessment Evidence.** P8 format — "Students are able to: [observable behavior] [task parameters] [conditions]" — observable verbs only; conditions included (ceiling difficulty, unassisted); fluency flag with trigger basis when applicable, or its absence stated with basis; no percentages, rates, or counts.
14. **Released Items (If Applicable).** Authentic released assessment items assigned to this atom based on **instructional readiness**, not merely standard alignment: each item appears at the earliest lesson where all prerequisite atoms have been mastered. Rendered as their exact screenshots, each captioned test · year · question number (plus alignment confidence — Official or AI-inferred), ordered by closeness to ceiling. Rigor-signal-only items never appear here (ceiling citations only, in field 12). When no in-boundary item exists, the field carries **generated ceiling exemplars** instead: one to three problems written at the rigor the corpus's assessments would demand, at the inferred ceiling, never exceeding the standard's boundary, unmistakably labeled *Generated exemplar — not a released item*, with very descriptive stimulus descriptions of any graphs, diagrams, or images, inference basis cited and the generation logged in the Decision record. **The field is never empty.**

**Decision Record.** The card's conscience — the reasoning for every consequential decision, rendered per field: every field 1–14 carries a rationale (a self-contained prose explanation of why the content reads the way it does) plus the numbered DecisionEntries tagged with the field they govern (or `card` for lesson-level calls), rendered directly beneath that field as a collapsible record. Required entry types: (1) granularity — which split/don't-split criteria fired, which tie-breakers arbitrated, with evidence; (2) strategy selection — the single strategy and its Stein basis; (3) boundary & ceiling calls — absence-policy application, every override of a decomposition default, every pin; (4) contradictions & conflicts — every standard-trumps-item event, every doctrine-vs-interpretive stance conflict, each with both sides cited and the rule applied; (5) assumptions under thin evidence — reliance on secondary rigor evidence, unconfirmed AI-proposed alignments, or anticipated-evidence inference, including what the inference extrapolated from. Entries are terse, numbered, tagged with rule IDs, and cited. If a type had nothing to decide, say so in one clause rather than omitting silently. QC: record present and non-empty; every contradiction entry cites both sides. A reviewer must be able to trace every significant design decision back to its supporting evidence without relying on undocumented judgment.

**7.15 Bridge and Application-Tier Semantics.** Bridge: New Learning = the selection/discrimination behavior — recognize which atom applies from the first cue, execute that single routine cleanly without blending; Instructional Approach = mixed look-alike practice engineered to trigger the confusion, no new rules or methods modeled; prior atoms appear as discrimination examples. Application-tier: New Learning = executing the mastered routine in the new demand band; boundary and ceiling inherit from the parent atom plus the triggering demand statement's scope.

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
2. **Prerequisite-chain validity:** a whole-course ordering check — every taught-in-course prerequisite is taught before the lessons that require it; prerequisites taught outside the course (prior-grade tags) are exempt.
3. **Atom-triple format** on New Learning.
4. **Objective integrity:** the objective set is the smallest complete set that guarantees mastery; every assessment evidence statement traces to at least one objective; every objective is assessable; no objective exists solely to constrain question format, instructional method, or representation unless that constraint is itself part of the lesson boundary.
5. **Single-strategy check** on Instructional Approach.
6. **Neighbor consistency:** boundaries/non-goals never contradict adjacent lessons' new learning; split pairs + bridge partition cleanly.
7. **Ceiling legality:** every ceiling within standards-document limits and P1 evidence.
8. **Theme coverage:** every grade-level theme/emphasis statement (where the set provides them) traceable to ≥1 unit.
9. **Citation completeness:** no field without provenance; inferred-evidence and unconfirmed-alignment reliance surfaced, not buried.
10. **Decision-record integrity:** Decision Record present and non-empty on every card; every contradiction entry cites both sides; every default-bound override and guardrail override logged.
11. **Released-items integrity:** the field is never empty — observed item screenshots captioned test · year · question number, or a generated ceiling exemplar carrying its label, inference basis, and an in-boundary ceiling.

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

Select a published standard set → choose scope: **Course** (a grade) · **Standard** (pick by code from the set's tree — any most-granular content standard, including sub-parts) · **Topic** (any node of the set's hierarchy, or free text mapped to standards with the mapping shown for confirmation) → run (staged progress across Stages 2–6, units stream in, resumable) → review: units → eighteen-field cards — item screenshots rendered inline — with per-field provenance on demand and the Decision record in full view → lock / rerun (with guardrails) / update from student data (§8) / delete → export: CSV (flat, one row per lesson) and canonical JSON (the machine-readable scope: one flat object per lesson card — subject, course, standardSet, standardId, standardDescription, substandard, lessonTitle, objectives, majorSupporting, progressionPlacement, prerequisites, assessmentBoundary, newLearning, instructionalApproach, nonGoals, difficultyCeiling, assessmentEvidence, releasedItems — every field a string; released items rendered as structured references with metadata and persistent screenshot URLs, generated exemplars in full text; Decision Records are human-readable artifacts and are not included).

If a request lands inside acknowledged coverage gaps, the run screen says so before generation: affected components will run on anticipated-evidence inference (P5), flagged on their cards.

Scopes are public view: every user can view every saved scope and its full provenance. Modification rights — rerun, lock, accept proposals, delete — remain with the scope's creator and admins.

### 11.1 Interface Style Rules

- **All headings are Title Case** — page titles, section and card-field headings, tab labels, modal titles, pipeline stage names, and unit/lesson titles. Body prose, field descriptions, and button labels are sentence case.
- **Rule identifiers are not interface copy.** P#/D#/A# rule IDs appear where they are evidence — Decision records, QC report details, guardrail citations — never as explanatory text on admin or upload screens.
- Standard codes, join codes, file names, and item captions render in monospace. Released-item screenshots are visually distinct from generated exemplars; the generated-exemplar label and amber treatment are mandatory (§7.14).

## 11.2 Released Item Repository Generator (Standalone Tool)

A separate tool in the sidebar (internally "packets"), **not connected** to standard sets, scopes,
or the generation pipeline. It answers one question: *what do genuine released assessment items
look like for these standards?*

- **Selection** comes from a built-in catalog (grades 3–8 mathematics, official wording): Pure
  Common Core (CCSS-M), Texas (TEKS), Virginia (SOL, 2023 standards), Florida B.E.S.T. Framework →
  grade level(s) → domains → standards → preferred administration years → title. Domains, standards,
  and years each carry Select All / Clear controls. The year choices are AI-researched per framework
  from the official sources and never offer years before 2017 (at most the past ten years); the hunt
  enforces the same floor.
- **The hunt.** Launching a packet dispatches a backend research agent that searches the public web
  (state education agencies, released tests, official sample items) with the Claude server-side
  web-search tool. Items are transcribed faithfully — exact stem, choices in order, the published
  answer only when the source publishes a key — each with a link to its source. The agent never
  invents an item; a standard with no findable released evidence is reported as a documentation gap.
- **Alignment honesty.** `official` only when the source itself maps the item to the standard code;
  otherwise `ai-inferred`, flagged in the packet and its appendix, never official.
- **Progress.** The packet fills in per search batch, survives interruption (checkpointed on the
  packet document), can be stopped (found items kept) and retried/resumed past finished batches.
- **Output.** On-page packet (cover stats, coverage summary, per-standard text facsimiles with
  lettered choices and source links, gaps, inferred-alignment appendix) and a clean Word download
  that converts to a Google Doc. Facsimiles are text reconstructions transcribed from the linked
  sources — the packet says so, and users are told to verify against the source before classroom use.

## 12. Build & Implementation Notes

- Release scope: grade-organized standard sets; any released-item PDF sources (tiered ingestion); one engine + one doctrine document versioned, plural-ready; Stein-priority encoded in doctrine prompts.
- Jobs: whole-course generation is a long job — queue, per-stage and per-unit checkpoints, resumability, streaming. Vision passes batched at ingestion.
- Prompt assembly per §6. Few-shot exemplars come from the Exemplar Asset Register (Appendix F), auto-extracted at ingestion; unresolved entries non-blocking.
- Evidence-locking implementation: structured output {content, citations[], decision_entries[]} per field; validators reject uncited fields and empty Decision records pre-QC.
- **Front end:** React 19 + Vite + TypeScript + Tailwind CSS v4, hash routing. The domain store (`src/store.tsx`) is the seam where the pipeline backend slots in: every UI action maps 1:1 to an API call; the staged-generation view maps to the real queued job's checkpoints. Repository: `github.com/mmayrell/ScopeGenerator`.
- Interoperability seam: card schema kept exportable (near-isomorphic to standards-extension structures such as CASE). The canonical JSON export (`src/export/scope-json.ts`) is the machine-readable deliverable per the No-HITL spec's "JSON Schema": an array of flat per-lesson objects, keys exactly `subject, course, standardSet, standardId, standardDescription, substandard, lessonTitle, objectives, majorSupporting, progressionPlacement, prerequisites, assessmentBoundary, newLearning, instructionalApproach, nonGoals, difficultyCeiling, assessmentEvidence, releasedItems`, every value a string. Released items are structured references in text form (source, year, item number, aligned standard, alignment confidence, persistent screenshot URL); generated exemplars carry their full question text; Decision Records are maintained separately and are not exported.

---

## Appendix A — Compiled Granularity Procedure (Engine v. current)

Executed in Stage 3 per component, against the component evidence map. All decisions emit DecisionEntries.

- **A1. Decompose.** Candidate atoms from decomposition keys (fallback: standard sub-parts), informed by clarifications and the problem-type lexicon.
- **A2. Split Test.** For each candidate boundary, test the nine split criteria with cited evidence: new rule/strategy not previously taught · new vocabulary/concept label needing stabilization · new/hidden decision step changing the routine · unmastered representation/notation (first encounter of a normalized lexicon form) · high confusability with a look-alike skill · foundational preskill missing/weak · demand-band jump · documented error pattern (per P9) · new integration behavior (the skill requires coordinating multiple previously separate atoms for the first time). Don't-split criteria: same strategy steps · quantitative-only or context-only change · already-mastered representations · cumulative choose-among-mastered-routines goal.
- **A3. Precedence & Tie-Breakers.** When split and don't-split criteria both genuinely fire, split criteria win. Real ambiguity goes to the tie-breakers in order: (1) would a novice need new decision cues never before encountered? → split; (2) can it be rewritten with friendlier numbers/shorter text with the routine identical? → don't split; (3) is there a prerequisite gap that can't be refreshed quickly without new rules or explicit instruction? → split; (4) does successful performance require coordinating multiple previously mastered atoms? → split (integration atom or bridge). The Editing Splits constraint caps error-pattern splits: errors justify a split only on a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise fix modeling, contrasts, or scaffolding inside the atom.
- **A4. Bridges.** Scan split pairs for confusability; insert bridge lessons (discrimination/selection/switching only, no new rules), seeded also by integrative keys; placement deferred to Stage 4 (after both parents mastered; confusables separated in time).
- **A5. Modeling Scope.** Inside each atom, partition cases: explicit modeling necessary (new rule or misinterpretation risk · unmastered representation · high load/hidden steps · shaky preskill · look-alike confusion · foundational prerequisite · fossilization-prone errors · demand jump) versus extension sufficient (same strategy, no new steps · mastered-representation rotation · familiar procedure with varied numbers/contexts · solid preskills · low confusability · non-foundational variant · no stable error pattern · same demand band). Feeds the Instructional Approach field (§7.10) and the vary/hold-constant plan.
- **A6. Validate.** Every atom satisfies the atom triple (start cue · single decision path · one response form) before leaving Stage 3.

## Appendix B — Normative Card Schema

The card renders eighteen display fields plus the Decision Record, fixed order, fixed Title Case labels: Subject · Course · Standard Set · Standard ID · Standard Description · Substandard · Lesson Title · Objectives · Major / Supporting · Progression Placement · Prerequisites · Assessment Boundary · New Learning · Instructional Approach · Non-Goals · Difficulty Ceiling · Assessment Evidence · Released Items (If Applicable) · Decision Record. Subject, Course, and Standard Set derive from the scope's standard set(s); Standard ID and Standard Description split the generated Standard field (code · verbatim wording); Lesson Title is the lesson's name (§7.15 naming convention); the remaining fields are the generated content fields of §7 (Cluster stays in the stored card but is not a display field). Every generated field is written under faultless communication — it must read one way only — and every generated field carries citations. A worked illustration (CCSS 4.NBT.5, "Multiply Up to a Four-Digit Number by a One-Digit Number, Standard Algorithm") ships as seed content in the reference implementation and is normative for the card's shape, illustrative in its content. (Seed lessons other than the flagship predate the Objectives field and render it as "—" until regenerated.)

## Appendix C — Reference Profile: CCSS (informative)

Standards document: the canonical CCSS Math standards. Hierarchy: grade → domain → cluster → standard → sub-part; canonical IDs carry cluster letters; normalized join code grade.domain.number merges cluster letters (sub-parts join as e.g. 4.NF.3a). In-document limits live in footnotes (Grade 3 NF denominators 2, 3, 4, 6, 8; Grade 4 NF adds 5, 10, 12, 100; Grade 4 NBT ≤ 1,000,000). Grade intros supply critical areas (theme statements); the glossary's situation tables seed the problem-type lexicon; "fluently" standards trigger P8. The Standards for Mathematical Practice are excluded per P11. Structured decomposition: Evidence Statement tables (CCSSO 2019) — Type I keys = candidate-atom partition; Type II/III = demand bands; Int keys = bridge seeds. Emphasis source: the sub-claim column with point allocations as weight signal. Progressions: the University of Arizona CCSS Progressions. Released items: any Common Core-aligned state's releases; state framework revisions that reuse CCSS numbering are precisely why P2 classification is content-based.

## Appendix D — Reference Profile: TEKS / STAAR (informative)

Standards document: TEKS Mathematics (TAC §111); hierarchy: grade → strand → knowledge-and-skills statement → expectation; codes like 6.3(C) normalize to 6.3C; limits live in the wording's including/excluding clauses. §111.26(b)(1) mathematical process standards are excluded per P11; all content strands including personal financial literacy are parsed. Emphasis source: Readiness/Supporting designations → Readiness ≈ Major. Structured decomposition: assessed-curriculum / field-guide documents where used, else sub-part fallback. Progressions: the state's vertical alignment documents. Released items: STAAR released forms; release-year forms are effectively complete → coverage declaration census, which weights absence inference toward developmentally-appropriate DI reasoning (P5).

## Appendix E — Recommended Compilation Format (informative; Tier-1 fast path)

A curated per-grade compilation parses deterministically: page 1 — sources, window, coverage caveats (parsed to corpus metadata, including the census/sample declaration); contents table — items per normalized code; sections headed `<normalized code> (N items — state codes: …)`, adjacent-grade sections included; per item — a three-line header (state/agency/source document/item number · exact state code + framework label · source URL) followed by the item screenshot(s). Optional additions welcomed: answer keys, rubrics, point values (§4.2 captures them).

## Appendix F — Exemplar Asset Register (living)

The list of all documents linked from engine and doctrine artifacts, auto-extracted at ingestion. Entries resolve when the linked document is uploaded; unresolved entries are flagged but non-blocking. Resolved assets serve as few-shot exemplars in Stage 3 and Stage 5 prompt assembly (§12).
