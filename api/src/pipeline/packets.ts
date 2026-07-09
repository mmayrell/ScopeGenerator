import { InvocationContext } from '@azure/functions'
import { EvidencePacket, HuntSource, HuntedItem, JobMessage, PacketStandard } from '../domain/types'
import { SBAC_ITEMS } from '../data/sbac-items'
import { getPacketOrUndefined, mutatePacket } from '../data/packets'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { newId, nowIso } from '../shared/util'
import { captureShotsForGroup, shotGroupsOf } from './packet-shots'

/**
 * Evidence-packet hunt step (kind 'packet' / step 'hunt') — the web-hunting
 * agent, document-first. Released items live in per-year test documents (one
 * NY release = every question of that administration plus an official item
 * map), so the hunt runs three phases:
 *
 *   1. DISCOVERY — one web-search call catalogs every official released-test
 *      document for the framework/grades/years (packet.sources).
 *   2. TRANSCRIPTION — one document at a time, the agent opens the document
 *      and transcribes EVERY in-scope item in it, paging through continuation
 *      calls until the document is exhausted (packet.doneSources).
 *   3. GAP SWEEP — standards still without a single item get the original
 *      per-standard batched search (SBAC sample bank included), so coverage
 *      never falls below the old breadth-first behavior.
 *   4. SCREENSHOT CAPTURE — the source PDFs are downloaded, every transcribed
 *      item is localized (page + box), and real screenshots are cropped into
 *      the `screenshots` container (best-effort — see pipeline/packet-shots).
 *
 * Progress checkpoints to the packet blob after every paid call, and the step
 * re-enqueues itself when the time budget runs out, so a repository of any
 * size fits the 10-minute Consumption timeout.
 */

/**
 * Hunt calls run web searches server-side and can take several minutes each;
 * stop launching new calls well before the 10-minute execution cap so the
 * in-flight call always has room to finish.
 */
const TIME_BUDGET_MS = 3.5 * 60 * 1000
/**
 * Hard abort for the in-flight call: a web-search turn can legally stretch
 * (pause_turn resumes, parse retries, SDK backoff) past the 10-minute host
 * cap, and a host kill skips ALL settlement. Aborting at 8.5 minutes leaves
 * room to log, re-enqueue, and return cleanly.
 */
const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000

/** Discovery: documents per packet — a runaway catalog can't queue days of paid transcription. */
const MAX_SOURCES = 40
/** Transcription: items per reply — keeps every reply far from the output cap (a 46-item test pages in 3 replies). */
const TRANSCRIBE_PAGE = 20
const TRANSCRIBE_PAGE_LEAN = 10
/** Continuation calls per document (6 × 20 items covers any real released test). */
const MAX_CALLS_PER_SOURCE = 6
const TRANSCRIBE_MAX_TOKENS = 30000
/** One fetch must be able to carry a full released-test PDF, not just its first pages. */
const TRANSCRIBE_FETCH_TOKENS = 80000

/** Gap sweep: standards per search call — keeps each web-search turn focused and bounded. */
const BATCH_SIZE = 4
const MAX_SEARCHES_PER_BATCH = 8
/** The sweep is breadth mode: a few strong exemplars per still-uncovered standard. */
const SWEEP_ITEMS_PER_STANDARD = 6
const HUNT_MAX_TOKENS = 24000

/**
 * Repository-wide safety cap — far above any real corpus (every NY + MCAS +
 * Ohio + CAASPP release for one grade is ~500 items) but keeps a pathological
 * hunt from growing the packet blob without bound.
 */
const MAX_ITEMS_PER_PACKET = 1500

const isTruncation = (e: unknown): boolean =>
  /truncated \(max_tokens/i.test(e instanceof Error ? e.message : String(e))
const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))
// Safety refusals on math hunts are classifier false positives set off by
// fetched page content, not by the request — retry once lean (different
// searches/fetches), then skip the unit instead of failing the packet.
const isRefusal = (e: unknown): boolean =>
  /declined this request/i.test(e instanceof Error ? e.message : String(e))

interface HuntBatch {
  key: string
  grade: number
  domainName: string
  standards: PacketStandard[]
}

/** Deterministic batching — grade → domain → chunks of BATCH_SIZE. */
export function huntBatchesOf(standards: PacketStandard[]): HuntBatch[] {
  const groups = new Map<string, PacketStandard[]>()
  for (const st of standards) {
    const gk = `${st.grade}|${st.domain}`
    groups.set(gk, [...(groups.get(gk) ?? []), st])
  }
  const batches: HuntBatch[] = []
  const keys = [...groups.keys()].sort()
  for (const gk of keys) {
    const sorted = groups.get(gk)!.slice().sort((a, b) => a.code.localeCompare(b.code))
    for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
      const chunk = sorted.slice(i, i + BATCH_SIZE)
      batches.push({
        // First-code keys: stable while a chunk's own membership holds, and
        // namespaced so legacy full-catalog keys (`grade|domain|index`) in
        // old packets' doneBatches can never mark a sweep batch done.
        key: `sweep|${gk}|${chunk[0].code}`,
        grade: chunk[0].grade,
        domainName: chunk[0].domainName,
        standards: chunk,
      })
    }
  }
  return batches
}

/** The gap sweep hunts only standards that still have no items at all. */
function sweepBatchesOf(packet: EvidencePacket): HuntBatch[] {
  const covered = new Set(packet.items.map((i) => i.standardCode))
  return huntBatchesOf(packet.standards.filter((s) => !covered.has(s.code)))
}

