import { CoherenceWeb, Lesson, QCCheck, Unit, WebEdge, WebNode } from '../domain/types'
import { PlanOutput } from '../services/schemas'

/**
 * Coherence-web construction (Atomization Guide, Part IV — the Web
 * Construction Algorithm). Webs are RENDERINGS OF THE LEDGER, never a second
 * source of truth: the plan stage extracts each lesson's direct dependencies
 * (`dependsOn`, edge rules §21.2) and each unit's M(0) prerequisite nodes and
 * grade-progression topics; this module deterministically assembles the three
 * tiers from that extraction plus the finished units:
 *
 *   Tier 1 — one atom web per unit (lessons + M(0) nodes, direct edges)
 *   Tier 2 — the unit web (Lift Rule: cross-unit consumptions, labeled edges,
 *            no transitive edges)
 *   Tier 3 — the grade progression web (topic level: prior-grade feed →
 *            this unit's topic → next-grade consumer)
 *
 * All output is sanitized into a DAG: unknown endpoints, self-edges, and
 * forward (order-violating) edges are dropped and reported as QC flags.
 */

const TYPE_LABEL: Record<string, string> = {
  preskill: 'Preskill',
  'new-learning': 'New Learning',
  representation: 'Representation',
  bridge: 'Bridge',
  'application-tier': 'Application',
}

/** Assessment source per the Item Alignment Map output schema (guide §19 Step G). */
function assessmentSource(lesson: Lesson | undefined): 'RELEASED' | 'GENERATED' | 'MIXED' {
  if (!lesson) return 'GENERATED'
  const placed = lesson.itemRefs.length > 0
  const generated = (lesson.generatedExemplars?.length ?? 0) > 0 || !!lesson.generatedExemplar
  if (placed && generated) return 'MIXED'
  return placed ? 'RELEASED' : 'GENERATED'
}

const capCarries = (carries: string[]): string[] => {
  const cleaned = [...new Set(carries.map((c) => c.trim()).filter(Boolean))]
  return cleaned.slice(0, 3) // guide §22.2: one to three skills per edge
}

/** Merge parallel edges (same from|to), unioning their carrying skills. */
function dedupeEdges(edges: WebEdge[]): WebEdge[] {
  const byKey = new Map<string, WebEdge>()
  for (const e of edges) {
    const key = `${e.from}|${e.to}`
    const prior = byKey.get(key)
    if (prior) prior.carries = capCarries([...prior.carries, ...e.carries])
    else byKey.set(key, { ...e, carries: capCarries(e.carries) })
  }
  return [...byKey.values()]
}

/** Remove transitive edges: drop u→v when v is reachable from u through ≥2 hops. */
function transitiveReduction(edges: WebEdge[]): WebEdge[] {
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  const reachableSkipping = (from: string, to: string, skip: WebEdge): boolean => {
    const seen = new Set<string>()
    const stack = [...(out.get(from) ?? []).filter((n) => !(from === skip.from && n === skip.to))]
    while (stack.length > 0) {
      const n = stack.pop() as string
      if (n === to) return true
      if (seen.has(n)) continue
      seen.add(n)
      for (const next of out.get(n) ?? []) {
        if (n === skip.from && next === skip.to) continue
        stack.push(next)
      }
    }
    return false
  }
  return edges.filter((e) => !reachableSkipping(e.from, e.to, e))
}

export interface BuiltWebs {
  webs: CoherenceWeb[]
  /** Structural findings for the QC report (dropped edges, unmet requirements). */
  flags: string[]
}

