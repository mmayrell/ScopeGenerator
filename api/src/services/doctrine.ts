import * as fs from 'node:fs'
import * as path from 'node:path'

// Doctrine consultation: topical chapter excerpts from Stein, Kinder, Silbert
// & Carnine, Direct Instruction Mathematics (5th ed.) — the controlling method
// authority — extracted to assets/doctrine/ and shipped with the API. Card
// generation selects the chapters matching a unit's standards and topics and
// receives their instructional procedures and teaching formats verbatim, so
// the Instructional Approach is drawn from the book rather than a paraphrase.

interface DoctrineChapter {
  slug: string
  title: string
  /** CCSS domain letters that point at this chapter (from standard codes). */
  domains: string[]
  /**
   * Topic keywords matched as EXACT words/phrases against unit + lesson
   * titles (a trailing * allows suffixes). Exact-word matching is load-bearing:
   * prefix matching pulled the Time chapter into "Times as Many" units and
   * bare generic words ("measure", "data") fired on every strand name.
   */
  keywords: string[]
}

const CHAPTERS: DoctrineChapter[] = [
  { slug: 'ch04-counting', title: 'Counting', domains: ['CC'], keywords: ['rote counting', 'skip counting', 'skip count', 'count by', 'counting backward', 'counting on', 'ordinal'] },
  { slug: 'ch05-place-value', title: 'Symbol Identification and Place Value', domains: ['NBT'], keywords: ['place value', 'place-value', 'numeration', 'expanded form', 'round', 'rounding', 'compare multi-digit', 'read and write', 'ten times', 'base ten', 'base-ten', 'digit*'] },
  { slug: 'ch06-basic-facts', title: 'Basic Facts', domains: [], keywords: ['basic fact*', 'fact fluency', 'math fact*', 'fact famil*'] },
  { slug: 'ch07-addition', title: 'Addition', domains: [], keywords: ['addition', 'adding', 'add', 'addend*', 'sum', 'sums'] },
  { slug: 'ch08-subtraction', title: 'Subtraction', domains: [], keywords: ['subtraction', 'subtract', 'subtracting', 'difference*', 'regroup*'] },
  { slug: 'ch09-multiplication', title: 'Multiplication', domains: [], keywords: ['multiplication', 'multiply', 'multiplying', 'multiplicative', 'product*', 'factor*', 'times as many', 'times as much'] },
  { slug: 'ch10-division', title: 'Division', domains: [], keywords: ['division', 'divide', 'dividing', 'divisor*', 'dividend*', 'quotient*', 'remainder*'] },
  { slug: 'ch11-problem-solving', title: 'Problem Solving', domains: ['OA'], keywords: ['word problem*', 'problem solving', 'problem-solving', 'multi-step', 'multistep', 'two-step', 'comparison problem*', 'story problem*'] },
  { slug: 'ch12-measurement-time-money', title: 'Measurement, Time, and Money', domains: ['MD'], keywords: ['time', 'elapsed', 'clock*', 'money', 'coin*', 'dollar*', 'length*', 'mass', 'liquid volume', 'capacity', 'convert*', 'conversion*', 'measurement unit*', 'kilometer*', 'centimeter*', 'gram*', 'liter*'] },
  // GCF/LCM: Stein teaches greatest common factor and least common multiple
  // inside the Fractions chapter (reducing and common denominators) — without
  // these keywords a "GCF and LCM" unit matched only Multiplication's "factor*".
  { slug: 'ch13-fractions', title: 'Fractions', domains: ['NF'], keywords: ['fraction*', 'numerator*', 'denominator*', 'mixed number*', 'equivalent', 'equivalence', 'greatest common factor', 'least common multiple', 'gcf', 'lcm'] },
  { slug: 'ch14-decimals', title: 'Decimals', domains: [], keywords: ['decimal*', 'tenths', 'hundredths'] },
  { slug: 'ch15-percent-ratio-probability', title: 'Percent, Ratio, and Probability', domains: ['RP'], keywords: ['percent*', 'ratio', 'ratios', 'rate', 'rates', 'probability', 'proportion*'] },
  { slug: 'ch16-data-analysis', title: 'Data Analysis', domains: ['SP'], keywords: ['data', 'graph*', 'line plot*', 'mean', 'median', 'statistic*', 'frequency'] },
  // Angles, perimeter, and area file under MD in CCSS, so Geometry carries MD too.
  { slug: 'ch17-geometry', title: 'Geometry', domains: ['G', 'MD'], keywords: ['geometry', 'geometric', 'angle*', 'shape*', 'symmetry', 'symmetric', 'triangle*', 'quadrilateral*', 'polygon*', 'perimeter', 'area', 'perpendicular', 'parallel', 'protractor*'] },
  { slug: 'ch18-pre-algebra', title: 'Pre-algebra', domains: ['EE', 'NS', 'F'], keywords: ['pre-algebra', 'algebra', 'algebraic', 'expression*', 'variable*', 'integer*', 'coordinate*', 'pattern*', 'function*', 'exponent*', 'square root*', 'absolute value*', 'inequalit*', 'equation*', 'order of operations'] },
]

