import { InvocationContext } from '@azure/functions'
import {
  JobMessage,
  Lesson,
  QcCardConfidence,
  QcFinding,
  QcGateResult,
  QcInvestigation,
  QcLocation,
  QcRun,
  Scope,
  StandardNode,
  StandardSet,
  Unit,
} from '../domain/types'
import { getScope, getScopeEvidenceSet } from '../data/entities'
import { getFramework } from '../data/framework'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { enqueueJob } from '../data/queue'
import { deleteQcDocs, getFlagLedger, getInvestigationLog, getQcRunOrUndefined, mutateFlagLedger, mutateInvestigationLog, saveQcRun } from '../data/qc'
import { generateStructured } from '../services/claude'
import { allDoctrineChapterTexts } from '../services/doctrine'
import { sectionText, textbookIndex } from '../services/textbook'
import { qcGate2Prompt, qcGate3Prompt, qcInvestigationPrompt } from '../services/prompts'
import { QC_FINDINGS_SCHEMA, QC_INVESTIGATION_SCHEMA, WireQcFindings, WireQcInvestigation } from '../services/schemas'
import { ENGINE_VERSION, nowIso, QC_STACK_VERSION } from '../shared/util'

// Quality Control & Loop Engineering (kind 'qc') — the four ordered gates
// (step 'run', auto-dispatched after every generation and on demand) and the
// investigation loop (step 'investigate', aimed by the user's flags). The
// standing constraint: EVERYTHING here is read-only against the scope —
// findings, confidences, and repair proposals attach to the QC surfaces;
// scope documents are never modified. Existing scopes keep the versions they
// were generated under.

const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000
/** Launch no further Claude call past this point — checkpoint and re-enqueue instead. */
const QC_TIME_BUDGET_MS = 4.5 * 60 * 1000
/** Full lesson cards shown to the AI gates — stratified across units. */
const SAMPLE_LESSONS = 10
const QC_MAX_TOKENS = 32000

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Stratified sample, round-robin across units (ported from the retired
 * evaluation pipeline): every unit contributes one lesson before any
 * contributes a second; within a unit picks spread first → last → interior.
 */
export function sampleLessons(units: Unit[], max: number): { lessons: Lesson[]; unitsCovered: number } {
  const all = units.flatMap((u) => u.lessons)
  if (all.length <= max) return { lessons: all, unitsCovered: units.length }
  const strategicOrder = (len: number): number[] => {
    const preferred = [0, len - 1, Math.floor(len / 2), Math.floor(len / 4), Math.floor((3 * len) / 4)]
    const seen = new Set<number>()
    const out: number[] = []
    for (const i of preferred) {
      if (i >= 0 && i < len && !seen.has(i)) {
        seen.add(i)
        out.push(i)
      }
    }
    for (let i = 0; i < len && out.length < len; i++) {
      if (!seen.has(i)) {
        seen.add(i)
        out.push(i)
      }
    }
    return out
  }
  const queues = units.map((u) => strategicOrder(u.lessons.length).map((i) => u.lessons[i]))
  const picked: Lesson[] = []
  const covered = new Set<number>()
  for (let pass = 0; picked.length < max; pass++) {
    let took = false
    for (let ui = 0; ui < queues.length && picked.length < max; ui++) {
      const lesson = queues[ui][pass]
      if (lesson) {
        picked.push(lesson)
        covered.add(ui)
        took = true
      }
    }
    if (!took) break
  }
  return { lessons: picked, unitsCovered: covered.size }
}

// Canonical + normalized code shapes: CCSS "4.OA.A.1"/"K.CC.1", TEKS
// canonical "6.3(C)" and normalized "6.3C", hyphenated HS "HSA-SSE.A.1".
// (No trailing \b — a code may legitimately end in ")".)
const CODE_RE = /\b(?:\d+|[Kk]|HS[A-Za-z]{1,3}(?:-[A-Za-z]{1,4})?)(?:\.[A-Za-z0-9]+|\([A-Za-z0-9]+\))+/g
const LESSON_REF_RE = /\bU\d+\.L\d+\b/g

/** Comparison key: uppercase, parens stripped — "6.3(C)" and "6.3C" are the same code. */
const codeKey = (c: string): string => c.toUpperCase().replace(/[()]/g, '')

const codesIn = (text: string): string[] => (text.match(CODE_RE) ?? []).map(codeKey)

/** Quote characters are STRIPPED (not converted): a quote-wrapped verbatim excerpt must locate against unwrapped source text. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** An excerpt is a verbatim-quote CLAIM only when it is actually quote-wrapped — descriptive commentary excerpts are not checked for fidelity. */
const isQuoteWrapped = (excerpt: string): boolean => /^["“‘']/.test(excerpt.trim())

/**
 * Attribute-shaped excerpts ('"emphasis": "not designated"',
 * '"emphasisSource": "not declared" …', '"fluency": true') quote the evidence
 * corpus's METADATA in JSON-ish form, not source prose — their serialization
 * varies per card, so fidelity skips them rather than blocking on spelling
 * (both live false-blocking incidents on the first production runs were this
 * class). Genuine standards prose never opens with a key:value pair.
 */
const isAttributeQuote = (excerpt: string): boolean => /^\s*["“‘']?[A-Za-z_][A-Za-z0-9_]{0,40}["”’']?\s*:/.test(excerpt.trim())

/** Longest ellipsis-free segment of a quoted excerpt — the searchable core. */
const quoteCore = (excerpt: string): string => {
  const parts = excerpt
    .split(/(?:\.\.\.|…|\[\.\.\.?\]|\[…\])/)
    .map((p) => norm(p))
    .filter((p) => p.length > 0)
  return parts.sort((a, b) => b.length - a.length)[0] ?? ''
}

interface FindingDraft {
  checkFamily: string
  ruleTag: string
  location: QcLocation
  summary: string
  evidence: string
  severity: QcFinding['severity']
  repairContract: string
}

const finalizeFindings = (drafts: FindingDraft[], source: QcFinding['source'], gate: 1 | 2 | 3 | 4, startAt: number): QcFinding[] =>
  drafts.map((d, i) => ({ id: `find-${startAt + i}`, source, gate, ...d }))

// ---------------------------------------------------------------------------
// Gate 1 — Structural Validation: deterministic code, zero tolerance, no
// judgment. A structural finding cannot be argued with — only fixed.
// ---------------------------------------------------------------------------

/** Fields every era of card carries; empty content is a defect, not a style. */
const CORE_FIELDS = [
  'standards',
  'cluster',
  'emphasis',
  'progression',
  'prerequisites',
  'boundary',
  'newLearning',
  'approach',
  'nonGoals',
  'ceiling',
  'assessment',
  'releasedItems',
] as const

const leafNodes = (nodes: StandardNode[], out: StandardNode[] = []): StandardNode[] => {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) leafNodes(n.children, out)
    else out.push(n)
  }
  return out
}

