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

## Frontend Dev Server Behind a Proxy

If the frontend dev server runs behind a reverse proxy or on a remote host, set these frontend-only environment variables before starting Vite:

These development overrides are documented here intentionally and are not part of the standard operator-focused `.env.example` surface.

- `BACKEND_URL`: backend target used by the Vite `/api` proxy; default `http://localhost:3000` outside Docker and `http://backend-dev:3000` in Docker
- `VITE_ALLOWED_HOSTS`: comma-separated hostnames allowed to connect to the dev server; default `localhost,127.0.0.1`
- `VITE_HMR_HOST`: public hostname for HMR websocket connections
- `VITE_HMR_PROTOCOL`: websocket protocol override (`ws` or `wss`)
- `VITE_HMR_CLIENT_PORT`: public websocket port exposed to the browser
- `VITE_HMR_PORT`: server-side websocket port for the Vite process

## Useful Commands

```bash
npm run lint
cd backend && npm run test:run
cd frontend && npm run test:run
```