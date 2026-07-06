// Word export for an evidence packet — opens in Word and converts to an
// editable Google Doc in Drive. Cover, coverage summary, grade sections with
// real released-item screenshots (text stand-ins when an image fails), and
// the gaps / unconfirmed-alignment appendices. Loaded lazily so the docx
// library stays out of the main bundle.
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { api } from '../api'
import type { PacketItem, PacketModel } from '../packets'
import { capsStandardCodes } from '../ui'

const INK = '23232B'
const INK2 = '5A5A66'
const ACCENT = '3F3FA8'
const AMBER = '9A6B15'

const CONTENT_WIDTH_PX = 600
const MAX_HEIGHT_PX = 820 // printable page height headroom

interface LoadedImage {
  data: ArrayBuffer
  width: number
  height: number
}

async function loadImage(url: string): Promise<LoadedImage | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    // Clamp BOTH dimensions: Word clips (not shrinks) inline images taller
    // than the printable page area, silently truncating tall multi-part items.
    const scale = Math.min(1, CONTENT_WIDTH_PX / bitmap.width, MAX_HEIGHT_PX / bitmap.height)
    const dims = { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) }
    bitmap.close()
    return { data: await blob.arrayBuffer(), ...dims }
  } catch {
    return undefined
  }
}

const para = (text: string, opts?: { size?: number; color?: string; bold?: boolean; italics?: boolean; before?: number; after?: number }): Paragraph =>
  new Paragraph({
    spacing: { before: opts?.before ?? 0, after: opts?.after ?? 60 },
    children: [
      new TextRun({
        text,
        size: opts?.size ?? 21,
        color: opts?.color ?? INK,
        bold: opts?.bold,
        italics: opts?.italics,
      }),
    ],
  })

const heading1 = (text: string, pageBreak = false): Paragraph =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: pageBreak,
    spacing: { after: 80 },
    children: [new TextRun({ text, bold: true, color: ACCENT })],
  })

const summaryCell = (text: string, header = false): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text, size: 18, bold: header, color: header ? INK2 : INK })],
      }),
    ],
  })

