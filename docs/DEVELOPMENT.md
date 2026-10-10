# Development

## Start the Development Stack

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml up
```

If you changed `docker-compose.dev.yml`, added new bind mounts, or introduced a new local package like `shared/`, do not rely on `docker compose restart` alone. Restarting reuses the old containers and does not apply mount changes. Recreate the development services instead:

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml up -d --force-recreate backend-dev frontend-dev
```

## Start the Medtest Domain Overlay

If you want the local dev stack to be reachable through `https://medtest.danielvolz.org`, start the stack with the medtest overlay as well. That overlay adds the required Caddy labels, joins the `caddy-proxy` network, and sets the frontend host/HMR values for the public domain.

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml -f docker-compose.medtest-dev.yml up -d backend-dev frontend-dev
```

If you need to recreate the stack for medtest after config changes, use both files during recreation too:

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml -f docker-compose.medtest-dev.yml up -d --force-recreate backend-dev frontend-dev
```

## Service Endpoints

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- API docs UI: `http://localhost:3000/docs` when docs are enabled
- OpenAPI JSON: `http://localhost:3000/docs/json` when docs are enabled
- Docs are open in no-auth local development; authenticated setups protect docs by default unless `DOCS_AUTH_REQUIRED=false` is set.

## Local Production-Build Preview

With the backend running separately on port `3000`:

```bash
npm --prefix frontend run build
npm --prefix frontend run preview
```

Preview serves `http://localhost:4174`; development stays on `http://localhost:5173`.
Both use strict port checking and proxy `/api/*` to the backend (`BACKEND_URL`
overrides the target). Preview fails if port `4174` is occupied. The backend's
default CORS allowlist includes both origins; a copied `.env.example` explicitly
allows only `4174`, so include `5173` when using the dev server too.

## Playwright Runtime Isolation

Local Playwright runs start their own backend and frontend servers instead of reusing the always-on development stack:

- Frontend: `http://localhost:4174`
- Backend: `http://localhost:4175`
- Backend data: `frontend/test-results/e2e-data`

This keeps `npm --prefix frontend run test:e2e` from colliding with the Docker dev stack on `3000`/`5173` or mutating the normal local SQLite data. Override these defaults with `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_API_BASE_URL`, `PLAYWRIGHT_FRONTEND_PORT`, or `PLAYWRIGHT_DATA_DIR` when an E2E run must target a specific external server.

The Chromium core project retains a trace on failure even with zero retries.
Traces can contain disposable test credentials and request data; treat them as
sensitive debugging artifacts, not sanitized logs.

`npm --prefix frontend run test:e2e:all` owns its server URLs and runs Chromium core and data tests together, then runs Firefox and WebKit in separate Playwright processes. Each browser batch receives fresh backend data, an isolated authentication-state file, and temporary result output, so sensitive authentication route limits do not accumulate across browsers and existing report/results directories are not cleared. Successful runs remove their temporary workspace; failed runs print and retain its path for diagnostics. Use the direct Playwright CLI when targeting an externally managed server.

For the focused authenticated medication-editor UI regressions, run:

```bash
npm --prefix frontend run test:e2e:ui:docker
```

This gate is required after a medication-editor change or a shared style/component
change that affects the editor, and must pass or be reported as blocked before
handoff. Plan for it before editing; implementation agents inspect the actual
screen in the anonymous Local UI Sandbox before and after the change, while
`testing-manager` runs this authenticated Docker comparison. Unrelated frontend
changes do not require the editor-specific gate, and agents should not ask users
to run its shell command.

It uses the pinned Playwright `1.63.0` Linux AMD64 container used by CI, with
disposable auth/database state and fictional sample data; it does not touch `data/`, `.ui-dev/`, or the normal E2E auth profile. It tests desktop/mobile in
light/dark with real theme and motion preferences. It compares editor screenshots
and checks layout/scroll reachability, keyboard behavior, validation and failed
saves, plus scoped, reviewed accessibility findings. Each local run uses a new
result directory under ignored `frontend/test-results/`. The default is one
container. Use `--shards=2` to opt into two separate containers, each running
one Playwright shard (`PLAYWRIGHT_UI_SHARDS=2` is also available for scripted
runs); each container has its own
temporary filesystem, auth state, database, shared build output, test results,
and HTML report, avoiding shared-account rate limits or result-file races.
Shard count is bounded to one or two. Both containers use the same pinned Linux
AMD64 image and keep Playwright workers at one. Snapshot updates automatically
use one shard; passing `--shards=2` with
`--update-snapshots` is rejected to prevent concurrent baseline writes.
Preserve repeat runs with `--repeat-each=N`, for example:

```bash
npm --prefix frontend run test:e2e:ui:docker -- --shards=1 --repeat-each=2
npm --prefix frontend run test:e2e:ui:docker -- --shards=2 --repeat-each=2
```

Dependencies are reused in local Docker volumes named `medassist-ui-deps-*`.
The cache key includes all three package manifests and lockfiles, the pinned
image, and target architecture; changed dependencies trigger fresh installation.
Installation is locked per shard and marked complete only after all packages
install successfully. No auth state, database, or test results are cached.
Use `--no-cache` to install into disposable filesystems instead.

