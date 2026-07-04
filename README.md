# Scope Generator

An implementation of the **Scope Generation Tool** system specification (v2 draft): the tool that turns a standard set's evidence corpus into a fully scoped course — strand-coherent units of atomized lessons, each specified by a fixed 13-field card, generated under Direct Instruction doctrine, with every field evidence-locked to its sources and every consequential decision reasoned on the card itself.

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
| §7 Card field rules | `ScopeView` — the fixed 13-field card with per-field provenance popovers, inferred flags, generated ceiling exemplars (never-empty Released items), Decision record with rule IDs |
| §8 Rerun, locking, versioning | Rerun dialog with guardrail decline + cited criterion + logged override; lock toggles; propose → review → accept revision flow with diff, ripple preview, and iteration rounds; immutable version history |
| §9 Auto-QC | QC report modal — all ten checks, flags surfaced not buried |
| §10 Admin experience | Set configuration, review screens (standards tree with limits, item bank with characterizations, alignment-confirmation queue, lexicons), warning acknowledgment, gated publish |
| §11 User experience | Scope request (course / standard / topic with mapping confirmation), streaming generation, public-view scopes |
| §12 / Appendix F | Engine & doctrine page with versions and the Exemplar Asset Register |

## Architecture

- **`src/types.ts`** — the §5 data model, UI-agnostic.
- **`src/data/seed.ts`** — demo corpus: standards trees with in-document limits, item records with vision characterizations and P2 scope classes, lexicons, the full-course scope with 12 complete cards.
- **`src/store.tsx`** — a context store exposing the domain actions (publish gating, alignment confirmation, lock, guardrailed rerun, proposal lifecycle). This is the seam where a real backend slots in: every action maps 1:1 to an API call, and the generation simulation in `NewScope` maps to the real queued pipeline job with per-stage checkpoints.
- **`src/pages/`** — Dashboard, SetsList, SetDetail (admin), NewScope (request + staged run), ScopeView (units → 13-field cards), System (engine/doctrine).
- **`src/ui.tsx`** — primitives: citation chips + provenance popover, released-item renderer, generated-exemplar renderer (with the mandatory *Generated exemplar — not a released item* label), modals.

Stack: Vite · React 19 · TypeScript · Tailwind v4 · React Router. No backend required; all state is in-memory.

## What a real deployment adds

The heavy lifting the spec assigns to AI stages — Tier-2 item extraction, vision characterization, Stage 2–5 generation with evidence-locking validators — is stubbed behind the store's action seam. The card schema, precedence chain, guardrail logic, Editing-Splits mapping for performance reports, and QC taxonomy are all implemented as specified and would be driven by the pipeline's real outputs.
