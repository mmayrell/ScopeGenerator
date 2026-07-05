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
import { dataContainer, uploadsContainer } from '../data/clients'
import { getSet, saveSet } from '../data/entities'
import { mutateJob, pushLog } from '../data/jobs'
import { generateStructured } from '../services/claude'
import {
  ingestConflictsPrompt,
  ingestItemsPrompt,
  ingestLexiconPrompt,
  ingestNotesPrompt,
  ingestStandardsPrompt,
} from '../services/prompts'
import {
  INGEST_CONFLICTS_SCHEMA,
  INGEST_ITEMS_SCHEMA,
  INGEST_LEXICON_SCHEMA,
  INGEST_NOTES_SCHEMA,
  INGEST_STANDARDS_SCHEMA,
  WireIngestConflicts,
  WireIngestItems,
  WireIngestLexicon,
  WireIngestNotes,
  WireIngestStandards,
  WireStandardNode,
} from '../services/schemas'
import { today } from '../shared/util'
import { cropRegion, renderPages } from './pdf-images'

// 23MB raw: base64 expands the body ~4/3x and the Claude API request cap is
// 32MB, so anything above ~24MB raw is doomed — a higher guard (the old 30MB)
// let 24–30MB PDFs burn all three queue attempts on guaranteed 4xx responses.
const MAX_PDF_BYTES = 23 * 1024 * 1024
const MAX_PDF_PAGES = 100

export const itemImageBlobPath = (setId: string, itemId: string): string =>
  `sets/${setId}/item-images/${itemId}.png`

interface UploadBlob {
  name: string
  size: number
  role: string
  fileName: string
}

async function listUploads(setId: string): Promise<UploadBlob[]> {
  const container = uploadsContainer()
  const blobs: UploadBlob[] = []
  for await (const blob of container.listBlobsFlat({ prefix: `${setId}/` })) {
    // uploads container layout: <setId>/<role>/<fileName>
    const parts = blob.name.split('/')
    blobs.push({
      name: blob.name,
      size: blob.properties.contentLength ?? 0,
      role: parts[1] ?? '',
      fileName: parts.slice(2).join('/'),
    })
  }
  return blobs
}

/**
 * Kind `ingest`, step `extract` (runs automatically once the uploads land):
 * per uploaded PDF, a Claude document call extracts standards → StandardNode
 * tree with limits; items → ItemRecord[] WITH question screenshots (page +
 * bounding box → rendered + cropped PNGs in blob storage);
 * unpacking/progression → usage-notes enrichment. A final cross-document pass
 * finds scope conflicts between the documents and consolidates coverage gaps —
 * each warning carrying the AI's suggested default resolution. The set is NOT
 * published: the user resolves the warnings, then the lexicon step runs.
 */