export function gate1Findings(scope: Scope, set: StandardSet): { findings: FindingDraft[]; detail: string } {
  const findings: FindingDraft[] = []
  const lessons = scope.units.flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })))
  const orderIndex = new Map<string, number>(lessons.map((x, i) => [x.lesson.id, i]))
  // Era detection is PER LESSON: a rerun regenerates individual lessons under
  // the current contract while its untouched siblings keep their birth era —
  // only lessons that demonstrably carry the new contract (student-friendly
  // title present) are held to it as majors; the rest record advisories.
  const lessonEra = (l: Lesson): boolean => l.studentFriendlyTitle !== undefined

  // -- Schema completeness ---------------------------------------------------
  for (const { unit, lesson } of lessons) {
    const at = (field: string): QcLocation => ({ unitId: unit.id, lessonId: lesson.id, field })
    for (const f of CORE_FIELDS) {
      if (lesson.fields[f].content.trim().length === 0) {
        findings.push({
          checkFamily: 'Schema completeness',
          ruleTag: 'G1.schema',
          location: at(f),
          summary: `Field "${f}" is empty.`,
          evidence: `${lesson.id} "${lesson.title}": fields.${f}.content is blank.`,
          severity: 'blocking',
          repairContract: `Regenerate the field; verification: non-empty ${f} content passing Gate 1.`,
        })
      }
      if ((lesson.fields[f].rationale ?? '').trim().length === 0) {
        findings.push({
          checkFamily: 'Schema completeness',
          ruleTag: 'G1.schema',
          location: at(f),
          summary: `Field "${f}" has no Decision Record beneath it.`,
          evidence: `${lesson.id}: fields.${f}.rationale is ${lesson.fields[f].rationale === undefined ? 'absent' : 'blank'}.`,
          severity: lessonEra(lesson) ? 'major' : 'advisory',
          repairContract: 'Regenerate the field with its per-field rationale; verification: rationale present.',
        })
      }
    }
    for (const [name, present] of [
      ['substandard', lesson.fields.substandard?.content],
      ['objectives', lesson.fields.objectives?.content],
      ['studentFriendlyTitle', lesson.studentFriendlyTitle],
      ['sequencingRationale (card-level unit-ordering entry)', lesson.sequencingRationale],
      ['granularityRationale (card-level granularity entry)', lesson.granularityRationale],
    ] as const) {
      if ((present ?? '').trim().length === 0) {
        findings.push({
          checkFamily: 'Schema completeness',
          ruleTag: 'G1.schema',
          location: { unitId: unit.id, lessonId: lesson.id },
          summary: `Card entry "${name}" is missing.`,
          evidence: `${lesson.id} "${lesson.title}" was generated ${lessonEra(lesson) ? 'under the current contract but lacks it' : 'before this entry existed'}.`,
          severity: lessonEra(lesson) ? 'major' : 'advisory',
          repairContract: 'Regenerate the card under the current contract; verification: the entry present and non-empty.',
        })
      }
    }
  }

  // -- Coverage census (zero tolerance: a dropped sub-part fails the run) ----
  // The full-grade census runs for COURSE requests only — a standard/topic
  // scope's universe is its request, not the grade, and holding a
  // single-standard scope to the whole grade would quarantine every one.
  const lessonCodes = new Map<string, string[]>()
  for (const { lesson } of lessons) {
    lessonCodes.set(lesson.id, [
      ...codesIn(lesson.fields.standards.content),
      ...codesIn(lesson.fields.substandard?.content ?? ''),
    ])
  }
  const allScopeCodes = new Set([...lessonCodes.values()].flat())
  const gradesInScope = new Set([...allScopeCodes].map((c) => c.split('.')[0]))
  const censusRuns = scope.request.mode === 'course'
  if (censusRuns) {
    const leaves = leafNodes(set.tree).filter((n) => {
      const code = codeKey(n.code || n.norm || '')
      return gradesInScope.has(code.split('.')[0])
    })
    // Exact-or-deeper citation covers the leaf. A lesson citing only a strict
    // ANCESTOR (the parent cluster/domain) is not a drop — the content may
    // genuinely live there — but it is not the census's most-granular mapping
    // either: advisory. No citation anywhere: blocking, never a warning.
    const exactOrDeeper = (c: string, leafCode: string): boolean => c === leafCode || c.startsWith(`${leafCode}.`)
    const ancestorOnly = (c: string, leafCode: string): boolean => leafCode.startsWith(`${c}.`)
    for (const leaf of leaves) {
      const keys = [codeKey(leaf.code ?? ''), codeKey(leaf.norm ?? '')].filter((k) => k.length > 0)
      const exact = [...allScopeCodes].some((c) => keys.some((k) => exactOrDeeper(c, k)))
      if (exact) continue
      const viaAncestor = [...allScopeCodes].some((c) => keys.some((k) => ancestorOnly(c, k)))
      findings.push({
        checkFamily: 'Coverage census',
        ruleTag: 'P11',
        location: {},
        summary: viaAncestor
          ? `Most-granular standard ${leaf.code} is covered only at ancestor grain.`
          : `Most-granular standard ${leaf.code} maps to no lesson.`,
        evidence: `"${leaf.code}${leaf.wording ? `: ${leaf.wording.slice(0, 140)}` : ''}" appears in the standard set's tree for a grade this scope covers (${[...gradesInScope].join(', ')}) but ${
          viaAncestor
            ? 'no lesson cites the sub-part itself — only a parent cluster/domain code'
            : "in no lesson's standards/substandard field"
        }.`,
        severity: viaAncestor ? 'advisory' : 'blocking',
        repairContract: 'Extend the plan to cover the sub-part (new lesson or explicit in-lesson coverage); verification: the code resolves to a lesson at most-granular grain.',
      })
    }
  }
  for (const { unit, lesson } of lessons) {
    if ((lessonCodes.get(lesson.id) ?? []).length === 0) {
      findings.push({
        checkFamily: 'Coverage census',
        ruleTag: 'P11',
        location: { unitId: unit.id, lessonId: lesson.id, field: 'standards' },
        summary: 'Lesson traces to no recognizable standard code.',
        evidence: `${lesson.id} "${lesson.title}": no framework-shaped code found in the standards/substandard fields.`,
        severity: 'blocking',
        repairContract: 'Regenerate the standards field with the genuine framework code; verification: a code that resolves in the tree.',
      })
    }
  }

  // -- Graph integrity --------------------------------------------------------
  const prereqEdges = new Map<string, string[]>()
  for (const { unit, lesson } of lessons) {
    const refs = [...new Set(lesson.fields.prerequisites.content.match(LESSON_REF_RE) ?? [])]
    prereqEdges.set(
      lesson.id,
      refs.filter((r) => r !== lesson.id),
    )
    for (const ref of refs) {
      if (ref === lesson.id) continue
      if (!orderIndex.has(ref)) {
        findings.push({
          checkFamily: 'Graph integrity',
          ruleTag: 'P12',
          location: { unitId: unit.id, lessonId: lesson.id, field: 'prerequisites' },
          summary: `Prerequisite reference ${ref} resolves to no lesson.`,
          evidence: `${lesson.id} names ${ref} as taught-in-course; no such lesson exists in the scope.`,
          severity: 'major',
          repairContract: 'Repair the reference (or retag as prior-grade); verification: every taught-in-course reference resolves.',
        })
      } else if ((orderIndex.get(ref) ?? 0) >= (orderIndex.get(lesson.id) ?? 0)) {
        findings.push({
          checkFamily: 'Graph integrity',
          ruleTag: 'P12',
          location: { unitId: unit.id, lessonId: lesson.id, field: 'prerequisites' },
          summary: `Taught-in-course prerequisite ${ref} does not precede the lesson.`,
          evidence: `${lesson.id} (position ${orderIndex.get(lesson.id)! + 1}) requires ${ref} (position ${orderIndex.get(ref)! + 1}) — interleaving never violates a dependency.`,
          severity: 'blocking',
          repairContract: 'Resequence so every consumed skill precedes its consumer; verification: prerequisite order check passes.',
        })
      }
    }
  }
  // Cycle detection over resolvable edges.
  const visiting = new Set<string>()
  const done = new Set<string>()
  let cycleReported = false
  const dfs = (id: string, path: string[]): void => {
    if (cycleReported || done.has(id)) return
    if (visiting.has(id)) {
      cycleReported = true
      findings.push({
        checkFamily: 'Graph integrity',
        ruleTag: 'P12',
        location: { lessonId: id },
        summary: 'The prerequisite graph contains a cycle.',
        evidence: `Cycle detected along ${[...path, id].join(' → ')}.`,
        severity: 'blocking',
        repairContract: 'Break the cycle by repairing the wrong edge; verification: the graph is acyclic.',
      })
      return
    }
    visiting.add(id)
    for (const next of prereqEdges.get(id) ?? []) if (orderIndex.has(next)) dfs(next, [...path, id])
    visiting.delete(id)
    done.add(id)
  }
  for (const id of prereqEdges.keys()) dfs(id, [])

  // -- Referential integrity ---------------------------------------------------
  const itemIds = new Set(set.items.map((i) => i.id))
  for (const { unit, lesson } of lessons) {
    for (const field of ['boundary', 'nonGoals'] as const) {
      for (const ref of new Set(lesson.fields[field].content.match(LESSON_REF_RE) ?? [])) {
        if (ref !== lesson.id && !orderIndex.has(ref)) {
          findings.push({
            checkFamily: 'Referential integrity',
            ruleTag: 'G1.refs',
            location: { unitId: unit.id, lessonId: lesson.id, field },
            summary: `Forwarded exclusion points to nonexistent lesson ${ref}.`,
            evidence: `${lesson.id} ${field} forwards content to ${ref}; no such lesson exists.`,
            severity: 'major',
            repairContract: 'Repair the forward to the real owning lesson; verification: every forward resolves.',
          })
        }
      }
    }
    for (const itemRef of lesson.itemRefs) {
      if (!itemIds.has(itemRef)) {
        findings.push({
          checkFamily: 'Referential integrity',
          ruleTag: 'G1.refs',
          location: { unitId: unit.id, lessonId: lesson.id, field: 'releasedItems' },
          summary: `Released-item reference "${itemRef}" does not resolve in the Repository.`,
          evidence: `${lesson.id} itemRefs contains "${itemRef}"; the evidence set "${set.name}" has no such item.`,
          severity: 'major',
          repairContract: 'Re-link or drop the reference; verification: every itemRef resolves.',
        })
      }
    }
  }

  // -- Boundary algebra (mechanical slice: sibling Included-line disjointness) --
  for (const unit of scope.units) {
    const seenIncluded = new Map<string, string>()
    for (const lesson of unit.lessons) {
      const content = lesson.fields.boundary.content
      const includedSection = content.split(/\bexcluded\b/i)[0] ?? ''
      for (const line of includedSection.split('\n')) {
        const t = norm(line).replace(/^[-•*]\s*/, '')
        if (t.length < 25 || /^included/i.test(t)) continue
        const prior = seenIncluded.get(t)
        if (prior && prior !== lesson.id) {
          findings.push({
            checkFamily: 'Boundary algebra',
            ruleTag: 'G1.boundary',
            location: { unitId: unit.id, lessonId: lesson.id, field: 'boundary' },
            summary: `Included line duplicated across sibling lessons ${prior} and ${lesson.id}.`,
            evidence: `Both cards include the identical performance: "${line.trim().slice(0, 160)}" — sibling Included sets must be disjoint.`,
            severity: 'major',
            repairContract: 'Assign the performance to exactly one owning lesson; verification: no duplicated Included lines within a unit.',
          })
        } else {
          seenIncluded.set(t, lesson.id)
        }
      }
    }
  }

  // -- Format & phrasing ---------------------------------------------------------
  for (const { unit, lesson } of lessons) {
    for (const [label, title] of [
      ['title', lesson.title],
      ['studentFriendlyTitle', lesson.studentFriendlyTitle ?? ''],
    ] as const) {
      if (/^(an?\s+)?(introduction to|understanding|exploring|learning about|discovering|fun with|getting to know|all about)\b/i.test(title.trim())) {
        findings.push({
          checkFamily: 'Format & phrasing',
          ruleTag: 'G1.format',
          location: { unitId: unit.id, lessonId: lesson.id },
          summary: `${label} opens with pedagogy filler ("${title.trim().split(/\s+/).slice(0, 3).join(' ')}…").`,
          evidence: `${lesson.id}: "${title.trim()}" — titles name the teachable behavior, never the act of teaching it.`,
          severity: 'major',
          repairContract: 'Retitle to the observable behavior; verification: no filler openers.',
        })
      }
    }
    const assessment = lesson.fields.assessment.content
    if (assessment.trim().length > 0 && !/students are able to/i.test(assessment)) {
      findings.push({
        checkFamily: 'Format & phrasing',
        ruleTag: 'P8',
        location: { unitId: unit.id, lessonId: lesson.id, field: 'assessment' },
        summary: 'Assessment Evidence is not phrased "Students are able to:".',
        evidence: `${lesson.id}: the field opens "${assessment.trim().slice(0, 80)}…".`,
        severity: 'major',
        repairContract: 'Rephrase to the required stem; verification: the stem present.',
      })
    }
    if (/\b\d{1,3}\s?%|\bpercent\s+(?:correct|accuracy|mastery)|accuracy rate/i.test(assessment)) {
      findings.push({
        checkFamily: 'Format & phrasing',
        ruleTag: 'P8',
        location: { unitId: unit.id, lessonId: lesson.id, field: 'assessment' },
        summary: 'Assessment Evidence contains a percentage or rate.',
        evidence: `${lesson.id}: P8 forbids quantitative thresholds in mastery evidence.`,
        severity: 'major',
        repairContract: 'Restate the evidence qualitatively; verification: no percentages or rates.',
      })
    }
    const hasGenerated = (lesson.generatedExemplars?.length ?? 0) > 0 || lesson.generatedExemplar !== undefined
    if (hasGenerated && !/generated exemplar\s*[—-]+\s*not a released item/i.test(lesson.fields.releasedItems.content)) {
      findings.push({
        checkFamily: 'Format & phrasing',
        ruleTag: 'G1.format',
        location: { unitId: unit.id, lessonId: lesson.id, field: 'releasedItems' },
        summary: 'Generated exemplar lacks its "Generated exemplar — not a released item" label.',
        evidence: `${lesson.id} carries generated exemplars but the Released Items field never labels them as generated${lessonEra(lesson) ? '' : ' (pre-contract lesson — the label requirement postdates it)'}.`,
        severity: lessonEra(lesson) ? 'major' : 'advisory',
        repairContract: 'Label every generated exemplar; verification: the label present wherever exemplars are.',
      })
    }
  }

  const detail = `Six check families over ${lessons.length} lessons. Coverage census: ${
    censusRuns ? `full-grade census over grades ${[...gradesInScope].join(', ')}` : `skipped for a ${scope.request.mode}-mode request (its universe is the request, not the grade) — only lesson-traces-to-a-standard runs`
  }. Boundary algebra runs its mechanical slice here (sibling Included-line disjointness); Excluded-included-exactly-once and ceiling-inside-boundary are put to the Gate 3 communication audits over the sample.`
  return { findings, detail }
}

