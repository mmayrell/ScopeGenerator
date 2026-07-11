import { InvocationContext } from '@azure/functions'
import {
  JobMessage,
  LsgCourseLesson,
  VideoScript,
  VsgConflict,
  VsgLine,
  VsgRun,
  VsgSegment,
} from '../domain/types'
import { getLsgCourseOrUndefined } from '../data/lsg'
import { deleteVideoScriptDocs, getVideoScriptOrUndefined, getVsgRunOrUndefined, mutateVsgRun, saveVideoScript } from '../data/vsg'
import { getJob, mutateJob, pushLog } from '../data/jobs'
import { enqueueJob } from '../data/queue'
import { generateStructured } from '../services/claude'
import { videoDoctrineFor } from '../services/formats'
import { vsgScriptPrompt } from '../services/prompts'
import { VSG_SCRIPT_SCHEMA, WireVsgScript } from '../services/schemas'
import { newId, nowIso } from '../shared/util'

// Video Script Generator run step (kind 'vsg' / step 'run') — one Claude call
// per selected lesson, playbook-governed (see services/prompts vsgScriptPrompt
// and data/video-playbook). The RUN DOCUMENT is the checkpoint: each lesson's
// status advances pending → generating → complete | needs-reconciliation |
// failed, and a redelivered or re-enqueued message resumes exactly at the
// lessons still pending. Conflict handling is flag → propose → reconcile
// (playbook §2.4): a lesson whose inputs contradict pauses for THAT lesson
// only; the other lessons keep generating.

const TIME_BUDGET_MS = 4.5 * 60 * 1000
const EXECUTION_DEADLINE_MS = 8.5 * 60 * 1000
const SCRIPT_MAX_TOKENS = 40000
/** Per-lesson effort ladder on deadline cuts; the end marks the lesson failed. */
const EFFORT_LADDER = ['medium', 'low'] as const
/** A 'generating' claim older than this belongs to a host-killed execution — reclaimable. */
const CLAIM_STALE_MS = 12 * 60 * 1000
/**
 * Interaction cadence (rulebook TIM 04): target a student action every ~30s;
 * NEVER exceed 60 seconds — the 60s cap is the hard fail, the 30s target
 * surfaces as a review flag (line times are words-per-minute estimates).
 */
const MAX_INTERACTION_GAP_S = 60
const TARGET_INTERACTION_GAP_S = 30
/**
 * Rulebook GRADE table: typical lengths by band, in seconds. TYPICAL, not
 * caps (TIM 01 — sufficiency over clock): outside the band is a review flag.
 * Past MAX_SUFFICIENT_S (6:00) the lesson is a GRANULARITY signal back to the
 * scope (TIM 02) — flagged loudly, never compressed by the corrective pass.
 */
const BAND_TYPICAL_S: Record<string, [number, number]> = {
  'K-1': [60, 150],
  '2-3': [120, 210],
  '4-5': [150, 270],
  '6-8': [180, 300],
}
const MAX_SUFFICIENT_S = 360
/**
 * LANG 11 — internal vocabulary must never reach the student. Hard-fail terms
 * are unambiguous pipeline jargon. The stage labels are matched
 * CASE-SENSITIVELY — "What do we do next?" is the rulebook's own sanctioned
 * MCQ prompt and ordinary DI narration ("now we do the tens") is the
 * recommended voice; only the title-cased labels are jargon. Ambiguous words
 * that can be legitimate math/word-problem content ("atoms in a molecule",
 * "discrimination") surface as review flags instead.
 */
const BANNED_STUDENT_TERMS_CI = /\b(start cue|decision path)\b/i
const BANNED_STUDENT_TERMS_CS = /\b(I Do|We Do|You Do)\b/
const FLAGGED_STUDENT_TERMS = /\b(atoms?|discriminations?|interactions?|assessment boundary|difficulty ceiling|boundar(?:y|ies)|ceilings?)\b/i
/** INT 16 hard-fails a bare generic retry with no pointer. */
const GENERIC_TRY_AGAIN = /^\s*try again[.!]?\s*$/i