export function buildCoherenceWebs(plan: PlanOutput, units: Unit[], courseTitle: string): BuiltWebs {
  // Plans checkpointed by pre-dependency-mapping builds carry no extraction —
  // no webs rather than empty ones (the UI explains the absence).
  const hasExtraction = plan.units.some((u) => u.lessons.some((l) => (l.dependsOn?.length ?? 0) > 0))
  if (!hasExtraction) return { webs: [], flags: [] }

  const flags: string[] = []
  const lessonsById = new Map(units.flatMap((u) => u.lessons).map((l) => [l.id, l]))

  // Global teaching order + owning unit per lesson (order rule §21.2.3).
  const order = new Map<string, number>()
  const unitOf = new Map<string, number>()
  const titleOf = new Map<string, string>()
  let n = 0
  plan.units.forEach((u, ui) => {
    for (const sk of u.lessons) {
      order.set(sk.id, n++)
      unitOf.set(sk.id, ui)
      titleOf.set(sk.id, sk.title)
    }
  })

  // Cross-unit consumptions collected for the Lift Rule (unit web).
  const crossUnit: { fromUnit: number; toUnit: number; carries: string[] }[] = []

  const atomWebs: CoherenceWeb[] = plan.units.map((pu, ui) => {
    const nodes: WebNode[] = []
    const edges: WebEdge[] = []
    const prereqIds = new Set<string>()

    for (const p of pu.prereqs ?? []) {
      if (!p.id || !p.label) continue
      prereqIds.add(p.id)
      nodes.push({
        id: p.id,
        label: p.label,
        kind: 'prerequisite',
        ...(p.addedByTriage ? { flags: ['added-to-M0' as const] } : {}),
      })
    }

    // External-prerequisite nodes synthesized for dependencies on earlier
    // units' lessons — the atom web stays complete per unit while the same
    // dependency lifts into the unit web.
    const externals = new Map<string, WebNode>()

    pu.lessons.forEach((sk) => {
      const lesson = lessonsById.get(sk.id)
      nodes.push({
        id: sk.id,
        label: sk.title,
        kind: 'lesson',
        type: TYPE_LABEL[sk.type] ?? sk.type,
        ...(sk.objective?.trim() ? { objective: sk.objective.trim() } : {}),
        assessment: assessmentSource(lesson),
        ...((sk.flags ?? []).includes('inserted-by-triage') ? { flags: ['inserted-by-triage' as const] } : {}),
      })
      for (const dep of sk.dependsOn ?? []) {
        const on = (dep.on ?? '').trim()
        if (!on || on === sk.id) continue
        if (prereqIds.has(on)) {
          edges.push({ from: on, to: sk.id, carries: dep.carries ?? [] })
          continue
        }
        const srcUnit = unitOf.get(on)
        if (srcUnit === undefined) {
          flags.push(`${sk.id} depends on unknown node "${on}" — edge dropped`)
          continue
        }
        if ((order.get(on) ?? 0) >= (order.get(sk.id) ?? 0)) {
          flags.push(`${sk.id} depends on ${on}, which is not taught earlier — forward edge dropped`)
          continue
        }
        if (srcUnit === ui) {
          edges.push({ from: on, to: sk.id, carries: dep.carries ?? [] })
        } else {
          if (!externals.has(on)) {
            externals.set(on, {
              id: on,
              label: `From ${plan.units[srcUnit].id} — ${titleOf.get(on) ?? on}`,
              kind: 'prerequisite',
            })
          }
          edges.push({ from: on, to: sk.id, carries: dep.carries ?? [] })
          crossUnit.push({ fromUnit: srcUnit, toUnit: ui, carries: dep.carries ?? [] })
        }
      }
    })

    // Structural requirements (guide §21.3), reported rather than repaired —
    // webs are downstream of the ledger; a defect means the extraction is thin.
    pu.lessons.forEach((sk, li) => {
      const incoming = edges.filter((e) => e.to === sk.id).length
      const isCourseFirst = (order.get(sk.id) ?? 0) === 0
      if (incoming === 0 && !isCourseFirst && li > 0) {
        flags.push(`${pu.id}: lesson ${sk.id} has no incoming dependency edge`)
      }
      if (sk.type === 'bridge' && incoming < 2) {
        flags.push(`${pu.id}: bridge ${sk.id} has ${incoming} incoming edge(s) — a bridge requires one from each competing atom`)
      }
    })

    return {
      level: 'atom' as const,
      scope: pu.id,
      title: `${pu.id} — ${pu.title}`,
      nodes: [...nodes.filter((nd) => nd.kind === 'prerequisite' && !externals.has(nd.id)), ...externals.values(), ...nodes.filter((nd) => nd.kind === 'lesson')],
      edges: dedupeEdges(edges),
    }
  })

  // Tier 2 — the unit web (Lift Rule §22.2, transitive edges removed).
  const unitNodes: WebNode[] = plan.units.map((pu) => {
    const codes = [...new Set(pu.lessons.flatMap((l) => l.standardCodes))]
    return {
      id: pu.id,
      label: pu.title,
      kind: 'unit' as const,
      objective: `${pu.lessons.length} lesson${pu.lessons.length === 1 ? '' : 's'} · ${codes.slice(0, 5).join(', ')}${codes.length > 5 ? ', …' : ''}`,
    }
  })
  const liftedEdges = dedupeEdges(
    crossUnit
      .filter((c) => c.fromUnit < c.toUnit)
      .map((c) => ({ from: plan.units[c.fromUnit].id, to: plan.units[c.toUnit].id, carries: c.carries })),
  )
  const unitWeb: CoherenceWeb = {
    level: 'unit',
    scope: courseTitle,
    title: courseTitle,
    nodes: unitNodes,
    edges: transitiveReduction(liftedEdges),
  }

  // Tier 3 — the grade progression web (topics only, §23): one row per unit.
  const gradeNodes: WebNode[] = []
  const gradeEdges: WebEdge[] = []
  for (const pu of plan.units) {
    const topic = (pu.topic ?? '').trim() || pu.title
    const thisId = `G.${pu.id}`
    gradeNodes.push({ id: thisId, label: topic, kind: 'topic', grade: 'this' })
    ;(pu.priorGradeTopics ?? []).slice(0, 3).forEach((t, i) => {
      const trimmed = t.trim()
      if (!trimmed) return
      const id = `G.${pu.id}.p${i + 1}`
      gradeNodes.push({ id, label: trimmed, kind: 'topic', grade: 'prior' })
      gradeEdges.push({ from: id, to: thisId, carries: [] })
    })
    ;(pu.nextGradeTopics ?? []).slice(0, 3).forEach((t, i) => {
      const trimmed = t.trim()
      if (!trimmed) return
      const id = `G.${pu.id}.n${i + 1}`
      gradeNodes.push({ id, label: trimmed, kind: 'topic', grade: 'next' })
      gradeEdges.push({ from: thisId, to: id, carries: [] })
    })
  }
  const gradeWeb: CoherenceWeb = {
    level: 'grade',
    scope: courseTitle,
    title: courseTitle,
    nodes: gradeNodes,
    edges: gradeEdges,
  }

  // Orphan Check (§22.3): no incoming unit edge AND no prior-grade feed.
  plan.units.forEach((pu) => {
    const hasIncoming = unitWeb.edges.some((e) => e.to === pu.id)
    const hasPriorFeed = (pu.priorGradeTopics ?? []).some((t) => t.trim().length > 0)
    if (!hasIncoming && !hasPriorFeed) {
      flags.push(`Unit ${pu.id} has no incoming unit edge and no prior-grade feed — either truly foundational or mis-sequenced (Orphan Check)`)
    }
  })

  return { webs: [...atomWebs, unitWeb, gradeWeb], flags }
}