// ---------------------------------------------------------------------------
// Gate 2 string checks — citation resolution + quote fidelity (deterministic
// half; claim support / inference honesty / precedence run as the AI half).
// ---------------------------------------------------------------------------

function gate2StringChecks(scope: Scope, set: StandardSet): { findings: FindingDraft[]; note: string } {
  const findings: FindingDraft[] = []
  const treeText = new Map<string, string>()
  const walk = (nodes: StandardNode[]): void => {
    for (const n of nodes) {
      // A node's quotable surface is EVERYTHING the tree stores about it:
      // grouping nodes carry their official heading in `label` (wording is
      // '' for pure grouping nodes), and cards legitimately quote the
      // emphasis attribute ('"emphasis": "not designated"') — proven live on
      // the first production run, where 58 emphasis-attribute quotes were
      // falsely blocked as fabricated.
      const text = norm(
        `${n.label ?? ''} ${n.wording ?? ''} ${(n.limits ?? []).join(' ')}${n.emphasis ? ` emphasis: ${n.emphasis}` : ''}${n.fluency ? ' fluency expectation' : ''}`,
      )
      if (n.code) treeText.set(codeKey(n.code), text)
      if (n.norm) treeText.set(codeKey(n.norm), text)
      if (n.children) walk(n.children)
    }
  }
  walk(set.tree)
  const fw = getFramework()
  // Doctrine quotes on cards come from the DI Mathematics CHAPTER texts (the
  // curated excerpts and the cover-to-cover textbook corpus) — the BrainLift
  // summary alone would false-flag every contract-compliant doctrine
  // citation as fabricated. Build the full searchable corpus once per run.
  const corpusParts = [fw.engine.content, fw.doctrine.content, ...allDoctrineChapterTexts()]
  const index = textbookIndex()
  for (const section of index?.sections ?? []) corpusParts.push(sectionText(section.slug))
  const doctrineCorpus = norm(corpusParts.join(' '))
  // Engine quotes are version-locked: a scope generated under an older engine
  // quotes THAT document; checking it against today's rewrite would punish
  // the standing rule that scopes keep the versions they were generated
  // under. Only same-version scopes get engine-quote fidelity.
  const engineCurrent = scope.engineVersion === ENGINE_VERSION
  // An item's quotable surface includes its Repository metadata — cards quote
  // demand profiles and response formats, not just stems.
  const itemText = norm(
    set.items
      .map((i) => `${i.source} ${i.test} ${i.alignmentCode} ${i.demandProfile} ${i.responseFormat} ${i.stem} ${(i.choices ?? []).join(' ')}`)
      .join(' '),
  )

  for (const unit of scope.units) {
    for (const lesson of unit.lessons) {
      const citations = [
        ...Object.entries(lesson.fields).flatMap(([field, f]) => (f?.citations ?? []).map((c) => ({ field, c }))),
        ...lesson.decisions.flatMap((d) => d.citations.map((c) => ({ field: 'decisions', c }))),
      ]
      for (const { field, c } of citations) {
        // Fidelity applies to QUOTE CLAIMS only — an excerpt that is not
        // quote-wrapped is commentary, and an attribute-shaped excerpt quotes
        // dataset metadata whose serialization is the card's own.
        const quoted = isQuoteWrapped(c.excerpt ?? '') && !isAttributeQuote(c.excerpt ?? '')
        const core = quoteCore(c.excerpt ?? '')
        if (c.sourceType === 'standards') {
          const codes = codesIn(`${c.label} ${c.locator}`)
          const known = codes.filter((code) => treeText.has(code))
          if (codes.length > 0 && known.length === 0) {
            findings.push({
              checkFamily: 'Citation resolution',
              ruleTag: 'G2.resolve',
              location: { unitId: unit.id, lessonId: lesson.id, field },
              summary: `Standards citation "${c.label}" resolves to no code in the set.`,
              evidence: `Cited code(s) ${codes.join(', ')} do not exist in "${set.name}".`,
              severity: 'major',
              repairContract: 'Re-cite the genuine code; verification: the citation resolves in the tree.',
            })
          } else if (quoted && core.length >= 20 && known.length > 0 && !known.some((code) => (treeText.get(code) ?? '').includes(core))) {
            findings.push({
              checkFamily: 'Quote fidelity',
              ruleTag: 'G2.quote',
              location: { unitId: unit.id, lessonId: lesson.id, field },
              summary: `Quoted standards text not found under ${known.join('/')} — treated as fabricated.`,
              evidence: `Excerpt "${c.excerpt.slice(0, 120)}" is not locatable in the cited standard's label/wording/limits (extraction-artifact tolerance applied).`,
              severity: 'blocking',
              repairContract: 'Replace with the verbatim source text; verification: the quote locates in the parsed corpus.',
            })
          }
        }
        if (c.sourceType === 'doctrine' && quoted && core.length >= 25 && !doctrineCorpus.includes(core)) {
          findings.push({
            checkFamily: 'Quote fidelity',
            ruleTag: 'G2.quote',
            location: { unitId: unit.id, lessonId: lesson.id, field },
            summary: 'Quoted doctrine text not found in the doctrine corpus — treated as fabricated.',
            evidence: `Excerpt "${c.excerpt.slice(0, 120)}" (locator "${c.locator}") is not locatable in the BrainLift, the curated chapter excerpts, or the full textbook corpus.`,
            severity: 'blocking',
            repairContract: 'Replace with the verbatim source text; verification: the quote locates in the corpus.',
          })
        }
        if (c.sourceType === 'engine' && engineCurrent && quoted && core.length >= 25 && !doctrineCorpus.includes(core)) {
          findings.push({
            checkFamily: 'Quote fidelity',
            ruleTag: 'G2.quote',
            location: { unitId: unit.id, lessonId: lesson.id, field },
            summary: 'Quoted engine text not found in the engine document — treated as fabricated.',
            evidence: `Excerpt "${c.excerpt.slice(0, 120)}" (locator "${c.locator}") is not locatable in the current engine document (the scope generated under this engine version).`,
            severity: 'blocking',
            repairContract: 'Replace with the verbatim source text; verification: the quote locates in the document.',
          })
        }
        if (c.sourceType === 'items' && quoted && core.length >= 25 && itemText.length > 0 && !itemText.includes(core)) {
          findings.push({
            checkFamily: 'Quote fidelity',
            ruleTag: 'G2.quote',
            location: { unitId: unit.id, lessonId: lesson.id, field },
            summary: `Quoted item text not found in the item bank.`,
            evidence: `Excerpt "${c.excerpt.slice(0, 120)}" (label "${c.label}") is not locatable in any stored item stem/choices — screenshots-only items tolerated, but quote-wrapped text must locate.`,
            severity: 'major',
            repairContract: 'Re-quote from the stored item (or cite by label without a text quote); verification: the quote locates or is removed.',
          })
        }
      }
    }
  }
  const note = `Fidelity applies to quote-wrapped excerpts only (commentary excerpts are not verbatim claims); doctrine quotes search the BrainLift + chapter excerpts + full textbook corpus; engine quotes are ${
    engineCurrent ? 'checked against the current engine document' : `SKIPPED — the scope generated under "${scope.engineVersion}", not the current engine, and keeps the version it was generated under`
  }.`
  return { findings, note }
}

