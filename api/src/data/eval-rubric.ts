// The built-in Scope Evaluation rubric — the columns of the evaluation table,
// verbatim from the SME rubric (2026-07-10, replacing the Google Sheet as the
// source of truth). The agent scores every 'rubric' column band-by-band; the
// 'results' columns are computed; the 'sme' columns belong to the human and
// are never written by the pipeline.
//
// One deliberate reconciliation from the sheet original: its verdict formula
// said "all five hard gates" while SIX columns were gate-marked — the
// built-in verdict rule reads "all hard gates" and counts the marked set
// (New Learning, Released Items, Standard Coverage, DI Compliance,
// Unit Organization, Order of Lessons).

export interface EvalRubricColumn {
  /** Group band, e.g. 'Lesson-Specific Fields'. */
  group: string
  /** Display heading, e.g. 'New Learning'. */
  heading: string
  /** The full rubric text the agent scores against ('' for admin/results/sme columns with self-evident content). */
  rubric: string
  hardGate: boolean
  role: 'admin' | 'rubric' | 'results' | 'sme'
}

/** PASS — GOOD requires every hard gate at 3 AND the average at or above this. */
export const EVAL_GOOD_AVERAGE = 2.7

const admin = (heading: string, rubric = ''): EvalRubricColumn => ({
  group: 'Administrative Details',
  heading,
  rubric,
  hardGate: false,
  role: 'admin',
})
const lesson = (heading: string, rubric: string, hardGate = false): EvalRubricColumn => ({
  group: 'Lesson-Specific Fields',
  heading,
  rubric,
  hardGate,
  role: 'rubric',
})
const course = (heading: string, rubric: string, hardGate = false): EvalRubricColumn => ({
  group: 'Course-Specific Fields',
  heading,
  rubric,
  hardGate,
  role: 'rubric',
})
const results = (heading: string, rubric = ''): EvalRubricColumn => ({
  group: 'Results',
  heading,
  rubric,
  hardGate: false,
  role: 'results',
})
const sme = (heading: string): EvalRubricColumn => ({ group: 'SME', heading, rubric: '', hardGate: false, role: 'sme' })

