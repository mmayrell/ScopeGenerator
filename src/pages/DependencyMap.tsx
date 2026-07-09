import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CoherenceWeb, Scope, WebNode } from '../types'
import { Btn, capsStandardCodes, Mono, Pill } from '../ui'

// ---------------------------------------------------------------------------
// Dependency Map — the coherence webs of a generated scope (Atomization Guide
// Part IV), rendered in the Achieve the Core coherence-map interaction: the
// focused node centered, everything it requires fanning in from the left,
// everything it unlocks fanning out to the right, every node clickable to
// re-center. Three tiers: Atom Web (per unit) · Unit Web · Grade Progression.
// The webs are self-contained data objects on the scope (scope.coherence);
// the drawing is regenerated from them alone.
// ---------------------------------------------------------------------------

type Tier = 'atom' | 'unit' | 'grade'

const assessTone: Record<string, 'green' | 'amber' | 'cite'> = {
  RELEASED: 'green',
  GENERATED: 'amber',
  MIXED: 'cite',
}

function NodeCard({
  node,
  focused,
  onClick,
  carries,
  direction,
}: {
  node: WebNode
  focused?: boolean
  onClick?: () => void
  /** The skills the edge between this node and the focus transmits. */
  carries?: string[]
  /** 'in' = this node is required by the focus; 'out' = the focus is required by it. */
  direction?: 'in' | 'out'
}) {
  const isPrereq = node.kind === 'prerequisite'
  const base = focused
    ? 'border-accent ring-2 ring-accent/25 bg-panel shadow-(--shadow-float)'
    : isPrereq
      ? 'border-dashed border-amber-ink/40 bg-amber-wash/40 hover:border-amber-ink/70'
      : 'border-hairline bg-panel shadow-(--shadow-lift) hover:border-hairline-2'
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors ${onClick ? 'cursor-pointer' : 'cursor-default'} ${base}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Mono className="text-[10px] text-ink-3">{node.id}</Mono>
        {isPrereq && <Pill tone="amber">M(0) prerequisite</Pill>}
        {node.kind === 'unit' && <Pill tone="night">unit</Pill>}
        {node.type && <Pill tone="accent">{node.type}</Pill>}
        {node.assessment && <Pill tone={assessTone[node.assessment] ?? 'neutral'}>{node.assessment.toLowerCase()}</Pill>}
        {node.flags?.map((f) => (
          <Pill key={f} tone="red">{f}</Pill>
        ))}
      </div>
      <div className="mt-1 text-[12.5px] leading-snug font-semibold text-ink">{capsStandardCodes(node.label)}</div>
      {focused && node.objective && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{capsStandardCodes(node.objective)}</p>
      )}
      {carries && carries.length > 0 && (
        <div className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
          <span className="font-semibold text-ink-2">{direction === 'in' ? 'supplies' : 'consumes'}:</span>{' '}
          {carries.join(' · ')}
        </div>
      )}
    </button>
  )
}

/**
 * The focused three-column web view. Connectors are measured after layout and
 * drawn as an absolutely-positioned SVG behind the cards.
 */
