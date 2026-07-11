import * as fs from 'node:fs'
import * as path from 'node:path'

// Cover-to-cover textbook access (rulebook v2 §13.2, §19): the ENTIRE Stein
// 5th-edition text ships with the API (assets/textbook/ — all 18 chapters,
// Appendix A's CCSS→format map, Appendix B, page-stamped with book page
// numbers), so retrieval can pull from anywhere in the book. Per §13.5 the
// retrieval itself stays PAGE-TARGETED — a generation call never receives the
// whole book, only the slices this module serves: a chapter's instructional
// procedures (skill hierarchy, sequence & assessment chart, preskill lists,
// example-selection guidance, diagnosis-and-remediation tables), the pages
// around a matched format, and the Appendix A rows for a standard.

export interface TextbookSection {
  slug: string
  title: string
  bookPageStart: number
  bookPageEnd: number
  chars: number
}

interface TextbookIndex {
  source: string
  sections: TextbookSection[]
}

let indexCache: TextbookIndex | undefined
const textCache = new Map<string, string>()
let warned = false

const candidatesFor = (name: string): string[] => [
  path.resolve(__dirname, '..', '..', 'assets', 'textbook', name),
  path.resolve(__dirname, '..', '..', '..', 'assets', 'textbook', name),
]

export function textbookIndex(): TextbookIndex | undefined {
  if (indexCache) return indexCache
  for (const candidate of candidatesFor('index.json')) {
    try {
      indexCache = JSON.parse(fs.readFileSync(candidate, 'utf8')) as TextbookIndex
      return indexCache
    } catch {
      /* try the next location */
    }
  }
  if (!warned) {
    warned = true
    console.warn('textbook: assets/textbook/index.json could not be read — doctrine falls back to format scripts alone')
  }
  return undefined
}

export function sectionText(slug: string): string {
  const hit = textCache.get(slug)
  if (hit !== undefined) return hit
  for (const candidate of candidatesFor(`${slug}.txt`)) {
    try {
      const text = fs.readFileSync(candidate, 'utf8')
      textCache.set(slug, text)
      return text
    } catch {
      /* try the next location */
    }
  }
  textCache.set(slug, '')
  return ''
}

export const chapterSlug = (n: number): string => `chapter-${String(n).padStart(2, '0')}`

/** Cut at a paragraph boundary at or before `max` chars (mirrors doctrine.ts). */
export function cutAtParagraph(text: string, max: number): string {
  if (text.length <= max) return text
  const slice = text.slice(0, max)
  const cut = slice.lastIndexOf('\n\n')
  return cut > max * 0.5 ? slice.slice(0, cut) : slice
}

/**
 * The chapter's instructional front matter — everything BEFORE the verbatim
 * format scripts begin: skill hierarchy, instructional sequence & assessment
 * chart, conceptual understanding, instructional procedures, preskill
 * discussion, example-selection guidance, diagnosis-and-remediation tables.
 * The format scripts themselves are served verbatim from formats.json, so the
 * procedures slice stops where "Format N.1 <TITLE>" starts (the scripts
 * section closes every chapter).
 */