export const EVAL_RUBRIC_COLUMNS: EvalRubricColumn[] = [
  admin('Date Created'),
  admin('Standard Set'),
  admin('Course, Standard, or Topic'),
  admin('JSON', 'Link to the full generated scope document.'),

  lesson(
    'Lesson Metadata',
    `[Subject · Course · Standard Set · Standard ID · Standard Description · Substandard · Lesson Title · Unit Number · Unit Name · Lesson Order]

Scope Alignment: Subject, Course, and Standard Set match the requested scope and the published framework used to generate the lesson.
Standard Identification: Standard ID uses the canonical format (<Set Prefix>.<Code>) and resolves to a valid node in the parsed standards tree.
Standard Reference: Standard Description is the official wording for that exact Standard ID. When the lesson covers only part of a standard, it accurately reflects the specific sub-part.
Substandard Quality: Substandard is a single, verb-led, teachable behavior that distinguishes this lesson from neighboring atoms. It is not tied to a particular assessment item, wording, or response format.
Lesson Naming: Lesson Title is the shortest verb-led description that uniquely identifies the lesson. Constraints are included only when needed to distinguish sibling lessons. Avoid pedagogical filler (e.g., Introduction to, Explore, Practice).
Sequence Integrity: Unit Number, Unit Name, and Lesson Order correctly reflect the lesson's position in the generated sequence, with no duplicate or missing lesson positions.

Note: This criterion evaluates identity, naming, and structural coherence only. Verification of official standard wording, assessment boundaries, and verbatim standard fidelity is evaluated under Standard Coverage.

Scoring
3 — Pass (Good): Every field is present, internally consistent, and resolvable. Titles and Substandards alone are sufficient to reconstruct the course map, with each sibling lesson clearly distinguishable.
2 — Pass (Good Enough): Only cosmetic issues are present (e.g., capitalization or formatting inconsistencies, or a Lesson Title containing one unnecessary constraint). Identity remains clear and unambiguous.
1 — Fail: One or more identity-breaking errors, including an invalid or unresolvable Standard ID, Standard Description that does not match the ID, indistinguishable sibling Lesson Titles, pedagogy filler in titles, a format-locked Substandard, or Unit/Order values that contradict the generated sequence.`,
  ),
  lesson(
    'Objectives',
    `Rubric: Verb-led observable objectives forming the minimal complete set — remove one and mastery is underspecified, add one and it's redundant. No 'understand.' No accuracy percentages or rates anywhere. Fluency flagged only when the standard's wording demands it, with the trigger cited.

Scoring
3 = Pass–Good: Passes all four checks; the set survives the remove-one/add-one test against the boundary. | 2 = Pass–Good Enough: A redundant-but-harmless objective, noted. | 1 = Fail: An unobservable verb, any threshold, or an under/over-specified set.`,
  ),
  lesson(
    'Major/Supporting',
    `*If applicable

Rubric: The field reports the standard's weight under the framework's OWN emphasis source — never guessed. When the framework provides no emphasis source, 'not designated' is the accurate value. Scale: Accurate = matches the declared emphasis source (or correctly reads 'not designated'). Inaccurate = wrong or guessed designation — counts as a FAIL in the verdict.`,
  ),
  lesson(
    'Progression Placement',
    `Rubric: Two layers, both right: the cross-grade story matches the progression documents, and the in-course layer names the exact previous and next lessons in the skill chain — pointers that are real and truly adjacent. 3 = Pass–Good: All claims sourced to progression pages; all pointers resolve and are adjacent. | 2 = Pass–Good Enough: A pointer off by one position; the chain still valid. | 1 = Fail: A fabricated progression claim or a dangling pointer.`,
  ),
  lesson(
    'Prerequisites',
    `Rubric: Every prerequisite tagged taught-in-course (naming an earlier, real lesson) or prior-grade (activatable in under two minutes — M(0) material). In-course gaps get preskill lessons before their consumers. Prerequisite reteaching is never embedded inside this lesson. 3 = Pass–Good: All tags resolve and precede; no embedded reteaching; prior-grade entries genuinely activatable. | 2 = Pass–Good Enough: An imprecise pointer (right lesson, stale number); order still valid. | 1 = Fail: A prerequisite consumed before taught, embedded reteaching, or an out-of-scope preskill.`,
  ),
  lesson(
    'Assessment Boundaries',
    `Rubric: Included/Excluded lists carry concrete parameters — number ranges, forms, response types, step counts. Every exclusion forwards to a named lesson that exists. No contradiction with Objectives or the Difficulty Ceiling. 3 = Pass–Good: Concrete, resolvable, consistent. | 2 = Pass–Good Enough: A forward pointing to the right lesson under an outdated number. | 1 = Fail: A vague boundary ('simple problems'), a dangling forward, or a contradiction.`,
  ),
  lesson(
    'New Learning',
    `◆ HARD GATE ◆
Rubric: The atom triple: exactly one start cue, one decision path, one observable response form — and the lesson adds exactly one new capability. Students never choose between procedures inside the lesson. 3 = Pass–Good: Clean triple; all objectives exercise the same routine. | 2 = Pass–Good Enough: Triple complete; one element loosely phrased with one dominant reading, noted. | 1 = Fail: A missing triple element or two decision paths. | AUTO-FAIL: the lesson teaches two independent new behaviors.`,
    true,
  ),
  lesson(
    'Instructional Approaches',
    `Rubric: Exactly one named strategy, selected per Stein and cited. Representations and manipulatives come only after the algorithm, framed as interpretations — never parallel methods. The modeling plan names modeled vs. practice-only cases and what varies vs. holds constant. Documented error patterns get explicit contrast-case modeling. 3 = Pass–Good: One strategy, doctrine-cited; every documented fossilizing error modeled with contrasts. | 2 = Pass–Good Enough: Plan complete; vary/hold-constant left implicit, noted. | 1 = Fail: A method menu, a representation offered as an alternative computation, or a documented error left to practice.`,
  ),
  lesson(
    'Non-Goals',
    `Rubric: Drift protection: the things an author could plausibly wander into but must not teach yet — each exclusion cited and forwarded to the named future lesson where it lives, and that lesson exists. 3 = Pass–Good: Plausible drifts covered; every forward cited and resolvable. | 2 = Pass–Good Enough: Drifts covered; one forward under an outdated number. | 1 = Fail: A missing obvious drift, an uncited exclusion, or a dangling forward.`,
  ),
  lesson(
    'Difficulty Ceiling',
    `Rubric: The hardest legitimate case in concrete parameters with a shape example — never past the standard's limits, calibrated to released-item rigor (or a cited anticipated-evidence inference), and consistent with the boundary. 3 = Pass–Good: Concrete, within limits, rigor-matched, shape example present. | 2 = Pass–Good Enough: Correct but missing the shape example. | 1 = Fail: Past the standard's limits, softer than an in-boundary placed item (rigor leak), or stated abstractly.`,
  ),
  lesson(
    'Released Items',
    `◆ HARD GATE ◆
Rubric: Placement + provenance. Every placed item passes Condition A (target demand = this lesson's objective: same capability, decision path, response form) and Condition B (every embedded demand ∈ M(L), the rebuilt ledger); multi-atom items sit only at bridge/application lessons, at the earliest eligible lesson. Items captioned test · year · question number with resolving screenshot links; alignment tagged Official only where the authority maps it, else AI-Inferred. The field is never empty. 3 = Pass–Good: All items pass both conditions at the earliest eligible lesson; metadata complete, links live. | 2 = Pass–Good Enough: Conditions pass; an item placed later than earliest-eligible or with a weak one-line justification, noted. | 1 = Fail: A target mismatch, an empty field, a dead official link, or a mislabeled alignment. | AUTO-FAIL: a placed item with an embedded demand outside M(L).`,
    true,
  ),
  lesson(
    'Generated Item Quality',
    `Rubric: Every generated item labeled 'Generated exemplar — not a released item'; mirrors state conventions (stem, response format, distractor logic); draws every demand from M(L); distractors built from taught error patterns; full state rigor at lesson scope — smaller scope, never softer demand; << >> alt-text on stimuli; solved answer key verified correct. If the lesson carries only released items, enter 3 and note 'n/a — released only.' 3 = Pass–Good: All generated items pass all seven checks. | 2 = Pass–Good Enough: Thin alt-text; everything else clean. | 1 = Fail: Missing label, an untaught demand, an untaught-skill distractor, or a missing/incorrect answer key.`,
  ),
  lesson(
    'Granularity of Scope',
    `Rubric: This lesson is exactly one atom — not two capabilities bundled, not a fragment of one. Its boundaries with sibling lessons are justified by named split criteria with cited evidence; no split rests only on bigger numbers, context, or formatting; the Decision Record defends why this granularity and not more or less. 3 = Pass–Good: Boundaries criterion-tagged and cited; the granularity defense holds both directions. | 2 = Pass–Good Enough: A thin-but-plausible justification on one boundary, noted with a strengthening directive. | 1 = Fail: An unjustified split, a bundled composite, or a merge across a hard criterion without a logged override.`,
  ),

  course(
    'Standard Coverage',
    `◆ HARD GATE ◆
Rubric: Every in-scope content standard and every teachable sub-part of those standards appears in at least one lesson, with no omissions, duplicates masquerading as coverage, or orphaned standards. Collectively, the lesson sequence provides complete coverage of the requested standards framework and leaves no gaps in the curriculum.

3 = Pass–Good: Complete census coverage of every in-scope standard and sub-part; no gaps or orphaned content.
2 = Pass–Good Enough: Complete coverage achieved; only minor organizational or sequencing issues.
1 = Fail: One or more in-scope standards or teachable sub-parts are missing, or coverage is incomplete.
AUTO-FAIL: Any requested content standard or teachable sub-part is not represented by at least one lesson.`,
    true,
  ),
  course(
    'DI Compliance',
    `◆ HARD GATE ◆
Rubric: The doctrine, cross-cutting: preskills before the composites that consume them; the sacrificial first instance (easiest sibling first, full modeling; later siblings reduced-modeling transfer); confusables separated in time and recombined only at a bridge that teaches discrimination alone — no new math; application tiers add no new procedures and inherit boundary/ceiling from parents; explicit modeling where errors fossilize; strategy selection cites Stein; consequential decisions carry resolvable citations (spot-check quotes against the corpus). 3 = Pass–Good: All doctrine commitments visible on the card; citations resolve and match. | 2 = Pass–Good Enough: Doctrine holds; a citation with locator drift (right document/section, page off). | 1 = Fail: A bridge modeling new rules, an application adding a procedure, or a doctrine commitment plainly violated. | AUTO-FAIL: a fabricated citation, or new mathematics modeled in a bridge/application lesson.`,
    true,
  ),
  course(
    'Unit Organization',
    `◆ HARD GATE ◆
Rubric: The lesson belongs to its unit's strand and visible skill chain — builds from nearby lessons, prepares for upcoming ones. The unit is a strand-coherent block, not a thin spiral, with a rationale traceable to the framework's emphasis statements or progression streams. NOTE — distributed interleaving is NOT spiraling (engine Ordering rule 10, Interleaving After Dependency): a strand may legitimately appear as multiple NON-ADJACENT units (Place Value A → Multiplication A → Place Value B) when each unit is internally a coherent strand-block and the alternation respects prerequisites; judge each unit's INTERNAL coherence, and treat a strand revisit as spiraling only when the units involved are NOT coherent blocks (thin scatter). 3 = Pass–Good: In-strand, in-chain, rationale cited. | 2 = Pass–Good Enough: In-strand; the chain link to a neighbor stated loosely, noted. | 1 = Fail: A stranded atom outside its unit's chain, a mixed-strand unit without a defended rationale, or a missing rationale.`,
    true,
  ),
  course(
    'Order of Lessons',
    `◆ HARD GATE ◆
Rubric: Everything this lesson consumes exists in M(L−1) or M(0) — verify against the independently rebuilt Cumulative Mastery Ledger, not the tool's own. Concepts precede procedures; explicit instruction precedes application; generalize before extend; the lesson's position is defensible against every ordering principle. 3 = Pass–Good: Zero forward references; all ordering principles hold at this position. | 2 = Pass–Good Enough: A defended soft-order deviation (e.g., generalize-before-extend), cited in the Decision Record. | 1 = Fail: The lesson consumes knowledge outside M(L−1)+M(0), or explicit instruction arrives after the application that needs it. | AUTO-FAIL: a forward dependency.`,
    true,
  ),

  results('# of Fails'),
  results('Hard Gate Fails'),
  results('Average Score'),
  results(
    'Automatic Verdict',
    `Choose exactly one:
FAIL — If any category is scored 1, or Major/Supporting is Inaccurate.
PASS — GOOD — If no category is scored 1, all hard gates are scored 3, and the overall average is ≥ 2.70.
PASS — GOOD ENOUGH — Otherwise (i.e., the run passes but does not meet the criteria for PASS — GOOD).`,
  ),
  results(
    'AI-QC Notes',
    `Provide detailed justification for every cell that received a rating of Pass – Good Enough or Fail. For each, explain the evidence supporting the score and the changes required to achieve Pass – Good.`,
  ),

  sme('SME'),
  sme('SME Verdict'),
  sme('SME Notes'),
]

export const EVAL_RUBRIC_BANDS = {
  lesson: EVAL_RUBRIC_COLUMNS.filter((c) => c.role === 'rubric' && c.group === 'Lesson-Specific Fields'),
  course: EVAL_RUBRIC_COLUMNS.filter((c) => c.role === 'rubric' && c.group === 'Course-Specific Fields'),
}

export const EVAL_HARD_GATES = EVAL_RUBRIC_COLUMNS.filter((c) => c.hardGate)

/** The row columns an evaluation stores/exports (everything except the human's SME columns). */
export const EVAL_ROW_COLUMNS = EVAL_RUBRIC_COLUMNS.filter((c) => c.role !== 'sme')
