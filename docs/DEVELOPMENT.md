# Development

## Start the Development Stack

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml up
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
