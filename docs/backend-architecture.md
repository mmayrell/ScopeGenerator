# ScopeGenerator Backend — Architecture & API Contract

This document is the **binding contract** between the frontend, the backend, and the infrastructure.
When in doubt, follow this document. The domain model in `src/types.ts` (spec §5) remains the shared
vocabulary; the backend keeps a verbatim copy (see "Shared types").

## Overview

```
Browser (React SPA, Azure Static Web Apps Free)
   │  fetch + x-access-code header, polls job status during generation
   ▼
Azure Functions (Node 20+, TS, v4 model, Consumption)   ←  ANTHROPIC_API_KEY app setting
   │  HTTP API (all store actions)      │ queue trigger (pipeline worker)
   ▼                                    ▼
Azure Storage account
   ├─ Tables:  entities (set/scope index), jobs (pipeline state)
   ├─ Blobs:   data (full JSON docs, version snapshots, checkpoints), uploads (PDFs)
   └─ Queue:   genjobs (pipeline messages)
```

- Big JSON documents (sets, scopes) live in **Blob storage**; **Table storage** holds the
  index/metadata rows and job state (Table entities have a 64KB-per-property/1MB-per-entity limit,
  so full docs don't fit reliably).
- Whole-course generation is a **queued job** with per-stage and per-unit checkpoints (spec §12),
  surfaced to the UI via a polled job-status endpoint.

## Azure resources (provisioned by `infra/provision.ps1`, names recorded in `infra/azure-resources.json`)

| Resource | Name pattern | Notes |
|---|---|---|
| Resource group | `scopegen-rg` | region `eastus2` |
| Storage account | `scopegenst<suffix>` | StorageV2; tables `entities`, `jobs`; queue `genjobs`; containers `data`, `uploads` |
| Function App | `scopegen-api-<suffix>` | Consumption, Node, Functions v4; CORS allows SWA origin + `http://localhost:5173` |
| Static Web App | `scopegen-web` | Free tier, deployed via deployment token (no GitHub Action) |

`infra/azure-resources.json` (gitignored) shape:
`{ "resourceGroup", "storageAccount", "functionApp", "functionAppUrl", "staticWebApp", "staticWebAppUrl" }`

## Environment variables (Function App settings; local: `api/local.settings.json`, gitignored)

| Name | Meaning |
|---|---|
| `AzureWebJobsStorage` | Storage connection string — **also used by the data layer** (tables/blobs/queues) |
| `ANTHROPIC_API_KEY` | Claude API key. Set later via `infra/set-secrets.ps1` reading `.secrets/anthropic-key.txt` |
| `CLAUDE_MODEL` | default `claude-fable-5` |
| `CLAUDE_EFFORT` | optional; forces one effort level (low/medium/high/xhigh/max) for all Claude calls |
| `APP_ACCESS_CODE` | shared access code checked on every request |

Frontend build-time env: `VITE_API_BASE` — e.g. `https://scopegen-api-x.azurewebsites.net/api`.
Default when unset: `http://localhost:7071/api` in dev, same-origin `/api` otherwise.

## Authentication

Every endpoint **except** `GET /api/health` requires header `x-access-code: <APP_ACCESS_CODE>`.
Wrong/missing → `401 {"error":"unauthorized"}`. The SPA prompts once, stores the code in
`localStorage['scopegen-access-code']`, sends it on every call, and re-prompts on any 401.
Exception: `GET /api/item-image/{setId}/{itemId}` also accepts the code as `?code=` — browsers
cannot attach headers to `<img>` requests.

## Shared types

- `api/src/domain/types.ts` is a **verbatim copy** of `src/types.ts`, with the contract edits below.
- The same edits are applied to `src/types.ts` (frontend):
  1. `Scope.status`: `'complete' | 'generating' | 'paused' | 'failed'`
  2. `Proposal.status`: `'drafting' | 'draft' | 'accepted' | 'abandoned'`
  3. `Proposal` gains optional `working?: boolean` (true while Claude is drafting/iterating)
  4. `Scope` gains optional `error?: string` (populated when status === 'failed')

## HTTP API (all JSON unless noted; base path `/api`)

| Method & path | Body → Response | Notes |
|---|---|---|
| `GET /health` | → `{ ok: true, version: string }` | no auth |
| `GET /bootstrap` | → `{ sets: StandardSet[], scopes: Scope[] }` | initial load |
| `GET /sets/{id}` | → `StandardSet` | |
| `POST /sets` | `{ name, uploads: NewSetUploads }` → `{ id }` | mirrors `createSet`; `NewSetUploads` as in current `store.tsx` |
| `PUT /uploads/{setId}/{role}/{fileName}` | raw bytes (`application/pdf`) → `{ blobPath }` | stores to `uploads` container; frontend calls it per selected file **after** `POST /sets` returns the id (the path needs the server-generated setId); the frontend then calls `POST /sets/{id}/ingest` to start extraction |
| `POST /sets/{id}/acknowledge-warning` | `{ warningId, resolution?, resolvedBy? }` → `StandardSet` | records how the user resolved the conflict/gap (AI-suggested default or custom) |
| `POST /sets/{id}/confirm-alignment` | `{ itemId }` → `StandardSet` | |
| `POST /sets/{id}/resolve-artifact` | `{ artifactId }` → `StandardSet` | |
| `POST /sets/{id}/ingest` | → `{ jobId }` (202) | extraction phase: standards tree + item bank (with question screenshots) + cross-document scope-conflict pass. Called automatically after the uploads land at creation; also the retry path. Idempotent with in-flight ingest jobs |
| `GET /sets/{id}/job` | → `JobStatus` | polled during extraction |
| `GET /item-image/{setId}/{itemId}` | → `image/png` | question screenshot; auth via header or `?code=` |
| `POST /sets/{id}/publish` | → `{ set: StandardSet }` | seeded sets (no uploads) publish immediately; uploaded sets 409 unless extraction completed and every warning is resolved. Idempotent |
| `GET /framework` | → `FrameworkDoc` | the fixed engine/doctrine documents (read-only — no PUT; new versions ship with the tool). The payload keeps a legacy `register: []` so pre-removal bundles render an empty exemplar register during deploy skew |
| `POST /scopes` | `{ setId, setIds?, mode, params }` → `{ id, jobId }` | creates scope doc (status `generating`), enqueues `generate` job |
| `GET /scopes/{id}` | → `Scope` | |
| `GET /scopes/{id}/job` | → `JobStatus` (below) | polled by the generation screen |
| `POST /scopes/{id}/pause-generation` | → `{ jobId }` (202) | cooperative: flags the job; workers halt at the next checkpoint, scope → `paused` |
| `POST /scopes/{id}/resume-generation` | → `{ jobId }` (202) | re-enqueues the same job; finished checkpoints are skipped. Supersedes provably dead rows (no log progress in 15 min) |
| `POST /scopes/{id}/cancel-generation` | → `{ jobId }` (202) | settles the scope `failed`; checkpoints are kept, so resume can still revive it |
| `POST /scopes/{id}/rerun` | `{ target, mode, override? }` → `{ ok, message, guardrail? , jobId? }` | guardrail check is synchronous & data-driven (see Guardrails); on ok, scope → `generating`, enqueue `rerun` job; unknown modes 400 |
| `POST /scopes/{id}/reports` | `{ target, text }` → `Proposal` (status `drafting`, `working: true`) | enqueues `proposal` job (Claude drafts the change set); UI polls the scope |
| `POST /scopes/{id}/proposals/{pid}/iterate` | `{ feedback }` → `Proposal` (`working: true`) | enqueues `iterate` job; the round is appended when done |
| `POST /scopes/{id}/proposals/{pid}/resolve` | `{ accept: boolean }` → `Scope` | accept: bump version, snapshot, history entry, enqueue `apply-proposal` job (Claude rewrites targeted lesson fields); abandon: mark abandoned |
| `DELETE /scopes/{id}` | → `{ ok: true }` | |
| `POST /packets` | `{ title, framework, frameworkLabel, grades, years, standards: PacketStandard[] }` → `{ packet: EvidencePacket, jobId }` (201) | Evidence Packets (standalone web-hunting tool — no coupling to sets/scopes). Creates the packet doc (status `hunting`) and enqueues a `packet` job; ≤120 standards per packet; enqueue failure settles both the job and the packet `failed` |
| `GET /packets` | → `PacketSummary[]` | slim rows (no items), newest first |
| `GET /packets/{id}` | → `EvidencePacket` | full doc including hunted items — poll this while `hunting` (the doc fills in per finished batch) |
| `GET /packets/{id}/job` | → `JobStatus` | hunt progress (stages = search batches) |
| `POST /packets/{id}/stop` | → `{ jobId }` | sets `cancelRequested`; the hunt halts at its next checkpoint, packet → `cancelled`, found items kept. 409 with no active hunt |
| `POST /packets/{id}/retry` | → `{ jobId }` (202) | resumes a failed/stopped/stalled hunt: packet → `hunting`, re-dispatch; `doneBatches` on the doc make finished batches skip. Reuses a provably-live active job (log progress < 15 min, no stop flag) |
| `DELETE /packets/{id}` | → `{ ok: true }` | flags any active hunt job to stop, then removes the doc and index row |
| `GET /library` | → `{ files: LibraryFile[] }` | Reference Library — the four document sets (standards/progression/items/unpacking) filed per framework (`ccss`/`teks`/`sol`/`best`) and grade (3–8). Listing derives from a blob prefix walk (no index doc) |
| `PUT /library/{framework}/{grade}/{role}/{fileName}` | raw bytes (`application/pdf`) → `{ file: LibraryFile }` (201) | stores to `uploads` container under `library/...`; same name replaces the document. Every path segment is validated |
| `DELETE /library/{framework}/{grade}/{role}/{fileName}` | → `{ ok: true }` | |
| `GET /library-file/{framework}/{grade}/{role}/{fileName}` | → the PDF | opened in a browser tab, so auth also accepts `?code=` (mirrors `item-image`) |
| `POST /ops/seed` | `?force=true` optional → `{ seeded: boolean, sets: number, scopes: number }` | loads bundled `seed.json` into tables/blobs when empty (or force). NOTE: the route is `ops/seed` because Azure Functions reserves custom routes starting with `admin` |

`JobStatus`:
```ts
interface JobStatus {
  jobId: string
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet'
  status: 'queued' | 'running' | 'complete' | 'failed'
  stage: string            // human-readable current stage, e.g. "Stage 3-4 - Atomization & sequencing" (always singular 'Stage', parsed by the frontend)
  stagesDone: number       // 0..totalStages
  totalStages: number
  unitsDone?: number       // during card generation
  totalUnits?: number
  error?: string
  log: { at: string; stage: string; detail: string }[]
}
```

Errors: non-2xx responses are `{ error: string }`. The frontend surfaces them.
Endpoints that persist state and then enqueue a job revert the persisted state if the enqueue fails
(no scope/proposal may be left `generating`/`drafting` without a queued job).

## Storage layout

**Table `entities`** — one row per document, for cheap listing:
- Sets: PartitionKey `set`, RowKey `<setId>`, props: `name`, `published` (bool), `updated`, `blobPath`
- Scopes: PartitionKey `scope`, RowKey `<scopeId>`, props: `title`, `setId`, `status`, `version`, `updated`, `blobPath`
- Packets: PartitionKey `packet`, RowKey `<packetId>`, props: `title`, `status`, `updated`, `blobPath`

**Table `jobs`** — PartitionKey `job`, RowKey `<jobId>`, props: `scopeId`/`setId`/`packetId`, `kind`, `status`,
`stage`, `stagesDone`, `totalStages`, `unitsDone`, `totalUnits`, `error`, `logJson` (stringified log
array, capped at ~40 entries). Unit-completion increments use **ETag optimistic concurrency with
retry** (parallel unit workers race); the finalize signal is at-least-once (any completion observing
all units done reports it; finalize itself is idempotent).

**Blob container `data`**:
- `sets/<setId>.json` — full `StandardSet`
- `scopes/<scopeId>.json` — current `Scope`. Mutations of an existing scope go through
  `mutateScope` (blob ETag If-Match + retry) — plain overwrites are only allowed where no concurrent
  writer can exist (initial create, generate-finalize, seeding)
- `scopes/<scopeId>/v<version>.json` — immutable snapshot written whenever a new version is created
- `packets/<packetId>.json` — current `EvidencePacket` (standalone web-hunting tool). Mutations go
  through `mutatePacket` (blob ETag If-Match + retry); the hunt checkpoints into the doc itself
  (`items` merged per batch, `doneBatches` keys)
- `jobs/<jobId>/plan.json`, `jobs/<jobId>/unit-<i>.json` — pipeline checkpoints

**Blob container `uploads`**: `<setId>/<role>/<fileName>` — uploaded PDFs;
`library/<framework>/<grade>/<role>/<fileName>` — Reference Library documents (no index — the
`GET /library` listing is a prefix walk, so the library can never drift from storage).

**Queue `genjobs`** — message JSON, **explicitly base64-encoded on send** (the Functions host expects
base64; `@azure/storage-queue` does not encode by default):
```ts
interface JobMessage {
  jobId: string
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet'
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'hunt'   // 'run' for single-step kinds; 'hunt' for kind 'packet'
  scopeId?: string
  setId?: string
  packetId?: string
  unitIndex?: number      // for step 'cards'
  payload?: Record<string, unknown>   // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
```

## Generation pipeline (kind `generate`)

Mirrors spec §6 pragmatically, checkpointed for the 10-minute consumption timeout
(`host.json`: `functionTimeout: "00:10:00"`):

1. **`plan`** (Stages 2–4): one Claude call (effort `high`). Input: the published set's tree (with
   limits), items (with scope classes/demand profiles), artifact usage notes, and the
   request (course/standard/topic). Output (structured): ordered units with lesson skeletons.
   Checkpoint to `jobs/<jobId>/plan.json`; set `totalUnits`; enqueue one `cards` message per unit.
