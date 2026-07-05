# Exemplar Asset — Lesson Granularity, Scoping, and Lesson Cards (Worked Examples)

**Role:** few-shot anchor for Stage 3 (atomization), Stage 4 (sequencing), and Stage 5 (card generation).
**Linked from:** Lesson Granularity & Modeling Scope BrainLift · Direct Instruction BrainLift (Stein, Kinder, Silbert & Carnine, *Direct Instruction Mathematics*, 5th ed., 2017).
**Portability:** written to work with any state standard set. Standard codes shown are illustrative; the selected set's own canonical and normalized codes govern. Every rule herein reads against the selected set's released-item corpus and standards wording.

This document renders the framework's decisions the way the tool must make them: first the granularity decisions on a real skill family (Part 1), then the scoping of that family into an ordered sequence (Part 2), then two complete 13-field lesson cards — one new-learning atom and one discrimination bridge (Part 3).

---

## Part 1 — Lesson Granularity Decisions: One-Step Word Problems Across the Four Operations

### The Candidate Component

The component under atomization: *solve one-step word problems involving addition, subtraction, multiplication, and division of whole numbers.* Released items in the corpus present unlabeled story problems; the student must determine the operation from the problem's structure and execute it. A single "word problems" lesson would bundle four different decision paths behind one surface cue — the definition of an over-broad atom.

### Applying the Split Test

An atom is the smallest teachable unit: one **start cue**, one **decision path/strategy**, one **observable response form**. Test the candidate against the split criteria:

- **New rule/strategy not previously taught.** Each operation's word-problem schema is its own routine. A combine (join) problem is solved by adding the parts; an equal-groups problem by multiplying group count × group size. The decision paths differ — the routines cannot share one modeled demonstration without violating faultless communication. → **Split by problem structure.**
- **New/hidden decision step changes the routine.** Recognizing "3 bags with 8 apples each" as equal groups is a different structural read than recognizing "3 apples, then 8 more" as a join. The structural read is the hidden decision step; each structure needs its own task analysis and guided practice. → **Split.**
- **High confusability with a look-alike skill.** Addition and multiplication word problems share nearly identical surface stories and differ only in structure ("3 and 8 more" vs. "3 groups of 8"). Confusable siblings must be introduced separately, with contrasted non-examples — and they obligate a discrimination lesson (below). → **Split, and separate in time.**

The split yields four sibling atoms, one per operation, each defined by its problem structure:

| Atom | Start Cue (structural) | Decision Path | Response Form |
|---|---|---|---|
| Solve Combine Word Problems by Adding | Parts joined into a total ("altogether," a quantity increased) | Identify parts → add | Written equation + answer with unit |
| Solve Separate and Compare Word Problems by Subtracting | A quantity removed, or two quantities compared for difference | Identify whole and part (or two amounts) → subtract | Written equation + answer with unit |
| Solve Equal-Groups Word Problems by Multiplying | Equal-sized groups with count and size known | Identify group count and group size → multiply | Written equation + answer with unit |
| Solve Sharing and Grouping Word Problems by Dividing | A total split into equal shares or measured into equal groups | Identify total and share/group size → divide | Written equation + answer with unit |

Each row satisfies the atom triple. Per Stein, the schema (problem structure) is taught explicitly — students are never left to infer the operation from keyword hunting, which fossilizes the "altogether means add" error.

### What Does Not Split

- **Changes that are quantitative only.** Two-digit versus three-digit numbers inside a combine problem is the same routine at different magnitude — a difficulty tier inside the atom, never a new atom.
- **Surface-context swaps.** Recipes, distances, prices: story frames vary in practice; the mathematical action is unchanged.
- **Already-mastered representations.** A combine problem presented with a bar model the student has mastered does not split; representation rotation is extension.

### Editing Splits: Errors Intensify Modeling Before They Split Atoms