export async function buildPacketDocxBlob(model: PacketModel): Promise<Blob> {
  // Pre-fetch screenshots in small batches.
  const withImage = model.sections.flatMap((sec) => sec.standards.flatMap((st) => st.items)).filter((pi) => pi.item.imagePath)
  const images = new Map<string, LoadedImage>()
  for (let i = 0; i < withImage.length; i += 4) {
    const batch = withImage.slice(i, i + 4)
    const loaded = await Promise.all(batch.map((pi) => loadImage(api.itemImageUrl(pi.setId, pi.item.id))))
    batch.forEach((pi, j) => {
      const img = loaded[j]
      if (img) images.set(pi.item.id, img)
    })
  }

  const children: (Paragraph | Table)[] = []

  // ---- cover ----
  children.push(
    para('Released Item Repository', { size: 18, color: INK2, after: 40 }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: capsStandardCodes(model.title), bold: true, size: 52, color: INK })],
    }),
    para(
      'How each standard has been assessed across the released items in the evidence corpus — organized by grade and standard, with item screenshots, metadata, and alignment evidence.',
      { size: 21, color: INK2, after: 160 },
    ),
    para(
      `${model.stats.items} assessment item${model.stats.items === 1 ? '' : 's'} · ${model.stats.standards} standard${model.stats.standards === 1 ? '' : 's'} · ${model.stats.sources} source${model.stats.sources === 1 ? '' : 's'} · administration years ${model.stats.yearSpan}`,
      { size: 21, bold: true, after: 120 },
    ),
    para(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { size: 18, color: INK2, after: 30 }),
    para(`Selection scope: ${model.filtersUsed}`, { size: 18, color: INK2, after: 60 }),
    para(
      'Item images are screenshots of official released materials as uploaded to the evidence corpus. Alignments marked "ai-proposed" are model-generated and are never official.',
      { size: 17, color: INK2, italics: true, after: 160 },
    ),
  )

  // ---- coverage summary ----
  children.push(heading1('Coverage Summary', true))
  if (model.summaryRows.length === 0) {
    children.push(
      para('No released-item evidence in the current selection — the standards listed below are documentation gaps.', {
        size: 19,
        color: INK2,
        after: 120,
      }),
    )
  } else {
  children.push(
    para('Every standard covered in this packet, with the sources, years, and evidence types represented.', { size: 19, color: INK2, after: 120 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true, // repeat the header row on every page of a long table
          children: ['Standard', 'Grade', 'Items', 'Sources', 'Years', 'Evidence Types'].map((h) => summaryCell(h, true)),
        }),
        ...model.summaryRows.map(
          (r) =>
            new TableRow({
              children: [
                summaryCell(r.code),
                summaryCell(r.gradeLabel),
                summaryCell(String(r.itemCount)),
                summaryCell(r.sources.join(', ')),
                summaryCell(r.years.join(', ')),
                summaryCell(r.evidenceKinds.join(', ')),
              ],
            }),
        ),
      ],
    }),
  )
  }
  if (model.gaps.length > 0) {
    children.push(
      para('Standards in scope with no released-item evidence (documentation gaps, not unimportance):', {
        size: 19,
        color: AMBER,
        bold: true,
        before: 160,
        after: 40,
      }),
      ...model.gaps.map((g) => para(`${g.code} — ${g.wording.slice(0, 160)}${g.wording.length > 160 ? '…' : ''}`, { size: 18, color: INK2, after: 30 })),
    )
  }

  // ---- grade sections ----
  for (const sec of model.sections) {
    children.push(heading1(model.sections.length > 1 ? `${sec.gradeLabel} — ${sec.setName}` : sec.gradeLabel, true))
    for (const { standard, items } of sec.standards) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 30 },
          children: [new TextRun({ text: `${standard.code} · ${standard.domainLabel}`, bold: true, color: INK })],
        }),
        para(standard.wording, { size: 19, color: INK2, after: 40 }),
        para(`${items.length} item${items.length === 1 ? '' : 's'}`, { size: 17, color: INK2, after: 80 }),
      )
      for (const pi of items) {
        children.push(...(await itemBlock(pi, images.get(pi.item.id))))
      }
    }
  }

  // ---- unconfirmed alignments ----
  if (model.unconfirmed.length > 0) {
    children.push(
      heading1('Items Without Confirmed Alignment', true),
      para(
        'These in-scope items carry an ai-proposed alignment — usable as evidence, flagged for human confirmation, never official.',
        { size: 19, color: INK2, after: 120 },
      ),
      ...model.unconfirmed.map((pi) =>
        para(`${pi.item.test} ${pi.item.year} Q${pi.item.itemNumber} → ${pi.item.alignmentCode}`, { size: 18, after: 30 }),
      ),
    )
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

async function itemBlock(pi: PacketItem, img: LoadedImage | undefined): Promise<Paragraph[]> {
  const { item } = pi
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: `${item.test} · ${item.year} · Q${item.itemNumber}`, bold: true, size: 18, color: INK2 }),
        new TextRun({
          text: `   ${item.confidence === 'ai-proposed' ? 'alignment: ai-proposed (not official)' : `alignment: ${item.confidence}`}`,
          size: 16,
          color: item.confidence === 'ai-proposed' ? AMBER : INK2,
        }),
      ],
    }),
  ]
  if (img) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [new ImageRun({ data: img.data, transformation: { width: img.width, height: img.height }, type: 'png' })],
      }),
    )
  } else {
    out.push(para(item.stem, { size: 20, italics: true, after: 40 }))
    ;(item.choices ?? []).forEach((choice, i) => {
      out.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 20 },
          children: [new TextRun({ text: `${String.fromCharCode(65 + i)}. ${choice}`, size: 19, color: INK })],
        }),
      )
    })
  }
  const meta: string[] = [
    `type: ${item.itemType}`,
    `response: ${item.responseFormat}`,
    ...(item.representations.length > 0 ? [`representations: ${item.representations.join(', ')}`] : []),
    `demand: ${item.demandProfile}`,
    ...(item.hasKey ? ['answer key available in the source document'] : []),
  ]
  out.push(para(meta.join(' · '), { size: 16, color: INK2, after: 140 }))
  return out
}

export async function downloadPacketDocx(model: PacketModel): Promise<void> {
  const blob = await buildPacketDocxBlob(model)
  const name = `${capsStandardCodes(model.title).replace(/[\\/:*?"<>|]+/g, '-')}.docx`
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
