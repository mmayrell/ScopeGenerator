import { createCanvas, loadImage } from '@napi-rs/canvas'
import { pdfToPng } from 'pdf-to-png-converter'

/** Percentage-based box (0–100 of page width/height) as reported by extraction. */
export interface PctBox {
  x: number
  y: number
  w: number
  h: number
}

const RENDER_SCALE = 2 // ~150 dpi for a US-letter page — crisp enough to read stems
const PAD_PCT = 1.5 // breathing room around the reported region
const MIN_DIM_PCT = 8 // a box smaller than this in either dimension is treated as unreliable

/**
 * Renders the given 1-based pages of a PDF to PNG buffers.
 * Only the requested pages are rasterized.
 */
export async function renderPages(pdf: Buffer, pages: number[]): Promise<Map<number, Buffer>> {
  const wanted = [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b)
  const out = new Map<number, Buffer>()
  if (wanted.length === 0) return out
  // Pages above the document page count are silently ignored by the converter.
  const rendered = await pdfToPng(new Uint8Array(pdf), {
    viewportScale: RENDER_SCALE,
    pagesToProcess: wanted,
  })
  for (const page of rendered) {
    if (page.content) out.set(page.pageNumber, Buffer.from(page.content))
  }
  return out
}

/**
 * Crops an item screenshot out of a rendered page. The box is percentage-based;
 * a missing or implausibly small box falls back to the full page so the field
 * is never empty. Returns PNG bytes.
 */
export async function cropRegion(pagePng: Buffer, box: PctBox | undefined): Promise<Buffer> {
  const img = await loadImage(pagePng)
  const pw = img.width
  const ph = img.height

  let usable = box
  if (usable) {
    const plausible =
      usable.w >= MIN_DIM_PCT &&
      usable.h >= MIN_DIM_PCT &&
      usable.x >= 0 &&
      usable.y >= 0 &&
      usable.x + usable.w <= 100.5 &&
      usable.y + usable.h <= 100.5
    if (!plausible) usable = undefined
  }
  if (!usable) usable = { x: 0, y: 0, w: 100, h: 100 }

  const x0 = Math.max(0, Math.floor(((usable.x - PAD_PCT) / 100) * pw))
  const y0 = Math.max(0, Math.floor(((usable.y - PAD_PCT) / 100) * ph))
  const x1 = Math.min(pw, Math.ceil(((usable.x + usable.w + PAD_PCT) / 100) * pw))
  const y1 = Math.min(ph, Math.ceil(((usable.y + usable.h + PAD_PCT) / 100) * ph))
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)

  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h)
  return canvas.toBuffer('image/png')
}