Suppose practice data (or the doctrine's error inventories) show students reliably subtracting the smaller number from the larger regardless of the story's structure in compare problems. Analysis: the start cue is stable, the decision path unchanged, no prerequisite is missing — the error is a misreading inside the atom. The response is **modeling intensification**: side-by-side contrast pairs ("How many more does Ana have?" vs. "How many does Ana have left?"), an explicit think-aloud on identifying which quantity is the whole, and re-sequenced practice — not a new atom. Errors justify a split only when they reveal a new or unstable start cue, a new decision step or rule, or a missing prerequisite.

### The Discrimination Lesson — Obligatory, Not Optional

**When a skill family splits into sibling atoms whose start cues look alike, the scope must include a discrimination lesson (bridge).** The four operation atoms above share one surface cue — an unlabeled story problem — so mastering each in isolation leaves the assessed skill untaught: *choosing* the operation. The bridge's job:

1. **Recognize which atom applies from the very first cue** — read the problem's structure (join? compare? equal groups? sharing?) before touching numbers.
2. **Execute the correct single routine cleanly** — without blending steps from a sibling.

The bridge introduces **no new rules or methods**. It is purely discrimination, selection, and switching under mixed practice, built from **look-alike items engineered to trigger the confusion**: the same story surface carrying different structures —

> "Maria fills 4 boxes with 6 books each. How many books?" (equal groups → multiply)
> "Maria has 4 books and buys 6 more. How many books?" (combine → add)
> "Maria has 6 books; Jon has 4. How many more does Maria have?" (compare → subtract)
> "Maria shares 24 books equally among 6 shelves. How many per shelf?" (sharing → divide)

The same obligation recurs across mathematics wherever siblings are confusable: area vs. perimeter; like- vs. unlike-denominator addition; mean absolute deviation vs. range (with a third lesson choosing the appropriate measure and justifying the choice); "identify the proportional relationship" vs. "find the constant of proportionality." **The rule: every split that creates look-alike siblings creates a debt; the discrimination lesson pays it.**

### Tie-Breakers, Applied

- *Would a novice need new decision cues never before encountered?* Choosing among four mastered routines from an unlabeled stem is exactly such a cue → the discrimination behavior is its own lesson (the bridge), not folded into a sibling.
- *Can it be rewritten with friendlier numbers with the routine identical?* A combine problem with 3-digit addends rewrites to 1-digit with the routine identical → same atom, difficulty tier.
- *Is there a prerequisite gap that can't be refreshed quickly?* If the division algorithm itself is unmastered, the sharing/grouping atom waits: the computation preskill is taught and stabilized first as its own lesson.

### Modeling Scope Inside One Atom (Minimum Viable Modeling)

Inside *Solve Equal-Groups Word Problems by Multiplying*: model explicitly the base structural read (groups and size explicit), one modeled case where group size appears before group count (order variation that novices misread), and one contrast non-example (a combine story, named as "not equal groups — no groups of equal size"). Everything else — larger numbers, new story surfaces, mastered representations — goes straight to ramped practice. Between I Do and We Do, vary numbers and magnitude, surface contexts, and order/format; hold constant the strategy steps, the demand band, the reading load, and any unmastered representation.

---

## Part 2 — Example of Scoping: From Component Map to Ordered Sequence

Scoping the family from Part 1 (plus its computation dependencies) into one strand-coherent unit. Sequencing follows doctrine: preskills before composites; easier before harder; the easiest sibling first with full modeling (the sacrificial first instance), later siblings as reduced-modeling transfer lessons; confusable siblings separated in time; the bridge only after every parent is independently mastered; application tier last.

| # | Lesson | Type | Granularity Basis | Placement Basis |
|---|---|---|---|---|
| L1 | Solve Combine Word Problems by Adding | New-learning atom | Split: new strategy (join schema) | Easiest sibling first — full modeling (sacrificial first instance) |
| L2 | Solve Equal-Groups Word Problems by Multiplying | New-learning atom | Split: new strategy + hidden structural read | Separated from L1's confusable (add vs. multiply) by an intervening skill in the full course sequence; reduced-modeling transfer of the schema-reading routine |
| L3 | Solve Separate and Compare Word Problems by Subtracting | New-learning atom | Split: new strategy; compare structure is fossilization-prone | Separated in time from L1 (join/separate confusion); compare contrast pairs modeled explicitly |
| L4 | Divide with the Standard Algorithm, One-Digit Divisors | New-learning atom (preskill) | Tie-breaker 3: prerequisite gap that cannot be refreshed quickly — the computation routine itself is unmastered | Preskill before the composite that consumes it (L5) |
| L5 | Solve Sharing and Grouping Word Problems by Dividing | New-learning atom | Split: new strategy (partition/measurement schemas) | After its computation preskill (L4); last sibling, fully reduced modeling |
| L6 | Bridge: Which Operation? Choose and Solve | Bridge | A4: split pair(s) with high confusability obligate discrimination training | Only after L1, L2, L3, and L5 are each independently mastered; mixed look-alike practice |
| L7 | Application: Two-Step Word Problems Across Operations | Application tier | Demand-band jump (one-step execution → multi-step orchestration) — a tier, not a sibling | After the bridge: selection under mixed cues is a prerequisite for chaining operations |

Unit rationale: one strand (operations in context), traceable to the set's emphasis statements; the unit owes mastery structure, not pacing. Coverage check: every atom traces to a component of the governing standards; the discrimination skill (L6) earns coverage credit for the "choose the operation" demand that released items assess with unlabeled stems; no orphan atoms.

Ceilings throughout are set by the selected set's released-item corpus under the Assessment Alignment Constraint: instruction caps at the highest observed tested difficulty, and components without observed items run on anticipated-evidence inference, flagged inferred.

---

## Part 3 — Example of Lesson Cards

Two complete cards in the normative 13-field schema. Citations are illustrative in form (source → locator) and normative in behavior: every field cites, every consequential decision is reasoned on the card.

### Card A — New-Learning Atom

| Field | Content |
|---|---|
| **Standard(s)** | [Set's multiplication word-problem standard — canonical] / [normalized join code]; governing decomposition key: the equal-groups component. Sibling components (combine, separate/compare, sharing/grouping) are separate atoms (L1, L3, L5). |
| **Cluster** | The standard's immediate parent grouping, heading text verbatim from the set's standards document. |
| **Major / Supporting / Additional Work** | As designated by the set's declared emphasis source; *not designated* if the set has none. |
| **Progression Placement** | Cross-grade: builds on single-digit products and the equal-groups meaning of multiplication from the prior grade; leads to multi-digit products in context and two-step problems. Within-course: follows L1 (combine problems — the schema-reading routine transfers); precedes L6 (bridge) and L7 (application tier). |
| **Prerequisites** | Recalls single-digit multiplication facts (prior-grade); reads one-step story problems at grade reading load (prior-grade); identifies parts vs. total in a story structure (taught-in-course: L1). |
| **Lesson Boundary** | Included: one-step equal-groups problems, group count and size explicit in the stem, whole-number factors within the corpus-observed range, bare and thin-context stems; order variation (size stated before count). Excluded: combine/separate/compare structures (L1, L3); sharing and grouping division structures (L5); two-step problems (L7); multiplicative comparison ("times as many" — separate component per the set's decomposition). |
| **New Learning** | Start cue: an unlabeled story problem whose structure presents equal-sized groups — a group count and a group size. Decision path: read the structure and confirm equal groups → identify group count and group size → multiply. Response form: the written equation and the answer labeled with its unit. |
| **Instructional Approach** | Single strategy: schema-based structural read, then multiply (Stein — never keyword hunting). Model explicitly: the base case (count and size explicit, in that order); the order-variant case (size before count); one contrast non-example (a combine story, named "not equal groups"). Vary between I Do and We Do: numbers and magnitude, surface contexts (recipes, prices, distances), stem format. Hold constant: the strategy steps, the demand band, the reading load. Extension / practice only: larger factors, new story surfaces, mastered representations. |
| **Non-Goals** | Do not teach keyword shortcuts ("each means multiply") — the discrimination lesson (L6) depends on structural reading; do not introduce division structures (L5); do not present two-step stems (L7); do not require equation-with-unknown notation if the set defers it. |
| **Difficulty Ceiling** | Hardest legitimate case: factors at the highest magnitude observed in the corpus for this component, order-variant stem, thin context, answer-with-unit response. No two-step stems; no multiplicative comparison. Where the corpus shows no item for this component, the ceiling is inferred from analogous tested siblings and flagged inferred. |
| **Assessment Evidence** | Students are able to: solve a one-step equal-groups word problem by identifying the group count and group size and multiplying, writing the equation and the labeled answer, at ceiling difficulty, unassisted. Fluency flag: none — no fluency language in the governing wording or keys. No percentages, rates, or counts — the delivering application owns thresholds. |
| **Released Items (If Applicable)** | The in-boundary items attached to this component, rendered as screenshots captioned test · year · question number, ordered by closeness to ceiling. If none exist: one **Generated exemplar — not a released item**, written at the inferred ceiling, inference basis cited. The field is never empty. |
| **Decision Record** | 1. *Granularity* — split from siblings per new strategy + hidden structural read (A2); order-variant stems kept inside the atom per Editing Splits (no new cue or rule) and escalated to explicit modeling (A5). 2. *Strategy selection* — schema-based structural read per Stein; keyword strategies excluded as fossilization-prone. 3. *Boundary & ceiling* — decomposition default confirmed against observed items; multiplicative comparison excluded to its own component; no pins. 4. *Contradictions & conflicts* — none encountered. 5. *Thin-evidence assumptions* — state whether the ceiling is observed or inferred, and from what. |

### Card B — Discrimination Bridge

| Field | Content |
|---|---|
| **Standard(s)** | The four parent components' codes (canonical + normalized); the bridge spans them and earns the coverage credit for the corpus's unlabeled mixed-operation demand. |
| **Cluster** | Same parent grouping, heading verbatim. |
| **Major / Supporting / Additional Work** | Inherited from the parent standards' designations. |
| **Progression Placement** | Within-course: after L1, L2, L3, and L5 are each independently mastered; precedes L7 (application tier). Cross-grade: the discrimination behavior itself is course-internal; multi-step orchestration follows. |
| **Prerequisites** | All four parent atoms, each tagged taught-in-course (L1, L2, L3, L5) and each independently mastered — the bridge trains selection among mastered routines only. |
| **Lesson Boundary** | Included: mixed, unlabeled one-step problems drawn from all four parent classes, at the parents' number ranges, in look-alike surface frames. Excluded: any new number range, representation, or format beyond the parents' boundaries; two-step stems (L7). |
| **New Learning** | Start cue: any unlabeled one-step story problem from the four parent classes. Decision path: the selection/discrimination behavior — read the structure from the first cue, name the matching schema, execute that single routine cleanly without blending steps from a sibling. Response form: the written equation (operation visible) and the labeled answer. |
| **Instructional Approach** | No new rules or methods modeled — bridge semantics. Mixed look-alike practice engineered to trigger the confusion: matched story surfaces carrying different structures (the Maria set); alternating and streaked sequences; prior atoms appear as discrimination examples. Model only the selection think-aloud on one matched quartet; everything else is practice. Vary: surfaces, order, streak length. Hold constant: number ranges, formats, demand band — selection is the only new demand. |
| **Non-Goals** | Do not re-teach any computation or schema (mastered inputs); do not introduce new number ranges or representations; do not mix in two-step stems; do not teach keyword shortcuts. |
| **Difficulty Ceiling** | Hardest legitimate case: an interleaved set at the parents' ceilings in which consecutive items share a story surface and differ only in structure. Inherited from the parents — the bridge sets no ceiling of its own. |
| **Assessment Evidence** | Students are able to: select and correctly execute the matching operation for an unlabeled mixed set spanning all four parent problem classes, writing the equation and labeled answer, at parent ceiling difficulty, unassisted. Fluency flag: none. |
| **Released Items (If Applicable)** | Mixed-operation released items where the stem is unlabeled; otherwise the parents' nearest-ceiling items serve as the discrimination set, or a labeled generated exemplar quartet at the inferred demand. Never empty. |
| **Decision Record** | 1. *Granularity* — bridge inserted per A4: split siblings share a surface start cue with divergent routines (high confusability); the cumulative choose-among-mastered-routines goal is itself a don't-split criterion for the parents and the defining job of this lesson. 2. *Strategy selection* — none: no new method; selection think-aloud only (Stein: discrimination via contrasted look-alikes). 3. *Boundary & ceiling* — inherited from parents; nothing new set. 4. *Contradictions & conflicts* — none encountered. 5. *Thin-evidence assumptions* — if no mixed-operation item is observed, the mixed demand is inferred from the corpus's unlabeled stems across parents; stated here. |

---

## Reference

Stein, M., Kinder, D., Silbert, J., & Carnine, D. (2017). *Direct Instruction Mathematics* (5th ed.). Pearson.
Lesson Granularity & Modeling Scope BrainLift — split/don't-split criteria, tie-breakers, Editing Splits, minimum viable modeling, I Do → We Do vary/hold-constant, explicit modeling vs. extension.
