import { useEffect, useState } from 'react'
import { api } from '../api'
import { Mono, Pill } from '../ui'
import type { FrameworkDoc, FrameworkSection } from '../types'

// ---------- section card ----------

const LockBadge = ({ updated }: { updated: string }) => (
  <Pill tone="green">
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9a1 1 0 011 1v5a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
    locked — {updated}
  </Pill>
)

function SectionCard({ section }: { section: FrameworkSection }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
      <div className="flex items-center justify-between gap-3">
        <Pill tone={section.kind === 'engine' ? 'accent' : 'night'}>{section.kind === 'engine' ? 'Engine' : 'Doctrine'}</Pill>
        <div className="flex items-center gap-2">
          <LockBadge updated={section.updated} />
          <Mono className="text-[12px] text-ink-3">{section.version}</Mono>
        </div>
      </div>
      <h2 className="mt-3 font-display text-[16px] leading-snug font-semibold text-ink">{section.name}</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
        {/* Deploy-skew fallback: an older API payload has no description — derive a preview from the content. */}
        {section.description || `${section.content.replace(/^## .*$/gm, '').replace(/^- /gm, '').trim().slice(0, 220)}…`}
      </p>
    </div>
  )
}

// ---------- page ----------

export default function System() {
  const [doc, setDoc] = useState<FrameworkDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getFramework().then(setDoc, (e) => setError(e instanceof Error ? e.message : 'Could not load the framework.'))
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Engine & Doctrine</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        The theoretical framework the tool runs under — not evidence about any standard set, but the rules every
        generation strictly follows, written to work with any state's standards. Both documents are fixed as
        written; every generated scope records the versions it ran under.
      </p>

      {error && (
        <div className="animate-rise mt-5 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
          {error}
        </div>
      )}

      {!doc ? (
        !error && (
          <div className="mt-16 flex justify-center">
            <span className="stage-pulse h-2.5 w-2.5 rounded-full bg-accent" />
          </div>
        )
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard section={doc.engine} />
          <SectionCard section={doc.doctrine} />
        </div>
      )}
    </div>
  )
}
