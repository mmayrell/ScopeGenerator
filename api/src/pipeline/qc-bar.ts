import { InvocationContext } from '@azure/functions'
import {
  JobMessage,
  Lesson,
  QcAttempt,
  QcBar,
  QcCriterion,
  QcDeckCard,
  QcFindingLite,
  QcInvestigation,
  QcLessonResult,
  QcRedFlagReport,
  QcReport,
  Scope,
  StandardNode,
  StandardSet,
} from '../domain/types'
import { getScope, getScopeEvidenceSet, mutateScope } from '../data/entities'
import { getFramework } from '../data/framework'
import { langGuideFindings } from '../data/lang-guide'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'
import { enqueueJob } from '../data/queue'
import {
  getBar,
  getInvestigationLog,
  getNoteLedger,
  getQcReportOrUndefined,
  mutateBar,
  mutateInvestigationLog,
  mutateNoteLedger,
  saveQcReport,
} from '../data/qc'
import { generateStructured } from '../services/claude'
import { allDoctrineChapterTexts } from '../services/doctrine'
import { sectionText, textbookIndex } from '../services/textbook'
import { CardsQcContext, cardsPrompt, qcCourseJudgePrompt, qcInvestigationPrompt, qcJudgePrompt } from '../services/prompts'
import {
  QC_COURSE_JUDGE_SCHEMA,
  QC_INVESTIGATION_SCHEMA,
  QC_JUDGE_SCHEMA,
  PlanOutput,
  toLesson,
  UNIT_CARDS_BATCH_SCHEMA,
  WireLessonBatch,
  WireQcCourseJudge,
  WireQcInvestigation,
  WireQcJudge,
} from '../services/schemas'
import { ACTOR, ENGINE_VERSION, nowIso, today } from '../shared/util'

// The QC Bar engine (spec "Scope Generator: Quality Control and Loop
// Engineering", 2026-07-17): mechanical checks + the independent judge + the
// bounded revise → fresh-start escalation loop. Generation calls qcUnitLoop
// after drafting each unit's cards and qcCoursePhase at finalize; "Run QC
// sweep" applies the same loop to an existing scope as a NEW version; the
// investigation step re-examines human notes and routes confirmed problems
// to card / bar / specifications.

const JUDGE_SLICE = 6
const REVISE_SLICE = 3
const QC_MAX_TOKENS = 32000

// ---------------------------------------------------------------------------
// Shared text helpers (ported from the four-gate engine).
// ---------------------------------------------------------------------------

