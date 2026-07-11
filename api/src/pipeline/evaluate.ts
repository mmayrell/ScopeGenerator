import { InvocationContext } from '@azure/functions'
import { EvalCell, JobMessage, Lesson, Unit } from '../domain/types'
import { getScope, getScopeEvidenceSet } from '../data/entities'
import { mutateEvaluation, saveEvaluation } from '../data/evals'
import {
  EVAL_GOOD_AVERAGE,
  EVAL_HARD_GATES,
  EVAL_ROW_COLUMNS,
  EVAL_RUBRIC_BANDS,
  EvalRubricColumn,
} from '../data/eval-rubric'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer, screenshotsContainer } from '../data/clients'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { evalScorePrompt } from '../services/prompts'
import { EVAL_SCORES_SCHEMA, WireEvalScores } from '../services/schemas'
import { nowIso } from '../shared/util'

// Scope Evaluation step (kind 'eval' / step 'run') — runs after a scope
// generation completes (enqueued by finalize; also on demand). The rubric is
// BUILT IN (data/eval-rubric.ts): the agent scores every rubric column
// band-by-band, results are computed per the verdict rule, and the finished
// evaluation is stored for the Scope Evaluations page (details view, SME
// input, CSV export). SME fields belong to the human — a re-evaluation
// refreshes the agent's cells but never touches them.

const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000
/** Launch no further Claude call past this point — checkpoint and re-enqueue instead. */
const EVAL_TIME_BUDGET_MS = 4.5 * 60 * 1000
/** Full lesson cards shown to the lesson-band call — stratified across units. */
const SAMPLE_LESSONS = 10
// Shared with reasoning (effort 'high' thinks long on big bands) — 16k has
// truncated a lesson band in production; keep real headroom.
const EVAL_MAX_TOKENS = 32000

/**
 * Stratified sample, round-robin across units: every unit contributes one
 * lesson before any unit contributes a second, and within a unit the picks
 * spread first → last → interior. With more units than `max` the trailing
 * units genuinely go unsampled — `unitsCovered` reports the truth so the
 * evidence note never overclaims coverage.
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

/**
 * The model must answer '1' | '2' | '3' (or Accurate/Inaccurate where the
 * rubric defines that scale). Verbal scale answers map to their digits —
 * every rubric spells its scale as "3 = Pass–Good … 1 = Fail", so a bare
 * "Fail" stored verbatim would dodge isFail/numericScore and publish an
 * agent-failed run as a pass on a smaller average denominator. Anything
 * unmappable fails loud.
 */
export function normalizeVerdict(raw: string, rubric: string): { verdict: string; extraNote: string } {
  const v = raw.trim()
  if (/^[123]$/.test(v)) return { verdict: v, extraNote: '' }
  const lead = /^([123])\b/.exec(v)
  if (lead) return { verdict: lead[1], extraNote: '' }
  const canon = v.toLowerCase().replace(/[–—]/g, '-').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  if (/^pass[ -]*good enough$/.test(canon) || /^good enough$/.test(canon)) return { verdict: '2', extraNote: '' }
  if (/^pass[ -]*good$/.test(canon) || /^good$/.test(canon)) return { verdict: '3', extraNote: '' }
  if (/^fail(ed)?$/.test(canon)) return { verdict: '1', extraNote: '' }
  if (/^(accurate|inaccurate)$/i.test(v) && rubric.toLowerCase().includes(v.toLowerCase())) {
    return { verdict: v[0].toUpperCase() + v.slice(1).toLowerCase(), extraNote: '' }
  }
  return {
    verdict: '1',
    extraNote: `unparseable verdict ${JSON.stringify(raw.slice(0, 40))} — treated as a fail; re-run the evaluation`,
  }
}

const numericScore = (v: string): number | undefined => {
  const n = Number(v.trim())
  return n === 1 || n === 2 || n === 3 ? n : undefined
}

const isFail = (v: string): boolean => v.trim() === '1' || /^inaccurate$/i.test(v.trim())

