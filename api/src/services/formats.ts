import * as fs from 'node:fs'
import * as path from 'node:path'
import { chapterTextOf, DoctrineQuery, matchChapters, truncateAtParagraph } from './doctrine'
import { appendixAFor, chapterProcedures } from './textbook'

// Page-targeted doctrine retrieval for the Video Script Generator (rulebook
// v2 §19 "Where to Look in the Book", §13.5): the ENTIRE Stein text is
// available (assets/textbook/ — cover to cover), but a generation call never
// sees the whole book. It gets (1) the VERBATIM teaching-format script(s) for
// the lesson's skill family from the shipped format library
// (assets/formats.json — all 122 two-column TEACHER/STUDENTS scripts,
// page-stamped), (2) the matching chapter's full instructional-procedures
// front (skill hierarchy, sequence & assessment chart, preskill lists,
// example-selection guidance, diagnosis-and-remediation tables — from the
// cover-to-cover corpus, stopping where the chapter's script section starts),
// and (3) the Appendix A rows for the lesson's standard (the book's own
// CCSS→format map; K-5 only — empty for middle grades, where the §19 chapter
// table is the route).

export interface FormatScript {
  /** Stein format number, e.g. "7.6" (letter suffixes for sub-parts: "7.1A"). */
  id: string
  /** The format's title as printed (e.g. "ADDING TWO NUMERALS WITH RENAMING"). */
  title: string
  /** 1-based PDF page of the 5th-edition text the script starts on. */
  page: number
  /** The verbatim script block (TEACHER/STUDENTS parts A–D as extracted). */
  text: string
}

export interface VideoDoctrine {
  chapterTitle: string
  /** Verbatim format scripts, best match first. */
  formats: FormatScript[]
  /**
   * True when no format title matched the lesson — the included scripts are
   * the skill family's nearest formats, supplied for wording style and
   * question cadence only (rulebook SEQ 05).
   */
  nearestOnly: boolean
  /** The chapter's instructional-procedures front from the cover-to-cover corpus. */
  chapterExcerpt: string
  /** Appendix A rows for the lesson's standard ('' when none — Appendix A covers K-5). */
  appendixA: string
}

/** Formats per lesson and per-format cap — keeps the doctrine block bounded. */
const MAX_FORMATS = 3
const FORMAT_CAP_CHARS = 16_000
const FORMATS_TOTAL_CHARS = 40_000
const CHAPTER_EXCERPT_CHARS = 48_000
const APPENDIX_A_CHARS = 14_000

let cached: FormatScript[] | undefined
let warnedMissing = false

function allFormats(): FormatScript[] {
  if (cached) return cached
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'formats.json'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'formats.json'),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { formats?: FormatScript[] }
      cached = Array.isArray(parsed.formats) ? parsed.formats : []
      return cached
    } catch {
      /* try the next location */
    }
  }
  if (!warnedMissing) {
    warnedMissing = true
    console.warn('formats: assets/formats.json could not be read — video generation proceeds on chapter excerpts alone')
  }
  return []
}

// Words too generic to signal a format match — every chapter's titles are
// full of them, and matching on them would pick formats arbitrarily.
// 'teacher'/'students' guard against residual column-header noise in titles.
const STOP_WORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'into', 'using', 'a', 'of', 'in', 'to', 'on', 'by',
  'number', 'numbers', 'numeral', 'numerals', 'problem', 'problems', 'digit', 'digits',
  'introducing', 'teaching', 'reading', 'writing', 'see', 'video', 'part', 'parts',
  'one', 'two', 'three', 'more', 'less', 'than', 'new', 'whole', 'single',
  'teacher', 'students', 'continued', 'remediation',
])

/**
 * Light stemmer so morphological variants meet on a shared stem: "adding" /
 * "add", "renaming" / "rename", "addition" / "add" (via 'ition'), "fractions"
 * / "fraction". Deliberately conservative — under-stemming loses a hit;
 * over-stemming selects a wrong-family format as primary doctrine.
 */
const SUFFIXES = ['ations', 'ation', 'ition', 'sions', 'sion', 'tions', 'tion', 'ings', 'ing', 'ers', 'er', 'ies', 'ied', 'ed', 'es', 's']
const stemOf = (w: string): string => {
  let out = w
  for (const suf of SUFFIXES) {
    if (out.length - suf.length >= 3 && out.endsWith(suf)) {
      out = out.slice(0, -suf.length)
      break
    }
  }
  if (out.length >= 4 && out.endsWith('e')) out = out.slice(0, -1)
  return out
}