const isTruncation = (e: unknown): boolean =>
  /truncated \(max_tokens|max_tokens reached/i.test(e instanceof Error ? e.message : String(e))
const isAbort = (e: unknown): boolean =>
  /abort/i.test((e as { name?: string }).name ?? '') || /abort/i.test(e instanceof Error ? e.message : String(e))
const isRefusal = (e: unknown): boolean =>
  /declined this request/i.test(e instanceof Error ? e.message : String(e))

/** Playbook §7 grade bands. */
export function gradeBandOf(grade: string): string {
  const g = grade.trim().toUpperCase()
  if (/\bK\b/.test(g)) return 'K-1'
  const n = Number(/\d+/.exec(g)?.[0])
  if (!Number.isFinite(n)) return '4-5'
  if (n <= 1) return 'K-1'
  if (n <= 3) return '2-3'
  if (n <= 5) return '4-5'
  return '6-8'
}

function readCuts(msg: JobMessage): { cuts: number; cutLesson: string } {
  const raw = (msg.payload ?? {}) as { cuts?: unknown; cutLesson?: unknown }
  const cuts = Math.trunc(Number(raw.cuts ?? 0))
  return {
    cuts: Number.isFinite(cuts) && cuts > 0 ? cuts : 0,
    cutLesson: typeof raw.cutLesson === 'string' ? raw.cutLesson : '',
  }
}

export async function vsgRunStep(msg: JobMessage, ctx: InvocationContext): Promise<void> {
  const runId = msg.vsgRunId
  if (!runId) throw new Error('vsg/run message missing vsgRunId')

  const run = await getVsgRunOrUndefined(runId)
  if (!run) {
    await settleJobQuietly(msg.jobId, 'Run was deleted — nothing to do')
    return
  }
  if (run.status === 'complete' || run.status === 'failed') {
    await settleJobQuietly(msg.jobId, 'Run already settled — nothing to do')
    return
  }
  const course = await getLsgCourseOrUndefined(run.courseId)
  if (!course) {
    await mutateVsgRun(runId, (r) => {
      r.status = 'failed'
      r.error = `Course ${run.courseName} no longer exists in the registry`
      r.updated = nowIso()
    })
    await mutateJob(msg.jobId, (r) => {
      r.status = 'failed'
      r.error = `Course ${run.courseName} was deleted`
      pushLog(r, 'Run failed: the course was deleted from the registry')
    })
    return
  }

  const { cuts, cutLesson } = readCuts(msg)
  const started = Date.now()
  const bounded = (): { signal: AbortSignal; dispose: () => void } => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, started + EXECUTION_DEADLINE_MS - Date.now()))
    return { signal: controller.signal, dispose: () => clearTimeout(timer) }
  }
  const settledCount = (r: VsgRun): number =>
    r.lessons.filter((l) => l.status === 'complete' || l.status === 'failed' || l.status === 'needs-reconciliation').length

  await mutateJob(msg.jobId, (r) => {
    r.status = 'running'
    r.totalStages = run.lessons.length
    r.stagesDone = settledCount(run)
    r.stage = 'Writing video scripts'
  })

  let calls = 0
  for (const target of run.lessons) {
    // Fresh read before every paid call: reconcile/regenerate endpoints and
    // concurrent deliveries mutate the run between lessons.
    const current = await getVsgRunOrUndefined(runId)
    if (!current) {
      await settleJobQuietly(msg.jobId, 'Run was deleted — stopping')
      return
    }
    const lesson = current.lessons.find((l) => l.lessonId === target.lessonId)
    if (!lesson || (lesson.status !== 'pending' && lesson.status !== 'generating')) continue

    const job = await getJob(msg.jobId)
    if (job.cancelRequested === true) {
      await mutateJob(msg.jobId, (r) => {
        r.status = 'cancelled'
        r.stage = 'Stopped'
        pushLog(r, 'Stopped by user — finished scripts are kept')
      })
      return
    }
    if (calls > 0 && Date.now() - started > TIME_BUDGET_MS) {
      await mutateJob(msg.jobId, (r) => pushLog(r, `Time budget reached — continuing in a new execution (${settledCount(current)}/${current.lessons.length} lessons settled)`))
      // The cut-ladder state must survive the handoff — a re-opened earlier
      // lesson can push the cut lesson past the budget gate, and a bare
      // message would reset its effort ladder to the rung that already failed.
      await enqueueJob({
        jobId: msg.jobId,
        kind: 'vsg',
        step: 'run',
        vsgRunId: runId,
        ...(cutLesson ? { payload: { cuts, cutLesson } } : {}),
      })
      return
    }

    const card = course.lessons.find((l) => l.lessonId === lesson.lessonId && l.status === 'ACTIVE')
    if (!card) {
      await mutateVsgRun(runId, (r) => {
        const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
        if (l) {
          l.status = 'failed'
          l.error = 'Lesson is no longer active in the course registry'
        }
        r.updated = nowIso()
      })
      continue
    }

    // Exclusive claim (mutateVsgRun is ETag-serialized): 'pending' is free to
    // take; 'generating' is reclaimable only when its claim stamp is stale —
    // an orphan of a host-killed execution. A live concurrent delivery loses
    // the claim and skips, so a lesson is never double-generated.
    let claimed = false
    await mutateVsgRun(runId, (r) => {
      claimed = false
      const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
      if (!l) return
      const stale =
        l.status === 'generating' && (!l.claimedAt || Date.now() - Date.parse(l.claimedAt) > CLAIM_STALE_MS)
      if (l.status === 'pending' || stale) {
        l.status = 'generating'
        l.claimedAt = nowIso()
        claimed = true
      }
      r.updated = nowIso()
    })
    if (!claimed) continue

    const lessonCuts = cutLesson === lesson.lessonId ? cuts : 0
    const effort = EFFORT_LADDER[Math.min(lessonCuts, EFFORT_LADDER.length - 1)]
    const doctrine = videoDoctrineFor(
      {
        unitTitle: card.unitName,
        strand: '',
        lessonTitles: [card.lessonTitle],
        standardCodes: [card.standardId],
      },
      `${card.instructionalApproach} ${card.newLearning}`,
    )
    const gradeBand = gradeBandOf(run.grade)
    const resolutions = lesson.conflicts.filter((c) => c.resolution !== undefined && c.resolution !== '')

    const callOnce = (callEffort: 'medium' | 'low', maxTokens: number, signal: AbortSignal, repair?: string) => {
      const prompt = vsgScriptPrompt(
        { courseName: run.courseName, subject: run.subject, grade: run.grade, standardSet: run.standardSet },
        card,
        gradeBand,
        doctrine,
        run.steering,
        resolutions,
      )
      return generateStructured<WireVsgScript>({
        system: prompt.system,
        user: repair
          ? `${prompt.user}\n\nIMPORTANT — your previous script failed these HARD QA checks (rulebook §17, rule IDs cited): ${repair}. Fix every one and re-emit the complete corrected script. Never fix a length or cadence finding by cutting below the Transfer Test (TIM 09) — restructure instead.`
          : prompt.user,
        schema: VSG_SCRIPT_SCHEMA,
        maxTokens,
        effort: callEffort,
        signal,
      })
    }

    ctx.log(`vsg/run ${runId}: scripting ${lesson.lessonId} — ${card.lessonTitle}${lessonCuts > 0 ? ` (cut retry at ${effort})` : ''}`)
    const { signal, dispose } = bounded()
    let wire: WireVsgScript
    try {
      try {
        wire = await callOnce(effort, SCRIPT_MAX_TOKENS, signal)
      } catch (e) {
        if (isTruncation(e)) {
          // Reasoning shares the output budget — one rescue at low effort.
          wire = await callOnce('low', SCRIPT_MAX_TOKENS, signal)
        } else {
          throw e
        }
      }
      // Corrective pass: hard QA failures block a script (§17: "fails QA
      // automatically and gets regenerated to apply the feedback") — one
      // repair call with the failures named, rule IDs included; a second
      // failure ships visibly in qa.
      if (wire.conflicts.length === 0) {
        const fails = qaOf(wire, gradeBand).hardFails
        if (fails.length > 0) {
          ctx.warn(`vsg/run ${runId}: ${lesson.lessonId} hard QA fails (${fails.join(' | ')}) — one corrective pass`)
          try {
            const repaired = await callOnce(effort, SCRIPT_MAX_TOKENS, signal, fails.join('; '))
            if (repaired.conflicts.length > 0 || qaOf(repaired, gradeBand).hardFails.length < fails.length) wire = repaired
          } catch {
            /* keep the first script; its qa carries the failures */
          }
        }
      }
    } catch (e) {
      if (isAbort(e)) {
        // Terminal when the ladder's last rung (low) was the one cut — a
        // third identical low-effort attempt would repeat a call that just
        // proved it cannot fit (the worker's fail-fast rule).
        if (lessonCuts + 1 >= EFFORT_LADDER.length) {
          await mutateVsgRun(runId, (r) => {
            const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
            if (l) {
              l.status = 'failed'
              l.error = 'The scripting call did not fit the execution window even at low effort'
            }
            r.updated = nowIso()
          })
          await mutateJob(msg.jobId, (r) => pushLog(r, `${card.lessonTitle}: scripting ran long twice — lesson marked failed; the rest continue`))
          continue
        }
        await mutateJob(msg.jobId, (r) => pushLog(r, `${card.lessonTitle}: scripting ran long and was cut — retrying at ${EFFORT_LADDER[Math.min(lessonCuts + 1, EFFORT_LADDER.length - 1)]} effort in a fresh execution`))
        await enqueueJob({
          jobId: msg.jobId,
          kind: 'vsg',
          step: 'run',
          vsgRunId: runId,
          payload: { cuts: lessonCuts + 1, cutLesson: lesson.lessonId },
        })
        return
      }
      if (isRefusal(e) || isTruncation(e)) {
        // Deterministic for this lesson — fail it alone, keep the run going.
        await mutateVsgRun(runId, (r) => {
          const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
          if (l) {
            l.status = 'failed'
            l.error = e instanceof Error ? e.message : String(e)
          }
          r.updated = nowIso()
        })
        await mutateJob(msg.jobId, (r) => pushLog(r, `${card.lessonTitle}: scripting failed (${isRefusal(e) ? 'declined' : 'output overflow'}) — lesson marked failed; the rest continue`))
        continue
      }
      throw e
    } finally {
      dispose()
    }
    calls++

    if (wire.conflicts.length > 0) {
      // Flag → propose → reconcile: the lesson pauses; resolutions persist and
      // pre-fill regeneration. Conflicts matching an already-resolved one are
      // dropped (the model was told not to re-flag them).
      const resolvedKeys = new Set(resolutions.map((c) => `${c.kind}|${c.summary.slice(0, 60).toLowerCase()}`))
      const fresh = wire.conflicts
        .filter((c) => !resolvedKeys.has(`${c.kind}|${c.summary.slice(0, 60).toLowerCase()}`))
        .map((c) => ({ ...c, id: newId('conflict') }))
      await mutateVsgRun(runId, (r) => {
        const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
        if (l) {
          if (fresh.length > 0) {
            l.status = 'needs-reconciliation'
            l.conflicts = [...l.conflicts.filter((c) => c.resolution), ...fresh]
          } else {
            // Everything it flagged was already resolved — nothing actionable;
            // fail loudly rather than looping the same call forever.
            l.status = 'failed'
            l.error = 'Generation kept re-flagging conflicts that are already resolved — regenerate to retry'
          }
        }
        r.updated = nowIso()
      })
      await mutateJob(msg.jobId, (r) => {
        r.stagesDone = Math.min(r.stagesDone + 1, r.totalStages)
        pushLog(
          r,
          fresh.length > 0
            ? `${card.lessonTitle}: ${fresh.length} input conflict${fresh.length === 1 ? '' : 's'} flagged — needs reconciliation (a default resolution is proposed)`
            : `${card.lessonTitle}: generation re-flagged already-resolved conflicts — marked failed`,
        )
      })
      continue
    }

    const prior = await getVideoScriptOrUndefined(run.courseId, lesson.lessonId)
    const script = toVideoScript(wire, run, card, gradeBand, resolutions, (prior?.version ?? 0) + 1)
    await saveVideoScript(script)
    try {
      await mutateVsgRun(runId, (r) => {
        const l = r.lessons.find((x) => x.lessonId === lesson.lessonId)
        if (l) {
          l.status = 'complete'
          l.scriptVersion = script.version
          l.durationEstimate = script.durationEstimate
          delete l.error
        }
        r.updated = nowIso()
      })
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        // The run was permanently deleted while this script was being
        // written — the blob just saved must not outlive it (deletion means
        // gone from everywhere). The runId ownership guard keeps the blob if
        // another run already overwrote it.
        await deleteVideoScriptDocs(run.courseId, runId, [{ lessonId: lesson.lessonId, scriptVersion: script.version }])
        await settleJobQuietly(msg.jobId, 'Run was deleted — the in-flight script was discarded')
        return
      }
      throw e
    }
    await mutateJob(msg.jobId, (r) => {
      r.stagesDone = Math.min(r.stagesDone + 1, r.totalStages)
      pushLog(
        r,
        `${card.lessonTitle}: script v${script.version} — ${script.durationEstimate}, ${script.interactionCount} interactions${
          script.qa.hardFails.length > 0 ? `, ${script.qa.hardFails.length} UNRESOLVED HARD QA FAIL(S)` : ''
        }${script.formatRefs.length > 0 ? ` (${script.formatRefs.map((f) => f.split(' — ')[0]).join(', ')})` : ''}`,
      )
    })
  }

  // Settle. The status MUST be computed inside the mutate callback from the
  // freshly-read document — a reconcile/regenerate can re-open a lesson
  // between a pre-read and the write, and stamping a terminal status from
  // stale counts would strand that lesson at 'pending' with no queue message
  // (the ETag retry re-reads the doc but would re-apply the stale closure).
  let reopened = false
  let counts = { needsRec: 0, complete: 0, failed: 0 }
  let settled: VsgRun
  try {
    settled = await mutateVsgRun(runId, (r) => {
      const open = r.lessons.filter((l) => l.status === 'pending' || l.status === 'generating').length
      reopened = open > 0
      counts = {
        needsRec: r.lessons.filter((l) => l.status === 'needs-reconciliation').length,
        complete: r.lessons.filter((l) => l.status === 'complete').length,
        failed: r.lessons.filter((l) => l.status === 'failed').length,
      }
      if (reopened) {
        // Re-opened mid-settle — leave the run 'generating'; the enqueue
        // below hands the open lessons to a fresh execution.
        if (r.status !== 'generating') r.status = 'generating'
      } else {
        r.status = counts.needsRec > 0 ? 'needs-reconciliation' : counts.complete > 0 ? 'complete' : 'failed'
        if (r.status === 'failed') r.error = 'Every selected lesson failed to script'
      }
      r.updated = nowIso()
    })
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      await settleJobQuietly(msg.jobId, 'Run was deleted — stopping')
      return
    }
    throw e
  }
  if (reopened) {
    await mutateJob(msg.jobId, (r) => pushLog(r, 'Lessons were re-opened while settling — continuing in a fresh execution'))
    await enqueueJob({
      jobId: msg.jobId,
      kind: 'vsg',
      step: 'run',
      vsgRunId: runId,
      ...(cutLesson ? { payload: { cuts, cutLesson } } : {}),
    })
    return
  }
  void settled
  await mutateJob(msg.jobId, (r) => {
    r.status = 'complete'
    r.stage = 'Complete'
    r.stagesDone = r.totalStages
    pushLog(
      r,
      `Run settled: ${counts.complete} script${counts.complete === 1 ? '' : 's'} written` +
        (counts.needsRec > 0 ? `, ${counts.needsRec} lesson${counts.needsRec === 1 ? '' : 's'} awaiting reconciliation` : '') +
        (counts.failed > 0 ? `, ${counts.failed} failed` : ''),
    )
  })
}

