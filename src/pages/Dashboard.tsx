import { Link, useNavigate } from 'react-router-dom'
import { scopeUnsettled, useScopePolling, useStore } from '../store'
import { capsStandardCodes, Mono, Pill, Btn } from '../ui'

export default function Dashboard() {
  const { scopes, sets } = useStore()
  const nav = useNavigate()
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
        {scopes.map((s) => {
          const set = sets.find((x) => x.id === s.setId)
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
                    <span>{set?.name}</span>
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
                  <div className="mt-0.5">updated {s.updated}</div>
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
