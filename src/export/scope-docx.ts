// Word export for a scope — the download opens directly in Word and converts
// to a fully editable Google Doc when dropped into Google Drive. Deliberately
// CLEAN: the twelve content fields only — no citations, no decision records,
// no inference flags. Loaded lazily (dynamic import) so the docx library stays
// out of the main bundle.
import {
  AlignmentType,
  Bookmark,
  Document,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { api } from '../api'
import { fieldMeta } from '../data/meta'
import type { ItemRecord, Scope, StandardSet } from '../types'
import { capsStandardCodes } from '../ui'

const INK = '23232B'
const INK2 = '5A5A66'
const ACCENT = '3F3FA8'

// Word bookmark names must start with a letter and contain only letters,
// digits, and underscores — lesson ids ("U1.L1") need sanitizing.
const anchorFor = (lessonId: string): string => `L_${lessonId.replace(/[^A-Za-z0-9]/g, '_')}`

const CONTENT_WIDTH_PX = 600 // ~6.25in printable width at 96dpi

interface LoadedImage {
  data: ArrayBuffer
  width: number
  height: number
}

/** Fetches an item screenshot and its dimensions; undefined on any failure (text stand-in renders instead). */
async function loadImage(url: string): Promise<LoadedImage | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, CONTENT_WIDTH_PX / bitmap.width)
    const dims = { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) }
    bitmap.close()
    return { data: await blob.arrayBuffer(), ...dims }
  } catch {
    return undefined
  }
}

const label = (text: string): Paragraph =>
  new Paragraph({
    spacing: { before: 220, after: 40 },
    children: [new TextRun({ text, bold: true, size: 17, color: INK2, allCaps: true })],
  })

const body = (text: string): Paragraph =>
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 21, color: INK })],
  })

const caption = (text: string): Paragraph =>
  new Paragraph({
    spacing: { before: 120, after: 40 },
    children: [new TextRun({ text, bold: true, size: 17, color: INK2 })],
  })

/** Builds the .docx blob. Exposed separately from the download for testability. */
export async function buildScopeDocxBlob(scope: Scope, sets: StandardSet[]): Promise<Blob> {
  const scopeSetIds = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const scopeSets = sets.filter((st) => scopeSetIds.includes(st.id))
  const itemsById = new Map(scopeSets.flatMap((st) => st.items.map((it) => [it.id, { it, setId: st.id }] as const)))
  const lessons = scope.units.reduce((n, u) => n + u.lessons.length, 0)

  // Pre-fetch every referenced screenshot (small concurrency batches).
  const wanted: { key: string; url: string }[] = []
  for (const u of scope.units) {
    for (const l of u.lessons) {
      for (const rid of l.itemRefs) {
        const entry = itemsById.get(rid)
        if (entry?.it.imagePath) wanted.push({ key: rid, url: api.itemImageUrl(entry.setId, entry.it.id) })
      }
    }
  }
  const images = new Map<string, LoadedImage>()
  for (let i = 0; i < wanted.length; i += 4) {
    const batch = wanted.slice(i, i + 4)
    const loaded = await Promise.all(batch.map((w) => loadImage(w.url)))
    batch.forEach((w, j) => {
      const img = loaded[j]
      if (img) images.set(w.key, img)
    })
  }

  const children: Paragraph[] = []

  // ---- title + meta ----
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: capsStandardCodes(scope.title), bold: true, size: 52, color: INK })],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [
        new TextRun({
          text: `${scopeSets.map((st) => st.name).join(' + ')} · ${scope.engineVersion.split(' (')[0]} · ${(scope.doctrineVersions[0] ?? '').split(' (')[0]} · v${scope.version} · ${scope.updated} · ${scope.units.length} units · ${lessons} lessons`,
          size: 19,
          color: INK2,
        }),
      ],
    }),
  )

  // ---- table of contents (internal links survive the Google Docs conversion) ----
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
      children: [new TextRun({ text: 'Table of Contents', bold: true, color: ACCENT })],
    }),
  )
  for (const u of scope.units) {
    children.push(
      new Paragraph({
        spacing: { before: 140, after: 40 },
        children: [new TextRun({ text: `${u.id} · ${u.title}`, bold: true, size: 21, color: INK })],
      }),
    )
    for (const l of u.lessons) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 20 },
          children: [
            new InternalHyperlink({
              anchor: anchorFor(l.id),
              children: [new TextRun({ text: `${l.id} — ${l.title}`, size: 20, style: 'Hyperlink' })],
            }),
          ],
        }),
      )
    }
  }

  // ---- units and lesson cards ----
  for (const u of scope.units) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { after: 40 },
        children: [new TextRun({ text: `${u.id} · ${u.title}`, bold: true, color: ACCENT })],
      }),
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: `${u.strand} — ${u.rationale}`, italics: true, size: 19, color: INK2 })],
      }),
    )
    for (const l of u.lessons) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 20 },
          children: [new Bookmark({ id: anchorFor(l.id), children: [new TextRun({ text: `${l.id} — ${l.title}`, bold: true, color: INK })] })],
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: `${l.type} · evidence: ${l.evidenceStatus}`, size: 17, color: INK2, allCaps: true })],
        }),
      )
      for (const fm of fieldMeta) {
        const field = l.fields[fm.key]
        children.push(label(`${String(fm.n).padStart(2, '0')}  ${fm.label}`), body(field.content))
        if (fm.key === 'releasedItems') {
          for (const rid of l.itemRefs) {
            const entry = itemsById.get(rid)
            if (!entry) continue
            children.push(caption(`${entry.it.test} · ${entry.it.year} · Q${entry.it.itemNumber} — ${entry.it.alignmentCode}`))
            children.push(...itemVisual(entry.it, images.get(rid)))
          }
          if (l.generatedExemplar) {
            children.push(
              caption('Generated exemplar — not a released item'),
              body(l.generatedExemplar.stem),
              new Paragraph({
                spacing: { after: 60 },
                children: [new TextRun({ text: `Answer: ${l.generatedExemplar.answer}`, size: 19, color: INK2 })],
              }),
            )
          }
        }
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri' } },
      },
    },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

/** The item's screenshot when it loaded, else its faithful text stand-in. */
function itemVisual(item: ItemRecord, img: LoadedImage | undefined): Paragraph[] {
  if (img) {
    return [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [
          new ImageRun({ data: img.data, transformation: { width: img.width, height: img.height }, type: 'png' }),
        ],
      }),
    ]
  }
  return [
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: item.stem, italics: true, size: 20, color: INK })],
    }),
  ]
}

/** Builds the document and hands it to the browser as a .docx download. */
export async function downloadScopeDocx(scope: Scope, sets: StandardSet[]): Promise<void> {
  const blob = await buildScopeDocxBlob(scope, sets)
  const name = `${capsStandardCodes(scope.title).replace(/[\\/:*?"<>|]+/g, '-')}.docx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Dev-only hook so the export can be exercised end to end from the preview
// browser without clicking through the UI. Stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__buildScopeDocxBlob = buildScopeDocxBlob
}
