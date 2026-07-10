import { Link, useNavigate } from 'react-router-dom'
import { Spark } from '../ui'
import heroBanner from '../assets/hero-banner.png'

const workspace = [
  {
    n: '01',
    title: 'Item Repository',
    text: 'A research assistant that hunts the public web for released items.',
    to: '/packets',
  },
  {
    n: '02',
    title: 'Reference Library',
    text: 'The document shelf — four roles, filed by framework and grade.',
    to: '/library',
  },
  {
    n: '03',
    title: 'Standard Sets',
    text: 'The evidence libraries scopes are built from. Create, curate, publish.',
    to: '/sets',
  },
  {
    n: '04',
    title: 'Scope',
    text: 'Evidence-locked course designs, unit by unit, card by card.',
    to: '/scopes',
  },
]

export default function Home() {
  const nav = useNavigate()
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

      {/* closing line */}
      <div className="px-6 pb-16 lg:px-10">
        <p className="m-0 text-center text-[20px] font-bold italic text-black lg:text-[24px]">
          Standards in. Curriculum out. Zero humans in the loop.
        </p>
      </div>
    </div>
  )
}