export async function extractRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  if (!msg.setId) throw new Error('ingest message missing setId')
  const set = await getSet(msg.setId)

  const blobs = await listUploads(msg.setId)
  if (blobs.length === 0) throw new Error(`no uploads found for set ${msg.setId}`)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = blobs.length + 1 // one per document + the conflict pass
    r.stage = 'Extraction — Standards Tree & Item Bank'
    pushLog(r, `Extracting ${blobs.length} uploaded document(s) for ${set.name}`)
  })

  // Re-runnable extraction: a re-run re-processes every upload, so extraction
  // REPLACES the extraction-derived state — items and extract-generated
  // warnings are reset (the tree is replaced in the standards branch) instead
  // of appended. Human-entered state survives: acknowledged flags carry over
  // to re-emitted warnings with matching text, confirmed alignments carry over
  // to items with the same source/test/year/itemNumber, and enrichArtifact
  // keeps the human part of artifact usage notes.
  const priorWarnings = new Map(set.warnings.map((w) => [w.text, w]))
  const confirmedItemKeys = new Set(
    set.items.filter((it) => it.confidence === 'confirmed').map((it) => itemKey(it)),
  )
  set.items = []
  set.warnings = set.warnings.filter(
    (w) => !w.id.startsWith(`${set.id}-ingw-`) && !w.id.startsWith(`${set.id}-ingfail-`),
  )

  const candidateWarnings: string[] = []
  let blocked = 0
  let stagesDone = 0

  for (const blob of blobs) {
    const artifact = findArtifact(set, blob.role, blob.fileName)

    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = stagesDone
      pushLog(r, `Extracting ${blob.fileName} (${blob.role}, ${(blob.size / 1024 / 1024).toFixed(1)} MB)`)
    })

    if (blob.size > MAX_PDF_BYTES) {
      blockArtifact(artifact, `File is ${(blob.size / 1024 / 1024).toFixed(1)} MB — exceeds the 23 MB ingestion limit (base64 encoding must fit the 32 MB API request cap). Split the document and re-upload (P10 fit validation).`)
      blocked++
      stagesDone++
      continue
    }
    const buffer = await uploadsContainer().getBlobClient(blob.name).downloadToBuffer()
    const pages = countPdfPages(buffer)
    if (pages > MAX_PDF_PAGES) {
      blockArtifact(artifact, `Document parses as ${pages} pages — exceeds the 100-page ingestion limit. Split the document and re-upload (P10 fit validation).`)
      blocked++
      stagesDone++
      continue
    }
    const base64 = buffer.toString('base64') // no newlines — Buffer.toString('base64') emits none

    if (blob.role === 'standards') {
      const out = await generateStructured<WireIngestStandards>({
        ...ingestStandardsPrompt(set, artifact),
        schema: INGEST_STANDARDS_SCHEMA,
        documents: [base64],
        effort: 'medium',
      })
      if (out.nodes.length > 0) set.tree = rebuildTree(out.nodes)
      enrichArtifact(artifact, out.usageNotes)
      candidateWarnings.push(...out.coverageWarnings)
    } else if (blob.role === 'items') {
      const out = await generateStructured<WireIngestItems>({
        ...ingestItemsPrompt(set, artifact),
        schema: INGEST_ITEMS_SCHEMA,
        documents: [base64],
        effort: 'medium',
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
        ...(it.page >= 1 ? { page: it.page } : {}),
      }))

      // Question screenshots: render only the pages items landed on, crop each
      // item's reported region (full-page fallback), store PNGs in blob storage.
      await mutateJob(msg.jobId, (r) => pushLog(r, `Capturing ${items.length} question screenshot(s) from ${blob.fileName}`))
      try {
        const pageMap = await renderPages(buffer, out.items.map((it) => it.page))
        for (let i = 0; i < items.length; i++) {
          const pagePng = pageMap.get(out.items[i].page)
          if (!pagePng) continue
          const png = await cropRegion(pagePng, out.items[i].box)
          const path = itemImageBlobPath(set.id, items[i].id)
          await dataContainer()
            .getBlockBlobClient(path)
            .uploadData(png, { blobHTTPHeaders: { blobContentType: 'image/png' } })
          items[i].imagePath = path
        }
      } catch (e) {
        // Screenshots are best-effort (P10 format tolerance): text stand-ins
        // keep the item bank usable when rendering fails.
        ctx.warn(`extract: screenshot capture failed for ${blob.fileName} — text stand-ins only`, e)
      }

      set.items.push(...items)
      if (artifact?.meta) artifact.meta.itemCount = items.length
      enrichArtifact(artifact, out.usageNotes)
      candidateWarnings.push(...out.coverageWarnings)
    } else if (blob.role === 'unpacking' || blob.role === 'progression') {
      const out = await generateStructured<WireIngestNotes>({
        ...ingestNotesPrompt(set, artifact, blob.role),
        schema: INGEST_NOTES_SCHEMA,
        documents: [base64],
        effort: 'medium',
      })
      enrichArtifact(artifact, out.usageNotes)
      candidateWarnings.push(...out.coverageWarnings)
    } else {
      ctx.warn(`extract: unknown role segment "${blob.role}" on blob ${blob.name} — skipped`)
      stagesDone++
      continue
    }
    if (artifact) artifact.reviewStatus = 'reviewed'
    stagesDone++
    // Checkpoint after each document so a mid-run failure keeps its progress.
    set.updated = today()
    await saveSet(set)
  }

  // Cross-document scope-conflict pass — consolidates candidate gaps and hunts
  // for conflicts between the documents, each with an AI-suggested resolution
  // (strict canonical Common Core always the default for CC-variant conflicts).
  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = stagesDone
    r.stage = 'Extraction — Cross-Document Conflict Check'
    pushLog(r, 'Checking the documents against each other for scope conflicts')
  })
  const conflicts = await generateStructured<WireIngestConflicts>({
    ...ingestConflictsPrompt(set, candidateWarnings),
    schema: INGEST_CONFLICTS_SCHEMA,
    effort: 'high', // the suggestions steer everything downstream — worth the depth
  })
  let warningSeq = 0
  for (const w of conflicts.warnings.slice(0, 6)) {
    const prior = priorWarnings.get(w.text)
    set.warnings.push({
      id: `${set.id}-ingw-${Date.now()}-${warningSeq++}`,
      text: w.text,
      kind: w.kind,
      suggestion: w.suggestion,
      acknowledged: prior?.acknowledged ?? false,
      ...(prior?.resolution ? { resolution: prior.resolution } : {}),
      ...(prior?.resolvedBy ? { resolvedBy: prior.resolvedBy } : {}),
    } satisfies CoverageWarning)
  }

  set.updated = today()
  await saveSet(set)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Extraction Complete'
    pushLog(
      r,
      blocked === 0
        ? `Extraction complete: tree ${set.tree.length > 0 ? 'parsed' : 'empty'}, ${set.items.length} item(s) banked, ${set.warnings.length} conflict(s)/gap(s) to resolve`
        : `Extraction finished with ${blocked} blocking artifact error(s) — resolve them and re-run`,
    )
  })
  ctx.log(`ingest/extract ${msg.jobId}: ${blobs.length} blobs, ${set.items.length} items, ${set.warnings.length} warnings, ${blocked} blocked`)
}

