import { odata } from '@azure/data-tables'
import { Scope, StandardSet } from '../domain/types'
import { HttpError } from '../shared/errors'
import { sleep } from '../shared/util'
import { dataContainer, entitiesTable, uploadsContainer } from './clients'
import { deleteBlobsWithPrefix, getJsonOrUndefined, getJsonWithEtag, putJson, putJsonIfMatch } from './blobs'

// Blob layout (contract §Storage layout):
//   sets/<setId>.json                current StandardSet
//   scopes/<scopeId>.json            current Scope
//   scopes/<scopeId>/v<version>.json immutable snapshot per version
const setBlobPath = (id: string) => `sets/${id}.json`
const scopeBlobPath = (id: string) => `scopes/${id}.json`
const scopeSnapshotPath = (id: string, version: number) => `scopes/${id}/v${version}.json`

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export async function saveSet(set: StandardSet): Promise<void> {
  await putJson(dataContainer(), setBlobPath(set.id), set)
  await upsertSetRow(set)
}

async function upsertSetRow(set: StandardSet): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'set',
      rowKey: set.id,
      name: set.name,
      published: set.published,
      updated: set.updated,
      blobPath: setBlobPath(set.id),
    },
    'Replace',
  )
}

/**
 * Read–modify–write for an existing set with ETag optimistic concurrency —
 * the set-document twin of mutateScope below. Needed wherever writers can
 * race on the same set blob: concurrent scope generations lazily extracting
 * the same set's released items, extraction workers, and HTTP mutations. A
 * plain saveSet on a concurrently-edited set silently loses the other
 * writer's update (in production that destroyed freshly extracted item
 * records: last writer wins).
 */
