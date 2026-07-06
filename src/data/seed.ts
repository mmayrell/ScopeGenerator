import type {
  Citation,
  ItemRecord,
  Lesson,
  Scope,
  StandardSet,
} from '../types'
import { ccssG4Tree, teksG6Tree } from './trees'

// ---------- shared citations ----------

const cite = (
  sourceType: Citation['sourceType'],
  label: string,
  locator: string,
  excerpt: string,
): Citation => ({ sourceType, label, locator, excerpt })

const C = {
  std45: cite(
    'standards',
    'CCSS 4.NBT.B.5',
    'p. 29',
    '“Multiply a whole number of up to four digits by a one-digit whole number, and multiply two two-digit numbers, using strategies based on place value and the properties of operations.”',
  ),
  std45illustrate: cite(
    'standards',
    'CCSS 4.NBT.B.5',
    'p. 29',
    '“Illustrate and explain the calculation by using equations, rectangular arrays, and/or area models.”',
  ),
  nbtLimit: cite(
    'standards',
    'CCSS Grade 4 NBT footnote',
    'p. 29 fn. 1',
    '“Grade 4 expectations in this domain are limited to whole numbers less than or equal to 1,000,000.”',
  ),
  cluster45: cite(
    'standards',
    'CCSS 4.NBT.B',
    'p. 29',
    '“Use place value understanding and properties of operations to perform multi-digit arithmetic.”',
  ),
  es451: cite(
    'decomposition',
    'Evidence Statement 4.NBT.5-1',
    'CCSSO 2019, Tab G4',
    'Key 4.NBT.5-1: multiply a whole number of up to four digits by a one-digit whole number. Clarification: tasks do not have a context.',
  ),
  es452: cite(
    'decomposition',
    'Evidence Statement 4.NBT.5-2',
    'CCSSO 2019, Tab G4',
    'Key 4.NBT.5-2: multiply two two-digit numbers. Clarification: tasks do not have a context.',
  ),
  subclaimA: cite(
    'decomposition',
    'Emphasis source: sub-claim A',
    'CCSSO 2019, blueprint col.',
    'Sub-claim A (major content), Grade 4 point allocation 21/52.',
  ),
  progNBT: cite(
    'interpretive',
    'UA Progressions, NBT K–5',
    'pp. 14–15',
    'Grade 4 students extend single-digit products to multi-digit; the standard algorithm for multi-digit × multi-digit is a Grade 5 fluency expectation.',
  ),
  progNBTzero: cite(
    'interpretive',
    'UA Progressions, NBT K–5',
    'p. 15',
    'Worked example shows recording of a product with an internal-zero multiplicand; students commonly drop the placeholder.',
  ),
  stein: cite(
    'doctrine',
    'Stein et al. 2017, DI Mathematics',
    'ch. 9, Multiplication',
    'Teach the standard algorithm as the single strategy; representations follow as interpretations of the algorithm, never as parallel computation paths.',
  ),
  steinZero: cite(
    'doctrine',
    'Stein et al. 2017',
    'ch. 9, error patterns',
    'Zeros within the multiplicand are a documented, fossilization-prone error pattern; model explicitly.',
  ),
  engineA2: cite(
    'engine',
    'Compiled procedure A2',
    'Appendix A',
    'Split on a new/hidden decision step changing the routine.',
  ),
  engineA5: cite(
    'engine',
    'Compiled procedure A5',
    'Appendix A',
    'Model explicitly on fossilization-prone errors; extension where same strategy, no new steps.',
  ),
  engineEdit: cite(
    'engine',
    'Editing Splits constraint',
    'Appendix A, A3',
    'Errors justify a split only on a new/unstable start cue, a new decision step or rule, or a missing prerequisite — otherwise fix modeling inside the atom.',
  ),
  adminNotes: cite(
    'admin-notes',
    'Admin usage notes (items corpus)',
    'NY uploads',
    '“NY releases ~75% of operational forms; treat as sample, not census.”',
  ),
}

// ---------- item bank ----------

const items: ItemRecord[] = [
  {
    id: 'it-ny23-17',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test',
    year: 2023,
    itemNumber: 17,
    alignmentCode: '4.NBT.5',
    confidence: 'official',
    completeness: 0.97,
    itemType: 'selected-response',
    responseFormat: 'multiple choice, numeric answer',
    representations: [],
    problemTypes: ['bare computation'],
    demandProfile: '4-digit × 1-digit, regrouping in two positions, bare stem, answer-only',
    scopeClass: 'in-boundary',
    hasKey: true,
    stem: 'What is the product of 2,364 × 7?',
    choices: ['14,548', '16,548', '16,948', '17,248'],
  },
  {
    id: 'it-ma22-9',
    source: 'MCAS Released Items 2018–2023',
    test: 'Massachusetts MCAS, Spring',
    year: 2022,
    itemNumber: 9,
    alignmentCode: '4.NBT.5',
    confidence: 'official',
    completeness: 0.93,
    itemType: 'selected-response',
    responseFormat: 'multiple choice',
    representations: [],
    problemTypes: ['thin-context'],
    demandProfile: '3-digit × 1-digit, consecutive regroupings, one-sentence context',
    scopeClass: 'in-boundary',
    hasKey: true,
    stem: 'A school orders 6 boxes of markers. Each box holds 385 markers. How many markers does the school order in all?',
    choices: ['1,810', '2,110', '2,310', '2,410'],
  },
  {
    id: 'it-ny24-31',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test',
    year: 2024,
    itemNumber: 31,
    alignmentCode: '4.NBT.5',
    confidence: 'confirmed',
    completeness: 0.81,
    itemType: 'constructed-response',
    responseFormat: 'gridded numeric response',
    representations: [],
    problemTypes: ['bare computation'],
    demandProfile: '4-digit × 1-digit with internal zero, regrouping in three positions',
    scopeClass: 'in-boundary',
    hasKey: false,
    stem: 'Multiply: 4,073 × 8 = ______',
  },
  {
    id: 'it-ny23-4',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test',
    year: 2023,
    itemNumber: 4,
    alignmentCode: '4.NBT.5',
    confidence: 'official',
    completeness: 0.95,
    itemType: 'selected-response',
    responseFormat: 'multiple choice',
    representations: ['area model'],
    problemTypes: ['bare computation'],
    demandProfile: '2-digit × 2-digit, partial-row alignment demand, area model shown as distractor support',
    scopeClass: 'in-boundary',
    hasKey: true,
    stem: 'Which expression shows the two partial products of 34 × 26?',
    choices: ['(34 × 6) + (34 × 2)', '(34 × 6) + (34 × 20)', '(30 × 26) + (4 × 6)', '(34 × 20) + (34 × 60)'],
  },
  {
    id: 'it-ma19-22',
    source: 'MCAS Released Items 2018–2023',
    test: 'Massachusetts MCAS, Spring',
    year: 2019,
    itemNumber: 22,
    alignmentCode: '4.NBT.5',
    confidence: 'official',
    completeness: 0.88,
    itemType: 'constructed-response',
    responseFormat: 'open response',
    representations: [],
    problemTypes: ['multi-step word problem'],
    demandProfile: '5-digit × 1-digit inside a two-step context — exceeds the four-digit wording',
    scopeClass: 'rigor-signal-only',
    hasKey: true,
    stem: 'A stadium sells 12,450 tickets for each of 4 concerts. The venue donates 2,500 tickets. How many tickets are sold in all after the donation?',
  },
  {
    id: 'it-ny22-8',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test (Grade 3)',
    year: 2022,
    itemNumber: 8,
    alignmentCode: '3.OA.7',
    confidence: 'official',
    completeness: 0.9,
    itemType: 'selected-response',
    responseFormat: 'multiple choice',
    representations: [],
    problemTypes: ['bare computation'],
    demandProfile: 'single-digit fact fluency (7 × 8)',
    scopeClass: 'adjacent-grade',
    hasKey: true,
    stem: 'What is 7 × 8?',
    choices: ['48', '54', '56', '63'],
  },
  {
    id: 'it-ny23-27',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test',
    year: 2023,
    itemNumber: 27,
    alignmentCode: '4.NBT.4',
    confidence: 'official',
    completeness: 0.94,
    itemType: 'selected-response',
    responseFormat: 'multiple choice',
    representations: [],
    problemTypes: ['bare computation'],
    demandProfile: '5-digit + 5-digit with regrouping across three columns',
    scopeClass: 'in-boundary',
    hasKey: true,
    stem: 'Add: 46,289 + 27,354',
    choices: ['63,533', '73,533', '73,643', '74,643'],
  },
  {
    id: 'it-ma22-14',
    source: 'MCAS Released Items 2018–2023',
    test: 'Massachusetts MCAS, Spring',
    year: 2022,
    itemNumber: 14,
    alignmentCode: '4.NF.1',
    confidence: 'ai-proposed',
    completeness: 0.72,
    itemType: 'selected-response',
    responseFormat: 'multiple choice with fraction models',
    representations: ['area model', 'fraction strip'],
    problemTypes: ['comparison'],
    demandProfile: 'recognize an equivalent fraction pair using n/n scaling, denominators from the Grade 4 list',
    scopeClass: 'in-boundary',
    hasKey: false,
    stem: 'Which fraction is equivalent to 3/4?',
    choices: ['6/8', '4/3', '9/16', '30/44'],
  },
  {
    id: 'it-ny21-12',
    source: 'NY State Released Items 2021–2024',
    test: 'New York Mathematics Test',
    year: 2021,
    itemNumber: 12,
    alignmentCode: '4.OA.3',
    confidence: 'official',
    completeness: 0.91,
    itemType: 'constructed-response',
    responseFormat: 'open response with explanation',
    representations: [],
    problemTypes: ['multi-step word problem'],
    demandProfile: 'two-operation word problem, multiplication then subtraction, interpret a remainder',
    scopeClass: 'in-boundary',
    hasKey: true,
    stem: 'Mr. Ruiz buys 8 packs of 24 pencils and gives 35 pencils away. How many pencils does he have left? Show your work.',
  },
]

