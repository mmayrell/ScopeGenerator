import { CardField, Lesson, QcCriterion, QcDeckCard, QcPlanStep } from '../domain/types'

// The QC Bar's factory contents (spec: "ships pre-loaded with about 30
// criteria covering completeness, citation accuracy, one-skill-per-lesson
// discipline, unambiguous boundaries, solvable examples, course coverage, and
// sequencing"). Everything here is a STARTING POINT the user tightens,
// loosens, rewrites, adds to, or switches off on the Bar page — the stored
// bar document is the authority from its first save.

const stats = () => ({ firstDraftFails: 0, judgedLessons: 0, redFlagInvolvements: 0 })

const auto = (
  id: string,
  title: string,
  rule: string,
  level: 'lesson' | 'course',
  severity: 'blocking' | 'advisory',
  shownToWriter = true,
): QcCriterion => ({ id, title, rule, level, method: 'automatic', autoCheckId: id, severity, shownToWriter, enabled: true, stats: stats() })

const judged = (
  id: string,
  title: string,
  rule: string,
  level: 'lesson' | 'course',
  severity: 'blocking' | 'advisory',
  shownToWriter = true,
): QcCriterion => ({ id, title, rule, level, method: 'ai-judged', severity, shownToWriter, enabled: true, stats: stats() })

export const DEFAULT_CRITERIA: QcCriterion[] = [
  // ---- Lesson level · automatic (mechanical checks in pipeline/qc-bar.ts) ----
  auto('fields-complete', 'Every field filled', 'Fail if any card field is empty, or any field lacks its Decision Record rationale.', 'lesson', 'blocking'),
  auto('card-entries-present', 'Card entries present', 'Fail if the substandard, objectives, student-friendly title, or either card-level rationale (sequencing / granularity) is missing.', 'lesson', 'blocking'),
  auto('citation-resolution', 'Citations resolve', 'Fail if a cited standard code does not exist in the standard set.', 'lesson', 'blocking'),
  auto('quote-fidelity', 'Quotes are verbatim', 'Fail if a quote-wrapped excerpt cannot be located in its cited source (standards tree, engine/doctrine corpus, or item bank). Attribute-shaped metadata excerpts are exempt.', 'lesson', 'blocking'),
  auto('item-refs-resolve', 'Item references resolve', 'Fail if a referenced released item does not exist in the Repository.', 'lesson', 'blocking'),
  auto('assessment-phrasing', 'Assessment evidence phrasing', 'Fail if Assessment Evidence is not phrased "Students are able to:", or contains a percentage or rate (P8).', 'lesson', 'blocking'),
  auto('exemplar-labels', 'Generated exemplars labeled', 'Fail if a generated exemplar lacks its "Generated exemplar — not a released item" label.', 'lesson', 'blocking'),
  auto('title-filler', 'No pedagogy filler in titles', 'Fail if a title opens with pedagogy filler ("Introduction to", "Understanding", "Exploring", "Fun with"…). Titles name the teachable behavior.', 'lesson', 'advisory'),
  auto('math-language', 'Mathematical language style', 'Flag older-practice math language from the Mathematical Language Style Guide watch list (borrow, top/bottom number, keep-change-flip…). Bridge wording must pair promptly with the precise term.', 'lesson', 'advisory'),
  // ---- Lesson level · AI-judged ----
  judged('one-skill-per-lesson', 'One skill per lesson', 'Fail if the New Learning triple encodes more than one start cue, decision path, or response form, or the objectives bundle more than one distinct teachable skill — a fake atom or a hidden second lesson.', 'lesson', 'blocking'),
  judged('unambiguous-boundary', 'Boundary reads one way', 'Fail if the Assessment Boundary permits more than one defensible reading. Write out your own reading(s) of the boundary BEFORE ruling; if two readings exist, quote both as evidence.', 'lesson', 'blocking'),
  judged('solvable-examples', 'Examples solvable as taught', 'Work every exemplar and referenced item yourself before ruling. Fail if any is unsolvable within the boundary, exceeds the ceiling, requires an untaught skill, yields to a shortcut bypassing the named strategy, or has a wrong answer key.', 'lesson', 'blocking'),
  judged('ceiling-inside-boundary', 'Ceiling inside the boundary', 'Fail if the Difficulty Ceiling describes a case the Assessment Boundary excludes — the ceiling is the hardest INCLUDED case, never new content.', 'lesson', 'blocking'),
  judged('claim-support', 'Claims match their citations', 'Read each consequential claim against the citation attached to it. Fail if a citation does not support the claim it is attached to, or the claim overreaches what the cited wording licenses.', 'lesson', 'blocking'),
  judged('single-strategy', 'Single named strategy', 'Fail if the Instructional Approach teaches more than one strategy, lacks a named strategy, or is missing its Example Progression (Modeled Set · Delayed Modeling Cases · Vary/Hold Constant) on a teaching lesson.', 'lesson', 'blocking'),
  judged('inference-honesty', 'Evidence badges honest', 'Flag content presented as observed without in-boundary released-item evidence, or inferred content missing its recorded basis.', 'lesson', 'advisory'),
  judged('prereq-tags', 'Prerequisites tagged and named', 'Flag prerequisites not tagged taught-in-course (naming the lesson) or prior-grade.', 'lesson', 'advisory'),
  judged('boundary-forwards', 'Exclusions have homes', 'Flag an Excluded performance with no forward to the lesson that includes it and no grade-level exclusion citation.', 'lesson', 'advisory'),
  judged('ceiling-concrete', 'Ceiling stated concretely', 'Flag a Difficulty Ceiling without concrete parameters (number ranges, step counts, representation load) — "harder problems" is not a ceiling.', 'lesson', 'advisory'),
  judged('objectives-minimal-complete', 'Objectives minimal-complete', 'Flag objectives that are redundant with each other or that together fail to define mastery of the atom.', 'lesson', 'advisory'),
  // ---- Course level · automatic ----
  auto('coverage-census', 'Every sub-part taught', 'Fail if any most-granular content sub-part of the covered grades maps to no lesson (course-mode scopes). A dropped sub-part is never a warning.', 'course', 'blocking'),
  auto('prereq-order', 'Prerequisites precede consumers', 'Fail if a taught-in-course prerequisite appears after the lesson that needs it, or the prerequisite graph has a cycle.', 'course', 'blocking'),
  auto('included-disjoint', 'Sibling boundaries disjoint', 'Fail if two lessons in one unit include the identical performance — every Included behavior has exactly one owner.', 'course', 'blocking'),
  auto('lesson-traces-standard', 'Every lesson traces to a standard', 'Fail if a lesson carries no recognizable framework code in its standards/substandard fields.', 'course', 'blocking'),
  // ---- Course level · AI-judged ----
  judged('no-overlap', 'No duplicate teaching', 'Fail if two lessons teach the same skill at the same grain — name both cards and quote the overlapping content.', 'course', 'blocking'),
  judged('sequence-consumption', 'Skills consumed after taught', 'Walk each lesson\'s decision path against everything taught before it. Fail if a consumed skill sits ahead of the lesson or is untagged as prior-grade.', 'course', 'blocking'),
  judged('strand-coherence', 'Units are coherent arcs', 'Flag a unit that is not an internally coherent strand block, or strand alternation with no documented interleaving rationale (Ordering rule 10 — distributed interleaving is not spiraling).', 'course', 'advisory'),
  judged('progression-chains', 'Progression chains coherent', 'Flag a lesson whose within-course chain (the lessons before/after in its skill line) contradicts its progression placement text.', 'course', 'advisory'),
]

