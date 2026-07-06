import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type JobStatus } from '../api'
import { FRAMEWORKS, frameworkLabelOf } from '../packets'
import { useStore, type NewSetFile, type NewSetUploads, type UploadSlotValue } from '../store'
import type { LibraryFile, LibraryRole, PacketFramework } from '../types'
import { Btn, Modal, Mono, Pill, SectionLabel } from '../ui'

const slots: { key: LibraryRole; label: string; note: string }[] = [
  { key: 'standards', label: 'Official Standard Document', note: 'The boundary authority and structure source — wording, limits, hierarchy.' },
  { key: 'progression', label: 'Progression Document', note: 'How topics develop across grades — placement, prerequisites, representations.' },
  { key: 'items', label: 'Released Items Document', note: 'The primary empirical evidence of what is assessed and how hard.' },
  { key: 'unpacking', label: 'Unpacking Document', note: 'Structured decomposition — the candidate-atom partition and default bounds.' },
]

const GRADES = [3, 4, 5, 6, 7, 8]

const emptySlot: UploadSlotValue = { files: [], notes: '' }
const empty: NewSetUploads = { standards: emptySlot, progression: emptySlot, items: emptySlot, unpacking: emptySlot }

/** Default usage note for a slot filled from the Reference Library — gives extraction provenance. */
const LIBRARY_NOTE: Record<LibraryRole, string> = {
  standards: 'Official standards document from the Reference Library.',
  progression: 'Progression document from the Reference Library.',
  items: 'Released-items document from the Reference Library.',
  unpacking: 'Unpacking document from the Reference Library.',
}

const Pick = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      on ? 'border-accent/40 bg-accent-wash text-accent-deep' : 'border-hairline bg-panel text-ink-2 hover:border-hairline-2'
    }`}
  >
    {children}
  </button>
)

function UploadSlot({
  label,
  note,
  value,
  fromLibrary,
  missingNote,
  onAdd,
  onRemove,
  onNotes,
}: {
  label: string
  note: string
  value: UploadSlotValue
  fromLibrary: boolean
  missingNote: string | null
  onAdd: (files: File[]) => void
  onRemove: (name: string) => void
  onNotes: (notes: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const files = value.files
  return (
    <div className={`rounded-xl border bg-panel p-4 ${missingNote ? 'border-amber-ink/40' : 'border-hairline'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-semibold text-ink">{label}</div>
            {fromLibrary && files.length > 0 && <Pill tone="green">from Reference Library</Pill>}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{note}</div>
        </div>
        <Btn onClick={() => inputRef.current?.click()} className="shrink-0">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 9.5V2M4 4.5L7 1.5l3 3M2 11.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {files.length ? 'Add more' : 'Upload PDF(s)'}
        </Btn>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length) onAdd(files)
          e.target.value = ''
        }}
      />
      {missingNote && (
        <div className="animate-rise mt-3 rounded-lg border border-amber-ink/30 bg-amber-wash px-3 py-2 text-[11.5px] leading-snug text-amber-ink">
          {missingNote}
        </div>
      )}
      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0 text-rust">
                <path d="M3 1.5h5.5L11.5 4.5V12a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M8.5 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <Mono className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{f}</Mono>
              <button
                onClick={() => onRemove(f)}
                className="cursor-pointer rounded p-0.5 text-ink-3 transition-colors hover:bg-ink/5 hover:text-rust"
                title="Remove"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={value.notes}
        onChange={(e) => onNotes(e.target.value)}
        rows={2}
        placeholder="Notes on how to use this document"
        className="mt-3 w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/40"
      />
    </div>
  )
}