// ---------- standard sets ----------

export const seedSets: StandardSet[] = [
  {
    id: 'set-ccss-g4',
    name: 'CCSS Mathematics — Grade 4',
    subject: 'Mathematics',
    gradeSpan: 'Grade 4',
    hierarchyLevels: ['Grade', 'Domain', 'Cluster', 'Standard', 'Sub-part'],
    codingScheme: 'Canonical: 4.NBT.B.5 · Normalized join: 4.NBT.5 (cluster letter merged)',
    codingNotes:
      'Canonical IDs carry cluster letters (derivable from cluster order). Normalized join code grade.domain.number merges cluster letters, matching state item-map conventions.',
    emphasisSource: 'Evidence Statement sub-claim column (A → Major; B → Supporting/Additional)',
    published: true,
    updated: '2026-06-12',
    artifacts: [
      {
        id: 'a-std',
        role: 'standards',
        fileName: 'CCSSI_Math_Standards_ADA.pdf',
        usageNotes:
          'ADA-compliant tagged render — best-case parse target. Footnote limits are load-bearing: Grade 4 NBT ≤ 1,000,000; NF denominators 2,3,4,5,6,8,10,12,100.',
        reviewStatus: 'reviewed',
        meta: { tier: 1 },
      },
      {
        id: 'a-items-ny',
        role: 'items',
        fileName: 'NY_Released_2021-2024_G4.pdf',
        usageNotes: 'NY releases ~75% of operational forms; treat as sample, not census.',
        reviewStatus: 'reviewed',
        meta: {
          sourceDescription: 'NYSED annual releases, Grade 4',
          window: '2021–2024',
          coverage: 'sample',
          itemCount: 118,
          tier: 2,
        },
      },
      {
        id: 'a-items-ma',
        role: 'items',
        fileName: 'MCAS_Released_2018-2023_G4.pdf',
        usageNotes: '2024 administration was digital-only; no 2024 release exists. Sample coverage.',
        reviewStatus: 'reviewed',
        meta: {
          sourceDescription: 'MA DESE released items, Grade 4',
          window: '2018–2023',
          coverage: 'sample',
          itemCount: 96,
          tier: 2,
        },
      },
      {
        id: 'a-unpack',
        role: 'unpacking-structured',
        fileName: 'CCSSO_Evidence_Statements_2019_G4.xlsx',
        usageNotes:
          'Type I keys are the candidate-atom partition. Type II/III statements are demand bands, not content atoms. Int keys seed bridges.',
        reviewStatus: 'reviewed',
        meta: { tier: 1 },
      },
      {
        id: 'a-prog',
        role: 'progression',
        fileName: 'UA_Progressions_NBT_NF_OA.pdf',
        usageNotes:
          'Mine for placement, prerequisites, representation vocabulary, misconceptions. Method preferences are stance — inadmissible for Instructional Approach (P7).',
        reviewStatus: 'reviewed',
        meta: { domainGradeTags: ['NBT K–5', 'NF 3–5', 'OA K–5'], tier: 2 },
      },
    ],
    warnings: [
      {
        id: 'w-md',
        text: 'Domain × grade progression gap: MD (Measurement & Data) has no progression coverage in the uploaded corpus.',
        acknowledged: true,
      },
      {
        id: 'w-g',
        text: 'No item evidence for 4.G (Geometry) in either uploaded release window.',
        acknowledged: true,
      },
    ],
    tree: ccssG4Tree,
    items,
    lexicon: [
      { term: 'area model', aliases: ['rectangular area model', 'open array'], source: 'UA Progressions NBT p.15' },
      { term: 'base-ten blocks', aliases: ['place-value blocks'], source: 'item vision pass, NY 2022' },
      { term: 'comparison', aliases: ['compare problem'], source: 'CCSS glossary situation tables' },
      { term: 'equal groups', aliases: [], source: 'CCSS glossary situation tables' },
      { term: 'equation', aliases: ['number sentence'], source: 'CCSS glossary' },
      { term: 'fraction strip', aliases: ['fraction bar'], source: 'UA Progressions NF p.3' },
      { term: 'multi-step word problem', aliases: ['multistep contextual'], source: 'CCSS glossary situation tables' },
      { term: 'number line', aliases: ['number line diagram'], source: 'CCSS glossary' },
      { term: 'place-value chart', aliases: [], source: 'UA Progressions NBT p.6' },
      { term: 'rectangular array', aliases: ['array'], source: 'CCSS glossary' },
      { term: 'tape diagram', aliases: ['bar model', 'strip diagram'], source: 'CCSS glossary' },
    ],
  },
  {
    id: 'set-teks-g6',
    name: 'TEKS Mathematics — Grade 6',
    subject: 'Mathematics',
    gradeSpan: 'Grade 6',
    hierarchyLevels: ['Grade', 'Strand', 'Knowledge & Skills', 'Expectation'],
    codingScheme: 'Canonical: 6.3(C) · Normalized join: 6.3C',
    codingNotes: 'Codes like 6.3(C) normalize to 6.3C. Limits live in the wording’s including/excluding clauses.',
    emphasisSource: 'Readiness / Supporting designations (assessed-curriculum documents)',
    published: false,
    updated: '2026-07-01',
    artifacts: [
      {
        id: 't-std',
        role: 'standards',
        fileName: 'TEKS_Math_TAC111_G6.pdf',
        usageNotes: 'Including/excluding clauses in expectation wording carry full boundary force.',
        reviewStatus: 'reviewed',
        meta: { tier: 2 },
      },
      {
        id: 't-items-1',
        role: 'items',
        fileName: 'STAAR_G6_Released_2022-2025.pdf',
        usageNotes: 'Release-year forms are effectively complete → coverage: census.',
        reviewStatus: 'reviewed',
        meta: {
          sourceDescription: 'TEA STAAR released forms, Grade 6',
          window: '2022–2025',
          coverage: 'census',
          itemCount: 152,
          tier: 1,
        },
      },
      {
        id: 't-items-bad',
        role: 'items',
        fileName: 'STAAR_G4_Released_2023.pdf',
        usageNotes: '',
        reviewStatus: 'blocked',
        blockingError:
          'Detected grade contradicts declaration: source parses as a Grade 4 release but was uploaded to a Grade 6 set. Ingestion halted — re-upload or correct the declaration (P10 fit validation).',
        meta: { sourceDescription: 'TEA STAAR released form', window: '2023', coverage: 'unknown', tier: 1 },
      },
      {
        id: 't-va',
        role: 'progression',
        fileName: 'TEA_Vertical_Alignment_K-8.pdf',
        usageNotes: 'State vertical alignment charts; strand × grade tagged.',
        reviewStatus: 'parsed',
        meta: { domainGradeTags: ['Number & Operations K–8', 'Proportionality 6–8'], tier: 2 },
      },
    ],
    warnings: [
      {
        id: 'tw-1',
        text: 'No structured decomposition uploaded — sub-part fallback will be used as the candidate-atom partition.',
        acknowledged: false,
      },
      {
        id: 'tw-2',
        text: 'Proportionality strand has no progression coverage for Grade 6 in the uploaded documents.',
        acknowledged: false,
      },
    ],
    tree: teksG6Tree,
    items: [],
    lexicon: [],
  },
]

// ---------- lesson helpers ----------

const f = (content: string, citations: Citation[], inferred?: boolean) => ({
  content,
  citations,
  inferred,
})

// ---------- flagship lesson (spec Appendix B.1, verbatim shape) ----------