2. **`cards`** (Stage 5, parallel per unit): one Claude call per unit (effort `medium`,
   max_tokens 48000 — sized to fit the 10-minute consumption cap). Output (structured): full `Unit`
   with 14-field `Lesson`s — every field `{ content, citations[] }`, decision entries with rule IDs,
   `generatedExemplar` for lessons with no in-boundary items (never-empty Released Items, spec §7.13).
   Checkpoint to `jobs/<jobId>/unit-<i>.json`; increment `unitsDone` (ETag retry); any completion
   observing all units done enqueues `finalize` (at-least-once; finalize is idempotent).
3. **`finalize`** (Stage 6): assemble the `Scope` from checkpoints, run **programmatic QC**
   (ten checks incl. objective integrity and released-item coverage, each → `QCCheck` pass/flag/fail), write history
   entry, snapshot `v1.json`, status `complete`. No-ops on duplicate finalize messages.

Failure at any step (after the queue's built-in retries, `maxDequeueCount` 3) is **kind-aware**:
- `generate`: job `failed`, scope status `failed` + `error` (UI offers delete/retry).
- `rerun`: scope back to `complete` (previous version intact), history entry `Rerun failed`.
- `proposal`: proposal settled `abandoned` with an error round; scope status untouched.
- `iterate`: `working` cleared, error round appended; proposal keeps its status.
- `apply-proposal`: scope back to `complete`, history entry `Revision apply failed`.
- `ingest`: a `CoverageWarning` starting with `Ingestion failed:` is added to the set (the frontend
  watches for it); the set stays unpublished.

**Other kinds**:
- `rerun` (`run`): Claude regenerates the target (lesson card for `regenerate` — target must resolve
  to a lesson or the job fails; the containing unit's lesson list for `split`/`merge`, honoring
  `locked` lessons → `pendingRelationalUpdate` instead of mutation). New version, snapshot, history
  entry (log override if `override`).
- `proposal` (`run`): Claude maps the PerformanceReport onto Editing-Splits logic (spec §8) →
  `ProposalChange[]` + ripple. Sets proposal `draft`, `working: false`.
- `iterate` (`run`): Claude revises the draft given feedback → appends `{ feedback, response }` round,
  may update `changes`.
- `apply-proposal` (`run`): Claude rewrites the targeted lesson fields per the accepted change set;
  relational fields of adjacent lessons updated; locked lessons queue suggestions. Unresolvable
  targets fail the job (surfaced per the failure table above).
- `ingest` is RESUMABLE and STOPPABLE: every completed document is recorded on the job row
  (`doneBlobs`), so a redelivered attempt (the Consumption plan kills executions at 10 minutes;
  `maxDequeueCount` 12) skips finished documents and keeps their results — each attempt makes
  forward progress. POST `/sets/{id}/stop-ingest` sets `cancelRequested`; the worker halts at its
  next checkpoint and settles the job as `cancelled` (new JobStatus state). `enqueueIngest`
  supersedes provably-dead jobs (no log entry in 15 minutes, or stop-requested and idle 3+
  minutes) instead of returning them forever.
- Released-items documents are NOT extracted at ingestion: they are held as artifacts for scope
  generation. The item bank, item
  screenshots, and alignment confirmations populate later, from scope generation; the
  `/item-image` endpoint and screenshot pipeline are retained for that stage.
- `ingest` (`extract`, Stage 1a): uploads exceeding the 100-page ingestion limit are first split
  automatically into consecutive ≤100-page part documents (pdf-lib; a 144-page PDF becomes
  "… (pages 1-100).pdf" and "… (pages 101-144).pdf"): parts re-uploaded, original blob removed, the
  artifact entry replaced by one entry per part with usage notes carried over. Then, for each
  uploaded PDF (from `uploads/`), Claude document call
  extracts standards → tree, items → ItemRecord[] with page + bounding box (rendered via
  pdf-to-png-converter and cropped to `data/sets/<id>/item-images/<itemId>.png`), notes docs →
  usage-notes enrichment; then one cross-document conflict pass consolidates warnings, each with an
  AI-suggested resolution (strict canonical Common Core is always the suggestion for CC-variant
  conflicts). Does NOT publish.
- previous single-step `ingest` (`run`) description, for history: for each uploaded PDF, Claude document call
  (base64 PDF content block) extracts: standards → `StandardNode` tree with limits;
  items → `ItemRecord[]` (text stand-in stems, `ai-proposed` alignments); unpacking/progression →
  usage notes enrichment. Extraction REPLACES extraction-derived state on re-runs (idempotent),
  preserving human-entered state (usage notes, acknowledged warnings, confirmed alignments by
  natural key). PDFs > 23MB raw (base64 expansion vs the 32MB API request cap) or > ~100 pages
  (heuristic: max of `/Type /Page` tokens and `/Count N`): blocking artifact error instead of a
  Claude call. Publishes on success unless blocking errors remain (P10).

## Evidence-packet hunt pipeline (kind `packet`, step `hunt`)

The Released Item Repository Generator (internally "packets") is **standalone**: it never reads standard sets, scopes, or uploaded
artifacts. The frontend ships a built-in catalog (`src/data/packet-catalog.ts` — grades 3–8 math
standards for CCSS / TEKS / Virginia 2023 SOL / Florida B.E.S.T., official wording, lazily loaded)
and `POST /packets` carries the selected standards verbatim; the backend hunts the public web.

- **Batching** (`api/src/pipeline/packets.ts`): standards group by (grade, domain), chunked to ≤4
  per batch. One batch = one Claude call with the **server-side `web_search` tool** (≤8 searches).
- **Checkpointing**: after each batch, items merge into the packet doc via `mutatePacket` (dedup key
  `standardCode|sourceUrl|itemNumber|stem-prefix`) and the batch key lands in `doneBatches`. A
  3.5-minute launch budget re-enqueues the same message before the 10-minute cap; redelivered or
  retried messages skip finished batches, so no paid search re-runs.
- **Honesty rules in the hunt prompt**: never invent an item — only transcribe items actually found
  in sources located through this call's searches; a standard with nothing findable is reported as a
  **gap** (documentation gap, not failure); `alignment: 'official'` only when the source itself maps
  the item to the code, else `'ai-inferred'`; source URL must come from search results. Replies are
  additionally sanitized in code (off-batch codes dropped, URLs must be http(s), ≤4 items/standard).
- **Settlement**: all batches done → packet `complete` (job log summarizes items/coverage/gaps).
  Stop (`cancelRequested`) → packet `cancelled` at the next checkpoint, found items kept. Terminal
  worker failure → packet `failed` via `markPacketFailed`, found items kept. `POST /packets/{id}/retry`
  resumes any non-complete packet past its `doneBatches`.

## Guardrails (synchronous, data-driven)

A scope carries an optional `protectedBoundaries: string[][]` list — derived at finalize time from
granularity decision entries indicating a hard split; the seeded scope is stamped with
`[['U3.L3','U3.L4']]`. A `merge` rerun whose target **exactly** matches a protected pair's lesson ids
or their unit id is declined with the criterion + evidence (the seed pair uses `store.tsx`'s exact
4.NBT.5 text; derived pairs get a generic A2 criterion naming both lessons). `override: true`
proceeds and logs (RerunEvent detail + QC flag), per spec §8.

## Claude integration (backend `api/src/services/claude.ts`)

- SDK: `@anthropic-ai/sdk` (latest). Client constructed from `ANTHROPIC_API_KEY`.
- **Model**: `process.env.CLAUDE_MODEL ?? 'claude-fable-5'`.
- One helper: `generateStructured<T>({ system, user, schema, maxTokens = 64000, effort = 'high' })`:
  - Always **streams** (`.stream(...)` + `finalMessage()`) — calls can run minutes.
  - `output_config: { format: { type: 'json_schema', schema }, effort }`; `CLAUDE_EFFORT` env
    overrides effort globally when set.
  - **Fable-specific rules** (model starts with `claude-fable`): OMIT the `thinking` parameter
    entirely; use `client.beta.messages.stream` with
    `betas: ['server-side-fallback-2026-06-01']` and `fallbacks: [{ model: 'claude-opus-4-8' }]`
    so a safety-classifier decline transparently re-runs on Opus 4.8.
  - **Non-Fable models**: plain `client.messages.stream` with `thinking: { type: 'adaptive' }`.
  - Never set `temperature`/`top_p`/`top_k` (400 on current models).
  - After `finalMessage()`: `stop_reason === 'refusal'` → descriptive error; `'max_tokens'` →
    truncation error; else parse the JSON text content (one retry re-prompting with the parse error).
- **PDF input**: `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }`
  placed before the text block (no beta header needed). Base64 without newlines.
- **Web search** (`webSearch: true`, packet hunts only): adds the server-side web_search tool
  (`web_search_20260209`, falling back to `web_search_20250305` on a 400) with `max_uses`.
  Web-search calls always run **unconstrained** (schema embedded in the prompt, JSON extracted from
  the text — server tools and constrained decoding do not compose) and resume `pause_turn` stops by
  sending the paused assistant content back (≤3 resumes).
- JSON schemas: no recursion, `additionalProperties: false` + `required` everywhere, no
  min/max constraints. The recursive `StandardNode` tree is represented in schemas as a **flat array
  with `parentCode`** and rebuilt into a tree in code.
- Prompts live in `api/src/services/prompts.ts`; every prompt embeds the relevant spec-§ verbatim
  policy text (short excerpts), the evidence JSON, and the required output shape. Card prompts must
  demand ≥1 citation per field and the mandatory *Generated exemplar — not a released item* label.

## Seed data

- `api/scripts/export-seed.mjs` uses `tsx` to import `../../src/data/seed.ts` and writes
  `api/assets/seed.json` (`{ sets, scope }`); the build copies it to `dist/assets/`.
- `POST /api/ops/seed` loads it: writes set/scope blobs + entity rows. Seeding also stamps the
  seeded scope's `protectedBoundaries: [['U3.L3','U3.L4']]`.

## Frontend rewiring (`src/`)

- `src/api.ts`: typed client (all endpoints above), base URL from `VITE_API_BASE`
  (fallback: `import.meta.env.DEV ? 'http://localhost:7071/api' : '/api'`), access-code header,
  401 → `UnauthorizedError`, 404 → `NotFoundError`.
- `src/store.tsx` keeps the **same provider/hook shape** (`useStore()`), API-backed:
  - State: `sets`, `scopes`, plus `loading`, `error`, `refresh()`, `refreshScope(id)`.
  - Access gate on missing/invalid code; bootstrap on mount.
  - Actions are **async**, apply server-returned documents, and bump a per-scope mutation sequence
    so stale in-flight polls are discarded. `deleteScope` resolves to a success boolean.
  - `createScope` returns the scope id; `NewScope.tsx` polls `GET /scopes/{id}/job` every 2s
    (stage regex tolerates `Stage`/`Stages`), navigates on complete, surfaces errors on failure.
  - Scope polling: any scope `generating` or with a working/drafting proposal → poll every 2s until
    settled; 404 evicts the scope from state.
- `src/data/seed.ts` keeps `seedSets`/`seedScope` (the backend seed export imports them); static UI
  metadata lives in `src/data/meta.ts`; the app imports no seed data at runtime.

## Build & deploy

- `api/`: `npm run build` = export-seed (prebuild) + `tsc` + copy-assets. Deploy via
  `infra/deploy-api.ps1` (stage dist + host.json + package.json + prod node_modules, zip,
  `az functionapp deployment source config-zip`).
- Frontend: `infra/deploy-web.ps1` — build with `VITE_API_BASE` set, deploy `dist/` via
  `npx @azure/static-web-apps-cli deploy --env production --deployment-token <token>`.
- Secrets: `infra/set-secrets.ps1` reads `.secrets/anthropic-key.txt` → sets `ANTHROPIC_API_KEY`.
- Seeding: `infra/seed.ps1` posts to `/api/ops/seed` with the access code.

## Non-goals for v1 (recorded, not built)

- Item **screenshot** extraction from released-item PDFs (vision segmentation/cropping) — item
  records ingest as text stand-ins; the UI already renders stems as text.
- Real user identity (access code only); per-user attribution uses a fixed actor string as today.
- CASE export, course-organized sets (spec D11 v2 scope).