/** The QC entry summarizing web construction (appended to the auto-QC report). */
export function coherenceQcCheck(built: BuiltWebs): QCCheck {
  if (built.webs.length === 0) {
    return {
      name: 'Coherence webs',
      status: 'flag',
      detail:
        'No dependency extraction was found in the plan — the coherence webs (atom, unit, grade progression) could not be built. Scopes planned before dependency mapping existed flag here until regenerated.',
    }
  }
  const atomWebs = built.webs.filter((w) => w.level === 'atom')
  const unitWeb = built.webs.find((w) => w.level === 'unit')
  if (built.flags.length > 0) {
    return {
      name: 'Coherence webs',
      status: 'flag',
      detail: `Webs were built (${atomWebs.length} atom web${atomWebs.length === 1 ? '' : 's'}, unit web, grade progression), but with structural findings: ${built.flags.slice(0, 8).join('; ')}${built.flags.length > 8 ? '; …' : ''}.`,
    }
  }
  return {
    name: 'Coherence webs',
    status: 'pass',
    detail: `All three tiers built and DAG-valid: ${atomWebs.length} atom web${atomWebs.length === 1 ? '' : 's'}, a unit web with ${unitWeb?.edges.length ?? 0} labeled lifted edge${(unitWeb?.edges.length ?? 0) === 1 ? '' : 's'}, and the grade progression rows. Every edge reads "is required by".`,
  }
}