const flagship: Lesson = {
  id: 'U3.L3',
  title: 'Multiply Up to a Four-Digit Number by a One-Digit Number, Standard Algorithm',
  type: 'new-learning',
  locked: true,
  evidenceStatus: 'observed',
  fields: {
    standards: f(
      '4.NBT.B.5 (canonical) / 4.NBT.5 (normalized); governing key: 4.NBT.5-1 (up to four digits × one digit). Sibling key 4.NBT.5-2 (two-digit × two-digit) is a separate atom (U3.L4).',
      [C.std45, C.es451],
    ),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [
      C.cluster45,
    ]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: builds on Grade 3 single-digit products and multiplying by multiples of ten; leads to Grade 5 fluency with the standard algorithm for multi-digit × multi-digit. Within-course: follows U3.L2 (place-value products with multiples of ten); precedes U3.L4 (two-digit × two-digit) and U3.L6 (area-model interpretation of the algorithm).',
      [C.progNBT, cite('sequence', 'Generated sequence', 'Unit 3', 'U3.L2 → U3.L3 → U3.L4 → U3.L6 skill chain')],
    ),
    prerequisites: f(
      'Recalls single-digit multiplication facts (prior-grade); reads and writes numbers to 10,000 by place value (taught-in-course: U1.L3); adds multi-digit numbers with regrouping (prior-grade).',
      [
        cite('items', 'NY 2022 · Q8 (Grade 3)', 'below-grade evidence, D2', '7 × 8 fact-fluency item — prerequisite evidence for the multiplication chain.'),
        C.progNBT,
      ],
    ),
    boundary: f(
      'Included: whole-number products, multiplicands to four digits × one-digit multipliers, regrouping in any position, multiplicands containing internal zeros; bare and thin-context items. Excluded: two-digit multipliers (U3.L4); array/area-model illustration (U3.L6); estimation; multi-step word problems (application tier, U3.L7).',
      [C.es451, C.std45, C.nbtLimit],
    ),
    newLearning: f(
      'Start cue: a written multiplication problem, vertical or horizontal, with a multi-digit factor and a one-digit factor. Decision path: the standard algorithm — multiply ones, then tens, then hundreds, then thousands, recording regrouped values above the next column. Response form: the written numeric product.',
      [C.es451, C.stein],
    ),
    approach: f(
      'Single strategy: standard algorithm (Stein). Model explicitly: two-digit × one-digit with one regrouping; three-digit × one-digit with consecutive regroupings; a multiplicand with an internal zero (e.g., 306 × 4) — fossilization-prone placeholder handling. Vary numbers/magnitude and surface contexts between I Do and We Do; hold the steps, the demand band, and the reading load constant. Extension / practice-only: four-digit cases and context swaps — same steps, larger numbers.',
      [C.stein, C.steinZero, C.engineA5],
    ),
    nonGoals: f(
      'Do not introduce two-digit multipliers (U3.L4); do not name or teach partial products as an alternative method (P3 — single strategy); do not introduce array/area models yet (U3.L6, as interpretation of the algorithm); do not require estimation or reasonableness checks.',
      [C.stein, C.std45illustrate, C.es452],
    ),
    ceiling: f(
      'Hardest legitimate case: four-digit × one-digit with regrouping in three positions and an internal zero (shape: 4,073 × 8), presented bare or in thin context, answer-only response. No two-digit multipliers; no multi-step contexts.',
      [
        cite('items', 'NY 2024 · Q31', 'item bank', '4,073 × 8 — internal zero, three regroupings; the observed ceiling.'),
        C.es451,
        C.nbtLimit,
      ],
    ),
    assessment: f(
      'Students are able to: compute the product of a whole number of up to four digits and a one-digit whole number using the standard algorithm, with regrouping, at ceiling difficulty, unassisted. Fluency flag: none — no fluency language in the standard’s wording and no fluency-designated key.',
      [C.std45, cite('items', 'NY 2023 · Q17', 'answer key captured', 'Key: B (16,548) — response form confirms answer-only demand.')],
    ),
    releasedItems: f(
      'In-boundary items attached to this atom, ordered by closeness to ceiling. The contradiction-class MCAS 2019 Q22 (five-digit multiplicand) is not shown here; it appears only as a ceiling citation in Difficulty ceiling.',
      [C.adminNotes],
    ),
  },
  itemRefs: ['it-ny24-31', 'it-ny23-17', 'it-ma22-9'],
  decisions: [
    {
      n: 1,
      type: 'granularity',
      rule: 'A2',
      text: 'Split from two-digit × two-digit per new/hidden decision step — placing and aligning a second partial row (key 4.NBT.5-1 vs -2). Internal-zero multiplicands kept inside this atom per Editing Splits — no new cue or decision step — but escalated to explicit modeling.',
      citations: [C.engineA2, C.es451, C.es452, C.engineEdit, C.steinZero],
    },
    {
      n: 2,
      type: 'strategy',
      rule: 'P3',
      text: 'Standard algorithm per P3/Stein; the standard’s “illustrate and explain… arrays/area models” clause routed to application atom U3.L6 — coverage preserved, method singular.',
      citations: [C.stein, C.std45illustrate],
    },
    {
      n: 3,
      type: 'boundary',
      rule: 'P4',
      text: 'Boundary & ceiling: decomposition default (four-digit × one-digit) confirmed by observed items; no override, no pins.',
      citations: [C.es451, cite('items', 'NY 2024 · Q31', 'item bank', 'Observed demand matches the decomposition default; no movement either direction.')],
    },
    {
      n: 4,
      type: 'contradiction',
      rule: 'P1',
      text: 'MCAS 2019 Q22 demands a five-digit multiplicand inside a two-step context — exceeds the standard’s “up to four digits” wording. Standard wins: item reclassified rigor-signal-only; its demand profile calibrates this atom’s ceiling and contributes nothing else.',
      citations: [
        C.std45,
        cite('items', 'MCAS 2019 · Q22', 'item bank', '12,450 × 4 inside a two-step context — the excluded demand.'),
      ],
    },
    {
      n: 5,
      type: 'assumption',
      rule: 'D1',
      text: 'Assumptions: none — evidence status observed on all components.',
      citations: [],
    },
  ],
}

// ---------- remaining lessons ----------

const seqCite = (chain: string) => cite('sequence', 'Generated sequence', 'within-course', chain)

const l = (
  id: string,
  title: string,
  type: Lesson['type'],
  evidenceStatus: Lesson['evidenceStatus'],
  fields: Lesson['fields'],
  decisions: Lesson['decisions'],
  itemRefs: string[] = [],
  extra?: Partial<Lesson>,
): Lesson => ({ id, title, type, locked: false, evidenceStatus, fields, decisions, itemRefs, ...extra })

const u1l1 = l(
  'U1.L1',
  'A Digit’s Value Is Ten Times the Place to Its Right',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.A.1 / 4.NBT.1; governing key 4.NBT.1-1.', [
      cite('standards', 'CCSS 4.NBT.A.1', 'p. 29', '“…a digit in one place represents ten times what it represents in the place to its right.”'),
    ]),
    cluster: f('“Generalize place value understanding for multi-digit whole numbers.”', [
      cite('standards', 'CCSS 4.NBT.A', 'p. 29', 'Cluster heading, verbatim.'),
    ]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: extends Grade 3 rounding and base-ten work to the ten-times relationship; leads to Grade 5 powers-of-ten patterns. Within-course: opens the place-value chain; precedes U1.L2 (read/write/compare) and U3.L2 (place-value products).',
      [C.progNBT, seqCite('U1.L1 → U1.L2 → U1.L3')],
    ),
    prerequisites: f('Reads and writes three-digit numbers by place (prior-grade); skip-counts by tens and hundreds (prior-grade).', [C.progNBT]),
    boundary: f(
      'Included: whole numbers to 1,000,000; naming the ×10 relationship between adjacent places; place-value chart as taught representation. Excluded: decimal places (Grade 5); exponents; multiplicative comparison contexts (U4).',
      [C.nbtLimit],
    ),
    newLearning: f(
      'Start cue: a multi-digit number with one digit marked, or a “how many times” prompt comparing two places. Decision path: locate the digit, name its place, state its value as ten times the same digit one place right. Response form: the stated/written value comparison (e.g., “700 is ten times 70”).',
      [cite('standards', 'CCSS 4.NBT.A.1', 'p. 29', 'Wording defines the behavior directly.')],
    ),
    approach: f(
      'Single strategy: place-value chart read-off (Stein: explicit place naming before computation). Model explicitly: adjacent places within a four-digit number; the same digit appearing twice (e.g., 7,704). Extension: six-digit numbers, same routine.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not introduce rounding (U1.L3); do not introduce expanded-form notation yet (U1.L2); no decimal fractions.', [seqCite('U1 chain')]),
    ceiling: f('Hardest legitimate case: six-digit number, compare a marked digit across non-adjacent places by chaining ×10 twice; bare format.', [C.nbtLimit], false),
    assessment: f(
      'Students are able to: state, for any digit in a whole number ≤ 1,000,000, its value as ten times the value of the same digit one place to the right, at ceiling difficulty, unassisted. Fluency flag: none — no trigger in wording or keys.',
      [cite('standards', 'CCSS 4.NBT.A.1', 'p. 29', 'Observable behavior taken from wording.')],
    ),
    releasedItems: f('No in-boundary released item for this key in the uploaded corpus — generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    {
      n: 1,
      type: 'granularity',
      rule: 'A2',
      text: 'Kept as one atom: don’t-split — quantitative-only change across number sizes; no new decision step from four to six digits.',
      citations: [C.engineA2],
    },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Place-value chart read-off; Stein sequences explicit place naming before any multi-digit computation.', citations: [C.stein] },
    {
      n: 3,
      type: 'ceiling',
      rule: 'D1',
      text: 'No observed item for 4.NBT.1 in either corpus (both declared sample). Anticipated-evidence inference: analogous NBT keys are tested bare, answer-only; ceiling extrapolated from 4.NBT.2 comparison demand. Inference flagged on card.',
      citations: [C.adminNotes, C.progNBT],
      flags: ['inferred', 'thin-evidence'],
    },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'In the number 447,392, how many times greater is the value of the 4 in the hundred-thousands place than the value of the 4 in the ten-thousands place?',
      answer: '10 times greater',
      demandProfile: 'six-digit number, repeated digit, adjacent-place ×10 comparison, bare stem',
      basis: 'Extrapolated from 4.NBT.2 comparison items (bare, answer-only) and decomposition clarification bounds; corpus declared sample, so absence is weak evidence (D1).',
    },
  },
)

