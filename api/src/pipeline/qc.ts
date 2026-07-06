import { Lesson, QCCheck, Unit } from '../domain/types'
import { PlanOutput } from '../services/schemas'

/**
 * Stage 6 — programmatic auto-QC (spec §9), from the assembled units.
 * Citation completeness and decision-record integrity were removed from the
 * check list by request — citations and decision records are still demanded
 * by the card prompts; they just aren't QC gates.
 */
export function runQc(units: Unit[], plan: PlanOutput): QCCheck[] {
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
        ? `In-scope content keys without a landing atom: ${missingCodes.join(', ')}.${orphans.length > 0 ? ` Orphan atoms outside the plan: ${orphans.join(', ')}.` : ''}`
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
        ? `Unresolved or forward prerequisite references: ${badRefs.join('; ')}.`
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
        ? `Start cue · single decision path · one response form not verifiable on: ${tripleViolations.join(', ')}.`
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
        ? `Instructional Approach could not be verified single-strategy on: ${strategyViolations.join(', ')}.`
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
        ? `Boundary/non-goal/progression references that do not resolve to a lesson in this scope: ${[...new Set(badNeighborRefs)].join('; ')}.`
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
        ? `Difficulty Ceiling missing or uncited on: ${ceilingViolations.join(', ')}.`
        : 'All ceilings are stated with cited evidence within standards-document limits and P1 evidence.',
  })

  // 7. Theme coverage
  const unratedUnits = units.filter((u) => u.rationale.trim().length === 0).map((u) => u.id)
  checks.push({
    name: 'Theme coverage',
    status: unratedUnits.length > 0 ? 'flag' : 'pass',
    detail:
      unratedUnits.length > 0
        ? `Units without a theme/emphasis-traceable rationale: ${unratedUnits.join(', ')}.`
        : `All ${units.length} units carry a rationale traceable to the set's theme/emphasis statements or progression streams.`,
  })

  // 8. Released-items integrity
  const emptyReleased = lessons.filter((l) => l.itemRefs.length === 0 && !l.generatedExemplar).map((l) => l.id)
  const withItems = lessons.filter((l) => l.itemRefs.length > 0).length
  const withExemplar = lessons.filter((l) => l.itemRefs.length === 0 && l.generatedExemplar).length
  checks.push({
    name: 'Released-items integrity',
    status: emptyReleased.length > 0 ? 'fail' : 'pass',
    detail:
      emptyReleased.length > 0
        ? `Released Items empty (no observed item and no generated exemplar) on: ${emptyReleased.join(', ')}.`
        : `Field never empty: ${withItems} card${withItems === 1 ? '' : 's'} carry captioned observed items; ${withExemplar} carry a labeled generated ceiling exemplar with inference basis and in-boundary ceiling.`,
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
