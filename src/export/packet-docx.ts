// Word export for an evidence packet — opens in Word and converts to an
// editable Google Doc in Drive. Cover, coverage summary, grade/domain sections
// with the text facsimiles the web-hunting agent transcribed (stem, lettered
// choices, answer, linked source), and the gaps / inferred-alignment
// appendices. Loaded lazily so the docx library stays out of the main bundle.
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { choiceLetter, packetCoverageOf } from '../packets'
import type { EvidencePacket, HuntedItem } from '../types'
import { capsStandardCodes } from '../ui'

const INK = '23232B'
const INK2 = '5A5A66'
const ACCENT = '3F3FA8'
const AMBER = '9A6B15'
const GREEN = '2E6B4F'

// XML 1.0 forbids C0 control characters — docx does not filter them, so one
// stray byte in a transcription would make Word declare the whole file
// corrupt. The backend sanitizer strips them at ingestion; this guards
// packets persisted before it existed. Built via RegExp() so no literal
// control bytes live in this source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')
const xmlSafe = (text: string): string => text.replace(CONTROL_CHARS, ' ')

interface RunOpts {
  size?: number
  color?: string
  bold?: boolean
  italics?: boolean
}

/**
 * Newline-aware runs: docx keeps a raw \n inside w:t, which Word renders as
 * nothing — multi-part stems (Part A / Part B) would silently run together.
 * Each line becomes a run with an explicit line break.
 */
const textRuns = (text: string, opts?: RunOpts): TextRun[] =>
  xmlSafe(text)
    .split('\n')
    .map(
      (line, i) =>
        new TextRun({
          text: line,
          break: i > 0 ? 1 : undefined,
          size: opts?.size ?? 21,
          color: opts?.color ?? INK,
          bold: opts?.bold,
          italics: opts?.italics,
        }),
    )

const para = (text: string, opts?: RunOpts & { before?: number; after?: number }): Paragraph =>
  new Paragraph({
    spacing: { before: opts?.before ?? 0, after: opts?.after ?? 60 },
    children: textRuns(text, opts),
  })

const heading1 = (text: string, pageBreak = false): Paragraph =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: pageBreak,
    spacing: { after: 80 },
    children: [new TextRun({ text: xmlSafe(text), bold: true, color: ACCENT })],
  })

const summaryCell = (text: string, header = false): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: xmlSafe(text), size: 18, bold: header, color: header ? INK2 : INK })],
      }),
    ],
  })

// Explicit list, never a range: [3, 8] must read "Grades 3, 8" — a dash would
// claim coverage of grades that were never selected.
const gradesLabel = (grades: number[]): string =>
  grades.length === 0 ? '' : grades.length === 1 ? `Grade ${grades[0]}` : `Grades ${grades.join(', ')}`

