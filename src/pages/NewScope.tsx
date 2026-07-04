import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Btn, Mono, Pill, Progress, SectionLabel } from '../ui'
import type { StandardNode } from '../types'

const stages = [
  { n: 2, name: 'Scope Resolution', detail: 'Resolving request to StandardRecords, decomposition keys, item subset; classifying items per P2; building the component evidence map…' },
  { n: 3, name: 'Atomization', detail: 'Running the compiled procedure A1–A6 over the evidence map: split tests, tie-breakers, preskill splits, bridge candidates, modeling-scope pass…' },
  { n: 4, name: 'Sequencing & Unit Formation', detail: 'Doctrine-sourced ordering: preskills before composites, algorithm before representations, confusables separated in time, strand-coherent units…' },
  { n: 5, name: 'Card Generation', detail: 'Filling the fixed 13-field schema, evidence-locked — {content, citations[]} per field; assembling Decision records; generating ceiling exemplars for inferred atoms…' },
  { n: 6, name: 'Auto-QC', detail: 'Coverage matrix, prerequisite chains, atom-triple format, single-strategy check, ceiling legality, citation completeness, Decision-record integrity…' },
]

function flattenStandards(nodes: StandardNode[], out: { code: string; wording: string }[] = []) {
  for (const n of nodes) {
    if (n.wording) out.push({ code: n.norm, wording: n.wording })
    if (n.children) flattenStandards(n.children, out)
  }
  return out
}

