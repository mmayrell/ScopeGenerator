import { InvocationContext } from '@azure/functions'
import { EvidencePacket, HuntedItem, JobMessage, PacketStandard } from '../domain/types'
import { SBAC_ITEMS } from '../data/sbac-items'
import { getPacketOrUndefined, mutatePacket } from '../data/packets'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { newId, nowIso } from '../shared/util'

/**
 * Evidence-packet hunt step (kind 'packet' / step 'hunt') — the web-hunting
 * agent. Standards are grouped into per-domain batches; each batch is one
 * Claude call with the server-side web_search tool that finds genuine released
 * or official sample items online and transcribes them faithfully. Progress
 * checkpoints to the packet blob per batch (doneBatches), and the step
 * re-enqueues itself when the time budget runs out, so a packet of any size
 * fits the 10-minute Consumption timeout.
 */

/**
 * Hunt calls run web searches server-side and can take several minutes each;
 * stop launching new batches well before the 10-minute execution cap so the
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
/** Standards per hunt call — keeps each web-search turn focused and bounded. */
const BATCH_SIZE = 4
const MAX_SEARCHES_PER_BATCH = 8
/** Headroom for full SBAC-bank coverage (some standards carry 4+ official sample items) plus state released items. */
const MAX_ITEMS_PER_STANDARD = 6
const HUNT_MAX_TOKENS = 24000

const isTruncation = (e: unknown): boolean =>
  /truncated \(max_tokens/i.test(e instanceof Error ? e.message : String(e))
const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))
// Safety refusals on math hunts are classifier false positives set off by
// fetched page content, not by the request — retry once lean (different
// searches/fetches), then skip the batch instead of failing the packet.
const isRefusal = (e: unknown): boolean =>
  /declined this request/i.test(e instanceof Error ? e.message : String(e))

interface HuntBatch {
  key: string
  grade: number
  domainName: string
  standards: PacketStandard[]
}

