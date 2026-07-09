import { InvocationContext } from '@azure/functions'
import { EvidencePacket, HuntedItem } from '../domain/types'
import { screenshotsContainer } from '../data/clients'
import { generateStructured } from '../services/claude'
import { cropRegion, renderPages, PctBox } from './pdf-images'
import { inspectPdf, splitPdfWithin, PdfPart } from './pdf-split'

/**
 * Screenshot capture for hunted packet items (hunt Phase 4). The transcription
 * phases record WHAT each item says and WHERE it came from (sourceUrl); this
 * phase goes back to the source documents, downloads each PDF, has the model
 * localize every transcribed item on its page (page + percentage box — the
 * same contract as set-item extraction), and crops real screenshots into the
 * private `screenshots` blob container at `<packetId>/<itemId>/<n>.png`.
 *
 * Capture is BEST-EFFORT by design: a source that is not a fetchable PDF
 * (portal viewers, HTML release pages), an item the model cannot locate, or a
 * missing native rendering stack degrades to the text facsimile the packet
 * already carries — it never fails the packet.
 */

/** Download cap — the largest genuine released-test PDFs are ~30 MB. */
const MAX_PDF_BYTES = 60 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 90_000
/** Claude document-attachment limits (mirrors ingest): split bigger PDFs into parts. */
const PART_MAX_PAGES = 100
const PART_MAX_BYTES = 25 * 1024 * 1024
/** Items listed per localization call — replies are tiny (id + page + box). */
const LOCATE_CHUNK = 40
const LOCATE_MAX_TOKENS = 8000

export const shotBlobPath = (packetId: string, itemId: string, n: number): string =>
  `${packetId}/${itemId}/${n}.png`

/** One capture unit: a source document and the packet items transcribed from it. */
export interface ShotGroup {
  /** Checkpoint key (`shot|<normalized url>`) recorded in packet.doneShots. */
  key: string
  url: string
  items: HuntedItem[]
}

const normUrl = (url: string): string => url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()

/** True when the URL's host is the domain or a subdomain of an allow-listed one. */
function allowedDomain(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return domains.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/**
 * Capture units still outstanding: items without screenshots, grouped by
 * source document. Only official-portal http(s) URLs qualify — the same
 * allow-list that bounds the hunt's web_fetch bounds our own downloads.
 */
export function shotGroupsOf(packet: EvidencePacket, domains: string[]): ShotGroup[] {
  const done = new Set(packet.doneShots ?? [])
  const groups = new Map<string, ShotGroup>()
  for (const item of packet.items) {
    if (item.screenshotPaths && item.screenshotPaths.length > 0) continue
    if (!/^https?:\/\//i.test(item.sourceUrl) || !allowedDomain(item.sourceUrl, domains)) continue
    const key = `shot|${normUrl(item.sourceUrl)}`
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, url: item.sourceUrl, items: [item] })
  }
  return [...groups.values()].filter((g) => !done.has(g.key)).sort((a, b) => a.key.localeCompare(b.key))
}

/** Downloads a source document, returning its bytes only when it really is a PDF. */
async function downloadPdf(url: string, signal: AbortSignal): Promise<Buffer | undefined> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
  const res = await fetch(url, { signal: combined, redirect: 'follow' })
  if (!res.ok) return undefined
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PDF_BYTES) return undefined
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_PDF_BYTES) return undefined
  // Content-type lies on some portals — the magic bytes are authoritative.
  if (!bytes.subarray(0, 5).toString('latin1').startsWith('%PDF-')) return undefined
  return bytes
}

// ---------------------------------------------------------------------------
// Localization — the model finds each transcribed item's page + bounding box
// ---------------------------------------------------------------------------

const LOCATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: { $ref: '#/$defs/loc' } } },
  $defs: {
    loc: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'found', 'page', 'box'],
      properties: {
        id: { type: 'string' },
        found: { type: 'boolean' },
        page: { type: 'number' },
        box: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'w', 'h'],
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
        },
      },
    },
  },
}

const LOCATE_SYSTEM = `You are an assessment-document analyst. You are given ONE released-test PDF and a list of items previously transcribed from it. For each listed item, locate it in the attached document.

Rules:
1. page is the 1-based page of THIS attached document where the item appears (where it starts, for items spanning pages).
2. box is the item's tight bounding region on that page, in PERCENTAGES of page width/height: x/y = top-left corner, w/h = size. Cover the ENTIRE item: its question number, stem, any graphic (number line, figure, table, graph), and all answer choices — but not neighboring items.
3. Match items by their question number first, then by stem wording. The transcription may paraphrase graphics in [brackets]; the printed item is the ground truth.
4. found=false (page 0, box zeros) when the item is not in this document. Never guess a location.
5. Return every listed item exactly once, by its id.`

interface WireLoc {
  id?: string
  found?: boolean
  page?: number
  box?: { x?: number; y?: number; w?: number; h?: number }
}