const commonPrefixLen = (a: string, b: string): number => {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Numeric format-id order: 13.2 before 13.10 (localeCompare puts 13.10 first). */
const idOrder = (a: string, b: string): number => {
  const pa = /^(\d+)\.(\d+)([A-Z]?)/.exec(a)
  const pb = /^(\d+)\.(\d+)([A-Z]?)/.exec(b)
  if (!pa || !pb) return a.localeCompare(b)
  return (
    Number(pa[1]) - Number(pb[1]) ||
    Number(pa[2]) - Number(pb[2]) ||
    (pa[3] || '').localeCompare(pb[3] || '')
  )
}

const titleWords = (title: string): string[] =>
  title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ') // "(See Video in Part A)" is layout, not meaning
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))

/**
 * The video generator's doctrine block for one lesson: the matching chapter's
 * verbatim format scripts plus its procedures excerpt. `approachText` (the
 * card's Instructional Approach + New Learning) sharpens format selection —
 * "renaming" in the approach picks Format 7.6 over 7.2 inside Addition.
 */
export function videoDoctrineFor(query: DoctrineQuery, approachText: string): VideoDoctrine | undefined {
  const matched = matchChapters(query)
  if (matched.length === 0) return undefined
  const hayStems = new Set(
    `${query.unitTitle} ${query.lessonTitles.join(' ')} ${approachText}`
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((w) => w.length >= 3)
      .map(stemOf),
  )
  // Stem match: exact stem equality ("adding"/"add" → both 'add'), or a long
  // shared prefix (≥6) for variants stemming apart ("multiplying" 'multiply'
  // vs "multiplication" 'multiplic'). Never bare short prefixes — 'are' must
  // not hit 'area', 'ten' must not hit 'tenths'.
  const hayHas = (w: string): boolean => {
    const s = stemOf(w)
    if (hayStems.has(s)) return true
    for (const h of hayStems) {
      if (commonPrefixLen(h, s) >= 6) return true
    }
    return false
  }

  const scoreChapter = (slug: string) => {
    const chapterNum = /^ch(\d+)/.exec(slug)?.[1]
    const chapterFormats = chapterNum
      ? allFormats().filter((f) => f.id.split('.')[0] === String(Number(chapterNum)))
      : []
    const scored = chapterFormats
      .map((f) => {
        const words = titleWords(f.title)
        let hits = 0
        for (const w of words) if (hayHas(w)) hits++
        return { f, hits, ratio: words.length > 0 ? hits / words.length : 0 }
      })
      .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits || idOrder(a.f.id, b.f.id))
    return { scored, best: scored[0]?.ratio ?? 0 }
  }

  // The format titles themselves disambiguate among candidate chapters: the
  // keyword scorer can prefer a sibling chapter on generic hits (e.g. "2-Digit"
  // matched Place Value's digit* over Addition for a renaming-addition
  // lesson), but only the right chapter's format index carries a title like
  // "ADDING TWO NUMERALS WITH RENAMING". Among the top keyword matches, the
  // chapter whose formats best match the lesson wins.
  const candidates = matched.slice(0, 3).map((m) => ({ ...m, ...scoreChapter(m.slug) }))
  const primary = [...candidates].sort((a, b) => b.best - a.best || b.score - a.score)[0]
  const scored = primary.scored

  const matchedFormats = scored.filter((s) => s.hits > 0).slice(0, MAX_FORMATS)
  // No title matched: supply the family's leading formats for wording style
  // and cadence only (§5.4 — never borrow another family's content).
  const nearestOnly = matchedFormats.length === 0
  const chosen = (nearestOnly ? scored.slice(0, 2) : matchedFormats).map((s) => s.f)

  let remaining = FORMATS_TOTAL_CHARS
  const formats: FormatScript[] = []
  for (const f of chosen) {
    if (remaining <= 0) break
    const text = truncateAtParagraph(f.text, Math.min(FORMAT_CAP_CHARS, remaining))
    remaining -= text.length
    formats.push({ ...f, text })
  }

  // The cover-to-cover corpus is the primary chapter source (rulebook §13.2:
  // chapter procedures, preskill lists, example selection, diagnosis and
  // remediation); the curated doctrine excerpt remains the fallback if the
  // corpus is unreadable.
  const chapterNum = Number(/^ch(\d+)/.exec(primary.slug)?.[1] ?? NaN)
  // Focus terms steer the oversized-chapter window (ch13 fractions) onto the
  // lesson's own procedures: the matched format titles plus the lesson title.
  const focusTerms = [...chosen.map((f) => f.title), ...query.lessonTitles]
  const fromCorpus = Number.isFinite(chapterNum) ? chapterProcedures(chapterNum, CHAPTER_EXCERPT_CHARS, focusTerms) : ''
  const chapterExcerpt = fromCorpus || truncateAtParagraph(chapterTextOf(primary.slug) ?? '', CHAPTER_EXCERPT_CHARS)
  const appendixA = appendixAFor(query.standardCodes[0] ?? '', APPENDIX_A_CHARS)
  if (formats.length === 0 && chapterExcerpt.length === 0) return undefined
  return { chapterTitle: primary.title, formats, nearestOnly, chapterExcerpt, appendixA }
}