/** Deterministic batching — grade → domain → chunks of BATCH_SIZE. */
export function huntBatchesOf(packet: EvidencePacket): HuntBatch[] {
  const groups = new Map<string, PacketStandard[]>()
  for (const st of packet.standards) {
    const gk = `${st.grade}|${st.domain}`
    groups.set(gk, [...(groups.get(gk) ?? []), st])
  }
  const batches: HuntBatch[] = []
  const keys = [...groups.keys()].sort()
  for (const gk of keys) {
    const standards = groups.get(gk)!.slice().sort((a, b) => a.code.localeCompare(b.code))
    for (let i = 0; i < standards.length; i += BATCH_SIZE) {
      const chunk = standards.slice(i, i + BATCH_SIZE)
      batches.push({
        key: `${gk}|${i / BATCH_SIZE}`,
        grade: chunk[0].grade,
        domainName: chunk[0].domainName,
        standards: chunk,
      })
    }
  }
  return batches
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

  const batches = huntBatchesOf(packet)
  const done = new Set(packet.doneBatches)
  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = batches.length
    r.stagesDone = Math.min(done.size, batches.length)
    r.stage = 'Hunting released items online'
    pushLog(r, `Web hunt: ${batches.length - done.size} of ${batches.length} search batches remaining`)
  })

  // Deadline-cut escalation state rides the queue message: cuts count how many
  // executions were cut mid-search on the SAME batch. One cut → lean re-hunt
  // (fewer searches, concise output); three cuts → skip the batch honestly.
  // Without this, a batch whose searches always outrun the window would hand
  // off to fresh executions forever, burning paid searches every round.
  const payload = (msg.payload ?? {}) as { cuts?: unknown; cutKey?: unknown }
  const priorCutKey = typeof payload.cutKey === 'string' ? payload.cutKey : ''
  const priorCuts = Math.trunc(Number(payload.cuts ?? 0)) || 0

  const started = Date.now()
  for (const batch of batches) {
    if (done.has(batch.key)) continue

    // Fresh doc read before every paid search: a concurrent execution (retry
    // racing a backlogged message, or a redelivery racing a continuation) may
    // have finished this batch, settled the packet, or deleted it. One blob
    // read guards minutes of duplicated web-search spend and duplicate items.
    const current = await getPacketOrUndefined(packetId)
    if (!current || current.status !== 'hunting') {
      await settleJobQuietly(msg.jobId, current ? 'Packet settled by another run — stopping' : 'Packet was deleted — stopping')
      return
    }
    if (!ownsHunt(current)) {
      await settleJobQuietly(msg.jobId, 'Superseded by a newer hunt job — stopping')
      return
    }
    for (const key of current.doneBatches) done.add(key)
    if (done.has(batch.key)) continue

    // Honor a stop request at every checkpoint. Only the OWNING job may
    // cancel the packet — a superseded job's stale stop flag settles that job
    // alone (the ownership guard above already returned for that case).
    const job = await getJob(msg.jobId)
    if (job.cancelRequested === true) {
      await mutatePacket(packetId, (p) => {
        if (p.status === 'hunting' && ownsHunt(p)) p.status = 'cancelled'
        p.updated = nowIso()
      })
      await mutateJob(msg.jobId, (r) => {
        r.status = 'cancelled'
        r.stage = 'Stopped'
        pushLog(r, `Stopped by user — ${done.size} of ${batches.length} batches searched; found items are kept`)
      })
      return
    }

    if (Date.now() - started > TIME_BUDGET_MS) {
      // Log BEFORE enqueueing the continuation: if either write fails, the
      // error rethrows and the host redelivers THIS message — enqueue-first
      // could strand a continuation alongside the redelivery (two live
      // messages hunting the same packet).
      await mutateJob(msg.jobId, (r) =>
        pushLog(r, `Time budget reached — continuing in a new execution (${done.size}/${batches.length} batches done)`),
      )
      await enqueueJob({ jobId: msg.jobId, kind: 'packet', step: 'hunt', packetId })
      return
    }

    const label = `Grade ${batch.grade} · ${batch.domainName}`
    const cuts = priorCutKey === batch.key ? priorCuts : 0
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
        `packet/hunt ${packetId}: searching ${label}${lean ? ' (lean — prior execution was cut)' : ''} (${batch.standards.map((s) => s.code).join(', ')})`,
      )

      // Bound the paid call to the execution deadline; on abort, hand off to a
      // fresh execution instead of letting the host kill skip settlement.
      const controller = new AbortController()
      const abortTimer = setTimeout(
        () => controller.abort(),
        Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()),
      )
      let truncatedTwice = false
      try {
        try {
          found = await huntBatch(packet, batch, controller.signal, lean)
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
              found = await huntBatch(packet, batch, controller.signal, true)
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
          await mutateJob(msg.jobId, (r) =>
            pushLog(
              r,
              `${label}: search ran long and was cut at the execution deadline — continuing in a new execution${cuts + 1 >= 3 ? ' (final attempt used — the batch will be skipped)' : cuts + 1 >= 1 ? ' with a leaner search' : ''}`,
            ),
          )
          await enqueueJob({
            jobId: msg.jobId,
            kind: 'packet',
            step: 'hunt',
            packetId,
            payload: { cuts: cuts + 1, cutKey: batch.key },
          })
          return
        }
        throw e
      } finally {
        clearTimeout(abortTimer)
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
      r.stagesDone = Math.min(done.size, batches.length)
      pushLog(
        r,
        skippedAfterCuts
          ? `${label}: the search could not be completed (ran long, overflowed, or was declined twice) — batch skipped; its standards remain documentation gaps`
          : found.length === 0
            ? `${label}: no released items found online (documentation gap)`
            : `${label}: found ${found.length} released item${found.length === 1 ? '' : 's'} covering ${covered} standard${covered === 1 ? '' : 's'}`,
      )
    })
  }

  // All batches searched — settle (only while this job still owns the hunt).
  const settled = await mutatePacket(packetId, (p) => {
    if (p.status === 'hunting' && ownsHunt(p)) p.status = 'complete'
    p.updated = nowIso()
  })
  const coveredCodes = new Set(settled.items.map((i) => i.standardCode))
  const gaps = settled.standards.filter((s) => !coveredCodes.has(s.code)).length
  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stage = 'Complete'
    r.stagesDone = r.totalStages
    pushLog(
      r,
      `Hunt complete: ${settled.items.length} released item${settled.items.length === 1 ? '' : 's'} across ${coveredCodes.size} of ${settled.standards.length} standards` +
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

/**
 * Dedupe on source identity — a redelivered batch or overlapping search must
 * not double items. The content key cannot match two independent
 * transcriptions of the same item, so a hard per-standard cap backstops any
 * concurrent-run overlap the doneBatches re-check missed.
 */
function mergeItems(packet: EvidencePacket, found: HuntedItem[]): void {
  const keyOf = (i: HuntedItem) =>
    `${i.standardCode}|${i.sourceUrl}|${i.itemNumber}|${i.stem.slice(0, 80)}`.toLowerCase()
  const seen = new Set(packet.items.map(keyOf))
  const perStandard = new Map<string, number>()
  for (const i of packet.items) perStandard.set(i.standardCode, (perStandard.get(i.standardCode) ?? 0) + 1)
  for (const item of found) {
    const k = keyOf(item)
    if (seen.has(k)) continue
    if ((perStandard.get(item.standardCode) ?? 0) >= MAX_ITEMS_PER_STANDARD) continue
    seen.add(k)
    perStandard.set(item.standardCode, (perStandard.get(item.standardCode) ?? 0) + 1)
    packet.items.push(item)
  }
}

// ---------------------------------------------------------------------------
// The hunt call
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
    hint: 'Work these sources, in order: (1) Smarter Balanced (SBAC) official sample items — the batch prompt lists every bank item for your standards with official alignment and answer keys; the item viewer (sampleitems.smarterbalanced.org/Item/<id>) and browser (sampleitems.smarterbalanced.org/BrowseItems?Claim=MATH1&Subject=MATH&Grade=<N>) are JS apps a fetch cannot read, so transcribe their stems from the printable Smarter Balanced sample-item scoring guides (search "smarter balanced scoring guide grade N mathematics filetype:pdf") or from state renditions of the same items. (2) New York State Testing Program released questions (nysedregents.org/ei/ei-math.html — released annually 2017–2026 except 2020, with item maps and scoring keys). (3) Massachusetts MCAS released items (doe.mass.edu/mcas/release.html, 2019 onward). (4) Ohio\'s State Tests released items (education.ohio.gov and the Ohio Cambium portal — yearly released item PDFs with alignments). (5) California CAASPP materials (cde.ca.gov, caaspp.org — California administers Smarter Balanced; its practice-test scoring guides print SBAC-style items in full).',
    domains: ['nysedregents.org', 'nysed.gov', 'doe.mass.edu', 'mass.gov', 'smarterbalanced.org', 'corestandards.org', 'engageny.org', 'education.ohio.gov', 'ohio.gov', 'cambiumast.com', 'cambiumtds.com', 'cde.ca.gov', 'caaspp.org', 'caaspp-elpac.org'],
  },
  teks: {
    programs: 'STAAR (State of Texas Assessments of Academic Readiness)',
    hint: 'Texas Education Agency released STAAR tests and answer keys (tea.texas.gov released-test-questions pages: 2017–2019 and 2021–2022 as PDFs; 2023 onward the redesigned tests live on the official Cambium practice site linked from texasassessment.gov).',
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
  $defs: {
    item: {
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
    },
  },
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
10. Find up to ${MAX_ITEMS_PER_STANDARD} strong items per standard — prefer breadth (every standard covered) over depth. Work decisively: pick sources fast, transcribe, and answer — a smaller honest result beats an exhaustive search that never finishes.`

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
  const perStandard = concise ? 2 : MAX_ITEMS_PER_STANDARD
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

  return sanitizeItems(result.items ?? [], batch, packet.years)
}

/**
 * XML 1.0 forbids C0 control characters (except tab/newline/CR) — one stray
 * escaped \u000b in a transcription would permanently corrupt the packet's
 * Word export. Newlines are kept: multi-part stems legitimately use them.
 */
const cleanText = (v: unknown): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()

/** The hunt reply is unconstrained (web search) — validate structurally and drop anything off-batch or unusable. */
function sanitizeItems(raw: unknown[], batch: HuntBatch, years: number[]): HuntedItem[] {
  const codes = new Map(batch.standards.map((s) => [normCode(s.code), s.code]))
  const perStandard = new Map<string, number>()
  const out: HuntedItem[] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue
    const r = value as Record<string, unknown>
    const code = codes.get(normCode(String(r.standardCode ?? '')))
    if (!code) continue // hallucinated or off-batch standard
    const stem = cleanText(r.stem)
    const sourceUrl = cleanText(r.sourceUrl)
    if (stem.length < 10 || !/^https?:\/\//i.test(sourceUrl)) continue
    const itemType = String(r.itemType ?? '')
    const yearNum = Math.trunc(Number(r.year))
    // Policy: no tests administered before 2017 (year 0 = source did not say).
    if (Number.isFinite(yearNum) && yearNum > 0 && yearNum < 2017) continue
    // Selected years are a HARD filter (no preference): drop items outside
    // them, including items whose source states no year — an unverifiable
    // year cannot satisfy the filter.
    if (years.length > 0 && !years.includes(yearNum)) continue
    const count = perStandard.get(code) ?? 0
    if (count >= MAX_ITEMS_PER_STANDARD) continue
    perStandard.set(code, count + 1)
    out.push({
      id: newId('hunted'),
      standardCode: code,
      program: cleanText(r.program),
      year: Number.isFinite(yearNum) && yearNum > 1990 && yearNum < 2100 ? yearNum : 0,
      itemNumber: cleanText(r.itemNumber),
      itemType:
        itemType === 'constructed-response' || itemType === 'multi-part' ? itemType : 'selected-response',
      stem,
      choices: Array.isArray(r.choices)
        ? r.choices.map((c) => cleanText(c)).filter((c) => c.length > 0)
        : [],
      answer: cleanText(r.answer),
      sourceUrl,
      sourceName: cleanText(r.sourceName),
      alignment: r.alignment === 'official' ? 'official' : 'ai-inferred',
      notes: cleanText(r.notes),
    })
  }
  return out
}

const normCode = (code: string): string => code.toUpperCase().replace(/\s+/g, '')
