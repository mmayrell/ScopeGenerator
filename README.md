# Scope Generator

An implementation of the **Scope Generation Tool** system specification (v2 draft): the tool that turns a standard set's evidence corpus into a fully scoped course — strand-coherent units of atomized lessons, each specified by a fixed 14-field card, generated under Direct Instruction doctrine, with every field evidence-locked to its sources and every consequential decision reasoned on the card itself.

## Running it

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build
```

## What's implemented

The complete product surface from the spec, as a React app running on a client-side data layer seeded with rich demo content (a published **CCSS Mathematics — Grade 4** set with a generated full-course scope, and a draft **TEKS Grade 6** set mid-ingestion). The demo content is drawn from the spec's own worked illustration (the 4.NBT.5 flagship card, Appendix B.1) so every screen demonstrates the doctrine faithfully.

| Spec section | Where it lives |
|---|---|
| §3 Governing policies (P1–P10) | Enforced/surfaced throughout: contradiction handling on cards, D14 flags, P8 assessment format, P10 publish gating |
| §4 Artifact roles & ingestion | Standard set detail → Artifacts (roles, usage notes, tiers, coverage declarations, blocking errors) |
| §5 Data model | `src/types.ts` — StandardSet, Artifact, ItemRecord, Lesson, DecisionEntry, Citation, Proposal, RerunEvent-shaped history… |
| §6 Generation pipeline | New scope → staged Stage 2–6 progress, checkpoint framing |
| §7 Card field rules | `ScopeView` — the fixed 14-field card with per-field provenance popovers, inferred flags, generated ceiling exemplars (never-empty Released items), Decision record with rule IDs |
| §8 Revision & versioning | Propose → review → accept revision flow with diff, ripple preview, and iteration rounds; guardrail decline + cited criterion + logged override; immutable version history |
| §9 Auto-QC | QC report modal — ten programmatic checks (incl. objective integrity and released-item coverage), flags surfaced not buried |
| §10 Admin experience | Set configuration, review screens (standards tree with limits, item bank with characterizations, alignment-confirmation queue), warning acknowledgment, gated publish |
| §11 User experience | Scope request (course / standard / topic with mapping confirmation), streaming generation, public-view scopes |
| §11.2 Released Item Repository Generator | Standalone web-hunting tool: built-in CCSS/TEKS/SOL/B.E.S.T. catalog (grades 3–8, researched years 2017+) → backend research agent finds genuine released items online via web search → sourced text facsimiles, coverage summary, gaps, Word export |
| §12 / Appendix F | Engine & doctrine page — fixed documents with versions and descriptions |

## Architecture

- **`src/types.ts`** — the §5 data model, UI-agnostic.
- **`src/data/seed.ts`** — demo corpus: standards trees with in-document limits, item records with vision characterizations and P2 scope classes, lexicons, the full-course scope with 12 demo cards (the flagship card carries the full 14-field shape; the rest predate the Objectives field).
- **`src/store.tsx`** — a context store exposing the domain actions (publish gating, alignment confirmation, lock, guardrailed rerun, proposal lifecycle). This is the seam where a real backend slots in: every action maps 1:1 to an API call, and the generation simulation in `NewScope` maps to the real queued pipeline job with per-stage checkpoints.
- **`src/pages/`** — Dashboard, SetsList, SetDetail (admin), NewScope (request + staged run), ScopeView (units → 14-field cards), EvidencePackets (standalone web-hunting tool), System (engine/doctrine).
- **`src/ui.tsx`** — primitives: citation chips + provenance popover, released-item renderer, generated-exemplar renderer (with the mandatory *Generated exemplar — not a released item* label), modals.
- **`api/`** — the Azure Functions backend (Node/TypeScript, queue-checkpointed generation, ingestion, and packet-hunt pipelines; Claude integration). The binding contract is `docs/backend-architecture.md`.
- **`infra/`** — provisioning and deploy scripts. Every push to `main` deploys to production (see `CLAUDE.md`).

Stack: Vite · React 19 · TypeScript · Tailwind v4 · React Router; Azure Functions + Storage; Claude (`claude-fable-5`) for extraction, generation, and the evidence-packet web hunts.
