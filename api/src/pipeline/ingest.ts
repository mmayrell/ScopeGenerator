import { InvocationContext } from '@azure/functions'
import {
  Artifact,
  CoverageWarning,
  ItemRecord,
  JobMessage,
  LexiconTerm,
  StandardNode,
  StandardSet,
} from '../domain/types'
import { uploadsContainer } from '../data/clients'
import { getSet, saveSet } from '../data/entities'
import { mutateJob, pushLog } from '../data/jobs'
import { generateStructured } from '../services/claude'
import { ingestItemsPrompt, ingestNotesPrompt, ingestStandardsPrompt } from '../services/prompts'
import {
  INGEST_ITEMS_SCHEMA,
  INGEST_NOTES_SCHEMA,
  INGEST_STANDARDS_SCHEMA,
  WireIngestItems,
  WireIngestNotes,
  WireIngestStandards,
  WireStandardNode,
} from '../services/schemas'
import { today } from '../shared/util'

// 23MB raw: base64 expands the body ~4/3x and the Claude API request cap is
// 32MB, so anything above ~24MB raw is doomed — a higher guard (the old 30MB)
// let 24–30MB PDFs burn all three queue attempts on guaranteed 4xx responses.
const MAX_PDF_BYTES = 23 * 1024 * 1024
const MAX_PDF_PAGES = 100

/**
 * Kind `ingest` (Stage 1, contract §Other kinds): for each uploaded PDF under
 * uploads/<setId>/, a Claude document call (base64 PDF content block) extracts
 * standards → StandardNode tree with limits + lexicon seeds; items →
 * ItemRecord[] (text stand-in stems, ai-proposed alignments);
 * unpacking/progression → usage-notes enrichment. Merges into the set doc,
 * adds coverage warnings, then publishes.
 */