// ---------------------------------------------------------------------------
// Gate 4 — confidence composition. Routes review; never edits content.
// ---------------------------------------------------------------------------

function composeConfidences(scope: Scope, set: StandardSet, findings: QcFinding[]): QcCardConfidence[] {
  const warningText = norm(set.warnings.map((w) => w.text).join(' '))
  const byLesson = new Map<string, QcFinding[]>()
  for (const f of findings) {
    if (!f.location.lessonId) continue
    byLesson.set(f.location.lessonId, [...(byLesson.get(f.location.lessonId) ?? []), f])
  }
  const out: QcCardConfidence[] = []
  for (const unit of scope.units) {
    for (const lesson of unit.lessons) {
      const badgeMix = lesson.evidenceStatus === 'observed' ? 100 : lesson.evidenceStatus === 'mixed' ? 70 : 45
      const mine = byLesson.get(lesson.id) ?? []
      const weigh = (gate: 2 | 3): number => {
        const g = mine.filter((f) => f.gate === gate)
        return Math.max(
          0,
          100 - g.filter((f) => f.severity === 'blocking').length * 45 - g.filter((f) => f.severity === 'major').length * 25 - g.filter((f) => f.severity === 'advisory').length * 8,
        )
      }
      // Acknowledged coverage gaps: exposure when a warning names this
      // lesson's grade.domain token as a whole word ("4.OA") — bare domain
      // substrings would match inside ordinary words ("uploaded" ⊃ "oa").
      const tokens = codesIn(lesson.fields.standards.content)
        .map((c) => {
          const [grade, domain] = c.split('.')
          return domain ? `${grade}.${domain}` : ''
        })
        .filter((t) => t.length >= 3)
      const exposed = tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(warningText))
      const coverageExposure = exposed ? 70 : 100
      const g2 = weigh(2)
      const g3 = weigh(3)
      const score = Math.round(0.35 * badgeMix + 0.25 * g2 + 0.3 * g3 + 0.1 * coverageExposure)
      out.push({
        lessonId: lesson.id,
        score,
        band: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
        components: { badgeMix, gate2: g2, gate3: g3, coverageExposure },
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The run step — four gates, checkpointed like every long pipeline step.
// ---------------------------------------------------------------------------

const courseSkeleton = (scope: Scope): unknown =>
  scope.units.map((u) => ({
    id: u.id,
    title: u.title,
    strand: u.strand,
    lessons: u.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      standards: l.fields.standards.content.split('\n')[0]?.slice(0, 120) ?? '',
      newLearning: l.fields.newLearning.content.slice(0, 220),
    })),
  }))

/**
 * Standards wording for the AI gates, filtered to the scope's grades so the
 * slices can afford to be LONG — claim support judged against amputated
 * wording rules false overreaches (limits are the boundary authority).
 */
const treeDigest = (set: StandardSet, grades: Set<string>): string[] => {
  const out: string[] = []
  const walkNodes = (nodes: StandardNode[]): void => {
    for (const n of nodes) {
      const inGrade = grades.size === 0 || grades.has(codeKey(n.code || n.norm || '').split('.')[0])
      if (n.wording && inGrade) {
        out.push(`${n.code}: ${n.wording.slice(0, 400)}${(n.limits ?? []).length > 0 ? ` [limits: ${(n.limits ?? []).join(' · ').slice(0, 400)}]` : ''}`)
      }
      if (n.children && n.children.length > 0) walkNodes(n.children)
    }
  }
  walkNodes(set.tree)
  return out
}

export async function qcRunStep(msg: JobMessage, _ctx: InvocationContext): Promise<void> {
  const scopeId = msg.scopeId
  if (!scopeId) throw new Error('qc/run message missing scopeId')

  const job = await getJob(msg.jobId)
  if (job.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Stopped by user')
    })
    return
  }

  const scope = await getScope(scopeId)
  const set = await getScopeEvidenceSet(scope)
  const started = Date.now()

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = 5
    r.stage = 'Gate 1 — Structural Validation'
    if (r.stagesDone === 0) pushLog(r, `Four-gate QC dispatched (${QC_STACK_VERSION})`)
  })

  // A budget re-enqueue must never assemble a MIXED-VERSION report: the
  // scope version is checkpointed on the first execution, and if the scope
  // changed between executions the AI-gate checkpoints (sampled from the old
  // version) are dropped and recomputed.
  const versionPath = `jobs/${msg.jobId}/qc-scope-version.json`
  const checkpointedVersion = await getJsonOrUndefined<{ scopeVersion: string }>(dataContainer(), versionPath)
  if (checkpointedVersion === undefined) {
    await putJson(dataContainer(), versionPath, { scopeVersion: scope.updated })
  } else if (checkpointedVersion.scopeVersion !== scope.updated) {
    await Promise.all(
      ['qc-gate2.json', 'qc-gate3-structure.json', 'qc-gate3-communication.json'].map((f) =>
        dataContainer().getBlockBlobClient(`jobs/${msg.jobId}/${f}`).deleteIfExists(),
      ),
    )
    await putJson(dataContainer(), versionPath, { scopeVersion: scope.updated })
    await mutateJob(msg.jobId, (r) => pushLog(r, 'The scope changed between executions — AI-gate checkpoints dropped and recomputed against the current version'))
  }

  // The run document exists (status running) from the moment the gates start,
  // so the page shows live pipeline state. Guarded: a DELETE that landed
  // after the entry check must not be resurrected by this save.
  const now = nowIso()
  const runShell: QcRun = {
    scopeId,
    scopeTitle: scope.title,
    status: 'running',
    gates: [],
    findings: [],
    confidences: [],
    verdict: 'clean',
    quarantinedCards: [],
    qcStackVersion: QC_STACK_VERSION,
    seededCatchRate: 'not yet measured — seeded-defect suite v0 has no injected corpus',
    scopeVersion: scope.updated,
    created: (await getQcRunOrUndefined(scopeId))?.created ?? now,
    updated: now,
  }
  const preShellCheck = await getJob(msg.jobId)
  if (preShellCheck.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'QC docs deleted before the gates started — nothing written')
    })
    return
  }
  await saveQcRun(runShell)

  const bounded = (): { signal: AbortSignal; dispose: () => void } => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
    return { signal: controller.signal, dispose: () => clearTimeout(timer) }
  }
  const overBudget = (): boolean => Date.now() - started > QC_TIME_BUDGET_MS
  const reenqueue = async (afterStage: string): Promise<void> => {
    await mutateJob(msg.jobId, (r) => pushLog(r, `Time budget reached after ${afterStage} — the next gate continues in a fresh execution`))
    await enqueueJob({ jobId: msg.jobId, kind: 'qc', step: 'run', scopeId })
  }

  // ---- Gates 1 + 2(string) are pure code — always recomputed, never stale.
  const g1 = gate1Findings(scope, set)
  const g2String = gate2StringChecks(scope, set)
  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = Math.max(r.stagesDone, 1)
    r.stage = 'Gate 2 — Evidence Verification'
    pushLog(r, `Gate 1 structural validation: ${g1.findings.length} finding(s); Gate 2 string checks: ${g2String.findings.length}`)
  })

  const { lessons: sample, unitsCovered } = sampleLessons(scope.units, SAMPLE_LESSONS)
  const sampleNote = `The sampled cards are ${sample.length} of the scope's ${scope.units.reduce((n, u) => n + u.lessons.length, 0)} lessons (stratified over ${unitsCovered}/${scope.units.length} units)${unitsCovered < scope.units.length ? ' — unsampled units are NOT represented; judge only what you can see' : ''}.`
  const gradesInScope = new Set(
    scope.units.flatMap((u) => u.lessons.flatMap((l) => codesIn(l.fields.standards.content))).map((c) => c.split('.')[0]),
  )
  const digest = treeDigest(set, gradesInScope)
  const skeleton = courseSkeleton(scope)
  // The solvability audit works items COLD — it needs the referenced items'
  // actual content, not bare ids.
  const sampleItemIds = new Set(sample.flatMap((l) => l.itemRefs))
  const referencedItems = set.items
    .filter((i) => sampleItemIds.has(i.id))
    .slice(0, 40)
    .map((i) => ({
      id: i.id,
      alignmentCode: i.alignmentCode,
      itemType: i.itemType,
      responseFormat: i.responseFormat,
      demandProfile: i.demandProfile,
      hasKey: i.hasKey,
      stem: i.stem.slice(0, 900),
      choices: i.choices ?? [],
    }))

  const aiGate = async (label: string, prompt: { system: string; user: string }): Promise<WireQcFindings> => {
    const { signal, dispose } = bounded()
    try {
      return await generateStructured<WireQcFindings>({
        ...prompt,
        schema: QC_FINDINGS_SCHEMA,
        maxTokens: QC_MAX_TOKENS,
        effort: 'high',
        signal,
      })
    } finally {
      dispose()
    }
  }
  const checkpoint = async <T>(path: string, produce: () => Promise<T>): Promise<{ value: T; fresh: boolean }> => {
    const existing = await getJsonOrUndefined<T>(dataContainer(), path)
    if (existing !== undefined) return { value: existing, fresh: false }
    const value = await produce()
    await putJson(dataContainer(), path, value)
    return { value, fresh: true }
  }

  // ---- Gate 2 (AI half) — checkpointed.
  const g2Path = `jobs/${msg.jobId}/qc-gate2.json`
  const g2 = await checkpoint(g2Path, () =>
    aiGate('gate2', qcGate2Prompt({
      scope_request: scope.request,
      sample_note: { note: sampleNote },
      sampled_cards: sample,
      standards_digest: digest,
      acknowledged_coverage_warnings: set.warnings.map((w) => w.text),
    })),
  )
  if (g2.fresh) {
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.max(r.stagesDone, 2)
      r.stage = 'Gate 3 — Adversarial Review'
      pushLog(r, `Gate 2 evidence verification: ${g2.value.findings.length} AI finding(s) over the ${sample.length}-lesson sample`)
    })
    if (overBudget()) return reenqueue('Gate 2')
  }

  // ---- Gate 3 — two audit batches, each checkpointed.
  const g3aPath = `jobs/${msg.jobId}/qc-gate3-structure.json`
  const g3a = await checkpoint(g3aPath, () =>
    aiGate('gate3-structure', qcGate3Prompt('structure', {
      sample_note: { note: sampleNote },
      sampled_cards: sample,
      course_skeleton: skeleton,
      standards_digest: digest,
    })),
  )
  if (g3a.fresh) {
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.max(r.stagesDone, 3)
      pushLog(r, `Gate 3 structure audits (split challenge · atom-triple · sequence probe): ${g3a.value.findings.length} finding(s)`)
    })
    if (overBudget()) return reenqueue('Gate 3 structure audits')
  }

  const g3bPath = `jobs/${msg.jobId}/qc-gate3-communication.json`
  const g3b = await checkpoint(g3bPath, () =>
    aiGate('gate3-communication', qcGate3Prompt('communication', {
      sample_note: { note: sampleNote },
      sampled_cards: sample,
      referenced_items: referencedItems,
      course_skeleton: skeleton,
      standards_digest: digest,
      acknowledged_coverage_warnings: set.warnings.map((w) => w.text),
    })),
  )
  if (g3b.fresh) {
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.max(r.stagesDone, 4)
      r.stage = 'Gate 4 — Stability & Confidence'
      pushLog(r, `Gate 3 communication audits (faultless communication · boundary probe · solvability · doctrine rubric): ${g3b.value.findings.length} finding(s)`)
    })
  }

  // ---- Assemble: number findings, compose confidence, verdict.
  const validLessonIds = new Set(scope.units.flatMap((u) => u.lessons.map((l) => l.id)))
  const unitOf = (lessonId: string): string | undefined => scope.units.find((u) => u.lessons.some((l) => l.id === lessonId))?.id
  const fromWire = (wire: WireQcFindings, gate: 2 | 3, source: QcFinding['source'], startAt: number): QcFinding[] =>
    wire.findings.map((f, i) => {
      const lessonId = validLessonIds.has(f.lessonId) ? f.lessonId : undefined
      const location: QcLocation = {}
      if (lessonId) {
        location.lessonId = lessonId
        const u = unitOf(lessonId)
        if (u) location.unitId = u
      }
      if (f.field.trim().length > 0) location.field = f.field.trim()
      return {
        id: `find-${startAt + i}`,
        source,
        gate,
        checkFamily: f.checkFamily,
        ruleTag: f.ruleTag,
        location,
        summary: f.summary,
        evidence: f.evidence,
        severity: f.severity,
        repairContract: f.repairContract,
      }
    })

  let seq = 1
  const findings: QcFinding[] = []
  const g1Final = finalizeFindings(g1.findings, 'gate', 1, seq)
  seq += g1Final.length
  findings.push(...g1Final)
  const g2StringFinal = finalizeFindings(g2String.findings, 'gate', 2, seq)
  seq += g2StringFinal.length
  findings.push(...g2StringFinal)
  const g2Final = fromWire(g2.value, 2, 'gate', seq)
  seq += g2Final.length
  findings.push(...g2Final)
  const g3Final = [...fromWire(g3a.value, 3, 'audit', seq), ...fromWire(g3b.value, 3, 'audit', seq + g3a.value.findings.length)]
  seq += g3Final.length
  findings.push(...g3Final)

  const confidences = composeConfidences(scope, set, findings)
  const quarantinedCards = [
    ...new Set(findings.filter((f) => f.severity === 'blocking' && f.location.lessonId).map((f) => f.location.lessonId as string)),
  ]
  const anyBlocking = findings.some((f) => f.severity === 'blocking')
  const verdict: QcRun['verdict'] = anyBlocking ? 'quarantined' : findings.length > 0 ? 'advisories' : 'clean'

  const gateResult = (gate: 1 | 2 | 3 | 4, name: string, count: number, detail: string): QcGateResult => ({
    gate,
    name,
    status: count > 0 ? 'findings' : 'pass',
    findingCount: count,
    detail,
  })
  const gates: QcGateResult[] = [
    gateResult(1, 'Structural Validation', g1Final.length, g1.detail),
    gateResult(
      2,
      'Evidence Verification',
      g2StringFinal.length + g2Final.length,
      `Citation resolution + quote fidelity by string check over every card (${g2StringFinal.length}); claim support, inference honesty, and precedence audit by independent AI over the ${sample.length}-lesson sample (${g2Final.length}). ${g2String.note} ${sampleNote}`,
    ),
    gateResult(
      3,
      'Adversarial Review',
      g3Final.length,
      `Seven audits in two batches over the ${sample.length}-lesson sample: split challenge, atom-triple check, sequence probe; faultless-communication probe, boundary probe, solvability audit, doctrine rubric. ${sampleNote}`,
    ),
    {
      gate: 4,
      name: 'Stability & Confidence',
      status: 'findings' as const,
      findingCount: 0,
      detail: `Card Confidence Scores composed from evidence-badge mix, Gate 2/3 exposure, and acknowledged-coverage-gap exposure over all ${confidences.length} cards. Self-consistency re-runs are NOT exercised in this stack version — the score's stability term is unmeasured and the composition says so honestly.`,
    },
  ]
  gates[3].status = 'pass'

  // Deletion race guard: DELETE /qc/{scopeId} flags the job before removing
  // the docs — re-check so a deleted run is not resurrected by this save.
  // The shell save above may itself have resurrected the doc if the DELETE
  // landed mid-run; sweep it back out (idempotent) before discarding.
  const finalCheck = await getJob(msg.jobId)
  if (finalCheck.cancelRequested === true) {
    await deleteQcDocs(scopeId).catch(() => undefined)
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'QC run was deleted while running — results discarded')
    })
    return
  }

  await saveQcRun({
    ...runShell,
    status: 'complete',
    gates,
    findings,
    confidences,
    verdict,
    quarantinedCards,
    updated: nowIso(),
  })

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(
      r,
      `QC Report: ${verdict.toUpperCase()} — ${findings.length} finding(s) (${findings.filter((f) => f.severity === 'blocking').length} blocking, ${findings.filter((f) => f.severity === 'major').length} major), ${quarantinedCards.length} card(s) quarantined`,
    )
  })
}

