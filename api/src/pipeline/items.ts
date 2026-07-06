import { InvocationContext } from '@azure/functions'
import { ItemRecord, JobMessage, Scope, StandardSet } from '../domain/types'
import { dataContainer, uploadsContainer } from '../data/clients'
import { getSet, mutateScope, mutateSet } from '../data/entities'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { ingestItemsPrompt } from '../services/prompts'
import { INGEST_ITEMS_SCHEMA, WireIngestItem, WireIngestItems } from '../services/schemas'
import { newId, today } from '../shared/util'
import { itemImageBlobPath, listUploads } from './ingest'
import { cropRegion, renderPages } from './pdf-images'
import { inspectPdf } from './pdf-split'

// Released items are extracted lazily — once per set, ahead of the first scope
// generation that needs them — in bounded page windows so a 100-page part can
// never overflow the structured-output budget (a whole-part extraction did, in
// production, before windowing). Progress checkpoints on the artifact meta
// (itemsExtractedPages / itemsExtracted), so redeliveries, concurrent
// generations against the same set, and later scopes skip everything already
// done. All set writes go through mutateSet (ETag) — a concurrent generation
// or extraction worker may be writing the same set document, and a plain save
// would destroy its freshly merged item records.
const WINDOW_PAGES = 15
// Dense pages can still overflow: on truncation the window halves (per
// document, down to a single page) instead of retrying the identical oversized
// call forever — truncation is deterministic, so plain retries only burn the
// queue's dequeue budget.
const MIN_WINDOW_PAGES = 1
// Output cap for one window's items. Deliberately lower than the 64k default:
// a window that would overflow should fail fast and shrink, not stream tens of
// thousands of extra tokens first.
const ITEMS_MAX_TOKENS = 32000
// Leave headroom inside the 10-minute Consumption functionTimeout; when the
// budget runs out mid-set, the plan message is re-enqueued and extraction
// continues where the checkpoints left off. A window call can realistically
// run 3-5 minutes, and a host-timeout abort skips the catch entirely and burns
// a dequeue attempt with nothing recorded — so stop starting new calls early.
const TIME_BUDGET_MS = 4 * 60 * 1000

const isTruncation = (e: unknown): boolean =>
  /max_tokens reached/i.test(e instanceof Error ? e.message : String(e))

/**
 * Ensures every set the scope draws on has its released items extracted
 * (classified records + cropped screenshots on the set document). Returns true
 * when everything is ready; false when it did extraction work in this
 * invocation and re-enqueued the plan message — the caller must simply return,
 * so the plan's own Claude call always starts with a fresh 10-minute window.
 */
