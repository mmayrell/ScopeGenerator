import { JobMessage } from '../domain/types'
import { genJobsQueue } from './clients'

/**
 * Enqueues a pipeline message on `genjobs`.
 *
 * CRITICAL: the Functions host expects BASE64-encoded queue messages by default,
 * but @azure/storage-queue's sendMessage sends the raw string as-is — so the
 * JSON payload MUST be base64-encoded here or the trigger will fail to decode it.
 */
export async function enqueueJob(msg: JobMessage): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(msg), 'utf8').toString('base64')
  await genJobsQueue().sendMessage(encoded)
}
