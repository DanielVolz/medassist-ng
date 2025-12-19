# Medassist (Rebuild)

Sichere, schlanke Neuimplementierung mit Fastify + SQLite + React/Vite. Docker-first, Caddy übernimmt TLS.

## Architektur
- Backend: Fastify, SQLite (Drizzle/Kysely/Prisma ready), Auth mit HttpOnly-Cookies (Browser) + Bearer (API). Helmet, CORS-Allowlist, Rate Limit, CSRF double-submit, Input-Validation (zod/ajv).
- Frontend: React + Vite (TS). Geschützte Views, zentraler API-Client.
- Tokens: Access ~15m, Refresh rotierend (sliding) mit Max-Age ~14d, Reuse-Detection.
- Planner/Email: Server-escaped, Throttling, SMTP-Pass write-only.
- Deployment: Docker Compose (app + sqlite volume). Caddy als vorgelagerter Proxy/TLS.

## Entwicklung
- Node-Version: siehe .nvmrc
- Env: .env.example kopieren → .env
- Workspaces: root package.json mit backend/frontend Workspaces
- Scripts (nach npm install in beiden Paketen):
  - Backend: `npm run dev` (backend), `npm run build`, `npm run start`
  - Frontend: `npm run dev`, `npm run build`, `npm run preview`
  - Compose: `docker-compose up --build`

## Verzeichnisstruktur
- backend/ … Fastify-App, Migrations, Dockerfile
- frontend/ … React/Vite-App, Dockerfile
- docker-compose.yml … lokale Orchestrierung

## Security Defaults
- Keine Secrets in Logs/Responses
- CSRF nur für Cookie-Clients
- CORS-Liste aus ENV
- Non-root Container, Healthcheck

## Nächste Schritte
- Dependencies installieren
- DB-Migrationen ausführen
- Frontend-Routen/Views ausbauen