const CODE_RE = /\b(?:\d+|[Kk]|HS[A-Za-z]{1,3}(?:-[A-Za-z]{1,4})?)(?:\.[A-Za-z0-9]+|\([A-Za-z0-9]+\))+/g
const LESSON_REF_RE = /\bU\d+\.L\d+\b/g
const codeKey = (c: string): string => c.toUpperCase().replace(/[()]/g, '')
const codesIn = (text: string): string[] => (text.match(CODE_RE) ?? []).map(codeKey)
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const isQuoteWrapped = (excerpt: string): boolean => /^["“‘']/.test(excerpt.trim())
/** Attribute-shaped excerpts quote dataset metadata in the card's own serialization — exempt from fidelity. */
const isAttributeQuote = (excerpt: string): boolean => /^\s*["“‘']?[A-Za-z_][A-Za-z0-9_]{0,40}["”’']?\s*:/.test(excerpt.trim())
const quoteCore = (excerpt: string): string => {
  const parts = excerpt
    .split(/(?:\.\.\.|…|\[\.\.\.?\]|\[…\])/)
    .map((p) => norm(p))
    .filter((p) => p.length > 0)
  return parts.sort((a, b) => b.length - a.length)[0] ?? ''
}

/** The evidence context mechanical checks and the judge share — built once per run. */
export interface QcCheckContext {
  set: StandardSet
  treeText: Map<string, string>
  itemIds: Set<string>
  itemText: string
  doctrineCorpus: string
  /** Grade-filtered standards digest for the judge. */
  digest: string[]
  /**
   * Engine quotes are version-locked: a scope generated under an OLDER
   * engine quotes THAT document, and checking it against today's rewrite
   * would false-block honest citations. Callers sweeping old scopes set
   * this false (generation-time QC always checks — new cards quote the
   * current engine).
   */
  engineQuotesCheckable?: boolean
}

export function buildCheckContext(set: StandardSet, grades: Set<string>): QcCheckContext {
  const treeText = new Map<string, string>()
  const digest: string[] = []
  const walk = (nodes: StandardNode[]): void => {
    for (const n of nodes) {
      const text = norm(
        `${n.label ?? ''} ${n.wording ?? ''} ${(n.limits ?? []).join(' ')}${n.emphasis ? ` emphasis: ${n.emphasis}` : ''}${n.fluency ? ' fluency expectation' : ''}`,
      )
      if (n.code) treeText.set(codeKey(n.code), text)
      if (n.norm) treeText.set(codeKey(n.norm), text)
      const inGrade = grades.size === 0 || grades.has(codeKey(n.code || n.norm || '').split('.')[0])
      if (n.wording && inGrade) {
        digest.push(`${n.code}: ${n.wording.slice(0, 400)}${(n.limits ?? []).length > 0 ? ` [limits: ${(n.limits ?? []).join(' · ').slice(0, 400)}]` : ''}`)
      }
      if (n.children) walk(n.children)
    }
  }
  walk(set.tree)
  const fw = getFramework()
  const corpusParts = [fw.engine.content, fw.doctrine.content, ...allDoctrineChapterTexts()]
  const index = textbookIndex()
  for (const section of index?.sections ?? []) corpusParts.push(sectionText(section.slug))
  return {
    set,
    treeText,
    itemIds: new Set(set.items.map((i) => i.id)),
    itemText: norm(
      set.items
        .map((i) => `${i.source} ${i.test} ${i.alignmentCode} ${i.demandProfile} ${i.responseFormat} ${i.stem} ${(i.choices ?? []).join(' ')}`)
        .join(' '),
    ),
    doctrineCorpus: norm(corpusParts.join(' ')),
    digest,
  }
}

// ---------------------------------------------------------------------------
// Automatic (mechanical) checks — bound to criteria by autoCheckId. Each
// returns findings for ONE lesson (lesson level) or the course.
// ---------------------------------------------------------------------------

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

type LessonCheck = (lesson: Lesson, ctx: QcCheckContext) => string[]

const LESSON_CHECKS: Record<string, LessonCheck> = {
  'fields-complete': (l) => {
    const out: string[] = []
    for (const f of CORE_FIELDS) {
      if (l.fields[f].content.trim().length === 0) out.push(`field "${f}" is empty`)
      else if ((l.fields[f].rationale ?? '').trim().length === 0) out.push(`field "${f}" lacks its Decision Record rationale`)
    }
    return out
  },
  'card-entries-present': (l) => {
    const out: string[] = []
    if ((l.fields.substandard?.content ?? '').trim().length === 0) out.push('substandard missing')
    if ((l.fields.objectives?.content ?? '').trim().length === 0) out.push('objectives missing')
    if ((l.studentFriendlyTitle ?? '').trim().length === 0) out.push('student-friendly title missing')
    if ((l.sequencingRationale ?? '').trim().length === 0) out.push('card-level sequencing rationale missing')
    if ((l.granularityRationale ?? '').trim().length === 0) out.push('card-level granularity rationale missing')
    return out
  },
  'citation-resolution': (l, ctx) => {
    const out: string[] = []
    for (const [field, fl] of Object.entries(l.fields)) {
      for (const c of fl?.citations ?? []) {
        if (c.sourceType !== 'standards') continue
        const codes = codesIn(`${c.label} ${c.locator}`)
        if (codes.length > 0 && !codes.some((code) => ctx.treeText.has(code))) {
          out.push(`[${field}] citation "${c.label}" cites ${codes.join(', ')} — no such code in the set`)
        }
      }
    }
    return out
  },
  'quote-fidelity': (l, ctx) => {
    const out: string[] = []
    const citations = [
      ...Object.entries(l.fields).flatMap(([field, fl]) => (fl?.citations ?? []).map((c) => ({ field, c }))),
      ...l.decisions.flatMap((d) => d.citations.map((c) => ({ field: 'decisions', c }))),
    ]
    for (const { field, c } of citations) {
      const quoted = isQuoteWrapped(c.excerpt ?? '') && !isAttributeQuote(c.excerpt ?? '')
      if (!quoted) continue
      const core = quoteCore(c.excerpt ?? '')
      if (c.sourceType === 'standards' && core.length >= 20) {
        const known = codesIn(`${c.label} ${c.locator}`).filter((code) => ctx.treeText.has(code))
        if (known.length > 0 && !known.some((code) => (ctx.treeText.get(code) ?? '').includes(core))) {
          out.push(`[${field}] quoted standards text not found under ${known.join('/')}: "${c.excerpt.slice(0, 100)}"`)
        }
      }
      if (
        (c.sourceType === 'doctrine' || (c.sourceType === 'engine' && ctx.engineQuotesCheckable !== false)) &&
        core.length >= 25 &&
        !ctx.doctrineCorpus.includes(core)
      ) {
        out.push(`[${field}] quoted ${c.sourceType} text not found in the corpus: "${c.excerpt.slice(0, 100)}"`)
      }
      if (c.sourceType === 'items' && core.length >= 25 && ctx.itemText.length > 0 && !ctx.itemText.includes(core)) {
        out.push(`[${field}] quoted item text not found in the item bank: "${c.excerpt.slice(0, 100)}"`)
      }
    }
    return out
  },
  'item-refs-resolve': (l, ctx) => l.itemRefs.filter((r) => !ctx.itemIds.has(r)).map((r) => `itemRef "${r}" does not resolve in the Repository`),
  'assessment-phrasing': (l) => {
    const out: string[] = []
    const a = l.fields.assessment.content
    if (a.trim().length > 0 && !/students are able to/i.test(a)) out.push('Assessment Evidence is not phrased "Students are able to:"')
    if (/\b\d{1,3}\s?%|\bpercent\s+(?:correct|accuracy|mastery)|accuracy rate/i.test(a)) out.push('Assessment Evidence contains a percentage or rate (P8)')
    return out
  },
  'exemplar-labels': (l) => {
    const has = (l.generatedExemplars?.length ?? 0) > 0 || l.generatedExemplar !== undefined
    return has && !/generated exemplar\s*[—-]+\s*not a released item/i.test(l.fields.releasedItems.content)
      ? ['generated exemplar lacks its "Generated exemplar — not a released item" label']
      : []
  },
  'title-filler': (l) =>
    [l.title, l.studentFriendlyTitle ?? '']
      .filter((t) => /^(an?\s+)?(introduction to|understanding|exploring|learning about|discovering|fun with|getting to know|all about)\b/i.test(t.trim()))
      .map((t) => `title opens with pedagogy filler: "${t.trim().slice(0, 60)}"`),
  'math-language': (l) =>
    langGuideFindings([
      l.title,
      l.studentFriendlyTitle ?? '',
      l.fields.substandard?.content ?? '',
      l.fields.objectives?.content ?? '',
      l.fields.emphasis.content,
      l.fields.progression.content,
      l.fields.prerequisites.content,
      l.fields.boundary.content,
      l.fields.newLearning.content,
      l.fields.approach.content,
      l.fields.nonGoals.content,
      l.fields.ceiling.content,
      l.fields.assessment.content,
      l.fields.releasedItems.content,
      ...(l.generatedExemplars ?? []).map((e) => `${e.stem} ${e.answer} ${(e.choices ?? []).join(' ')}`),
    ]).map((f) => `older-practice math language: ${f}`),
}

type CourseCheck = (units: { id: string; lessons: Lesson[] }[], scope: Scope, ctx: QcCheckContext) => { detail: string; lessonIds: string[] }[]

const COURSE_CHECKS: Record<string, CourseCheck> = {
  'coverage-census': (units, scope, ctx) => {
    if (scope.request.mode !== 'course') return []
    const all = units.flatMap((u) => u.lessons)
    const allCodes = new Set(all.flatMap((l) => [...codesIn(l.fields.standards.content), ...codesIn(l.fields.substandard?.content ?? '')]))
    const grades = new Set([...allCodes].map((c) => c.split('.')[0]))
    const out: { detail: string; lessonIds: string[] }[] = []
    const leaves: StandardNode[] = []
    const walk = (nodes: StandardNode[]): void => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) walk(n.children)
        else leaves.push(n)
      }
    }
    walk(ctx.set.tree)
    for (const leaf of leaves) {
      const keys = [codeKey(leaf.code ?? ''), codeKey(leaf.norm ?? '')].filter((k) => k.length > 0)
      if (keys.length === 0 || !grades.has(keys[0].split('.')[0])) continue
      const covered = [...allCodes].some((c) => keys.some((k) => c === k || c.startsWith(`${k}.`)))
      if (!covered) out.push({ detail: `most-granular standard ${leaf.code} maps to no lesson`, lessonIds: [] })
    }
    return out
  },
  'prereq-order': (units) => {
    const all = units.flatMap((u) => u.lessons)
    const order = new Map(all.map((l, i) => [l.id, i]))
    const out: { detail: string; lessonIds: string[] }[] = []
    for (const l of all) {
      for (const ref of new Set(l.fields.prerequisites.content.match(LESSON_REF_RE) ?? [])) {
        if (ref === l.id) continue
        if (!order.has(ref)) out.push({ detail: `${l.id} names prerequisite ${ref}, which does not exist`, lessonIds: [l.id] })
        else if ((order.get(ref) ?? 0) >= (order.get(l.id) ?? 0)) out.push({ detail: `${l.id} requires ${ref}, which comes after it`, lessonIds: [l.id] })
      }
    }
    return out
  },
  'included-disjoint': (units) => {
    const out: { detail: string; lessonIds: string[] }[] = []
    for (const u of units) {
      const seen = new Map<string, string>()
      for (const l of u.lessons) {
        const included = l.fields.boundary.content.split(/\bexcluded\b/i)[0] ?? ''
        for (const line of included.split('\n')) {
          const t = norm(line).replace(/^[-•*]\s*/, '')
          if (t.length < 25 || /^included/i.test(t)) continue
          const prior = seen.get(t)
          if (prior && prior !== l.id) out.push({ detail: `${prior} and ${l.id} both include: "${line.trim().slice(0, 120)}"`, lessonIds: [prior, l.id] })
          else seen.set(t, l.id)
        }
      }
    }
    return out
  },
  'lesson-traces-standard': (units) =>
    units
      .flatMap((u) => u.lessons)
      .filter((l) => codesIn(`${l.fields.standards.content} ${l.fields.substandard?.content ?? ''}`).length === 0)
      .map((l) => ({ detail: `${l.id} "${l.title}" carries no recognizable framework code`, lessonIds: [l.id] })),
}

/** Run the enabled automatic lesson criteria against one lesson. */
export function mechanicalLessonFindings(lesson: Lesson, bar: QcBar, ctx: QcCheckContext): QcFindingLite[] {
  const out: QcFindingLite[] = []
  for (const c of bar.criteria) {
    if (!c.enabled || c.level !== 'lesson' || c.method !== 'automatic') continue
    const check = LESSON_CHECKS[c.autoCheckId ?? c.id]
    if (!check) continue
    for (const detail of check(lesson, ctx)) {
      out.push({ criterionId: c.id, title: c.title, severity: c.severity, evidence: detail, revisionInstruction: `Fix: ${detail}.` })
    }
  }
  return out
}