const u1l2 = l(
  'U1.L2',
  'Read, Write, and Compare Multi-Digit Whole Numbers',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.A.2 / 4.NBT.2; governing keys 4.NBT.2-1 (read/write), 4.NBT.2-2 (compare).', [
      cite('standards', 'CCSS 4.NBT.A.2', 'p. 29', 'Read and write multi-digit whole numbers… Compare two multi-digit numbers…'),
    ]),
    cluster: f('“Generalize place value understanding for multi-digit whole numbers.”', [
      cite('standards', 'CCSS 4.NBT.A', 'p. 29', 'Cluster heading, verbatim.'),
    ]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: extends Grade 2–3 three-digit work to 1,000,000; leads to Grade 5 decimal reading. Within-course: follows U1.L1; precedes U1.L3 (rounding).',
      [C.progNBT, seqCite('U1.L1 → U1.L2 → U1.L3')],
    ),
    prerequisites: f('States a digit’s ×10 place relationship (taught-in-course: U1.L1); reads three-digit numerals (prior-grade).', [seqCite('U1.L1')]),
    boundary: f(
      'Included: base-ten numerals, number names, expanded form, and >/=/< comparisons for whole numbers ≤ 1,000,000. Excluded: rounding (U1.L3); ordering more than two numbers (extension band); decimals.',
      [C.nbtLimit],
    ),
    newLearning: f(
      'Start cue: a numeral, number name, or expanded form to convert; or two numerals to compare. Decision path: align by place on the place-value chart, convert or compare left-to-right at the first differing place. Response form: the written equivalent form, or the comparison statement with >, =, <.',
      [cite('standards', 'CCSS 4.NBT.A.2', 'p. 29', 'The three forms and the comparison demand, from wording.')],
    ),
    approach: f(
      'Single strategy: left-to-right place alignment (Stein). Model explicitly: expanded form with a zero place (40,067); comparisons where digit count differs from magnitude intuition (98,764 vs 100,003). Extension: routine conversions among forms.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not introduce rounding language (“about”, “nearest”) — U1.L3; do not order three or more numbers; no decimal notation.', [seqCite('U1 chain')]),
    ceiling: f('Hardest legitimate case: compare two six-digit numbers differing first at the thousands place, one given in expanded form; select and justify the symbol.', [C.nbtLimit]),
    assessment: f(
      'Students are able to: write a whole number ≤ 1,000,000 in base-ten numerals, number names, and expanded form, and record a comparison of two such numbers with >, =, or <, at ceiling difficulty, unassisted. Fluency flag: none.',
      [cite('standards', 'CCSS 4.NBT.A.2', 'p. 29', 'Behavior from wording.')],
    ),
    releasedItems: f('No in-boundary released item captured for this key in the sample windows — generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    {
      n: 1,
      type: 'granularity',
      rule: 'A3',
      text: 'Read/write and compare kept in one atom: tie-breaker 2 — comparison rewrites to friendlier numbers with the routine identical (align by place, scan left-to-right). No new decision cue.',
      citations: [C.engineA2],
    },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Left-to-right place alignment as the single routine across all three forms.', citations: [C.stein] },
    {
      n: 3,
      type: 'assumption',
      rule: 'D1',
      text: 'Ceiling inferred from analogous NBT comparison items in adjacent grades of the same corpora; sample coverage weights toward extrapolation.',
      citations: [C.adminNotes],
      flags: ['inferred'],
    },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'Which comparison is true?  A. 90,000 + 8,000 + 700 + 60 + 4 > 100,003   B. 98,764 > 100,003   C. 100,003 > 90,000 + 8,000 + 700 + 60 + 4   D. 100,003 = 98,764',
      answer: 'C',
      demandProfile: 'six-digit comparison, one operand in expanded form, selected response',
      basis: 'Matched to NY selected-response style for NBT keys; ceiling set at decomposition default (D1; sample corpus).',
    },
  },
)

const u1l3 = l(
  'U1.L3',
  'Round Multi-Digit Whole Numbers to Any Place',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.A.3 / 4.NBT.3; governing key 4.NBT.3-1.', [
      cite('standards', 'CCSS 4.NBT.A.3', 'p. 29', '“Use place value understanding to round multi-digit whole numbers to any place.”'),
    ]),
    cluster: f('“Generalize place value understanding for multi-digit whole numbers.”', [
      cite('standards', 'CCSS 4.NBT.A', 'p. 29', 'Cluster heading, verbatim.'),
    ]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: extends Grade 3 rounding to 10/100 up to any place ≤ 1,000,000; feeds Grade 5 decimal rounding. Within-course: closes the U1 place-value chain; cited as a prerequisite by U3.L3 (reads/writes numbers to 10,000).',
      [C.progNBT, seqCite('U1.L2 → U1.L3 → U3 chain')],
    ),
    prerequisites: f('Reads, writes, and compares multi-digit numbers (taught-in-course: U1.L2); states place values (taught-in-course: U1.L1).', [seqCite('U1.L1, U1.L2')]),
    boundary: f(
      'Included: rounding whole numbers ≤ 1,000,000 to any named place; bare and thin-context prompts. Excluded: estimation as a solution strategy for operations (deferred — non-goal in U2/U3); decimal rounding.',
      [C.nbtLimit],
    ),
    newLearning: f(
      'Start cue: a whole number plus a named target place (“round to the nearest ___”). Decision path: mark the target place, inspect the digit to its right, round down if 0–4 and up if 5–9, zero the places right of target. Response form: the written rounded numeral.',
      [cite('standards', 'CCSS 4.NBT.A.3', 'p. 29', 'Behavior from wording.')],
    ),
    approach: f(
      'Single strategy: mark–inspect–round routine (Stein). Model explicitly: rounding where the target digit is 9 and cascades (297,500 → 300,000); rounding to an interior place. Extension: routine cases across magnitudes.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not use rounding to estimate products or sums (that application lives with the operations units as reasonableness work, out of v1 scope); no “front-end estimation” alternative routine (P3).', [C.stein]),
    ceiling: f('Hardest legitimate case: round a six-digit number to the ten-thousands where rounding cascades across a 9 (e.g., 296,481 → 300,000), bare format.', [C.nbtLimit]),
    assessment: f(
      'Students are able to: round a whole number ≤ 1,000,000 to any named place, including cascade cases, at ceiling difficulty, unassisted. Fluency flag: none.',
      [cite('standards', 'CCSS 4.NBT.A.3', 'p. 29', 'Behavior from wording.')],
    ),
    releasedItems: f('No in-boundary item captured in the sample windows — generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Cascade-9 cases kept inside the atom (no new cue or decision step) but escalated to explicit modeling per A5 — documented error pattern.', citations: [C.engineEdit, C.engineA5] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Mark–inspect–round as the single routine; number-line rounding recorded as inadmissible stance from the progression (P7), logged and overruled.', citations: [C.stein, C.progNBT], flags: [] },
    { n: 3, type: 'assumption', rule: 'D1', text: 'Ceiling inferred; sample corpora → extrapolated from Grade 3 rounding items in the NY window.', citations: [C.adminNotes], flags: ['inferred'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'Round 296,481 to the nearest ten thousand.',
      answer: '300,000',
      demandProfile: 'six-digit number, cascade across 9, bare stem, gridded response',
      basis: 'Style matched to NY gridded-response NBT items; cascade demand from Stein error-pattern inventory (P9 documentary basis).',
    },
  },
)

const u2l1 = l(
  'U2.L1',
  'Add and Subtract Multi-Digit Whole Numbers, Standard Algorithm',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.B.4 / 4.NBT.4; governing keys 4.NBT.4-1 (add), 4.NBT.4-2 (subtract).', [
      cite('standards', 'CCSS 4.NBT.B.4', 'p. 29', '“Fluently add and subtract multi-digit whole numbers using the standard algorithm.”'),
    ]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: Grade 3 adds/subtracts within 1,000; Grade 4 generalizes to the standard algorithm ≤ 1,000,000; the algorithm anchors Grade 5–6 decimal computation. Within-course: follows U1.L3; subtraction-across-zeros feeds U4 division recording.',
      [C.progNBT, seqCite('U1.L3 → U2.L1 → U3 chain')],
    ),
    prerequisites: f('Reads/writes/compares numbers ≤ 1,000,000 (taught-in-course: U1.L2); adds and subtracts within 1,000 with regrouping (prior-grade).', [C.progNBT, seqCite('U1.L2')]),
    boundary: f(
      'Included: sums and differences of whole numbers ≤ 1,000,000, regrouping in any position, subtraction across zeros; bare and thin-context. Excluded: estimation checks; multi-step contexts (application tier); decimals.',
      [C.nbtLimit, cite('items', 'NY 2023 · Q27', 'item bank', '46,289 + 27,354 — observed five-digit demand confirms the boundary above the decomposition default.')],
    ),
    newLearning: f(
      'Start cue: a written addition or subtraction problem with multi-digit whole numbers. Decision path: the standard algorithm — align by place, operate right-to-left, regroup by recording above (addition) or re-marking (subtraction). Response form: the written numeric sum or difference.',
      [cite('standards', 'CCSS 4.NBT.B.4', 'p. 29', 'Standard algorithm named in wording.'), C.stein],
    ),
    approach: f(
      'Single strategy: standard algorithm (Stein). Model explicitly: subtraction across zeros (60,004 − 4,318) — fossilization-prone; additions regrouping in three consecutive columns. Vary magnitude and surface context; hold steps, demand band, and reading load constant. Extension: six-digit same-routine cases.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not teach compensation or partial-sums as alternative methods (P3); do not require estimation or reasonableness checks; no multi-step word problems yet (U6 application tier).', [C.stein]),
    ceiling: f('Hardest legitimate case: six-digit − five-digit across two zeros (shape: 400,203 − 87,415), bare, answer-only.', [
      cite('items', 'NY 2023 · Q27', 'item bank', 'Five-digit + five-digit observed; subtraction ceiling extrapolated one grade of magnitude within the footnote limit.'),
      C.nbtLimit,
    ]),
    assessment: f(
      'Students are able to: compute sums and differences of whole numbers ≤ 1,000,000 using the standard algorithm, including subtraction across zeros, at ceiling difficulty, unassisted. Fluency flag: YES — “fluently” in the standard’s wording (P8); the rate itself is the app’s.',
      [cite('standards', 'CCSS 4.NBT.B.4', 'p. 29', '“Fluently…” triggers the P8 fluency flag.')],
    ),
    releasedItems: f('One in-boundary item attached; ordered by closeness to ceiling.', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A3', text: 'Addition and subtraction kept as one atom under tie-breaker 2 (routine identical under friendlier numbers) — but subtraction-across-zeros escalated to explicit modeling (documented error pattern, P9 documentary basis: Stein).', citations: [C.engineEdit, C.steinZero] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Standard algorithm per wording and Stein; compensation strategies in the progression recorded as inadmissible stance (P7).', citations: [C.stein, C.progNBT] },
    { n: 3, type: 'override', rule: 'P4', text: 'Ceiling raised above the decomposition default (four-digit operands) by observed five-digit item demand — permitted override, executed and logged.', citations: [cite('items', 'NY 2023 · Q27', 'item bank', 'Five-digit operands observed in-boundary.'), C.es451] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  ['it-ny23-27'],
)