export async function ingestRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  if (!msg.setId) throw new Error('ingest message missing setId')
  const set = await getSet(msg.setId)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.stage = 'Stage 1 — Ingestion'
    pushLog(r, `Ingesting uploads for ${set.name}`)
  })

  const container = uploadsContainer()
  const blobs: { name: string; size: number }[] = []
  for await (const blob of container.listBlobsFlat({ prefix: `${msg.setId}/` })) {
    blobs.push({ name: blob.name, size: blob.properties.contentLength ?? 0 })
  }
  if (blobs.length === 0) throw new Error(`no uploads found for set ${msg.setId}`)

  // Re-runnable ingestion: a re-publish (e.g. after resolving a blocked
  // artifact) re-processes every upload, so extraction REPLACES the
  // extraction-derived state — items, lexicons and ingest-generated warnings
  // are reset here (the tree is replaced in the standards branch) instead of
  // appended, or a second run would duplicate the whole item bank. Human-entered
  // state is preserved: acknowledged flags carry over to re-emitted warnings
  // with matching text, confirmed alignments carry over to items with the same
  // source/test/year/itemNumber, and enrichArtifact keeps the human part of
  // artifact usage notes.
  const acknowledgedTexts = new Set(set.warnings.filter((w) => w.acknowledged).map((w) => w.text))
  const confirmedItemKeys = new Set(
    set.items.filter((it) => it.confidence === 'confirmed').map((it) => itemKey(it)),
  )
  set.items = []
  set.lexicons = { representations: [], problemTypes: [] }
  set.warnings = set.warnings.filter(
    (w) => !w.id.startsWith(`${set.id}-ingw-`) && !w.id.startsWith(`${set.id}-ingfail-`),
  )

  let warningSeq = 0
  const addWarnings = (texts: string[]) => {
    for (const text of texts) {
      set.warnings.push({
        id: `${set.id}-ingw-${Date.now()}-${warningSeq++}`,
        text,
        acknowledged: acknowledgedTexts.has(text),
      } satisfies CoverageWarning)
    }
  }

  let blocked = 0
  for (const blob of blobs) {
    // uploads container layout: <setId>/<role>/<fileName>
    const parts = blob.name.split('/')
    const role = parts[1] ?? ''
    const fileName = parts.slice(2).join('/')
    const artifact = findArtifact(set, role, fileName)

    await mutateJob(msg.jobId, (r) => pushLog(r, `Ingesting ${fileName} (${role}, ${(blob.size / 1024 / 1024).toFixed(1)} MB)`))

    if (blob.size > MAX_PDF_BYTES) {
      blockArtifact(artifact, `File is ${(blob.size / 1024 / 1024).toFixed(1)} MB — exceeds the 23 MB ingestion limit (base64 encoding must fit the 32 MB API request cap). Split the document and re-upload (P10 fit validation).`)
      blocked++
      continue
    }
    const buffer = await container.getBlobClient(blob.name).downloadToBuffer()
    const pages = countPdfPages(buffer)
    if (pages > MAX_PDF_PAGES) {
      blockArtifact(artifact, `Document parses as ${pages} pages — exceeds the 100-page ingestion limit. Split the document and re-upload (P10 fit validation).`)
      blocked++
      continue
    }
    const base64 = buffer.toString('base64') // no newlines — Buffer.toString('base64') emits none

    if (role === 'standards') {
      const out = await generateStructured<WireIngestStandards>({
        ...ingestStandardsPrompt(set, artifact),
        schema: INGEST_STANDARDS_SCHEMA,
        documents: [base64],
        effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      })
      if (out.nodes.length > 0) set.tree = rebuildTree(out.nodes)
      mergeLexicon(set.lexicons.representations, out.representations)
      mergeLexicon(set.lexicons.problemTypes, out.problemTypes)
      enrichArtifact(artifact, out.usageNotes)
      addWarnings(out.coverageWarnings)
    } else if (role === 'items') {
      const out = await generateStructured<WireIngestItems>({
        ...ingestItemsPrompt(set, artifact),
        schema: INGEST_ITEMS_SCHEMA,
        documents: [base64],
        effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      })
      const startIndex = set.items.length
      const items: ItemRecord[] = out.items.map((it, i) => ({
        id: `it-${set.id}-${startIndex + i + 1}`,
        source: it.source,
        test: it.test,
        year: it.year,
        itemNumber: it.itemNumber,
        alignmentCode: it.alignmentCode,
        // A human-confirmed alignment survives re-ingestion of the same item.
        confidence: confirmedItemKeys.has(itemKey(it)) ? 'confirmed' : it.confidence,
        completeness: it.completeness,
        itemType: it.itemType,
        responseFormat: it.responseFormat,
        representations: it.representations,
        problemTypes: it.problemTypes,
        demandProfile: it.demandProfile,
        scopeClass: it.scopeClass,
        hasKey: it.hasKey,
        stem: it.stem,
        ...(it.choices.length > 0 ? { choices: it.choices } : {}),
      }))
      set.items.push(...items)
      // Replace, not accumulate — the item bank was reset for this run.
      if (artifact?.meta) artifact.meta.itemCount = items.length
      enrichArtifact(artifact, out.usageNotes)
      addWarnings(out.coverageWarnings)
    } else if (role === 'unpacking' || role === 'progression') {
      const out = await generateStructured<WireIngestNotes>({
        ...ingestNotesPrompt(set, artifact, role),
        schema: INGEST_NOTES_SCHEMA,
        documents: [base64],
        effort: 'medium', // interactive latency; fits the 10-min Consumption cap
      })
      enrichArtifact(artifact, out.usageNotes)
      addWarnings(out.coverageWarnings)
    } else {
      ctx.warn(`ingest: unknown role segment "${role}" on blob ${blob.name} — skipped`)
      continue
    }
    if (artifact) artifact.reviewStatus = 'reviewed'
  }

  // Publish once ingestion lands — unless a blocking fit-validation error
  // remains (P10: blocking errors halt publish until resolved).
  if (blocked === 0) set.published = true
  set.updated = today()
  await saveSet(set)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(
      r,
      blocked === 0
        ? `Ingestion complete: ${blobs.length} document(s) processed; set published`
        : `Ingestion finished with ${blocked} blocking artifact error(s); publish is held until they are resolved`,
    )
  })
  ctx.log(`ingest/run ${msg.jobId}: ${blobs.length} blobs, ${blocked} blocked, published=${set.published}`)
}

