import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Btn, Modal, Mono, Pill, SectionLabel } from '../ui'
import type { ExemplarAsset, FrameworkDoc, FrameworkSection } from '../types'

// ---------- lightweight renderer ('## ' headings · '- ' bullets · blank-line paragraphs) ----------

function RenderedDoc({ content }: { content: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let para: string[] = []
  let key = 0
  const flushBullets = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={key++} className="my-2 space-y-1.5 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 font-display text-[14px] leading-relaxed text-ink">
            <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>{b}</span>
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }
  const flushPara = () => {
    if (!para.length) return
    blocks.push(
      <p key={key++} className="my-2.5 font-display text-[14px] leading-relaxed text-ink">
        {para.join(' ')}
      </p>,
    )
    para = []
  }
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flushBullets(); flushPara()
      blocks.push(
        <h3 key={key++} className="mt-6 mb-2 border-b border-hairline pb-1.5 font-display text-[16px] font-semibold text-ink first:mt-0">
          {line.slice(3)}
        </h3>,
      )
    } else if (line.startsWith('- ')) {
      flushPara()
      bullets.push(line.slice(2))
    } else if (line.trim() === '') {
      flushBullets(); flushPara()
    } else {
      flushBullets()
      para.push(line)
    }
  }
  flushBullets(); flushPara()
  return <div>{blocks}</div>
}

// ---------- section card ----------

const LockBadge = ({ updated }: { updated: string }) => (
  <Pill tone="green">
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9a1 1 0 011 1v5a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
    locked — in force since {updated}
  </Pill>
)

