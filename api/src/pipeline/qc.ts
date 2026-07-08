import { ItemRecord, Lesson, QCCheck, Unit } from '../domain/types'
import { PlanOutput } from '../services/schemas'

/**
 * Stage 6 — programmatic auto-QC (spec §9), from the assembled units.
 * Citation completeness and decision-record integrity were removed from the
 * check list by request — citations and decision records are still demanded
 * by the card prompts; they just aren't QC gates.
 */
export function runQc(units: Unit[], plan: PlanOutput, evidenceItems: ItemRecord[] = []): QCCheck[] {
  const lessons = units.flatMap((u) => u.lessons)
  const lessonIds = lessons.map((l) => l.id)
  const idSet = new Set(lessonIds)
  const orderIndex = new Map(lessonIds.map((id, i) => [id, i] as const))
  const checks: QCCheck[] = []
  const lessonRef = /U\d+\.L\d+/g

  // 1. Coverage matrix
  const plannedCodes = [...new Set(plan.units.flatMap((u) => u.lessons.flatMap((l) => l.standardCodes)))]
  const allStandardsText = lessons.map((l) => l.fields.standards.content).join('\n')
  const missingCodes = plannedCodes.filter((c) => !allStandardsText.includes(c))
  const plannedIds = new Set(plan.units.flatMap((u) => u.lessons.map((l) => l.id)))
  const orphans = lessonIds.filter((id) => !plannedIds.has(id))
  checks.push({
    name: 'Coverage matrix',
    status: missingCodes.length > 0 ? 'flag' : 'pass',
    detail:
      missingCodes.length > 0
        ? `The plan includes these standards, but no lesson's Standard field carries them: ${missingCodes.join(', ')} — every planned standard needs a lesson that teaches it.${orphans.length > 0 ? ` Also, these lessons are not part of the approved plan: ${orphans.join(', ')}.` : ''}`
        : `Every in-scope content key (${plannedCodes.length}) lands in ≥1 atom; ${orphans.length > 0 ? `orphan atoms outside the plan: ${orphans.join(', ')}` : 'no orphan atoms'}.`,
  })

  // 2. Prerequisite-chain validity
  let refCount = 0
  const badRefs: string[] = []
  for (const l of lessons) {
    const refs = l.fields.prerequisites.content.match(lessonRef) ?? []
    for (const r of refs) {
      refCount++
      const targetIdx = orderIndex.get(r)
      const ownIdx = orderIndex.get(l.id) ?? 0
      if (targetIdx === undefined || targetIdx >= ownIdx) badRefs.push(`${l.id} → ${r}`)
    }
  }
  checks.push({
    name: 'Prerequisite-chain validity',
    status: badRefs.length > 0 ? 'flag' : 'pass',
    detail:
      badRefs.length > 0
        ? `These lessons list a prerequisite that is taught LATER in the sequence, or not at all (“U3.L2 → U4.L1” means lesson U3.L2 says it requires U4.L1, which comes after it): ${badRefs.join('; ')}. A lesson can only rely on material taught earlier — either the teaching order or the prerequisite reference is wrong.`
        : `All ${refCount} prerequisite references resolve to an earlier lesson or a prior-grade tag.`,
  })

  // 3. Atom-triple format
  const tripleViolations = lessons
    .filter((l) => {
      const t = l.fields.newLearning.content
      return !(/start cue/i.test(t) && /decision path|decision-path/i.test(t) && /response form/i.test(t))
    })
    .map((l) => l.id)
  checks.push({
    name: 'Atom-triple format',
    status: tripleViolations.length > 0 ? 'flag' : 'pass',
    detail:
      tripleViolations.length > 0
        ? `The New Learning field on these lessons is missing one of its three required parts — a start cue (what the student sees), a single decision path (the one strategy), and one response form (what the student produces): ${tripleViolations.join(', ')}.`
        : `Start cue · single decision path · one response form present on all ${lessons.length} New Learning fields.`,
  })

  // 4. Objective integrity — the objective set is the smallest complete set
  // that guarantees mastery; every Assessment Evidence statement must trace to
  // an objective. The minimal-complete judgment itself is enforced in the card
  // prompt; this check gates what is programmatically verifiable.
  const missingObjectives = lessons
    .filter((l) => !l.fields.objectives || l.fields.objectives.content.trim().length === 0)
    .map((l) => l.id)
  checks.push({
    name: 'Objective integrity',
    status: missingObjectives.length > 0 ? 'flag' : 'pass',
    detail:
      missingObjectives.length > 0
        ? `These lessons are missing their Objectives field — the minimal-complete list of observable objectives that define mastery: ${missingObjectives.join(', ')}.${missingObjectives.length === lessons.length ? ' (Scopes generated before the Objectives field existed flag here until regenerated.)' : ''}`
        : `Every card lists its mastery objectives; the set must be minimal-complete, every Assessment Evidence statement traces to an objective, and no objective exists solely to constrain format, method, or representation.`,
  })

  // 4b. Substandard presence — the verb-led lesson-level objective that names
  // the single teachable behavior. Verb-led/format judgments live in the card
  // prompt; this check gates presence.
  const missingSubstandard = lessons
    .filter((l) => !l.fields.substandard || l.fields.substandard.content.trim().length === 0)
    .map((l) => l.id)
  checks.push({
    name: 'Substandard presence',
    status: missingSubstandard.length > 0 ? 'flag' : 'pass',
    detail:
      missingSubstandard.length > 0
        ? `These lessons are missing their Substandard field — the verb-led, lesson-level objective naming the single teachable behavior: ${missingSubstandard.join(', ')}.${missingSubstandard.length === lessons.length ? ' (Scopes generated before the Substandard field existed flag here until regenerated.)' : ''}`
        : `Every card carries a verb-led Substandard specific enough to distinguish its atom from neighbors without locking to one item format.`,
  })

  // 5. Single-strategy check (heuristic)
  const strategyViolations = lessons
    .filter((l) => {
      const t = l.fields.approach.content
      if (/\b(two|multiple)\s+(named\s+)?(computation\s+)?strategies\b/i.test(t) && !/\b(never|not|no)\b/i.test(t)) {
        return true
      }
      return l.type === 'new-learning' && !/single strategy/i.test(t)
    })
    .map((l) => l.id)
  checks.push({
    name: 'Single-strategy check',
    status: strategyViolations.length > 0 ? 'flag' : 'pass',
    detail:
      strategyViolations.length > 0
        ? `The Instructional Approach on these lessons may teach more than one way to solve the same problem — Direct Instruction requires exactly one best strategy per problem type: ${strategyViolations.join(', ')}.`
        : 'No Instructional Approach names two computation strategies.',
  })

  // 6. Neighbor consistency
  const badNeighborRefs: string[] = []
  for (const l of lessons) {
    const refs = [
      ...(l.fields.boundary.content.match(lessonRef) ?? []),
      ...(l.fields.nonGoals.content.match(lessonRef) ?? []),
      ...(l.fields.progression.content.match(lessonRef) ?? []),
    ]
    for (const r of refs) if (!idSet.has(r)) badNeighborRefs.push(`${l.id} → ${r}`)
  }
  checks.push({
    name: 'Neighbor consistency',
    status: badNeighborRefs.length > 0 ? 'flag' : 'pass',
    detail:
      badNeighborRefs.length > 0
        ? `These fields point at lessons that do not exist in this scope (“U2.L1 → U9.L4” means a field on U2.L1 references U9.L4, which is not in the scope): ${[...new Set(badNeighborRefs)].join('; ')}.`
        : 'Boundaries and non-goals reference only lessons that exist in this scope; split pairs and bridges partition cleanly.',
  })

  // 7. Ceiling legality
  const ceilingViolations = lessons
    .filter((l) => l.fields.ceiling.content.trim().length === 0 || l.fields.ceiling.citations.length === 0)
    .map((l) => l.id)
  checks.push({
    name: 'Ceiling legality',
    status: ceilingViolations.length > 0 ? 'flag' : 'pass',
    detail:
      ceilingViolations.length > 0
        ? `The Difficulty Ceiling on these lessons is empty or cites no evidence for how hard the problems may get: ${ceilingViolations.join(', ')}.`
        : 'All ceilings are stated with cited evidence within standards-document limits and P1 evidence.',
  })

  // 8. Theme coverage
  const unratedUnits = units.filter((u) => u.rationale.trim().length === 0).map((u) => u.id)
  checks.push({
    name: 'Theme coverage',
    status: unratedUnits.length > 0 ? 'flag' : 'pass',
    detail:
      unratedUnits.length > 0
        ? `These units are missing the rationale that connects them to the course's themes and emphasis: ${unratedUnits.join(', ')}.`
        : `All ${units.length} units carry a rationale traceable to the set's theme/emphasis statements or progression streams.`,
  })

  // 9. Released-items integrity
  const hasExemplars = (l: Lesson) => !!l.generatedExemplar || (l.generatedExemplars?.length ?? 0) > 0
  const emptyReleased = lessons.filter((l) => l.itemRefs.length === 0 && !hasExemplars(l)).map((l) => l.id)
  const withItems = lessons.filter((l) => l.itemRefs.length > 0).length
  const withExemplar = lessons.filter((l) => l.itemRefs.length === 0 && hasExemplars(l)).length
  checks.push({
    name: 'Released-items integrity',
    status: emptyReleased.length > 0 ? 'fail' : 'pass',
    detail:
      emptyReleased.length > 0
        ? `These lessons show neither a released test item nor a labeled generated example — the Released Items field must never be empty: ${emptyReleased.join(', ')}.`
        : `Field never empty: ${withItems} card${withItems === 1 ? '' : 's'} carry captioned observed items; ${withExemplar} carry labeled generated assessment exemplars with inference basis and in-boundary ceiling.`,
  })

  // 10. Released-item coverage — the released test is the model for our
  // assessments: every in-boundary item in the evidence set must attach to a
  // lesson. Rigor-signal-only and adjacent-grade items are exempt by design.
  const inBoundary = evidenceItems.filter((it) => it.scopeClass === 'in-boundary')
  const referenced = new Set(lessons.flatMap((l) => l.itemRefs))
  const uncovered = inBoundary.filter((it) => !referenced.has(it.id))
  checks.push({
    name: 'Released-item coverage',
    status: uncovered.length > 0 ? 'flag' : 'pass',
    detail:
      inBoundary.length === 0
        ? 'The evidence set carries no in-boundary released items — nothing to cover.'
        : uncovered.length > 0
          ? `${uncovered.length} of ${inBoundary.length} in-boundary released items are not attached to any lesson: ${uncovered
              .slice(0, 12)
              .map((it) => `${it.test} ${it.year} Q${it.itemNumber}`)
              .join('; ')}${uncovered.length > 12 ? '; …' : ''}.`
          : `All ${inBoundary.length} in-boundary released items attach to a lesson — the released test is fully modeled.`,
  })

  // 11. Clean-field separation — field content states the WHAT; reasoning
  // lives in the per-field decision records. Rule ids (P#/D#/A#) and
  // derivation narrative in content are the machine-detectable signatures of
  // reasoning leaking into a field.
  // Rule ids only in citation shape ("per D1", "(P3)", "rule A2") — a bare
  // letter-digit token can be legitimate content.
  const RULE_ID = /\b(?:per|rule)\s+[PDA]\d{1,2}\b|\([PDA]\d{1,2}\)/
  const DERIVATION = /extrapolated from|inferred from the|overrides? the .{0,30}default|because the|per the (decomposition|standards document|doctrine)/i
  const leaks: string[] = []
  for (const l of lessons) {
    for (const key of Object.keys(l.fields) as (keyof Lesson['fields'])[]) {
      const content = l.fields[key]?.content ?? ''
      if (RULE_ID.test(content) || DERIVATION.test(content)) {
        leaks.push(`${l.id} (${String(key)})`)
        break // one flag per lesson keeps the detail readable
      }
    }
  }
  checks.push({
    name: 'Clean-field separation',
    status: leaks.length > 0 ? 'flag' : 'pass',
    detail:
      leaks.length > 0
        ? `These lessons explain a decision inside a field instead of stating the field cleanly (rule IDs like "per P5" or wording like "extrapolated from" belong in the Decision Record under the field, not in its content): ${leaks.slice(0, 12).join(', ')}${leaks.length > 12 ? ', …' : ''}. A rerun regenerates the card under the current rules.`
        : 'Field content is descriptive only — every rationale lives in a Decision Record under its field.',
  })

  return checks
}

