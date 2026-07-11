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
| Storage account | `scopegenst<suffix>` | StorageV2; tables `entities`, `jobs`; queue `genjobs`; containers `data`, `uploads`, `screenshots` |
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
Deliberate SAS exception: `POST /api/item-image-links` (itself header-authenticated) mints
long-lived read-only **blob SAS URLs** for item screenshots. Those URLs bypass the Function App
entirely and require no access code — by design, so the CSV export's screenshot links can be
shared without distributing the app credential. Each link grants read on exactly one screenshot
blob; rotating the storage account key revokes them all.

## Shared types

- `api/src/domain/types.ts` is a **verbatim copy** of `src/types.ts`, with the contract edits below.
- The same edits are applied to `src/types.ts` (frontend):
  1. `Scope.status`: `'complete' | 'generating' | 'paused' | 'failed'`
  2. `Proposal.status`: `'drafting' | 'draft' | 'accepted' | 'abandoned'`
  3. `Proposal` gains optional `working?: boolean` (true while Claude is drafting/iterating)
  4. `Scope` gains optional `error?: string` (populated when status === 'failed')
- `Lesson.type` is the guide's five-value enum:
  `'preskill' | 'new-learning' | 'representation' | 'bridge' | 'application-tier'` (Engine v4.0;
  pre-v4.0 scopes only ever carry the last three values).