export async function huntPacketStep(msg: JobMessage, context: InvocationContext): Promise<void> {
  const packetId = msg.packetId
  if (!packetId) throw new Error('packet/hunt message missing packetId')

  const packet = await getPacketOrUndefined(packetId)
  if (!packet) {
    // Deleted mid-hunt — settle the job quietly instead of poisoning the message.
    await settleJobQuietly(msg.jobId, 'Packet was deleted — nothing to do')
    return
  }
  if (packet.status !== 'hunting') {
    // Already settled (complete/failed/cancelled). Settle the job row too —
    // a bare return would leave this message's job 'queued' forever, making
    // the job poll report a live hunt for a settled packet.
    await settleJobQuietly(msg.jobId, 'Packet already settled — nothing to do')
    return
  }
  // Ownership: a retry re-dispatches under a NEW job id and stamps it on the
  // packet. A superseded execution (stale redelivery, pre-retry continuation)
  // must abandon instead of mutating the packet — its stale cancel flag would
  // otherwise clobber the hunt the user explicitly restarted.
  const ownsHunt = (p: EvidencePacket): boolean => !p.huntJobId || p.huntJobId === msg.jobId
  if (!ownsHunt(packet)) {
    await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — nothing to do')
    return
  }

  // Deadline-cut escalation state rides the queue message: cuts count how many
  // executions were cut mid-call on the SAME unit ('discovery', 'src|<key>',
  // or a sweep-batch key). One cut → lean re-run; three cuts → skip the unit
  // honestly. Without this, a unit whose calls always outrun the window would
  // hand off to fresh executions forever, burning paid searches every round.
  const payload = (msg.payload ?? {}) as { cuts?: unknown; cutKey?: unknown }
  const priorCutKey = typeof payload.cutKey === 'string' ? payload.cutKey : ''
  const priorCuts = Math.trunc(Number(payload.cuts ?? 0)) || 0
  const cutsFor = (unitKey: string): number => (priorCutKey === unitKey ? priorCuts : 0)

  const started = Date.now()
  const outOfBudget = (): boolean => Date.now() - started > TIME_BUDGET_MS
  /** Bound a paid call to the execution deadline; the caller re-enqueues on abort. */
  const bounded = (): { signal: AbortSignal; dispose: () => void } => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
    return { signal: controller.signal, dispose: () => clearTimeout(timer) }
  }
  // Log BEFORE enqueueing the continuation: if either write fails, the error
  // rethrows and the host redelivers THIS message — enqueue-first could
  // strand a continuation alongside the redelivery (two live messages
  // hunting the same packet).
  const reenqueue = async (note: string, cutState?: { cuts: number; cutKey: string }): Promise<void> => {
    await mutateJob(msg.jobId, (r) => pushLog(r, note))
    await enqueueJob({
      jobId: msg.jobId,
      kind: 'packet',
      step: 'hunt',
      packetId,
      ...(cutState ? { payload: cutState } : {}),
    })
  }
  // Fresh doc read before every paid call: a concurrent execution (retry
  // racing a backlogged message, or a redelivery racing a continuation) may
  // have advanced the checkpoint, settled the packet, or deleted it. One blob
  // read guards minutes of duplicated web-search spend and duplicate items.
  // Returns undefined when this execution must stop.
  const freshOrStop = async (): Promise<EvidencePacket | undefined> => {
    const current = await getPacketOrUndefined(packetId)
    if (!current || current.status !== 'hunting') {
      await settleJobQuietly(msg.jobId, current ? 'Packet settled by another run — stopping' : 'Packet was deleted — stopping')
      return undefined
    }
    if (!ownsHunt(current)) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping')
      return undefined
    }
    return current
  }
  // Honor a stop request at every checkpoint. Only the OWNING job may cancel
  // the packet — a superseded job's stale stop flag settles that job alone
  // (freshOrStop already returned for that case).
  const stopRequested = async (progressNote: string): Promise<boolean> => {
    const job = await getJob(msg.jobId)
    if (job.cancelRequested !== true) return false
    await mutatePacket(packetId, (p) => {
      if (p.status === 'hunting' && ownsHunt(p)) p.status = 'cancelled'
      p.updated = nowIso()
    })
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, `Stopped by user — ${progressNote}; items already found are kept`)
    })
    return true
  }
  /** Job progress: discovery (1) + transcribed documents; sweep batches join the total when the sweep plan exists. */
  const doneStages = (p: EvidencePacket): number =>
    (p.sources ? 1 : 0) + (p.doneSources ?? []).filter((k) => (p.sources ?? []).some((s) => s.key === k)).length

  // -------------------------------------------------------------------------
  // Phase 1 — discovery: catalog every released-test document
  // -------------------------------------------------------------------------
  let current: EvidencePacket = packet
  if (!current.sources) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'running'
      r.totalStages = Math.max(r.totalStages, 2) // discovery + at least the sweep
      r.stage = 'Cataloging released-test documents'
      pushLog(r, 'Cataloging every official released-test document for this selection')
    })
    if (await stopRequested('before the document catalog')) return

    const cuts = cutsFor('discovery')
    let found: HuntSource[] = []
    let dropped = 0
    let catalogSkipped = false
    if (cuts >= 3) {
      catalogSkipped = true
    } else {
      const bound = bounded()
      try {
        try {
          ;({ sources: found, dropped } = await discoverSources(current, bound.signal, cuts >= 1))
        } catch (e) {
          if (isTruncation(e) || isRefusal(e)) {
            context.warn(`packet/hunt ${packetId}: discovery ${isRefusal(e) ? 'refused' : 'truncated'} — retrying lean`)
            try {
              ;({ sources: found, dropped } = await discoverSources(current, bound.signal, true))
            } catch (e2) {
              if (!isTruncation(e2) && !isRefusal(e2)) throw e2
              catalogSkipped = true
            }
          } else {
            throw e
          }
        }
      } catch (e) {
        if (isAbort(e)) {
          await reenqueue(
            `Document cataloging ran long and was cut at the execution deadline — continuing in a new execution${cuts + 1 >= 3 ? ' (final attempt used — the hunt will fall back to per-standard searches)' : ''}`,
            { cuts: cuts + 1, cutKey: 'discovery' },
          )
          return
        }
        throw e
      } finally {
        bound.dispose()
      }
    }

    let owned = true
    current = await mutatePacket(packetId, (p) => {
      if (p.status !== 'hunting' || !ownsHunt(p)) {
        owned = false
        return
      }
      // Union by key: a deepen re-hunt re-catalogs while doneSources keeps
      // already-transcribed documents from being paid for twice.
      const byKey = new Map((p.sources ?? []).map((s) => [s.key, s]))
      for (const s of found) if (!byKey.has(s.key)) byKey.set(s.key, s)
      p.sources = [...byKey.values()]
      p.updated = nowIso()
    })
    if (!owned) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping (catalog discarded)')
      return
    }
    const sourceCount = current.sources?.length ?? 0
    const alreadyDone = Math.max(0, doneStages(current) - 1)
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = 1
      r.totalStages = 1 + sourceCount + 1 // +1 reserves the sweep; replaced by the real batch count when the sweep starts
      pushLog(
        r,
        catalogSkipped
          ? 'The document catalog could not be completed — falling back to per-standard searches for every standard'
          : `Catalog: ${sourceCount} released-test document${sourceCount === 1 ? '' : 's'} to transcribe` +
              (alreadyDone > 0 ? ` (${alreadyDone} already transcribed)` : '') +
              (dropped > 0 ? ` — ${dropped} more were found but dropped over the ${MAX_SOURCES}-document cap` : ''),
      )
    })
  } else {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'running'
      r.stage = 'Transcribing released-test documents'
    })
  }

  // -------------------------------------------------------------------------
  // Phase 2 — transcription: one document at a time, exhaustively
  // -------------------------------------------------------------------------
  const sources = current.sources ?? []
  const doneSrc = new Set(current.doneSources ?? [])
  for (const source of sources) {
    if (doneSrc.has(source.key)) continue

    const cur = await freshOrStop()
    if (!cur) return
    for (const k of cur.doneSources ?? []) doneSrc.add(k)
    if (doneSrc.has(source.key)) continue
    if (await stopRequested(`${doneSrc.size} of ${sources.length} documents transcribed`)) return
    if (outOfBudget()) {
      await reenqueue(`Time budget reached — continuing in a new execution (${doneSrc.size}/${sources.length} documents transcribed)`)
      return
    }

    const label = `${source.program} ${source.year} · Grade ${source.grade}`
    const cuts = cutsFor(`src|${source.key}`)
    let sourceNote = ''
    if (cuts >= 3) {
      // Three executions could not get through this document even with small
      // pages — close it out with whatever was checkpointed so the rest of
      // the catalog proceeds.
      sourceNote = 'transcription ran long three times — moving on with what was captured'
    } else {
      const lean = cuts >= 1
      // Continuation paging: item numbers already checkpointed for this
      // document are excluded from every following call, so a cut execution
      // resumes mid-document without re-paying for finished pages.
      let already = itemNumbersFor(cur, source.key)
      for (let call = 0; call < MAX_CALLS_PER_SOURCE; call++) {
        if (call > 0 && outOfBudget()) {
          await reenqueue(
            `Time budget reached mid-document — continuing ${label} in a new execution (${already.length} items so far)`,
          )
          return
        }
        context.log(`packet/hunt ${packetId}: transcribing ${label}${lean ? ' (lean — prior execution was cut)' : ''} — ${source.url}`)
        const bound = bounded()
        let page: { items: HuntedItem[]; complete: boolean }
        try {
          try {
            page = await transcribeCall(current, source, already, lean, bound.signal)
          } catch (e) {
            if (isTruncation(e) || isRefusal(e)) {
              // Both are worth exactly one lean re-try: truncation because a
              // smaller page always fits; refusal because it is a classifier
              // false positive set off by whatever got fetched, and a re-run
              // fetches differently. A second failure keeps the pages already
              // captured instead of failing the whole packet.
              context.warn(`packet/hunt ${packetId}: ${label} ${isRefusal(e) ? 'refused' : 'truncated'} — retrying lean`)
              try {
                page = await transcribeCall(current, source, already, true, bound.signal)
              } catch (e2) {
                if (!isTruncation(e2) && !isRefusal(e2)) throw e2
                sourceNote = `${isRefusal(e2) ? 'the transcription call was declined' : 'the reply overflowed'} twice — moving on with what was captured`
                break
              }
            } else {
              throw e
            }
          }
        } catch (e) {
          if (isAbort(e)) {
            await reenqueue(
              `${label}: transcription ran long and was cut at the execution deadline — continuing in a new execution${cuts + 1 >= 3 ? ' (final attempt used — the document will be closed out)' : cuts + 1 >= 1 ? ' with smaller pages' : ''}`,
              { cuts: cuts + 1, cutKey: `src|${source.key}` },
            )
            return
          }
          throw e
        } finally {
          bound.dispose()
        }

        let owned = true
        let added = 0
        await mutatePacket(packetId, (p) => {
          if (p.status !== 'hunting' || !ownsHunt(p)) {
            owned = false
            return
          }
          added = mergeItems(p, page.items)
          p.updated = nowIso()
        })
        if (!owned) {
          await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping (page results discarded)')
          return
        }
        // complete, or a page that added nothing new (the model is looping) —
        // either way this document is exhausted.
        if (page.complete || added === 0) break
        already = [...already, ...page.items.map((i) => i.itemNumber).filter((n) => n.length > 0)]
      }
    }

    let owned = true
    const after = await mutatePacket(packetId, (p) => {
      if (p.status !== 'hunting' || !ownsHunt(p)) {
        owned = false
        return
      }
      p.doneSources = p.doneSources ?? []
      if (!p.doneSources.includes(source.key)) p.doneSources.push(source.key)
      p.updated = nowIso()
    })
    if (!owned) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping')
      return
    }
    doneSrc.add(source.key)
    const sourceItems = after.items.filter((i) => i.sourceKey === source.key).length
    await mutateJob(msg.jobId, (r) => {
      r.stage = 'Transcribing released-test documents'
      r.stagesDone = doneStages(after)
      pushLog(
        r,
        sourceNote
          ? `${label}: ${sourceNote}${sourceItems > 0 ? ` (${sourceItems} item${sourceItems === 1 ? '' : 's'} kept)` : ''}`
          : sourceItems === 0
            ? `${label}: no in-scope items could be transcribed from this document`
            : `${label}: transcribed ${sourceItems} item${sourceItems === 1 ? '' : 's'}` +
              (source.expectedItems > 0 && sourceItems < source.expectedItems
                ? ` of ~${source.expectedItems} the release lists`
                : ''),
      )
    })
  }

  // -------------------------------------------------------------------------
  // Phase 3 — gap sweep: per-standard search for standards still without items
  // -------------------------------------------------------------------------
  const preSweep = await freshOrStop()
  if (!preSweep) return
  const batches = sweepBatchesOf(preSweep)
  const done = new Set(preSweep.doneBatches)
  const baseStages = 1 + (preSweep.sources?.length ?? 0)
  await mutateJob(msg.jobId, (r) => {
    r.totalStages = baseStages + batches.length
    r.stagesDone = doneStages(preSweep) + batches.filter((b) => done.has(b.key)).length
    if (batches.some((b) => !done.has(b.key))) {
      r.stage = 'Searching for standards the documents did not cover'
      const gapCount = batches.reduce((n, b) => n + b.standards.length, 0)
      pushLog(r, `Gap sweep: ${gapCount} standard${gapCount === 1 ? '' : 's'} still without items — ${batches.length} targeted search${batches.length === 1 ? '' : 'es'}`)
    }
  })

  for (const batch of batches) {
    if (done.has(batch.key)) continue

    const cur = await freshOrStop()
    if (!cur) return
    for (const key of cur.doneBatches) done.add(key)
    if (done.has(batch.key)) continue
    if (await stopRequested(`${batches.filter((b) => done.has(b.key)).length} of ${batches.length} gap searches finished`)) return
    if (outOfBudget()) {
      await reenqueue('Time budget reached — continuing in a new execution (gap sweep)')
      return
    }

    const label = `Grade ${batch.grade} · ${batch.domainName}`
    const cuts = cutsFor(batch.key)
    let skippedAfterCuts = false
    let found: HuntedItem[]

    if (cuts >= 3) {
      // Three executions could not finish this batch even in lean mode —
      // record it searched-and-skipped so the rest of the packet proceeds.
      found = []
      skippedAfterCuts = true
    } else {
      const lean = cuts >= 1
      context.log(
        `packet/hunt ${packetId}: gap-searching ${label}${lean ? ' (lean — prior execution was cut)' : ''} (${batch.standards.map((s) => s.code).join(', ')})`,
      )
      const bound = bounded()
      let truncatedTwice = false
      try {
        try {
          found = await huntBatch(current, batch, bound.signal, lean)
        } catch (e) {
          if (isTruncation(e) || isRefusal(e)) {
            // Both are worth exactly one lean re-hunt: truncation because web
            // output is nondeterministic and a concise reply usually fits;
            // refusal because it is a classifier false positive set off by
            // whatever page got fetched, and a re-hunt fetches differently. A
            // second failure records the batch as searched (its standards stay
            // documentation gaps) instead of failing the whole packet via the
            // worker's fail-fast.
            context.warn(`packet/hunt ${packetId}: ${label} ${isRefusal(e) ? 'refused' : 'truncated'} — retrying lean`)
            try {
              found = await huntBatch(current, batch, bound.signal, true)
            } catch (e2) {
              if (!isTruncation(e2) && !isRefusal(e2)) throw e2
              found = []
              truncatedTwice = true
            }
          } else {
            throw e
          }
        }
      } catch (e) {
        if (isAbort(e)) {
          await reenqueue(
            `${label}: search ran long and was cut at the execution deadline — continuing in a new execution${cuts + 1 >= 3 ? ' (final attempt used — the batch will be skipped)' : cuts + 1 >= 1 ? ' with a leaner search' : ''}`,
            { cuts: cuts + 1, cutKey: batch.key },
          )
          return
        }
        throw e
      } finally {
        bound.dispose()
      }
      if (truncatedTwice) skippedAfterCuts = true
    }

    done.add(batch.key)
    let owned = true
    await mutatePacket(packetId, (p) => {
      if (p.status !== 'hunting' || !ownsHunt(p)) {
        owned = false
        return
      }
      mergeItems(p, found)
      if (!p.doneBatches.includes(batch.key)) p.doneBatches.push(batch.key)
      p.updated = nowIso()
    })
    if (!owned) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping (batch results discarded)')
      return
    }
    const covered = new Set(found.map((i) => i.standardCode)).size
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.min(r.stagesDone + 1, r.totalStages)
      pushLog(
        r,
        skippedAfterCuts
          ? `${label}: the gap search could not be completed (ran long, overflowed, or was declined twice) — batch skipped; its standards remain documentation gaps`
          : found.length === 0
            ? `${label}: no released items found online (documentation gap)`
            : `${label}: found ${found.length} released item${found.length === 1 ? '' : 's'} covering ${covered} standard${covered === 1 ? '' : 's'}`,
      )
    })
  }

  // -------------------------------------------------------------------------
  // Phase 4 — screenshot capture: crop real item screenshots from the sources
  // -------------------------------------------------------------------------
  const preShots = await freshOrStop()
  if (!preShots) return
  const domains = FRAMEWORK_HUNTS[preShots.framework].domains
  const shotGroups = shotGroupsOf(preShots, domains)
  const shotsDone = new Set(preShots.doneShots ?? [])
  const stagesBeforeShots = 1 + (preShots.sources?.length ?? 0) + batches.length
  await mutateJob(msg.jobId, (r) => {
    r.totalStages = stagesBeforeShots + shotsDone.size + shotGroups.length
    if (shotGroups.length > 0) {
      r.stage = 'Capturing item screenshots'
      pushLog(
        r,
        `Screenshot capture: ${shotGroups.length} source document${shotGroups.length === 1 ? '' : 's'} to crop item screenshots from`,
      )
    }
  })

  for (const group of shotGroups) {
    const cur = await freshOrStop()
    if (!cur) return
    for (const key of cur.doneShots ?? []) shotsDone.add(key)
    if (shotsDone.has(group.key)) continue
    if (await stopRequested(`${shotsDone.size} of ${shotsDone.size + shotGroups.length} screenshot sources processed`)) return
    if (outOfBudget()) {
      await reenqueue('Time budget reached — continuing in a new execution (screenshot capture)')
      return
    }

    const label = new URL(group.url).hostname + ' — ' + (group.items[0]?.sourceName || group.url)
    const cuts = cutsFor(group.key)
    let note: string
    let paths = new Map<string, string[]>()
    if (cuts >= 3) {
      note = 'capture ran long three times — skipped; text facsimiles kept'
    } else {
      context.log(`packet/hunt ${packetId}: capturing screenshots from ${group.url} (${group.items.length} items)`)
      const bound = bounded()
      try {
        ;({ paths, note } = await captureShotsForGroup(packetId, group, bound.signal, context))
      } catch (e) {
        if (isAbort(e)) {
          await reenqueue(
            `Screenshot capture for ${label} ran long and was cut at the execution deadline — continuing in a new execution${cuts + 1 >= 3 ? ' (final attempt used — the document will be skipped)' : ''}`,
            { cuts: cuts + 1, cutKey: group.key },
          )
          return
        }
        // Capture is best-effort — anything unexpected skips the document.
        context.warn(`packet/hunt ${packetId}: screenshot capture failed for ${group.url}`, e)
        note = 'capture failed — text facsimiles kept'
      } finally {
        bound.dispose()
      }
    }

    shotsDone.add(group.key)
    let owned = true
    await mutatePacket(packetId, (p) => {
      if (p.status !== 'hunting' || !ownsHunt(p)) {
        owned = false
        return
      }
      for (const item of p.items) {
        const captured = paths.get(item.id)
        if (captured && captured.length > 0) item.screenshotPaths = captured
      }
      p.doneShots = p.doneShots ?? []
      if (!p.doneShots.includes(group.key)) p.doneShots.push(group.key)
      p.updated = nowIso()
    })
    if (!owned) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping (screenshots kept)')
      return
    }
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.min(r.stagesDone + 1, r.totalStages)
      pushLog(r, `Screenshots — ${label}: ${note}`)
    })
  }

  // All documents transcribed, gaps swept, and screenshots captured — settle
  // (only while this job still owns the hunt).
  const settled = await mutatePacket(packetId, (p) => {
    if (p.status === 'hunting' && ownsHunt(p)) p.status = 'complete'
    p.updated = nowIso()
  })
  const coveredCodes = new Set(settled.items.map((i) => i.standardCode))
  const gaps = settled.standards.filter((s) => !coveredCodes.has(s.code)).length
  const docCount = (settled.doneSources ?? []).length
  const shotCount = settled.items.filter((i) => (i.screenshotPaths?.length ?? 0) > 0).length
  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stage = 'Complete'
    r.stagesDone = r.totalStages
    pushLog(
      r,
      `Hunt complete: ${settled.items.length} released item${settled.items.length === 1 ? '' : 's'} across ${coveredCodes.size} of ${settled.standards.length} standards` +
        (docCount > 0 ? ` from ${docCount} document${docCount === 1 ? '' : 's'}` : '') +
        (shotCount > 0 ? ` — ${shotCount} with real screenshots` : '') +
        (gaps > 0 ? ` — ${gaps} standard${gaps === 1 ? '' : 's'} with no released evidence found (documentation gaps)` : ''),
    )
  })
}