// Two chapters cover a unit comfortably; the shared budget keeps the prompt
// bounded — long chapters are cut at a paragraph boundary with a marker.
// 150k chars ≈ 38k tokens: with the engine document (~23k chars), the card
// rules, and the evidence JSON, a cards call stays comfortably inside the
// model's 200k-token context. The budget is allocated by match score — the
// primary chapter (the one the strategy is selected from) gets up to
// PRIMARY_CAP_CHARS so it ships whole or nearly whole (the longest chapter,
// Fractions, is ~149k; most are 45–100k), and the secondary keeps the rest.
const MAX_CHAPTERS = 2
const TOTAL_BUDGET_CHARS = 150_000
const PRIMARY_CAP_CHARS = 110_000

const cache = new Map<string, string>()
const warned = new Set<string>()

function chapterText(slug: string): string | undefined {
  const hit = cache.get(slug)
  if (hit !== undefined) return hit
  // Compiled location is dist/src/services/; the library lives at dist/assets/
  // (copied by the build) with api/assets/ as the source-tree fallback.
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'doctrine', `${slug}.txt`),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'doctrine', `${slug}.txt`),
  ]
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8')
      cache.set(slug, text) // cache successes only — a transient read error must not poison the worker for its lifetime
      return text
    } catch (e) {
      lastError = e
    }
  }
  if (!warned.has(slug)) {
    warned.add(slug)
    console.warn(`doctrine: chapter ${slug} could not be read — generation proceeds without it: ${String(lastError)}`)
  }
  return undefined
}

const truncateAtParagraph = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('\n', max)
  return `${text.slice(0, cut > max / 2 ? cut : max)}\n\n[… chapter text truncated for length — the procedures above are the primary formats]`
}

export interface DoctrineQuery {
  unitTitle: string
  strand: string
  lessonTitles: string[]
  standardCodes: string[]
}

/**
 * Returns the doctrine block for a unit's card generation: the top-matching
 * chapter excerpts, or undefined when nothing matches (or the library is
 * missing — a degraded deploy must not fail generation).
 */
export function doctrineExcerptsFor(query: DoctrineQuery): string | undefined {
  // Titles only — strand names ("Measurement and Data", "Operations and
  // Algebraic Thinking") are domain labels, and matching keywords against them
  // pulled the wrong chapters into every unit of a strand. Domains from the
  // standard codes carry that signal instead.
  const haystack = `${query.unitTitle} ${query.lessonTitles.join(' ')}`.toLowerCase()
  const domains = new Set(
    query.standardCodes
      .map((c) => /(?:^|\.)(CC|OA|NBT|NF|MD|RP|NS|EE|G|SP|F)(?:\.|$)/i.exec(c)?.[1]?.toUpperCase())
      .filter((d): d is string => !!d),
  )
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Exact word/phrase match; a trailing * on the keyword allows suffixes.
  const matches = (kw: string): boolean => {
    const trimmed = kw.trim()
    const prefix = trimmed.endsWith('*')
    const escaped = escape(prefix ? trimmed.slice(0, -1) : trimmed)
    return new RegExp(`\\b${escaped}${prefix ? '\\w*' : '\\b'}`).test(haystack)
  }
  const scored = CHAPTERS.map((ch) => {
    let score = 0
    for (const kw of ch.keywords) if (matches(kw)) score += 3
    for (const d of ch.domains) if (domains.has(d)) score += 2
    return { ch, score }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHAPTERS)

  const texts = scored
    .map((s) => ({ title: s.ch.title, text: chapterText(s.ch.slug) }))
    .filter((t): t is { title: string; text: string } => !!t.text)
  if (texts.length === 0) return undefined

  // Score-ordered allocation: the best match takes what it needs (capped so a
  // long primary cannot starve the secondary); later chapters share what's left.
  let remaining = TOTAL_BUDGET_CHARS
  const blocks: string[] = []
  for (let i = 0; i < texts.length; i++) {
    const cap = i === texts.length - 1 ? remaining : Math.min(remaining, PRIMARY_CAP_CHARS)
    const body = truncateAtParagraph(texts[i].text, cap)
    remaining = Math.max(0, remaining - body.length)
    blocks.push(`--- Doctrine chapter: ${texts[i].title} ---\n${body}`)
  }
  return blocks.join('\n\n')
}
