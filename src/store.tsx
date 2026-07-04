/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Artifact, Proposal, ProposalChange, Scope, StandardSet, Unit } from './types'
import { seedScope, seedSets } from './data/seed'

export interface UploadSlotValue {
  files: string[]
  notes: string
}

export interface NewSetUploads {
  standards: UploadSlotValue
  items: UploadSlotValue
  unpacking: UploadSlotValue
  progression: UploadSlotValue
}

interface RerunResult {
  ok: boolean
  message: string
  guardrail?: { criterion: string; evidence: string }
}

interface Store {
  sets: StandardSet[]
  scopes: Scope[]
  createSet: (name: string, uploads: NewSetUploads) => string
  acknowledgeWarning: (setId: string, warningId: string) => void
  confirmAlignment: (setId: string, itemId: string) => void
  resolveArtifact: (setId: string, artifactId: string) => void
  publishSet: (setId: string) => void
  toggleLock: (scopeId: string, lessonId: string) => void
  rerun: (scopeId: string, target: string, mode: string, override?: boolean) => RerunResult
  createScope: (setId: string, mode: 'course' | 'standard' | 'topic', params: string) => string
  finishGeneration: (scopeId: string) => void
  submitReport: (scopeId: string, target: string, text: string) => Proposal
  iterateProposal: (scopeId: string, proposalId: string, feedback: string) => void
  resolveProposal: (scopeId: string, proposalId: string, accept: boolean) => void
  deleteScope: (scopeId: string) => void
}

const Ctx = createContext<Store | null>(null)

export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

const today = () => new Date().toISOString().slice(0, 10)

