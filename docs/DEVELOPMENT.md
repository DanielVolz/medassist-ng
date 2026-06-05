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

## Release Workflow Safeguards

- PR validation is enforced through `.github/workflows/test.yml` and `.github/workflows/e2e.yml`.
- Workflow syntax validation is enforced through `.github/workflows/workflow-validation.yml` with `actionlint` on PRs that change workflow files under `.github/workflows/**`.
- CodeQL scans both `javascript-typescript` source code and GitHub Actions workflow changes under `.github/workflows/**` / `.github/actions/**`.
- Within product-relevant PRs, required product checks still emit their stable names and report a no-op success when a backend/frontend lane is not relevant inside that product scope.
- Workflow-only edits are validated by `Workflow Validation / Actionlint`; they do not trigger backend/frontend/Playwright/container smoke lanes by themselves, but they still run CodeQL for the `actions` language.
- Release-relevant PRs also run `.github/workflows/container-smoke.yml` as a dedicated container runtime check.
- Docker publishing is handled by `.github/workflows/docker-build.yml`.
- The reusable container smoke workflow is used in two places:
  - directly on release-relevant PRs as the visible `Container Smoke` check
  - from `docker-build.yml` before release completion
- Releases also run `npm run release:preflight` in two stages:
  - early static validation of tag, package versions, release policy, compose tags, and release workflow dependencies
  - late validation of generated changelog and `docker-compose.pinned.yml` before GitHub Release creation
- The release version policy is documented in `release-policy.json`:
  - `backend` and `frontend` must match the release tag
  - `shared` may version independently, but the exception must be reviewed explicitly per release tag
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