export async function ensureSetItemsExtracted(
  scope: Scope,
  msg: JobMessage,
  ctx: InvocationContext,
): Promise<boolean> {
  const started = Date.now()
  let didWork = false
  const handOff = async (note: string): Promise<false> => {
    await enqueueJob({ jobId: msg.jobId, kind: 'generate', step: 'plan', scopeId: scope.id })
    ctx.log(`items: ${note} — plan message re-enqueued`)
    return false
  }

  const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  for (const setId of ids) {
    let set = await getSet(setId)
    const blobs = (await listUploads(setId)).filter((b) => b.role === 'items')
    for (const blob of blobs) {
      const findArtifact = (s: StandardSet) =>
        s.artifacts.find((a) => a.role === 'items' && a.fileName === blob.fileName)
      let artifact = findArtifact(set)
      if (!artifact || artifact.meta?.itemsExtracted) continue

      const buffer = await uploadsContainer().getBlobClient(blob.name).downloadToBuffer()
      const inspection = await inspectPdf(buffer)
      if (inspection.kind !== 'ok') {
        // Unreadable/encrypted part — mark done so generation proceeds on the rest.
        ctx.warn(`items: ${blob.fileName} is not readable (${inspection.kind}) — skipped`)
        set = await mutateSet(setId, (s) => {
          const a = findArtifact(s)
          if (a) a.meta = { ...(a.meta ?? {}), itemsExtracted: true }
          s.updated = today()
        })
        continue
      }
      const pages = inspection.pages
      const base64 = buffer.toString('base64')

      for (;;) {
        // Cooperative pause/cancel: the endpoints flag the job; check before
        // every window so a long multi-window extraction stops within one
        // call rather than running minutes past the user's click.
        if ((await getJob(msg.jobId)).cancelRequested === true) {
          await settlePausedExtraction(msg, scope.id)
          return false
        }
        // Re-read the checkpoint every pass: a concurrent generation against
        // the same set may have advanced it — leapfrog its finished windows
        // instead of re-extracting them (the merge is deduped either way).
        set = await getSet(setId)
        artifact = findArtifact(set)
        if (!artifact || artifact.meta?.itemsExtracted) break
        const from = (artifact.meta?.itemsExtractedPages ?? 0) + 1
        if (from > pages) {
          set = await mutateSet(setId, (s) => {
            const a = findArtifact(s)
            if (a) a.meta = { ...(a.meta ?? {}), itemsExtracted: true }
            s.updated = today()
          })
          break
        }
        if (Date.now() - started > TIME_BUDGET_MS) {
          return handOff(`time budget reached at ${blob.fileName} p.${from}`)
        }
        // The adaptive window persists on the artifact — a shrink must survive
        // handoffs, redeliveries, and host kills, or a dense document would
        // repeat the identical oversized call forever with nothing advancing.
        const windowPages = artifact.meta?.itemsWindowPages ?? WINDOW_PAGES
        const to = Math.min(from + windowPages - 1, pages)
        await mutateJob(msg.jobId, (r) => {
          r.status = 'running'
          r.stage = `Stage 2 — Classifying released items (${blob.fileName}, pages ${from}–${to})`
          pushLog(r, `Classifying released items: ${blob.fileName} pages ${from}–${to}`)
        })
        let wire: WireIngestItems
        try {
          wire = await generateStructured<WireIngestItems>({
            ...ingestItemsPrompt(set, artifact, from, to),
            schema: INGEST_ITEMS_SCHEMA,
            documents: [base64],
            effort: 'medium',
            maxTokens: ITEMS_MAX_TOKENS,
          })
        } catch (e) {
          didWork = true
          if (isTruncation(e) && windowPages > MIN_WINDOW_PAGES) {
            const next = Math.max(MIN_WINDOW_PAGES, Math.ceil(windowPages / 2))
            set = await mutateSet(setId, (s) => {
              const a = findArtifact(s)
              if (a) a.meta = { ...(a.meta ?? {}), itemsWindowPages: next }
            })
            ctx.warn(
              `items: ${blob.fileName} p.${from}–${to} overflowed the output budget — continuing with ${next}-page windows`,
            )
            continue
          }
          if (isTruncation(e)) {
            // Even a single page overflows: record the gap loudly and move on
            // rather than failing the generation over one unreadable page.
            ctx.error(`items: ${blob.fileName} p.${from} too dense to extract — page skipped`)
            await mutateJob(msg.jobId, (r) =>
              pushLog(r, `${blob.fileName} p.${from}: too dense to extract — page skipped, its items are not in the bank`),
            )
            set = await checkpointPages(setId, findArtifact, to, pages)
            continue
          }
          throw e
        }
        didWork = true
        const fresh = await toItemRecords(setId, wire.items ?? [], buffer, ctx)
        let added = 0
        set = await mutateSet(setId, (s) => {
          const a = findArtifact(s)
          // Window-level dedupe, serialized by the ETag loop: if a concurrent
          // worker's checkpoint already covers this window, its items are
          // already merged — dropping ours prevents duplicate records whose
          // free-form test labels defeat the key-based dedupe.
          if ((a?.meta?.itemsExtractedPages ?? 0) >= to) {
            added = 0
            return
          }
          added = mergeItems(s, fresh)
          if (a) {
            a.meta = {
              ...(a.meta ?? {}),
              itemsExtractedPages: Math.max(a.meta?.itemsExtractedPages ?? 0, to),
              ...(to >= pages ? { itemsExtracted: true } : {}),
            }
          }
          s.updated = today()
        })
        await mutateJob(msg.jobId, (r) =>
          pushLog(r, `${blob.fileName} p.${from}–${to}: ${added} item(s) classified${to >= pages ? ' — document complete' : ''}`),
        )
      }
    }
  }
  // Extraction consumed part of this invocation's 10 minutes — hand the plan
  // call a fresh invocation instead of racing the host timeout with it.
  if (didWork) return handOff('set extraction finished this invocation')
  return true
}

