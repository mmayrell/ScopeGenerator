import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from './store'
import { Btn, Spark } from './ui'
import lwaiLogo from './assets/lwai-logo.png'

const nav = [
  { to: '/system', label: 'Engine & Doctrine' },
  { to: '/packets', label: 'Item Repository' },
  { to: '/library', label: 'Reference Library' },
  { to: '/sets', label: 'Standard Sets' },
  { to: '/scopes', label: 'Scopes' },
  { to: '/', label: 'Home', end: true },
  { to: '/lsg', label: 'Lesson Scope Edits' },
]

export default function Shell() {
  const { scopes, loading, error, refresh, actionError, clearActionError } = useStore()
  const generating = scopes.some((s) => s.status === 'generating')
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-7 overflow-x-auto border-b border-ink/10 bg-panel px-6 py-[14px] lg:px-10">
        <img src={lwaiLogo} alt="LearnWith.AI" className="h-[40px] w-auto shrink-0" />
        <nav className="ml-4 flex items-center gap-7 lg:ml-9">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 border-b-2 pb-0.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
                }`
              }
            >
              {n.label}
              {n.to === '/scopes' && generating && <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" />}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <Spark />
          <span className="text-[15px] font-bold tracking-[0.02em] text-ink whitespace-nowrap">SCOPE&nbsp;GENERATOR</span>
          <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-ink-3 whitespace-nowrap">BY LWAI</span>
          <div
            className="ml-2 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white"
            title="doreen.mayrell@learnwith.ai"
          >
            DM
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        {actionError && (
          <div className="animate-rise flex items-center justify-between gap-4 border-b border-rust/25 bg-rust-wash px-6 py-2.5">
            <span className="text-[12.5px] leading-relaxed text-rust">
              <span className="font-mono text-[10px] font-semibold uppercase">action failed</span> — {actionError}
            </span>
            <button
              onClick={clearActionError}
              className="shrink-0 cursor-pointer rounded-md p-1 text-rust transition-colors hover:bg-rust/10"
              title="Dismiss"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="stage-pulse mx-auto h-2.5 w-2.5 rounded-full bg-accent" />
              <p className="mt-3 text-[13px] text-ink-2">Loading workspace…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-10">
            <div className="w-full max-w-md rounded-2xl border border-rust/25 bg-panel p-6 text-center shadow-(--shadow-lift)">
              <div className="font-mono text-[10px] font-semibold tracking-wide text-rust uppercase">Couldn’t load workspace</div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{error}</p>
              <div className="mt-4 flex justify-center">
                <Btn kind="primary" onClick={() => void refresh()}>Retry</Btn>
              </div>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