/** Run the enabled automatic course criteria. */
export function mechanicalCourseFindings(
  units: { id: string; lessons: Lesson[] }[],
  scope: Scope,
  bar: QcBar,
  ctx: QcCheckContext,
): { criterion: QcCriterion; detail: string; lessonIds: string[] }[] {
  const out: { criterion: QcCriterion; detail: string; lessonIds: string[] }[] = []
  for (const c of bar.criteria) {
    if (!c.enabled || c.level !== 'course' || c.method !== 'automatic') continue
    const check = COURSE_CHECKS[c.autoCheckId ?? c.id]
    if (!check) continue
    for (const hit of check(units, scope, ctx)) out.push({ criterion: c, detail: hit.detail, lessonIds: hit.lessonIds })
  }
  return out
}

// ---------------------------------------------------------------------------
// The judge.
// ---------------------------------------------------------------------------

export const judgedLessonCriteria = (bar: QcBar): QcCriterion[] =>
  bar.criteria.filter((c) => c.enabled && c.level === 'lesson' && c.method === 'ai-judged')

export const writerBarOf = (bar: QcBar): { title: string; rule: string }[] =>
  bar.criteria.filter((c) => c.enabled && c.level === 'lesson' && c.severity === 'blocking' && c.shownToWriter).map((c) => ({ title: c.title, rule: c.rule }))

const isTruncation = (e: unknown): boolean => String(e).includes('truncated (max_tokens')
const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))

/**
 * Judge a set of lessons against the bar's AI-judged lesson criteria (one
 * call per JUDGE_SLICE lessons; truncated slices split and retry — a single
 * lesson that still truncates retries with blocking criteria only, and a
 * lesson that cannot be judged at all fails loud on every blocking
 * criterion). Returns per-lesson findings (fails only) keyed by lesson id.
 */
export async function judgeLessons(
  lessons: Lesson[],
  bar: QcBar,
  ctx: QcCheckContext,
  extraContext: Record<string, unknown>,
  signalOf: () => { signal: AbortSignal; dispose: () => void },
  effort: 'low' | 'medium' = 'medium',
): Promise<Map<string, QcFindingLite[]>> {
  const criteria = judgedLessonCriteria(bar)
  const out = new Map<string, QcFindingLite[]>()
  if (criteria.length === 0) {
    for (const l of lessons) out.set(l.id, [])
    return out
  }

  const call = async (slice: Lesson[], crits: QcCriterion[]): Promise<WireQcJudge> => {
    const { signal, dispose } = signalOf()
    try {
      return await generateStructured<WireQcJudge>({
        ...qcJudgePrompt(
          crits.map((c) => ({ id: c.id, title: c.title, rule: c.rule })),
          slice,
          { standards_digest: ctx.digest, ...extraContext },
        ),
        schema: QC_JUDGE_SCHEMA,
        maxTokens: QC_MAX_TOKENS,
        effort,
        signal,
      })
    } finally {
      dispose()
    }
  }

  const absorbWire = (wire: WireQcJudge, slice: Lesson[], crits: QcCriterion[]): void => {
    const byLesson = new Map(wire.lessons.map((l) => [l.lessonId, l.results]))
    for (const l of slice) {
      const results = byLesson.get(l.id) ?? []
      const fails: QcFindingLite[] = out.get(l.id) ?? []
      for (const c of crits) {
        const r = results.find((x) => x.criterionId === c.id)
        if (!r) {
          // A criterion the judge skipped is unfalsifiable — fail loud on
          // blocking criteria, never silently pass.
          if (c.severity === 'blocking') {
            fails.push({ criterionId: c.id, title: c.title, severity: c.severity, evidence: 'the judge omitted this criterion — treated as unverified', revisionInstruction: 'Re-judge.' })
          }
          continue
        }
        if (!r.pass) {
          const finding: QcFindingLite = { criterionId: c.id, title: c.title, severity: c.severity, evidence: r.evidence || r.workShown }
          if (r.revisionInstruction.trim().length > 0) finding.revisionInstruction = r.revisionInstruction
          fails.push(finding)
        }
      }
      out.set(l.id, fails)
    }
  }

  const judgeSlice = async (slice: Lesson[]): Promise<void> => {
    try {
      absorbWire(await call(slice, criteria), slice, criteria)
      return
    } catch (e) {
      if (!isTruncation(e)) throw e
      if (slice.length > 1) {
        // Output overflow is deterministic — split, never retry identically.
        const mid = Math.ceil(slice.length / 2)
        await judgeSlice(slice.slice(0, mid))
        await judgeSlice(slice.slice(mid))
        return
      }
    }
    // A single lesson overflowed the full-bar judgment: retry with blocking
    // criteria only (less required output); if even that truncates, the
    // lesson is unjudgeable in one call — fail loud on every blocking
    // criterion rather than silently passing it.
    const blocking = criteria.filter((c) => c.severity === 'blocking')
    try {
      absorbWire(await call(slice, blocking), slice, blocking)
    } catch (e2) {
      if (!isTruncation(e2)) throw e2
      out.set(
        slice[0].id,
        blocking.map((c) => ({
          criterionId: c.id,
          title: c.title,
          severity: c.severity,
          evidence: 'the judgment overflowed the output budget twice — the card could not be verified',
          revisionInstruction: 'Shorten the card or split the lesson; the judge could not emit a full verdict.',
        })),
      )
    }
  }

  for (let i = 0; i < lessons.length; i += JUDGE_SLICE) {
    await judgeSlice(lessons.slice(i, i + JUDGE_SLICE))
  }
  for (const l of lessons) if (!out.has(l.id)) out.set(l.id, [])
  return out
}

// ---------------------------------------------------------------------------
// The per-unit escalation loop (spec Steps 2–4). Checkpointable: callers
// persist the returned state and resume with it.
// ---------------------------------------------------------------------------

export interface QcLessonState {
  current: Lesson
  best: { lesson: Lesson; blockingCount: number; failedIds: string[] }
  attempts: QcAttempt[]
  /** Findings of the LAST check (blocking fails only). */
  lastFails: QcFindingLite[]
  advisories: QcFindingLite[]
  /** Index into the escalation plan for the NEXT repair step; -1 = not yet judged. */
  planIndex: number
  settled?: 'passed' | 'red-flag'
  redFlag?: QcRedFlagReport
  /** First-draft blocking criterion ids (stats). */
  firstDraftFailedIds?: string[]
}

export interface QcUnitState {
  lessons: Record<string, QcLessonState>
  done: boolean
}

const blockingOf = (findings: QcFindingLite[]): QcFindingLite[] => findings.filter((f) => f.severity === 'blocking')
const advisoriesOf = (findings: QcFindingLite[]): QcFindingLite[] => findings.filter((f) => f.severity === 'advisory')

const detectFighting = (attempts: QcAttempt[]): [string, string] | undefined => {
  // Ping-pong: criterion A fails on attempts where B passes and vice versa,
  // each at least twice, across the recorded history.
  const ids = [...new Set(attempts.flatMap((a) => a.failedBlocking))]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]
      const b = ids[j]
      const aFails = attempts.map((x) => x.failedBlocking.includes(a))
      const bFails = attempts.map((x) => x.failedBlocking.includes(b))
      const together = attempts.filter((_, k) => aFails[k] && bFails[k]).length
      const aCount = aFails.filter(Boolean).length
      const bCount = bFails.filter(Boolean).length
      if (together === 0 && aCount >= 2 && bCount >= 2) return [a, b]
    }
  }
  return undefined
}