// ---------------------------------------------------------------------------
// The investigation step — six steps, aimed by flags; repairs are proposals.
// ---------------------------------------------------------------------------

export async function qcInvestigateStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = msg.scopeId
  const investigationId = String(msg.payload?.investigationId ?? '')
  if (!scopeId || !investigationId) throw new Error('qc/investigate message missing scopeId/investigationId')

  const job = await getJob(msg.jobId)
  if (job.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Stopped by user')
    })
    return
  }

  const scope = await getScope(scopeId)
  const set = await getScopeEvidenceSet(scope)
  const ledger = await getFlagLedger(scopeId)
  const log = await getInvestigationLog(scopeId)
  const inv = log.investigations.find((i) => i.id === investigationId)
  if (!inv) {
    ctx.warn(`qc/investigate ${investigationId}: record vanished (deleted?) — settling quietly`)
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Investigation record no longer exists — nothing to do')
    })
    return
  }
  const flags = ledger.flags.filter((f) => inv.flagIds.includes(f.id))
  const run = await getQcRunOrUndefined(scopeId)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = 1
    r.stage = 'Investigation — re-deriving flagged decisions'
  })

  const { lessons: sample } = sampleLessons(scope.units, SAMPLE_LESSONS)
  // Cards the flags name are shown in FULL even when outside the sample.
  const flaggedIds = new Set(flags.map((f) => f.location.lessonId).filter((x): x is string => Boolean(x)))
  const flaggedCards = scope.units.flatMap((u) => u.lessons).filter((l) => flaggedIds.has(l.id))
  const cardById = new Map([...sample, ...flaggedCards].map((l) => [l.id, l]))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXECUTION_DEADLINE_MS)
  let wire: WireQcInvestigation
  try {
    wire = await generateStructured<WireQcInvestigation>({
      ...qcInvestigationPrompt({
        flags: flags.map((f) => ({ id: f.id, location: f.location, type: f.type, note: f.note, scopeVersion: f.scopeVersion })),
        flagged_and_sampled_cards: [...cardById.values()],
        course_skeleton: courseSkeleton(scope),
        standards_digest: treeDigest(
          set,
          new Set(scope.units.flatMap((u) => u.lessons.flatMap((l) => codesIn(l.fields.standards.content))).map((c) => c.split('.')[0])),
        ),
        current_qc_findings: (run?.findings ?? []).map((f) => ({ id: f.id, gate: f.gate, ruleTag: f.ruleTag, summary: f.summary, severity: f.severity })),
        acknowledged_coverage_warnings: set.warnings.map((w) => w.text),
      }),
      schema: QC_INVESTIGATION_SCHEMA,
      maxTokens: QC_MAX_TOKENS,
      effort: 'high',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const finalCheck = await getJob(msg.jobId)
  if (finalCheck.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Investigation deleted while running — results discarded')
    })
    return
  }

  const verdictByFlag = new Map(wire.verdicts.map((v) => [v.flagId, v]))
  const completed: Partial<QcInvestigation> = {
    status: 'complete',
    verdicts: flags.map((f) => {
      const v = verdictByFlag.get(f.id)
      if (!v) {
        return {
          flagId: f.id,
          verdict: 'not-confirmed' as const,
          rationale: 'The investigation reply omitted this flag — treated as unruled; re-run the investigation.',
        }
      }
      const out: QcInvestigation['verdicts'][number] = { flagId: f.id, verdict: v.verdict, rationale: v.rationale }
      if (v.verdict === 'confirmed') {
        if (v.severity !== '') out.severity = v.severity
        if (v.rootCause.trim().length > 0) out.rootCause = v.rootCause
      }
      return out
    }),
    patternSweep: wire.patternSweep,
    gateGaps: wire.gateGaps.map((g) => ({ defectClass: g.defectClass, gate: Number(g.gate) as 1 | 2 | 3 | 4, whyMissed: g.whyMissed })),
    proposedRepairs: wire.proposedRepairs,
    updated: nowIso(),
  }

  await mutateInvestigationLog(scopeId, (l) => {
    const target = l.investigations.find((i) => i.id === investigationId)
    if (target) Object.assign(target, completed)
  })
  await mutateFlagLedger(scopeId, (l) => {
    for (const f of l.flags) {
      if (!inv.flagIds.includes(f.id)) continue
      const v = verdictByFlag.get(f.id)
      if (!v) {
        // The model omitted this flag's verdict: roll it back to OPEN so the
        // promised re-investigation is actually possible (investigate only
        // selects open flags; a permanent 'investigating' would be terminal).
        if (f.status === 'investigating') f.status = 'open'
        continue
      }
      f.status = v.verdict === 'confirmed' ? 'confirmed' : 'not-confirmed'
      const resolution: NonNullable<typeof f.resolution> = {
        investigationId,
        verdict: v.verdict,
        rationale: v.rationale,
      }
      if (v.verdict === 'confirmed' && v.severity !== '') resolution.severity = v.severity
      f.resolution = resolution
    }
  })

  const confirmed = wire.verdicts.filter((v) => v.verdict === 'confirmed').length
  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = 1
    r.stage = 'Complete'
    pushLog(
      r,
      `Investigation complete: ${confirmed}/${flags.length} flag(s) confirmed, ${wire.patternSweep.reduce((n, p) => n + p.additionalCards.length, 0)} pattern-sweep card(s), ${wire.gateGaps.length} gate gap(s), ${wire.proposedRepairs.length} proposed repair diff(s) — repairs are proposals only, never auto-applied`,
    )
  })
}