/**
 * Programmatic §12 QA on the wire reply (the model self-QCs too — this is the
 * code-level backstop). Hard limits are re-derived from the script's own
 * timing data, never trusted from the self-reported estimate alone.
 */
function qaOf(wire: WireVsgScript, gradeBand: string): { hardFails: string[]; flags: string[] } {
  const fails: string[] = [...(wire.qa?.hardFails ?? [])]
  const flags: string[] = []
  const fmt = (secs: number): string => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  // Total length (TIM 01 — sufficiency over clock; length is an OUTPUT): the
  // segments' own end stamps are AUTHORITATIVE. durationEstimate only stands
  // in when no segment carries a parseable end, and a large disagreement is
  // surfaced — an inflated estimate must never manufacture a phantom tail
  // gap or a false out-of-band finding.
  const segEnds = wire.segments.map((s) => parseTime(s.end)).filter((n): n is number => n !== undefined)
  const estimateSecs = parseTime(wire.durationEstimate)
  const totalSecs = segEnds.length > 0 ? Math.max(...segEnds) : (estimateSecs ?? 0)
  if (segEnds.length > 0 && estimateSecs !== undefined && Math.abs(estimateSecs - totalSecs) > 30) {
    flags.push(`durationEstimate ${fmt(estimateSecs)} disagrees with the segment stamps (${fmt(totalSecs)}) — the stamps are the production contract`)
  }
  const typical = BAND_TYPICAL_S[gradeBand]
  if (totalSecs > MAX_SUFFICIENT_S) {
    // Deliberately a FLAG, not a hard fail: TIM 02 forbids compressing
    // teaching to dodge it — the corrective pass must never trim below the
    // Transfer Test. This is a granularity signal back to the scope.
    flags.push(`GRANULARITY SIGNAL (TIM 02): the lesson needs ${fmt(totalSecs)} — more than 6:00 means the atom is too big for one video; flag back to the scope, never compress`)
  } else if (typical && totalSecs > 0 && (totalSecs < typical[0] || totalSecs > typical[1])) {
    flags.push(`run time ${fmt(totalSecs)} is outside the ${gradeBand} typical band ${fmt(typical[0])}-${fmt(typical[1])} (GRADE/TIM 01) — fine when the Transfer Test justifies it`)
  }
  const interactions = wire.segments.reduce((n, s) => n + s.interactions.length, 0)
  if (interactions < 3) fails.push(`${interactions} interaction(s) — TIM 05 requires at least 3 per video`)
  const perMinuteCap = Math.ceil((Math.max(totalSecs, 60) / 60) * 3) + 1
  if (interactions > perMinuteCap) {
    flags.push(`${interactions} interactions in ${fmt(totalSecs)} — past the ~2-3/minute guidance (TIM 05); verify the learner keeps the thread`)
  }
  // Skeleton structure (§15): opening first, wrap last, model before any
  // guided ask (SEQ 02's structural face: no we-do before the first i-do).
  const kinds = wire.segments.map((s) => s.kind)
  if (kinds.length > 0 && kinds[0] !== 'opening') fails.push(`the first segment is "${kinds[0]}" — the skeleton (§15) opens with the opening segment`)
  if (kinds.length > 0 && kinds[kinds.length - 1] !== 'wrap') flags.push(`the last segment is "${kinds[kinds.length - 1]}" — the skeleton (§15) closes with the wrap`)
  const firstIDo = kinds.indexOf('i-do')
  const firstWeDo = kinds.indexOf('we-do')
  if (firstIDo === -1) fails.push('no i-do segment — the model comes first (SEQ 02, §15)')
  if (firstWeDo !== -1 && firstIDo !== -1 && firstWeDo < firstIDo) {
    fails.push('a we-do segment precedes the first i-do — model before any ask (SEQ 02)')
  }
  const opening = wire.segments.find((s) => s.kind === 'opening')
  if (opening && opening.interactions.length > 1) {
    flags.push(`the opening carries ${opening.interactions.length} interactions — INT 02 allows 0-1 (preskill retrieval only)`)
  }
  // Transfer Test + coverage note (SEQ 08-SEQ 10) — both hard gates (§17).
  const tt = wire.transferTest
  if (!tt || !tt.stepsDemonstrated || !tt.caseClassesShown || !tt.decisionsPerformed) {
    const missing = [
      !tt?.stepsDemonstrated ? 'steps demonstrated' : '',
      !tt?.caseClassesShown ? 'case classes shown' : '',
      !tt?.decisionsPerformed ? 'decisions performed by the student' : '',
    ].filter(Boolean)
    fails.push(`Transfer Test does not pass (SEQ 08/SEQ 09): ${missing.join(', ')}${tt?.note ? ` — ${tt.note}` : ''}`)
  }
  if (!Array.isArray(wire.coverageNote) || wire.coverageNote.length === 0) {
    fails.push('coverage note is empty (SEQ 10): list every case class as taught or deferred — deferrals are named, never silent')
  } else {
    for (const c of wire.coverageNote) {
      if (c.status === 'deferred' && c.where.trim().length === 0) {
        fails.push(`coverage note: deferred case class "${c.name}" names no downstream home (SEQ 10)`)
      }
    }
  }
  // Feedback ladders (INT 16-INT 18, INT 23) — complete on every interaction.
  for (const s of wire.segments) {
    for (const i of s.interactions) {
      const gaps = [
        i.correctFeedback.trim() === '' ? 'correct feedback' : '',
        i.try1Hint.trim() === '' ? 'try-1 hint' : '',
        i.try2ShowAndMoveOn.trim() === '' ? 'try-2 show-and-resume' : '',
        i.resumeState.trim() === '' ? 'resume state' : '',
      ].filter(Boolean)
      if (gaps.length > 0) fails.push(`an interaction in ${s.kind} is missing ${gaps.join(', ')} (INT 16-INT 18, INT 23)`)
      if ([i.correctFeedback, i.try1Hint, i.try2ShowAndMoveOn].some((f) => GENERIC_TRY_AGAIN.test(f))) {
        fails.push(`generic "Try again!" feedback in ${s.kind} — feedback is specific with a pointer (INT 16)`)
      }
    }
  }
  const mcqs = wire.segments.reduce((n, s) => n + s.interactions.filter((i) => i.type === 'mcq').length, 0)
  if (interactions > 0 && mcqs * 2 > interactions) {
    flags.push(`${mcqs} of ${interactions} interactions are MCQ — INT 04 makes direct production the default; verify each MCQ is a genuine choice`)
  }
  // LANG 11 — internal vocabulary in student-facing text (narration, on-screen
  // text, prompts, feedback). NOTE lines are production-facing and exempt.
  const studentTexts: string[] = []
  for (const s of wire.segments) {
    for (const l of s.lines) if (l.channel === 'SAY' || l.channel === 'TEXT') studentTexts.push(l.content)
    for (const i of s.interactions) {
      studentTexts.push(i.prompt, i.correctFeedback, i.try1Hint, i.try2ShowAndMoveOn, ...i.options)
    }
  }
  const banned = new Set<string>()
  const soft = new Set<string>()
  for (const t of studentTexts) {
    const hard = BANNED_STUDENT_TERMS_CI.exec(t) ?? BANNED_STUDENT_TERMS_CS.exec(t)
    if (hard) banned.add(hard[1])
    const flagged = FLAGGED_STUDENT_TERMS.exec(t)
    if (flagged) soft.add(flagged[1].toLowerCase())
  }
  if (banned.size > 0) {
    fails.push(`internal vocabulary reaches the student (LANG 11): ${[...banned].join(', ')} — translate to student terms`)
  }
  if (soft.size > 0) {
    flags.push(`possible internal vocabulary in student-facing text (LANG 11): ${[...soft].join(', ')} — verify these read as math, not pipeline jargon`)
  }
  for (const s of wire.segments) {
    const lineCount = s.lines.filter((l) => l.channel === 'INTERACTION').length
    if (lineCount !== s.interactions.length) {
      fails.push(`segment ${s.kind}: ${lineCount} INTERACTION line(s) but ${s.interactions.length} interaction object(s)`)
    }
  }
  // Interaction cadence from the per-line stamps (TIM 04: target every ~30s,
  // never more than 60 seconds without a student action).
  const stamps: number[] = []
  let unstamped = 0
  for (const s of wire.segments) {
    for (const l of s.lines) {
      if (l.channel !== 'INTERACTION') continue
      const t = parseTime(l.time)
      if (t === undefined) unstamped++
      else stamps.push(t)
    }
  }
  if (unstamped > 0) {
    flags.push(`${unstamped} INTERACTION line(s) carry no parseable "M:SS" time — the TIM 04 cadence could not be fully verified`)
  }
  if (stamps.length > 0 && totalSecs > 0) {
    stamps.sort((a, b) => a - b)
    let last = 0
    let worst = 0
    for (const t of stamps) {
      worst = Math.max(worst, t - last)
      last = t
    }
    worst = Math.max(worst, totalSecs - last)
    if (worst > MAX_INTERACTION_GAP_S) {
      // An unparseable stamp means an interaction may sit INSIDE the apparent
      // gap — a hard fail on that evidence would burn the corrective pass on
      // a possibly compliant script. Fail hard only on fully-stamped scripts.
      if (unstamped === 0) {
        fails.push(`${worst} seconds without a student action — TIM 04 never allows more than 60s (target every ~30s)`)
      } else {
        flags.push(`apparent ${worst}s stretch without a student action (TIM 04) — but ${unstamped} interaction stamp(s) were unparseable, so the gap is unverified`)
      }
    } else if (worst > TARGET_INTERACTION_GAP_S) {
      flags.push(`longest stretch without a student action is ${worst}s — past the ~30s target (TIM 04), inside the 60s cap`)
    }
  }
  return { hardFails: fails, flags: [...flags, ...(wire.qa?.flags ?? [])] }
}