/** Settles a job row whose work turned out to be moot (deleted/settled packet) — never poison the message. */
async function settleJobQuietly(jobId: string, detail: string): Promise<void> {
  await mutateJob(jobId, (r) => {
    if (r.status === 'queued' || r.status === 'running') {
      r.status = 'complete'
      r.stage = 'Complete'
      r.stagesDone = r.totalStages
    }
    pushLog(r, detail)
  })
}

/** Item numbers already checkpointed for a document — the continuation exclude-list. */
function itemNumbersFor(packet: EvidencePacket, sourceKey: string): string[] {
  return packet.items.filter((i) => i.sourceKey === sourceKey && i.itemNumber.length > 0).map((i) => i.itemNumber)
}

/**
 * Dedupe on source identity — a redelivered page or overlapping search must
 * not double items. Transcribed items carry (sourceKey, itemNumber), which is
 * exact; everything else falls back to a content key. Returns how many items
 * were actually added.
 */
function mergeItems(packet: EvidencePacket, found: HuntedItem[]): number {
  const contentKey = (i: HuntedItem) =>
    `${i.standardCode}|${i.sourceUrl}|${i.itemNumber}|${i.stem.slice(0, 80)}`.toLowerCase()
  const srcKey = (i: HuntedItem) => (i.sourceKey && i.itemNumber ? `${i.sourceKey}|${i.itemNumber}`.toLowerCase() : '')
  const seenContent = new Set(packet.items.map(contentKey))
  const seenSrc = new Set(packet.items.map(srcKey).filter((k) => k.length > 0))
  let added = 0
  for (const item of found) {
    if (packet.items.length >= MAX_ITEMS_PER_PACKET) break
    const sk = srcKey(item)
    if (sk && seenSrc.has(sk)) continue
    const ck = contentKey(item)
    if (seenContent.has(ck)) continue
    if (sk) seenSrc.add(sk)
    seenContent.add(ck)
    packet.items.push(item)
    added++
  }
  return added
}