export async function mutateSet(id: string, fn: (set: StandardSet) => void): Promise<StandardSet> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<StandardSet>(dataContainer(), setBlobPath(id))
    if (!found) throw new HttpError(404, `standard set ${id} not found`)
    const set = found.doc
    fn(set)
    try {
      await putJsonIfMatch(dataContainer(), setBlobPath(id), set, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertSetRow(set)
    return set
  }
  throw new Error(`standard set ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

export async function getSetOrUndefined(id: string): Promise<StandardSet | undefined> {
  return getJsonOrUndefined<StandardSet>(dataContainer(), setBlobPath(id))
}

export async function getSet(id: string): Promise<StandardSet> {
  const set = await getSetOrUndefined(id)
  if (!set) throw new HttpError(404, `standard set ${id} not found`)
  return set
}

export async function listSets(): Promise<StandardSet[]> {
  return listDocs<StandardSet>('set', getSetOrUndefined)
}

/**
 * The evidence set for a scope. Multi-select scope requests draw on several
 * standard sets; prompts and joins treat them as one combined corpus — trees
 * concatenated as a forest, items/artifacts/warnings unioned, identity fields
 * joined. Single-set scopes return the set untouched.
 */
export async function getScopeEvidenceSet(scope: Scope): Promise<StandardSet> {
  const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  const sets = await Promise.all(ids.map((id) => getSet(id)))
  if (sets.length === 1) return sets[0]
  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))]
  return {
    ...sets[0],
    name: sets.map((s) => s.name).join(' + '),
    subject: uniq(sets.map((s) => s.subject)).join(' / '),
    gradeSpan: uniq(sets.map((s) => s.gradeSpan)).join(' + '),
    codingScheme: uniq(sets.map((s) => s.codingScheme)).join(' | '),
    codingNotes: uniq(sets.map((s) => s.codingNotes)).join(' | '),
    emphasisSource: uniq(sets.map((s) => s.emphasisSource)).join(' | '),
    hierarchyLevels: uniq(sets.flatMap((s) => s.hierarchyLevels)),
    ...(sets.some((s) => s.sourceOrganization)
      ? { sourceOrganization: uniq(sets.map((s) => s.sourceOrganization ?? '')).join(' / ') }
      : {}),
    tree: sets.flatMap((s) => s.tree),
    artifacts: sets.flatMap((s) => s.artifacts),
    warnings: sets.flatMap((s) => s.warnings),
    items: sets.flatMap((s) => s.items),
  }
}

/**
 * The INDIVIDUAL sets behind a multi-select scope, in request order — the
 * cross-framework union prompts need per-set attribution (which framework a
 * standard belongs to), which the merged evidence set erases. Returns [] for
 * single-set scopes: union semantics only exist across sets.
 */
export async function getScopeSourceSets(scope: Scope): Promise<StandardSet[]> {
  const ids = scope.setIds && scope.setIds.length > 0 ? scope.setIds : [scope.setId]
  if (ids.length < 2) return []
  return Promise.all(ids.map((id) => getSet(id)))
}

/** Removes the set document, its uploaded PDFs, its item screenshots, and its index row. Scopes generated from the set are untouched. */
export async function deleteSetDocs(id: string): Promise<void> {
  await dataContainer().getBlockBlobClient(setBlobPath(id)).deleteIfExists()
  await deleteBlobsWithPrefix(dataContainer(), `sets/${id}/`)
  await deleteBlobsWithPrefix(uploadsContainer(), `${id}/`)
  try {
    await entitiesTable().deleteEntity('set', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export async function saveScope(scope: Scope): Promise<void> {
  await putJson(dataContainer(), scopeBlobPath(scope.id), scope)
  await upsertScopeRow(scope)
}

async function upsertScopeRow(scope: Scope): Promise<void> {
  await entitiesTable().upsertEntity(
    {
      partitionKey: 'scope',
      rowKey: scope.id,
      title: scope.title,
      setId: scope.setId,
      status: scope.status,
      version: scope.version,
      updated: scope.updated,
      blobPath: scopeBlobPath(scope.id),
    },
    'Replace',
  )
}

/**
 * Read–modify–write for an existing scope with ETag optimistic concurrency:
 * parallel workers (host.json batchSize 4) and HTTP mutations race on the same
 * blob, so every mutation downloads the doc capturing its ETag, applies `fn`,
 * and uploads with If-Match on that ETag; a 412 re-reads and retries (up to 10,
 * small backoff). Unconditional last-writer-wins saves would silently lose
 * updates. The entities-table index row (title/status/version/updated) is
 * re-synced after a successful write.
 */
export async function mutateScope(id: string, fn: (scope: Scope) => void): Promise<Scope> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await getJsonWithEtag<Scope>(dataContainer(), scopeBlobPath(id))
    if (!found) throw new HttpError(404, `scope ${id} not found`)
    const scope = found.doc
    fn(scope)
    try {
      await putJsonIfMatch(dataContainer(), scopeBlobPath(id), scope, found.etag)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status !== 412) throw err
      lastError = err
      await sleep(50 + attempt * 50 + Math.floor(Math.random() * 100))
      continue
    }
    await upsertScopeRow(scope)
    return scope
  }
  throw new Error(`scope ${id}: gave up after 10 optimistic-concurrency retries: ${String(lastError)}`)
}

/** Writes the immutable `scopes/<id>/v<version>.json` snapshot for the scope's current version. */
export async function snapshotScope(scope: Scope): Promise<void> {
  await putJson(dataContainer(), scopeSnapshotPath(scope.id, scope.version), scope)
}

export async function getScopeOrUndefined(id: string): Promise<Scope | undefined> {
  return getJsonOrUndefined<Scope>(dataContainer(), scopeBlobPath(id))
}

export async function getScope(id: string): Promise<Scope> {
  const scope = await getScopeOrUndefined(id)
  if (!scope) throw new HttpError(404, `scope ${id} not found`)
  return scope
}

export async function listScopes(): Promise<Scope[]> {
  return listDocs<Scope>('scope', getScopeOrUndefined)
}

export async function deleteScopeDocs(id: string): Promise<void> {
  // User-attached released-question PDFs live under a request token, not the
  // scope id — read the doc first so its uploads never orphan. A failed-scope
  // retry recreates the scope SHARING the same token, so only delete the
  // prefix when no other scope still references it.
  const doc = await getScopeOrUndefined(id)
  const token = doc?.request?.uploadsToken
  if (token && /^[A-Za-z0-9-]{8,64}$/.test(token)) {
    const others = (await listScopes()).some((s) => s.id !== id && s.request?.uploadsToken === token)
    if (!others) await deleteBlobsWithPrefix(uploadsContainer(), `scope-uploads/${token}/`)
  }
  await dataContainer().getBlockBlobClient(scopeBlobPath(id)).deleteIfExists()
  await deleteBlobsWithPrefix(dataContainer(), `scopes/${id}/`)
  try {
    await entitiesTable().deleteEntity('scope', id)
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) throw e
  }
}

export async function entitiesTableHasRows(): Promise<boolean> {
  const iterator = entitiesTable().listEntities()[Symbol.asyncIterator]()
  const first = await iterator.next()
  return !first.done
}

// ---------------------------------------------------------------------------

async function listDocs<T>(
  partition: 'set' | 'scope',
  fetch: (id: string) => Promise<T | undefined>,
): Promise<T[]> {
  const ids: string[] = []
  const filter = odata`PartitionKey eq ${partition}`
  for await (const entity of entitiesTable().listEntities({ queryOptions: { filter } })) {
    if (entity.rowKey) ids.push(String(entity.rowKey))
  }
  const docs = await Promise.all(ids.map((id) => fetch(id)))
  return docs.filter((d): d is Awaited<T> => d !== undefined)
}