function SectionCard({
  section,
  onSave,
}: {
  section: FrameworkSection
  onSave: (next: FrameworkSection) => Promise<void>
}) {
  const [reading, setReading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(section.name)
  const [draftContent, setDraftContent] = useState(section.content)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const openEdit = () => {
    setDraftName(section.name)
    setDraftContent(section.content)
    setEditing(true)
  }

  const save = async (name: string, content: string) => {
    setSaving(true)
    try {
      await onSave({ ...section, name, content })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
      <div className="flex items-center justify-between gap-3">
        <Pill tone={section.kind === 'engine' ? 'accent' : 'night'}>{section.kind}</Pill>
        <div className="flex items-center gap-2">
          <LockBadge updated={section.updated} />
          <Mono className="text-[12px] text-ink-3">{section.version}</Mono>
        </div>
      </div>
      <h2 className="mt-3 font-display text-[16px] leading-snug font-semibold text-ink">{section.name}</h2>
      <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-ink-2">
        {section.content.replace(/^## .*$/gm, '').replace(/^- /gm, '').trim().slice(0, 220)}…
      </p>
      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3.5">
        <Btn onClick={() => setReading(true)}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 7S3.5 3 7 3s5.5 4 5.5 4S10.5 11 7 11 1.5 7 1.5 7z" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="7" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Read
        </Btn>
        <Btn onClick={openEdit}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Edit
        </Btn>
        <Btn onClick={() => fileRef.current?.click()}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 9.5V2M4 4.5L7 1.5l3 3M2 11.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Upload
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void f.text().then((text) => {
              if (text.trim()) void save(section.name, text)
            })
          }}
        />
        <span className="ml-auto text-[10.5px] leading-snug text-ink-3">
          Upload replaces the text (.md / .txt) and re-locks it
        </span>
      </div>

      <Modal open={reading} onClose={() => setReading(false)} title={section.name} wide>
        <div className="mb-4 flex items-center gap-2">
          <Pill tone={section.kind === 'engine' ? 'accent' : 'night'}>{section.kind}</Pill>
          <Mono className="text-[11.5px] text-ink-3">{section.version} · in force since {section.updated}</Mono>
        </div>
        <RenderedDoc content={section.content} />
        <p className="mt-6 border-t border-hairline pt-3 text-[11.5px] leading-relaxed text-ink-3">
          The tool runs under this document exactly as written — every generation stage receives it verbatim and
          strictly follows it. It stays locked until the next edit; edits bump the version, and existing scopes keep
          the version they were generated under.
        </p>
      </Modal>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit — ${section.name}`} wide>
        <div className="space-y-4">
          <div>
            <SectionLabel>Document Name</SectionLabel>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-2.5 text-[13.5px] outline-none focus:border-accent/40"
            />
          </div>
          <div>
            <SectionLabel>Content</SectionLabel>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={20}
              className="mt-2 w-full rounded-xl border border-hairline bg-panel px-3.5 py-3 font-mono text-[12px] leading-relaxed outline-none focus:border-accent/40"
            />
            <p className="mt-1.5 text-[11px] text-ink-3">Format: “## ” for headings, “- ” for bullets, blank lines between paragraphs.</p>
          </div>
          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <span className="max-w-96 text-[11.5px] leading-snug text-ink-3">
              Saving bumps {section.version} and re-locks the document — generation follows the new text from the next
              run onward.
            </span>
            <Btn kind="primary" disabled={saving || !draftContent.trim() || !draftName.trim()} onClick={() => void save(draftName.trim(), draftContent)}>
              {saving ? 'Saving…' : 'Save & Lock'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ---------- exemplar register ----------

function RegisterCard({
  register,
  onSave,
}: {
  register: ExemplarAsset[]
  onSave: (next: ExemplarAsset[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ExemplarAsset[]>(register)
  const [saving, setSaving] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<number | null>(null)

  const patch = (i: number, p: Partial<ExemplarAsset>) =>
    setDraft((d) => d.map((e, j) => (j === i ? { ...e, ...p } : e)))

  const save = async (next: ExemplarAsset[]) => {
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="flex items-end justify-between">
        <div>
          <SectionLabel>Exemplar Asset Register</SectionLabel>
          <p className="mt-1 max-w-2xl text-[12.5px] text-ink-2">
            Every document linked from the engine and doctrine BrainLifts. Resolved assets serve as few-shot exemplars
            in atomization and card generation; unresolved entries are flagged, non-blocking.
          </p>
        </div>
        <Btn onClick={() => { setDraft(register); setEditing(true) }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Edit
        </Btn>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-hairline bg-paper/60 text-[11px] tracking-wide text-ink-3 uppercase">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-3 py-2.5 font-semibold">Asset</th>
              <th className="px-3 py-2.5 font-semibold">Linked From</th>
              <th className="px-3 py-2.5 font-semibold">Role</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {register.map((e, i) => (
              <tr key={e.n} className="border-b border-hairline last:border-0">
                <td className="px-4 py-2.5"><Mono className="text-ink-3">{e.n}</Mono></td>
                <td className="px-3 py-2.5 font-medium text-ink">{e.asset}</td>
                <td className="px-3 py-2.5 text-ink-2">{e.linkedFrom}</td>
                <td className="px-3 py-2.5 text-ink-2">{e.role}</td>
                <td className="px-3 py-2.5">
                  {e.status === 'resolved' ? (
                    <div>
                      <Pill tone="green">resolved</Pill>
                      {e.uploadedFile && <Mono className="mt-1 block text-[10.5px] text-ink-3">{e.uploadedFile}</Mono>}
                    </div>
                  ) : (
                    <Pill tone="amber">pending upload</Pill>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {e.status === 'pending' && (
                    <Btn
                      className="!px-2.5 !py-1 !text-[11.5px]"
                      onClick={() => {
                        uploadTarget.current = i
                        uploadRef.current?.click()
                      }}
                    >
                      Upload
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <input
          ref={uploadRef}
          type="file"
          accept=".pdf,.md,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            const i = uploadTarget.current
            e.target.value = ''
            uploadTarget.current = null
            if (!f || i === null) return
            void save(register.map((entry, j) => (j === i ? { ...entry, status: 'resolved', uploadedFile: f.name } : entry)))
          }}
        />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit — Exemplar Asset Register" wide>
        <div className="space-y-3">
          {draft.map((e, i) => (
            <div key={i} className="rounded-xl border border-hairline bg-panel p-3.5">
              <div className="flex items-center gap-2">
                <Mono className="text-[11px] text-ink-3">{i + 1}</Mono>
                <input
                  value={e.asset}
                  onChange={(ev) => patch(i, { asset: ev.target.value })}
                  placeholder="Asset"
                  className="flex-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] font-medium outline-none focus:border-accent/40"
                />
                <select
                  value={e.status}
                  onChange={(ev) => patch(i, { status: ev.target.value as ExemplarAsset['status'] })}
                  className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-[12px] outline-none"
                >
                  <option value="resolved">resolved</option>
                  <option value="pending">pending</option>
                </select>
                <button
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  className="cursor-pointer rounded p-1 text-ink-3 transition-colors hover:bg-ink/5 hover:text-rust"
                  title="Remove entry"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  value={e.linkedFrom}
                  onChange={(ev) => patch(i, { linkedFrom: ev.target.value })}
                  placeholder="Linked from"
                  className="rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/40"
                />
                <input
                  value={e.role}
                  onChange={(ev) => patch(i, { role: ev.target.value })}
                  placeholder="Role (e.g. Few-shot anchor: Stage 3)"
                  className="rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/40"
                />
              </div>
            </div>
          ))}
          <Btn onClick={() => setDraft((d) => [...d, { n: d.length + 1, asset: '', linkedFrom: '', role: '', status: 'pending' }])}>
            + Add entry
          </Btn>
          <div className="flex items-center justify-end border-t border-hairline pt-4">
            <Btn kind="primary" disabled={saving || draft.some((e) => !e.asset.trim())} onClick={() => void save(draft)}>
              {saving ? 'Saving…' : 'Save & Lock'}
            </Btn>
          </div>
        </div>
      </Modal>
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

  const persist = async (next: FrameworkDoc) => {
    setError(null)
    try {
      setDoc(await api.saveFramework(next))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the framework.')
      throw e
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Engine & Doctrine</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        The theoretical framework the tool runs under — not evidence about any standard set, but the rules every
        generation strictly follows, written to work with any state's standards. Each document is locked as written
        until you edit or upload a replacement; every generated scope records the versions it ran under.
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
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard section={doc.engine} onSave={(next) => persist({ ...doc, engine: next })} />
            <SectionCard section={doc.doctrine} onSave={(next) => persist({ ...doc, doctrine: next })} />
          </div>
          <RegisterCard register={doc.register} onSave={(next) => persist({ ...doc, register: next })} />
        </>
      )}
    </div>
  )
}