const u3l1 = l(
  'U3.L1',
  'Multiply One-Digit Numbers by Multiples of 10, 100, and 1,000',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.B.5 / 4.NBT.5; preskill slice of governing key 4.NBT.5-1 (place-value products).', [C.std45, C.es451]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: extends Grade 3 multiples-of-ten work; the place-value products here are the mental steps inside the Grade 4–5 algorithms. Within-course: opens Unit 3; precedes U3.L2 and the algorithm atoms.',
      [C.progNBT, seqCite('U3.L1 → U3.L2 → U3.L3')],
    ),
    prerequisites: f('Single-digit multiplication facts (prior-grade); states place values (taught-in-course: U1.L1).', [
      cite('items', 'NY 2022 · Q8 (Grade 3)', 'below-grade evidence, D2', 'Fact-fluency item anchors the prerequisite.'),
    ]),
    boundary: f('Included: one-digit × 10/100/1,000 and their multiples (e.g., 7 × 600), products ≤ 1,000,000, bare format. Excluded: two multi-digit factors (U3.L3+); anything requiring the written algorithm.', [C.es451, C.nbtLimit]),
    newLearning: f(
      'Start cue: a product with one single-digit factor and one factor that is a multiple of 10, 100, or 1,000. Decision path: multiply the non-zero parts, then append the total zeros count. Response form: the written numeric product.',
      [C.stein],
    ),
    approach: f(
      'Single strategy: multiply-then-append-zeros (Stein preskill format). Model explicitly: cases where the fact itself produces a zero (5 × 400 = 2,000 — “how many zeros” confusion). Extension: thousands-scale same-routine cases.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not introduce the vertical algorithm format (U3.L3); do not teach exponent language; no area models (U3.L6).', [seqCite('U3 chain')]),
    ceiling: f('Hardest legitimate case: 8 × 6,000 and fact-generated-zero cases (5 × 400), bare, answer-only.', [C.es451]),
    assessment: f('Students are able to: compute the product of a one-digit number and a multiple of 10, 100, or 1,000, including fact-generated-zero cases, at ceiling difficulty, unassisted. Fluency flag: none.', [C.std45]),
    releasedItems: f('No in-boundary item isolates this preskill in the sample windows — generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Preskill split from U3.L3: foundational preskill missing/weak (place-value products are the mental steps of every partial row). Split criterion: foundational preskill.', citations: [C.engineA2, C.stein] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Multiply-then-append-zeros per Stein’s preskill sequence.', citations: [C.stein] },
    { n: 3, type: 'assumption', rule: 'D1', text: 'Ceiling inferred — no released item isolates the preskill; extrapolated from how 4.NBT.5 composite items embed it (sample corpora).', citations: [C.adminNotes], flags: ['inferred'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'What is 5 × 400?',
      answer: '2,000',
      demandProfile: 'fact-generated zero, bare stem, answer-only',
      basis: 'Demand profile extracted from step structure of observed 4.NBT.5 items (NY 2023 Q17, NY 2024 Q31); D1 inference, sample corpus.',
    },
  },
)

const u3l2 = l(
  'U3.L2',
  'Place-Value Products: Expand One Factor, Multiply the Parts',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.B.5 / 4.NBT.5; governing key 4.NBT.5-1 (place-value strategies component).', [C.std45, C.es451]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: the distributive step that the Grade 5 algorithm compresses. Within-course: follows U3.L1; immediately precedes U3.L3, which formalizes the recording.',
      [C.progNBT, seqCite('U3.L1 → U3.L2 → U3.L3')],
    ),
    prerequisites: f('Place-value products with multiples of ten (taught-in-course: U3.L1); expanded form (taught-in-course: U1.L2).', [seqCite('U3.L1, U1.L2')]),
    boundary: f('Included: two- and three-digit × one-digit computed by expanding the multi-digit factor and adding partial products, bare format. Excluded: the compressed vertical recording (U3.L3); two-digit multipliers (U3.L4).', [C.es451]),
    newLearning: f(
      'Start cue: a multi-digit × one-digit product presented for place-value computation. Decision path: expand the multi-digit factor by place, multiply each part by the one-digit factor (U3.L1 routine), add the partial products. Response form: the written partial products and their sum.',
      [C.stein],
    ),
    approach: f(
      'Single strategy: expand–multiply–add (Stein: the algorithm’s meaning taught once, then compressed in U3.L3). Model explicitly: three-digit with an internal zero part (306 = 300 + 6 — the zero part vanishes). Extension: routine two-digit cases.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not introduce the vertical compressed format (U3.L3); do not present this as a permanent alternative to the algorithm — it is the meaning step, retired after U3.L3 (P3).', [C.stein]),
    ceiling: f('Hardest legitimate case: three-digit with internal zero × one-digit, all partials recorded, bare.', [C.es451]),
    assessment: f('Students are able to: compute a two- or three-digit × one-digit product by expanding, multiplying parts, and adding partial products, at ceiling difficulty, unassisted. Fluency flag: none.', [C.std45]),
    releasedItems: f('No item isolates the expanded step; generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Split from U3.L3 on new vocabulary/concept label needing stabilization (partial product) and to sequence meaning before compression per doctrine.', citations: [C.engineA2, C.stein] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Expand–multiply–add as the single routine at this step; explicitly retired after U3.L3 so it never becomes a parallel computation path.', citations: [C.stein] },
    { n: 3, type: 'assumption', rule: 'D1', text: 'Ceiling inferred from composite-item step structure; sample corpora.', citations: [C.adminNotes], flags: ['inferred'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'Compute 306 × 4 by expanding 306. Record each partial product and the final product.',
      answer: '300 × 4 = 1,200; 6 × 4 = 24; 1,200 + 24 = 1,224',
      demandProfile: 'internal-zero expansion, all partials recorded, bare stem',
      basis: 'Internal-zero demand from Stein error inventory; recording format from progression worked examples (secondary rigor evidence).',
    },
  },
)

const u3l4 = l(
  'U3.L4',
  'Multiply Two Two-Digit Numbers, Standard Algorithm',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.B.5 / 4.NBT.5; governing key 4.NBT.5-2 (two-digit × two-digit).', [C.std45, C.es452]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f(
      'Cross-grade: the last new multiplication structure before Grade 5 fluency with multi-digit × multi-digit. Within-course: follows U3.L3; precedes U3.L5 (discrimination bridge) and U3.L6 (area-model interpretation).',
      [C.progNBT, seqCite('U3.L3 → U3.L4 → U3.L5 → U3.L6')],
    ),
    prerequisites: f('Standard algorithm with one-digit multipliers (taught-in-course: U3.L3); place-value products with multiples of ten (taught-in-course: U3.L1).', [seqCite('U3.L3, U3.L1')]),
    boundary: f('Included: two-digit × two-digit whole-number products, second partial row with placeholder zero, bare and thin-context. Excluded: three-digit multipliers (Grade 5); estimation; area-model illustration (U3.L6).', [C.es452, C.nbtLimit]),
    newLearning: f(
      'Start cue: a written multiplication problem with two two-digit factors. Decision path: the standard algorithm — multiply by the ones digit, then by the tens digit recording the placeholder zero, then add the two partial rows. Response form: the written numeric product.',
      [C.es452, C.stein],
    ),
    approach: f(
      'Single strategy: standard algorithm with second partial row (Stein). Model explicitly: the placeholder zero in the second row; a second row whose product itself ends in zero (e.g., 34 × 25 — “two zeros?” confusion); partial-row alignment. Vary magnitude and context; hold steps and demand band constant. Extension: larger two-digit pairs, same steps.',
      [C.stein, C.engineA5, C.progNBTzero],
    ),
    nonGoals: f('Do not introduce three-digit multipliers (Grade 5); do not teach the area model as computation (U3.L6 interprets it); do not teach lattice or partial-products layouts as alternatives (P3).', [C.stein]),
    ceiling: f('Hardest legitimate case: two-digit × two-digit where both rows regroup and the second row ends in zero (shape: 78 × 45), bare, answer-only.', [
      cite('items', 'NY 2023 · Q4', 'item bank', 'Partial-row alignment demand observed; selected-response format at this demand.'),
      C.es452,
    ]),
    assessment: f('Students are able to: compute the product of two two-digit whole numbers using the standard algorithm, recording and aligning both partial rows, at ceiling difficulty, unassisted. Fluency flag: none.', [C.std45]),
    releasedItems: f('One in-boundary item attached, ordered by closeness to ceiling.', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Split from U3.L3 on new/hidden decision step: placing and aligning the second partial row with its placeholder zero (key 4.NBT.5-2).', citations: [C.engineA2, C.es452] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Standard algorithm; partial-products layout named by NY 2023 Q4 distractors recorded as assessment vocabulary, not taught as a method.', citations: [C.stein, cite('items', 'NY 2023 · Q4', 'item bank', 'Distractor structure exposes partial-product notation.')] },
    { n: 3, type: 'boundary', rule: 'P4', text: 'Decomposition default (two-digit × two-digit) confirmed by observed items; no override.', citations: [C.es452] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  ['it-ny23-4'],
)