// ---------------------------------------------------------------------------
// Framework research grounding — shared by all three phases
// ---------------------------------------------------------------------------

/** Where genuine released items live for each framework — search guidance, not a restriction. */
// Search guidance grounded in AI-verified research of the official release
// pages (what actually exists 2017–2026), cross-checked per year. `domains`
// is the web_fetch allow-list: genuine released items live only on official
// portals, and fetching arbitrary pages feeds untrusted content to the model
// (one grade-4 math hunt was safety-refused off a stray fetch).
const FRAMEWORK_HUNTS: Record<EvidencePacket['framework'], { programs: string; hint: string; domains: string[] }> = {
  ccss: {
    programs: 'Common Core–aligned state assessments and the Smarter Balanced sample-item bank',
    hint: 'Work these sources, in order: (1) New York State Testing Program released questions (nysedregents.org/ei/ei-math.html — released annually 2017–2026 except 2020; each year × grade is ONE PDF holding every released question, with an item map and scoring key). (2) Massachusetts MCAS released items (doe.mass.edu/mcas/release.html, 2019 onward — per-year, per-grade released item documents). (3) Ohio\'s State Tests released items (education.ohio.gov and the Ohio Cambium portal — yearly released item PDFs with alignments). (4) California CAASPP materials (cde.ca.gov, caaspp.org — California administers Smarter Balanced; its practice-test scoring guides print SBAC-style items in full, one PDF per grade). (5) Smarter Balanced (SBAC) official sample items — the item viewer (sampleitems.smarterbalanced.org) is a JS app a fetch cannot read, so use the printable Smarter Balanced sample-item scoring guides (search "smarter balanced scoring guide grade N mathematics filetype:pdf") or state renditions of the same items.',
    domains: ['nysedregents.org', 'nysed.gov', 'doe.mass.edu', 'mass.gov', 'smarterbalanced.org', 'corestandards.org', 'engageny.org', 'education.ohio.gov', 'ohio.gov', 'cambiumast.com', 'cambiumtds.com', 'cde.ca.gov', 'caaspp.org', 'caaspp-elpac.org'],
  },
  teks: {
    programs: 'STAAR (State of Texas Assessments of Academic Readiness)',
    hint: 'Texas Education Agency released STAAR tests and answer keys (tea.texas.gov released-test-questions pages: 2017–2019 and 2021–2022 as one full-test PDF per year × grade with a separate answer key; 2023 onward the redesigned tests live on the official Cambium practice site linked from texasassessment.gov).',
    domains: ['tea.texas.gov', 'texas.gov', 'texasassessment.gov', 'cambiumtds.com', 'cambiumast.com'],
  },
  sol: {
    programs: 'Virginia SOL (Standards of Learning) official practice item sets',
    hint: 'IMPORTANT: VDOE has released NO full grade 3–8 math SOL tests since spring 2014 (those align to the superseded 2009 standards — do not use them). The genuine current materials are the official SOL Practice Items aligned to the 2023 Mathematics SOL, published 2025 on doe.virginia.gov (online TestNav sets plus grade-by-grade printable multiple-choice PDFs with keys). The 2018-era practice sets align to the 2016 standards — map one to a 2023 code only when the content genuinely matches, and say so in notes.',
    domains: ['doe.virginia.gov', 'virginia.gov', 'pearsonaccessnext.com'],
  },
  best: {
    programs: 'Florida FAST assessments (B.E.S.T. standards)',
    hint: 'FLDOE/Cambium FAST released tests and Test Release Support Documents (flfast.org — spring 2023 onward, with answer keys and B.E.S.T. benchmark codes) plus official B.E.S.T. sample items. Anything before 2023 is the old FSA program aligned to the superseded MAFS standards — do not use it.',
    domains: ['fldoe.org', 'flfast.org', 'cambiumast.com', 'cambiumtds.com'],
  },
}

