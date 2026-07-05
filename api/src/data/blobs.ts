import { ContainerClient } from '@azure/storage-blob'

export async function putJson(container: ContainerClient, path: string, doc: unknown): Promise<void> {
  const body = JSON.stringify(doc)
  await container.getBlockBlobClient(path).upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  })
}

export async function getJsonOrUndefined<T>(
  container: ContainerClient,
  path: string,
): Promise<T | undefined> {
  const blob = container.getBlockBlobClient(path)
  if (!(await blob.exists())) return undefined
  const buf = await blob.downloadToBuffer()
  return JSON.parse(buf.toString('utf8')) as T
}

/**
 * Downloads a JSON blob together with its ETag, for optimistic-concurrency
 * read–modify–write cycles (see entities.mutateScope). The ETag is fetched
 * BEFORE the content: if a writer lands between the two calls, the stale ETag
 * makes the subsequent If-Match upload fail with 412 and the caller retries —
 * a lost update is impossible.
 */
export async function getJsonWithEtag<T>(
  container: ContainerClient,
  path: string,
): Promise<{ doc: T; etag: string } | undefined> {
  const blob = container.getBlockBlobClient(path)
  try {
    const props = await blob.getProperties()
    const buf = await blob.downloadToBuffer()
    return { doc: JSON.parse(buf.toString('utf8')) as T, etag: props.etag ?? '*' }
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) return undefined
    throw e
  }
}

/** Uploads JSON conditionally on the blob's ETag — throws a 412 RestError when it changed. */
export async function putJsonIfMatch(
  container: ContainerClient,
  path: string,
  doc: unknown,
  etag: string,
): Promise<void> {
  const body = JSON.stringify(doc)
  await container.getBlockBlobClient(path).upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions: { ifMatch: etag },
  })
}

export async function deleteBlobsWithPrefix(container: ContainerClient, prefix: string): Promise<void> {
  for await (const blob of container.listBlobsFlat({ prefix })) {
    await container.getBlockBlobClient(blob.name).deleteIfExists()
  }
}