export async function buildPacketDocxBlob(packet: EvidencePacket): Promise<Blob> {
  const coverage = packetCoverageOf(packet)
  const children: (Paragraph | Table)[] = []

  // ---- cover ----
  children.push(
    para('Released Item Repository', { size: 18, color: INK2, after: 40 }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: xmlSafe(capsStandardCodes(packet.title)), bold: true, size: 52, color: INK })],
    }),
    para(
      `Released assessment items for ${packet.frameworkLabel} (${gradesLabel(packet.grades)}), located on the public web by a research agent and transcribed faithfully — organized by grade, domain, and standard, with a link to every source.`,
      { size: 21, color: INK2, after: 160 },
    ),
    para(
      `${coverage.stats.items} released item${coverage.stats.items === 1 ? '' : 's'} · ${coverage.stats.standardsCovered} of ${coverage.stats.standardsTotal} standards covered · ${coverage.stats.sources} source${coverage.stats.sources === 1 ? '' : 's'} · administration years ${coverage.stats.yearSpan}`,
      { size: 21, bold: true, after: 120 },
    ),
    para(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { size: 18, color: INK2, after: 30 }),
    ...(packet.years.length > 0
      ? [para(`Administration years hunted (hard filter): ${[...packet.years].sort((a, b) => b - a).join(', ')}`, { size: 18, color: INK2, after: 30 })]
      : []),
    para(
      'Every item is a text facsimile transcribed from the linked source document — verify against the source before classroom use. Alignments marked "ai-inferred" are the agent\'s judgment and are never official.',
      { size: 17, color: INK2, italics: true, after: 160 },
    ),
  )

  // ---- coverage summary ----
  children.push(heading1('Coverage Summary', true))
  if (coverage.summaryRows.length === 0) {
    children.push(
      para('The agent found no released items for this selection — the standards listed below are documentation gaps.', {
        size: 19,
        color: INK2,
        after: 120,
      }),
    )
  } else {
    children.push(
      para('Every standard with released evidence, with the assessment programs and years represented.', { size: 19, color: INK2, after: 120 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true, // repeat the header row on every page of a long table
            children: ['Standard', 'Grade', 'Items', 'Programs', 'Years'].map((h) => summaryCell(h, true)),
          }),
          ...coverage.summaryRows.map(
            (r) =>
              new TableRow({
                children: [
                  summaryCell(r.standard.code),
                  summaryCell(`Grade ${r.standard.grade}`),
                  summaryCell(String(r.items.length)),
                  summaryCell(r.programs.join(', ') || '—'),
                  summaryCell(r.years.join(', ') || '—'),
                ],
              }),
          ),
        ],
      }),
    )
  }
  if (coverage.gaps.length > 0) {
    children.push(
      para('Standards with no released evidence found online (documentation gaps, not unimportance):', {
        size: 19,
        color: AMBER,
        bold: true,
        before: 160,
        after: 40,
      }),
      ...coverage.gaps.map((g) => para(`${g.code} — ${g.text.slice(0, 160)}${g.text.length > 160 ? '…' : ''}`, { size: 18, color: INK2, after: 30 })),
    )
  }

  // ---- grade/domain sections ----
  for (const sec of coverage.sections) {
    children.push(heading1(`Grade ${sec.grade} — ${sec.domainName}`, true))
    for (const row of sec.rows) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 30 },
          children: [new TextRun({ text: row.standard.code, bold: true, color: INK })],
        }),
        para(row.standard.text, { size: 19, color: INK2, after: 40 }),
        para(`${row.items.length} item${row.items.length === 1 ? '' : 's'}`, { size: 17, color: INK2, after: 80 }),
      )
      for (const item of row.items) {
        children.push(...itemBlock(item))
      }
    }
  }

  // ---- inferred alignments ----
  if (coverage.unconfirmed.length > 0) {
    children.push(
      heading1('Items With Inferred Alignment', true),
      para(
        'The source did not label these items with a standard code — the agent judged the alignment from the item content. Usable as evidence, flagged for human confirmation, never official.',
        { size: 19, color: INK2, after: 120 },
      ),
      ...coverage.unconfirmed.map((i) =>
        para(
          `${i.program || i.sourceName}${i.year > 0 ? ` ${i.year}` : ''}${i.itemNumber ? ` Q${i.itemNumber}` : ''} → ${i.standardCode}`,
          { size: 18, after: 30 },
        ),
      ),
    )
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

function itemBlock(item: HuntedItem): Paragraph[] {
  const header = [item.program || item.sourceName, item.year > 0 ? String(item.year) : '', item.itemNumber ? `Q${item.itemNumber}` : '']
    .filter(Boolean)
    .join(' · ')
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: xmlSafe(header), bold: true, size: 18, color: INK2 }),
        new TextRun({
          text: `   ${item.alignment === 'official' ? 'alignment: official' : 'alignment: ai-inferred (not official)'}`,
          size: 16,
          color: item.alignment === 'official' ? INK2 : AMBER,
        }),
      ],
    }),
    para(item.stem, { size: 20, after: 40 }),
  ]
  item.choices.forEach((choice, i) => {
    out.push(
      new Paragraph({
        indent: { left: 360 },
        spacing: { after: 20 },
        children: textRuns(`${choiceLetter(i)}. ${choice}`, { size: 19, color: INK }),
      }),
    )
  })
  if (item.itemType === 'constructed-response' && item.choices.length === 0) {
    out.push(para('Constructed response — students produce the answer; see the source for the rubric.', { size: 17, color: INK2, italics: true, after: 30 }))
  }
  if (item.answer) {
    out.push(
      new Paragraph({
        spacing: { after: 30 },
        children: [
          new TextRun({ text: 'Answer: ', bold: true, size: 18, color: GREEN }),
          ...textRuns(item.answer, { size: 18, color: INK }),
        ],
      }),
    )
  }
  const metaRuns: (TextRun | ExternalHyperlink)[] = [
    new TextRun({ text: `${item.itemType} · source: `, size: 16, color: INK2 }),
    new ExternalHyperlink({
      link: xmlSafe(item.sourceUrl),
      children: [new TextRun({ text: xmlSafe(item.sourceName || item.sourceUrl), size: 16, color: ACCENT, underline: {} })],
    }),
  ]
  if (item.notes) metaRuns.push(new TextRun({ text: xmlSafe(` · ${item.notes}`), size: 16, color: INK2 }))
  out.push(new Paragraph({ spacing: { after: 140 }, children: metaRuns }))
  return out
}

export async function downloadPacketDocx(packet: EvidencePacket): Promise<void> {
  const blob = await buildPacketDocxBlob(packet)
  const name = `${capsStandardCodes(packet.title).replace(/[\\/:*?"<>|]+/g, '-')}.docx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Dev-only hook for end-to-end verification from the preview browser.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__buildPacketDocxBlob = buildPacketDocxBlob
}