const ITEM_DEF: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'standardCode',
    'program',
    'year',
    'itemNumber',
    'itemType',
    'stem',
    'choices',
    'answer',
    'sourceUrl',
    'sourceName',
    'alignment',
    'notes',
  ],
  properties: {
    standardCode: { type: 'string' },
    program: { type: 'string' },
    year: { type: 'number' },
    itemNumber: { type: 'string' },
    itemType: { type: 'string', enum: ['selected-response', 'constructed-response', 'multi-part'] },
    stem: { type: 'string' },
    choices: { type: 'array', items: { type: 'string' } },
    answer: { type: 'string' },
    sourceUrl: { type: 'string' },
    sourceName: { type: 'string' },
    alignment: { type: 'string', enum: ['official', 'ai-inferred'] },
    notes: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Phase 1 — discovery
// ---------------------------------------------------------------------------

const DISCOVER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['sources', 'summary'],
  properties: {
    sources: { type: 'array', items: { $ref: '#/$defs/source' } },
    summary: { type: 'string' },
  },
  $defs: {
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['program', 'year', 'grade', 'url', 'title', 'expectedItems', 'note'],
      properties: {
        program: { type: 'string' },
        year: { type: 'number' },
        grade: { type: 'number' },
        url: { type: 'string' },
        title: { type: 'string' },
        expectedItems: { type: 'number' },
        note: { type: 'string' },
      },
    },
  },
}

