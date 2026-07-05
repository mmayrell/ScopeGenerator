/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Citation, ItemRecord } from './types'

// ---------- tiny primitives ----------

export const Mono = ({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) => (
  <span className={`font-mono text-[0.92em] tracking-tight ${className}`} title={title}>
    {children}
  </span>
)

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'cite' | 'night'
  children: ReactNode
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink/[0.05] text-ink-2 border-ink/10',
    accent: 'bg-accent-wash text-accent-deep border-accent/20',
    green: 'bg-verdant-wash text-verdant border-verdant/20',
    amber: 'bg-amber-wash text-amber-ink border-amber-ink/20',
    red: 'bg-rust-wash text-rust border-rust/20',
    cite: 'bg-cite-wash text-cite border-cite/20',
    night: 'bg-night text-white/85 border-night',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium leading-4 whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Btn({
  kind = 'ghost',
  children,
  onClick,
  disabled,
  className = '',
}: {
  kind?: 'primary' | 'ghost' | 'danger' | 'night'
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  const kinds: Record<string, string> = {
    primary: 'bg-accent text-white hover:bg-accent-deep border-transparent shadow-sm',
    night: 'bg-night text-white hover:bg-night-3 border-transparent shadow-sm',
    ghost: 'bg-panel text-ink-2 hover:text-ink hover:border-hairline-2 border-hairline shadow-[0_1px_2px_rgb(28_27_34/0.04)]',
    danger: 'bg-panel text-rust hover:bg-rust-wash border-hairline',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${kinds[kind]} ${className}`}
    >
      {children}
    </button>
  )
}

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{children}</div>
)

// ---------- citation chips + popover ----------

const sourceTone: Record<Citation['sourceType'], { label: string; cls: string }> = {
  standards: { label: 'Standards', cls: 'text-accent-deep bg-accent-wash border-accent/25' },
  items: { label: 'Item', cls: 'text-verdant bg-verdant-wash border-verdant/25' },
  decomposition: { label: 'Decomposition', cls: 'text-cite bg-cite-wash border-cite/25' },
  interpretive: { label: 'Interpretive', cls: 'text-cite bg-cite-wash border-cite/25' },
  engine: { label: 'Engine', cls: 'text-ink-2 bg-ink/[0.05] border-ink/15' },
  doctrine: { label: 'Doctrine', cls: 'text-ink-2 bg-ink/[0.05] border-ink/15' },
  'admin-notes': { label: 'Admin notes', cls: 'text-amber-ink bg-amber-wash border-amber-ink/25' },
  sequence: { label: 'Sequence', cls: 'text-ink-3 bg-ink/[0.04] border-ink/10' },
  'performance-report': { label: 'Report', cls: 'text-rust bg-rust-wash border-rust/25' },
}

export function CiteChips({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (open === null) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!citations.length) return null
  return (
    <span ref={ref} className="relative ml-1 inline-flex flex-wrap items-center gap-1 align-baseline">
      {citations.map((c, i) => (
        <span key={i} className="relative">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className={`inline-flex cursor-pointer items-center rounded-[5px] border px-1.5 py-px font-mono text-[10.5px] leading-4 transition-opacity hover:opacity-75 ${sourceTone[c.sourceType].cls}`}
            title={c.label}
          >
            {c.label}
          </button>
          {open === i && (
            <span className="animate-rise absolute top-full left-0 z-50 mt-1.5 block w-80 rounded-xl border border-hairline bg-panel p-3.5 shadow-(--shadow-float)">
              <span className="flex items-center justify-between gap-2">
                <span className={`rounded-[5px] border px-1.5 py-px font-mono text-[10px] ${sourceTone[c.sourceType].cls}`}>
                  {sourceTone[c.sourceType].label}
                </span>
                <Mono className="text-[10.5px] text-ink-3">{c.locator}</Mono>
              </span>
              <span className="mt-2 block font-medium text-[12.5px] text-ink">{c.label}</span>
              <span className="mt-1.5 block border-l-2 border-hairline-2 pl-2.5 font-display text-[13px] leading-relaxed text-ink-2 italic">
                {c.excerpt}
              </span>
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

// ---------- modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-100 flex items-start justify-center overflow-y-auto bg-night/40 p-6 pt-[8vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={`animate-rise w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-2xl border border-hairline bg-panel shadow-(--shadow-float)`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h3 className="font-display text-[17px] font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- faux released-item screenshot ----------

export function ItemShot({ item, imageUrl }: { item: ItemRecord; imageUrl?: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = !!imageUrl && !imageFailed
  return (
    <figure className="overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
      {showImage ? (
        <div className="border-b border-dashed border-hairline-2 bg-[#fdfcfa] p-2">
          <img
            src={imageUrl}
            alt={`${item.test} ${item.year} · Q${item.itemNumber}`}
            className="mx-auto max-h-[480px] w-auto max-w-full rounded-md"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        <div className="border-b border-dashed border-hairline-2 bg-[#fdfcfa] px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-night font-mono text-[11px] font-semibold text-white">
              {item.itemNumber}
            </span>
            <p className="font-display text-[14px] leading-relaxed text-ink">{item.stem}</p>
          </div>
          {item.choices && (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 pl-9">
              {item.choices.map((ch, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[13px] text-ink-2">
                  <span className="font-mono text-[11px] font-semibold text-ink-3">{'ABCD'[i]}</span>
                  <span className="font-display">{ch}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[11px] text-ink-3">
        <Mono className="font-medium text-ink-2">
          {item.test} · {item.year} · Q{item.itemNumber}
        </Mono>
        <Pill tone={item.confidence === 'official' ? 'green' : item.confidence === 'confirmed' ? 'accent' : 'amber'}>
          {item.confidence}
        </Pill>
        {item.scopeClass !== 'in-boundary' && <Pill tone="red">{item.scopeClass}</Pill>}
        <span className="ml-auto">{item.demandProfile}</span>
      </figcaption>
    </figure>
  )
}

export function GeneratedShot({
  stem,
  answer,
  demandProfile,
  basis,
}: {
  stem: string
  answer: string
  demandProfile: string
  basis: string
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-amber-ink/25 bg-panel shadow-(--shadow-lift)">
      <div className="flex items-center gap-2 border-b border-amber-ink/20 bg-amber-wash px-4 py-2">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-amber-ink">
          <path d="M8 1.5l6.5 11.5H1.5L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 6.5v3M8 11.8v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">
          Generated exemplar — not a released item
        </span>
      </div>
      <div className="bg-[#fdfcfa] px-4 py-3.5">
        <p className="font-display text-[14px] leading-relaxed text-ink">{stem}</p>
        <p className="mt-2 text-[12.5px] text-ink-2">
          <span className="font-semibold text-ink">Answer:</span> {answer}
        </p>
      </div>
      <figcaption className="space-y-1 border-t border-hairline px-4 py-2.5 text-[11px] leading-relaxed text-ink-3">
        <div>
          <Mono className="text-ink-2">demand</Mono> — {demandProfile}
        </div>
        <div>
          <Mono className="text-ink-2">inference basis</Mono> — {basis}
        </div>
      </figcaption>
    </figure>
  )
}

// ---------- misc ----------

export const EmDash = () => <span className="text-ink-3"> — </span>

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink/8">
      <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}