On this ARM Mac with eight Docker CPUs, two emulated AMD64 shards were slower
than one (263 versus 176 seconds for the same suite), so parallelism is opt-in.
A subsequent cold/warm cache comparison passed all 14 tests in 186/164 seconds
respectively. These measurements include startup and are not a guaranteed
speedup on other machines. The canonical image and screenshot references stay
unchanged.

The generated HTML reports are stored in ignored
`frontend/playwright-report/ui-e2e-*` directories. Trace archives
record network activity and can contain cookies, authorization headers,
request/response bodies, and URL queries; the HTML report may link to those
traces. Treat both as sensitive local artifacts; do not share or upload them.
Authentication state is kept under ignored
`frontend/e2e/.auth/` for ordinary local runs (the Docker runner uses `/tmp`).

The dedicated CI job uploads only PNG images, WebM failure video, and a
diagnostic containing event counts and HTTP status codes. It does not upload
trace archives, HTML reports, auth state, or database files. CI uses disposable
test credentials and fictional records. `chromium-ui` is enabled only by the
dedicated scripts via `PLAYWRIGHT_UI_TESTS=true`; ordinary E2E, headed, and
cross-browser runs exclude the UI spec. Snapshot updates are disabled by
default for UI runs; baselines stay under `frontend/e2e/*-snapshots/`.
The UI job runs in the test workflow's reusable Playwright E2E path: relevant
frontend/backend changes run it after the existing backend-test and
frontend-build gates succeed. Its failure fails the reusable Playwright E2E
result and legacy `Playwright E2E` commit status. Frontend specs, fixtures,
Playwright configuration, UI runner, and frontend lockfile changes are included
by the frontend path filter. The release manager monitors the GitHub check;
developers do not need to run shell commands to monitor CI.

The scoped axe audit checks the editor subtree, including its inputs, buttons,
and tabs; it records exact existing rule/target findings, not full compliance.
Only reviewed exact findings are allowed; new ones fail. UI repairs remain
with the implementation owner.

Refresh baselines only after inspecting rendered images and approving changes:

```bash
npm --prefix frontend run test:e2e:ui:docker:update
```

## Browser MCP Access

The workspace MCP servers `playwright` (Chrome) and `playwright-firefox`, plus the global user Playwright and Chrome DevTools servers, default to headless, isolated browser sessions. Headless mode prevents visible windows and focus theft; use a headed session only when the task cannot be completed headlessly, and announce the visible browser launch to the user beforehand. Isolated sessions avoid profile lock collisions but do not persist across browser close or server restart; existing browser profiles are not deleted. After editing MCP configs, restart the existing modified servers through VS Code's `MCP: List Servers` command or reload VS Code for the new flags to take effect.

## Frontend Dev Server Behind a Proxy

If the frontend dev server runs behind a reverse proxy or on a remote host, set these frontend-only environment variables before starting Vite:

These development overrides are documented here intentionally and are not part of the standard operator-focused `.env.example` surface.

## API Proxy Contract

- Frontend browser code should call `/api/*`, not hardcoded backend hostnames.
- Vite rewrites `/api/*` to the backend target configured by `BACKEND_URL` or the built-in default for the current environment.
- Default backend target:
	- local dev outside Docker: `http://localhost:3000`
	- dev stack inside Docker: `http://backend-dev:3000`
- If your backend runs on a different host or service name, set `BACKEND_URL` explicitly before starting Vite.

- `BACKEND_URL`: backend target used by the Vite `/api` proxy; default `http://localhost:3000` outside Docker and `http://backend-dev:3000` in Docker
- `VITE_ALLOWED_HOSTS`: comma-separated hostnames allowed to connect to the dev server; default `localhost,127.0.0.1` plus the hostname from `PUBLIC_APP_URL` when configured
- `VITE_HMR_HOST`: public hostname for HMR websocket connections
- `VITE_HMR_PROTOCOL`: websocket protocol override (`ws` or `wss`)
- `VITE_HMR_CLIENT_PORT`: public websocket port exposed to the browser
- `VITE_HMR_PORT`: server-side websocket port for the Vite process

## Useful Commands

When running commands directly on the host instead of through Docker, install dependencies in all local packages first:

```bash
cd shared && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

```bash
npm run lint
npm run check
npm run build
cd backend && npm run test:run
cd frontend && npm run test:run
```

Recommended local maintenance preflight before opening or updating a PR:

```bash
npm run check
npm run build
```

Use the root-level commands for full-stack validation when a change spans backend and frontend. Keep using the package-local commands when you are validating only one slice.

The frontend `check` command type-checks application code, Vite, Vitest, and Playwright config files, and the separate E2E TypeScript project. To check only E2E types from the repository root, run:

```bash
cd frontend && npx tsc --noEmit -p e2e/tsconfig.json
```

## Knip Audit

From the repository root, run the same full audit used by the PR CI Knip job across the root, backend, frontend, and shared packages:

```bash
npm run check:knip
```

To review only dependencies during local triage:

```bash
npm exec --yes --package=knip@6.38.0 -- knip --dependencies --reporter compact
```

Review each finding against imports, scripts, CSS, dynamic consumers, tests, and public contracts. An unused export may still be locally used: remove only the `export` keyword in that case. Remove declarations only after checking references and side effects; do not run `--fix` without review. Keep `knip.jsonc` exceptions narrow and rerun Knip and the affected package checks after changes. The Knip job fails on new findings in PRs that touch its source, dependency, or configuration paths.

## Release Workflow Safeguards

- README-only PRs emit the required backend, frontend, and Playwright statuses as successful no-op checks; package tests and browser suites run only for relevant source or workflow changes.
- PR validation is enforced through `.github/workflows/test.yml`, `.github/workflows/e2e.yml`, and `.github/workflows/container-smoke.yml`.
- Workflow syntax validation is enforced through `.github/workflows/workflow-validation.yml` with `actionlint` on PRs that change workflow files under `.github/workflows/**`.
- CodeQL scans both `javascript-typescript` source code and GitHub Actions workflow changes under `.github/workflows/**` / `.github/actions/**`.
- Within product-relevant PRs, required product checks still emit their stable names and report a no-op success when a backend/frontend lane is not relevant inside that product scope.
- Workflow-only edits are validated by `Workflow Validation / Actionlint`; they do not trigger backend/frontend/Playwright/container smoke lanes by themselves, but they still run CodeQL for the `actions` language.
- Release-relevant PRs also run `.github/workflows/container-smoke.yml` as a dedicated visible `Container Smoke` PR check after `Backend Tests`, `Frontend Build`, and `Playwright E2E` are green.
- Dependabot auto-merge for safe updates is gated by `.github/workflows/dependabot-automerge.yml` and currently allows `npm`, `npm_and_yarn`, and `github_actions` ecosystems for semver minor/patch updates only.
- The default-branch ruleset requires the stable CodeQL context `Analyze (javascript-typescript)`, so workflow changes must keep the CodeQL job name aligned with that exact required-check context.
- Docker publishing is handled by `.github/workflows/docker-build.yml`.
- The reusable container smoke workflow is used in two places:
  - directly on release-relevant PRs as the visible `Container Smoke` check
  - from `docker-build.yml` before release completion
- Docker Buildx cache export is allowed to fail in smoke/publish builds (`ignore-error=true`) because cache reservation is an optimization; container build, startup, health, static asset, and proxy checks remain the required signal.
- Releases also run `npm run release:preflight` in two stages:
  - early static validation of tag, package versions, release policy, compose tags, and release workflow dependencies
  - late validation of generated changelog and `docker-compose.pinned.yml` before GitHub Release creation
- The release version policy is documented in `docs/release-policy.md` and enforced by `release-policy.json`:
  - `backend`, `frontend` and `shared` must all match the release tag
  - backend and frontend must keep consuming `@medassist/shared` through `file:../shared`
  - Docker builds must copy and build the intended shared package from source
- Container smoke covers:
  - backend shared-runtime import plus backend `/health` startup check
  - frontend container boot, static asset serving, and `/api/health` proxy wiring
- Published release images also carry OCI SBOM/provenance attestations.

## Project Automation Configuration

GitHub Project automation expects these repository settings:

- `vars.PROJECT_URL`: GitHub Project v2 URL in the form `https://github.com/users/<owner>/projects/<number>` or `https://github.com/orgs/<owner>/projects/<number>`
- `vars.PROJECT_AUTOMATION_APP_ID`: GitHub App ID for Project automation
- `secrets.PROJECT_AUTOMATION_APP_PRIVATE_KEY`: private key for that GitHub App installation
- optional transitional fallback: `secrets.ADD_TO_PROJECT_PAT`

The project workflows now prefer a GitHub App token and only fall back to `ADD_TO_PROJECT_PAT` with an explicit warning while the App rollout is incomplete. They also parse `PROJECT_URL` as either a user-owned or organization-owned project and query the correct GraphQL root explicitly instead of probing both and risking false failures.

The project workflows resolve project and field IDs dynamically from `PROJECT_URL`.

Required fields:

- `Status` with a `Done` option
- `Type`
- `Priority`

Recommended deterministic routing fields:

- `Area`: `backend`, `frontend`, `shared`, `ci`, `docker`, `release`, `security`, `docs`, `project-automation`
- `Risk`: `low`, `medium`, `high`, `release-blocking`
- `Agent`: `project-bot`, `implementation-agent`, `ci-surgeon`, `security-reviewer`, `testing-manager`, `release-manager`, `frontend-refactor-agent`
- `Validation`: `unit`, `domain`, `coverage`, `e2e-smoke`, `e2e-full`, `container-smoke`, `security`, `release-preflight`

Label-to-field sync currently supports:

- `priority/high`, `priority/medium`, `priority/low`
- `area/*`
- `risk/*`
- `agent/*`
- `validation/*`

If the configured project is inaccessible or missing required field/options, the workflows fail clear. Missing optional routing fields currently warn and skip instead of breaking issue intake during project-schema rollout.
