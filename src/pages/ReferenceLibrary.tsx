import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, NotFoundError } from '../api'
import { FRAMEWORKS } from '../packets'
import type { LibraryFile, LibraryRole, PacketFramework } from '../types'
import { Btn, Mono, SectionLabel } from '../ui'

// Reference Library — the document repository behind the tool. For each
// framework and grade (3–8), the four document sets a standard set is built
// from are uploaded once and live here: official standards, progression,
// released items, and unpacking documents.

const GRADES = [3, 4, 5, 6, 7, 8]

const SLOTS: { role: LibraryRole; label: string; note: string }[] = [
  { role: 'standards', label: 'Official Standard Document', note: 'The boundary authority and structure source — wording, limits, hierarchy.' },
  { role: 'progression', label: 'Progression Document', note: 'How topics develop across grades — placement, prerequisites, representations.' },
  { role: 'items', label: 'Released Items Document', note: 'The primary empirical evidence of what is assessed and how hard.' },
  { role: 'unpacking', label: 'Unpacking Document', note: 'Structured decomposition — the candidate-atom partition and default bounds.' },
]

const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      on ? 'border-accent/40 bg-accent-wash text-accent-deep' : 'border-hairline bg-panel text-ink-2 hover:border-hairline-2'
    }`}
  >
    {children}
  </button>
)

const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export default function ReferenceLibrary() {
  const [files, setFiles] = useState<LibraryFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [framework, setFramework] = useState<PacketFramework>('ccss')
  const [grade, setGrade] = useState(3)

  const refresh = useCallback(async () => {
    try {
      const { files: all } = await api.listLibrary()
      setFiles(all)
      setError(null)
    } catch (e) {
      if (e instanceof NotFoundError) {
        // Deploy skew: an older API without the library routes = an empty library.
        setFiles([])
        setError(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Could not load the library.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const current = useMemo(
    () => (files ?? []).filter((f) => f.framework === framework && f.grade === grade),
    [files, framework, grade],
  )

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Reference Library</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        The document repository behind the tool. For each framework and grade, the four document sets a standard set is
        built from are uploaded once and live here.
      </p>

      {error && (
        <div className="animate-rise mt-4 rounded-xl border border-rust/25 bg-rust-wash px-4 py-2.5 text-[12.5px] leading-relaxed text-rust">{error}</div>
      )}

      <div className="mt-8">
        <SectionLabel>Standards Framework</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FRAMEWORKS.map((fw) => (
            <Chip key={fw.key} on={framework === fw.key} onClick={() => setFramework(fw.key)}>
              {fw.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <SectionLabel>Grade Level</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GRADES.map((g) => (
            <Chip key={g} on={grade === g} onClick={() => setGrade(g)}>
              Grade {g}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SLOTS.map((slot) => (
          <LibrarySlot
            key={slot.role}
            framework={framework}
            grade={grade}
            role={slot.role}
            label={slot.label}
            note={slot.note}
            files={current.filter((f) => f.role === slot.role)}
            loaded={files !== null}
            onChanged={() => void refresh()}
          />
        ))}
      </div>
      <div className="h-16" />
    </div>
  )
}

function LibrarySlot({
  framework,
  grade,
  role,
  label,
  note,
  files,
  loaded,
  onChanged,
}: {
  framework: PacketFramework
  grade: number
  role: LibraryRole
  label: string
  note: string
  files: LibraryFile[]
  loaded: boolean
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  const upload = async (picked: FileList | null) => {
    const pdfs = [...(picked ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    if (pdfs.length === 0) {
      setSlotError('Only PDF documents can live in the library.')
      return
    }
    setUploading(true)
    setSlotError(null)
    try {
      for (const file of pdfs) {
        await api.uploadLibraryFile(framework, grade, role, file.name, file)
      }
      onChanged()
    } catch (e) {
      setSlotError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-(--shadow-lift)">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink">{label}</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">{note}</p>
        </div>
        <Btn disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </Btn>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {slotError && (
        <div className="animate-rise mt-3 rounded-lg border border-rust/25 bg-rust-wash px-3 py-2 text-[11.5px] leading-relaxed text-rust">{slotError}</div>
      )}

      <div className="mt-3 space-y-1.5">
        {files.map((f) => (
          <LibraryFileRow key={f.fileName} file={f} onChanged={onChanged} onError={setSlotError} />
        ))}
        {files.length === 0 && (
          <p className="rounded-lg border border-dashed border-hairline-2 px-3 py-2.5 text-[11.5px] text-ink-3">
            {loaded ? 'Nothing filed here yet.' : 'Loading…'}
          </p>
        )}
      </div>
    </div>
  )
}

function LibraryFileRow({ file, onChanged, onError }: { file: LibraryFile; onChanged: () => void; onError: (e: string | null) => void }) {
  const [armed, setArmed] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      await api.deleteLibraryFile(file.framework, file.grade, file.role, file.fileName)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete the document.')
      setDeleting(false)
      setArmed(false)
    }
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-hairline bg-paper/60 px-3 py-2">
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2.5h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-13a1 1 0 011-1zM12 2.5v3h3" />
      </svg>
      <a
        href={api.libraryFileUrl(file.framework, file.grade, file.role, file.fileName)}
        target="_blank"
        rel="noreferrer"
        title={`Open ${file.fileName}`}
        className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink hover:text-accent-deep hover:underline"
      >
        {file.fileName}
      </a>
      <Mono className="shrink-0 text-[10.5px] text-ink-3">{sizeLabel(file.size)}</Mono>
      {file.updated && (
        <span className="shrink-0 text-[10.5px] text-ink-3">{new Date(file.updated).toLocaleDateString()}</span>
      )}
      {armed ? (
        <span className="flex shrink-0 items-center gap-1">
          <Btn kind="danger" disabled={deleting} onClick={() => void remove()}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Btn>
          <Btn onClick={() => setArmed(false)}>Keep</Btn>
        </span>
      ) : (
        <button
          onClick={() => setArmed(true)}
          title="Delete this document"
          className="shrink-0 cursor-pointer rounded-md p-1 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rust"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6h12M8.5 6V4.5A1 1 0 019.5 3.5h1a1 1 0 011 1V6m3 0l-.7 9.5a1.5 1.5 0 01-1.5 1.4H7.7a1.5 1.5 0 01-1.5-1.4L5.5 6M8.3 9v5m3.4-5v5" />
          </svg>
        </button>
      )}
    </div>
  )
}
