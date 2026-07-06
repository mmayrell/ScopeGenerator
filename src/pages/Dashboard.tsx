import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { scopeUnsettled, useScopePolling, useStore } from '../store'
import { capsStandardCodes, Modal, Mono, Pill, Btn } from '../ui'
import type { Scope } from '../types'

// Creation moment: scope ids embed their epoch-ms timestamp; seeded ids fall
// back to the updated date (day precision).
const createdAt = (s: Scope): number => {
  const m = /^scope-(\d{12,})/.exec(s.id)
  if (m) return Number(m[1])
  const t = Date.parse(s.updated)
  return Number.isNaN(t) ? 0 : t
}

const generatedLabel = (s: Scope): string | null => {
  if (!/^scope-\d{12,}/.test(s.id)) return null
  return new Date(createdAt(s)).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function Dashboard() {
  const { scopes, sets, deleteScope } = useStore()
  const nav = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState<Scope | null>(null)
  // Newest generation first — repeated runs of the same request share a title,
  // so recency is the distinguishing signal.
  const ordered = [...scopes].sort((a, b) => createdAt(b) - createdAt(a))
  // Keep in-flight scopes fresh while they're on screen.
  useScopePolling(scopes.filter(scopeUnsettled).map((s) => s.id))
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Scopes</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Scopes can be written for an entire course or subset of standards.
          </p>
        </div>
        <Btn kind="primary" onClick={() => nav('/scopes/new')}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          New scope
        </Btn>
      </div>

      <div className="mt-8 space-y-3">
        {ordered.map((s) => {
          const setNames = (s.setIds?.length ? s.setIds : [s.setId])
            .map((sid) => sets.find((x) => x.id === sid)?.name)
            .filter(Boolean)
            .join(' + ')
          const lessons = s.units.reduce((n, u) => n + u.lessons.length, 0)
          const qcFlags = s.qc.filter((q) => q.status !== 'pass').length
          return (
            <Link
              key={s.id}
              to={`/scopes/${s.id}`}
              className="group block rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift) transition-all hover:border-hairline-2 hover:shadow-(--shadow-float)"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-display text-[18px] font-semibold text-ink group-hover:text-accent-deep">
                      {capsStandardCodes(s.title)}
                    </h2>
                    <Pill tone="neutral">v{s.version}</Pill>
                    {s.status === 'generating' ? (
                      <Pill tone="accent">
                        <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" /> generating
                      </Pill>
                    ) : s.status === 'failed' ? (
                      <Pill tone="red">failed</Pill>
                    ) : qcFlags > 0 ? (
                      <Pill tone="amber">QC: {qcFlags} flagged</Pill>
                    ) : (
                      <Pill tone="green">QC clean</Pill>
                    )}
                    {s.proposals.some((p) => p.working || p.status === 'drafting') && (
                      <Pill tone="accent">
                        <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" /> proposal drafting
                      </Pill>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                    <span>{setNames}</span>
                    <span className="text-hairline-2">·</span>
                    <span className="capitalize">{s.request.mode} scope</span>
                    <span className="text-hairline-2">·</span>
                    <span>
                      {s.units.length} units · {lessons} lessons
                    </span>
                  </div>
                </div>
                <div className="text-right text-[11.5px] text-ink-3">
                  <Mono>{s.engineVersion.split(' (')[0]}</Mono>
                  <div className="mt-0.5">
                    {generatedLabel(s) ? `generated ${generatedLabel(s)}` : `updated ${s.updated}`}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setConfirmDelete(s)
                    }}
                    className="mt-1.5 ml-auto flex cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-rust/10 hover:text-rust"
                    title="Delete scope"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8V4M5 4l.5 9a1 1 0 001 .95h3a1 1 0 001-.95L11 4M6.7 6.8v4.4M9.3 6.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </Link>
          )
        })}
        {scopes.length === 0 && (
          <p className="rounded-2xl border border-hairline bg-panel p-5 text-[13px] text-ink-3">
            No scopes yet — run one from New scope.
          </p>
        )}
      </div>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete Scope?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This removes <span className="font-semibold text-ink">{capsStandardCodes(confirmDelete?.title ?? '')}</span> and
          all its versions for every user. This is the one non-versioned operation.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              const target = confirmDelete
              setConfirmDelete(null)
              if (target) void deleteScope(target.id)
            }}
          >
            Delete
          </Btn>
        </div>
      </Modal>

      <div className="mt-12 flex items-end justify-between">
        <div>
          <h2 className="font-display text-[20px] font-semibold text-ink">Standard Sets</h2>
          <p className="mt-1 text-[13px] text-ink-2">Published sets are available for scope requests.</p>
        </div>
        <Link to="/sets" className="text-[13px] font-medium text-accent-deep hover:underline">
          Manage sets →
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {sets.map((st) => (
          <Link
            key={st.id}
            to={`/sets/${st.id}`}
            className="group rounded-2xl border border-hairline bg-panel p-4 shadow-(--shadow-lift) transition-all hover:shadow-(--shadow-float)"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-[15px] font-semibold text-ink group-hover:text-accent-deep">
                {st.name}
              </span>
              {st.published ? <Pill tone="green">published</Pill> : <Pill tone="amber">draft</Pill>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