function FocusWeb({ web, focusId, onFocus }: { web: CoherenceWeb; focusId: string; onFocus: (id: string) => void }) {
  const nodesById = useMemo(() => new Map(web.nodes.map((n) => [n.id, n])), [web])
  const focus = nodesById.get(focusId) ?? web.nodes[0]
  const incoming = useMemo(() => web.edges.filter((e) => e.to === focus?.id && nodesById.has(e.from)), [web, focus, nodesById])
  const outgoing = useMemo(() => web.edges.filter((e) => e.from === focus?.id && nodesById.has(e.to)), [web, focus, nodesById])

  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [paths, setPaths] = useState<{ d: string; key: string }[]>([])

  const setCardRef = useCallback((key: string) => {
    return (el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(key, el)
      else cardRefs.current.delete(key)
    }
  }, [])

  const measure = useCallback(() => {
    const container = containerRef.current
    const focusEl = cardRefs.current.get('focus')
    if (!container || !focusEl) {
      setPaths([])
      return
    }
    const c = container.getBoundingClientRect()
    const f = focusEl.getBoundingClientRect()
    const next: { d: string; key: string }[] = []
    const curve = (x1: number, y1: number, x2: number, y2: number): string => {
      const dx = Math.max(24, (x2 - x1) / 2)
      return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
    }
    for (const e of incoming) {
      const el = cardRefs.current.get(`in:${e.from}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      next.push({
        key: `in:${e.from}`,
        d: curve(r.right - c.left, r.top + r.height / 2 - c.top, f.left - c.left, f.top + f.height / 2 - c.top),
      })
    }
    for (const e of outgoing) {
      const el = cardRefs.current.get(`out:${e.to}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      next.push({
        key: `out:${e.to}`,
        d: curve(f.right - c.left, f.top + f.height / 2 - c.top, r.left - c.left, r.top + r.height / 2 - c.top),
      })
    }
    setPaths(next)
  }, [incoming, outgoing])

  useLayoutEffect(() => {
    measure()
  }, [measure, focusId, web])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  if (!focus) return <p className="p-8 text-[13px] text-ink-3">This web has no nodes.</p>

  return (
    <div ref={containerRef} className="relative px-6 py-8">
      {/* connectors — behind the cards */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--color-accent, #6b5cd6)" opacity="0.55" />
          </marker>
        </defs>
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke="var(--color-accent, #6b5cd6)"
            strokeOpacity="0.45"
            strokeWidth="1.6"
            markerEnd="url(#dep-arrow)"
          />
        ))}
      </svg>

      <div className="relative grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1.15fr)_56px_minmax(0,1fr)] items-center gap-y-3">
        {/* requires — fans in from the left */}
        <div className="space-y-3 self-center">
          <div className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
            Requires{incoming.length > 0 ? ` · ${incoming.length}` : ''}
          </div>
          {incoming.length === 0 && (
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Nothing in this web — a starting point (or its prerequisites live outside this unit).
            </p>
          )}
          {incoming.map((e) => {
            const n = nodesById.get(e.from)
            if (!n) return null
            return (
              <div key={`in:${e.from}`} ref={setCardRef(`in:${e.from}`)}>
                <NodeCard node={n} onClick={() => onFocus(n.id)} carries={e.carries} direction="in" />
              </div>
            )
          })}
        </div>
        <div />
        {/* the focused node */}
        <div className="self-center">
          <div ref={setCardRef('focus')}>
            <NodeCard node={focus} focused />
          </div>
          <p className="mt-2 px-1 text-center text-[10.5px] text-ink-3">
            Every edge reads “is required by” — click any neighbor to re-center.
          </p>
        </div>
        <div />
        {/* unlocks — fans out to the right */}
        <div className="space-y-3 self-center">
          <div className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
            Unlocks{outgoing.length > 0 ? ` · ${outgoing.length}` : ''}
          </div>
          {outgoing.length === 0 && (
            <p className="text-[11.5px] leading-relaxed text-ink-3">Nothing in this web depends on this node.</p>
          )}
          {outgoing.map((e) => {
            const n = nodesById.get(e.to)
            if (!n) return null
            return (
              <div key={`out:${e.to}`} ref={setCardRef(`out:${e.to}`)}>
                <NodeCard node={n} onClick={() => onFocus(n.id)} carries={e.carries} direction="out" />
              </div>
            )
          })}
        </div>
      </div>

      {/* the whole web in sequence — jump anywhere */}
      <div className="mt-10 border-t border-hairline pt-4">
        <div className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">All nodes in this web</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {web.nodes.map((n) => (
            <button
              key={n.id}
              onClick={() => onFocus(n.id)}
              className={`cursor-pointer rounded-lg border px-2 py-1 text-left text-[11px] leading-snug transition-colors ${
                n.id === focus.id
                  ? 'border-accent bg-accent-wash text-accent-deep'
                  : n.kind === 'prerequisite'
                    ? 'border-dashed border-amber-ink/40 bg-amber-wash/40 text-ink-2 hover:border-amber-ink/70'
                    : 'border-hairline bg-panel text-ink-2 hover:border-hairline-2 hover:text-ink'
              }`}
            >
              <Mono className="mr-1 text-[9.5px] text-ink-3">{n.id}</Mono>
              {capsStandardCodes(n.label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Tier 3 — one row per unit: prior-grade topic(s) → this unit's topic → next-grade topic(s). Topics only. */
function GradeProgression({ web }: { web: CoherenceWeb }) {
  const rows = web.nodes.filter((n) => n.grade === 'this')
  const byId = new Map(web.nodes.map((n) => [n.id, n]))
  const topicChip = (n: WebNode, tone: 'neutral' | 'accent') => (
    <span
      key={n.id}
      className={`inline-block rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug font-medium ${
        tone === 'accent' ? 'border-accent/30 bg-accent-wash text-accent-deep' : 'border-hairline bg-panel text-ink'
      }`}
    >
      {capsStandardCodes(n.label)}
    </span>
  )
  return (
    <div className="px-6 py-8">
      <div className="grid grid-cols-[1fr_28px_1fr_28px_1fr] gap-y-2 text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
        <div>Prior grade — feeds in</div>
        <div />
        <div>This course</div>
        <div />
        <div>Next grade — consumes</div>
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((row) => {
          const prior = web.edges.filter((e) => e.to === row.id).map((e) => byId.get(e.from)).filter((n): n is WebNode => !!n)
          const next = web.edges.filter((e) => e.from === row.id).map((e) => byId.get(e.to)).filter((n): n is WebNode => !!n)
          const unitId = row.id.replace(/^G\./, '')
          return (
            <div key={row.id} className="grid grid-cols-[1fr_28px_1fr_28px_1fr] items-center rounded-xl border border-hairline bg-paper/60 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {prior.length > 0 ? prior.map((n) => topicChip(n, 'neutral')) : <span className="text-[11.5px] text-ink-3">— none documented —</span>}
              </div>
              <div className="text-center text-ink-3">→</div>
              <div>
                <Mono className="text-[10px] text-ink-3">{unitId}</Mono>
                <div className="mt-0.5">{topicChip(row, 'accent')}</div>
              </div>
              <div className="text-center text-ink-3">→</div>
              <div className="flex flex-wrap gap-1.5">
                {next.length > 0 ? next.map((n) => topicChip(n, 'neutral')) : <span className="text-[11.5px] text-ink-3">— none documented —</span>}
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <p className="text-[13px] text-ink-3">No grade-progression rows were recorded for this scope.</p>}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        Topic level only — never skills, lessons, or items. An excluded item’s demand usually becomes visible again here, as a next-grade topic.
      </p>
    </div>
  )
}

export default function DependencyMap({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const webs = useMemo(() => scope.coherence ?? [], [scope.coherence])
  const atomWebs = useMemo(() => webs.filter((w) => w.level === 'atom'), [webs])
  const unitWeb = webs.find((w) => w.level === 'unit')
  const gradeWeb = webs.find((w) => w.level === 'grade')

  const [tier, setTier] = useState<Tier>('atom')
  const [atomScope, setAtomScope] = useState<string>(atomWebs[0]?.scope ?? '')
  const activeAtomWeb = atomWebs.find((w) => w.scope === atomScope) ?? atomWebs[0]
  // One remembered focus per web, so switching tiers/units keeps your place.
  const [focusByWeb, setFocusByWeb] = useState<Record<string, string>>({})

  const defaultFocus = (web: CoherenceWeb | undefined): string =>
    web ? (web.nodes.find((n) => n.kind === 'lesson' || n.kind === 'unit') ?? web.nodes[0])?.id ?? '' : ''
  const webKey = (web: CoherenceWeb) => `${web.level}:${web.scope}`

  const focusIn = (web: CoherenceWeb) => focusByWeb[webKey(web)] ?? defaultFocus(web)
  const setFocus = (web: CoherenceWeb, id: string) => {
    // A cross-unit prerequisite node carries the source lesson's real id —
    // clicking it jumps to that lesson in its own unit's atom web.
    if (web.level === 'atom') {
      const node = web.nodes.find((n) => n.id === id)
      if (node?.kind === 'prerequisite') {
        const home = atomWebs.find((w) => w.nodes.some((n) => n.id === id && n.kind === 'lesson'))
        if (home && home.scope !== web.scope) {
          setAtomScope(home.scope)
          setFocusByWeb((m) => ({ ...m, [webKey(home)]: id }))
          return
        }
      }
    }
    setFocusByWeb((m) => ({ ...m, [webKey(web)]: id }))
  }

  const tabs: { id: Tier; label: string; available: boolean }[] = [
    { id: 'atom', label: 'Atom Web', available: atomWebs.length > 0 },
    { id: 'unit', label: 'Unit Web', available: !!unitWeb },
    { id: 'grade', label: 'Grade Progression', available: !!gradeWeb },
  ]

  return createPortal(
    <div className="fixed inset-0 z-100 flex flex-col bg-paper">
      {/* header */}
      <div className="flex shrink-0 items-center gap-4 border-b border-hairline bg-panel px-6 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate font-display text-[16px] leading-snug font-semibold text-ink">
            Dependency Map — {capsStandardCodes(scope.title)}
          </h2>
          <p className="text-[10.5px] text-ink-3">
            Coherence webs · every edge reads “is required by” · rendered from the scope’s emitted web objects
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-hairline bg-paper p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              disabled={!t.available}
              onClick={() => setTier(t.id)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                tier === t.id ? 'bg-night text-white' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Btn onClick={onClose}>Close</Btn>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {webs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-10">
            <div className="max-w-lg rounded-2xl border border-hairline bg-panel p-6 text-center shadow-(--shadow-lift)">
              <h3 className="font-display text-[16px] font-semibold text-ink">No coherence webs on this scope</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
                This scope was generated before dependency mapping existed ({scope.engineVersion.split(' (')[0]}), so no
                atom, unit, or grade-progression webs were emitted with it. Scopes generated under Engine v4.0 or later
                carry all three tiers — regenerate this scope to get its dependency map.
              </p>
            </div>
          </div>
        ) : tier === 'atom' && activeAtomWeb ? (
          <div>
            {/* unit selector */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-panel/60 px-6 py-2.5">
              <span className="mr-1 text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">One web per unit</span>
              {atomWebs.map((w) => (
                <button
                  key={w.scope}
                  onClick={() => setAtomScope(w.scope)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    w.scope === activeAtomWeb.scope
                      ? 'border-accent bg-accent-wash text-accent-deep'
                      : 'border-hairline bg-panel text-ink-2 hover:border-hairline-2 hover:text-ink'
                  }`}
                >
                  {capsStandardCodes(w.title)}
                </button>
              ))}
            </div>
            <FocusWeb web={activeAtomWeb} focusId={focusIn(activeAtomWeb)} onFocus={(id) => setFocus(activeAtomWeb, id)} />
          </div>
        ) : tier === 'unit' && unitWeb ? (
          <FocusWeb web={unitWeb} focusId={focusIn(unitWeb)} onFocus={(id) => setFocus(unitWeb, id)} />
        ) : tier === 'grade' && gradeWeb ? (
          <GradeProgression web={gradeWeb} />
        ) : (
          <p className="p-8 text-[13px] text-ink-3">This tier was not emitted for this scope.</p>
        )}
      </div>
    </div>,
    document.body,
  )
}