export default function NewScope() {
  const { sets, createScope, finishGeneration } = useStore()
  const nav = useNavigate()
  const published = sets.filter((s) => s.published)
  const [setId, setSetId] = useState(published[0]?.id ?? '')
  const [mode, setMode] = useState<'course' | 'standard' | 'topic'>('course')
  const [standard, setStandard] = useState('')
  const [topic, setTopic] = useState('')
  const [topicMapped, setTopicMapped] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [stageIdx, setStageIdx] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const set = sets.find((s) => s.id === setId)
  const standards = useMemo(() => (set ? flattenStandards(set.tree) : []), [set])
  const gapHit = set?.warnings.some((w) => w.acknowledged) && mode === 'course'

  useEffect(() => () => clearTimeout(timer.current), [])

  const run = () => {
    const params = mode === 'course' ? `${set?.gradeSpan} (all published domains)` : mode === 'standard' ? standard : topic
    const id = createScope(setId, mode, params)
    setRunning(id)
    setStageIdx(0)
    const step = (i: number) => {
      if (i >= stages.length) {
        finishGeneration(id)
        timer.current = setTimeout(() => nav(`/scopes/${id}`), 600)
        return
      }
      setStageIdx(i)
      timer.current = setTimeout(() => step(i + 1), 1100 + Math.random() * 700)
    }
    step(0)
  }

  if (running) {
    return (
      <div className="mx-auto max-w-2xl px-10 py-16">
        <SectionLabel>Generating scope</SectionLabel>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">
          {mode === 'course' ? 'Full Course' : mode === 'standard' ? standard : topic}
        </h1>
        <p className="mt-1 text-[13px] text-ink-2">
          {set?.name} · Engine v2.3 · DI BrainLift v1.8 — the run is checkpointed and resumable; units stream in as stages 3–5 complete.
        </p>
        <div className="mt-8">
          <Progress pct={((stageIdx + 1) / stages.length) * 100} />
        </div>
        <div className="mt-6 space-y-2.5">
          {stages.map((s, i) => (
            <div
              key={s.n}
              className={`flex items-start gap-3.5 rounded-xl border p-4 transition-all ${
                i < stageIdx ? 'border-hairline bg-panel opacity-70' : i === stageIdx ? 'animate-rise border-accent/25 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel opacity-40'
              }`}
            >
              <span
                className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                  i < stageIdx ? 'bg-verdant-wash text-verdant' : i === stageIdx ? 'stage-pulse bg-accent text-white' : 'bg-ink/5 text-ink-3'
                }`}
              >
                {i < stageIdx ? '✓' : s.n}
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-ink">Stage {s.n} — {s.name}</div>
                {i === stageIdx && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-10 py-12">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">New Scope</h1>
      <p className="mt-1 text-[13.5px] text-ink-2">Select a published standard set, choose what to scope, and run.</p>

      <div className="mt-8 space-y-6">
        <div>
          <SectionLabel>Standard set</SectionLabel>
          <div className="mt-2 space-y-2">
            {published.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                  setId === s.id ? 'border-accent/40 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <input type="radio" checked={setId === s.id} onChange={() => setSetId(s.id)} className="accent-(--color-accent)" />
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">{s.name}</div>
                  <div className="text-[11.5px] text-ink-3">{s.items.length} items · {s.artifacts.length} artifacts · published {s.updated}</div>
                </div>
              </label>
            ))}
            {published.length === 0 && <p className="text-[13px] text-ink-3">No published sets yet — publish one from Standard sets.</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Scope</SectionLabel>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(
              [
                { m: 'course', label: 'Course', note: 'A whole grade — every published domain' },
                { m: 'standard', label: 'Standard', note: 'Pick by code from the set’s tree' },
                { m: 'topic', label: 'Topic', note: 'Any hierarchy node, or free text mapped to standards' },
              ] as const
            ).map((o) => (
              <button
                key={o.m}
                onClick={() => setMode(o.m)}
                className={`cursor-pointer rounded-xl border p-3.5 text-left transition-all ${
                  mode === o.m ? 'border-accent/40 bg-accent-wash/40 shadow-(--shadow-lift)' : 'border-hairline bg-panel hover:border-hairline-2'
                }`}
              >
                <div className="text-[13.5px] font-semibold text-ink">{o.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{o.note}</div>
              </button>
            ))}
          </div>

          {mode === 'standard' && (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-hairline bg-panel p-2">
              {standards.map((s) => (
                <label
                  key={s.code}
                  className={`flex cursor-pointer items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 ${standard === s.code ? 'bg-accent-wash' : 'hover:bg-ink/[0.03]'}`}
                >
                  <input type="radio" checked={standard === s.code} onChange={() => setStandard(s.code)} className="translate-y-px accent-(--color-accent)" />
                  <Mono className="shrink-0 text-[12px] font-semibold text-accent-deep">{s.code}</Mono>
                  <span className="truncate text-[12px] text-ink-2">{s.wording}</span>
                </label>
              ))}
            </div>
          )}

          {mode === 'topic' && (
            <div className="mt-3">
              <input
                value={topic}
                onChange={(e) => { setTopic(e.target.value); setTopicMapped(false) }}
                placeholder="e.g. multi-digit multiplication"
                className="w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
              {topic.trim().length > 3 && !topicMapped && (
                <div className="animate-rise mt-2 rounded-xl border border-hairline bg-panel p-3.5">
                  <SectionLabel>Mapping shown for confirmation</SectionLabel>
                  <p className="mt-1.5 text-[12.5px] text-ink-2">
                    “{topic}” maps to <Mono className="font-semibold text-accent-deep">4.NBT.5</Mono> and <Mono className="font-semibold text-accent-deep">4.NBT.6</Mono>{' '}
                    (multiplication and division chains) with the <Mono>4.OA.3</Mono> application tier.
                  </p>
                  <div className="mt-2.5"><Btn onClick={() => setTopicMapped(true)}>Confirm mapping</Btn></div>
                </div>
              )}
              {topicMapped && <div className="mt-2"><Pill tone="green">mapping confirmed — 4.NBT.5, 4.NBT.6 + 4.OA.3 tier</Pill></div>}
            </div>
          )}
        </div>

        {gapHit && (
          <div className="rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3 text-[12.5px] leading-relaxed text-amber-ink">
            <span className="font-mono text-[10px] font-semibold uppercase">acknowledged gaps in range</span> — This request lands inside acknowledged coverage gaps
            ({set?.warnings.filter((w) => w.acknowledged).map((w) => w.text.split(':')[0]).join('; ')}). Affected components will run on anticipated-evidence inference (D1), flagged on their cards.
          </div>
        )}

        <div className="flex items-center justify-between border-t border-hairline pt-5">
          <div className="text-[11.5px] text-ink-3">
            Records engine + doctrine versions on the scope. Whole-course generation is a long job — checkpointed, resumable.
          </div>
          <Btn
            kind="primary"
            disabled={!setId || (mode === 'standard' && !standard) || (mode === 'topic' && !topicMapped)}
            onClick={run}
          >
            Run generation
          </Btn>
        </div>
      </div>
    </div>
  )
}
