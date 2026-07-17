import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useStore } from './store'
import { Btn, Spark } from './ui'
import lwaiLogo from './assets/lwai-logo.png'

const nav = [
  { to: '/', label: 'Home', end: true },
  { to: '/scopes', label: 'Scopes' },
  { to: '/lsg', label: 'Lesson Scope Edits' },
  { to: '/videos', label: 'Video Script Generator' },
  { to: '/evaluations', label: 'Scope Evaluations' },
]

const companionNav = [
  { to: '/packets', label: 'Item Repository' },
  { to: '/library', label: 'Reference Library' },
  { to: '/sets', label: 'Standard Sets' },
]

/**
 * The three companion surfaces grouped under one dropdown so the header nav
 * fits without scrolling. The menu is PORTALED to <body> at fixed viewport
 * coordinates — the header scrolls horizontally on narrow windows
 * (overflow-x-auto), which would clip an in-flow absolute menu.
 */
function CompanionTools() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const active = companionNav.some((n) => location.pathname === n.to || location.pathname.startsWith(`${n.to}/`))

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    // Fixed-position menus don't track scroll — close instead of drifting.
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  const show = () => {
    window.clearTimeout(hoverTimer.current)
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect())
    setOpen(true)
  }
  const leave = () => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setOpen(false), 150)
  }

  return (
    <span onMouseEnter={show} onMouseLeave={leave}>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : show())}
        className={`flex cursor-pointer items-center gap-1.5 border-b-2 pb-0.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
          active ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
        }`}
      >
        Companion Tools
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        anchor !== null &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: anchor.bottom + 10, left: Math.max(8, Math.min(anchor.left - 10, window.innerWidth - 208)) }}
            className="animate-rise z-50 w-[200px] rounded-xl border border-hairline bg-panel p-1.5 shadow-(--shadow-float)"
            onMouseEnter={() => window.clearTimeout(hoverTimer.current)}
            onMouseLeave={leave}
          >
            {companionNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                    isActive ? 'bg-accent/8 text-accent' : 'text-ink-2 hover:bg-ink/4 hover:text-ink'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}

export default function Shell() {
  const { scopes, loading, error, refresh, actionError, clearActionError } = useStore()
  const generating = scopes.some((s) => s.status === 'generating')
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-7 overflow-x-auto border-b border-ink/10 bg-panel py-[14px] pr-6 pl-3 lg:pr-10 lg:pl-4">
        <Link to="/" className="shrink-0" title="Home">
          <img src={lwaiLogo} alt="LearnWith.AI" className="h-[40px] w-auto" />
        </Link>
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
          <CompanionTools />
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
