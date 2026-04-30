# Technology Stack

**Analysis Date:** 2026-04-30

## Languages

**Primary:**
- TypeScript (ESM) - Backend and frontend application code in `backend/src/**/*.ts` and `frontend/src/**/*.{ts,tsx}`
- SQL (SQLite migrations) - Schema evolution files in `backend/drizzle/*.sql`

**Secondary:**
- CSS - UI styling in `frontend/src/**/*.css` and CSS modules such as `frontend/src/features/schedule/TimelineSurface.module.css`
- YAML - CI/CD and compose configuration in `.github/workflows/*.yml`, `docker-compose.yml`, `docker-compose.dev.yml`
- Shell - Container/runtime entrypoints in `backend/docker-entrypoint.sh`, `frontend/nginx-entrypoint.sh`

## Runtime

**Environment:**
- Node.js 22 runtime baseline (`node:22-slim` in `backend/Dockerfile`, `frontend/Dockerfile`; `actions/setup-node@v6` with `node-version: '22'` in `.github/workflows/test.yml` and `.github/workflows/e2e.yml`)

**Package Manager:**
- npm (scripts in root `package.json`, `backend/package.json`, `frontend/package.json`)
- Lockfile: present (`backend/package-lock.json`, `frontend/package-lock.json` referenced by workflow cache in `.github/workflows/test.yml`)

## Frameworks

**Core:**
- Fastify 5 (`fastify`, `@fastify/*` in `backend/package.json`; app bootstrap in `backend/src/index.ts`)
- React 19 (`react`, `react-dom` in `frontend/package.json`; app entry in `frontend/src/main.tsx`)
- Vite 8 (`vite` and `@vitejs/plugin-react` in `frontend/package.json`; config in `frontend/vite.config.ts`)
- Drizzle ORM + libSQL client (`drizzle-orm`, `@libsql/client` in `backend/package.json`; DB init in `backend/src/db/client.ts`)
- Mantine 8 UI system (`@mantine/*` in `frontend/package.json`; provider in `frontend/src/ui/providers/AppUiProvider.tsx`)

**Testing:**
- Vitest 4 (`vitest`, `@vitest/coverage-v8` in backend/frontend package manifests; configs in `backend/vitest.config.ts`, `frontend/vitest.config.ts`)
- Playwright (`@playwright/test` in `frontend/package.json`; configs in `frontend/playwright*.config.ts`; CI run in `.github/workflows/e2e.yml`)
- Testing Library (`@testing-library/*` in `frontend/package.json`)

**Build/Dev:**
- TypeScript compiler (`tsc` scripts in `backend/package.json` and frontend type-check via `frontend/package.json`)
- TSX watcher for backend dev (`tsx watch src/index.ts` in `backend/package.json`)
- Biome for lint/format (`biome.json`, lint/check scripts across package manifests)
- Drizzle Kit for DB migration generation (`drizzle-kit` in `backend/package.json`, config in `backend/drizzle.config.ts`)

## Key Dependencies

**Critical:**
- `fastify` and `@fastify/*` - HTTP API runtime, security middleware, docs middleware (`backend/src/index.ts`)
- `drizzle-orm` + `@libsql/client` - SQLite data access and migration execution (`backend/src/db/client.ts`)
- `openid-client` + `jose` - OIDC SSO and token operations (`backend/src/routes/oidc.ts`, `backend/package.json`)
- `nodemailer` - SMTP notification delivery (`backend/src/services/notifications/delivery.ts`)
- `react`, `react-router-dom`, `@mantine/*` - SPA UI shell, routing, and component system (`frontend/src/main.tsx`, `frontend/src/App.tsx`)
- `i18next` + `react-i18next` - Localization runtime (`frontend/src/i18n/index.ts`)

**Infrastructure:**
- `dotenv` + `zod` - env loading/validation (`backend/src/plugins/env.ts`)
- `sharp` - image processing pipeline support (`backend/package.json`, image route usage in medication flows)
- `@fastify/swagger` + `@fastify/swagger-ui` - OpenAPI docs on `/docs` (`backend/src/index.ts`)

## Configuration

**Environment:**
- Runtime env schema and validation in `backend/src/plugins/env.ts`
- Example variable inventory in `.env.example`
- Frontend proxy target via `BACKEND_URL` in `frontend/vite.config.ts` and compose files

**Build:**
- Backend TS build config: `backend/tsconfig.json`
- Frontend TS + Vite config: `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`
- DB migration tooling config: `backend/drizzle.config.ts`
- Quality tooling config: `biome.json`

## Platform Requirements

**Development:**
- Node.js 22 with npm for local runs (`backend/package.json`, `frontend/package.json` scripts)
- Optional Docker Compose local stack (`docker-compose.dev.yml`)
- Browser runtime for frontend and Playwright browser binaries for E2E (`frontend/package.json`, `.github/workflows/e2e.yml`)

**Production:**
- Containerized deployment using prebuilt images from GHCR (`docker-compose.yml` references `ghcr.io/danielvolz/medassist-ng-backend:latest` and `ghcr.io/danielvolz/medassist-ng-frontend:latest`)
- Backend persistent filesystem for SQLite/data in mounted `./data` (`docker-compose.yml`, DB path resolver in `backend/src/db/path-utils.ts`)

---

*Stack analysis: 2026-04-30*
