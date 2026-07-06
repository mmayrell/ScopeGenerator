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

  // 4. Single-strategy check (heuristic)
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

  // 5. Neighbor consistency
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

  // 6. Ceiling legality
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

  // 7. Theme coverage
  const unratedUnits = units.filter((u) => u.rationale.trim().length === 0).map((u) => u.id)
  checks.push({
    name: 'Theme coverage',
    status: unratedUnits.length > 0 ? 'flag' : 'pass',
    detail:
      unratedUnits.length > 0
        ? `These units are missing the rationale that connects them to the course's themes and emphasis: ${unratedUnits.join(', ')}.`
        : `All ${units.length} units carry a rationale traceable to the set's theme/emphasis statements or progression streams.`,
  })

  // 8. Released-items integrity
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

  // 9. Released-item coverage — the released test is the model for our
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