/** Default escalation plan (spec Step 3): revise ×2 → fresh start → revise ×2. Editable on the Bar page. */
export const DEFAULT_PLAN: QcPlanStep[] = ['revise', 'revise', 'fresh-start', 'revise', 'revise']

// ---------------------------------------------------------------------------
// The built-in test deck — deliberately broken cards, each labeled with what
// the bar should catch. Compact but structurally complete lessons.
// ---------------------------------------------------------------------------

const f = (content: string, rationale = 'Deck fixture rationale.'): CardField => ({ content, citations: [], rationale })

const deckLesson = (id: string, title: string, overrides: Partial<Record<keyof Lesson['fields'], CardField>>, extra?: Partial<Lesson>): Lesson => ({
  id,
  title,
  studentFriendlyTitle: title,
  type: 'new-learning',
  evidenceStatus: 'inferred',
  fields: {
    standards: f('3.NBT.A.2 — Fluently add and subtract within 1000.'),
    cluster: f('3.NBT.A — Use place value understanding and properties of operations.'),
    substandard: f('Add two 3-digit numbers with one regrouping.'),
    objectives: f('Students are able to: 1) add two 3-digit numbers requiring one regrouping.'),
    emphasis: f('Major work of the grade.'),
    progression: f('Follows 2-digit addition; precedes subtraction with regrouping.'),
    prerequisites: f('Place-value understanding of tens and ones — prior-grade.'),
    boundary: f('Included: sums within 1000, exactly one regrouping. Excluded: two regroupings (taught in the next lesson).'),
    newLearning: f('Start cue: two 3-digit addends written vertically. Decision path: add ones, regroup ten ones as one ten when the column sum exceeds 9, add tens, add hundreds. Response form: numeric entry.'),
    approach: f('Single strategy: standard addition algorithm. Modeled Set: 246+128 modeled fully. Delayed Modeling Cases: none. Vary: which column regroups. Hold constant: 3-digit addends, one regrouping.'),
    nonGoals: f('Do not teach two-regrouping cases yet (next lesson).'),
    ceiling: f('Hardest case: 3-digit + 3-digit with one regrouping in the tens column.'),
    assessment: f('Students are able to: add two 3-digit numbers with one regrouping given vertical format.'),
    releasedItems: f('Generated exemplar — not a released item: 358 + 217 = ? Key: 575.'),
    ...overrides,
  },
  itemRefs: [],
  sequencingRationale: 'Deck fixture.',
  granularityRationale: 'Deck fixture.',
  decisions: [],
  ...extra,
})

