// PDF rendering of an evidence packet — how a Released Item Repository
// Generator run gets filed into the Reference Library's Released Items slot
// (the library and the ingestion pipeline only speak PDF). Mirrors the Word
// export's structure: cover, coverage summary, grade/domain sections with each
// item's captured screenshot (embedded) or transcribed text facsimile, answer
// and source either way, and the gaps / inferred-alignment appendices. Loaded
// lazily so pdf-lib stays out of the main bundle.
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts, type RGB } from 'pdf-lib'
import { choiceLetter, packetCoverageOf } from '../packets'
import type { EvidencePacket, HuntedItem } from '../types'
import { capsStandardCodes } from '../ui'
import type { ShotImage } from './packet-images'

const hex = (h: string): RGB => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
const INK = hex('23232B')
const INK2 = hex('5A5A66')
const ACCENT = hex('3F3FA8')
const AMBER = hex('9A6B15')
const GREEN = hex('2E6B4F')

// The standard PDF fonts only speak WinAnsi — an unencodable character makes
// pdf-lib throw mid-document. Common math/typography symbols map to ASCII
// stand-ins; anything else outside WinAnsi becomes '?'.
const REPLACEMENTS: [RegExp, string][] = [
  [/\u2212/g, '-'],
  [/\u2264/g, '<='],
  [/\u2265/g, '>='],
  [/\u2260/g, '!='],
  [/\u2248/g, '~'],
  [/\u221A/g, 'sqrt'],
  [/\u03C0/g, 'pi'],
  [/[\u2192\u27F6]/g, '->'],
  [/\t/g, '  '],
  [/[\u2000-\u200B\u202F\u00A0]/g, ' '],
]
// Keep printable ASCII, Latin-1, the WinAnsi 0x80-region extras (smart quotes,
// dashes, ellipsis, bullet, euro...), and \n (the line splitter).
const NON_WINANSI =
  /[^\n\x20-\x7E\u00A1-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/g

const safe = (text: string): string => {
  let out = text.replace(/\r\n?/g, '\n')
  for (const [re, sub] of REPLACEMENTS) out = out.replace(re, sub)
  return out.replace(NON_WINANSI, '?')
}

/** Greedy word wrap by measured width; a word wider than the column gets its own (overflowing) line. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const words = raw.split(/ +/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word
      if (line === '' || font.widthOfTextAtSize(probe, size) <= width) line = probe
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

const PAGE_W = 612 // US Letter
const PAGE_H = 792
const MARGIN_X = 54
const MARGIN_TOP = 60
const MARGIN_BOTTOM = 56
const CONTENT_W = PAGE_W - MARGIN_X * 2

interface TextOpts {
  size?: number
  font?: 'regular' | 'bold' | 'italic'
  color?: RGB
  indent?: number
  after?: number
}

class Writer {
  page!: PDFPage
  y = 0
  readonly doc: PDFDocument
  readonly fonts: Record<'regular' | 'bold' | 'italic', PDFFont>

  constructor(doc: PDFDocument, fonts: Record<'regular' | 'bold' | 'italic', PDFFont>) {
    this.doc = doc
    this.fonts = fonts
    this.addPage()
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN_TOP
  }

  /** Page-break-before semantics: start a fresh page unless already at the top of one. */
  breakPage() {
    if (this.y < PAGE_H - MARGIN_TOP) this.addPage()
  }

  private ensure(h: number) {
    if (this.y - h < MARGIN_BOTTOM) this.addPage()
  }

  text(raw: string, opts: TextOpts = {}) {
    const size = opts.size ?? 10.5
    const font = this.fonts[opts.font ?? 'regular']
    const color = opts.color ?? INK
    const indent = opts.indent ?? 0
    const lineH = size * 1.35
    for (const line of wrap(safe(raw), font, size, CONTENT_W - indent)) {
      this.ensure(lineH)
      this.y -= lineH
      if (line) this.page.drawText(line, { x: MARGIN_X + indent, y: this.y, size, font, color })
    }
    this.y -= opts.after ?? 3
  }

  /** Captured at 150 DPI (viewportScale 2) — halving the pixel size restores true print size. */
  image(img: PDFImage, shot: ShotImage, after = 8) {
    let w = shot.width / 2
    let h = shot.height / 2
    const scale = Math.min(1, CONTENT_W / w, (PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / h)
    w *= scale
    h *= scale
    this.ensure(h)
    this.y -= h
    this.page.drawImage(img, { x: MARGIN_X, y: this.y, width: w, height: h })
    this.y -= after
  }

  gap(h: number) {
    this.y -= h
  }

  heading1(text: string, pageBreak = false) {
    if (pageBreak) this.breakPage()
    this.text(text, { size: 15, font: 'bold', color: ACCENT, after: 6 })
  }
}

// Explicit list, never a range: [3, 8] must read "Grades 3, 8" — a dash would
// claim coverage of grades that were never selected.
const gradesLabel = (grades: number[]): string =>
  grades.length === 0 ? '' : grades.length === 1 ? `Grade ${grades[0]}` : `Grades ${grades.join(', ')}`

async function itemBlock(w: Writer, item: HuntedItem, image: ShotImage | undefined, embedded: Map<string, PDFImage>) {
  const header = [item.program || item.sourceName, item.year > 0 ? String(item.year) : '', item.itemNumber ? `Q${item.itemNumber}` : '']
    .filter(Boolean)
    .join(' · ')
  const official = item.alignment === 'official'
  w.gap(6)
  w.text(`${header}   —   alignment: ${official ? 'official' : 'ai-inferred (not official)'}`, {
    size: 9,
    font: 'bold',
    color: official ? INK2 : AMBER,
    after: 4,
  })
  if (image) {
    let img = embedded.get(item.id)
    if (!img) {
      img = await w.doc.embedPng(image.data)
      embedded.set(item.id, img)
    }
    w.image(img, image)
  } else {
    w.text(item.stem, { size: 10, after: 3 })
    item.choices.forEach((choice, i) => {
      w.text(`${choiceLetter(i)}. ${choice}`, { size: 9.5, indent: 18, after: 1 })
    })
    if (item.itemType === 'constructed-response' && item.choices.length === 0) {
      w.text('Constructed response — students produce the answer; see the source for the rubric.', {
        size: 8.5,
        font: 'italic',
        color: INK2,
        after: 2,
      })
    }
    w.gap(2)
  }
  if (item.answer) w.text(`Answer: ${item.answer}`, { size: 9, color: GREEN, after: 2 })
  w.text(`${item.itemType} · source: ${item.sourceName || item.sourceUrl}${item.sourceName ? ` — ${item.sourceUrl}` : ''}${item.notes ? ` · ${item.notes}` : ''}`, {
    size: 8,
    color: INK2,
    after: 8,
  })
}

export async function buildPacketPdfBlob(
  packet: EvidencePacket,
  images: Map<string, ShotImage> = new Map(),
): Promise<Blob> {
  const coverage = packetCoverageOf(packet)
  const doc = await PDFDocument.create()
  doc.setTitle(safe(capsStandardCodes(packet.title)))
  doc.setCreator('ScopeGenerator — Released Item Repository Generator')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
  const w = new Writer(doc, fonts)

  // ---- cover ----
  w.text('Released Item Repository', { size: 9, color: INK2, after: 6 })
  w.text(capsStandardCodes(packet.title), { size: 24, font: 'bold', after: 10 })
  w.text(
    `Released assessment items for ${packet.frameworkLabel} (${gradesLabel(packet.grades)}), located on the public web by a research agent and transcribed faithfully — organized by grade, domain, and standard, with a link to every source.`,
    { size: 10.5, color: INK2, after: 10 },
  )
  w.text(
    `${coverage.stats.items} released item${coverage.stats.items === 1 ? '' : 's'} · ${coverage.stats.standardsCovered} of ${coverage.stats.standardsTotal} standards covered · ${coverage.stats.sources} source${coverage.stats.sources === 1 ? '' : 's'} · administration years ${coverage.stats.yearSpan}`,
    { size: 10.5, font: 'bold', after: 8 },
  )
  w.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    size: 9,
    color: INK2,
    after: 2,
  })
  if (packet.years.length > 0) {
    w.text(`Administration years hunted (hard filter): ${[...packet.years].sort((a, b) => b - a).join(', ')}`, {
      size: 9,
      color: INK2,
      after: 2,
    })
  }
  w.text(
    'Items show the actual screenshot cropped from the source document where one could be captured, and a faithful text transcription otherwise — verify against the source before classroom use. Alignments marked "ai-inferred" are the agent\'s judgment and are never official.',
    { size: 8.5, font: 'italic', color: INK2, after: 10 },
  )

  // ---- coverage summary ----
  w.heading1('Coverage Summary', true)
  if (coverage.summaryRows.length === 0) {
    w.text('The agent found no released items for this selection — the standards listed below are documentation gaps.', {
      size: 9.5,
      color: INK2,
      after: 8,
    })
  } else {
    w.text('Every standard with released evidence, with the assessment programs and years represented.', {
      size: 9.5,
      color: INK2,
      after: 8,
    })
    for (const r of coverage.summaryRows) {
      w.text(
        `${r.standard.code} · Grade ${r.standard.grade} · ${r.items.length} item${r.items.length === 1 ? '' : 's'} · ${r.programs.join(', ') || '—'} · ${r.years.join(', ') || '—'}`,
        { size: 9, after: 1 },
      )
    }
  }
  if (coverage.gaps.length > 0) {
    w.gap(10)
    w.text('Standards with no released evidence found online (documentation gaps, not unimportance):', {
      size: 9.5,
      font: 'bold',
      color: AMBER,
      after: 4,
    })
    for (const g of coverage.gaps) {
      w.text(`${g.code} — ${g.text.slice(0, 160)}${g.text.length > 160 ? '…' : ''}`, { size: 9, color: INK2, after: 1 })
    }
  }

  // ---- grade/domain sections ----
  const embedded = new Map<string, PDFImage>()
  for (const sec of coverage.sections) {
    w.heading1(`Grade ${sec.grade} — ${sec.domainName}`, true)
    for (const row of sec.rows) {
      w.gap(10)
      w.text(row.standard.code, { size: 12, font: 'bold', after: 2 })
      w.text(row.standard.text, { size: 9.5, color: INK2, after: 2 })
      w.text(`${row.items.length} item${row.items.length === 1 ? '' : 's'}`, { size: 8.5, color: INK2, after: 4 })
      for (const item of row.items) {
        await itemBlock(w, item, images.get(item.id), embedded)
      }
    }
  }

  // ---- inferred alignments ----
  if (coverage.unconfirmed.length > 0) {
    w.heading1('Items With Inferred Alignment', true)
    w.text(
      'The source did not label these items with a standard code — the agent judged the alignment from the item content. Usable as evidence, flagged for human confirmation, never official.',
      { size: 9.5, color: INK2, after: 8 },
    )
    for (const i of coverage.unconfirmed) {
      w.text(
        `${i.program || i.sourceName}${i.year > 0 ? ` ${i.year}` : ''}${i.itemNumber ? ` Q${i.itemNumber}` : ''} -> ${i.standardCode}`,
        { size: 9, after: 1 },
      )
    }
  }

  const bytes = await doc.save()
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

/** Library-safe file name for a packet PDF (no path separators, no '..'). */
export const packetPdfFileName = (packet: EvidencePacket): string =>
  `${capsStandardCodes(packet.title).replace(/[\\/:*?"<>|]+/g, '-').replace(/\.{2,}/g, '.')}.pdf`