const parseTime = (t: string): number | undefined => {
  const m = /^(\d+):(\d{2})$/.exec(t.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

/** Wire → domain: zip each segment's interaction objects onto its INTERACTION lines by order. */
function toVideoScript(
  wire: WireVsgScript,
  run: VsgRun,
  card: LsgCourseLesson,
  gradeBand: string,
  resolutions: VsgConflict[],
  version: number,
): VideoScript {
  const segments: VsgSegment[] = wire.segments.map((s) => {
    let next = 0
    const lines: VsgLine[] = s.lines.map((l) => {
      const base: VsgLine = { channel: l.channel, content: l.content, ...(l.time ? { time: l.time } : {}) }
      if (l.channel === 'INTERACTION' && next < s.interactions.length) {
        return { ...base, interaction: s.interactions[next++] }
      }
      return base
    })
    // Leftover interaction objects (more objects than INTERACTION lines) still
    // ship — appended as their own lines so no authored interaction is lost.
    for (; next < s.interactions.length; next++) {
      lines.push({
        channel: 'INTERACTION',
        content: `${s.interactions[next].type} interaction`,
        interaction: s.interactions[next],
      })
    }
    return { kind: s.kind, start: s.start, end: s.end, purpose: s.purpose, lines }
  })
  return {
    courseId: run.courseId,
    lessonId: card.lessonId,
    runId: run.id,
    lessonTitle: card.lessonTitle,
    unitName: card.unitName,
    standardId: card.standardId,
    gradeBand,
    durationEstimate: wire.durationEstimate,
    segments,
    interactionCount: segments.reduce((n, s) => n + s.lines.filter((l) => l.interaction).length, 0),
    formatRefs: wire.formatRefs,
    coverageNote: wire.coverageNote ?? [],
    transferTest: wire.transferTest,
    qa: qaOf(wire, gradeBand),
    conflictsResolved: resolutions,
    playbookVersion: run.playbookVersion,
    doctrineVersion: run.doctrineVersion,
    version,
    created: nowIso(),
  }
}

/** Settles a job row whose work turned out to be moot — never poison the message. */
async function settleJobQuietly(jobId: string, detail: string): Promise<void> {
  await mutateJob(jobId, (r) => {
    if (r.status === 'queued' || r.status === 'running') {
      r.status = 'complete'
      r.stage = 'Complete'
      r.stagesDone = r.totalStages
    }
    pushLog(r, detail)
  })
}