export async function evalRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const scopeId = msg.scopeId
  if (!scopeId) throw new Error('eval/run message missing scopeId')

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

  const lessonBand = EVAL_RUBRIC_BANDS.lesson
  const courseBand = EVAL_RUBRIC_BANDS.course

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = 3
    r.stagesDone = 0
    r.stage = 'Evaluating the scope against the built-in rubric'
    pushLog(r, `Rubric loaded: ${lessonBand.length + courseBand.length} rubric columns (built-in)`)
  })

  const started = Date.now()
  const bounded = (): { signal: AbortSignal; dispose: () => void } => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
    return { signal: controller.signal, dispose: () => clearTimeout(timer) }
  }

  // Band split: lesson-band rubrics score a stratified sample of full cards;
  // course-band rubrics score the whole course structure (compact skeleton of
  // every lesson) plus the standards digest, which Standard Coverage needs.
  const { lessons: sample, unitsCovered } = sampleLessons(scope.units, SAMPLE_LESSONS)
  const courseOverview = scope.units.map((u) => ({
    id: u.id,
    title: u.title,
    strand: u.strand,
    lessons: u.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      standards: l.fields.standards.content.split('\n')[0]?.slice(0, 120) ?? '',
    })),
  }))
  const treeDigest = flattenDigest(set)

  const scoreBand = async (
    bandName: string,
    columns: EvalRubricColumn[],
    evidence: Record<string, unknown>,
  ): Promise<EvalCell[]> => {
    if (columns.length === 0) return []
    const { signal, dispose } = bounded()
    try {
      const wire = await generateStructured<WireEvalScores>({
        ...evalScorePrompt(
          bandName,
          columns.map((c) => ({ heading: c.heading, rubric: c.rubric, hardGate: c.hardGate })),
          evidence,
        ),
        schema: EVAL_SCORES_SCHEMA,
        maxTokens: EVAL_MAX_TOKENS,
        effort: 'high',
        signal,
      })
      // Bind replies to columns by echoed heading; a column the model skipped
      // scores as a fail-loud '1', and an unparseable verdict normalizes or
      // fails loud — never a silent pass on a smaller denominator.
      const byHeading = new Map(wire.columns.map((c) => [c.heading.trim().toLowerCase(), c]))
      return columns.map((c) => {
        const hit = byHeading.get(c.heading.trim().toLowerCase())
        if (!hit) {
          return {
            heading: c.heading,
            verdict: '1',
            note: 'evaluation reply omitted this column — treated as a fail; re-run the evaluation',
          }
        }
        const { verdict, extraNote } = normalizeVerdict(hit.verdict, c.rubric)
        return {
          heading: c.heading,
          verdict,
          note: [hit.note.trim(), extraNote].filter(Boolean).join(' · '),
        }
      })
    } finally {
      dispose()
    }
  }

  // The lesson band checkpoints to a blob so the course band (or a retry)
  // never re-pays for it, and the step re-enqueues instead of letting the
  // second call race the execution deadline.
  const lessonBandPath = `jobs/${msg.jobId}/eval-lesson-band.json`
  let lessonCells = await getJsonOrUndefined<EvalCell[]>(dataContainer(), lessonBandPath)
  if (!lessonCells) {
    lessonCells = await scoreBand('Lesson-Specific Fields', lessonBand, {
      scope_request: scope.request,
      course_overview: courseOverview,
      sampled_lessons_full_cards: sample,
      sample_note: {
        note: `The ${sample.length} lessons above are a stratified sample of the scope's ${scope.units.reduce((n, u) => n + u.lessons.length, 0)} lessons, drawn from ${unitsCovered} of ${scope.units.length} units${
          unitsCovered < scope.units.length
            ? ' — the remaining units are NOT represented; judge only what you can see'
            : ' (every unit represented)'
        }.`,
      },
    })
    await putJson(dataContainer(), lessonBandPath, lessonCells)
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = 1
      pushLog(r, `Lesson-band rubrics scored (${lessonCells!.length} columns, ${sample.length}-lesson sample over ${unitsCovered}/${scope.units.length} units)`)
    })
    if (Date.now() - started > EVAL_TIME_BUDGET_MS) {
      await mutateJob(msg.jobId, (r) => pushLog(r, 'Time budget reached — the course band continues in a fresh execution'))
      await enqueueJob({ jobId: msg.jobId, kind: 'eval', step: 'run', scopeId })
      return
    }
  }

  const courseCells = await scoreBand('Course-Specific Fields', courseBand, {
    scope_request: scope.request,
    course_overview: courseOverview,
    standards_tree_digest: treeDigest,
    scope_decisions: (scope.qc ?? []).map((q) => ({ name: q.name, status: q.status, detail: q.detail.slice(0, 300) })),
  })
  await mutateJob(msg.jobId, (r) => {
    r.stagesDone = 2
    pushLog(r, `Course-band rubrics scored (${courseCells.length} columns)`)
  })

  // ---- Assemble the row: admin columns mechanically, rubric columns from
  // the agent, results per the verdict rule, SME columns never written ----
  const cells = [...lessonCells, ...courseCells]
  const cellByHeading = new Map(cells.map((c) => [c.heading.trim().toLowerCase(), c]))
  const numeric = cells.map((c) => numericScore(c.verdict)).filter((n): n is number => n !== undefined)
  const failCells = cells.filter((c) => isFail(c.verdict))
  const hardGateFails = EVAL_HARD_GATES.filter((c) => {
    const cell = cellByHeading.get(c.heading.trim().toLowerCase())
    return cell !== undefined && isFail(cell.verdict)
  }).map((c) => c.heading)
  const average = numeric.length > 0 ? numeric.reduce((a, b) => a + b, 0) / numeric.length : 0
  const averageScore = numeric.length > 0 ? average.toFixed(2) : ''
  const allGatesPass = EVAL_HARD_GATES.every(
    (c) => cellByHeading.get(c.heading.trim().toLowerCase())?.verdict.trim() === '3',
  )
  const autoVerdict =
    failCells.length > 0 ? 'FAIL' : allGatesPass && average >= EVAL_GOOD_AVERAGE ? 'PASS — GOOD' : 'PASS — GOOD ENOUGH'

  // The AI-QC Notes column explains the verdict, not just a defect dump: the
  // verdict line with the criterion it followed, every failed hard gate with
  // the agent's reasoning, other failing columns, then remaining flags.
  const noteOf = (heading: string): string => cellByHeading.get(heading.trim().toLowerCase())?.note ?? ''
  const verdictLine =
    failCells.length > 0
      ? `VERDICT: FAIL — ${failCells.length} of ${cells.length} rubric columns scored a failing mark${
          hardGateFails.length > 0
            ? `, including ${hardGateFails.length} hard gate${hardGateFails.length === 1 ? '' : 's'}`
            : ''
        }. Any column scored 1 fails the scope.`
      : allGatesPass && average >= EVAL_GOOD_AVERAGE
        ? `VERDICT: PASS — GOOD. Every hard gate scored 3 and the average ${averageScore} meets the ${EVAL_GOOD_AVERAGE.toFixed(2)} bar.`
        : `VERDICT: PASS — GOOD ENOUGH. No column failed, but ${
            allGatesPass
              ? `the average ${averageScore} falls short of the ${EVAL_GOOD_AVERAGE.toFixed(2)} bar for GOOD`
              : 'not every hard gate reached a 3'
          }.`
  const gateLines = hardGateFails.map((h) => `HARD GATE FAILED — ${h}: ${noteOf(h) || 'scored 1 against its rubric.'}`)
  const otherFailLines = failCells
    .filter((c) => !hardGateFails.some((h) => h.trim().toLowerCase() === c.heading.trim().toLowerCase()))
    .map((c) => `FAILED — ${c.heading}: ${c.note || 'scored 1 against its rubric.'}`)
  const flagLines = cells
    .filter((c) => !isFail(c.verdict) && c.note.length > 0)
    .map((c) => `${c.heading} (scored ${c.verdict}): ${c.note}`)
  const notes = [verdictLine, ...gateLines, ...otherFailLines, ...flagLines].join('\n')

  // Deletion race guard: DELETE /evals/{scopeId} flags this job
  // cancelRequested before removing the record — re-check here so a run
  // deleted mid-evaluation is not resurrected by the save below.
  const finalCheck = await getJob(msg.jobId)
  if (finalCheck.cancelRequested === true) {
    await mutateJob(msg.jobId, (r) => {
      r.status = 'cancelled'
      r.stage = 'Stopped'
      pushLog(r, 'Evaluation was deleted while running — results discarded')
    })
    return
  }

  // Host the scope document for the JSON column (anonymous-read container —
  // the same one that already serves item screenshots publicly).
  let jsonUrl = ''
  try {
    const path = `evals/${scopeId}.json`
    await putJson(screenshotsContainer(), path, scope)
    jsonUrl = `${screenshotsContainer().url}/${path}`
  } catch (e) {
    ctx.warn(`eval ${scopeId}: could not host the scope JSON — the column stays empty: ${String(e)}`)
  }

  // The stored row covers every non-SME column, in rubric order; `headings`
  // records the order the values were built against so the CSV export stays
  // correct even if the rubric changes in a later deploy.
  const values: string[] = EVAL_ROW_COLUMNS.map((col) => {
    if (col.role === 'rubric') return cellByHeading.get(col.heading.trim().toLowerCase())?.verdict ?? ''
    if (col.role === 'results') {
      if (/# of fails/i.test(col.heading)) return String(failCells.length)
      if (/hard gate/i.test(col.heading)) return hardGateFails.join(', ') || 'None'
      if (/average/i.test(col.heading)) return averageScore
      if (/verdict/i.test(col.heading)) return autoVerdict
      if (/notes/i.test(col.heading)) return notes || 'No defects noted.'
      return ''
    }
    // admin columns
    if (/date/i.test(col.heading)) return scope.updated || nowIso().slice(0, 10)
    if (/standard set/i.test(col.heading)) return set.name
    if (/course, standard, or topic/i.test(col.heading)) {
      return scope.request.mode === 'course' ? `Course: ${scope.title}` : `${scope.request.mode === 'standard' ? 'Standard' : 'Topic'}: ${scope.request.params}`
    }
    if (/json/i.test(col.heading)) return jsonUrl
    return ''
  })
  const headings = EVAL_ROW_COLUMNS.map((c) => c.heading)

  // A re-evaluation refreshes the agent's fields IN PLACE via the ETag
  // mutate, so a concurrent SME save can never be lost (and the SME fields +
  // created stamp survive untouched). Only a scope with no record at all
  // gets a fresh create.
  const now = nowIso()
  try {
    await mutateEvaluation(scopeId, (r) => {
      r.scopeTitle = scope.title
      r.values = values
      r.headings = headings
      r.cells = cells
      r.failCount = failCells.length
      r.hardGateFails = hardGateFails
      r.averageScore = averageScore
      r.autoVerdict = autoVerdict
      r.updated = now
      delete r.exportStatus
      delete r.exportError
    })
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e
    await saveEvaluation({
      scopeId,
      scopeTitle: scope.title,
      values,
      headings,
      cells,
      failCount: failCells.length,
      hardGateFails,
      averageScore,
      autoVerdict,
      created: now,
      updated: now,
    })
  }

  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stagesDone = r.totalStages
    r.stage = 'Complete'
    pushLog(
      r,
      `Evaluation complete: ${autoVerdict} (${failCells.length} fail${failCells.length === 1 ? '' : 's'}${
        hardGateFails.length > 0 ? `, hard gates: ${hardGateFails.join(', ')}` : ''
      }, avg ${averageScore})`,
    )
  })
}

function flattenDigest(set: { tree: { code: string; norm: string; wording?: string; children?: unknown[] }[] }): string[] {
  const out: string[] = []
  const walk = (nodes: { code: string; norm: string; wording?: string; children?: unknown[] }[]): void => {
    for (const n of nodes) {
      if (n.wording) out.push(`${n.code}: ${n.wording.slice(0, 160)}`)
      if (Array.isArray(n.children) && n.children.length > 0) walk(n.children as typeof nodes)
    }
  }
  walk(set.tree)
  return out
}