- `Scope` carries optional `coherence?: CoherenceWeb[]` — the three-tier dependency maps
  (one `level: 'atom'` web per unit, one `'unit'` web, one `'grade'` web), built code-side at
  finalize from the plan checkpoint. Absent on scopes generated before Engine v4.0; the frontend
  Dependency Map explains the absence rather than erroring.

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
| `POST /item-image-links` | `{ items: [{ setId?, packetId?, itemId }] }` → `{ links: Record<"ownerId/itemId", url> }` | long-lived (5y) read-only blob SAS URLs for item screenshots, embedded in the CSV/JSON exports (see Authentication — the deliberate SAS exception). Entries with `packetId` resolve against the `screenshots` container (`<packetId>/<itemId>/1.png`), entries with `setId` against `data` as before. ≤4000 items per call; malformed ids are skipped, not errored |
| `GET /packet-item-image/{packetId}/{itemId}/{n}` | → `image/png` | captured screenshot of a hunted packet item (n is 1-based); auth via header or `?code=` (mirrors `item-image`) |
| `POST /sets/{id}/publish` | → `{ set: StandardSet }` | seeded sets (no uploads) publish immediately; uploaded sets 409 unless extraction completed and every warning is resolved. Idempotent |
| `GET /framework` | → `FrameworkDoc` | the fixed engine/doctrine documents (read-only — no PUT; new versions ship with the tool). The payload keeps a legacy `register: []` so pre-removal bundles render an empty exemplar register during deploy skew |
| `GET /framework-file/{kind}` | → 302 to a blob SAS URL | downloads the engine/doctrine source PDF (`kind` = `engine`\|`doctrine`). A browser navigation, so auth also accepts `?code=` (mirrors `library-file`); redirects to a 15-minute read-only SAS on `uploads/framework/<kind>.pdf` with `content-disposition: attachment` so the browser pulls the file straight from storage (the doctrine source is ~61 MB). 404 until a PDF has been uploaded |
| `PUT /framework-file/{kind}` | raw bytes (`application/pdf`) → `{ ok: true, size }` (201) | replaces the stored source PDF when a new edition is adopted (see `infra/upload-framework-docs.ps1`); the framework text/versions in `api/src/data/framework.ts` are updated in code alongside it |
| `POST /scopes` | `{ setId, setIds?, mode, params, courseName?, subject?, packetId?, uploadsToken?, uploadNames? }` → `{ id, jobId }` | creates scope doc (status `generating`), enqueues `generate` job. `courseName`/`subject` are the user-entered course identity (required by the UI, optional at the API for deploy skew): stamped on `request.courseName`/`request.subject`, used for the course-mode title, and rendered as lesson-card fields 01/02 (legacy scopes without them fall back to the first set's `subject`/`gradeSpan`). Optional `packetId` links a completed evidence packet as the scope's released-items source (400 if unknown or still hunting): its hunted items are converted to `ItemRecord`s and merged into the pipeline's evidence set, and `request.packetId`/`packetTitle` are stamped on the scope so the UI and exports can resolve packet items and their screenshots. Lesson granularity is always determined by the engine document (its full text is embedded in every generation-stage system prompt); the former `granular` flag (Granular Track Scoping) is no longer accepted — `Scope.request.granular` survives only on legacy documents and is ignored by the pipeline |
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
| `POST /packets/{id}/retry` | → `{ jobId }` (202) | resumes a failed/stopped/stalled hunt: packet → `hunting` with `huntJobId` stamped, then re-dispatches the SAME job id (stop flag cleared) — never a fresh row that a stale execution could wedge; `doneBatches` make finished batches skip. A provably-live active job (log progress < 15 min, no stop flag) is reused as-is |
| `DELETE /packets/{id}` | → `{ ok: true }` | flags any active hunt job to stop, then removes the doc, index row, and the packet's screenshot blobs |
| `PUT /scope-uploads/{token}/{fileName}` | raw bytes (`application/pdf`, ≤15 MB) → `{ blobPath }` | released questions attached to a topic scope request, uploaded BEFORE `POST /scopes` (client mints the token, sends it as `uploadsToken` + `uploadNames`); stored at `uploads/scope-uploads/<token>/<fileName>`; the pipeline attaches the PDFs to plan/cards calls as native document blocks (evidence rank: released items per P2, primary models for generated exemplars, never in itemRefs); deleted with the scope |
| `GET /lsg/snapshot?courseName=…` | → `LsgSnapshot` | Lesson Scope Generation (standalone tool — see §Lesson Scope Generation). The Course Snapshot API: current course + lessons resolved by course NAME; an unknown name returns `{ courseExists: false, course: null, lessons: [] }` (never 404 — "does not exist" decides CREATE vs UPDATE) |
| `GET /lsg/courses` | → `LsgCourse[]` | the course registry, newest-updated first |
| `GET /lsg/courses/{id}` | → `LsgCourse` | |
| `DELETE /lsg/courses/{id}` | → `{ ok: true }` | removes the course doc + index row; runs are untouched |
| `POST /lsg/runs` | `{ requestType, courseContext, generationScope, sourceScopeId?, dataModel? }` → `{ run: LsgRun, jobId }` (201) | captures the course snapshot ONTO the run (stable across worker retries), creates the run doc (status `generating`), enqueues an `lsg` job. Pre-edit course state precedence: the registry course by name (authoritative — holds prior edits) > `dataModel` (`{ name, lessons: LsgDataModelLesson[] }`, the uploaded existing data model, ≤300 lessons, loosely-keyed rows normalized) > `sourceScopeId` (a completed scope whose units/lessons seed the snapshot; 400 unknown, 409 not complete). Seeded snapshots have `courseExists: true` (the run is an UPDATE against that state). `mode: 'LESSONS'` requires ≥1 `includedLessons` and an existing/seeded course (400 otherwise); enqueue failure settles both the job and the run `failed` |
| `GET /lsg/runs` | → `LsgRunSummary[]` | slim rows (no snapshot/output), newest first |
| `GET /lsg/runs/{id}` | → `LsgRun` | full doc incl. snapshot and (when complete) output — polled while `generating` |
| `GET /lsg/runs/{id}/job` | → `JobStatus` | generation progress (`totalUnits`/`unitsDone` = field batches) |
| `DELETE /lsg/runs/{id}` | → `{ ok: true }` | removes the run doc + index row; the course registry is untouched |
| `GET /library` | → `{ files: LibraryFile[] }` | Reference Library — the four document sets (standards/progression/items/unpacking) filed per framework (`ccss`/`teks`/`sol`/`best`) and grade (3–8). Listing derives from a blob prefix walk (no index doc) |
| `PUT /library/{framework}/{grade}/{role}/{fileName}` | raw bytes (`application/pdf`) → `{ file: LibraryFile }` (201) | stores to `uploads` container under `library/...`; same name replaces the document. Every path segment is validated |
| `DELETE /library/{framework}/{grade}/{role}/{fileName}` | → `{ ok: true }` | |
| `GET /library-file/{framework}/{grade}/{role}/{fileName}` | → the PDF | opened in a browser tab, so auth also accepts `?code=` (mirrors `item-image`) |
| `POST /ops/seed` | `?force=true` optional → `{ seeded: boolean, sets: number, scopes: number }` | loads bundled `seed.json` into tables/blobs when empty (or force). NOTE: the route is `ops/seed` because Azure Functions reserves custom routes starting with `admin` |

`JobStatus`:
```ts
interface JobStatus {
  jobId: string
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet' | 'lsg'
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
- LSG courses: PartitionKey `lsg-course`, RowKey `<courseId>`, props: `courseName`, `updated`, `blobPath`
- LSG runs: PartitionKey `lsg-run`, RowKey `<runId>`, props: `courseName`, `status`, `updated`, `blobPath`

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
  (`items` merged per batch, `doneBatches` keys). `huntJobId` is the ownership token: only the
  stamped job may cancel/complete the packet or merge items — superseded executions settle their
  own job row and abandon
- `lsg/courses/<courseId>.json` — current `LsgCourse` (the LSG course registry; `courseId` is the
  slug of the course NAME — the primary key per the LSG design's Decision 2). Mutations go through
  `mutateLsgCourse` (blob ETag If-Match + retry)
- `lsg/runs/<runId>.json` — current `LsgRun` (snapshot captured at create; output + `applied` written
  by the worker). Mutations go through `mutateLsgRun`
- `jobs/<jobId>/plan-map.json`, `jobs/<jobId>/plan-unit-<i>.json`, `jobs/<jobId>/plan.json`,
  `jobs/<jobId>/unit-<i>-lesson-<lessonId>.json`, `jobs/<jobId>/unit-<i>.json` — pipeline
  checkpoints (legacy `unit-<i>-batch-<b>.json` batch checkpoints are still read on resume)
- `jobs/<jobId>/lsg-plan.json`, `jobs/<jobId>/lsg-batch-<i>.json` — LSG pipeline checkpoints
- `vsg/runs/<runId>.json` — current `VsgRun` (per-lesson statuses + conflicts; the run doc IS the
  pipeline checkpoint). Mutations via `mutateVsgRun` (ETag If-Match + retry)
- `vsg/scripts/<courseId>/<lessonId>.json` — latest `VideoScript` per (course, lesson), `version`
  increments on every save

**Blob container `uploads`**: `<setId>/<role>/<fileName>` — uploaded PDFs;
`library/<framework>/<grade>/<role>/<fileName>` — Reference Library documents (no index — the
`GET /library` listing is a prefix walk, so the library can never drift from storage);
`framework/<kind>.pdf` — the engine/doctrine source PDFs served by `GET /framework-file/{kind}`.

**Blob container `screenshots`**: `<packetId>/<itemId>/<n>.png` — actual item screenshots the hunt's
capture phase crops out of the source PDFs (n is 1-based; currently always 1).
**Anonymous blob READ enabled since 2026-07-09** (`public-access blob` — no listing, no writes): the
SPA can render blobs directly with plain URLs, no SAS and no auth header:
`https://scopegenstapvgm.blob.core.windows.net/screenshots/<path>`. The authenticated
`GET /packet-item-image` route and `POST /item-image-links` SAS URLs continue to work (SAS minting is
now optional for this container). Anyone with a URL can fetch that blob, so put ONLY content that is
safe to be public here (released test items are already public documents) — never anything derived
from private uploads. Writes still require the `AzureWebJobsStorage` connection string (backend
only). All other containers (`data`, `uploads`) remain fully private — do not opt them in.
Blob-service CORS allows GET/HEAD from the production hostnames and `http://localhost:5173`.
`DELETE /packets/{id}` removes the packet's prefix. `infra/provision.ps1` creates the container with
anonymous read (and `ensureInfra` self-heals it on fresh accounts).

**Queue `genjobs`** — message JSON, **explicitly base64-encoded on send** (the Functions host expects
base64; `@azure/storage-queue` does not encode by default):
```ts
interface JobMessage {
  jobId: string
  kind: 'generate' | 'rerun' | 'proposal' | 'iterate' | 'apply-proposal' | 'ingest' | 'packet' | 'lsg'
  step: 'plan' | 'cards' | 'finalize' | 'run' | 'extract' | 'hunt'   // 'run' for single-step kinds (incl. 'lsg'); 'hunt' for kind 'packet'
  scopeId?: string
  setId?: string
  packetId?: string
  lsgRunId?: string       // for kind 'lsg'
  unitIndex?: number      // for step 'cards'
  payload?: Record<string, unknown>   // kind-specific (rerun target/mode, report text, feedback, proposalId…)
}
```

## Generation pipeline (kind `generate`)

**Cross-framework union (multi-set scopes).** When a scope draws on more than one standard set
(`setIds.length > 1`, e.g. a CCSS set + a TEKS set), the plan/cards/rerun prompts run in UNION mode
(`unionBlock` + per-set evidence blocks via `getScopeSourceSets`): a content-based crosswalk
classifies every most-granular standard as unique-to-set or overlapping; unique standards get their
own lessons; overlapping standards merge into one lesson chain whose assessment boundary/ceiling is
the UNION of the frameworks' demands (widenings logged with both standards cited); P1 runs against
the union (in-boundary if ANY selected framework includes it); coverage requires every standard of
every selected set to have a covering lesson. Single-set scopes are unchanged ([] source sets).

Mirrors spec §6 pragmatically, checkpointed for the 10-minute consumption timeout
(`host.json`: `functionTimeout: "00:10:00"`):

1. **`plan`** (Stages 2–4): **checkpointed multi-call**. (A single whole-course plan call had to
   compress every unit's atomization into one output window under the execution deadline — the
   direct cause of under-atomized courses: ~60 lessons where the engine document's depth
   calibration demands 100+.) Input across the passes: the published set's tree (with limits),
   items (with scope classes/demand profiles), artifact usage notes, and the request
   (course/standard/topic).
   - **Pass 1 — course map** (one small call, effort `high`): scope resolution + unit
     architecture, NO lesson skeletons. Output: ordered units `{ id, title, rationale, strand,
     topic, priorGradeTopics, nextGradeTopics, standardCodes }` plus scope-level `scopeDecisions`
     (P1 vetoes, P2 corpus observations, union crosswalk). Every resolved most-granular standard
     must land in exactly one unit's `standardCodes`, and unit size is bound to 3–4 standards so
     each unit atomizes comfortably inside one follow-up call. Validated before checkpointing —
     non-empty, unique unit ids, no standard-less units, DISJOINT `standardCodes` across units
     (an overlap would command two unit calls to place the same items), and in course mode full
     leaf coverage (every content-standard leaf owned by some unit directly or via an ancestor
     code — a dropped standard would be silently untaught); a throw gets queue retries. Written
     **create-only** (`putJsonIfAbsent`, If-None-Match `*`) to `jobs/<jobId>/plan-map.json`: two
     overlapping deliveries can generate DIFFERENT maps, so first writer wins and the loser
     adopts the persisted map — otherwise unit checkpoints from two architectures could mix.
   - **Pass 2 — per-unit plans** (one call per unit, effort `high`, SEQUENTIAL): the full A1–A6
     Atom Discovery Process run explicitly per standard, within-unit ordering, the Cumulative
     Mastery Ledger (seeded with a compact one-line-per-lesson digest of every prior unit), the
     Item Alignment Algorithm over the unit's items, and dependency extraction (`dependsOn` may
     reference prior units' lesson ids and the unit's M(0) prereq node ids). Items are
     partitioned across units **in code** (`partitionItemsByUnit`): a unit owns items aligned to
     its standards or their descendants, and a coarse-grain alignment (cluster/KS-level) resolves
     to the LATEST unit owning a descendant — deterministic, exactly one call sees each in-scope
     item (per-call code matching both dropped coarse-grain items and double-fed overlaps).
     Cross-unit deferrals thread through the passes: each unit's `deferredOut` rides forward as
     `pending_deferrals` to later units, which absorb them via `placedDeferrals`. Skeleton fields
     per lesson: `objective`, `newEntries` (ledger), `dependsOn` (with `carries` skills), `flags`
     — all optional in the TS shape so legacy plan checkpoints still parse. Validated before
     checkpointing to `jobs/<jobId>/plan-unit-<i>.json` (a throw gets queue retries): lesson ids
     unique and unit-prefixed; every `placedDeferrals` entry targets one of THIS unit's lessons
     with a pending item id (a hallucinated id would silently convert a placeable item into a
     false end-of-course exclusion); every `deferredOut` names a supplied item id. Repairable
     slips are sanitized instead: out-of-scope/duplicate `itemRefs` dropped, `deferredOut`
     entries contradicting an in-unit placement dropped. A reused checkpoint that does not match
     the current map's unit id is discarded and regenerated. Unit calls run inside a 4.5-minute
     launch budget with plain same-message re-enqueue between units (the cards pattern); a call
     aborted at the deadline after launching >60s into the window re-runs at the SAME effort in
     a fresh execution (a late start says nothing about whether the call fits — only an
     early-started cut burns a ladder rung).
   - **Pass 3 — assembly** (programmatic, no Claude): unit metadata from the map + lessons and
     prereqs from the unit plans; `placedDeferrals` merged into their target lessons' `itemRefs`;
     every `itemRefs` filtered to real item ids and deduped course-wide (one item, one lesson —
     first placement in course order wins, as a backstop behind the per-unit sanitation);
     never-absorbed deferrals logged in `scopeDecisions` as end-of-course exclusions
     (guide §16.2). Checkpoint to `jobs/<jobId>/plan.json`; set `totalUnits`; enqueue one `cards`
     message per unit.
   Every planning call is **deadline-bounded** (aborted in-process at 8.5 minutes — a host kill
   at 10:00 skips all settlement) with a **per-call cut-escalation ladder** riding the queue
   message (`payload.cuts` + `payload.cutUnit`, −1 = the map call): each cut re-runs THAT call at
   lower effort (`high → medium → low`); exhausting the ladder fails terminally ("did not fit the
   10-minute execution window", matched by the worker's TERMINAL_ERROR so it fails fast).
   **Output truncation (`max_tokens`) escalates down the SAME ladder**: reasoning tokens share
   the max_tokens budget, so a lower-effort re-run leaves more room for the plan itself;
   exhausting the ladder fails terminally ("exceeded the model's output budget"). Because each
   unit now plans in its own call, cross-framework union full-course planning fits the window
   (the former known failure case).
2. **`cards`** (Stage 5, parallel per unit): one Claude call per lesson slice (effort `medium`,
   max_tokens 48000 — sized to fit the 10-minute consumption cap). The lessons-per-call count is
   **adaptive** (starts at 4, rides re-enqueued messages as `payload.callSize`): on truncation it
   halves down to a single lesson — truncation is deterministic, so a fixed slice would fail
   identically forever; a single lesson that still truncates gets one rescue retry at effort
   `low` with the full 64k output cap (reasoning shares the budget) before failing terminally
   ("exceeded the model's output budget"). Lessons checkpoint **individually** to
   `jobs/<jobId>/unit-<i>-lesson-<lessonId>.json` (legacy `unit-<i>-batch-<b>.json` checkpoints
   are still read so pre-change runs resume). Output (structured): full `Unit`
   with fourteen-content-field `Lesson`s — every field `{ content, citations[], rationale }` (fields
   state the WHAT only; reasoning is banned from field content), decision entries with rule IDs and
   a `field` tag naming the card field each governs (`card` = lesson-level; the UI renders each
   record under its field), two required lesson-level narratives closing each card's decision
   record (`sequencingRationale` — why the units are ordered as they are and why the lesson holds
   its position; `granularityRationale` — why exactly this granularity, arguing both why not more
   and why not less; optional on legacy scopes, rendered in the trailing Lesson Decision Record and
   leading the CSV `scoping_rationale` column), and a required `studentFriendlyTitle` (the title as
   a student sees it — concise, descriptive, on grade level; optional on legacy scopes; the JSON
   export's `lessonTitle` uses it, falling back to `title`),
   `generatedExemplars` for lessons with no in-boundary items (never-empty Released Items, spec §7.14).
   Card calls carry the same 8.5-minute abort: a cut call re-enqueues the unit message with
   `payload.cuts` + `payload.callSize` (finished lessons are checkpointed; the retry runs at
   effort `low`); after three cuts the unit fails terminally. The assembled unit checkpoints to
   `jobs/<jobId>/unit-<i>.json`; increment `unitsDone` (ETag retry); any completion observing
   all units done enqueues `finalize` (at-least-once; finalize is idempotent).
3. **`finalize`** (Stage 6): assemble the `Scope` from checkpoints, build the **coherence webs**
   (`api/src/pipeline/webs.ts`, `buildCoherenceWebs`) purely in code from the plan checkpoint —
   atom web per unit (lessons + synthesized cross-unit/M(0) prerequisite nodes, edges sanitized:
   unknown endpoints and forward-in-sequence edges dropped and flagged), unit web (cross-unit
   lesson edges lifted to unit level, transitively reduced), grade-progression web (topic rows
   from `priorGradeTopics`/`nextGradeTopics`) — stored on `scope.coherence`; then run
   **programmatic QC** (fourteen checks incl. objective integrity, substandard presence, doctrine
   grounding, released-item coverage, and the coherence-web check reporting any sanitization
   flags, each → `QCCheck` pass/flag/fail), write history
   entry, snapshot `v1.json`, status `complete`. No-ops on duplicate finalize messages.

Failure at any step (after the queue's built-in retries, `maxDequeueCount` 12) is **kind-aware**:
- `generate`: job `failed`, scope status `failed` + `error` (UI offers delete/retry).
- `rerun`: scope back to `complete` (previous version intact), history entry `Rerun failed`.
- `proposal`: proposal settled `abandoned` with an error round; scope status untouched.
- `iterate`: `working` cleared, error round appended; proposal keeps its status.
- `apply-proposal`: scope back to `complete`, history entry `Revision apply failed`.
- `ingest`: a `CoverageWarning` starting with `Ingestion failed:` is added to the set (the frontend
  watches for it); the set stays unpublished.
- `lsg`: run settled `failed` + `error`; the course registry is untouched (persist only happens on
  success).

**Attempt-error visibility** (`worker.ts`): every caught, retryable step error is logged onto the
job row before rethrowing (`Attempt N failed: … — retrying`), and the attempt circuit breaker
(dequeue > RUN_ATTEMPT_CAP) surfaces the LAST recorded error in its failure message when one
exists — the canned "killed by the 10-minute execution cap" guess is reserved for genuinely
silent kills. Without this, a deterministic validation throw (e.g. malformed unit-plan lesson
ids) reached the breaker with nothing recorded and the user got timeout advice that could not
help.

**Poison-queue settlement** (`genjobs-poison` trigger in `worker.ts`): a message the host poisons
means every delivery died WITHOUT the worker recording anything — in practice the 10-minute
execution kill, which skips the catch block entirely. The trigger runs the same kind-aware
`markFailed` settlement (skipping jobs already complete/cancelled), so no scope/set/packet can
ever hang in a working state with no error and no retry path. Checkpoints are untouched; retry
resumes from them.

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
(Scopes may consume a finished packet — `POST /scopes` with `packetId` — but the dependency only
points that way; the hunt itself never reads scope or set data.)

- **Batching** (`api/src/pipeline/packets.ts`): standards group by (grade, domain), chunked to ≤4
  per batch. One batch = one Claude call with the **server-side `web_search` + `web_fetch` tools**
  (≤8 uses each): search locates released-test documents, fetch OPENS the page/PDF so items are
  transcribed from the document itself, never from search snippets.
- **Deadline escalation**: the in-flight call is aborted at 8.5 minutes (a host kill at 10:00 would
  skip settlement). The re-enqueued message carries `{cuts, cutKey}`: after one cut the batch
  re-runs lean (1 search + 1 fetch, effort low, ≤2 items/standard); after three cuts the batch is
  skipped honestly (logged; its standards stay documentation gaps) so a slow batch can never loop
  forever burning paid searches.
- **Checkpointing**: after each batch, items merge into the packet doc via `mutatePacket` (dedup key
  `standardCode|sourceUrl|itemNumber|stem-prefix`) and the batch key lands in `doneBatches`. A
  3.5-minute launch budget re-enqueues the same message before the 10-minute cap; redelivered or
  retried messages skip finished batches, so no paid search re-runs.
- **Honesty rules in the hunt prompt**: never invent an item — only transcribe items actually found
  in sources located through this call's searches; a standard with nothing findable is reported as a
  **gap** (documentation gap, not failure); `alignment: 'official'` only when the source itself maps
  the item to the code, else `'ai-inferred'`; source URL must come from search results. Replies are
  additionally sanitized in code (off-batch codes dropped, URLs must be http(s), ≤6 items/standard).
- **SBAC index** (`api/src/data/sbac-items.ts`, generated from the live
  `sampleitems.smarterbalanced.org/BrowseItems/search` catalog): the full catalog JSON (~2.2 MB)
  exceeds any fetch budget, so CCSS hunt batches inject their standards' official bank entries
  (item ids, claim/target, DOK, keys, release year) directly into the prompt. The agent must obtain
  each item's text from a printable source (SBAC/CAASPP scoring guides, state renditions) — bank
  metadata alone is never transcribed; unobtained ids are named in the gap note.
- **Screenshot capture** (`api/src/pipeline/packet-shots.ts`): after the gap sweep, items whose
  source is a PDF are grouped by source URL; per group the worker downloads the PDF (≤40 MB), asks
  Claude to localize each item (page + bounding box, native document blocks; large PDFs are split),
  renders the pages and crops the boxes, and uploads PNGs to the `screenshots` container at
  `<packetId>/<itemId>/<n>.png`, stamping `item.screenshotPaths`. Best-effort: a group that fails
  (download error, item not found, low-confidence box) leaves its items on text facsimiles.
  Checkpointed per group via `doneShots` under the same time-budget/re-enqueue/cuts machinery as
  search batches.
- **Settlement**: all batches done → packet `complete` (job log summarizes items/coverage/gaps).
  Stop (`cancelRequested`) → packet `cancelled` at the next checkpoint, found items kept. Terminal
  worker failure → packet `failed` via `markPacketFailed`, found items kept. `POST /packets/{id}/retry`
  resumes any non-complete packet past its `doneBatches`.

## Lesson Scope Generation (kind `lsg`, step `run`)

A **standalone** tool (design doc "Lesson Scope Generation: Create Course vs Partial Edit") — it
never reads standard sets, scopes, or packets. It supports two workflows: create a full course, and
update an existing course when only some lessons change.

- **Course identity**: the primary key is the course NAME (`courseIdFromName` slugs it). The same
  name always updates the same course in place — there are no course versions; a different name
  creates a different course.
- **Snapshot at create**: `POST /lsg/runs` captures the Course Snapshot onto the run doc, so every
  worker attempt plans against one stable view. The snapshot (not the model) decides
  `courseOperation`: course exists → UPDATE, else CREATE.
- **Seeded snapshots**: when the registry has no course under the name, the request may seed the
  pre-edit state from an uploaded existing data model (`dataModel.lessons`, ids `dm-<n>`) or from a
  completed scope (`sourceScopeId` — lesson ids are the scope's "U3.L3" ids; the fourteen card
  fields map onto the ten DM-bound fields by content, `standardId` extracted from field 1's
  "<CODE> — wording" format). Seeded snapshots report `courseExists: true`, so the run is an
  UPDATE whose lessons are matchable for UPDATE/DEACTIVATE. The registry always wins when it has
  the course (it holds prior edits).
- **Pipeline** (`api/src/pipeline/lsg.ts`), checkpointed for the 10-minute Consumption timeout with
  the generate pipeline's deadline machinery (8.5-minute in-process abort, `payload.cuts`
  escalation, 4.5-minute launch budget with same-message re-enqueue):
  1. **Target plan & matching** (one Claude call, effort ladder high → medium → low on cuts):
     builds the target lesson plan from the framework's official standards under the engine
     document, matches it against the snapshot per the design's matching rules, and returns
     per-lesson operations. Checkpointed to `jobs/<jobId>/lsg-plan.json`. Code-level sanitizing:
     an UPDATE/DEACTIVATE whose `lessonId` is not in the snapshot demotes to CREATE / is dropped
     (the platform owns lesson identity — Decision 4).
  2. **Scope fields** (batches of 5 lessons, effort medium, low after a cut): the ten DM-bound
     fields for every CREATE/UPDATE lesson (DEACTIVATE lessons carry only their reason). Batch
     replies must echo the prompt-assigned keys exactly (validated before checkpointing).
     Checkpointed to `jobs/<jobId>/lsg-batch-<i>.json`; `unitsDone`/`totalUnits` report batches.
  3. **Persist** (the orchestrator role, Decision 5): the assembled `LsgOutput` lands on the run,
     then is applied to the course registry — a course missing from the registry (fresh CREATE, or
     a run seeded from a scope/data model) is first materialized with the run's snapshot lessons so
     seeded UPDATE/DEACTIVATE lessonIds resolve; then CREATE assigns a platform lessonId
     (`newId('lesson')`), UPDATE merges onto the existing lesson by id, DEACTIVATE flips status to
     INACTIVE. The apply is idempotent under queue redelivery: CREATEs upsert by
     (unitName, lessonTitle) among ACTIVE lessons. Finally the run settles `complete` with
     `applied: true`.
- Output lessons keep `lessonId: null` on CREATE (the registry, not the output, holds the assigned
  ids), and echo the snapshot id verbatim on UPDATE/DEACTIVATE.
- **Mechanical scope import** — `POST lsg/courses/import-scope` `{ scopeId, courseName }` → `{ course }`
  (201): a COMPLETED scope's lessons become the named course's ACTIVE lesson set with **no
  generation call** (`importScopeIntoRegistry`, reusing the snapshotFromScope card-field mapping).
  Existing lessons matched by lowercased (unitName, lessonTitle) keep their platform ids and take
  the scope's content; unmatched imports are created (`newId('lesson')`); previously ACTIVE
  lessons absent from the scope are DEACTIVATED (never deleted); duplicate (unit, title) pairs
  inside one scope are suffix-keyed so no lesson is lost. Course context (subject/grade/framework/
  standardSet) derives from the scope's evidence set. This is how the registry catches up with a
  regenerated scope instantly — the Video Script Generator reads the registry, and its builder
  offers the import inline (a stale 97-lesson course against a 224-lesson regenerated scope was
  the motivating case). Importing under an existing course name refreshes that course in place;
  a new name creates a sibling course.

## Video Script Generator (kind `vsg`, step `run`)

Turns generated lesson cards into production-ready scripts for 2–5 minute (by grade band) DI math videos with
checked student interactions, per the versioned **"DI Math Video Script Generator Playbook"**
(embedded as `api/src/data/video-playbook.ts`, `VSG_PLAYBOOK_VERSION`; the access-details section
of the source PDF is deliberately stripped). Courses come from the **LSG registry** (VSG owns no
course store); scripts persist per (course, lesson) with a version, stamped with the playbook +
doctrine versions.

- **Picker is scope-driven**: the builder lists PUBLISHED scopes (live from the store, so deleted
  scopes never appear); picking one auto-syncs its backing course via the mechanical
  `lsg/courses/import-scope` (course name = scope title), falling back to the existing course when
  a live run 409-blocks the sync — Step 2 therefore always offers ALL of the scope's lessons.
- **Routes** (`api/src/functions/http-vsg.ts`): `GET vsg/courses` (registry shaped for a picker:
  active-lesson counts; the UI now drives from scopes, the route remains for API consumers) ·
  `POST vsg/runs` `{ courseId, lessonIds ≤ 60, steering }` → `{ run, jobId }`
  (201; lessons must be ACTIVE in the course) · `GET vsg/runs` (summaries) · `GET/DELETE
  vsg/runs/{id}` (delete is permanent: flags a live job `cancelRequested`, deletes the run docs
  FIRST, then every script blob the run OWNS — ownership proven by the `runId` stamped on the
  stored script (version numbers recycle after deletion, so version comparison alone cannot
  prove ownership); blobs whose latest version was written by another run are kept, and a
  worker whose post-save run-mutate 404s discards its own just-saved blob) ·
  `GET vsg/runs/{id}/job` ·
  `POST vsg/runs/{id}/reconcile` `{ lessonId, resolutions[{conflictId, resolution, resolvedBy}] }`
  (every open conflict must be resolved; lesson re-opens `pending`) ·
  `POST vsg/runs/{id}/regenerate` `{ lessonId }` (keeps resolved conflicts — they pre-fill; drops
  unresolved flags) · `POST vsg/runs/{id}/delete-lessons` `{ lessonIds }` → `{ ok, removed,
  runDeleted }` (multiselect permanent removal; 409s on lessons mid-generation, deletes the
  removed lessons' script blobs, recomputes the run status from the remainder, and deletes the
  run itself when emptied) · `GET vsg/scripts/{courseId}/{lessonId}`. Reconcile/regenerate re-dispatch via
  the packet-retry pattern (reuse the latest job row; a provably-live job is left alone — the
  worker's settle-time pending check hands off).
- **Storage**: `vsg/runs/<runId>.json` (mutations via `mutateVsgRun`, ETag retry) +
  `vsg/scripts/<courseId>/<lessonId>.json` (latest script, `version` increments per save); index
  rows partition `vsg-run` with the self-healing list sweep.
- **Pipeline** (`api/src/pipeline/vsg.ts`): ONE Claude call per lesson (effort medium, low after a
  deadline cut; 40k max tokens; truncation → one low-effort rescue; refusal/second truncation →
  that lesson alone fails, the rest continue). **The run document is the checkpoint**: lesson
  statuses advance `pending → generating → complete | needs-reconciliation | failed`; redelivery
  resumes at the still-open lessons. Same deadline machinery as the other pipelines (8.5-minute
  in-process abort, `payload.cuts`+`cutLesson` per-lesson escalation, 4.5-minute launch budget
  with same-message re-enqueue).
- **The generator runs under RULEBOOK v2** (`data/video-playbook.ts` — the "[in progress] NO HITL
  DI Video Script Generator v2" BrainLift embedded verbatim, Access section stripped): authority
  stack A1 Stein → A2 card → A3 registries → A4 Mayer → A5 MathEd/Psych; numbered registries with
  STABLE rule IDs (SEQ/TIM/INT/LANG/VIS/GRADE/DEV) cited in NOTE lines, conflicts, and QA
  findings; the Transfer Test (SEQ 09) replaces the fixed 3:00 cap — length is an output (typical
  2–5 min by grade band; > 6:00 = TIM 02 granularity flag, never compressed); scripts carry a
  machine-readable `coverageNote` (case classes taught vs deferred, SEQ 10) and a `transferTest`
  verdict; segment kinds `opening → i-do → we-do (repeatable) → discrimination? → wrap` (legacy
  `title`/`intro` survive on old scripts).
- **The ENTIRE textbook ships with the API** (`assets/textbook/` — all 18 chapters + Appendix A/B,
  cover to cover, page-stamped; built from the source PDF; copy-assets fails the build without
  it). **Retrieval stays page-targeted, never whole-book** (rulebook §13.5): `services/formats.ts`
  supplies the top 1–3 verbatim format scripts (`assets/formats.json`, ≤ 40k chars), the matching
  chapter's full instructional-procedures front from the corpus (`services/textbook.ts`
  `chapterProcedures` — skill hierarchy, sequence & assessment chart, preskill lists,
  example-selection guidance, diagnosis-and-remediation tables; ≤ 48k, stopping where the
  chapter's script section starts), and the Appendix A rows for the lesson's standard
  (`appendixAFor`; Appendix A covers K–5 — empty for middle grades, where the §19 chapter table
  routes). When no title matches, the family's nearest formats ship flagged `nearestOnly` —
  rhythm and cadence only (SEQ 05).
- **Conflict handling — flag → propose → reconcile (rulebook §13.4)**: the generation reply
  carries `conflicts[]`; non-empty (after dropping any that match an already-recorded resolution)
  → the lesson pauses `needs-reconciliation` with NO script — generation never silently resolves
  a contradiction. Each conflict names both sides with rule IDs, a proposed default from the
  authority stack, and a rationale; resolutions persist per (lesson, conflict), ride the
  regeneration prompt as settled, and are recorded in the script header (`conflictsResolved`).
  DEV 01 (division read-aloud in symbol order, LANG 10) is settled house style, never flagged.
- **Script QA (rulebook §17, findings cite rule IDs)**: the model self-QCs, then code re-checks —
  cadence gap > 60s hard (TIM 04), ≥ 3 interactions (TIM 05), skeleton order (opening first,
  model before any ask, SEQ 02), Transfer Test passes + coverage note complete (SEQ 08–SEQ 10,
  hard), feedback ladders complete with no generic "Try again!" (INT 16–INT 18, hard), internal
  vocabulary (LANG 11, hard), object/line pairing. Length outside the band typical and > 6:00
  granularity are FLAGS (TIM 01/02 — the corrective pass must never compress below the Transfer
  Test). Hard failures trigger ONE corrective call naming the failures; a script still failing
  ships with `qa.hardFails` visible (UI banner) rather than blocking the run.
- **Settlement**: all lessons terminal → run `needs-reconciliation` if any lesson awaits the user,
  else `complete` if any script was written, else `failed`. `markVsgFailed` (worker terminal
  failure) fails only still-open lessons — finished scripts and reconciliation flags survive.

## Scope Evaluations (kind `eval`, step `run`)

The built-in rubric QC layer (the Google-Sheet/webhook era is retired): after every scope
generation (enqueued best-effort by finalize — a dispatch failure never fails the generation) and
on demand, an agent scores the scope against the **rubric compiled into `data/eval-rubric.ts`**
(29 columns: 4 administrative, 13 lesson-band + 4 course-band rubrics — six marked hard gates —
5 computed results, 3 SME columns the pipeline never writes; editing a rubric is a deploy). Two
Claude calls per evaluation: the lesson band scores a stratified ~10-lesson sample of full cards
(checkpointed to `jobs/<jobId>/eval-lesson-band.json` + re-enqueue under the time budget); the
course band scores the full course structure + standards digest + the auto-QC results. Replies
bind by echoed heading; a skipped column scores a fail-loud `1`. Results follow the verdict rule
(FAIL on any `1`/`Inaccurate`; PASS — GOOD when no fails, ALL hard gates `3`, average ≥ 2.70;
else PASS — GOOD ENOUGH); AI-QC Notes lead with the verdict + criterion, then per-gate reasoning.
The scope document is hosted for the JSON column in the anonymous `screenshots` container
(`evals/<scopeId>.json`). A re-evaluation refreshes the agent's cells but PRESERVES the SME
fields and `created`.

- **Storage**: `evals/records/<scopeId>.json` (latest evaluation wins; carries `values` +
  `headings` for CSV export, `cells`, results, and the SME fields); index partition `eval`.
- **Routes** (`http-evals.ts`): `GET evals` (rubric + summaries) · `GET/DELETE evals/{scopeId}`
  (full record / permanent run deletion incl. the hosted JSON copy) · `PUT evals/{scopeId}/sme`
  (`{ sme, smeVerdict, smeNotes }`, verdict ∈ FAIL | PASS — GOOD | PASS — GOOD ENOUGH | '') ·
  `POST evals/{scopeId}/run` (202, completed scopes only).
- CSV export is client-side (the page joins each record's stored `headings`/`values` + SME
  fields under the current rubric's two header rows).
- Worker: evaluation is an observer — a terminal `eval` job failure records only on the job row,
  never on the scope.

## Guardrails (synchronous, data-driven)

A scope carries an optional `protectedBoundaries: string[][]` list — derived at finalize time from
granularity decision entries indicating a hard split; the seeded scope is stamped with
`[['U3.L3','U3.L4']]`. A `merge` rerun whose target **exactly** matches a protected pair's lesson ids
or their unit id is declined with the criterion + evidence (the seed pair uses `store.tsx`'s exact
4.NBT.5 text; derived pairs get a generic A2 criterion naming both lessons). `override: true`
proceeds and logs (RerunEvent detail + QC flag), per spec §8.

## Claude integration (backend `api/src/services/claude.ts`)

- SDK: `@anthropic-ai/sdk` (latest). Client constructed from `ANTHROPIC_API_KEY`.
- **Model**: `process.env.CLAUDE_MODEL ?? 'claude-fable-5'`. One scoped per-call override exists:
  packet hunts pass `model: 'claude-opus-4-8'` — Fable's dual-use gating consistently refused
  fetch-enabled hunt turns (a 'bio'-category false positive on grade-school math that the
  server-side fallback inherited), and Opus 4.8 is the fallback model anyway.
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
  policy text (short excerpts), the evidence JSON, and the required output shape. Every
  generation-stage system prompt (plan, cards, reruns, proposals) embeds the FULL engine document
  AND the full doctrine framework document from `api/src/data/framework.ts` as the binding
  granularity/modeling-scope and instructional-method authorities — their rules
  and worked examples, not a paraphrase. Card prompts must
  demand ≥1 citation per field and the mandatory *Generated exemplar — not a released item* label.
- **Doctrine chapter excerpts** (`api/src/services/doctrine.ts`): card-writing stages (cards,
  rerun-lesson, rerun-unit, apply) additionally inject up to 2 keyword/CCSS-domain-matched chapter
  `.txt` extracts of *Direct Instruction Mathematics* (5th ed., Stein et al.) from
  `api/assets/doctrine/` — score-ordered budget of 150k chars total, primary chapter capped at
  110k so it ships (nearly) whole. The prompt makes doctrine citations mandatory where the
  excerpts govern: the Instructional Approach and its strategy decision entry cite the chapter
  with a format/section locator and a verbatim excerpt; QC flags new-learning and preskill
  lessons whose strategy selection carries no doctrine citation ("Doctrine grounding").

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
- `src/pages/DependencyMap.tsx`: the full-screen Dependency Map opened from the scope sidebar —
  renders `scope.coherence` in three tabs (Atom Web per unit, Unit Web, Grade Progression) with
  the Achieve the Core coherence-map interaction (focused node centered, requires/unlocks fanned
  left/right, click-to-recenter). Pure client-side rendering of the stored webs; no API call.

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