/**
 * Kind `ingest`, step `lexicon` (runs only after the user resolved every
 * conflict/gap): two exhaustive Claude passes over the full document corpus
 * build the representations and problem-types lexicons, every term cited to
 * its governing standard + artifact + PDF page. Publishes the set on success.
 */
export async function lexiconRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  if (!msg.setId) throw new Error('ingest message missing setId')
  const set = await getSet(msg.setId)

  const blobs = await listUploads(msg.setId)
  const documents: string[] = []
  const documentNames: string[] = []
  for (const blob of blobs) {
    if (blob.size > MAX_PDF_BYTES) continue
    const buffer = await uploadsContainer().getBlobClient(blob.name).downloadToBuffer()
    if (countPdfPages(buffer) > MAX_PDF_PAGES) continue
    documents.push(buffer.toString('base64'))
    documentNames.push(blob.fileName)
  }

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = 2
    r.stage = 'Lexicon — Representations'
    pushLog(r, `Building exhaustive lexicons from ${documents.length} document(s), steered by the recorded resolutions`)
  })

  const toTerms = (out: WireIngestLexicon): LexiconTerm[] => {
    const seen = new Set<string>()
    const terms: LexiconTerm[] = []
    for (const t of out.terms) {
      const key = t.term.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      terms.push({
        term: t.term.trim(),
        aliases: t.aliases,
        source: t.source,
        ...(t.standard.trim() ? { standard: t.standard.trim() } : {}),
        ...(t.artifact.trim() ? { artifact: t.artifact.trim() } : {}),
        ...(t.page >= 1 ? { page: t.page } : {}),
      })
    }
    return terms
  }

  const representations = await generateStructured<WireIngestLexicon>({
    ...ingestLexiconPrompt(set, 'representations'),
    schema: INGEST_LEXICON_SCHEMA,
    documents,
    effort: 'high', // exhaustiveness is the requirement
  })
  set.lexicons.representations = toTerms(representations)
  set.updated = today()
  await saveSet(set)

  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = 1
    r.stage = 'Lexicon — Problem Types'
    pushLog(r, `${set.lexicons.representations.length} representation term(s) built`)
  })

  const problemTypes = await generateStructured<WireIngestLexicon>({
    ...ingestLexiconPrompt(set, 'problemTypes'),
    schema: INGEST_LEXICON_SCHEMA,
    documents,
    effort: 'high',
  })
  set.lexicons.problemTypes = toTerms(problemTypes)

  // Publish once the lexicon lands — unless a blocking fit-validation error
  // remains (P10: blocking errors halt publish until resolved).
  const blocked = set.artifacts.filter((a) => a.reviewStatus === 'blocked').length
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
        ? `Lexicons built (${set.lexicons.representations.length} representations, ${set.lexicons.problemTypes.length} problem types); set published`
        : `Lexicons built, but ${blocked} blocking artifact error(s) hold publish until resolved`,
    )
  })
  ctx.log(`ingest/lexicon ${msg.jobId}: ${set.lexicons.representations.length}+${set.lexicons.problemTypes.length} terms from ${documentNames.length} docs, published=${set.published}`)
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