const redFlagFor = (state: QcLessonState, whyStopped: QcRedFlagReport['whyStopped']): QcRedFlagReport => {
  const everFailed = new Map<string, number>()
  for (const a of state.attempts) for (const id of a.failedBlocking) everFailed.set(id, (everFailed.get(id) ?? 0) + 1)
  const neverPassed = [...everFailed.entries()].filter(([, n]) => n === state.attempts.length).map(([id]) => id)
  const fighting = detectFighting(state.attempts)
  const recommendation =
    neverPassed.length > 0
      ? `"${neverPassed.join('", "')}" failed on every attempt — either the card has a real problem (edit it by hand or restructure the lesson) or the criterion is impossible as written (dry-run it against this card while rewording).`
      : fighting
        ? `Criteria "${fighting[0]}" and "${fighting[1]}" appear to be fighting — fixing one breaks the other. Dry-run both against this card while rewording one.`
        : whyStopped === 'fresh-start-no-better'
          ? 'A fresh draft could not beat the incumbent — the difficulty is likely in the plan skeleton or evidence, not the prose. Consider restructuring the lesson (split/merge) or editing by hand.'
          : 'Revisions stalled without converging — edit the card by hand, or adjust the strictest failing criterion.'
  const report: QcRedFlagReport = { whyStopped, neverPassed, attemptHistory: state.attempts, recommendation }
  if (fighting) report.fighting = fighting
  return report
}

/** Record a judged check into the lesson's state and settle it if terminal. Returns true while the lesson still needs repair. */
export function absorbCheck(
  state: QcLessonState,
  findings: QcFindingLite[],
  kind: QcAttempt['kind'],
  plan: QcBar['escalationPlan'],
): boolean {
  const blocking = blockingOf(findings)
  // Distinct criteria per attempt — mechanical checks emit multiple findings
  // per criterion, and duplicated ids would corrupt never-passed detection
  // and inflate the track record.
  const blockingIds = [...new Set(blocking.map((f) => f.criterionId))]
  const attempt: QcAttempt = {
    attempt: state.attempts.length + 1,
    kind,
    failedBlocking: blockingIds,
    note: blocking.length === 0 ? 'passed' : `${blocking.length} blocking failure(s): ${[...new Set(blocking.map((f) => f.title))].join(', ')}`,
  }
  state.attempts.push(attempt)
  state.lastFails = blocking
  state.advisories = advisoriesOf(findings)
  // First-draft stats record EVERY failed criterion (advisories included) —
  // the track record answers "how often do cards fail it on the first draft".
  if (state.attempts.length === 1) state.firstDraftFailedIds = [...new Set(findings.map((f) => f.criterionId))]

  // The fresh-start stop rule compares against the best EARLIER attempt —
  // capture it BEFORE this attempt can become the new best, or every fresh
  // start would compare against itself and always look "no better".
  const prevBestCount = state.best.blockingCount
  const preFresh = kind === 'fresh-start'
  if (blockingIds.length < state.best.blockingCount || state.attempts.length === 1) {
    state.best = { lesson: state.current, blockingCount: blockingIds.length, failedIds: blockingIds }
  }
  if (blocking.length === 0) {
    state.settled = 'passed'
    return false
  }
  // Stop rules: two consecutive repairs with no progress; a fresh start that
  // came back no better than the best earlier attempt; plan exhausted.
  const history = state.attempts.map((a) => a.failedBlocking.length)
  const n = history.length
  const stalled = n >= 3 && history[n - 1] >= history[n - 2] && history[n - 2] >= history[n - 3]
  const freshNoBetter = preFresh && n > 1 && blockingIds.length >= prevBestCount
  const exhausted = state.planIndex >= plan.length
  if (stalled || freshNoBetter || exhausted) {
    state.settled = 'red-flag'
    state.current = state.best.lesson
    state.redFlag = redFlagFor(state, freshNoBetter ? 'fresh-start-no-better' : stalled ? 'stalled' : 'attempts-exhausted')
    return false
  }
  return true
}

export const lessonResultOf = (lessonId: string, state: QcLessonState): QcLessonResult => {
  const result: QcLessonResult = {
    lessonId,
    title: state.current.title,
    status: state.settled === 'red-flag' ? 'red-flag' : 'passed',
    attempts: state.attempts.length,
    advisories: state.advisories,
    firstDraftFailedIds: state.firstDraftFailedIds ?? [],
  }
  if (state.redFlag) result.redFlag = state.redFlag
  return result
}

// ---------------------------------------------------------------------------
// Criterion stats accumulation — never bumps the bar version.
// ---------------------------------------------------------------------------

export async function accumulateStats(states: QcLessonState[], redFlagged: QcLessonState[]): Promise<void> {
  const firstDraft = new Map<string, number>()
  let judged = 0
  for (const s of states) {
    judged++
    for (const id of s.firstDraftFailedIds ?? []) firstDraft.set(id, (firstDraft.get(id) ?? 0) + 1)
  }
  const redFlagIds = new Map<string, number>()
  for (const s of redFlagged) {
    for (const id of new Set(s.attempts.flatMap((a) => a.failedBlocking))) redFlagIds.set(id, (redFlagIds.get(id) ?? 0) + 1)
  }
  if (judged === 0) return
  await mutateBar(
    (bar) => {
      for (const c of bar.criteria) {
        // The denominator counts only criteria that actually judged these
        // lessons — disabled and course-level criteria never ran per-lesson,
        // and inflating their denominator would fake a spotless record.
        if (!c.enabled || c.level !== 'lesson') continue
        c.stats.judgedLessons += judged
        c.stats.firstDraftFails += firstDraft.get(c.id) ?? 0
        c.stats.redFlagInvolvements += redFlagIds.get(c.id) ?? 0
      }
    },
    { bumpVersion: false },
  ).catch(() => undefined) // stats are best-effort — never fail a run over them
}

// ---------------------------------------------------------------------------
// Report assembly.
// ---------------------------------------------------------------------------

export function assembleReport(
  scopeId: string,
  scopeTitle: string,
  origin: QcReport['origin'],
  barVersion: number,
  scopeVersion: string,
  lessonResults: QcLessonResult[],
  courseFindings: QcFindingLite[],
  createdBefore?: string,
  criterionTitles?: Map<string, string>,
): QcReport {
  const failCounts = new Map<string, { title: string; failCount: number }>()
  for (const r of lessonResults) {
    // Every criterion the lesson EVER failed counts once per lesson — the
    // common revised-to-pass case (first draft failed, revision passed) is
    // exactly the "top failing criteria" signal the bar editor acts on.
    const failedIds = new Set<string>(r.firstDraftFailedIds ?? [])
    for (const a of r.redFlag?.attemptHistory ?? []) for (const id of a.failedBlocking) failedIds.add(id)
    for (const adv of r.advisories) failedIds.add(adv.criterionId)
    for (const id of failedIds) {
      const cur = failCounts.get(id) ?? { title: criterionTitles?.get(id) ?? id, failCount: 0 }
      cur.failCount += 1
      failCounts.set(id, cur)
    }
  }
  const top = [...failCounts.entries()]
    .filter(([, v]) => v.failCount > 0)
    .sort((a, b) => b[1].failCount - a[1].failCount)
    .slice(0, 8)
    .map(([criterionId, v]) => ({ criterionId, title: v.title, failCount: v.failCount }))
  const now = nowIso()
  return {
    scopeId,
    scopeTitle,
    origin,
    status: 'complete',
    barVersion,
    scopeVersion,
    lessons: lessonResults,
    courseFindings,
    passedFirstTry: lessonResults.filter((r) => r.status === 'passed' && r.attempts === 1).length,
    redFlagCount: lessonResults.filter((r) => r.status === 'red-flag').length + courseFindings.filter((f) => f.severity === 'blocking').length,
    advisoryCount: lessonResults.reduce((n, r) => n + r.advisories.length, 0) + courseFindings.filter((f) => f.severity === 'advisory').length,
    topFailingCriteria: top,
    created: createdBefore ?? now,
    updated: now,
  }
}

// ---------------------------------------------------------------------------
// Dry-run + test-the-bar (called synchronously from HTTP with tight budgets).
// ---------------------------------------------------------------------------

export interface QcDryRunResult {
  criterionId: string
  method: 'automatic' | 'ai-judged'
  pass: boolean
  workShown: string
  evidence: string
  revisionInstruction: string
}