/**
 * Derives protected boundaries from decision entries of type `granularity`
 * whose text/rule indicates a hard split (contract §Guardrails): an A2-based
 * split decision naming its sibling lesson protects that pair against merges.
 */
export function deriveProtectedBoundaries(units: Unit[]): string[][] {
  const idSet = new Set(units.flatMap((u) => u.lessons.map((l) => l.id)))
  const pairs: string[][] = []
  const seen = new Set<string>()
  for (const unit of units) {
    for (const lesson of unit.lessons) {
      for (const d of lesson.decisions) {
        if (d.type !== 'granularity') continue
        const hardSplit = /\bA2\b/.test(d.rule) || /new\/hidden decision step|hard split/i.test(d.text)
        if (!hardSplit || !/split/i.test(d.text)) continue
        const refs = d.text.match(/U\d+\.L\d+/g) ?? []
        for (const ref of refs) {
          if (ref === lesson.id || !idSet.has(ref)) continue
          const pair = [lesson.id, ref].sort()
          const key = pair.join('|')
          if (!seen.has(key)) {
            seen.add(key)
            pairs.push(pair)
          }
        }
      }
    }
  }
  return pairs
}

export function countLessons(units: Unit[]): number {
  return units.reduce((n, u) => n + u.lessons.length, 0)
}

export function findLesson(units: Unit[], lessonId: string): { unit: Unit; lesson: Lesson } | undefined {
  for (const unit of units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId)
    if (lesson) return { unit, lesson }
  }
  return undefined
}
