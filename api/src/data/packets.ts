import { odata } from '@azure/data-tables'
import { EvidencePacket, ItemRecord, PacketSummary } from '../domain/types'
import { HttpError } from '../shared/errors'
import { sleep } from '../shared/util'
import { dataContainer, entitiesTable } from './clients'
import { getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// Blob layout (contract §Storage layout):
//   packets/<packetId>.json   current EvidencePacket
const packetBlobPath = (id: string) => `packets/${id}.json`

export async function savePacket(packet: EvidencePacket): Promise<void> {
  await putJson(dataContainer(), packetBlobPath(packet.id), packet)
  await upsertPacketRow(packet)
}

async function upsertPacketRow(packet: EvidencePacket): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'packet',
      rowKey: packet.id,
      title: packet.title,
      status: packet.status,
      updated: packet.updated,
      blobPath: packetBlobPath(packet.id),
    },
    'Replace',
  )
}

/**
 * Read–modify–write with ETag optimistic concurrency — the packet twin of
 * mutateScope. The hunt worker and HTTP mutations (delete racing a checkpoint
 * write, stop requests) can touch the same blob; unconditional saves would
 * silently lose hunted items.
 */
export async function mutatePacket(id: string, fn: (packet: EvidencePacket) => void): Promise<EvidencePacket> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<EvidencePacket>(dataContainer(), packetBlobPath(id))
    if (!found) throw new HttpError(404, `evidence packet ${id} not found`)
    const packet = found.doc
    fn(packet)
    try {
      await putJsonIfMatch(dataContainer(), packetBlobPath(id), packet, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertPacketRow(packet)
    return packet
  }
  throw new Error(`evidence packet ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getPacketOrUndefined(id: string): Promise<EvidencePacket | undefined> {
  return getJsonOrUndefined<EvidencePacket>(dataContainer(), packetBlobPath(id))
}

export async function getPacket(id: string): Promise<EvidencePacket> {
  const packet = await getPacketOrUndefined(id)
  if (!packet) throw new HttpError(404, `evidence packet ${id} not found`)
  return packet
}

export async function listPackets(): Promise<EvidencePacket[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${'packet'}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => getPacketOrUndefined(id)))
  // Self-healing sweep: a checkpoint's index upsert can race a DELETE and
  // re-insert the row after the blob is gone; without cleanup the ghost row
  // costs a wasted blob probe on every list, forever.
  await Promise.all(
    ids
      .filter((_, i) => docs[i] === undefined)
      .map(async (id) => {
        try {
          await entitiesTable().deleteEntity('packet', id)
        } catch {
          /* best-effort — the next list retries */
        }
      }),
  )
  return docs.filter((d): d is EvidencePacket => d !== undefined)
}

export function toPacketSummary(packet: EvidencePacket): PacketSummary {
  const summary: PacketSummary = {
    id: packet.id,
    title: packet.title,
    framework: packet.framework,
    frameworkLabel: packet.frameworkLabel,
    grades: packet.grades,
    years: packet.years,
    status: packet.status,
    standardCount: packet.standards.length,
    itemCount: packet.items.length,
    created: packet.created,
    updated: packet.updated,
  }
  if (packet.error !== undefined) summary.error = packet.error
  return summary
}

/**
 * Hunted packet items as ItemRecords — the shape the scope pipeline's item
 * bank speaks (plan itemRefs assignment, card evidence subsets, QC coverage).
 * A scope created with request.packetId gets these merged into its evidence
 * set. Screenshot serving stays packet-scoped (screenshots container via
 * /packet-item-image or the SAS-links endpoint) — imagePath here records the
 * screenshots-container blob path, signaling "a real screenshot exists".
 */
export function packetItemRecords(packet: EvidencePacket): ItemRecord[] {
  return packet.items.map((item) => ({
    id: item.id,
    source: item.sourceName || item.sourceUrl,
    test: item.program || item.sourceName,
    year: item.year,
    itemNumber: Number.parseInt(item.itemNumber, 10) || 0,
    alignmentCode: item.standardCode,
    confidence: item.alignment === 'official' ? ('official' as const) : ('ai-proposed' as const),
    completeness: 1,
    itemType: item.itemType,
    responseFormat: item.choices.length > 0 ? 'selected response' : 'constructed response',
    representations: [],
    problemTypes: [],
    demandProfile: '',
    scopeClass: 'in-boundary' as const,
    hasKey: item.answer !== '',
    stem: item.stem,
    ...(item.choices.length > 0 ? { choices: item.choices } : {}),
    ...(item.screenshotPaths && item.screenshotPaths.length > 0 ? { imagePath: item.screenshotPaths[0] } : {}),
  }))
}

export async function deletePacketDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(packetBlobPath(id)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('packet', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}
