import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { capsStandardCodes, Spark } from '../ui'
import type { Scope } from '../types'
import heroBanner from '../assets/hero-banner.png'
import lwaiLogo from '../assets/lwai-logo.png'

const workspace = [
  {
    n: '01',
    title: 'Engine & Doctrine',
    text: 'The governing instructional framework. Built on evidence-based Direct Instruction best practices.',
    to: '/system',
  },
  {
    n: '02',
    title: 'Item Repository',
    text: 'A research assistant that hunts the public web for released items.',
    to: '/packets',
  },
  {
    n: '03',
    title: 'Reference Library',
    text: 'The document shelf — four roles, filed by framework and grade.',
    to: '/library',
  },
  {
    n: '04',
    title: 'Standard Sets',
    text: 'The evidence libraries scopes are built from. Create, curate, publish.',
    to: '/sets',
  },
  {
    n: '05',
    title: 'Scope',
    text: 'Evidence-locked course designs, unit by unit, card by card.',
    to: '/scopes',
  },
]

// Scope ids embed their creation epoch-ms; seeded ids fall back to the updated date.
const createdAt = (s: Scope): number => {
  const m = /^scope-(\d{12,})/.exec(s.id)
  if (m) return Number(m[1])
  const t = Date.parse(s.updated)
  return Number.isNaN(t) ? 0 : t
}

const updatedLabel = (s: Scope): string => {
  const t = createdAt(s)
  if (!t) return s.updated
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days === 0) {
    const hours = Math.floor((Date.now() - t) / 3600000)
    return hours <= 0 ? 'Just now' : `${hours}h ago`
  }
  if (days === 1) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const statusCell = (s: Scope) => {
  if (s.status === 'generating')
    return <span className="font-mono text-[11px] font-semibold text-accent">GENERATING</span>
  if (s.status === 'failed') return <span className="font-mono text-[11px] font-semibold text-rust">FAILED</span>
  if (s.status === 'paused') return <span className="font-mono text-[11px] font-semibold text-amber-ink">PAUSED</span>
  return <span className="font-mono text-[11px] font-semibold text-verdant">PUBLISHED</span>
}

export default function Home() {
  const { scopes, sets } = useStore()
  const nav = useNavigate()
  const recent = [...scopes].sort((a, b) => createdAt(b) - createdAt(a)).slice(0, 3)
  const setNames = (s: Scope) =>
    (s.setIds?.length ? s.setIds : [s.setId])
      .map((sid) => sets.find((x) => x.id === sid)?.name)
      .filter(Boolean)
      .join(' + ')
  return (
    <div className="mx-auto max-w-[1360px]">
      {/* hero */}
      <div className="relative overflow-hidden">
        <img
          src={heroBanner}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-right"
        />
        {/* keep the headline legible where the photo hasn't fully faded out */}
        <div className="absolute inset-0 bg-gradient-to-r from-paper via-paper/60 to-transparent" />
        {/* the logo file is opaque black, so it wears a black badge rather than sitting raw on the photo */}
        <div className="absolute top-5 right-5 z-10 hidden rounded-xl bg-black px-4 py-2.5 shadow-(--shadow-lift) sm:block lg:top-7 lg:right-8">
          <img src={lwaiLogo} alt="LearnWith.AI" className="h-9 w-auto lg:h-11" />
        </div>
        <div className="relative px-6 pt-16 pb-14 lg:px-10">
          <div className="mb-5 font-mono text-[11px] font-semibold tracking-[0.18em] text-accent">LEARNWITH.AI</div>
          <h1 className="m-0 text-[44px] leading-[1.05] font-bold tracking-[-0.03em] text-ink lg:text-[60px]">
            Standards aligned.
            <br />
            <span className="text-accent">
              Direct Instruction
              <br />
              designed.
            </span>
          </h1>
          <p className="mt-[22px] max-w-[520px] text-[17px] leading-[1.55] text-ink">
            Evidence-locked curriculum scopes with every instructional decision documented.
          </p>
          <div className="mt-[34px] flex gap-3.5">
            <button
              onClick={() => nav('/scopes/new')}
              className="flex cursor-pointer items-center gap-2.5 rounded-[10px] bg-accent px-[26px] py-[15px] text-[16px] font-semibold text-white transition-colors hover:bg-accent-deep"
            >
              <Spark size={15} color="#fff" />
              Generate a scope
            </button>
          </div>
        </div>
      </div>

      {/* the workspace */}
      <div className="px-6 pt-7 pb-12 lg:px-10">
        <div className="mb-4 font-mono text-[11px] font-semibold tracking-[0.18em] text-ink">THE WORKSPACE</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {workspace.map((w) => (
            <Link
              key={w.n}
              to={w.to}
              className="flex flex-col gap-2.5 rounded-xl border border-ink/10 bg-panel px-5 py-[22px] transition-colors hover:border-accent"
            >
              <div className="font-mono text-[10px] font-semibold text-accent">{w.n}</div>
              <div className="text-[18px] font-bold text-ink">{w.title}</div>
              <div className="text-[13px] leading-[1.45] text-ink-2">{w.text}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* recent scopes */}
      <div className="px-6 pb-14 lg:px-10">
        <div className="mb-4 flex items-baseline justify-between">
          <div className="font-mono text-[11px] font-semibold tracking-[0.18em] text-ink">RECENT SCOPES</div>
          <Link to="/scopes" className="text-[13px] font-medium text-accent hover:text-accent-deep">
            View all →
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-panel">
          <div className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_1fr] gap-4 bg-night px-[22px] py-3 font-mono text-[10px] font-semibold tracking-[0.12em] text-white/85">
            <span>SCOPE</span>
            <span>STANDARD SET</span>
            <span>ENGINE</span>
            <span>STATUS</span>
            <span>UPDATED</span>
          </div>
          {recent.map((s) => (
            <Link
              key={s.id}
              to={`/scopes/${s.id}`}
              className="grid grid-cols-[2.2fr_1.6fr_1fr_1fr_1fr] items-center gap-4 border-t border-ink/[0.06] px-[22px] py-4 transition-colors hover:bg-accent/5"
            >
              <span className="truncate text-[14px] font-semibold text-ink">{capsStandardCodes(s.title)}</span>
              <span className="truncate text-[13px] text-ink-2">{setNames(s)}</span>
              <span className="font-mono text-[12px] font-medium text-ink-2">{s.engineVersion.split(' (')[0]}</span>
              {statusCell(s)}
              <span className="text-[13px] text-ink-2">{updatedLabel(s)}</span>
            </Link>
          ))}
          {recent.length === 0 && (
            <div className="border-t border-ink/[0.06] px-[22px] py-5 text-[13px] text-ink-3">
              No scopes yet — generate your first one above.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
