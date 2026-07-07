import { InvocationContext } from '@azure/functions'
import { Scope } from '../domain/types'
import { uploadsContainer } from '../data/clients'

/**
 * User-attached released-question PDFs for a scope request (topic mode).
 * Uploaded to `uploads/scope-uploads/<token>/<fileName>` BEFORE the scope is
 * created; the token lives on scope.request.uploadsToken. The pipeline
 * attaches the PDFs to generation calls as native document blocks — no
 * extraction pass, the model reads them directly.
 */

export const SCOPE_UPLOADS_PREFIX = 'scope-uploads/'
/** Client-minted token (crypto.randomUUID or similar) — path-safe by construction. */
export const SCOPE_UPLOADS_TOKEN = /^[A-Za-z0-9-]{8,64}$/

/**
 * Keep the attached documents comfortably inside the API's request budget:
 * base64 inflates ~4/3, and the cards stage attaches them per unit batch.
 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

export interface ScopeUploadDocs {
  /** File names actually attached (order matches base64). */
  names: string[]
  /** Base64-encoded PDF bytes for generateStructured's `documents`. */
  base64: string[]
}

export async function loadScopeUploadDocs(scope: Scope, context: InvocationContext): Promise<ScopeUploadDocs> {
  const token = scope.request.uploadsToken
  if (!token || !SCOPE_UPLOADS_TOKEN.test(token)) return { names: [], base64: [] }
  const container = uploadsContainer()
  const names: string[] = []
  const base64: string[] = []
  let total = 0
  for await (const blob of container.listBlobsFlat({ prefix: `${SCOPE_UPLOADS_PREFIX}${token}/` })) {
    const size = blob.properties.contentLength ?? 0
    if (total + size > MAX_TOTAL_BYTES) {
      context.warn(`scope ${scope.id}: skipping uploaded PDF ${blob.name} — attached documents already at the ${MAX_TOTAL_BYTES / 1024 / 1024} MB budget`)
      continue
    }
    const buf = await container.getBlockBlobClient(blob.name).downloadToBuffer()
    names.push(blob.name.slice(blob.name.lastIndexOf('/') + 1))
    base64.push(buf.toString('base64'))
    total += size
  }
  if (scope.request.uploadNames?.length && names.length === 0) {
    context.warn(`scope ${scope.id}: request names uploaded released questions (${scope.request.uploadNames.join(', ')}) but no blobs exist under its token`)
  }
  return { names, base64 }
}