// A merge across the U3.L3 / U3.L4 boundary collides with a hard split criterion.
const PROTECTED = ['U3.L3', 'U3.L4']

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sets, setSets] = useState<StandardSet[]>(seedSets)
  const [scopes, setScopes] = useState<Scope[]>([seedScope])

  const patchScope = (id: string, fn: (s: Scope) => Scope) =>
    setScopes((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))

  const patchSet = (id: string, fn: (s: StandardSet) => StandardSet) =>
    setSets((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))

  const store: Store = {
    sets,
    scopes,

    createSet: (name, uploads) => {
      const id = `set-${Date.now()}`
      let n = 0
      const mk = (role: Artifact['role'], fileName: string, notes: string): Artifact => ({
        id: `${id}-a${n++}`,
        role,
        fileName,
        usageNotes: notes.trim(),
        reviewStatus: 'reviewed',
        meta:
          role === 'items'
            ? { sourceDescription: 'Uploaded release PDF', window: 'declared at review', coverage: 'unknown' }
            : {},
      })
      const artifacts: Artifact[] = [
        ...uploads.standards.files.map((f) => mk('standards', f, uploads.standards.notes)),
        ...uploads.items.files.map((f) => mk('items', f, uploads.items.notes)),
        ...uploads.unpacking.files.map((f) => mk('unpacking-structured', f, uploads.unpacking.notes)),
        ...uploads.progression.files.map((f) => mk('progression', f, uploads.progression.notes)),
      ]
      setSets((prev) => [
        ...prev,
        {
          id,
          name,
          subject: 'To be configured',
          gradeSpan: 'To be configured',
          hierarchyLevels: ['Grade', 'Domain', 'Cluster', 'Standard'],
          codingScheme: 'Declared in set configuration at review',
          codingNotes: '',
          emphasisSource: 'not declared',
          published: false,
          artifacts,
          warnings: [
            {
              id: `${id}-w1`,
              text: 'Ingestion queued: parsing and indexing run next — the Standards Tree and Item Bank populate when they finish.',
              acknowledged: false,
            },
          ],
          tree: [],
          items: [],
          lexicons: { representations: [], problemTypes: [] },
          updated: today(),
        },
      ])
      return id
    },

    acknowledgeWarning: (setId, warningId) =>
      patchSet(setId, (s) => ({
        ...s,
        warnings: s.warnings.map((w) => (w.id === warningId ? { ...w, acknowledged: true } : w)),
      })),

    confirmAlignment: (setId, itemId) =>
      patchSet(setId, (s) => ({
        ...s,
        items: s.items.map((it) => (it.id === itemId ? { ...it, confidence: 'confirmed' } : it)),
      })),

    resolveArtifact: (setId, artifactId) =>
      patchSet(setId, (s) => ({
        ...s,
        artifacts: s.artifacts.map((a) =>
          a.id === artifactId
            ? { ...a, reviewStatus: 'reviewed', blockingError: undefined, usageNotes: a.usageNotes || 'Declaration corrected at review.' }
            : a,
        ),
      })),

    publishSet: (setId) => patchSet(setId, (s) => ({ ...s, published: true, updated: today() })),

    toggleLock: (scopeId, lessonId) =>
      patchScope(scopeId, (sc) => ({
        ...sc,
        units: sc.units.map((u) => ({
          ...u,
          lessons: u.lessons.map((l) => (l.id === lessonId ? { ...l, locked: !l.locked } : l)),
        })),
      })),

    rerun: (scopeId, target, mode, override) => {
      const isProtectedMerge = mode === 'merge' && PROTECTED.some((p) => target.startsWith(p) || target === 'U3')
      if (isProtectedMerge && !override) {
        return {
          ok: false,
          message:
            'Declined: this merge would collapse the U3.L3 / U3.L4 boundary, which is protected by a hard split criterion.',
          guardrail: {
            criterion: 'A2 — new/hidden decision step changing the routine',
            evidence:
              'Evidence Statement keys 4.NBT.5-1 vs 4.NBT.5-2: placing and aligning a second partial row with its placeholder zero is a new decision step absent from the one-digit-multiplier routine. Engine zero-multiplier precedent: split criteria win.',
          },
        }
      }
      const modeLabel =
        mode === 'split' ? 'more granular' : mode === 'merge' ? 'less granular' : 'regenerate in place'
      patchScope(scopeId, (sc) => ({
        ...sc,
        version: sc.version + 1,
        updated: today(),
        history: [
          ...sc.history,
          {
            version: sc.version + 1,
            date: today(),
            actor: 'doreen.mayrell@learnwith.ai',
            event: `Rerun — ${modeLabel}`,
            detail: override
              ? `Target ${target}. Guardrail override recorded: merge across a protected boundary executed by explicit user override; logged in the RerunEvent and the affected Decision records, flagged in QC.`
              : `Target ${target}. Stage re-entry per §6: relational fields of adjacent lessons auto-regenerated; locked lessons queued suggestions instead of mutating.`,
          },
        ],
      }))
      return {
        ok: true,
        message: override
          ? `Override executed on ${target} — new version created; the override is logged and QC-flagged.`
          : `Rerun (${modeLabel}) executed on ${target} — new immutable version created.`,
      }
    },

    createScope: (setId, mode, params) => {
      const id = `scope-${Date.now()}`
      const set = sets.find((s) => s.id === setId)
      setScopes((prev) => [
        ...prev,
        {
          ...seedScope,
          id,
          setId,
          title:
            mode === 'course'
              ? `${set?.gradeSpan ?? 'Course'} Mathematics — Full Course`
              : mode === 'standard'
                ? `Scope — ${params}`
                : `Topic Scope — ${params}`,
          request: { mode, params },
          status: 'generating',
          version: 1,
          units: [],
          creator: 'doreen.mayrell@learnwith.ai',
          updated: today(),
          history: [],
          proposals: [],
        },
      ])
      return id
    },

    finishGeneration: (scopeId) =>
      patchScope(scopeId, (sc) => {
        let units: Unit[] = seedScope.units
        if (sc.request.mode === 'standard') {
          const code = sc.request.params
          units = seedScope.units.filter((u) => u.lessons.some((l) => l.fields.standards.content.includes(code)))
          if (units.length === 0) units = [seedScope.units[2]]
        }
        if (sc.request.mode === 'topic') units = [seedScope.units[2], seedScope.units[3]]
        // fresh copy, unlocked
        units = units.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l, locked: false })) }))
        return {
          ...sc,
          status: 'complete',
          units,
          qc: seedScope.qc,
          history: [
            {
              version: 1,
              date: today(),
              actor: 'doreen.mayrell@learnwith.ai',
              event: 'Generated',
              detail: `${sc.request.mode === 'course' ? 'Full-course' : sc.request.mode === 'standard' ? 'Single-standard' : 'Topic'} generation. Engine v2.3, DI BrainLift v1.8. ${units.reduce((n, u) => n + u.lessons.length, 0)} lessons, ${units.length} unit${units.length === 1 ? '' : 's'}.`,
            },
          ],
        }
      }),

    submitReport: (scopeId, target, text) => {
      const lower = text.toLowerCase()
      const wantsSplit =
        lower.includes('new step') || lower.includes('missing prerequisite') || lower.includes("can't start") || lower.includes('cannot start')
      const changes: ProposalChange[] = wantsSplit
        ? [
            {
              target: `${target} · Granularity`,
              kind: 'split',
              before: `${target} taught as one atom.`,
              after: `${target} split at the reported failure point: the reported errors reveal a new/unstable start cue or missing prerequisite, meeting the Editing Splits bar. New preskill atom inserted before ${target}; prerequisites re-chained.`,
              rationale: 'Reported error pattern meets the Editing Splits criteria (new/unstable start cue · new decision step or rule · missing prerequisite) — a split is justified.',
              rule: 'P9 / A3 (Editing Splits)',
            },
          ]
        : [
            {
              target: `${target} · Instructional Approach`,
              kind: 'modeling',
              before: 'Current modeled-case set as generated.',
              after: 'Modeled set intensified at the reported confusion: contrast pairs (correct vs. reported error) added to I Do; a faded scaffold inserted across We Do; practice sequencing re-ramped toward the error class.',
              rationale: 'Reported errors reveal no new start cue, decision step, or missing prerequisite — the Editing Splits bar gates a split; the framework action is modeling intensification inside the atom (contrasts, scaffolds, sequencing).',
              rule: 'P9 / A3 (Editing Splits)',
            },
          ]
      const proposal: Proposal = {
        id: `prop-${Date.now()}`,
        report: { id: `pr-${Date.now()}`, target, text, actor: 'doreen.mayrell@learnwith.ai', date: today() },
        changes,
        ripple: [
          `Adjacent lessons in the ${target.split('.')[0]} chain: relational fields (Prerequisites, within-course Progression placement) re-generate on acceptance; locked lessons receive queued suggestions requiring approval.`,
        ],
        status: 'draft',
        rounds: [],
      }
      patchScope(scopeId, (sc) => ({ ...sc, proposals: [...sc.proposals, proposal] }))
      return proposal
    },

    iterateProposal: (scopeId, proposalId, feedback) =>
      patchScope(scopeId, (sc) => ({
        ...sc,
        proposals: sc.proposals.map((p) => {
          if (p.id !== proposalId) return p
          const asksMerge = /merge|combine|collapse/i.test(feedback)
          const asksSplit = /split|separate|own lesson/i.test(feedback)
          const response = asksMerge
            ? 'Declined inside the proposal: the implied merge crosses a boundary protected by a hard split criterion (A2 — new/hidden decision step). The criterion and both sides are cited in the diff; explicit override remains available on acceptance and would be logged and QC-flagged.'
            : asksSplit
              ? 'Re-checked against Editing Splits (A3): the report shows no new/unstable start cue, no new decision step or rule, and no missing prerequisite — the bar gates the split. The revised draft keeps the fix inside the atom but deepens it: an additional contrast pair and a slower fade on the scaffold.'
              : 'Draft revised per feedback: modeled-case set adjusted and the practice ramp re-weighted; rationale and citations updated in the change set.'
          return { ...p, rounds: [...p.rounds, { feedback, response }] }
        }),
      })),

    resolveProposal: (scopeId, proposalId, accept) =>
      patchScope(scopeId, (sc) => {
        const p = sc.proposals.find((x) => x.id === proposalId)
        return {
          ...sc,
          version: accept ? sc.version + 1 : sc.version,
          updated: today(),
          proposals: sc.proposals.map((x) => (x.id === proposalId ? { ...x, status: accept ? 'accepted' : 'abandoned' } : x)),
          history: accept
            ? [
                ...sc.history,
                {
                  version: sc.version + 1,
                  date: today(),
                  actor: 'doreen.mayrell@learnwith.ai',
                  event: 'Data-informed revision accepted',
                  detail: `PerformanceReport on ${p?.report.target}: ${p?.changes[0]?.kind === 'split' ? 'split executed per Editing Splits' : 'modeling intensified inside the atom'}; report and proposal history attached to the RerunEvent.`,
                },
              ]
            : sc.history,
        }
      }),

    deleteScope: (scopeId) => setScopes((prev) => prev.filter((s) => s.id !== scopeId)),
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
