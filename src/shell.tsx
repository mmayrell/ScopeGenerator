import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from './store'
import { systemArtifacts } from './data/meta'
import { Btn } from './ui'
import lwaiLogo from './assets/lwai-logo.png'

const Icon = ({ d, box = 20 }: { d: string; box?: number }) => (
  <svg width="15" height="15" viewBox={`0 0 ${box} ${box}`} fill="none" className="shrink-0">
    <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const nav = [
  { to: '/', label: 'Scopes', icon: 'M3 5h14M3 10h14M3 15h9', end: true },
  { to: '/sets', label: 'Standard Sets', icon: 'M10 3l7 3.5-7 3.5-7-3.5L10 3zM3 10.5L10 14l7-3.5M3 14.5L10 18l7-3.5' },
  { to: '/library', label: 'Reference Library', icon: 'M10 5.5c-1.2-1.3-2.9-2-5-2h-1.5v11H5c2.1 0 3.8.7 5 2 1.2-1.3 2.9-2 5-2h1.5v-11H15c-2.1 0-3.8.7-5 2zM10 5.5v11' },
  { to: '/packets', label: 'Released Item Repository Generator', icon: 'M4 3.5h9l3 3v10a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM13 3.5v3h3M6.5 9.5h7M6.5 12.5h7M6.5 15.5h4' },
  { to: '/system', label: 'Engine & Doctrine', icon: 'M10 6.5V3.5M10 16.5v-3M13.5 10h3M3.5 10h3M12.3 7.7l2-2M5.7 14.3l2-2M12.3 12.3l2 2M5.7 5.7l2 2M12 10a2 2 0 11-4 0 2 2 0 014 0z' },
]

export default function Shell() {
  const { scopes, loading, error, refresh, actionError, clearActionError } = useStore()
  const generating = scopes.some((s) => s.status === 'generating')
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-[60px] shrink-0 flex-col bg-night text-white/80 lg:w-60">
        <div className="px-3.5 pt-6 pb-5 lg:px-5">
          {/* Collapsed rail: the Einstein mark (left square of the wordmark). */}
          <img src={lwaiLogo} alt="LearnWith.AI" className="h-8 w-8 object-cover object-left lg:hidden" />
          {/* Expanded: full LearnWith.AI wordmark over the product name. */}
          <div className="hidden lg:block">
            <img src={lwaiLogo} alt="LearnWith.AI" className="h-9 w-auto" />
            <div className="mt-2.5 font-display text-[15px] leading-5 font-semibold text-white">LWAI Scope Generator</div>
            <div className="font-mono text-[10px] tracking-wide text-white/40">evidence-locked scoping</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5 lg:px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              title={n.label}
              className={({ isActive }) =>
                `flex items-center justify-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors lg:justify-start ${
                  isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                }`
              }
            >
              <Icon d={n.icon} />
              <span className="hidden lg:inline">{n.label}</span>
              {n.to === '/' && generating && (
                <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent lg:ml-auto" />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-3 px-5 pb-5 lg:block">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[10px] font-semibold tracking-[0.12em] text-white/40 uppercase">Running under</div>
            {systemArtifacts.map((a) => (
              <div key={a.id} className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] text-white/70">{a.kind === 'engine' ? 'Engine' : 'Doctrine'}</span>
                <span className="font-mono text-[10.5px] text-white/50">{a.version}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/30 text-[10px] font-semibold text-white">
              DM
            </div>
            <span className="truncate text-[11px] text-white/50">doreen.mayrell@learnwith.ai</span>
          </div>
        </div>
        <div className="mt-auto flex justify-center pb-5 lg:hidden">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/30 text-[10px] font-semibold text-white">DM</div>
        </div>
      </aside>
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