export function chapterProcedures(chapterNum: number, maxChars: number, focusTerms: string[] = []): string {
  const text = sectionText(chapterSlug(chapterNum))
  if (!text) return ''
  // The scripts section heading is a bare "Format N.M" line with the
  // two-column TEACHER header shortly after. Margin video callouts ("Format
  // 7.1B:\nEquality Rule\nWatch how …") carry a trailing colon and no TEACHER
  // header — they appear throughout the procedures text and must not stop
  // the slice.
  const heading = new RegExp(`^Format ${chapterNum}\\.\\d+[A-Z]?\\s*$`, 'gm')
  let cut = -1
  for (const m of text.matchAll(heading)) {
    if (m.index !== undefined && m.index > 2_000 && text.slice(m.index, m.index + 400).includes('TEACHER')) {
      cut = m.index
      break
    }
  }
  const front = cut > 0 ? text.slice(0, cut) : text
  if (front.length <= maxChars) return front
  // Oversized front (ch13's runs ~92k): a start-anchored cut would drop the
  // procedures for LATE-chapter skills entirely (a fraction-division lesson
  // losing the Dividing Fractions section and its remediation tables). Keep
  // the chapter head (skill hierarchy + sequence & assessment chart), then
  // center the remaining budget on the earliest focus-term hit beyond it.
  const headChars = Math.min(16_000, Math.floor(maxChars / 3))
  const lower = front.toLowerCase()
  let focusAt = -1
  for (const term of [...focusTerms].sort((a, b) => b.length - a.length)) {
    const t = term.trim().toLowerCase()
    if (t.length < 4) continue
    const at = lower.indexOf(t, headChars)
    if (at !== -1 && (focusAt === -1 || at < focusAt)) focusAt = at
  }
  if (focusAt === -1) return cutAtParagraph(front, maxChars)
  const head = cutAtParagraph(front, headChars)
  const windowBudget = maxChars - head.length - 20
  const winStart = Math.max(head.length, focusAt - Math.floor(windowBudget / 3))
  const window = cutAtParagraph(front.slice(winStart, winStart + windowBudget + Math.floor(windowBudget / 3)), windowBudget)
  return `${head}\n\n[…]\n\n${window}`
}

/** The `[p.N]` page blocks covering bookPage±radius — the discussion surrounding a matched format. */
export function pagesAround(chapterNum: number, bookPages: number[], radius: number, maxChars: number): string {
  const text = sectionText(chapterSlug(chapterNum))
  if (!text || bookPages.length === 0) return ''
  const wanted = new Set<number>()
  for (const p of bookPages) {
    for (let d = -radius; d <= radius; d++) wanted.add(p + d)
  }
  const blocks = text.split(/\n(?=\[p\.\d+\]\n)/)
  const out: string[] = []
  let used = 0
  for (const b of blocks) {
    const page = Number(/^\[p\.(\d+)\]/.exec(b)?.[1] ?? NaN)
    if (!Number.isFinite(page) || !wanted.has(page)) continue
    if (used + b.length > maxChars) break
    out.push(b)
    used += b.length
  }
  return out.join('\n')
}

/**
 * Appendix A rows for a standard's GRADE (the book's own CCSS→format map —
 * §19's second route into the book; the appendix covers K–5 only).
 *
 * The appendix's two-column layout extracts messily: domain codes sometimes
 * trail their section's prose as a bare line ("1.OA" after all eight 1.OA
 * standards), sometimes lead it, sometimes fuse a cluster letter ("3.NFA"),
 * and sometimes split ("5. MD"). Domain-level slicing against that soup
 * returned the WRONG rows under adversarial testing, so the slice is
 * per-GRADE: everything from the grade's first domain-code mention to its
 * last, with a lead buffer for prose that precedes a trailing code line. The
 * generation prompt tells the model to locate its standard's rows within.
 */
export function appendixAFor(standardId: string, maxChars: number): string {
  const text = sectionText('appendix-a')
  if (!text) return ''
  const raw = standardId.trim().toUpperCase().replace(/^CCSS\.MATH\.CONTENT\./, '')
  const grade = /^(K|[1-5])\b/.exec(raw)?.[1]
  if (!grade) return '' // grade 6+: Appendix A covers K–5 only — the §19 chapter table is the route
  const lines = text.split('\n')
  // A grade's territory = every line mentioning one of its domain codes
  // (K.CC/K.OA/K.NBT/K.MD/K.G, N.OA/N.NBT/N.NF/N.MD/N.G), tolerating a space
  // after the dot ("5. MD") and a fused cluster letter ("3.NFA").
  const codeOf = (g: string) => new RegExp(`\\b${g}\\.\\s?(CC|OA|NBT|NF|MD|G)[A-Z]?\\b`)
  const mine = codeOf(grade)
  const hits: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (mine.test(lines[i])) hits.push(i)
  }
  if (hits.length === 0) return ''
  const start = Math.max(0, hits[0] - 40)
  const end = Math.min(lines.length, hits[hits.length - 1] + 10)
  return cutAtParagraph(lines.slice(start, end).join('\n'), maxChars)
}
