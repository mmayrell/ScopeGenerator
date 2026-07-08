# ScopeGenerator — project instructions

React SPA (`src/`) + Azure Functions backend (`api/`) + IaC/deploy scripts (`infra/`).
The binding API/storage/pipeline contract is `docs/backend-architecture.md` — read it before
changing the backend or the frontend's API client, and keep the two sides in sync with it.

## Production deployment — read before pushing to main

**Every push to `main` deploys straight to production** via `.github/workflows/deploy.yml`
(Function App `scopegen-api-apvgm` + Static Web App). There is no staging environment.

- **The Function App runs on WINDOWS (Consumption plan), 64-bit worker.** Never add an npm
  dependency with platform-specific native binaries (`@napi-rs/*`, `sharp`, `canvas`, anything
  N-API) without confirming (a) the deploy workflow stages it on a **windows** runner — Linux
  natives crash the worker at module load — and (b) the module ships **win32-x64** binaries.
  Never flip the app back to a 32-bit worker (`use32BitWorkerProcess`): x64 natives cannot load
  in a 32-bit process, zero functions register, and every route 404s (prod outage, 2026-07-05,
  which required BOTH fixes).
- **After pushing to main, watch the Deploy run to completion** (`gh run watch`) including the
  "Post-deploy health gate" step, and confirm `https://scopegen-api-apvgm.azurewebsites.net/api/health`
  returns `{"ok":true}`. A green build is NOT proof the app serves — module-load failures only
  appear at runtime.
- **Do not change the deploy mechanism** (direct Kudu zipdeploy) back to `Azure/functions-action`
  — with publish-profile auth it strips `WEBSITE_RUN_FROM_PACKAGE` on this app and serves 503s.
- **Never remove the `WEBSITE_RUN_FROM_PACKAGE=1` app setting** on the Function App. Without it,
  deploys extract thousands of files to the Azure Files share and time out.
- CI runtime smoke: `api` must keep passing the module-load check in `.github/workflows/ci.yml`
  (the compiled entry is `require`d on a Windows runner). If you add imports with side effects
  at module scope (network calls, env validation), guard them so the entry stays loadable.

## Incident note (2026-07-08) — Engine v3 deploy failures were NOT the code

The Engine v3 deploy and the diagnostics run failed their health gates because **App Service
Authentication (Easy Auth) had been enabled on the Function App with no identity provider**,
which makes the platform return empty 400s on every route before the app runs. It has been
disabled again. Do NOT enable App Service Authentication on `scopegen-api-apvgm` — the app's
own `x-access-code` middleware is the auth layer; if real user login is ever wanted, design it
on the Static Web App side instead. Note the `APP_ACCESS_CODE` app setting was also changed
around the same time — if you change it, tell Michael so `.secrets/access-code.txt` on his
machine gets updated. The temporary `.github/workflows/diagnose.yml` can be deleted once no
longer needed.

## Backend rules (`api/`)

- Node/TypeScript, Azure Functions v4 model, CommonJS output; `npm run build` must stay green.
- All Claude API calls go through `api/src/services/claude.ts` (`generateStructured`) — do not
  scatter raw SDK calls. Current API rules live in that file's header comment (no
  temperature/top_p; Fable models omit `thinking` and use the server-side Opus fallback betas;
  always stream). Model/effort come from `CLAUDE_MODEL` / `CLAUDE_EFFORT` app settings.
- Structured-output JSON schemas: `additionalProperties: false` + `required` everywhere, no
  recursion, no min/max constraints, and share repeated subtrees via `$defs`/`$ref` — large
  inlined schemas fail with "compiled grammar is too large" (400).
- Mutations of existing scope documents must go through `mutateScope` (ETag If-Match retry) —
  plain `saveScope` on an existing doc loses concurrent updates (batchSize 4 workers).
- Queue messages must stay base64-encoded on send (the Functions host expects base64).
- Custom HTTP routes must not start with `admin` (reserved by the Functions host — 404s).
- Pipeline work must fit the 10-minute Consumption timeout per queue message; checkpoint to
  blobs and re-enqueue rather than doing more in one invocation. The worker circuit-breaks any
  message on its 4th delivery (RUN_ATTEMPT_CAP in worker.ts) — a step whose Claude call cannot
  finish inside 10 minutes will fail with a "killed 3 times" error rather than retry forever.
  KNOWN CASE (2026-07-07): cross-framework **union** full-course scoping doubles the plan-stage
  evidence and does not fit — split union planning into one plan call per framework (checkpoint
  each) plus a merge step, or lower the plan call's effort for union requests.

## Frontend rules (`src/`)

- All backend calls go through `src/api.ts`; auth is the `x-access-code` header (gate in
  `src/store.tsx`). 401 → clear code and re-gate; 404 on a scope → evict from state.
- `src/data/seed.ts` must keep exporting `seedSets`/`seedScope` — the backend seed export
  (`api/scripts/export-seed.mjs`) imports it at build time.
- `npm run lint` (oxlint) and `npm run build` must stay green.

## Operational facts

- Resource group `scopegen-rg` (East US 2); storage `scopegenstapvgm`; site
  `https://polite-cliff-00716280f.7.azurestaticapps.net`.
- Secrets live in the gitignored `.secrets/` (access code, SWA token, Anthropic key) and are
  applied with `infra/set-secrets.ps1`. Never commit secrets; never echo the Anthropic key.
- Manual deploy fallback (also the prod-restore path): `infra/deploy-api.ps1` and
  `infra/deploy-web.ps1` — run from a Windows machine.
- Re-seeding demo data: `infra/seed.ps1` (add `-Force` to overwrite).
- PowerShell 5.1 quirk on this machine: don't edit repo files via `Set-Content`/regex (UTF-8
  mojibake) — use proper editor tooling; avoid em dashes in `.ps1` strings.
