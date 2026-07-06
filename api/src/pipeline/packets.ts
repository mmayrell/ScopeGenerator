import { InvocationContext } from '@azure/functions'
import { EvidencePacket, HuntedItem, JobMessage, PacketStandard } from '../domain/types'
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
/** Standards per hunt call — keeps each web-search turn focused and bounded. */
const BATCH_SIZE = 4
const MAX_SEARCHES_PER_BATCH = 8
const MAX_ITEMS_PER_STANDARD = 4
const HUNT_MAX_TOKENS = 24000

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

  const batches = huntBatchesOf(packet)
  const done = new Set(packet.doneBatches)
  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = batches.length
    r.stagesDone = Math.min(done.size, batches.length)
    r.stage = 'Hunting released items online'
    pushLog(r, `Web hunt: ${batches.length - done.size} of ${batches.length} search batches remaining`)
  })

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
    for (const key of current.doneBatches) done.add(key)
    if (done.has(batch.key)) continue

    // Honor a stop request at every checkpoint.
    const job = await getJob(msg.jobId)
    if (job.cancelRequested === true) {
      await mutatePacket(packetId, (p) => {
        if (p.status === 'hunting') p.status = 'cancelled'
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
    context.log(`packet/hunt ${packetId}: searching ${label} (${batch.standards.map((s) => s.code).join(', ')})`)
    const found = await huntBatch(packet, batch)

    done.add(batch.key)
    await mutatePacket(packetId, (p) => {
      mergeItems(p, found)
      if (!p.doneBatches.includes(batch.key)) p.doneBatches.push(batch.key)
      p.updated = nowIso()
    })
    const covered = new Set(found.map((i) => i.standardCode)).size
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.min(done.size, batches.length)
      pushLog(
        r,
        found.length === 0
          ? `${label}: no released items found online (documentation gap)`
          : `${label}: found ${found.length} released item${found.length === 1 ? '' : 's'} covering ${covered} standard${covered === 1 ? '' : 's'}`,
      )
    })
  }

  // All batches searched — settle.
  const settled = await mutatePacket(packetId, (p) => {
    if (p.status === 'hunting') p.status = 'complete'
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
const FRAMEWORK_HUNTS: Record<EvidencePacket['framework'], { programs: string; hint: string }> = {
  ccss: {
    programs: 'Common Core–aligned state assessments',
    hint: 'Smarter Balanced (SBAC) released and practice items, PARCC released items, New York State released test questions (EngageNY / NYSED), and Massachusetts MCAS released items (CCSS-aligned).',
  },
  teks: {
    programs: 'STAAR (State of Texas Assessments of Academic Readiness)',
    hint: 'Texas Education Agency released STAAR tests and answer keys (tea.texas.gov), including the released practice tests on the Cambium/TEA platform.',
  },
  sol: {
    programs: 'Virginia SOL (Standards of Learning) assessments',
    hint: 'Virginia Department of Education released SOL tests and practice items (doe.virginia.gov). Note: 2023 SOL codes are new — released tests from 2010–2022 are coded under the 2016 standards; map them only when the content genuinely matches the 2023 standard.',
  },
  best: {
    programs: 'Florida FAST assessments (B.E.S.T. standards)',
    hint: 'Florida Department of Education / Cambium FAST sample test materials and B.E.S.T. sample items (flfast.org, fldoe.org). B.E.S.T. is new — official sample items may be the only released evidence.',
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
1. NEVER invent, paraphrase, or reconstruct an item from memory. Report only items you actually located in a source found through your searches in this conversation. A fabricated "released item" is worse than no item.
2. If you cannot find a genuine item for a standard, list that standard in "gaps" with a short note on what you searched. Absence of released evidence is a documentation gap, not a failure — reporting a gap honestly is a correct outcome.
3. Transcribe faithfully: the exact stem wording, every answer choice in order, and the correct answer ONLY when the source publishes a key ('' otherwise). Write mathematical notation in plain text or Unicode (3/4, 2^3, ×, ÷, °).
4. Items built around a graphic (number line, figure, graph, table): if the item still works with the graphic described, include it and describe the graphic inside square brackets in the stem, noting this in "notes". If the item is meaningless without seeing the graphic, skip it — do not guess its content.
5. sourceUrl must be the real URL of the page or PDF where the item appears, taken from your search results — never constructed from memory. sourceName is that document's title.
6. alignment is "official" ONLY when the source document (or the agency's item map/blueprint) explicitly labels the item with the standard code. If YOU judged the alignment from the item's content, it is "ai-inferred".
7. year is the administration or publication year of the source (a number, e.g. 2022); use 0 only when the source genuinely does not say. itemNumber is the question's number or label in the source ('' if unknown).
8. NEVER transcribe items from tests administered before 2017. If the only findable materials for a standard predate 2017, report the standard as a gap instead.
9. Find up to ${MAX_ITEMS_PER_STANDARD} strong items per standard — prefer breadth (every standard covered) over depth.`

async function huntBatch(packet: EvidencePacket, batch: HuntBatch): Promise<HuntedItem[]> {
  const hunt = FRAMEWORK_HUNTS[packet.framework]
  const yearsLine =
    packet.years.length > 0
      ? `Prefer administrations from these years: ${packet.years.join(', ')} — an item from another year (2017 or later) still beats a gap.`
      : 'Any administration year from 2017 onward is acceptable; prefer the most recent.'
  const user = `Find released assessment items for these ${packet.frameworkLabel} standards.

Assessment program(s) to hunt: ${hunt.programs}.
Where genuine released items usually live: ${hunt.hint}
${yearsLine}

Grade ${batch.grade} — ${batch.domainName}:
${batch.standards.map((s) => `- ${s.code}: ${s.text}`).join('\n')}

Search the web for released tests, released item documents, and official sample items assessing these specific standards. Transcribe every genuine item you find (up to ${MAX_ITEMS_PER_STANDARD} per standard), and report standards with no findable released evidence as gaps.`

  const result = await generateStructured<{
    items?: unknown[]
    gaps?: { standardCode?: string; note?: string }[]
  }>({
    system: HUNT_SYSTEM,
    user,
    schema: HUNT_SCHEMA,
    maxTokens: HUNT_MAX_TOKENS,
    effort: 'medium',
    webSearch: true,
    maxSearches: MAX_SEARCHES_PER_BATCH,
  })

  return sanitizeItems(result.items ?? [], batch)
}

/** The hunt reply is unconstrained (web search) — validate structurally and drop anything off-batch or unusable. */
function sanitizeItems(raw: unknown[], batch: HuntBatch): HuntedItem[] {
  const codes = new Map(batch.standards.map((s) => [normCode(s.code), s.code]))
  const perStandard = new Map<string, number>()
  const out: HuntedItem[] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue
    const r = value as Record<string, unknown>
    const code = codes.get(normCode(String(r.standardCode ?? '')))
    if (!code) continue // hallucinated or off-batch standard
    const stem = String(r.stem ?? '').trim()
    const sourceUrl = String(r.sourceUrl ?? '').trim()
    if (stem.length < 10 || !/^https?:\/\//i.test(sourceUrl)) continue
    const itemType = String(r.itemType ?? '')
    const yearNum = Math.trunc(Number(r.year))
    // Policy: no tests administered before 2017 (year 0 = source did not say).
    if (Number.isFinite(yearNum) && yearNum > 0 && yearNum < 2017) continue
    const count = perStandard.get(code) ?? 0
    if (count >= MAX_ITEMS_PER_STANDARD) continue
    perStandard.set(code, count + 1)
    out.push({
      id: newId('hunted'),
      standardCode: code,
      program: String(r.program ?? '').trim(),
      year: Number.isFinite(yearNum) && yearNum > 1990 && yearNum < 2100 ? yearNum : 0,
      itemNumber: String(r.itemNumber ?? '').trim(),
      itemType:
        itemType === 'constructed-response' || itemType === 'multi-part' ? itemType : 'selected-response',
      stem,
      choices: Array.isArray(r.choices)
        ? r.choices.map((c) => String(c).trim()).filter((c) => c.length > 0)
        : [],
      answer: String(r.answer ?? '').trim(),
      sourceUrl,
      sourceName: String(r.sourceName ?? '').trim(),
      alignment: r.alignment === 'official' ? 'official' : 'ai-inferred',
      notes: String(r.notes ?? '').trim(),
    })
  }
  return out
}

const normCode = (code: string): string => code.toUpperCase().replace(/\s+/g, '')
