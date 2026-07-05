import { TableClient } from '@azure/data-tables'
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob'
import { QueueClient } from '@azure/storage-queue'

/**
 * All storage access (tables, blobs, queue) runs off the AzureWebJobsStorage
 * connection string, per the contract. Clients are created lazily so module
 * load never throws when the setting is absent (e.g. during build tooling).
 */
function connectionString(): string {
  const conn = process.env.AzureWebJobsStorage
  if (!conn) throw new Error('AzureWebJobsStorage is not configured')
  return conn
}

let _entities: TableClient | undefined
let _jobs: TableClient | undefined
let _blobService: BlobServiceClient | undefined
let _queue: QueueClient | undefined

export function entitiesTable(): TableClient {
  if (!_entities) {
    _entities = TableClient.fromConnectionString(connectionString(), 'entities', {
      allowInsecureConnection: true,
    })
  }
  return _entities
}

export function jobsTable(): TableClient {
  if (!_jobs) {
    _jobs = TableClient.fromConnectionString(connectionString(), 'jobs', {
      allowInsecureConnection: true,
    })
  }
  return _jobs
}

function blobService(): BlobServiceClient {
  if (!_blobService) _blobService = BlobServiceClient.fromConnectionString(connectionString())
  return _blobService
}

/** Container `data` — full JSON docs, version snapshots, pipeline checkpoints. */
export function dataContainer(): ContainerClient {
  return blobService().getContainerClient('data')
}

/** Container `uploads` — uploaded PDFs at `<setId>/<role>/<fileName>`. */
export function uploadsContainer(): ContainerClient {
  return blobService().getContainerClient('uploads')
}

/** Queue `genjobs` — pipeline messages. */
export function genJobsQueue(): QueueClient {
  if (!_queue) _queue = new QueueClient(connectionString(), 'genjobs')
  return _queue
}

let ensured: Promise<void> | undefined

/**
 * Idempotent, memoized creation of the storage resources. The infra script
 * provisions them, but this keeps local dev (Azurite) and fresh accounts working.
 */
export function ensureInfra(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await dataContainer().createIfNotExists()
      await uploadsContainer().createIfNotExists()
      await genJobsQueue().createIfNotExists()
      for (const table of [entitiesTable(), jobsTable()]) {
        try {
          await table.createTable()
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (status !== 409) throw e
        }
      }
    })().catch((e) => {
      ensured = undefined // allow retry on the next invocation
      throw e
    })
  }
  return ensured
}
