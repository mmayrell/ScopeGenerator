import { exemplarRegister, systemArtifacts } from '../data/seed'
import { Mono, Pill, SectionLabel } from '../ui'

export default function System() {
  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">Engine & Doctrine</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Versioned system artifacts — not evidence about any standard set, but the rules the evidence is processed under.
        Every generated scope records the versions it ran under.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4">
        {systemArtifacts.map((a) => (
          <div key={a.id} className="rounded-2xl border border-hairline bg-panel p-5 shadow-(--shadow-lift)">
            <div className="flex items-center justify-between">
              <Pill tone={a.kind === 'engine' ? 'accent' : 'night'}>{a.kind}</Pill>
              <Mono className="text-[12px] text-ink-3">{a.version}</Mono>
            </div>
            <h2 className="mt-3 font-display text-[16px] leading-snug font-semibold text-ink">{a.name}</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{a.note}</p>
            <div className="mt-3 border-t border-hairline pt-2.5 text-[11.5px] text-ink-3">Published {a.published} · existing scopes keep their recorded versions</div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <SectionLabel>Exemplar Asset Register (Appendix F — living)</SectionLabel>
        <p className="mt-1 max-w-2xl text-[12.5px] text-ink-2">
          Every document linked from engine and doctrine artifacts, auto-extracted at ingestion. Resolved assets serve as
          few-shot exemplars in Stage 3 and Stage 5 prompt assembly. Unresolved entries are flagged, non-blocking.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-panel shadow-(--shadow-lift)">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-hairline bg-paper/60 text-[11px] tracking-wide text-ink-3 uppercase">
                <th className="px-4 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">Asset</th>
                <th className="px-3 py-2.5 font-semibold">Linked from</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {exemplarRegister.map((e) => (
                <tr key={e.n} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2.5"><Mono className="text-ink-3">{e.n}</Mono></td>
                  <td className="px-3 py-2.5 font-medium text-ink">{e.asset}</td>
                  <td className="px-3 py-2.5 text-ink-2">{e.linkedFrom}</td>
                  <td className="px-3 py-2.5 text-ink-2">{e.role}</td>
                  <td className="px-3 py-2.5">{e.status === 'resolved' ? <Pill tone="green">resolved</Pill> : <Pill tone="amber">pending upload</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
