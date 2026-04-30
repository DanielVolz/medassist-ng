# External Integrations

**Analysis Date:** 2026-04-30

## APIs & External Services

**Medication Data APIs:**
- European Medicines Agency (EMA) JSON catalog - medication lookup seed and periodic catalog refresh
  - SDK/Client: native `fetch` in `backend/src/services/medication-enrichment.ts` (`EMA_MEDICINES_URL`)
  - Auth: none detected in code
- RxNorm (NLM RxNav REST) - normalized name/search enrichment and strength/form hints
  - SDK/Client: native `fetch` in `backend/src/services/medication-enrichment.ts` (`RXNORM_BASE_URL`)
  - Auth: none detected in code
- openFDA NDC API - product/package metadata enrichment
  - SDK/Client: native `fetch` in `backend/src/services/medication-enrichment.ts` (`OPENFDA_NDC_URL`)
  - Auth: none detected in code

**Authentication/Identity Provider Integration:**
- OIDC providers (Authelia, Authentik, Pocket ID, Keycloak documented) - SSO login/callback flow
  - SDK/Client: `openid-client` used in `backend/src/routes/oidc.ts`
  - Auth: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` validated in `backend/src/plugins/env.ts`

**Messaging/Notifications:**
- SMTP providers - transactional reminder/test emails
  - SDK/Client: `nodemailer` in `backend/src/services/notifications/delivery.ts`
  - Auth: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` or `SMTP_TOKEN`, `SMTP_FROM`, `SMTP_SECURE`
- Push endpoints via Shoutrrr-compatible URL parsing
  - SDK/Client: native `fetch` in `backend/src/routes/settings.ts` (`sendShoutrrrNotification`)
  - Auth: URL-embedded creds/token per provider and optional basic auth extracted/sanitized in code
- Explicit external push provider endpoints used directly:
  - `https://api.pushover.net/1/messages.json` in `backend/src/routes/settings.ts`
  - `https://api.telegram.org` in `backend/src/routes/settings.ts`

## Data Storage

**Databases:**
- SQLite (file-based, local persistent volume)
  - Connection: `DATA_DIR` (path resolution), optional `DOTENV_PATH` for env source
  - Client: `@libsql/client` + `drizzle-orm` in `backend/src/db/client.ts`
- Migration pipeline:
  - SQL migration artifacts in `backend/drizzle/*.sql`
  - Runtime migration/alter execution in `backend/src/db/client.ts` and `backend/src/db/migration-utils.ts`

**File Storage:**
- Local filesystem only
  - Backend data root resolved by `backend/src/db/path-utils.ts`
  - Image/static user files served from `/images` in `backend/src/index.ts`
  - Compose bind mount `./data:/app/data` in `docker-compose.yml`

**Caching:**
- In-process memory cache only for selected integration data
  - OIDC discovery config cache in `backend/src/routes/oidc.ts` (`oidcConfig`)
  - EMA catalog snapshot + refresh promise in `backend/src/services/medication-enrichment.ts`
- No external cache service detected (no Redis/Memcached dependency in package manifests)

## Authentication & Identity

**Auth Provider:**
- Custom session/JWT auth with optional OIDC SSO extension
  - Implementation: Fastify cookie + JWT plugin, refresh token table, API key hashing in `backend/src/plugins/auth.ts`, `backend/src/routes/auth.ts`, `backend/src/plugins/jwt.ts`, `backend/src/routes/oidc.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected for third-party SaaS error tracking (no Sentry/Rollbar/etc. dependencies)

**Logs:**
- Structured app logging via Fastify/Pino in `backend/src/index.ts`
- Pretty logging in dev through `pino-pretty` (`backend/package.json`, logger setup in `backend/src/index.ts`)
- Frontend/nginx log behavior controlled through env and `frontend/nginx-entrypoint.sh` (documented in `.env.example`)

## CI/CD & Deployment

**Hosting:**
- Container image publishing to GitHub Container Registry (`ghcr.io`) in `.github/workflows/docker-build.yml`
- Runtime deployment model is self-hosted Docker Compose stack (`docker-compose.yml`)

**CI Pipeline:**
- GitHub Actions for lint/type/test (`.github/workflows/test.yml`)
- Playwright E2E job (`.github/workflows/e2e.yml`)
- Docker build/push and optional release automation (`.github/workflows/docker-build.yml`)

## Environment Configuration

**Required env vars:**
- Core runtime: `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`, `TZ` (`backend/src/plugins/env.ts`, `.env.example`)
- Auth when enabled: `AUTH_ENABLED=true` with `JWT_SECRET`, `REFRESH_SECRET`, `COOKIE_SECRET` (`backend/src/plugins/env.ts`)
- OIDC when enabled: `OIDC_ENABLED=true` with issuer/client/redirect vars (`backend/src/plugins/env.ts`)
- Email notifications: `SMTP_HOST`, `SMTP_USER`, plus pass/token and sender config (`backend/src/services/notifications/delivery.ts`, `.env.example`)
- Data location: `DATA_DIR` used by DB path resolver (`backend/src/db/path-utils.ts`)

**Secrets location:**
- Local runtime env file `.env` (present in repository root; values not inspected)
- CI secrets managed by GitHub Actions secret store (e.g., `${{ secrets.GITHUB_TOKEN }}` in `.github/workflows/docker-build.yml`)

## Webhooks & Callbacks

**Incoming:**
- OIDC callback endpoint: `/auth/oidc/callback` in `backend/src/routes/oidc.ts`
- No inbound third-party webhook receiver route detected in backend routes

**Outgoing:**
- Outbound HTTP notifications to webhook-style targets from `sendShoutrrrNotification` in `backend/src/routes/settings.ts`
- Provider-specific outgoing callbacks/APIs:
  - Pushover API endpoint
  - Telegram Bot API endpoint
- Outbound SMTP delivery through configured mail host (`backend/src/services/notifications/delivery.ts`)

---

*Integration audit: 2026-04-30*
