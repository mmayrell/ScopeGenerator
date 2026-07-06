import { useCallback, useEffect, useRef, useState } from 'react'
import { NotFoundError, UnauthorizedError, api, clearAccessCode, type JobStatus } from '../api'
import {
  FRAMEWORKS,
  GRADE_RANGE,
  choiceLetter,
  domainsOf,
  frameworkLabelOf,
  packetCoverageOf,
  standardsOf,
  yearsOf,
  type CatalogStandard,
} from '../packets'
import type { EvidencePacket, HuntedItem, PacketFramework, PacketSummary } from '../types'
import { Btn, capsStandardCodes, Modal, Mono, Pill, SectionLabel } from '../ui'

// Evidence Packets — a standalone tool, not connected to the standard sets or
// scopes. You pick standards from the built-in catalog (CCSS, TEKS, Virginia
// SOL, Florida B.E.S.T., grades 3–8) and a backend research agent hunts the
// public web for genuine released assessment items, transcribing each one
// faithfully with its source. The packet fills in as the agent works.

/** "Select all · Clear" pair rendered beside a section's status line. */
const SelectAll = ({ onAll, onClear, anySelected }: { onAll: () => void; onClear: () => void; anySelected: boolean }) => (
  <span className="inline-flex items-center gap-2">
    <button onClick={onAll} className="cursor-pointer font-medium text-accent-deep hover:underline">
      Select all
    </button>
    {anySelected && (
      <button onClick={onClear} className="cursor-pointer font-medium text-ink-3 hover:text-ink-2 hover:underline">
        Clear
      </button>
    )}
  </span>
)

