import { odata } from '@azure/data-tables'
import { EvidencePacket, PacketSummary } from '../domain/types'
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

export async function deletePacketDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(packetBlobPath(id)).deleteIfExists()
  try {
    await entitiesTable().deleteEntity('packet', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}
