import { EncryptedPDFError, PDFDocument } from 'pdf-lib'

/** One slice of a source PDF. Page numbers are 1-based inclusive, in the ORIGINAL document's numbering. */
export interface PdfPart {
  data: Buffer
  from: number
  to: number
}

export type PdfInspection =
  | { kind: 'ok'; pages: number }
  | { kind: 'encrypted' }
  | { kind: 'unreadable'; error: unknown }

/**
 * Exact page count via pdf-lib (the ingest byte-grep heuristic both
 * under-counts compressed object streams and over-counts outline /Count
 * entries). Encryption is surfaced explicitly: pdf-lib cannot decrypt, so
 * "splitting" an encrypted PDF would emit corrupt parts.
 */
export async function inspectPdf(pdf: Buffer): Promise<PdfInspection> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false })
    return { kind: 'ok', pages: doc.getPageCount() }
  } catch (e) {
    if (e instanceof EncryptedPDFError || /encrypt/i.test(String(e))) return { kind: 'encrypted' }
    return { kind: 'unreadable', error: e }
  }
}

/**
 * Splits a PDF into consecutive parts of at most maxPages pages each
 * (144 pages @ 100 → pages 1–100 and 101–144). A document already within the
 * limit comes back as a single part of the original bytes. Throws on
 * encrypted/unreadable PDFs — inspect first.
 */
export async function splitPdf(pdf: Buffer, maxPages: number): Promise<PdfPart[]> {
  const src = await PDFDocument.load(pdf, { updateMetadata: false })
  const total = src.getPageCount()
  if (total <= maxPages) return [{ data: pdf, from: 1, to: total }]
  const parts: PdfPart[] = []
  for (let start = 0; start < total; start += maxPages) {
    const end = Math.min(start + maxPages, total)
    const out = await PDFDocument.create()
    const indices = Array.from({ length: end - start }, (_, i) => start + i)
    const pages = await out.copyPages(src, indices)
    for (const page of pages) out.addPage(page)
    parts.push({ data: Buffer.from(await out.save()), from: start + 1, to: end })
  }
  return parts
}

/**
 * Splits by page limit, then keeps halving any part whose bytes still exceed
 * maxBytes (dense scans) until every part fits or is a single page. Part page
 * numbers always refer to the original document.
 */
export async function splitPdfWithin(pdf: Buffer, maxPages: number, maxBytes: number): Promise<PdfPart[]> {
  const out: PdfPart[] = []
  const queue = await splitPdf(pdf, maxPages)
  while (queue.length > 0) {
    const part = queue.shift()!
    const pages = part.to - part.from + 1
    if (part.data.length <= maxBytes || pages <= 1) {
      out.push(part)
      continue
    }
    const halves = await splitPdf(part.data, Math.ceil(pages / 2))
    for (const h of halves) {
      queue.push({ data: h.data, from: part.from + h.from - 1, to: part.from + h.to - 1 })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

/** "NY_Release.pdf" + pages 101–144 → "NY_Release (pages 101-144).pdf" */
export function partFileName(fileName: string, from: number, to: number): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  return `${stem} (pages ${from}-${to})${ext}`
}