const u3l5 = l(
  'U3.L5',
  'Bridge: One-Digit or Two-Digit Multiplier? Choose and Execute',
  'bridge',
  'observed',
  {
    standards: f('4.NBT.B.5 / 4.NBT.5; bridge over keys 4.NBT.5-1 and 4.NBT.5-2.', [C.std45, C.es451, C.es452]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A; inherited from parent atoms).', [C.subclaimA]),
    progression: f('Within-course: after both U3.L3 and U3.L4 are independently mastered; precedes U3.L6. Cross-grade: discrimination behavior itself is course-internal.', [seqCite('U3.L3 + U3.L4 → U3.L5')]),
    prerequisites: f('One-digit-multiplier algorithm (taught-in-course: U3.L3); two-digit-multiplier algorithm (taught-in-course: U3.L4). Both must be independently mastered before this bridge (doctrine ordering).', [C.stein, seqCite('U3.L3, U3.L4')]),
    boundary: f('Included: mixed sets of U3.L3-class and U3.L4-class problems presented without labels. Excluded: any new number range or format beyond the parents’ boundaries.', [C.es451, C.es452]),
    newLearning: f(
      'Start cue: any written multiplication problem from the two parent classes, unlabeled. Decision path: the selection/discrimination behavior — read the multiplier’s digit count from the first cue, select the matching routine, execute it cleanly without blending (no second row for one-digit; placeholder zero for two-digit). Response form: the written numeric product.',
      [C.stein],
    ),
    approach: f(
      'Mixed look-alike practice engineered to trigger the confusion — alternating and streaked sequences of one-digit and two-digit multipliers — no new rules or methods modeled; prior atoms appear as discrimination examples (§7.14 bridge semantics).',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not model any computation step (both routines are mastered inputs); do not introduce new number ranges; do not mix in division look-alikes (U4 handles its own discrimination).', [C.stein]),
    ceiling: f('Hardest legitimate case: an interleaved set at both parents’ ceilings — 4,073 × 8 adjacent to 78 × 45 — bare, answer-only.', [C.es451, C.es452]),
    assessment: f('Students are able to: select and correctly execute the matching multiplication routine for an unlabeled mixed set spanning both parent problem classes, at parent ceiling difficulty, unassisted. Fluency flag: none.', [C.std45]),
    releasedItems: f('Bridges attach no items of their own; parents’ exemplars serve as the discrimination set. Field carries the parents’ nearest-ceiling items.', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A4', text: 'Bridge inserted on high confusability between split pair U3.L3/U3.L4 (shared start cue “written multiplication problem”; divergent routines). Placement deferred until both parents mastered; confusables separated in time.', citations: [C.engineA2, C.stein] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'No strategy selection — discrimination only; both routines inherited from parents.', citations: [C.stein] },
    { n: 3, type: 'boundary', rule: 'P4', text: 'Boundary and ceiling inherit from parent atoms; nothing new to set.', citations: [C.es451, C.es452] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  ['it-ny24-31', 'it-ny23-4'],
)

const u3l6 = l(
  'U3.L6',
  'Interpret the Algorithm: Equations, Arrays, and Area Models',
  'application-tier',
  'observed',
  {
    standards: f('4.NBT.B.5 / 4.NBT.5; the “illustrate and explain” clause, routed here as a post-mastery application atom (P3).', [C.std45illustrate]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A; inherited from parent).', [C.subclaimA]),
    progression: f('Cross-grade: the area model reappears in Grade 5 fraction multiplication and Grade 6 distributive work. Within-course: after U3.L5; closes the multiplication chain.', [C.progNBT, seqCite('U3.L5 → U3.L6')]),
    prerequisites: f('Both algorithm atoms and the discrimination bridge (taught-in-course: U3.L3, U3.L4, U3.L5).', [seqCite('U3.L3–L5')]),
    boundary: f('Included: matching a completed computation to its area model or equation form; explaining which partial row a region represents; parent number ranges. Excluded: computing via the model (P3 — the algorithm remains the single computation path); unfamiliar representations.', [C.std45illustrate, C.stein]),
    newLearning: f(
      'Start cue: a completed or in-progress algorithm computation paired with an area model, array, or equation form. Decision path: executing the mastered routine in the new demand band — map each partial row to its region/term, and explain the correspondence. Response form: the selected/labeled correspondence with a one-sentence explanation.',
      [C.std45illustrate],
    ),
    approach: f(
      'Application-tier semantics: no new computation modeled. Model explicitly: mapping the second partial row (with placeholder zero) to its area-model region — first encounter of “area model” as a normalized lexicon form triggered explicit modeling. Extension: equation-form matching.',
      [C.engineA5, C.progNBT],
    ),
    nonGoals: f('Do not teach area-model computation as a method (P3); do not extend to three-digit factors; do not require constructing models from scratch beyond the observed demand.', [C.stein]),
    ceiling: f('Hardest legitimate case: identify both partial products of a two-digit × two-digit computation within a labeled area model and select the matching expression pair (observed NY 2023 Q4 demand).', [cite('items', 'NY 2023 · Q4', 'item bank', 'The observed ceiling for interpretation demand.')]),
    assessment: f('Students are able to: match a standard-algorithm computation to its equation and area-model representation and identify what each partial product represents, at ceiling difficulty, unassisted. Fluency flag: none.', [C.std45illustrate]),
    releasedItems: f('One in-boundary item attached (interpretation demand).', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Demand-band jump (interpret/explain over execute) scoped as an application-tier lesson attached to the content atoms rather than a separate content atom — reasoning-type demand per decomposition typing.', citations: [C.engineA2, C.es452] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Representations taught as interpretations of the algorithm after mastery, never as parallel computation paths — the “illustrate and explain” clause satisfied at the depth the evidence demands.', citations: [C.stein, C.std45illustrate] },
    { n: 3, type: 'boundary', rule: 'P4', text: 'Boundary and ceiling inherit from parents plus the triggering clause’s scope; observed NY 2023 Q4 sets the interpretation ceiling.', citations: [cite('items', 'NY 2023 · Q4', 'item bank', 'Interpretation demand observed.')] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'Progression’s preference for area-model-first instruction recorded as inadmissible stance (P7), overruled by P3; conflict logged.', citations: [C.progNBT, C.stein] },
  ],
  ['it-ny23-4'],
)

const u3l7 = l(
  'U3.L7',
  'Application: Multi-Step Word Problems with Multiplication',
  'application-tier',
  'observed',
  {
    standards: f('4.OA.A.3 / 4.OA.3 (governing) applied over 4.NBT.5 computation; integrative key Int-4.c.', [
      cite('standards', 'CCSS 4.OA.A.3', 'p. 29', '“Solve multistep word problems… using the four operations…”'),
    ]),
    cluster: f('“Use the four operations with whole numbers to solve problems.”', [cite('standards', 'CCSS 4.OA.A', 'p. 29', 'Cluster heading, verbatim.')]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f('Cross-grade: two-step problems begin in Grade 3; Grade 4 adds remainder interpretation and larger numbers. Within-course: after U3.L5; multiplication-only contexts here, division contexts return in U4.', [C.progNBT, seqCite('U3.L5 → U3.L7 → U4')]),
    prerequisites: f('Multiplication algorithms and discrimination (taught-in-course: U3.L3–L5); multi-digit addition/subtraction (taught-in-course: U2.L1).', [seqCite('U2.L1, U3.L3–L5')]),
    boundary: f('Included: two-operation contexts (multiply, then add or subtract), whole-number answers, numbers within parent ceilings. Excluded: remainder interpretation (U4, with division); more than two operations; letter-variable equations.', [cite('items', 'NY 2021 · Q12', 'item bank', 'Two-operation observed demand: multiply then subtract.')]),
    newLearning: f(
      'Start cue: a word problem whose question requires combining a product with one more operation. Decision path: executing mastered routines in the new demand band — identify the two operations from the context, compute in order, state the answer in context units. Response form: written work showing both operations plus the labeled answer.',
      [cite('items', 'NY 2021 · Q12', 'item bank', '“Show your work” response format observed.')],
    ),
    approach: f(
      'Application-tier semantics: no new computation modeled. Model explicitly: extracting the operation sequence from the context (Stein word-problem format: identify, plan, compute, label) — high load/hidden steps. Extension: single-swap surface contexts.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not introduce division contexts or remainders (U4); do not require equation-with-letter representations (separate 4.OA.3 component); do not exceed two operations.', [seqCite('U4 chain')]),
    ceiling: f('Hardest legitimate case: two-operation context at parent computation ceilings with an extraneous number in the stem (observed NY open-response demand), work-shown response.', [cite('items', 'NY 2021 · Q12', 'item bank', 'Open-response, work-shown, two operations.')]),
    assessment: f('Students are able to: solve a two-operation word problem combining a multi-digit product with addition or subtraction, showing both computations and labeling the answer, at ceiling difficulty, unassisted. Fluency flag: none.', [cite('standards', 'CCSS 4.OA.A.3', 'p. 29', 'Behavior from wording.')]),
    releasedItems: f('One in-boundary item attached.', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Integrative key Int-4.c seeds this application lesson; demand-band jump (contextual multi-step over bare execution) split it from the content atoms.', citations: [C.engineA2] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Stein word-problem format (identify–plan–compute–label) as the single approach to context extraction.', citations: [C.stein] },
    { n: 3, type: 'boundary', rule: 'P4', text: 'Two-operation cap from observed items; remainder interpretation deferred to U4 where division evidence carries it.', citations: [cite('items', 'NY 2021 · Q12', 'item bank', 'Two operations observed; no three-operation item in either corpus.')] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  ['it-ny21-12'],
)

const u4l1 = l(
  'U4.L1',
  'Divide Up to Four-Digit Dividends by One-Digit Divisors',
  'new-learning',
  'observed',
  {
    standards: f('4.NBT.B.6 / 4.NBT.6; governing key 4.NBT.6-1.', [
      cite('standards', 'CCSS 4.NBT.B.6', 'p. 29', '“Find whole-number quotients and remainders with up to four-digit dividends and one-digit divisors…”'),
    ]),
    cluster: f('“Use place value understanding and properties of operations to perform multi-digit arithmetic.”', [C.cluster45]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f('Cross-grade: builds on Grade 3 division facts; leads to Grade 5 two-digit divisors and Grade 6 fluency. Within-course: follows U3; remainder interpretation joins in U4.L2 with 4.OA.3.', [C.progNBT, seqCite('U3 → U4.L1 → U4.L2')]),
    prerequisites: f('Multiplication algorithms (taught-in-course: U3.L3); subtraction with regrouping (taught-in-course: U2.L1); division facts (prior-grade).', [seqCite('U2.L1, U3.L3')]),
    boundary: f('Included: up to four-digit dividends ÷ one-digit divisors, quotients with and without remainders, bare and thin-context. Excluded: two-digit divisors (Grade 5); decimal quotients; remainder interpretation in context (U4.L2).', [cite('standards', 'CCSS 4.NBT.B.6', 'p. 29', '“…up to four-digit dividends and one-digit divisors” — wording sets the edge.')]),
    newLearning: f(
      'Start cue: a written division problem, long-division or horizontal format, with a one-digit divisor. Decision path: the long-division algorithm — divide, multiply, subtract, bring down, repeat; record the remainder if the final subtraction is non-zero. Response form: the written quotient (and remainder where present).',
      [C.stein],
    ),
    approach: f(
      'Single strategy: long-division algorithm (Stein). Model explicitly: quotients with an internal zero (e.g., 4,236 ÷ 4 — “0 in the quotient” error, fossilization-prone); first-digit-smaller-than-divisor starts. Extension: routine three-digit cases, context swaps.',
      [C.stein, C.steinZero, C.engineA5],
    ),
    nonGoals: f('Do not teach partial-quotients as an alternative method (P3); do not interpret remainders in context yet (U4.L2); no two-digit divisors.', [C.stein]),
    ceiling: f('Hardest legitimate case: four-digit ÷ one-digit with an internal zero in the quotient and a remainder (shape: 4,236 ÷ 4), bare, answer-only.', [cite('standards', 'CCSS 4.NBT.B.6', 'p. 29', 'Wording bound: four-digit dividends.')], true),
    assessment: f('Students are able to: compute quotients and remainders for up to four-digit dividends and one-digit divisors using the long-division algorithm, at ceiling difficulty, unassisted. Fluency flag: none.', [cite('standards', 'CCSS 4.NBT.B.6', 'p. 29', 'Behavior from wording.')]),
    releasedItems: f('No in-boundary item captured in the sample windows — generated ceiling exemplar shown.', [C.adminNotes], true),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Internal-zero quotients kept inside the atom per Editing Splits (no new cue/decision step), escalated to explicit modeling — documented error pattern (Stein).', citations: [C.engineEdit, C.steinZero] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'Long division per Stein; the standard’s “strategies based on place value” satisfied by the algorithm’s place-value recording, partial-quotients logged as excluded alternative.', citations: [C.stein] },
    { n: 3, type: 'assumption', rule: 'D1', text: 'No 4.NBT.6 item in either sample window (acknowledged gap adjacent). Anticipated-evidence inference from 4.NBT.5 item styles and decomposition bounds; ceiling exemplar generated.', citations: [C.adminNotes, C.es451], flags: ['inferred', 'thin-evidence'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'Divide: 4,236 ÷ 4 = ______',
      answer: '1,059',
      demandProfile: 'four-digit dividend, internal zero in quotient, bare stem, gridded response',
      basis: 'Item style matched to NY gridded 4.NBT.5 items; internal-zero demand from Stein error inventory; ceiling at decomposition default (D1; sample corpus).',
    },
  },
)

const u5l1 = l(
  'U5.L1',
  'Generate Equivalent Fractions by Scaling Parts',
  'new-learning',
  'mixed',
  {
    standards: f('4.NF.A.1 / 4.NF.1; governing key 4.NF.1-1.', [
      cite('standards', 'CCSS 4.NF.A.1', 'p. 30', '“Explain why a fraction a/b is equivalent to a fraction (n × a)/(n × b) by using visual fraction models…”'),
    ]),
    cluster: f('“Extend understanding of fraction equivalence and ordering.”', [cite('standards', 'CCSS 4.NF.A', 'p. 30', 'Cluster heading, verbatim.')]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f('Cross-grade: Grade 3 establishes equivalence for simple cases; Grade 4 generalizes via n/n scaling; Grade 5 uses equivalence for unlike-denominator addition. Within-course: opens Unit 5; precedes U5.L2 (comparison).', [
      cite('interpretive', 'UA Progressions, NF 3–5', 'p. 6', 'Grade 4 formalizes the n/n scaling argument that Grade 3 saw in models.'),
      seqCite('U5.L1 → U5.L2'),
    ]),
    prerequisites: f('Identifies fractions as parts of a whole with denominators 2,3,4,6,8 (prior-grade); multiplication facts (prior-grade).', [cite('interpretive', 'UA Progressions, NF 3–5', 'p. 3', 'Grade 3 fraction foundations.')]),
    boundary: f('Included: generating and recognizing equivalent pairs by multiplying numerator and denominator by the same n; denominators limited to 2,3,4,5,6,8,10,12,100 (footnote limit); fraction-strip and area models as taught representations. Excluded: simplifying via division (Grade 5 convention); comparison (U5.L2); operations on fractions.', [
      cite('standards', 'CCSS Grade 4 NF footnote', 'p. 30 fn.', 'Denominators limited to 2, 3, 4, 5, 6, 8, 10, 12, 100.'),
    ]),
    newLearning: f(
      'Start cue: a fraction with a prompt for an equivalent (“find/select an equivalent fraction,” a model to match, or a missing numerator/denominator). Decision path: multiply numerator and denominator by the same whole number n; verify against the model when one is present. Response form: the written equivalent fraction (or the selected pair).',
      [cite('items', 'MCAS 2022 · Q14', 'item bank (ai-proposed)', 'Recognize-equivalent selected-response demand.')],
    ),
    approach: f(
      'Single strategy: n/n scaling (Stein: one rule — multiply top and bottom by the same number). Model explicitly: first encounter of the fraction strip as a normalized lexicon form; missing-numerator cases (3/4 = ?/12). Extension: recognize-equivalent selected-response cases.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not compare non-equivalent fractions (U5.L2); do not simplify by dividing (deferred convention); do not add or subtract fractions (Grade 4 NF.B, later unit).', [seqCite('U5.L2')]),
    ceiling: f('Hardest legitimate case: missing-value equivalence with denominators 12 or 100 (3/4 = ?/100 class), model optional, selected or gridded response. Ceiling marked partially inferred — the only observed item is ai-proposed.', [
      cite('items', 'MCAS 2022 · Q14', 'item bank (ai-proposed)', 'Observed demand: recognize 3/4 = 6/8 with models.'),
    ], true),
    assessment: f('Students are able to: generate a fraction equivalent to a given fraction by n/n scaling and identify equivalent pairs, within the Grade 4 denominator list, at ceiling difficulty, unassisted. Fluency flag: none.', [
      cite('standards', 'CCSS 4.NF.A.1', 'p. 30', 'Behavior from wording.'),
    ]),
    releasedItems: f('One in-boundary item attached — alignment is ai-proposed and unconfirmed; reliance flagged in QC and the Decision record (D14).', []),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Generate and recognize kept as one atom (same rule, same start cue family); the explain-why demand attaches as the upper demand tier rather than a separate atom.', citations: [C.engineA2] },
    { n: 2, type: 'strategy', rule: 'P3', text: 'n/n scaling as the single rule; progression’s model-first sequencing recorded as stance (P7), models scheduled per doctrine after the rule is taught.', citations: [C.stein] },
    { n: 3, type: 'assumption', rule: 'D14', text: 'Sole observed item (MCAS 2022 Q14) carries unconfirmed ai-proposed alignment — usable per D14, reliance stated here and flagged in QC; ceiling partially inferred pending confirmation.', citations: [cite('items', 'MCAS 2022 · Q14', 'item bank', 'ai-proposed alignment, completeness 0.72.')], flags: ['ai-proposed', 'thin-evidence'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  ['it-ma22-14'],
)

const u5l2 = l(
  'U5.L2',
  'Compare Fractions with Unlike Numerators and Denominators',
  'new-learning',
  'inferred',
  {
    standards: f('4.NF.A.2 / 4.NF.2; governing key 4.NF.2-1.', [
      cite('standards', 'CCSS 4.NF.A.2', 'p. 30', '“Compare two fractions with different numerators and different denominators… Record the results with >, =, <, and justify…”'),
    ]),
    cluster: f('“Extend understanding of fraction equivalence and ordering.”', [cite('standards', 'CCSS 4.NF.A', 'p. 30', 'Cluster heading, verbatim.')]),
    emphasis: f('Major (emphasis source: sub-claim A).', [C.subclaimA]),
    progression: f('Cross-grade: Grade 3 compares same-numerator or same-denominator pairs; Grade 5 needs comparison fluency for unlike-denominator addition. Within-course: follows U5.L1; closes the v-slice of Unit 5.', [
      cite('interpretive', 'UA Progressions, NF 3–5', 'p. 7', 'Grade 4 comparison via common denominators or benchmarks.'),
      seqCite('U5.L1 → U5.L2'),
    ]),
    prerequisites: f('Generates equivalent fractions by n/n scaling (taught-in-course: U5.L1); compares whole numbers (taught-in-course: U1.L2).', [seqCite('U5.L1, U1.L2')]),
    boundary: f('Included: comparing two fractions within the Grade 4 denominator list by rewriting to a common denominator, recording with >/=/<; justification against a model. Excluded: benchmark-half comparison as a taught alternative (P3 — logged); ordering three or more; unlike-denominator addition (NF.B).', [
      cite('standards', 'CCSS Grade 4 NF footnote', 'p. 30 fn.', 'Denominator list bounds every pair.'),
    ]),
    newLearning: f(
      'Start cue: two fractions with different numerators and denominators and a comparison prompt. Decision path: rewrite both over a common denominator via n/n scaling, then compare numerators. Response form: the recorded comparison with >, =, or < plus the rewritten pair.',
      [C.stein],
    ),
    approach: f(
      'Single strategy: common-denominator comparison (Stein: the least-common-denominator method; benchmark comparison recorded as an overruled interpretive stance). Model explicitly: pairs where the larger-looking fraction is smaller (5/6 vs 7/12 class) — misinterpretation risk. Extension: pairs sharing a denominator factor.',
      [C.stein, C.engineA5],
    ),
    nonGoals: f('Do not teach benchmark-half comparison as a parallel method (P3; progression stance logged and overruled); do not order more than two fractions; do not introduce addition of unlike denominators.', [C.stein]),
    ceiling: f('Hardest legitimate case (inferred): compare 5/6 and 7/12 class pairs — one denominator not a multiple of the other is excluded by the decomposition default, which no observed item overrides; justification sentence required at the upper demand tier.', [
      cite('interpretive', 'UA Progressions, NF 3–5', 'p. 7', 'Worked comparison examples — secondary rigor evidence.'),
    ], true),
    assessment: f('Students are able to: compare two fractions with unlike numerators and denominators by rewriting to a common denominator, record the result with >, =, or <, and justify the comparison, at ceiling difficulty, unassisted. Fluency flag: none.', [
      cite('standards', 'CCSS 4.NF.A.2', 'p. 30', 'Behavior from wording.'),
    ]),
    releasedItems: f('No in-boundary item exists for this key in either corpus — the field carries a generated ceiling exemplar (never empty).', [C.adminNotes], true),
  },
  [
    { n: 1, type: 'granularity', rule: 'A2', text: 'Split from U5.L1 on new decision step — choosing the common denominator and rewriting both fractions before any comparison can occur.', citations: [C.engineA2] },
    { n: 2, type: 'strategy', rule: 'P7', text: 'Progression prefers benchmark-half reasoning; conflict with Stein’s common-denominator method logged, Stein prevails (P3/P7). The unlike-denominator split stands under any strategy — the new decision step is rewriting to a common denominator either way.', citations: [C.stein, cite('interpretive', 'UA Progressions, NF 3–5', 'p. 7', 'Benchmark preference — recorded as inadmissible stance.')] },
    { n: 3, type: 'assumption', rule: 'D1', text: 'No observed item for 4.NF.2 (both corpora sample; gap acknowledged at publish). Anticipated-evidence inference from MCAS NF item styles, decomposition bounds, and progression worked problems; ceiling exemplar generated at the inferred demand.', citations: [C.adminNotes, cite('interpretive', 'UA Progressions, NF 3–5', 'p. 7', 'Worked problems used as secondary rigor evidence.')], flags: ['inferred', 'thin-evidence'] },
    { n: 4, type: 'contradiction', rule: 'P1', text: 'No contradictions encountered.', citations: [] },
  ],
  [],
  {
    generatedExemplar: {
      stem: 'Which symbol makes the comparison true?  5/6 ○ 7/12',
      answer: '>  (5/6 = 10/12, and 10/12 > 7/12)',
      demandProfile: 'unlike numerators and denominators, one denominator a multiple of the other, selected response with justification',
      basis: 'Extrapolated from MCAS NF selected-response styles and progression worked problems (secondary evidence); sample corpus weights toward analogous-component extrapolation (D1).',
    },
  },
)

// ---------- the scope ----------

export const seedScope: Scope = {
  id: 'scope-g4-course',
  setId: 'set-ccss-g4',
  title: 'Grade 4 Mathematics — Full Course',
  request: { mode: 'course', params: 'Grade 4 (all published domains)' },
  engineVersion: 'Engine v2.3 (compiled 2026-05-28)',
  doctrineVersions: ['DI BrainLift v1.8 (Stein et al. 2017)'],
  status: 'complete',
  version: 3,
  // U3.L3 / U3.L4 is protected by a hard split criterion (A2) — merges across it are guardrailed.
  protectedBoundaries: [['U3.L3', 'U3.L4']],
  creator: 'doreen.mayrell@learnwith.ai',
  updated: '2026-06-30',
  units: [
    {
      id: 'U1',
      title: 'Place Value to One Million',
      strand: 'Number & Operations in Base Ten',
      rationale:
        'Anchors the NBT strand. Traceable to Grade 4 critical area 1 (“generalize understanding of place value to 1,000,000”); progression stream NBT K–5. High-weight strand anchors the course opening.',
      lessons: [u1l1, u1l2, u1l3],
    },
    {
      id: 'U2',
      title: 'Multi-Digit Addition & Subtraction',
      strand: 'Number & Operations in Base Ten',
      rationale: 'Fluency standard 4.NBT.4 carries the strand forward; subtraction-across-zeros is a named preskill for division recording (U4).',
      lessons: [u2l1],
    },
    {
      id: 'U3',
      title: 'Multi-Digit Multiplication',
      strand: 'Number & Operations in Base Ten',
      rationale:
        'Critical area 1 continues: “develop fluency with efficient procedures for multiplying whole numbers.” Strand-coherent block over 4.NBT.5 with the 4.OA.3 application tier; preskills precede composites, algorithm precedes required representations (P3).',
      lessons: [u3l1, u3l2, flagship, u3l4, u3l5, u3l6, u3l7],
    },
    {
      id: 'U4',
      title: 'Multi-Digit Division',
      strand: 'Number & Operations in Base Ten',
      rationale: 'Closes the NBT.B arithmetic cluster; sequenced after multiplication (inverse-relationship preskills mastered).',
      lessons: [u4l1],
    },
    {
      id: 'U5',
      title: 'Fraction Equivalence & Ordering',
      strand: 'Number & Operations — Fractions',
      rationale: 'Critical area 2: “developing an understanding of fraction equivalence.” NF 3–5 progression stream; separated in time from NBT computation to protect the U3/U4 confusable window.',
      lessons: [u5l1, u5l2],
    },
  ],
  qc: [
    { name: 'Coverage matrix', status: 'pass', detail: 'Every in-scope content key lands in ≥1 atom; reasoning demands tracked as tiers (U3.L6) or application lessons (U3.L7); integrative key Int-4.c traced to U3.L7; no orphan atoms.' },
    { name: 'Prerequisite-chain validity', status: 'pass', detail: 'All 31 prerequisite references resolve to an earlier lesson or a prior-grade tag.' },
    { name: 'Atom-triple format', status: 'pass', detail: 'Start cue · single decision path · one response form present on all 12 New learning fields.' },
    { name: 'Single-strategy check', status: 'pass', detail: 'No Instructional Approach names two computation strategies.' },
    { name: 'Neighbor consistency', status: 'pass', detail: 'Boundaries and non-goals consistent with adjacent lessons; split pair U3.L3/U3.L4 + bridge U3.L5 partition cleanly.' },
    { name: 'Ceiling legality', status: 'pass', detail: 'All ceilings within standards-document limits (NBT ≤ 1,000,000; NF denominator list) and P1 evidence.' },
    { name: 'Theme coverage', status: 'pass', detail: 'Critical areas 1 and 2 trace to units U1–U4 and U5. Critical area 3 (geometry) outside this scope’s published evidence — surfaced at request time.' },
    { name: 'Citation completeness', status: 'flag', detail: 'All fields carry provenance. Surfaced (not buried): 6 lessons rely on anticipated-evidence inference (D1); U5.L1 relies on an unconfirmed ai-proposed alignment (D14).' },
    { name: 'Decision-record integrity', status: 'pass', detail: 'Field 13 present and non-empty on every card; the U3.L3 contradiction entry cites both sides; the U2.L1 P4 override is logged.' },
    { name: 'Released-items integrity', status: 'pass', detail: 'Field never empty: 6 cards carry captioned observed items; 6 carry a labeled generated ceiling exemplar with inference basis and in-boundary ceiling.' },
  ],
  history: [
    { version: 1, date: '2026-06-14', actor: 'doreen.mayrell@learnwith.ai', event: 'Generated', detail: 'Full-course generation. Engine v2.3, DI BrainLift v1.8. 11 lessons, 5 units.' },
    { version: 2, date: '2026-06-21', actor: 'doreen.mayrell@learnwith.ai', event: 'Rerun — more granular', detail: 'U3 rerun at higher granularity: preskill split U3.L1/U3.L2 extracted from the algorithm atom (foundational-preskill criterion). Relational fields of U3.L3–L7 auto-regenerated; changes noted in their Decision records.' },
    { version: 3, date: '2026-06-30', actor: 'doreen.mayrell@learnwith.ai', event: 'Data-informed revision accepted', detail: 'PerformanceReport on U3.L4 (partial-row misalignment): modeling intensified inside the atom per Editing Splits — no split (no new cue or decision step); alignment contrast cases added to the modeled set. Proposal accepted after one feedback round.' },
  ],
  proposals: [
    {
      id: 'prop-1',
      report: {
        id: 'pr-1',
        target: 'U3.L4',
        text: 'After two weeks of practice data: ~40% of students misalign the second partial row when the tens-digit product ends in zero (e.g., 34 × 25). Errors cluster on row placement, not on facts or regrouping.',
        actor: 'doreen.mayrell@learnwith.ai',
        date: '2026-06-28',
      },
      changes: [
        {
          target: 'U3.L4 · Instructional Approach',
          kind: 'modeling',
          before: 'Model explicitly: the placeholder zero in the second row; a second row whose product itself ends in zero…',
          after: 'Model explicitly: the placeholder zero in the second row; a second row whose product itself ends in zero — now with side-by-side aligned/misaligned contrast pairs and a column-grid scaffold faded across We Do…',
          rationale: 'Reported errors reveal no new start cue, decision step, or missing prerequisite — Editing Splits bar not met; intensify modeling inside the atom (contrasts, scaffolds).',
          rule: 'P9 / A3 (Editing Splits)',
        },
      ],
      ripple: ['U3.L5 (bridge) practice mix re-weighted toward second-row-zero cases — relational update, Decision record noted.'],
      status: 'accepted',
      rounds: [
        {
          feedback: 'Can we split the zero-ending second row into its own lesson?',
          response: 'Declined per Editing Splits (A3): the reported error reveals no new/unstable start cue, no new decision step or rule, and no missing prerequisite — the routine is identical; the failure is alignment execution. The bar gates splits; the fix is modeling intensification inside the atom. Criterion and evidence cited in the proposal diff.',
        },
      ],
    },
  ],
}

// systemArtifacts, exemplarRegister, and fieldMeta moved to ./meta.ts — this file
// now carries seed data only (consumed by the backend seed export, not the app).