async function locateItems(
  part: PdfPart,
  base64: string,
  items: HuntedItem[],
  signal: AbortSignal,
): Promise<Map<string, { page: number; box: PctBox }>> {
  const found = new Map<string, { page: number; box: PctBox }>()
  for (let i = 0; i < items.length; i += LOCATE_CHUNK) {
    const chunk = items.slice(i, i + LOCATE_CHUNK)
    const user = `Locate each of these transcribed items in the attached document.

Items:
${chunk
  .map(
    (it) =>
      `- id ${it.id}${it.itemNumber ? ` · question number ${it.itemNumber}` : ''} · stem starts: "${it.stem.slice(0, 160)}"`,
  )
  .join('\n')}

Return page + box per item (found=false when absent from this document).`
    const result = await generateStructured<{ items?: WireLoc[] }>({
      system: LOCATE_SYSTEM,
      user,
      schema: LOCATE_SCHEMA,
      documents: [base64],
      effort: 'low',
      maxTokens: LOCATE_MAX_TOKENS,
      signal,
    })
    const pages = part.to - part.from + 1
    for (const loc of result.items ?? []) {
      if (!loc?.id || loc.found !== true) continue
      const page = Math.trunc(Number(loc.page))
      if (!Number.isInteger(page) || page < 1 || page > pages) continue
      const box = {
        x: Number(loc.box?.x ?? 0),
        y: Number(loc.box?.y ?? 0),
        w: Number(loc.box?.w ?? 0),
        h: Number(loc.box?.h ?? 0),
      }
      // Map the part-relative page back to the original document's numbering.
      found.set(loc.id, { page: part.from + page - 1, box })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Capture — download, localize, crop, upload
// ---------------------------------------------------------------------------

export interface ShotCaptureResult {
  /** itemId → blob paths of the screenshots uploaded for it. */
  paths: Map<string, string[]>
  /** Human-readable outcome for the job log. */
  note: string
}

/**
 * Captures screenshots for one source document. Throws only on abort (the
 * caller re-enqueues); every other failure returns an empty result with a
 * note, so the packet completes with text facsimiles for that document.
 */
export async function captureShotsForGroup(
  packetId: string,
  group: ShotGroup,
  signal: AbortSignal,
  ctx: InvocationContext,
): Promise<ShotCaptureResult> {
  const isAbort = (e: unknown): boolean =>
    /abort|timeout/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))

  let pdf: Buffer | undefined
  try {
    pdf = await downloadPdf(group.url, signal)
  } catch (e) {
    if (signal.aborted) throw e
    ctx.warn(`packet-shots ${packetId}: download failed for ${group.url}`, e)
    return { paths: new Map(), note: 'the source could not be downloaded' }
  }
  if (!pdf) return { paths: new Map(), note: 'the source is not a fetchable PDF (portal viewer or HTML page)' }

  const inspection = await inspectPdf(pdf)
  if (inspection.kind !== 'ok') {
    return { paths: new Map(), note: `the source PDF is ${inspection.kind} — screenshots skipped` }
  }

  // Localize across parts (big PDFs exceed the attachment limits, like ingest).
  let located = new Map<string, { page: number; box: PctBox }>()
  try {
    const parts = await splitPdfWithin(pdf, PART_MAX_PAGES, PART_MAX_BYTES)
    for (const part of parts) {
      const remaining = group.items.filter((it) => !located.has(it.id))
      if (remaining.length === 0) break
      const found = await locateItems(part, part.data.toString('base64'), remaining, signal)
      located = new Map([...located, ...found])
    }
  } catch (e) {
    if (isAbort(e)) throw e
    ctx.warn(`packet-shots ${packetId}: localization failed for ${group.url}`, e)
    if (located.size === 0) return { paths: new Map(), note: 'the items could not be located in the source PDF' }
  }
  if (located.size === 0) {
    return { paths: new Map(), note: 'no listed item could be located in the source PDF' }
  }

  // Render + crop + upload (best-effort — the native stack may be unavailable).
  const paths = new Map<string, string[]>()
  try {
    const pageImages = await renderPages(pdf, [...located.values()].map((l) => l.page))
    for (const item of group.items) {
      const loc = located.get(item.id)
      if (!loc) continue
      const png = pageImages.get(loc.page)
      if (!png) continue
      try {
        const crop = await cropRegion(png, loc.box)
        const path = shotBlobPath(packetId, item.id, 1)
        await screenshotsContainer()
          .getBlockBlobClient(path)
          .uploadData(crop, { blobHTTPHeaders: { blobContentType: 'image/png' } })
        paths.set(item.id, [path])
      } catch (e) {
        ctx.warn(`packet-shots ${packetId}: crop/upload failed for item ${item.id}`, e)
      }
    }
  } catch (e) {
    ctx.warn(`packet-shots ${packetId}: page rendering unavailable — text facsimiles kept`, e)
    return { paths: new Map(), note: 'page rendering is unavailable — text facsimiles kept' }
  }

  const missed = group.items.length - paths.size
  return {
    paths,
    note:
      paths.size === 0
        ? 'no screenshots could be captured from this source'
        : `captured ${paths.size} screenshot${paths.size === 1 ? '' : 's'}` +
          (missed > 0 ? ` (${missed} item${missed === 1 ? '' : 's'} could not be located)` : ''),
  }
}

/** Removes every screenshot blob of a packet (delete path). */
export async function deletePacketShots(packetId: string): Promise<void> {
  const container = screenshotsContainer()
  for await (const blob of container.listBlobsFlat({ prefix: `${packetId}/` })) {
    await container.getBlockBlobClient(blob.name).deleteIfExists()
  }
}