function findArtifact(set: StandardSet, role: string, fileName: string): Artifact | undefined {
  // Upload slots use the store's slot names; 'unpacking' maps to the
  // 'unpacking-structured' artifact role (mirrors src/store.tsx createSet).
  const roles: Record<string, Artifact['role'][]> = {
    standards: ['standards'],
    items: ['items'],
    unpacking: ['unpacking-structured', 'unpacking-narrative'],
    progression: ['progression'],
  }
  const wanted = roles[role] ?? []
  return (
    set.artifacts.find((a) => a.fileName === fileName && wanted.includes(a.role)) ??
    set.artifacts.find((a) => a.fileName === fileName)
  )
}

/** Natural key that identifies the same released item across ingestion runs. */
function itemKey(it: { source: string; test: string; year: number; itemNumber: number }): string {
  return `${it.source}|${it.test}|${it.year}|${it.itemNumber}`
}

function blockArtifact(artifact: Artifact | undefined, error: string): void {
  if (!artifact) return
  artifact.reviewStatus = 'blocked'
  artifact.blockingError = error
}

function enrichArtifact(artifact: Artifact | undefined, usageNotes: string): void {
  if (!artifact) return
  // Re-runnable: any prior ingestion-notes section (marked 'Ingestion notes: ')
  // is replaced instead of appended; the human-entered part before it survives.
  let human = artifact.usageNotes
  const markerIdx = human.indexOf('Ingestion notes: ')
  if (markerIdx >= 0) human = human.slice(0, markerIdx).trimEnd()
  const trimmed = usageNotes.trim()
  if (trimmed.length === 0) {
    artifact.usageNotes = human
    return
  }
  artifact.usageNotes = human ? `${human}\n\nIngestion notes: ${trimmed}` : `Ingestion notes: ${trimmed}`
}

/** Rebuilds the recursive StandardNode tree from the schema's flat parentCode list. */
export function rebuildTree(nodes: WireStandardNode[]): StandardNode[] {
  const byCode = new Map<string, StandardNode>()
  for (const n of nodes) {
    byCode.set(n.code, {
      code: n.code,
      norm: n.norm,
      ...(n.label.trim().length > 0 ? { label: n.label } : {}),
      ...(n.wording.trim().length > 0 ? { wording: n.wording } : {}),
      ...(n.limits.length > 0 ? { limits: n.limits } : {}),
      ...(n.fluency ? { fluency: true } : {}),
      emphasis: n.emphasis,
    })
  }
  const roots: StandardNode[] = []
  for (const n of nodes) {
    const node = byCode.get(n.code)
    if (!node) continue
    const parent = n.parentCode ? byCode.get(n.parentCode) : undefined
    if (parent && parent !== node) {
      parent.children = parent.children ?? []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function mergeLexicon(existing: LexiconTerm[], incoming: { term: string; aliases: string[]; source: string }[]): void {
  const known = new Set(existing.map((t) => t.term.toLowerCase()))
  for (const term of incoming) {
    if (term.term.trim().length === 0 || known.has(term.term.toLowerCase())) continue
    known.add(term.term.toLowerCase())
    existing.push({ term: term.term, aliases: term.aliases, source: term.source })
  }
}

/**
 * Cheap page-count HEURISTIC (no real PDF parser): literal '/Type /Page' tokens
 * miss PDFs whose page objects live in compressed object streams (they would
 * count 0), so every literal '/Count N' (page-tree node totals) is also parsed
 * and the estimate is the maximum of the two signals.
 */
export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1')
  const pageTokens = text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0
  let maxCount = 0
  const countRe = /\/Count\s+(\d+)/g
  let m: RegExpExecArray | null
  while ((m = countRe.exec(text)) !== null) {
    maxCount = Math.max(maxCount, Number(m[1]))
  }
  return Math.max(pageTokens, maxCount)
}