const Chip = ({ on, disabled, title, children, onClick }: { on: boolean; disabled?: boolean; title?: string; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    title={title}
    className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      disabled
        ? 'cursor-not-allowed border-hairline bg-panel/50 text-ink-3 opacity-60'
        : on
          ? 'cursor-pointer border-accent/40 bg-accent-wash text-accent-deep'
          : 'cursor-pointer border-hairline bg-panel text-ink-2 hover:border-hairline-2'
    }`}
  >
    {children}
  </button>
)

/** Mirrors the backend cap (http-packets MAX_STANDARDS) so the error surfaces before launch. */
const MAX_STANDARDS = 120

/**
 * This standalone page calls the API directly (not through the store), so it
 * must honor the app-wide 401 rule itself: clear the stored code and reload —
 * the boot gate re-opens and re-prompts.
 */
const errText = (e: unknown, fallback: string): string => {
  if (e instanceof UnauthorizedError) {
    clearAccessCode()
    window.location.reload()
    return 'Access code rejected — enter it again.'
  }
  return e instanceof Error ? e.message : fallback
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Explicit list, never a range: [3, 8] must read "Grades 3, 8" — a dash would
// claim coverage of grades that were never selected.
const gradesLabel = (grades: number[]): string =>
  grades.length === 0 ? '' : grades.length === 1 ? `Grade ${grades[0]}` : `Grades ${grades.join(', ')}`

const statusPill = (status: EvidencePacket['status']) =>
  status === 'hunting' ? (
    <Pill tone="accent">Hunting…</Pill>
  ) : status === 'complete' ? (
    <Pill tone="green">Complete</Pill>
  ) : status === 'failed' ? (
    <Pill tone="red">Failed</Pill>
  ) : (
    <Pill tone="neutral">Stopped</Pill>
  )

type View = { kind: 'list' } | { kind: 'builder' } | { kind: 'detail'; id: string }

export default function EvidencePackets() {
  const [view, setView] = useState<View>({ kind: 'list' })

  return view.kind === 'builder' ? (
    <Builder onLaunched={(id) => setView({ kind: 'detail', id })} onBack={() => setView({ kind: 'list' })} />
  ) : view.kind === 'detail' ? (
    <Detail id={view.id} onBack={() => setView({ kind: 'list' })} />
  ) : (
    <PacketList onNew={() => setView({ kind: 'builder' })} onOpen={(id) => setView({ kind: 'detail', id })} />
  )
}

// ---------------------------------------------------------------------------
// List — past packets
// ---------------------------------------------------------------------------

function PacketList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [packets, setPackets] = useState<PacketSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PacketSummary | null>(null)

  const load = useCallback(() => {
    api
      .listPackets()
      .then((list) => {
        setPackets(list)
        setError(null)
      })
      .catch((e: unknown) => {
        // Deploy-skew shim: an API without the packets endpoints yet means
        // "no packets", not an error.
        if (e instanceof NotFoundError) {
          setPackets([])
          setError(null)
          return
        }
        setError(errText(e, 'Could not load repositories.'))
      })
  }, [])
  useEffect(load, [load])

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Released Item Repository Generator</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
            A research agent hunts the public web for genuine released assessment items on the standards you pick —
            transcribed faithfully, with a link to every source. Separate from your standard sets and scopes.
          </p>
        </div>
        <Btn kind="primary" onClick={onNew}>New Repository</Btn>
      </div>

      {error && (
        <div className="animate-rise mt-6 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}

      <div className="mt-8 space-y-3">
        {(packets ?? []).map((p) => (
          // The delete control is a SIBLING of the card button (positioned over
          // it) — interactive content inside a <button> is invalid and hides
          // the control from assistive tech.
          <div key={p.id} className="relative">
            <button
              onClick={() => onOpen(p.id)}
              className="block w-full cursor-pointer rounded-2xl border border-hairline bg-panel p-5 pr-12 text-left shadow-(--shadow-lift) transition-colors hover:border-hairline-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[16px] font-semibold text-ink">{capsStandardCodes(p.title)}</span>
                {statusPill(p.status)}
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                {p.frameworkLabel} · {gradesLabel(p.grades)} · {p.standardCount} standard{p.standardCount === 1 ? '' : 's'} ·{' '}
                {p.itemCount} item{p.itemCount === 1 ? '' : 's'} found · created {when(p.created)}
              </p>
              {p.status === 'failed' && p.error && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-rust">{p.error}</p>
              )}
            </button>
            <button
              onClick={() => setConfirmDelete(p)}
              className="absolute top-5 right-4 flex cursor-pointer rounded-md p-1 text-ink-3 transition-colors hover:bg-rust/10 hover:text-rust"
              title="Delete repository"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8V4M5 4l.5 9a1 1 0 001 .95h3a1 1 0 001-.95L11 4M6.7 6.8v4.4M9.3 6.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
        {packets !== null && packets.length === 0 && (
          <div className="rounded-2xl border border-hairline bg-panel p-6 text-[13px] leading-relaxed text-ink-3">
            No repositories yet. Build one: pick a framework, grades, and standards, and the agent goes hunting for
            released items online.
          </div>
        )}
        {packets === null && !error && <p className="text-[12.5px] text-ink-3">Loading repositories…</p>}
      </div>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete Repository?">
        <p className="text-[13px] leading-relaxed text-ink-2">
          This removes <span className="font-semibold text-ink">{capsStandardCodes(confirmDelete?.title ?? '')}</span>{' '}
          and everything the agent found for it, for every user.
          {confirmDelete?.status === 'hunting' ? ' The running hunt will stop.' : ''}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              const target = confirmDelete
              setConfirmDelete(null)
              if (target) {
                setPackets((prev) => (prev ? prev.filter((p) => p.id !== target.id) : prev))
                api.deletePacket(target.id).catch(() => load())
              }
            }}
          >
            Delete
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Builder — catalog selection, then dispatch the agent
// ---------------------------------------------------------------------------

function Builder({ onLaunched, onBack }: { onLaunched: (id: string) => void; onBack: () => void }) {
  // The catalog (~740 standards with full official wording) loads lazily so it
  // stays out of the main bundle.
  const [catalog, setCatalog] = useState<CatalogStandard[] | null>(null)
  const [framework, setFramework] = useState<PacketFramework>('ccss')
  const [grades, setGrades] = useState<number[]>([])
  const [domainCodes, setDomainCodes] = useState<string[]>([])
  const [standardCodes, setStandardCodes] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    import('../data/packet-catalog')
      .then((m) => {
        if (alive) setCatalog(m.PACKET_CATALOG)
      })
      .catch(() => {
        if (alive) setError('Could not load the standards catalog — reload the page.')
      })
    return () => {
      alive = false
    }
  }, [])

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const domains = catalog ? domainsOf(catalog, framework, grades) : []
  const inScope = catalog ? standardsOf(catalog, framework, grades, domainCodes) : []
  const selected = standardCodes.length === 0 ? inScope : inScope.filter((st) => standardCodes.includes(st.code))
  const overCap = selected.length > MAX_STANDARDS

  const launch = async () => {
    if (selected.length === 0 || overCap) return
    setLaunching(true)
    setError(null)
    try {
      const { packet } = await api.createPacket({
        title: title.trim(),
        framework,
        frameworkLabel: frameworkLabelOf(framework),
        grades: [...new Set(selected.map((s) => s.grade))].sort((a, b) => a - b),
        years,
        standards: selected.map(({ framework: _fw, ...std }) => std),
      })
      onLaunched(packet.id)
    } catch (e) {
      // Deploy-skew: a backend without the packets endpoints yet 404s — say
      // so instead of surfacing a bare 'not found'.
      setError(
        e instanceof NotFoundError
          ? 'The backend is still rolling out this feature — try again in a couple of minutes.'
          : errText(e, 'Could not start the hunt.'),
      )
      setLaunching(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <Btn onClick={onBack}>← Back to repositories</Btn>
      <h1 className="mt-4 font-display text-[28px] font-semibold tracking-tight text-ink">New Released Item Repository</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Pick standards from the built-in catalog and send the agent. It searches the web for genuine released items —
        state released tests, official sample items — and transcribes what it finds with a link to every source.
      </p>

      {error && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}

      <div className="mt-8 space-y-7">
        <div>
          <SectionLabel>Standard Set</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FRAMEWORKS.map((fw) => (
              <Chip
                key={fw.key}
                on={framework === fw.key}
                title={fw.blurb}
                onClick={() => {
                  setFramework(fw.key)
                  setDomainCodes([])
                  setStandardCodes([])
                  setYears([]) // year availability differs per framework
                }}
              >
                {fw.label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Grade Level</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GRADE_RANGE.map((n) => (
              <Chip
                key={n}
                on={grades.includes(n)}
                onClick={() => {
                  setGrades((p) => toggle(p, n).sort((a, b) => a - b))
                  setDomainCodes([])
                  setStandardCodes([])
                }}
              >
                Grade {n}
              </Chip>
            ))}
          </div>
          {grades.length === 0 && <p className="mt-2 text-[12.5px] text-ink-3">Pick at least one grade to see its domains.</p>}
        </div>

        <div>
          <SectionLabel>Domains</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {domainCodes.length === 0 ? 'All domains included — narrow if needed. ' : `${domainCodes.length} selected. `}
            {domains.length > 0 && (
              <SelectAll
                anySelected={domainCodes.length > 0}
                onAll={() => setDomainCodes(domains.map((d) => d.code))}
                onClear={() => setDomainCodes([])}
              />
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <Chip
                key={d.code}
                on={domainCodes.includes(d.code)}
                onClick={() => {
                  setDomainCodes((p) => toggle(p, d.code))
                  setStandardCodes([])
                }}
              >
                {d.name}
                <span className="ml-1.5 text-[10.5px] opacity-60">{d.count}</span>
              </Chip>
            ))}
            {catalog !== null && grades.length > 0 && domains.length === 0 && (
              <p className="text-[12.5px] text-ink-3">No catalog entries for this selection.</p>
            )}
            {catalog === null && <p className="text-[12.5px] text-ink-3">Loading the standards catalog…</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Standards</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {standardCodes.length === 0 ? 'All standards in the selected domains included. ' : `${standardCodes.length} selected. `}
            {inScope.length > 0 && (
              <SelectAll
                anySelected={standardCodes.length > 0}
                onAll={() => setStandardCodes(inScope.map((st) => st.code))}
                onClear={() => setStandardCodes([])}
              />
            )}
          </p>
          <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-hairline bg-panel/50 p-3">
            {inScope.map((st) => (
              <Chip
                key={st.code}
                on={standardCodes.includes(st.code)}
                title={st.text}
                onClick={() => setStandardCodes((p) => toggle(p, st.code))}
              >
                <Mono className="text-[11px]">{st.code}</Mono>
              </Chip>
            ))}
            {inScope.length === 0 && <p className="text-[12.5px] text-ink-3">Pick grades (and optionally domains) to list standards.</p>}
          </div>
        </div>

        <div>
          <SectionLabel>Administration Years</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {years.length === 0
              ? 'All listed years included. '
              : `The agent hunts all of: ${[...years].sort((a, b) => b - a).join(', ')}. `}
            <SelectAll
              anySelected={years.length > 0}
              onAll={() => setYears(yearsOf(framework))}
              onClear={() => setYears([])}
            />
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {yearsOf(framework).map((y) => (
              <Chip key={y} on={years.includes(y)} onClick={() => setYears((p) => toggle(p, y))}>
                {y}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            Only years with released or official sample materials for this framework are offered — never earlier than
            2017, and at most the past ten years.
          </p>
        </div>

        <div>
          <SectionLabel>Title</SectionLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mathematics Released Item Repository"
            className="mt-2 w-full max-w-md rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
        </div>

        <div className="flex items-center justify-between border-t border-hairline pt-5">
          <span className="text-[12.5px] text-ink-2">
            <span className="font-semibold text-ink">{selected.length}</span> standard{selected.length === 1 ? '' : 's'} to hunt
            {overCap && <span className="text-rust"> · at most {MAX_STANDARDS} per repository — narrow grades or domains</span>}
          </span>
          <Btn kind="primary" disabled={selected.length === 0 || overCap || launching} onClick={() => void launch()}>
            {launching ? 'Dispatching…' : 'Send the Agent'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail — agent progress while hunting, then the packet itself
// ---------------------------------------------------------------------------

const POLL_MS = 3500

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [packet, setPacket] = useState<EvidencePacket | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // Last packet status actually observed — a transient fetch error while the
  // hunt runs must keep the poll loop alive, not silently freeze the view.
  const lastStatus = useRef<EvidencePacket['status'] | null>(null)
  const refresh = useCallback(async () => {
    try {
      const p = await api.getPacket(id)
      setPacket(p)
      setError(null)
      lastStatus.current = p.status
      if (p.status === 'hunting') {
        try {
          setJob(await api.getPacketJob(id))
        } catch {
          /* job row can lag packet creation — the packet status carries the view */
        }
      }
      return p.status
    } catch (e) {
      if (e instanceof NotFoundError) {
        // Deleted elsewhere — drop the stale render (a kept 'hunting' packet
        // would show a live agent panel with a working Stop button) and stop
        // polling for good.
        setPacket(null)
        setError('This repository was deleted.')
        lastStatus.current = null
        return 'failed' as const
      }
      setError(errText(e, 'Could not load the repository.'))
      return lastStatus.current === 'hunting' ? ('hunting' as const) : ('failed' as const)
    }
  }, [id])

  // pollNonce restarts the poll loop after a retry (the previous loop ends
  // when the packet settles).
  const [pollNonce, setPollNonce] = useState(0)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const status = await refresh()
      if (alive && status === 'hunting') timer.current = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer.current)
    }
  }, [refresh, pollNonce])

  const stop = async () => {
    setStopping(true)
    try {
      await api.stopPacket(id)
    } catch (e) {
      setError(errText(e, 'Could not stop the hunt.'))
    } finally {
      setStopping(false)
    }
  }

  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      await api.retryPacket(id)
      // Flip to the agent phase immediately and restart the poll loop.
      setPacket((prev) => (prev ? { ...prev, status: 'hunting' } : prev))
      setPollNonce((n) => n + 1)
    } catch (e) {
      setError(errText(e, 'Could not restart the hunt.'))
    } finally {
      setRetrying(false)
    }
  }

  const exportDoc = async () => {
    if (!packet) return
    setExporting(true)
    setExportError(null)
    try {
      const { downloadPacketDocx } = await import('../export/packet-docx')
      await downloadPacketDocx(packet)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not build the document.')
    } finally {
      setExporting(false)
    }
  }

  if (!packet) {
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <Btn onClick={onBack}>← Back to repositories</Btn>
        {error ? (
          <div className="animate-rise mt-6 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
        ) : (
          <p className="mt-6 text-[12.5px] text-ink-3">Loading repository…</p>
        )}
      </div>
    )
  }

  // ---------- agent phase ----------
  if (packet.status === 'hunting') {
    const total = job?.totalStages ?? 1
    const done = job?.stagesDone ?? 0
    const logTail = (job?.log ?? []).slice(-5)
    return (
      <div className="mx-auto max-w-4xl px-10 py-10">
        <div className="flex items-center justify-between gap-3">
          <Btn onClick={onBack}>← Back to repositories</Btn>
          <Btn kind="danger" disabled={stopping || job?.cancelRequested === true} onClick={() => void stop()}>
            {job?.cancelRequested ? 'Stopping…' : stopping ? 'Stopping…' : 'Stop Hunt'}
          </Btn>
        </div>
        {error && (
          <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
        )}

        <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
          <SectionLabel>Released Item Repository</SectionLabel>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(packet.title)}</h1>
          <div className="mt-4 flex items-center gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <span className="text-[13.5px] font-medium text-ink">
              The agent is hunting released items online — {packet.frameworkLabel}, {gradesLabel(packet.grades)}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
            {packet.standards.length} standard{packet.standards.length === 1 ? '' : 's'} to cover ·{' '}
            <span className="font-semibold text-ink">{packet.items.length}</span> item{packet.items.length === 1 ? '' : 's'} found so far.
            The repository fills in as each search batch lands; you can leave this page and come back.
          </p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
            <div
              className="h-full rounded-full bg-accent transition-all duration-700"
              style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {job ? `${done} of ${total} search batches · ${job.stage}` : 'Starting up…'}
          </p>
          {logTail.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-hairline pt-3">
              {logTail.map((entry, i) => (
                <p key={`${entry.at}-${i}`} className="text-[11.5px] leading-relaxed text-ink-3">
                  <span className="text-ink-2">{when(entry.at)}</span> — {capsStandardCodes(entry.detail)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- settled packet ----------
  const coverage = packetCoverageOf(packet)
  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-center justify-between gap-3">
        <Btn onClick={onBack}>← Back to repositories</Btn>
        <span className="text-[12px] text-ink-3">
          {coverage.stats.items} items · {coverage.stats.standardsCovered}/{coverage.stats.standardsTotal} standards · {coverage.stats.yearSpan}
        </span>
        <Btn kind="primary" disabled={exporting} onClick={() => void exportDoc()}>
          {exporting ? 'Preparing…' : 'Download Doc'}
        </Btn>
      </div>
      {error && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}
      {exportError && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{exportError}</div>
      )}
      {packet.status === 'failed' && (
        <div className="animate-rise mt-4 flex items-center justify-between gap-3 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5">
          <span className="text-[12.5px] leading-relaxed text-rust">
            The hunt failed: {packet.error ?? 'unknown error'}. Items found before the failure are kept below.
          </span>
          <Btn disabled={retrying} onClick={() => void retry()}>{retrying ? 'Restarting…' : 'Retry Hunt'}</Btn>
        </div>
      )}
      {packet.status === 'cancelled' && (
        <div className="animate-rise mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-2.5">
          <span className="text-[12.5px] leading-relaxed text-ink-2">
            The hunt was stopped early — the evidence below covers only the search batches that finished.
          </span>
          <Btn disabled={retrying} onClick={() => void retry()}>{retrying ? 'Restarting…' : 'Resume Hunt'}</Btn>
        </div>
      )}

      {/* cover */}
      <div className="mt-6 rounded-2xl border border-hairline bg-panel p-6 shadow-(--shadow-lift)">
        <SectionLabel>Released Item Repository</SectionLabel>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{capsStandardCodes(packet.title)}</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          Released assessment items found online for {packet.frameworkLabel} ({gradesLabel(packet.grades)}) — transcribed
          faithfully by the research agent, with a link to every source.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [coverage.stats.items, 'Released items'],
            [`${coverage.stats.standardsCovered}/${coverage.stats.standardsTotal}`, 'Standards covered'],
            [coverage.stats.sources, 'Sources'],
            [coverage.stats.yearSpan, 'Administration years'],
          ].map(([v, l]) => (
            <div key={String(l)} className="rounded-xl border border-hairline bg-paper/60 px-3.5 py-2.5">
              <div className="font-display text-[20px] font-semibold text-ink">{v}</div>
              <div className="text-[11px] text-ink-3">{l}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
          Every item is a text facsimile transcribed from the linked source — verify against the source document before
          classroom use. Alignments marked ai-inferred are the agent's judgment and are never official.
        </p>
      </div>

      {/* coverage summary */}
      <div className="mt-8">
        <SectionLabel>Coverage Summary</SectionLabel>
        {coverage.summaryRows.length === 0 && (
          <p className="mt-2 rounded-xl border border-hairline bg-panel px-4 py-3 text-[12.5px] text-ink-3">
            The agent found no released items for this selection — every standard below is a documentation gap.
          </p>
        )}
        {coverage.summaryRows.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-hairline bg-paper/60 text-[10.5px] tracking-wide text-ink-3 uppercase">
                  <th className="px-3.5 py-2 font-semibold">Standard</th>
                  <th className="px-3 py-2 font-semibold">Grade</th>
                  <th className="px-3 py-2 font-semibold">Items</th>
                  <th className="px-3 py-2 font-semibold">Programs</th>
                  <th className="px-3 py-2 font-semibold">Years</th>
                </tr>
              </thead>
              <tbody>
                {coverage.summaryRows.map((r) => (
                  <tr key={r.standard.code} className="border-b border-hairline last:border-0">
                    <td className="px-3.5 py-2"><Mono className="text-ink">{r.standard.code}</Mono></td>
                    <td className="px-3 py-2 text-ink-2">Grade {r.standard.grade}</td>
                    <td className="px-3 py-2 text-ink-2">{r.items.length}</td>
                    <td className="px-3 py-2 text-ink-2">{r.programs.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-ink-2">{r.years.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {coverage.gaps.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3">
            <div className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">
              Standards With No Released Evidence Found
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
              Documentation gaps, not unimportance: {coverage.gaps.map((g) => g.code).join(', ')}
            </p>
          </div>
        )}
      </div>

      {/* item sections */}
      {coverage.sections.map((sec) => (
        <div key={`${sec.grade}-${sec.domainName}`} className="mt-10">
          <div className="flex items-baseline justify-between border-b-2 border-ink/70 pb-1.5">
            <h2 className="font-display text-[20px] font-semibold text-ink">
              Grade {sec.grade}
              <span className="ml-2 text-[13px] font-normal text-ink-3">{sec.domainName}</span>
            </h2>
            <span className="text-[11.5px] text-ink-3">
              {sec.rows.length} standard{sec.rows.length === 1 ? '' : 's'} · {sec.rows.reduce((n, r) => n + r.items.length, 0)} items
            </span>
          </div>
          {sec.rows.map((row) => (
            <div key={row.standard.code} className="mt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="rounded-md bg-night px-2 py-0.5 text-[11.5px] font-semibold text-white">{row.standard.code}</Mono>
                <Pill tone="neutral">{row.items.length} item{row.items.length === 1 ? '' : 's'}</Pill>
              </div>
              <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">{row.standard.text}</p>
              <div className="mt-3 space-y-3">
                {row.items.map((item) => (
                  <ItemFacsimile key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {coverage.unconfirmed.length > 0 && (
        <div className="mt-10 rounded-xl border border-amber-ink/25 bg-amber-wash px-4 py-3">
          <div className="text-[11px] font-semibold tracking-wide text-amber-ink uppercase">Items With Inferred Alignment</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
            The source did not label these items with a standard code — the agent judged the alignment from content:{' '}
            {coverage.unconfirmed
              .map((i) => `${i.program || i.sourceName}${i.year ? ` ${i.year}` : ''}${i.itemNumber ? ` Q${i.itemNumber}` : ''} → ${i.standardCode}`)
              .join('; ')}
          </p>
        </div>
      )}
      <div className="h-16" />
    </div>
  )
}

/** Text facsimile of a hunted item — stem, lettered choices, answer, and source metadata. */
function ItemFacsimile({ item }: { item: HuntedItem }) {
  const header = [item.program || item.sourceName, item.year > 0 ? String(item.year) : '', item.itemNumber ? `Q${item.itemNumber}` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="rounded-xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-ink-2">{header}</span>
        {item.alignment === 'official' ? <Pill tone="green">official alignment</Pill> : <Pill tone="amber">alignment ai-inferred</Pill>}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{item.stem}</p>
      {item.choices.length > 0 && (
        <div className="mt-2 space-y-1">
          {item.choices.map((choice, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">{choiceLetter(i)}.</span> {choice}
            </p>
          ))}
        </div>
      )}
      {item.itemType === 'constructed-response' && item.choices.length === 0 && (
        <p className="mt-2 text-[11.5px] text-ink-3 italic">Constructed response — students produce the answer; see the source for the rubric.</p>
      )}
      {item.answer && (
        <p className="mt-2 text-[12px] text-ink-2">
          <span className="font-semibold text-verdant">Answer:</span> {item.answer}
        </p>
      )}
      <p className="mt-2.5 border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-ink-3">
        {item.itemType}
        {' · source: '}
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent-deep underline decoration-accent/40 hover:decoration-accent">
          {item.sourceName || item.sourceUrl}
        </a>
        {item.notes ? ` · ${item.notes}` : ''}
      </p>
    </div>
  )
}