/**
 * The evidence context deck tests run against — the fixtures cite these
 * codes, so quote-fidelity and citation-resolution can actually fire (an
 * empty tree would vacuously pass the miscited-quote card forever).
 */
export const DECK_CONTEXT_SET = {
  tree: [
    {
      code: '3.NBT.A',
      norm: '3.NBT.A',
      label: 'Use place value understanding and properties of operations to perform multi-digit arithmetic.',
      children: [
        {
          code: '3.NBT.A.1',
          norm: '3.NBT.A.1',
          wording: 'Use place value understanding to round whole numbers to the nearest 10 or 100.',
        },
        {
          code: '3.NBT.A.2',
          norm: '3.NBT.A.2',
          wording:
            'Fluently add and subtract within 1000 using strategies and algorithms based on place value, properties of operations, and/or the relationship between addition and subtraction.',
          fluency: true,
        },
      ],
    },
  ],
  items: [],
  warnings: [],
}

export const DEFAULT_DECK: QcDeckCard[] = [
  {
    id: 'deck-miscited-quote',
    label: 'Miscited quote: the standards excerpt is fabricated — no such sentence exists in the cited standard.',
    expectedCriterionIds: ['quote-fidelity', 'claim-support'],
    lesson: deckLesson('DECK.L1', 'Add 3-Digit Numbers With One Regrouping', {
      boundary: {
        content: 'Included: sums within 1000, one regrouping. Excluded: multi-step word problems.',
        citations: [
          {
            sourceType: 'standards',
            label: '3.NBT.A.2',
            locator: '3.NBT.A.2',
            excerpt: '“Students must add using concrete manipulatives before any written algorithm is permitted.”',
          },
        ],
        rationale: 'Boundary from the standard\'s own limit clause.',
      },
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
  {
    id: 'deck-two-skills',
    label: 'Two skills in one objective: addition AND subtraction bundled into one atom.',
    expectedCriterionIds: ['one-skill-per-lesson'],
    lesson: deckLesson('DECK.L2', 'Add and Subtract 3-Digit Numbers', {
      objectives: f('Students are able to: 1) add two 3-digit numbers with regrouping; 2) subtract two 3-digit numbers with regrouping across zeros.'),
      newLearning: f('Start cue: a 3-digit addition or subtraction problem. Decision path: decide whether to add or subtract, then apply the matching algorithm with regrouping. Response form: numeric entry.'),
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
  {
    id: 'deck-ambiguous-boundary',
    label: 'Ambiguous boundary: "larger numbers" permits at least two readings.',
    expectedCriterionIds: ['unambiguous-boundary'],
    lesson: deckLesson('DECK.L3', 'Round to the Nearest Ten', {
      boundary: f('Included: rounding numbers to the nearest ten. Excluded: larger numbers and harder cases.'),
      ceiling: f('Hardest case: rounding a number when it is difficult.'),
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
  {
    id: 'deck-missing-fields',
    label: 'Missing fields: empty non-goals and no ceiling.',
    expectedCriterionIds: ['fields-complete'],
    lesson: deckLesson('DECK.L4', 'Multiply by Multiples of Ten', {
      nonGoals: f(''),
      ceiling: { content: '', citations: [] },
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
  {
    id: 'deck-percentage-mastery',
    label: 'Quantitative mastery threshold: assessment evidence carries "80% accuracy" (P8 violation).',
    expectedCriterionIds: ['assessment-phrasing'],
    lesson: deckLesson('DECK.L5', 'Tell Time to the Nearest Minute', {
      assessment: f('Students demonstrate mastery by answering 8 of 10 items correctly (80% accuracy rate).'),
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
  {
    id: 'deck-wrong-key',
    label: 'Unsolvable exemplar: the answer key is wrong (356 + 217 = 573, not 583).',
    expectedCriterionIds: ['solvable-examples'],
    lesson: deckLesson('DECK.L6', 'Add 3-Digit Numbers With One Regrouping', {
      releasedItems: f('Generated exemplar — not a released item: 356 + 217 = ? Key: 583.'),
    }, {
      generatedExemplars: [
        { stem: '356 + 217 = ?', answer: '583', demandProfile: 'bare 3-digit addition, one regrouping', basis: 'Deck fixture.' },
      ],
    }),
    source: 'built-in',
    added: '2026-07-17',
  },
]