/**
 * Settle a pause/cancel noticed mid-extraction — mirrors generate.ts
 * settlePaused (idempotent: the mutateJob guard makes the settle write once;
 * cancel-generation already set the scope 'failed', which the status guard
 * leaves untouched). No re-enqueue: the run ends here; resume re-enters the
 * plan step and the artifact checkpoints skip everything already extracted.
 */
async function settlePausedExtraction(msg: JobMessage, scopeId: string): Promise<void> {
  await mutateJob(msg.jobId, (r) => {
    if (r.status === 'cancelled') return
    r.status = 'cancelled'
    r.stage = 'Generation — Paused'
    pushLog(r, 'Paused by user — item extraction is checkpointed; resume continues where this left off')
  })
  await mutateScope(scopeId, (sc) => {
    if (sc.status === 'generating') {
      sc.status = 'paused'
      sc.updated = today()
    }
  })
}

/** Advances the page checkpoint (monotonically) under ETag, marking the artifact done at the last page. */
async function checkpointPages(
  setId: string,
  findArtifact: (s: StandardSet) => StandardSet['artifacts'][number] | undefined,
  to: number,
  pages: number,
): Promise<StandardSet> {
  return mutateSet(setId, (s) => {
    const a = findArtifact(s)
    if (a) {
      a.meta = {
        ...(a.meta ?? {}),
        itemsExtractedPages: Math.max(a.meta?.itemsExtractedPages ?? 0, to),
        ...(to >= pages ? { itemsExtracted: true } : {}),
      }
    }
    s.updated = today()
  })
}

/** Converts wire items into ItemRecords, cropping and uploading a screenshot per item (best-effort). */
async function toItemRecords(
  setId: string,
  wires: WireIngestItem[],
  pdf: Buffer,
  ctx: InvocationContext,
): Promise<ItemRecord[]> {
  let pageImages = new Map<number, Buffer>()
  try {
    pageImages = await renderPages(pdf, wires.map((w) => w.page))
  } catch (e) {
    // Native rendering stack unavailable — items keep their text stand-ins.
    ctx.warn('items: page rendering unavailable — records carry text stand-ins only', e)
  }
  const records: ItemRecord[] = []
  for (const w of wires) {
    const id = newId('it')
    let imagePath: string | undefined
    const png = pageImages.get(w.page)
    if (png) {
      try {
        const crop = await cropRegion(png, w.box)
        const path = itemImageBlobPath(setId, id)
        await dataContainer()
          .getBlockBlobClient(path)
          .uploadData(crop, { blobHTTPHeaders: { blobContentType: 'image/png' } })
        imagePath = path
      } catch (e) {
        ctx.warn(`items: screenshot crop failed for ${w.test} Q${w.itemNumber}`, e)
      }
    }
    records.push({
      id,
      source: w.source,
      test: w.test,
      year: w.year,
      itemNumber: w.itemNumber,
      alignmentCode: w.alignmentCode,
      confidence: w.confidence,
      completeness: w.completeness,
      itemType: w.itemType,
      responseFormat: w.responseFormat,
      representations: w.representations,
      problemTypes: w.problemTypes,
      demandProfile: w.demandProfile,
      scopeClass: w.scopeClass,
      hasKey: w.hasKey,
      stem: w.stem,
      ...(w.choices.length > 0 ? { choices: w.choices } : {}),
      ...(imagePath ? { imagePath } : {}),
      ...(w.page >= 1 ? { page: w.page } : {}),
    })
  }
  return records
}

/**
 * Merges new records into set.items, deduped by (test, year, itemNumber, page).
 * Runs inside mutateSet's retry callback, so it may execute more than once —
 * always against a freshly read document. A record dropped as a duplicate
 * (a concurrent extractor won the race) leaves only an orphaned screenshot
 * blob behind, which is harmless. Returns how many were added.
 */
function mergeItems(set: StandardSet, fresh: ItemRecord[]): number {
  const key = (it: ItemRecord) => `${it.test}|${it.year}|${it.itemNumber}|${it.page ?? ''}`.toLowerCase()
  const seen = new Set(set.items.map(key))
  let added = 0
  for (const it of fresh) {
    const k = key(it)
    if (seen.has(k)) continue
    seen.add(k)
    set.items.push(it)
    added++
  }
  return added
}