const DISCOVER_SYSTEM = `You are an assessment-corpus researcher for a mathematics curriculum design team. Your job is to use web search to build a CATALOG of official released-test documents — the documents themselves, not individual items. A transcription pass will open every document you catalog and transcribe every item in it, so the completeness of your catalog decides the completeness of the whole repository.

Binding rules:
1. Only official sources: state education agencies and their official assessment portals. No third-party mirrors, test-prep sites, or teacher-resource aggregators.
2. NEVER invent a URL. Every url you output must be one you actually saw in a search result or on a page you fetched in this conversation.
3. One catalog entry per (document, grade). A release page that links per-grade PDFs yields one entry per grade, each with its own PDF URL. Prefer the direct document (PDF) URL; when the release lives in an online viewer with no per-grade document, give the official release page and explain in note.
4. Only the grades and years asked for, and never a test administered before 2017. A document outside them must not appear in the catalog.
5. expectedItems: the item count the release page or document states, when it states one; 0 when unstated.
6. Be exhaustive across program × year × grade FIRST — a missing year is a hole in the repository. Then stop: no duplicates, no practice workbooks, no superseded-standards materials.`

async function discoverSources(
  packet: EvidencePacket,
  signal: AbortSignal,
  /** Lean mode (after a cut or truncation): fewer searches, highest-yield documents only. */
  concise: boolean,
): Promise<{ sources: HuntSource[]; dropped: number }> {
  const hunt = FRAMEWORK_HUNTS[packet.framework]
  // Selected years are a hard filter with NO preference among them — the
  // catalog covers all of them equally and must not substitute other years.
  const yearsLine =
    packet.years.length > 0
      ? `Catalog ONLY documents from tests administered in these years: ${packet.years.join(', ')}. Every listed year matters equally — a missing year is a hole in the repository. Skip all other years.`
      : 'Catalog every administration year from 2017 onward — no year is preferred over another.'
  const grades = packet.grades.join(', ')
  const user = `Catalog every official released-test document for ${packet.frameworkLabel} mathematics, grade${packet.grades.length === 1 ? '' : 's'} ${grades}.

Assessment program(s): ${hunt.programs}.
Where the releases live: ${hunt.hint}
${yearsLine}

Search the web, open release index pages with web_fetch when a listing is unclear, and return the catalog: one entry per (document, grade) with the document's real URL.${
    concise
      ? '\n\nIMPORTANT: a previous attempt ran out of time or output budget. Work lean this time: at most 6 searches, catalog the highest-yield documents only, keep notes to a few words.'
      : ''
  }`

  const result = await generateStructured<{ sources?: unknown[] }>({
    system: DISCOVER_SYSTEM,
    user,
    schema: DISCOVER_SCHEMA,
    maxTokens: concise ? 6000 : 12000,
    effort: concise ? 'low' : 'medium',
    webSearch: true,
    maxSearches: concise ? 6 : 15,
    fetchDomains: hunt.domains,
    // Fable's dual-use gating refused every fetch-enabled hunt (false
    // positive on grade-school math); Opus 4.8 — the same model Fable's
    // server-side fallback targets — runs these turns without the gating.
    model: 'claude-opus-4-8',
    signal,
  })
  return sanitizeSources(result.sources ?? [], packet)
}

