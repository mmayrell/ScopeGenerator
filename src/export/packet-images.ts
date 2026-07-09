// Captured-screenshot fetching shared by the packet exports (Word download and
// the Reference Library PDF filing). Failures simply leave items on their text
// facsimiles — an export never fails over an image.
import { api } from '../api'
import type { EvidencePacket } from '../types'

/** A fetched screenshot ready to embed: PNG bytes plus intrinsic pixel size. */
export interface ShotImage {
  data: Uint8Array
  width: number
  height: number
}

/** PNG intrinsic size from the IHDR chunk (bytes 16–24, big-endian). */
function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Fetches the captured screenshots of a packet's items, a few at a time. */
export async function fetchShotImages(packet: EvidencePacket): Promise<Map<string, ShotImage>> {
  const withShots = packet.items.filter((i) => (i.screenshotPaths?.length ?? 0) > 0)
  const images = new Map<string, ShotImage>()
  const BATCH = 8
  for (let i = 0; i < withShots.length; i += BATCH) {
    await Promise.all(
      withShots.slice(i, i + BATCH).map(async (item) => {
        try {
          const res = await fetch(api.packetItemImageUrl(packet.id, item.id, 1))
          if (!res.ok) return
          const data = new Uint8Array(await res.arrayBuffer())
          const size = pngSize(data)
          if (size) images.set(item.id, { data, ...size })
        } catch {
          /* text facsimile fallback */
        }
      }),
    )
  }
  return images
}