function NewSetModal({ onClose }: { onClose: () => void }) {
  const { createSet } = useStore()
  const nav = useNavigate()
  const [framework, setFramework] = useState<PacketFramework | null>(null)
  const [grade, setGrade] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [uploads, setUploads] = useState<NewSetUploads>(empty)
  const [realFiles, setRealFiles] = useState<NewSetFile[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Which roles the Reference Library filled for the current framework/grade,
  // and which it lacks (force a manual upload for those).
  const [libraryRoles, setLibraryRoles] = useState<Set<LibraryRole>>(new Set())
  const [missingRoles, setMissingRoles] = useState<Set<LibraryRole>>(new Set())
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  const add = (key: LibraryRole, files: File[]) => {
    setUploads((u) => ({ ...u, [key]: { ...u[key], files: [...new Set([...u[key].files, ...files.map((f) => f.name)])] } }))
    setRealFiles((prev) => [
      ...prev.filter((x) => !(x.role === key && files.some((f) => f.name === x.file.name))),
      ...files.map((file) => ({ role: key, file })),
    ])
    // A manual upload clears both the library badge and the missing-note for this slot.
    setLibraryRoles((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setMissingRoles((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }
  const remove = (key: LibraryRole, fileName: string) => {
    setUploads((u) => ({ ...u, [key]: { ...u[key], files: u[key].files.filter((f) => f !== fileName) } }))
    setRealFiles((prev) => prev.filter((x) => !(x.role === key && x.file.name === fileName)))
  }
  const setNotes = (key: LibraryRole, notes: string) =>
    setUploads((u) => ({ ...u, [key]: { ...u[key], notes } }))

  // Prepopulate from the Reference Library whenever framework + grade are both
  // chosen. Each library document is downloaded into a real File so it rides
  // the exact same upload+ingest path as a hand-picked PDF; roles the library
  // lacks are flagged and left empty so the create gate forces an upload.
  useEffect(() => {
    if (framework === null || grade === null) return
    let alive = true
    setLoadingLibrary(true)
    setLibraryError(null)
    // Reset every slot — switching target replaces the whole document set.
    setUploads(empty)
    setRealFiles([])
    setLibraryRoles(new Set())
    setMissingRoles(new Set())
    ;(async () => {
      let files: LibraryFile[]
      try {
        files = (await api.listLibrary()).files.filter((f) => f.framework === framework && f.grade === grade)
      } catch (e) {
        if (!alive) return
        setLibraryError(e instanceof Error ? e.message : 'Could not read the Reference Library.')
        setMissingRoles(new Set(slots.map((s) => s.key)))
        setLoadingLibrary(false)
        return
      }
      const found = new Set<LibraryRole>()
      const filled: NewSetFile[] = []
      for (const slot of slots) {
        const doc = files.find((f) => f.role === slot.key)
        if (!doc) continue
        try {
          const res = await fetch(api.libraryFileUrl(framework, grade, slot.key, doc.fileName))
          if (!res.ok) throw new Error(String(res.status))
          const blob = await res.blob()
          filled.push({ role: slot.key, file: new File([blob], doc.fileName, { type: 'application/pdf' }) })
          found.add(slot.key)
        } catch {
          /* download failed — treat as missing so the user re-supplies it */
        }
      }
      if (!alive) return
      setRealFiles(filled)
      setUploads({
        standards: slotFor('standards', filled),
        progression: slotFor('progression', filled),
        items: slotFor('items', filled),
        unpacking: slotFor('unpacking', filled),
      })
      setLibraryRoles(found)
      setMissingRoles(new Set(slots.map((s) => s.key).filter((k) => !found.has(k))))
      setLoadingLibrary(false)
    })()
    return () => {
      alive = false
    }
  }, [framework, grade])

  // Keep the name in sync with the target until the user types their own.
  useEffect(() => {
    if (!nameEdited && framework !== null && grade !== null) {
      setName(`${frameworkLabelOf(framework)} — Grade ${grade}`)
    }
  }, [framework, grade, nameEdited])

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const id = await createSet(name.trim(), uploads, realFiles)
      onClose()
      nav(`/sets/${id}`)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create the standard set.')
      setCreating(false)
    }
  }

  const targetChosen = framework !== null && grade !== null
  const complete = targetChosen && name.trim().length > 1 && !loadingLibrary && slots.every((s) => uploads[s.key].files.length > 0)
  const missingCount = missingRoles.size

  return (
    <Modal open onClose={onClose} title="New Standard Set" wide>
      <div className="space-y-5">
        <div>
          <SectionLabel>Standards Framework</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FRAMEWORKS.map((fw) => (
              <Pick key={fw.key} on={framework === fw.key} onClick={() => setFramework(fw.key)}>
                {fw.label}
              </Pick>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Grade Level</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GRADES.map((g) => (
              <Pick key={g} on={grade === g} onClick={() => setGrade(g)}>
                Grade {g}
              </Pick>
            ))}
          </div>
        </div>

        {!targetChosen ? (
          <div className="rounded-xl border border-dashed border-hairline-2 px-4 py-6 text-center text-[12.5px] text-ink-3">
            Choose a framework and grade — the four documents are prefilled from the Reference Library, and anything
            missing is flagged for upload.
          </div>
        ) : (
          <>
            <div>
              <SectionLabel>Standard Set Name</SectionLabel>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameEdited(true)
                }}
                placeholder="e.g. CCSS Mathematics — Grade 5"
                className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
            </div>

            {/* While prefilling, hide the slots entirely: the prefill replaces
                the whole document set on completion, so any file added during
                the download window would be silently overwritten. No slots =
                no interaction window to lose. */}
            {loadingLibrary ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-accent/25 bg-accent-wash/40 px-4 py-6 text-[12.5px] text-ink-2">
                <span className="stage-pulse h-2 w-2 shrink-0 rounded-full bg-accent" />
                Prefilling documents from the Reference Library…
              </div>
            ) : (
              <>
                {libraryError && (
                  <div className="rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
                    {libraryError} Upload the four documents manually below.
                  </div>
                )}
                {!libraryError && missingCount > 0 && (
                  <div className="rounded-xl border border-amber-ink/30 bg-amber-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-amber-ink">
                    The Reference Library has no {[...missingRoles].map((r) => slots.find((s) => s.key === r)!.label).join(', ')} for{' '}
                    {frameworkLabelOf(framework!)}, Grade {grade}. Upload {missingCount === 1 ? 'it' : 'them'} below to continue —
                    and consider adding {missingCount === 1 ? 'it' : 'them'} to the Reference Library so the next set is complete.
                  </div>
                )}

                <div className="space-y-3">
                  {slots.map((s) => (
                    <UploadSlot
                      key={s.key}
                      label={s.label}
                      note={s.note}
                      value={uploads[s.key]}
                      fromLibrary={libraryRoles.has(s.key)}
                      missingNote={
                        missingRoles.has(s.key) && uploads[s.key].files.length === 0
                          ? `Not in the Reference Library for ${frameworkLabelOf(framework!)}, Grade ${grade} — upload it here.`
                          : null
                      }
                      onAdd={(files) => add(s.key, files)}
                      onRemove={(f) => remove(s.key, f)}
                      onNotes={(notes) => setNotes(s.key, notes)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {createError && (
          <div className="animate-rise rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
            {createError}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-hairline pt-4">
          <span className="max-w-80 text-[11.5px] leading-snug text-ink-3">
            Documents prefill from the Reference Library; add or replace any of them. AI extraction starts as soon as
            you create the set; released-items documents are held for scope generation. PDFs over the 100-page ingestion
            limit are split and re-uploaded automatically as multiple parts.
          </span>
          <Btn kind="primary" disabled={!complete || creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create Standard Set'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

/** Metadata slot (filenames + default note) for the files prefilled into one role. */
function slotFor(role: LibraryRole, filled: NewSetFile[]): UploadSlotValue {
  const names = filled.filter((f) => f.role === role).map((f) => f.file.name)
  return names.length === 0 ? emptySlot : { files: names, notes: LIBRARY_NOTE[role] }
}

/**
 * Live extraction state for the unpublished sets on the list. The old pill
 * read `set.ingesting`, which nothing ever set — so a freshly created set
 * looked completely inert for the minutes its extraction ran in the
 * background (and users reasonably concluded extraction never started).
 * This polls each draft set's latest job and keeps polling while any is
 * queued/running, so the list always tells the truth.
 */
function useDraftSetJobs(sets: { id: string; published: boolean }[]): Record<string, JobStatus> {
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({})
  const draftIds = sets.filter((s) => !s.published).map((s) => s.id).join(',')
  useEffect(() => {
    if (!draftIds) return
    let alive = true
    let timer: number | undefined
    const tick = async () => {
      const entries = await Promise.all(
        draftIds.split(',').map(async (id) => {
          try {
            return [id, await api.getSetJob(id)] as const
          } catch {
            return [id, undefined] as const // no job yet (or legacy set) — nothing to show
          }
        }),
      )
      if (!alive) return
      const next: Record<string, JobStatus> = {}
      for (const [id, job] of entries) if (job) next[id] = job
      setJobs(next)
      // Keep watching while anything is still working (or a brand-new set's
      // job row hasn't appeared yet); a settled board stops polling.
      const anyPending = entries.some(([, j]) => !j || j.status === 'queued' || j.status === 'running')
      if (anyPending) timer = window.setTimeout(() => void tick(), 5000)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [draftIds])
  return jobs
}

function setStatusPill(published: boolean, job: JobStatus | undefined) {
  if (published) return <Pill tone="green">published</Pill>
  if (job && (job.status === 'queued' || job.status === 'running')) {
    return (
      <Pill tone="accent">
        <span className="stage-pulse h-1.5 w-1.5 rounded-full bg-accent" />
        {job.status === 'queued' ? 'extraction queued' : `extracting ${job.stagesDone}/${job.totalStages}`}
      </Pill>
    )
  }
  if (job?.status === 'failed') return <Pill tone="red">extraction failed</Pill>
  if (job?.status === 'cancelled') return <Pill tone="amber">extraction stopped</Pill>
  return <Pill tone="amber">draft</Pill>
}

export default function SetsList() {
  const { sets } = useStore()
  const [newOpen, setNewOpen] = useState(false)
  const jobs = useDraftSetJobs(sets)
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Standard Sets</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
            A standard set is the official standards document plus its evidence corpus — released items, unpacking,
            progressions — each artifact carrying usage notes. Nothing enters generation unverified.
          </p>
        </div>
        <Btn kind="primary" onClick={() => setNewOpen(true)} className="shrink-0">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          New Standard Set
        </Btn>
      </div>
      <div className="mt-8 space-y-3">
        {sets.map((st) => {
          const blocking = st.artifacts.filter((a) => a.reviewStatus === 'blocked').length
          const unack = st.warnings.filter((w) => !w.acknowledged).length
          const job = jobs[st.id]
          const working = !!job && (job.status === 'queued' || job.status === 'running')
          return (
            <Link
              key={st.id}
              to={`/sets/${st.id}`}
              className="group block rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift) transition-all hover:shadow-(--shadow-float)"
            >
              <div className="flex items-center gap-3">
                <h2 className="font-display text-[17px] font-semibold text-ink group-hover:text-accent-deep">{st.name}</h2>
                {setStatusPill(st.published, job)}
                {blocking > 0 && <Pill tone="red">{blocking} blocking error</Pill>}
                {!working && unack > 0 && <Pill tone="amber">{unack} warnings to acknowledge</Pill>}
              </div>
              {working && (
                <p className="mt-1.5 text-[11.5px] text-ink-3">{job.stage}{job.log.length > 0 ? ` — ${job.log[job.log.length - 1].detail}` : ''}</p>
              )}
            </Link>
          )
        })}
      </div>
      {newOpen && <NewSetModal onClose={() => setNewOpen(false)} />}
    </div>
  )
}