export async function dryRunCriterion(criterion: QcCriterion, lesson: Lesson, ctx: QcCheckContext): Promise<QcDryRunResult> {
  if (criterion.method === 'automatic') {
    const check = criterion.level === 'lesson' ? LESSON_CHECKS[criterion.autoCheckId ?? criterion.id] : undefined
    const hits = check ? check(lesson, ctx) : ['this automatic criterion runs at course level — dry-run applies lesson-level criteria']
    return {
      criterionId: criterion.id,
      method: 'automatic',
      pass: check !== undefined && hits.length === 0,
      workShown: check ? 'mechanical check executed' : 'not executable at lesson grain',
      evidence: hits.join(' · '),
      revisionInstruction: hits.length > 0 ? `Fix: ${hits[0]}.` : '',
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3.5 * 60 * 1000)
  try {
    const wire = await generateStructured<WireQcJudge>({
      ...qcJudgePrompt([{ id: criterion.id, title: criterion.title, rule: criterion.rule }], [lesson], { standards_digest: ctx.digest.slice(0, 80) }),
      schema: QC_JUDGE_SCHEMA,
      maxTokens: 8000,
      effort: 'low',
      signal: controller.signal,
    })
    const r = wire.lessons[0]?.results.find((x) => x.criterionId === criterion.id)
    return {
      criterionId: criterion.id,
      method: 'ai-judged',
      pass: r?.pass ?? false,
      workShown: r?.workShown ?? 'the judge returned no result for this criterion',
      evidence: r?.evidence ?? '',
      revisionInstruction: r?.revisionInstruction ?? '',
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface QcDeckRunResult {
  perCard: { deckCardId: string; label: string; expected: string[]; caughtIds: string[]; missedIds: string[]; extraIds: string[] }[]
  caught: number
  missed: number
}

/** Run the current bar against the test deck; the caller persists lastDeckRun stats. */
export async function testBarAgainstDeck(bar: QcBar, deck: QcDeckCard[], ctx: QcCheckContext): Promise<QcDeckRunResult> {
  const perCard: QcDeckRunResult['perCard'] = []
  const lessons = deck.map((d) => ({ ...d.lesson, id: d.id }))
  // Synchronous HTTP path: Azure's front end caps responses at ~230s, so the
  // deck judges at LOW effort with a tight abort — the fixtures are small.
  const judgeMap = await judgeLessons(
    lessons,
    bar,
    ctx,
    { note: { note: 'These are TEST-DECK cards — deliberately broken fixtures. Judge them exactly like real cards.' } },
    () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 190 * 1000)
      return { signal: controller.signal, dispose: () => clearTimeout(timer) }
    },
    'low',
  )
  let caught = 0
  let missed = 0
  for (const d of deck) {
    const mech = mechanicalLessonFindings({ ...d.lesson, id: d.id }, bar, ctx)
    const judged = judgeMap.get(d.id) ?? []
    const firedIds = new Set([...mech, ...judged].map((f) => f.criterionId))
    const expected = d.expectedCriterionIds.filter((id) => bar.criteria.some((c) => c.id === id && c.enabled))
    const caughtIds = expected.filter((id) => firedIds.has(id))
    const missedIds = expected.filter((id) => !firedIds.has(id))
    caught += caughtIds.length
    missed += missedIds.length
    perCard.push({
      deckCardId: d.id,
      label: d.label,
      expected,
      caughtIds,
      missedIds,
      extraIds: [...firedIds].filter((id) => !expected.includes(id)),
    })
  }
  return { perCard, caught, missed }
}

// ---------------------------------------------------------------------------
// The course phase (spec Step 5) — once all lessons exist, course-level
// criteria run; failures send the responsible lessons back through ONE
// revision round with the course context as feedback; problems no lesson can
// fix become course-level red flags. Checkpointable via the state object.
// ---------------------------------------------------------------------------

export interface QcCourseState {
  judged?: WireQcCourseJudge
  revisedLessonIds?: string[]
  /** The revised lessons THEMSELVES — finalize spans executions and rebuilds units from pre-course checkpoints, so ids alone would silently discard the revisions. */
  revisedLessons?: Record<string, Lesson>
  rejudged?: WireQcCourseJudge
  done: boolean
}

export interface CoursePhaseArgs {
  set: StandardSet
  scope: Scope
  plan: PlanOutput
  units: { id: string; title: string; rationale: string; strand: string; lessons: Lesson[] }[]
  bar: QcBar
  checkCtx: QcCheckContext
  state: QcCourseState
  signalOf: () => { signal: AbortSignal; dispose: () => void }
  budgetLeft: () => number
  sourceSets?: StandardSet[]
  userDocs?: { names: string[]; base64: string[] }
}

export async function qcCoursePhase(args: CoursePhaseArgs): Promise<{ state: QcCourseState; courseFindings: QcFindingLite[] }> {
  const { set, scope, plan, units, bar, checkCtx, state, signalOf, budgetLeft } = args
  const sourceSets = args.sourceSets ?? []
  const userDocs = args.userDocs ?? { names: [], base64: [] }
  const courseCriteria = bar.criteria.filter((c) => c.enabled && c.level === 'course' && c.method === 'ai-judged')

  // A resumed execution rebuilt `units` from pre-course checkpoints — re-apply
  // any revisions a prior execution already produced before judging further.
  if (state.revisedLessons) {
    for (const u of units) {
      u.lessons = u.lessons.map((l) => state.revisedLessons![l.id] ?? l)
    }
  }

  const judgeCourse = async (): Promise<WireQcCourseJudge> => {
    if (courseCriteria.length === 0) return { results: [] }
    const { signal, dispose } = signalOf()
    try {
      return await generateStructured<WireQcCourseJudge>({
        ...qcCourseJudgePrompt(
          courseCriteria.map((c) => ({ id: c.id, title: c.title, rule: c.rule })),
          {
            course_skeleton: units.map((u) => ({
              id: u.id,
              title: u.title,
              strand: u.strand,
              lessons: u.lessons.map((l) => ({
                id: l.id,
                title: l.title,
                type: l.type,
                standards: l.fields.standards.content.split('\n')[0]?.slice(0, 120) ?? '',
                newLearning: l.fields.newLearning.content.slice(0, 260),
                boundary: l.fields.boundary.content.slice(0, 320),
                prerequisites: l.fields.prerequisites.content.slice(0, 200),
              })),
            })),
            standards_digest: checkCtx.digest,
          },
        ),
        schema: QC_COURSE_JUDGE_SCHEMA,
        maxTokens: QC_MAX_TOKENS,
        effort: 'medium',
        signal,
      })
    } finally {
      dispose()
    }
  }

  if (!state.judged) {
    if (budgetLeft() <= 0) return { state, courseFindings: [] }
    state.judged = await judgeCourse()
  }

  // ONE revision round for lessons responsible for blocking course failures.
  const blockingFails = state.judged.results.filter((r) => {
    const c = courseCriteria.find((x) => x.id === r.criterionId)
    return c !== undefined && !r.pass && c.severity === 'blocking'
  })
  const responsible = new Map<string, string[]>() // lessonId -> feedback lines
  for (const r of blockingFails) {
    for (const id of r.responsibleLessonIds) {
      responsible.set(id, [...(responsible.get(id) ?? []), `${r.criterionId}: ${r.evidence}${r.revisionInstruction ? ` — ${r.revisionInstruction}` : ''}`])
    }
  }
  if (responsible.size > 0 && state.revisedLessonIds === undefined) {
    if (budgetLeft() <= 0) return { state, courseFindings: [] }
    const writerBar = writerBarOf(bar)
    const revised: string[] = []
    for (const unitIdx of plan.units.keys()) {
      const skeleton = plan.units[unitIdx]
      const unit = units.find((u) => u.id === skeleton.id)
      if (!unit) continue
      const ids = unit.lessons.map((l) => l.id).filter((id) => responsible.has(id))
      for (let i = 0; i < ids.length; i += REVISE_SLICE) {
        const sliceIds = ids.slice(i, i + REVISE_SLICE)
        const sliceSkeletons = skeleton.lessons.filter((sk) => sliceIds.includes(sk.id))
        const currentById = new Map(unit.lessons.map((l) => [l.id, l]))
        const qc: CardsQcContext = {
          writerBar,
          revision: {
            kind: 'revise',
            lessons: sliceIds.map((id) => currentById.get(id) as Lesson),
            findings: Object.fromEntries(
              sliceIds.map((id) => [
                id,
                (responsible.get(id) ?? []).map((line) => ({
                  criterionId: 'course-check',
                  title: 'Course-level failure (course context as feedback)',
                  evidence: line,
                })),
              ]),
            ),
          },
        }
        const { signal, dispose } = signalOf()
        let wire: WireLessonBatch
        try {
          wire = await generateStructured<WireLessonBatch>({
            ...cardsPrompt(set, scope, plan, skeleton, sliceSkeletons, sourceSets, userDocs.names, qc),
            schema: UNIT_CARDS_BATCH_SCHEMA,
            ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
            effort: 'medium',
            maxTokens: 48000,
            signal,
          })
        } catch (e) {
          dispose()
          // Deterministic overflow: skip the course revision for this slice —
          // the failure stays a course finding rather than killing the run.
          if (isTruncation(e)) continue
          throw e
        }
        dispose()
        const byId = new Map(wire.lessons.map((l) => [l.id, l]))
        for (const id of sliceIds) {
          const w = byId.get(id)
          if (!w) continue
          const incumbent = currentById.get(id) as Lesson
          const fresh = toLesson(w, checkCtx.itemIds, incumbent.itemRefs)
          unit.lessons = unit.lessons.map((l) => (l.id === id ? fresh : l))
          state.revisedLessons = { ...(state.revisedLessons ?? {}), [id]: fresh }
          revised.push(id)
        }
      }
    }
    state.revisedLessonIds = revised
  }
  if (responsible.size > 0 && state.rejudged === undefined) {
    if (budgetLeft() <= 0) return { state, courseFindings: [] }
    state.rejudged = await judgeCourse()
  }

  // Assemble course findings from the FINAL judgment + mechanical course checks.
  const finalJudged = state.rejudged ?? state.judged
  const courseFindings: QcFindingLite[] = []
  for (const r of finalJudged.results) {
    const c = courseCriteria.find((x) => x.id === r.criterionId)
    if (!c || r.pass) continue
    courseFindings.push({ criterionId: c.id, title: c.title, severity: c.severity, evidence: r.evidence || r.workShown })
  }
  for (const hit of mechanicalCourseFindings(units, scope, bar, checkCtx)) {
    courseFindings.push({ criterionId: hit.criterion.id, title: hit.criterion.title, severity: hit.criterion.severity, evidence: hit.detail })
  }
  state.done = true
  return { state, courseFindings }
}

// ---------------------------------------------------------------------------
// The investigation step (kind 'qc' / step 'investigate').
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
  const ledger = await getNoteLedger(scopeId)
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
  const notes = ledger.notes.filter((n) => inv.noteIds.includes(n.id))
  const grades = new Set(scope.units.flatMap((u) => u.lessons.flatMap((l) => codesIn(l.fields.standards.content))).map((c) => c.split('.')[0]))
  const checkCtx = buildCheckContext(set, grades)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = 1
    r.stage = 'Investigation — re-examining noted decisions'
  })

  const notedIds = new Set(notes.map((n) => n.location.lessonId).filter((x): x is string => Boolean(x)))
  const notedCards = scope.units.flatMap((u) => u.lessons).filter((l) => notedIds.has(l.id))
  const report = await getQcReportOrUndefined(scopeId)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8.5 * 60 * 1000)
  let wire: WireQcInvestigation
  try {
    wire = await generateStructured<WireQcInvestigation>({
      ...qcInvestigationPrompt({
        notes: notes.map((n) => ({ id: n.id, location: n.location, type: n.type, note: n.note, scopeVersion: n.scopeVersion })),
        noted_cards: notedCards,
        course_skeleton: courseSkeleton(scope),
        standards_digest: checkCtx.digest,
        current_report_summary: report
          ? {
              barVersion: report.barVersion,
              redFlags: report.lessons.filter((l) => l.status === 'red-flag').map((l) => l.lessonId),
              courseFindings: report.courseFindings.map((f) => f.evidence.slice(0, 160)),
            }
          : { note: 'no QC report exists for this scope yet' },
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

  const verdictByNote = new Map(wire.verdicts.map((v) => [v.noteId, v]))
  const completed: Partial<QcInvestigation> = {
    status: 'complete',
    verdicts: notes.map((n) => {
      const v = verdictByNote.get(n.id)
      if (!v) {
        return { noteId: n.id, verdict: 'defended' as const, rationale: 'The investigation reply omitted this note — treated as unruled; re-run the investigation.' }
      }
      const out: QcInvestigation['verdicts'][number] = { noteId: n.id, verdict: v.verdict, rationale: v.rationale }
      if (v.verdict === 'confirmed' && v.rootCause !== '') out.rootCause = v.rootCause
      return out
    }),
    patternSweep: wire.patternSweep,
    proposedRepairs: wire.proposedRepairs,
    proposedCriteria: wire.proposedCriteria.map((c) => ({ ...c })),
    contradictionReports: wire.contradictionReports.map((c) => ({
      passageA: { quote: c.passageAQuote, citation: c.passageACitation },
      passageB: { quote: c.passageBQuote, citation: c.passageBCitation },
      readingTaken: c.readingTaken,
      affectedLessons: c.affectedLessons,
    })),
    updated: nowIso(),
  }

  await mutateInvestigationLog(scopeId, (l) => {
    const target = l.investigations.find((i) => i.id === investigationId)
    if (target) Object.assign(target, completed)
  })
  await mutateNoteLedger(scopeId, (l) => {
    for (const n of l.notes) {
      if (!inv.noteIds.includes(n.id)) continue
      const v = verdictByNote.get(n.id)
      if (!v) {
        if (n.status === 'investigating') n.status = 'open'
        continue
      }
      n.status = v.verdict
      const resolution: NonNullable<typeof n.resolution> = { investigationId, verdict: v.verdict, rationale: v.rationale }
      if (v.verdict === 'confirmed' && v.rootCause !== '') resolution.rootCause = v.rootCause
      n.resolution = resolution
    }
  })

  const confirmed = wire.verdicts.filter((v) => v.verdict === 'confirmed').length
  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = 1
    r.stage = 'Complete'
    pushLog(
      r,
      `Investigation complete: ${confirmed}/${notes.length} note(s) confirmed (${wire.proposedRepairs.length} repair diff(s), ${wire.proposedCriteria.length} drafted criteria, ${wire.contradictionReports.length} contradiction report(s)) — nothing applied without your acceptance`,
    )
  })
}

// ---------------------------------------------------------------------------
// The sweep step (kind 'qc' / step 'sweep') — apply the CURRENT bar to an
// existing scope: check-revise-flag, save the improved course as a NEW
// numbered version (the old one is kept in history), report origin 'sweep'.
// ---------------------------------------------------------------------------

const SWEEP_TIME_BUDGET_MS = 4.5 * 60 * 1000
const SWEEP_DEADLINE_MS = 8.5 * 60 * 1000

interface SweepState {
  unitStates: Record<string, QcUnitState>
  unitsDone: string[]
}

export async function qcSweepStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = msg.scopeId
  if (!scopeId) throw new Error('qc/sweep message missing scopeId')
  const started = Date.now()

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
  const bar = await getBar()
  const grades = new Set(scope.units.flatMap((u) => u.lessons.flatMap((l) => codesIn(l.fields.standards.content))).map((c) => c.split('.')[0]))
  const checkCtx = buildCheckContext(set, grades)
  // Old scopes quote the engine version they were generated under — never
  // hold their quotes to today's rewritten document.
  checkCtx.engineQuotesCheckable = scope.engineVersion === ENGINE_VERSION
  const statePath = `jobs/${msg.jobId}/qc-sweep-state.json`
  const state: SweepState = (await getJsonOrUndefined<SweepState>(dataContainer(), statePath)) ?? { unitStates: {}, unitsDone: [] }
  const sweepCuts = Number(msg.payload?.sweepCuts ?? 0)

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = scope.units.length + 1
    r.stagesDone = state.unitsDone.length
    r.stage = `QC sweep against bar v${bar.barVersion}`
  })

  // A running shell so the tab shows the sweep live (the full report
  // overwrites it at the end; prior report data is superseded by design).
  const priorReport = await getQcReportOrUndefined(scopeId)
  await saveQcReport({
    scopeId,
    scopeTitle: scope.title,
    origin: 'sweep',
    status: 'running',
    barVersion: bar.barVersion,
    scopeVersion: scope.updated,
    lessons: [],
    courseFindings: [],
    passedFirstTry: 0,
    redFlagCount: 0,
    advisoryCount: 0,
    topFailingCriteria: [],
    created: priorReport?.created ?? nowIso(),
    updated: nowIso(),
  })

  const signalOf = () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + SWEEP_DEADLINE_MS - Date.now()))
    return { signal: controller.signal, dispose: () => clearTimeout(timer) }
  }

  // Sweeps run the check + escalation loop per unit. Revisions during a sweep
  // reuse the generation writer with a synthetic plan skeleton derived from
  // the existing unit (id/title/type stay fixed).
  const plan: PlanOutput = {
    units: scope.units.map((u) => ({
      id: u.id,
      title: u.title,
      rationale: u.rationale,
      strand: u.strand,
      lessons: u.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        type: l.type,
        evidenceStatus: l.evidenceStatus,
        standardCodes: codesIn(l.fields.standards.content).slice(0, 4),
        itemRefs: l.itemRefs,
        planningNotes: 'QC sweep — the existing published lesson is the incumbent; identity (id, title, type) is fixed.',
      })),
    })),
    scopeDecisions: [],
  }

  for (let ui = 0; ui < scope.units.length; ui++) {
    const unit = scope.units[ui]
    if (state.unitsDone.includes(unit.id)) continue
    if (Date.now() - started > SWEEP_TIME_BUDGET_MS) {
      await putJson(dataContainer(), statePath, state)
      await enqueueJob({ jobId: msg.jobId, kind: 'qc', step: 'sweep', scopeId, payload: { sweepCuts } })
      await mutateJob(msg.jobId, (r) => pushLog(r, `Time budget reached — the sweep continues in a fresh execution (${state.unitsDone.length}/${scope.units.length} units done)`))
      return
    }
    const unitState: QcUnitState = state.unitStates[unit.id] ?? { lessons: {}, done: false }
    let outcome: { state: QcUnitState }
    try {
      outcome = await runUnitLoop({
        unit: { id: unit.id, lessons: unit.lessons },
        skeleton: plan.units[ui],
        set,
        scope,
        plan,
        bar,
        checkCtx,
        unitState,
        signalOf,
        budgetLeft: () => started + SWEEP_TIME_BUDGET_MS - Date.now(),
        degraded: sweepCuts > 0,
      })
    } catch (e) {
      // An execution-deadline abort mid-loop: the state object holds every
      // COMPLETED attempt (produce mutates state only after its re-check) —
      // persist and continue in a fresh execution, with a bounded cut count
      // so a call that can never fit fails terminally instead of looping.
      if (isAbort(e)) {
        if (sweepCuts + 1 >= 3) {
          throw new Error(`QC sweep for unit ${unit.id} could not fit the execution window after 3 attempts, even degraded — narrow the bar or disable the heaviest criteria and retry.`)
        }
        state.unitStates[unit.id] = unitState
        await putJson(dataContainer(), statePath, state)
        await enqueueJob({ jobId: msg.jobId, kind: 'qc', step: 'sweep', scopeId, payload: { sweepCuts: sweepCuts + 1 } })
        await mutateJob(msg.jobId, (r) => pushLog(r, `Unit ${unit.id}: sweep cut at the execution deadline (cut ${sweepCuts + 1}) — continues degraded in a fresh execution`))
        return
      }
      throw e
    }
    state.unitStates[unit.id] = outcome.state
    if (!outcome.state.done) {
      await putJson(dataContainer(), statePath, state)
      await enqueueJob({ jobId: msg.jobId, kind: 'qc', step: 'sweep', scopeId, payload: { sweepCuts } })
      await mutateJob(msg.jobId, (r) => pushLog(r, `Unit ${unit.id}: sweep paused mid-loop (time budget) — continues in a fresh execution`))
      return
    }
    state.unitsDone.push(unit.id)
    await putJson(dataContainer(), statePath, state)
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = state.unitsDone.length
      pushLog(r, `Unit ${unit.id}: sweep done (${Object.values(outcome.state.lessons).filter((s) => s.settled === 'red-flag').length} red flag(s))`)
    })
  }

  // Assemble: apply changed lessons as a new version; save the report.
  const lessonResults: QcLessonResult[] = []
  const finalById = new Map<string, Lesson>()
  let changed = 0
  for (const unit of scope.units) {
    const us = state.unitStates[unit.id]
    for (const l of unit.lessons) {
      const ls = us?.lessons[l.id]
      if (!ls) continue
      lessonResults.push(lessonResultOf(l.id, ls))
      finalById.set(l.id, ls.current)
      if (JSON.stringify(ls.current) !== JSON.stringify(l)) changed++
    }
  }
  const courseFindings = mechanicalCourseFindings(
    scope.units.map((u) => ({ id: u.id, lessons: u.lessons.map((l) => finalById.get(l.id) ?? l) })),
    scope,
    bar,
    checkCtx,
  ).map((hit) => ({
    criterionId: hit.criterion.id,
    title: hit.criterion.title,
    severity: hit.criterion.severity,
    evidence: hit.detail,
  }))

  const finalCheck = await getJob(msg.jobId)
  if (finalCheck.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Sweep cancelled — no version was written')
    })
    return
  }

  let scopeVersion = scope.updated
  if (changed > 0) {
    const updated = await mutateScope(scopeId, (s) => {
      for (const u of s.units) {
        u.lessons = u.lessons.map((l) => finalById.get(l.id) ?? l)
      }
      s.version += 1
      s.updated = today()
      s.history.unshift({
        version: s.version,
        date: today(),
        actor: ACTOR,
        event: 'QC sweep',
        detail: `Bar v${bar.barVersion} sweep revised ${changed} lesson(s); the previous version is retained in history.`,
      })
    })
    scopeVersion = updated.updated
  }

  const prior = await getQcReportOrUndefined(scopeId)
  const report = assembleReport(
    scopeId,
    scope.title,
    'sweep',
    bar.barVersion,
    scopeVersion,
    lessonResults,
    courseFindings,
    prior?.created,
    new Map(bar.criteria.map((c) => [c.id, c.title])),
  )
  await saveQcReport(report)
  await accumulateStats(
    Object.values(state.unitStates).flatMap((u) => Object.values(u.lessons)),
    Object.values(state.unitStates).flatMap((u) => Object.values(u.lessons).filter((s) => s.settled === 'red-flag')),
  )

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(
      r,
      `QC sweep complete against bar v${bar.barVersion}: ${report.passedFirstTry}/${report.lessons.length} passed first check, ${changed} lesson(s) revised${changed > 0 ? ' (saved as a new scope version)' : ''}, ${report.redFlagCount} red flag(s), ${report.advisoryCount} advisories`,
    )
  })
  ctx.log(`qc/sweep ${msg.jobId}: scope ${scopeId} swept (${changed} revised)`)
}