/** The discovery reply is unconstrained (web search) — validate structurally and drop anything off-scope. */
function sanitizeSources(raw: unknown[], packet: EvidencePacket): { sources: HuntSource[]; dropped: number } {
  const out: HuntSource[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue
    const r = value as Record<string, unknown>
    const url = cleanText(r.url)
    if (!/^https?:\/\//i.test(url)) continue
    const year = Math.trunc(Number(r.year))
    // Policy: no tests administered before 2017; selected years are a HARD filter.
    if (!Number.isFinite(year) || year < 2017 || year >= 2100) continue
    if (packet.years.length > 0 && !packet.years.includes(year)) continue
    const grade = Math.trunc(Number(r.grade))
    if (!packet.grades.includes(grade)) continue
    // The key strips only the fragment and trailing slashes — query strings
    // can legitimately distinguish documents on portal viewers.
    const key = `${grade}|${url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    if (out.length >= MAX_SOURCES) {
      dropped++
      continue
    }
    const expected = Math.trunc(Number(r.expectedItems))
    out.push({
      key,
      program: cleanText(r.program) || packet.frameworkLabel,
      year,
      grade,
      url,
      title: cleanText(r.title) || url,
      expectedItems: Number.isFinite(expected) && expected > 0 && expected < 500 ? expected : 0,
      note: cleanText(r.note),
    })
  }
  return { sources: out, dropped }
}

// ---------------------------------------------------------------------------
// Phase 2 — transcription
// ---------------------------------------------------------------------------

const TRANSCRIBE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'complete', 'note'],
  properties: {
    items: { type: 'array', items: { $ref: '#/$defs/item' } },
    complete: { type: 'boolean' },
    note: { type: 'string' },
  },
  $defs: { item: ITEM_DEF },
}

const TRANSCRIBE_SYSTEM = `You are an assessment-evidence transcriber for a mathematics curriculum design team. You are given ONE official released-test document. Your job is to open it with web_fetch and transcribe EVERY in-scope mathematics item in it, faithfully.

Binding rules:
1. NEVER invent, paraphrase, or reconstruct an item from memory. Transcribe only what you actually read in the document (or its official answer key / item map) in this conversation. A fabricated "released item" is worse than no item.
2. Open the given document URL with web_fetch FIRST. If it is a release page rather than the test document itself, fetch the actual item document for the given grade from it. Use web_search only to locate the document's official answer key or item map when the document itself lacks them.
3. Work item by item, in document order, skipping nothing that is in scope. An item is in scope when it aligns to ANY standard in the provided list.
4. standardCode: use the document's official item map or alignment table when one exists (alignment "official"); when none exists, judge the alignment yourself against the provided list (alignment "ai-inferred"). An item that aligns to NO listed standard is out of scope — skip it and count it in "note".
5. Transcribe faithfully: the exact stem wording, every answer choice in order, and the correct answer ONLY when the source publishes a key ('' otherwise). Write mathematical notation in plain text or Unicode (3/4, 2^3, ×, ÷, °).
6. Items built around a graphic (number line, figure, graph, table): if the item still works with the graphic described, include it and describe the graphic inside square brackets in the stem, noting this in "notes". If the item is meaningless without seeing the graphic, skip it — do not guess its content.
7. sourceUrl is the real URL of the document you transcribed from. itemNumber is the question's number or label in the document — REQUIRED, using the document's own numbering (it drives continuation across calls).
8. Pace yourself: transcribe at most the requested number of items per reply. If in-scope items remain beyond that, set complete=false — you will be called again for the rest. Set complete=true only when every in-scope item of the document has been transcribed, in this reply or an earlier one.
9. Never repeat an item whose number is in the already-transcribed list.`

async function transcribeCall(
  packet: EvidencePacket,
  source: HuntSource,
  already: string[],
  /** Lean mode (after a truncation or a deadline cut): smaller page, tighter output. */
  concise: boolean,
  signal: AbortSignal,
): Promise<{ items: HuntedItem[]; complete: boolean }> {
  const hunt = FRAMEWORK_HUNTS[packet.framework]
  const page = concise ? TRANSCRIBE_PAGE_LEAN : TRANSCRIBE_PAGE
  const user = `Transcribe the released assessment items in this document.

Document: ${source.title}
Program: ${source.program} — administered ${source.year}, Grade ${source.grade}
URL: ${source.url}${source.note ? `\nCatalog note: ${source.note}` : ''}${
    source.expectedItems > 0 ? `\nThe release lists about ${source.expectedItems} items.` : ''
  }

Standards in scope (${packet.frameworkLabel}):
${packet.standards.map((s) => `- ${s.code}: ${s.text}`).join('\n')}

${
  already.length > 0
    ? `Already transcribed from this document — do NOT repeat: ${already.join(', ')}\n\n`
    : ''
}Transcribe up to ${page} not-yet-transcribed in-scope items in document order, then set complete=true only if none remain after them.${
    concise
      ? '\n\nIMPORTANT: a previous attempt ran out of time or output budget. Keep notes to one short sentence and skip any item whose stem would need more than a short paragraph.'
      : ''
  }`

  const result = await generateStructured<{ items?: unknown[]; complete?: unknown }>({
    system: TRANSCRIBE_SYSTEM,
    user,
    schema: TRANSCRIBE_SCHEMA,
    maxTokens: concise ? 15000 : TRANSCRIBE_MAX_TOKENS,
    effort: 'medium',
    webSearch: true,
    maxSearches: 4,
    fetchDomains: hunt.domains,
    fetchContentTokens: TRANSCRIBE_FETCH_TOKENS,
    // Same Opus-direct rationale as the other hunt calls (Fable's dual-use
    // gating false-positives on fetched grade-school math).
    model: 'claude-opus-4-8',
    signal,
  })
  return {
    items: sanitizeItems(result.items ?? [], {
      codes: new Map(packet.standards.map((s) => [normCode(s.code), s.code])),
      years: [],
      source,
    }),
    complete: result.complete === true,
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — gap sweep (the original per-standard batched hunt)
// ---------------------------------------------------------------------------

const HUNT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'gaps'],
  properties: {
    items: { type: 'array', items: { $ref: '#/$defs/item' } },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['standardCode', 'note'],
        properties: { standardCode: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
  $defs: { item: ITEM_DEF },
}

const HUNT_SYSTEM = `You are an assessment-evidence researcher for a mathematics curriculum design team. Your job is to use web search to find GENUINE released or officially published sample assessment items for specific academic standards, and to transcribe them faithfully.

Binding rules:
1. NEVER invent, paraphrase, or reconstruct an item from memory. Report only items you actually read in a source document you opened in this conversation. A fabricated "released item" is worse than no item.
2. Work search-then-fetch: use web_search to locate released-test documents, then web_fetch to OPEN the most promising page or PDF and transcribe items from the document itself. Search snippets alone are NOT sufficient evidence to transcribe from. Budget: locate with 1-2 searches, then spend your remaining uses fetching the best documents.
3. If you cannot find (and open) a genuine item for a standard, list that standard in "gaps" with a short note on what you searched. Absence of released evidence is a documentation gap, not a failure — reporting a gap honestly is a correct outcome.
4. Transcribe faithfully: the exact stem wording, every answer choice in order, and the correct answer ONLY when the source publishes a key ('' otherwise). Write mathematical notation in plain text or Unicode (3/4, 2^3, ×, ÷, °).
5. Items built around a graphic (number line, figure, graph, table): if the item still works with the graphic described, include it and describe the graphic inside square brackets in the stem, noting this in "notes". If the item is meaningless without seeing the graphic, skip it — do not guess its content.
6. sourceUrl must be the real URL of the page or PDF you opened — never constructed from memory. sourceName is that document's title.
7. alignment is "official" ONLY when the source document (or the agency's item map/blueprint) explicitly labels the item with the standard code. If YOU judged the alignment from the item's content, it is "ai-inferred".
8. year is the administration or publication year of the source (a number, e.g. 2022); use 0 only when the source genuinely does not say. itemNumber is the question's number or label in the source ('' if unknown).
9. NEVER transcribe items from tests administered before 2017. If the only findable materials for a standard predate 2017, report the standard as a gap instead.
10. Find up to ${SWEEP_ITEMS_PER_STANDARD} strong items per standard — prefer breadth (every standard covered) over depth. Work decisively: pick sources fast, transcribe, and answer — a smaller honest result beats an exhaustive search that never finishes.`

/** CCSS code → the SBAC bank's id style (cluster letter dropped): 4.NBT.B.5 → '4.NBT.5', 4.NF.B.3a → '4.NF.3a'. */
const sbacCodeOf = (code: string): string => code.replace(/^(\d+\.[A-Z]+)\.[A-Z]\./, '$1.')

/**
 * The batch's slice of the official Smarter Balanced sample-item bank — the
 * full catalog JSON (~2.2 MB) is far beyond a fetch budget, so the baked
 * index supplies what exists per standard: ids, official alignment, claim,
 * DOK, type, published keys, release year. The agent's job is then to obtain
 * each item's TEXT from a printable source, never to invent it.
 */
function sbacBlock(batch: HuntBatch): string {
  const lines: string[] = []
  for (const st of batch.standards) {
    const entries = SBAC_ITEMS[sbacCodeOf(st.code)]
    if (!entries || entries.length === 0) continue
    lines.push(
      `- ${st.code}: ${entries
        .map(
          (e) =>
            `item ${e.id} (claim ${e.claim}${e.target ? ` target ${e.target}` : ''}, DOK ${e.dok}, ${e.type}${e.keys ? `, key: ${e.keys}` : ''}${e.year ? `, released ${e.year}` : ''})`,
        )
        .join('; ')}`,
    )
  }
  if (lines.length === 0) return ''
  return `\n\nOfficial Smarter Balanced sample items for these standards (from the SBAC item bank — this alignment IS official; each item's page is https://sampleitems.smarterbalanced.org/Item/<id> but that viewer is a JS app a fetch cannot read):
${lines.join('\n')}
Cover every listed item whose text you can obtain from a printable source (SBAC or CAASPP scoring-guide PDFs, or a state rendition); use program "Smarter Balanced sample item", the listed release year, the item id as itemNumber, and the listed key as the answer. An item you cannot obtain the text of must NOT be transcribed from this metadata — mention the unobtained ids in the standard's gap note instead.`
}

async function huntBatch(
  packet: EvidencePacket,
  batch: HuntBatch,
  signal?: AbortSignal,
  /** Lean mode (after a truncation or a deadline cut): fewer tool uses, tighter output. */
  concise = false,
): Promise<HuntedItem[]> {
  const hunt = FRAMEWORK_HUNTS[packet.framework]
  // Selected years are a hard filter with NO preference among them — the agent
  // hunts all of them equally and must not substitute other years.
  const yearsLine =
    packet.years.length > 0
      ? `Only transcribe items from tests administered in these years: ${packet.years.join(', ')}. Cover every listed year you can find items for — no year is preferred over another. Do NOT include items from any other year; if a standard's only findable items fall outside these years, report it as a gap.`
      : 'Any administration year from 2017 onward is acceptable — no year is preferred over another.'
  const perStandard = concise ? 2 : SWEEP_ITEMS_PER_STANDARD
  const user = `Find released assessment items for these ${packet.frameworkLabel} standards.

Assessment program(s) to hunt: ${hunt.programs}.
Where genuine released items usually live: ${hunt.hint}
${yearsLine}

Grade ${batch.grade} — ${batch.domainName}:
${batch.standards.map((s) => `- ${s.code}: ${s.text}`).join('\n')}${packet.framework === 'ccss' ? sbacBlock(batch) : ''}

Search the web for released tests, released item documents, and official sample items assessing these specific standards; open the best documents with web_fetch and transcribe from them. Transcribe every genuine item you find (up to ${perStandard} per standard), and report standards with no findable released evidence as gaps.${
    concise
      ? '\n\nIMPORTANT: a previous attempt ran out of time or output budget. Work lean this time: ONE search, fetch ONE document, transcribe at most 2 short items per standard, keep notes to one short sentence, and skip any item whose stem would need more than a short paragraph.'
      : ''
  }`

  const result = await generateStructured<{
    items?: unknown[]
    gaps?: { standardCode?: string; note?: string }[]
  }>({
    system: HUNT_SYSTEM,
    user,
    schema: HUNT_SCHEMA,
    maxTokens: concise ? 12000 : HUNT_MAX_TOKENS,
    effort: concise ? 'low' : 'medium',
    webSearch: true,
    maxSearches: concise ? 3 : MAX_SEARCHES_PER_BATCH,
    fetchDomains: hunt.domains,
    // Fable's dual-use gating refused every fetch-enabled hunt (false
    // positive on grade-school math); Opus 4.8 — the same model Fable's
    // server-side fallback targets — runs these turns without the gating.
    model: 'claude-opus-4-8',
    ...(signal ? { signal } : {}),
  })

  return sanitizeItems(result.items ?? [], {
    codes: new Map(batch.standards.map((s) => [normCode(s.code), s.code])),
    years: packet.years,
    perStandardCap: SWEEP_ITEMS_PER_STANDARD,
  })
}

// ---------------------------------------------------------------------------
// Shared sanitation
// ---------------------------------------------------------------------------

/**
 * XML 1.0 forbids C0 control characters (except tab/newline/CR) — one stray
 * escaped  in a transcription would permanently corrupt the packet's
 * Word export. Newlines are kept: multi-part stems legitimately use them.
 */
const cleanText = (v: unknown): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[ --]/g, ' ')
    .trim()

interface SanitizeContext {
  /** normCode → canonical code; items aligned to any other code are dropped. */
  codes: Map<string, string>
  /** Hard year filter (sweep). Ignored when `source` is given — its year was vetted at discovery. */
  years: number[]
  /** Per-standard cap for this reply (sweep breadth mode); unlimited when absent. */
  perStandardCap?: number
  /** Transcription: the document being transcribed — stamps sourceKey and pins program/year. */
  source?: HuntSource
}

/** Hunt replies are unconstrained (web search) — validate structurally and drop anything off-scope or unusable. */
function sanitizeItems(raw: unknown[], ctx: SanitizeContext): HuntedItem[] {
  const cap = ctx.perStandardCap ?? Number.POSITIVE_INFINITY
  const perStandard = new Map<string, number>()
  const out: HuntedItem[] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue
    const r = value as Record<string, unknown>
    const code = ctx.codes.get(normCode(String(r.standardCode ?? '')))
    if (!code) continue // hallucinated or out-of-scope standard
    const stem = cleanText(r.stem)
    if (stem.length < 10) continue
    let sourceUrl = cleanText(r.sourceUrl)
    if (!/^https?:\/\//i.test(sourceUrl)) {
      // Transcription knows the document — a malformed citation falls back to
      // it instead of dropping a faithfully transcribed item.
      if (!ctx.source) continue
      sourceUrl = ctx.source.url
    }
    const itemType = String(r.itemType ?? '')
    let year: number
    if (ctx.source) {
      // One document = one administration; the discovery phase already vetted
      // its year against the packet's hard filter.
      year = ctx.source.year
    } else {
      const yearNum = Math.trunc(Number(r.year))
      // Policy: no tests administered before 2017 (year 0 = source did not say).
      if (Number.isFinite(yearNum) && yearNum > 0 && yearNum < 2017) continue
      // Selected years are a HARD filter (no preference): drop items outside
      // them, including items whose source states no year — an unverifiable
      // year cannot satisfy the filter.
      if (ctx.years.length > 0 && !ctx.years.includes(yearNum)) continue
      year = Number.isFinite(yearNum) && yearNum > 1990 && yearNum < 2100 ? yearNum : 0
    }
    const count = perStandard.get(code) ?? 0
    if (count >= cap) continue
    perStandard.set(code, count + 1)
    out.push({
      id: newId('hunted'),
      standardCode: code,
      program: cleanText(r.program) || (ctx.source ? ctx.source.program : ''),
      year,
      itemNumber: cleanText(r.itemNumber),
      itemType:
        itemType === 'constructed-response' || itemType === 'multi-part' ? itemType : 'selected-response',
      stem,
      choices: Array.isArray(r.choices)
        ? r.choices.map((c) => cleanText(c)).filter((c) => c.length > 0)
        : [],
      answer: cleanText(r.answer),
      sourceUrl,
      sourceName: cleanText(r.sourceName) || (ctx.source ? ctx.source.title : ''),
      alignment: r.alignment === 'official' ? 'official' : 'ai-inferred',
      notes: cleanText(r.notes),
      ...(ctx.source ? { sourceKey: ctx.source.key } : {}),
    })
  }
  return out
}

const normCode = (code: string): string => code.toUpperCase().replace(/\s+/g, '')
