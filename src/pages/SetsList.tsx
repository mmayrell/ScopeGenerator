import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore, type NewSetFile, type NewSetUploads, type UploadSlotValue } from '../store'
import { Btn, Modal, Mono, Pill, SectionLabel } from '../ui'

const slots: { key: keyof NewSetUploads; label: string; note: string }[] = [
  { key: 'standards', label: 'Official Standard Document', note: 'The boundary authority and structure source — wording, limits, hierarchy.' },
  { key: 'progression', label: 'Progression Document', note: 'How topics develop across grades — placement, prerequisites, representations.' },
  { key: 'items', label: 'Released Items Document', note: 'The primary empirical evidence of what is assessed and how hard.' },
  { key: 'unpacking', label: 'Unpacking Document', note: 'Structured decomposition — the candidate-atom partition and default bounds.' },
]

const emptySlot: UploadSlotValue = { files: [], notes: '' }
const empty: NewSetUploads = { standards: emptySlot, progression: emptySlot, items: emptySlot, unpacking: emptySlot }

function UploadSlot({
  label,
  note,
  value,
  onAdd,
  onRemove,
  onNotes,
}: {
  label: string
  note: string
  value: UploadSlotValue
  onAdd: (files: File[]) => void
  onRemove: (name: string) => void
  onNotes: (notes: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const files = value.files
  return (
    <div className="rounded-xl border border-hairline bg-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-ink">{label}</div>
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
        placeholder="Notes on how to use this document — e.g. “Only use the Grade 5 content.”"
        className="mt-3 w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/40"
      />
    </div>
  )
}

function NewSetModal({ onClose }: { onClose: () => void }) {
  const { createSet } = useStore()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [uploads, setUploads] = useState<NewSetUploads>(empty)
  const [realFiles, setRealFiles] = useState<NewSetFile[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const add = (key: keyof NewSetUploads, files: File[]) => {
    setUploads((u) => ({ ...u, [key]: { ...u[key], files: [...new Set([...u[key].files, ...files.map((f) => f.name)])] } }))
    setRealFiles((prev) => [
      ...prev.filter((x) => !(x.role === key && files.some((f) => f.name === x.file.name))),
      ...files.map((file) => ({ role: key, file })),
    ])
  }
  const remove = (key: keyof NewSetUploads, name: string) => {
    setUploads((u) => ({ ...u, [key]: { ...u[key], files: u[key].files.filter((f) => f !== name) } }))
    setRealFiles((prev) => prev.filter((x) => !(x.role === key && x.file.name === name)))
  }
  const setNotes = (key: keyof NewSetUploads, notes: string) =>
    setUploads((u) => ({ ...u, [key]: { ...u[key], notes } }))

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

  const complete = name.trim().length > 1 && slots.every((s) => uploads[s.key].files.length > 0)

  return (
    <Modal open onClose={onClose} title="New Standard Set" wide>
      <div className="space-y-5">
        <div>
          <SectionLabel>Standard Set Name</SectionLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CCSS Mathematics — Grade 5"
            className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-ink-3 focus:border-accent/40"
          />
        </div>

        <div className="space-y-3">
          {slots.map((s) => (
            <UploadSlot
              key={s.key}
              label={s.label}
              note={s.note}
              value={uploads[s.key]}
              onAdd={(files) => add(s.key, files)}
              onRemove={(f) => remove(s.key, f)}
              onNotes={(notes) => setNotes(s.key, notes)}
            />
          ))}
        </div>

        {createError && (
          <div className="animate-rise rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">
            {createError}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-hairline pt-4">
          <span className="max-w-80 text-[11.5px] leading-snug text-ink-3">
            One or more PDFs per role, each with your notes on how the documents should be used. Ingestion runs at
            publish time.
          </span>
          <Btn kind="primary" disabled={!complete || creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create Standard Set'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default function SetsList() {
  const { sets } = useStore()
  const [newOpen, setNewOpen] = useState(false)
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
          return (
            <Link
              key={st.id}
              to={`/sets/${st.id}`}
              className="group block rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift) transition-all hover:shadow-(--shadow-float)"
            >
              <div className="flex items-center gap-3">
                <h2 className="font-display text-[17px] font-semibold text-ink group-hover:text-accent-deep">{st.name}</h2>
                {st.published ? <Pill tone="green">published</Pill> : <Pill tone="amber">draft</Pill>}
                {blocking > 0 && <Pill tone="red">{blocking} blocking error</Pill>}
                {unack > 0 && <Pill tone="amber">{unack} warnings to acknowledge</Pill>}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-4 text-[12.5px]">
                <div>
                  <div className="text-ink-3">Hierarchy</div>
                  <div className="mt-0.5 text-ink-2">{st.hierarchyLevels.join(' → ')}</div>
                </div>
                <div>
                  <div className="text-ink-3">Coding</div>
                  <Mono className="mt-0.5 block truncate text-ink-2">{st.codingScheme.split(' · ')[0]}</Mono>
                </div>
                <div>
                  <div className="text-ink-3">Artifacts</div>
                  <div className="mt-0.5 text-ink-2">
                    {st.artifacts.length} uploaded · {st.items.length} items
                  </div>
                </div>
                <div>
                  <div className="text-ink-3">Updated</div>
                  <div className="mt-0.5 text-ink-2">{st.updated}</div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      {newOpen && <NewSetModal onClose={() => setNewOpen(false)} />}
    </div>
  )
}