// ---------------------------------------------------------------------------
// The unit loop core — shared by generation and sweeps.
// ---------------------------------------------------------------------------

export interface UnitLoopArgs {
  unit: { id: string; lessons: Lesson[] }
  /** The plan skeleton for this unit (revisions and fresh starts write against it). */
  skeleton: PlanOutput['units'][number]
  set: StandardSet
  scope: Scope
  plan: PlanOutput
  bar: QcBar
  checkCtx: QcCheckContext
  unitState: QcUnitState
  signalOf: () => { signal: AbortSignal; dispose: () => void }
  /** Milliseconds left in the execution's time budget; the loop checkpoints and yields when it runs out. */
  budgetLeft: () => number
  /** The evidence the drafts were written with — revisions must see the same corpus. */
  sourceSets?: StandardSet[]
  userDocs?: { names: string[]; base64: string[] }
  /** Degraded mode (after a deadline cut): judge and revise at low effort. */
  degraded?: boolean
}

/**
 * Run the check → escalate loop for one unit until every lesson settles or
 * the time budget runs out (state is resumable). Returns the updated state;
 * state.done is true when every lesson settled.
 */
export async function runUnitLoop(args: UnitLoopArgs): Promise<{ state: QcUnitState }> {
  const { unit, skeleton, set, scope, plan, bar, checkCtx, unitState, signalOf, budgetLeft } = args
  const writerBar = writerBarOf(bar)
  const sourceSets = args.sourceSets ?? []
  const userDocs = args.userDocs ?? { names: [], base64: [] }
  const effort: 'low' | 'medium' = args.degraded ? 'low' : 'medium'

  // Initialize state for lessons not yet tracked.
  for (const l of unit.lessons) {
    if (!unitState.lessons[l.id]) {
      unitState.lessons[l.id] = {
        current: l,
        best: { lesson: l, blockingCount: Number.MAX_SAFE_INTEGER, failedIds: [] },
        attempts: [],
        lastFails: [],
        advisories: [],
        planIndex: 0,
      }
    }
  }

  const pendingIds = (): string[] => Object.keys(unitState.lessons).filter((id) => unitState.lessons[id].settled === undefined)

  // First check (draft attempt) for lessons never judged.
  const unjudged = pendingIds().filter((id) => unitState.lessons[id].attempts.length === 0)
  if (unjudged.length > 0) {
    if (budgetLeft() <= 0) return { state: unitState }
    const lessons = unjudged.map((id) => unitState.lessons[id].current)
    const judged = await judgeLessons(lessons, bar, checkCtx, { unit_skeleton: skeleton }, signalOf, effort)
    for (const id of unjudged) {
      const s = unitState.lessons[id]
      const findings = [...mechanicalLessonFindings(s.current, bar, checkCtx), ...(judged.get(id) ?? [])]
      absorbCheck(s, findings, 'draft', bar.escalationPlan)
    }
  }

  // Escalation rounds.
  for (;;) {
    const pending = pendingIds()
    if (pending.length === 0) break
    if (budgetLeft() <= 0) return { state: unitState }

    // Group pending lessons by their next plan step.
    const nextStepOf = (id: string): 'revise' | 'fresh-start' => bar.escalationPlan[unitState.lessons[id].planIndex] ?? 'revise'
    const reviseIds = pending.filter((id) => nextStepOf(id) === 'revise')
    const freshIds = pending.filter((id) => nextStepOf(id) === 'fresh-start')

    // ABORT-SAFETY INVARIANT: lesson state (current / planIndex / attempts)
    // mutates ONLY inside the absorb pass at the very end of each slice —
    // after both the writer call and the re-judge have succeeded. An
    // execution-deadline abort anywhere in between leaves the state exactly
    // as the last completed attempt recorded it, so a resume repeats the
    // slice instead of burning a plan step on a never-judged revision.
    const produce = async (ids: string[], kind: 'revise' | 'fresh-start'): Promise<void> => {
      const writeSlice = async (sliceIds: string[]): Promise<Map<string, Lesson | null>> => {
        const sliceSkeletons = skeleton.lessons.filter((sk) => sliceIds.includes(sk.id))
        const qc: CardsQcContext = {
          writerBar,
          revision:
            kind === 'revise'
              ? {
                  kind: 'revise',
                  lessons: sliceIds.map((id) => unitState.lessons[id].current),
                  findings: Object.fromEntries(
                    sliceIds.map((id) => [
                      id,
                      unitState.lessons[id].lastFails.map((f) => {
                        const out: { criterionId: string; title: string; evidence: string; revisionInstruction?: string } = {
                          criterionId: f.criterionId,
                          title: f.title,
                          evidence: f.evidence,
                        }
                        if (f.revisionInstruction) out.revisionInstruction = f.revisionInstruction
                        return out
                      }),
                    ]),
                  ),
                }
              : {
                  kind: 'fresh-start',
                  warnings: Object.fromEntries(
                    sliceIds.map((id) => [
                      id,
                      [...new Set(unitState.lessons[id].attempts.flatMap((a) => a.failedBlocking))].map((cid) => {
                        const c = bar.criteria.find((x) => x.id === cid)
                        return c ? `${c.title}: ${c.rule}` : cid
                      }),
                    ]),
                  ),
                },
        }
        const { signal, dispose } = signalOf()
        let wire: WireLessonBatch
        try {
          wire = await generateStructured<WireLessonBatch>({
            ...cardsPrompt(set, scope, plan, skeleton, sliceSkeletons, sourceSets, userDocs.names, qc),
            schema: UNIT_CARDS_BATCH_SCHEMA,
            ...(userDocs.base64.length > 0 ? { documents: userDocs.base64 } : {}),
            effort,
            maxTokens: 48000,
            signal,
          })
        } catch (e) {
          dispose()
          if (isTruncation(e) && sliceIds.length > 1) {
            // Deterministic overflow — split the slice, never retry identically.
            const mid = Math.ceil(sliceIds.length / 2)
            const first = await writeSlice(sliceIds.slice(0, mid))
            const second = await writeSlice(sliceIds.slice(mid))
            return new Map([...first, ...second])
          }
          if (isTruncation(e)) {
            // A single lesson overflowed even alone: record a dropped attempt
            // (null) so the stop rules retire it instead of looping.
            return new Map([[sliceIds[0], null]])
          }
          throw e
        }
        dispose()
        const byId = new Map(wire.lessons.map((l) => [l.id, l]))
        return new Map(
          sliceIds.map((id) => {
            const w = byId.get(id)
            // Wire → Lesson with the incumbent's itemRefs preserved (item
            // attachment was decided at planning; a revision never re-decides it).
            return [id, w ? toLesson(w, checkCtx.itemIds, unitState.lessons[id].current.itemRefs) : null]
          }),
        )
      }

      for (let i = 0; i < ids.length; i += REVISE_SLICE) {
        const sliceIds = ids.slice(i, i + REVISE_SLICE)
        const produced = await writeSlice(sliceIds)
        // Judge the produced lessons BEFORE any state mutation.
        const toJudge = sliceIds.map((id) => produced.get(id)).filter((l): l is Lesson => l !== null && l !== undefined)
        const judged = toJudge.length > 0 ? await judgeLessons(toJudge, bar, checkCtx, { unit_skeleton: skeleton }, signalOf, effort) : new Map<string, QcFindingLite[]>()
        // Absorb pass — the only place state changes.
        for (const id of sliceIds) {
          const s = unitState.lessons[id]
          const lesson = produced.get(id)
          s.planIndex += 1
          if (!lesson) {
            // The writer dropped the lesson (or it overflowed alone) — count
            // the attempt as a no-op so the stop rules can retire it.
            absorbCheck(s, s.lastFails, kind, bar.escalationPlan)
            continue
          }
          s.current = lesson
          const findings = [...mechanicalLessonFindings(lesson, bar, checkCtx), ...(judged.get(id) ?? [])]
          absorbCheck(s, findings, kind, bar.escalationPlan)
        }
      }
    }

    if (reviseIds.length > 0) await produce(reviseIds, 'revise')
    if (budgetLeft() <= 0) return { state: unitState }
    if (freshIds.length > 0) await produce(freshIds, 'fresh-start')
  }

  unitState.done = true
  return { state: unitState }
}

