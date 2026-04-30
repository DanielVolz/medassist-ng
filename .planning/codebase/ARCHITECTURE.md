<!-- refreshed: 2026-04-30 -->
# Architecture

**Analysis Date:** 2026-04-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Frontend SPA (React)                     │
├──────────────────┬──────────────────┬───────────────────────┤
│ App Shell/Routes │ Shared State     │ Feature Pages          │
│ `frontend/src/   │ `frontend/src/   │ `frontend/src/pages/`  │
│ App.tsx`         │ context/`        │                         │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend API (Fastify)                      │
│ `backend/src/index.ts` + `backend/src/routes/`             │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SQLite Persistence + Migration Layer                         │
│ `backend/src/db/schema.ts` + `backend/src/db/client.ts`    │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Frontend bootstrap | Mount providers/router and start app tree | `frontend/src/main.tsx` |
| App router/shell | Public share routes, authenticated shell routes, global modal composition | `frontend/src/App.tsx` |
| Frontend orchestration | Compose domain hooks and expose app-level state/actions | `frontend/src/context/AppContext.tsx` |
| API proxy boundary | Rewrite `/api/*` requests to backend root routes | `frontend/vite.config.ts` |
| Backend composition root | Register plugins/routes, await migrations, start schedulers | `backend/src/index.ts` |
| Route handlers | HTTP contracts, validation, auth hooks, response shaping | `backend/src/routes/*.ts` |
| Domain services | Shared domain logic and scheduler behavior | `backend/src/services/*.ts` |
| Persistence | Table definitions + compatibility migration/runtime initialization | `backend/src/db/schema.ts`, `backend/src/db/client.ts` |

## Pattern Overview

**Overall:** Layered modular monolith (single frontend SPA + single backend process)

**Key Characteristics:**
- Frontend uses React Router + context/hook composition (`frontend/src/App.tsx`, `frontend/src/context/AppContext.tsx`).
- Backend uses route modules with shared service modules (`backend/src/routes/medications.ts`, `backend/src/services/medications-service.ts`).
- Data persistence is centralized in Drizzle schema + startup migrations (`backend/src/db/schema.ts`, `backend/src/db/client.ts`).

## Layers

**Frontend Presentation + Orchestration:**
- Purpose: Render UI, route navigation, manage client state, invoke API.
- Location: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/`, `frontend/src/context/`, `frontend/src/hooks/`.
- Contains: pages, modals, app shell, hook-based API callers.
- Depends on: backend `/api/*`, i18n, shared frontend utils/types.
- Used by: browser clients.

**Backend HTTP/API Layer:**
- Purpose: Expose REST endpoints, authenticate/authorize requests, validate input, map to service/db logic.
- Location: `backend/src/index.ts`, `backend/src/routes/`, `backend/src/plugins/`.
- Contains: Fastify app setup, route registration, auth middleware.
- Depends on: services, db client/schema, env plugin.
- Used by: frontend SPA and API consumers.

**Domain Services Layer:**
- Purpose: Reusable business logic for scheduling, notifications, stock math, parsing.
- Location: `backend/src/services/`, `backend/src/utils/`.
- Contains: reminder scheduler, notification builders/delivery, medication helpers.
- Depends on: db models and utilities.
- Used by: routes and startup process.

**Persistence Layer:**
- Purpose: Define DB schema and keep existing SQLite instances compatible.
- Location: `backend/src/db/schema.ts`, `backend/src/db/client.ts`, `backend/drizzle/`.
- Contains: tables, migration execution, backward-compatible alter migrations.
- Depends on: Drizzle + libsql client.
- Used by: routes/services.

## Data Flow

### Primary Request Path

1. Frontend page triggers API call via `/api/*` fetch (`frontend/src/pages/PlannerPage.tsx:307`).
2. Vite proxy rewrites `/api` prefix to backend route root (`frontend/vite.config.ts:23`, `frontend/vite.config.ts:26`).
3. Fastify route handles request under `/planner/send-email` with auth + validation (`backend/src/routes/planner.ts:141`, `backend/src/routes/planner.ts:158`).
4. Route loads user settings and dispatches channel delivery helpers (`backend/src/routes/planner.ts:221`, `backend/src/routes/planner.ts:432`, `backend/src/routes/planner.ts:829`).

### Public Share Flow

1. Frontend routes public token URL to shared schedule view (`frontend/src/App.tsx:35`).
2. Shared schedule component fetches token payload from `/api/share/:token` (`frontend/src/components/SharedSchedule.tsx:311`).
3. Backend public share route reads token/settings and returns filtered medication schedule (`backend/src/routes/share.ts:125`, `backend/src/routes/share.ts:156`).

**State Management:**
- Frontend: context-centric state aggregation (`frontend/src/context/AppContext.tsx:248`, `frontend/src/context/AppContext.tsx:1020`).
- Backend: DB-backed state with runtime scheduler state persisted through notification state utilities (`backend/src/services/reminder-scheduler.ts:42`).

## Key Abstractions

**Auth Context + Guards:**
- Purpose: unify session/API-key auth across protected routes.
- Examples: `backend/src/plugins/auth.ts`, `backend/src/routes/settings.ts`.
- Pattern: route-level `preHandler` guard plus request decoration (`backend/src/routes/settings.ts:138`, `backend/src/plugins/auth.ts:236`).

**Notification Delivery Contract:**
- Purpose: keep route-triggered and scheduler-triggered notifications consistent.
- Examples: `backend/src/routes/planner.ts`, `backend/src/services/reminder-scheduler.ts`, `backend/src/services/notifications/delivery.ts`.
- Pattern: shared builders/delivery/state helpers imported into both paths (`backend/src/routes/planner.ts:23`, `backend/src/services/reminder-scheduler.ts:39`).

**Frontend App Context Aggregator:**
- Purpose: centralize shared medication/settings/dose/share/refill state for page/modal consumers.
- Examples: `frontend/src/context/AppContext.tsx`, `frontend/src/context/ShareContext.tsx`.
- Pattern: compose domain hooks, expose typed value via provider (`frontend/src/context/AppContext.tsx:248`, `frontend/src/context/AppContext.tsx:1020`).

## Entry Points

**Frontend bootstrap:**
- Location: `frontend/src/main.tsx`
- Triggers: browser loads `index.html`.
- Responsibilities: initialize theme/provider stack and router (`frontend/src/main.tsx:12`, `frontend/src/main.tsx:15`).

**Backend process entry:**
- Location: `backend/src/index.ts`
- Triggers: `npm run dev`/`npm start` in backend package.
- Responsibilities: await migrations, register routes, start HTTP listener and schedulers (`backend/src/index.ts:231`, `backend/src/index.ts:305`, `backend/src/index.ts:309`, `backend/src/index.ts:334`).

## Architectural Constraints

- **Threading:** Single Node.js event loop process with in-process schedulers started at runtime (`backend/src/index.ts:309`, `backend/src/index.ts:323`).
- **Global state:** Module/global singletons exist in auth and context layers (`backend/src/plugins/auth.ts:15`, `frontend/src/context/AppContext.tsx:222`).
- **Circular imports:** Not detected from sampled route/service/db/frontend orchestration files.
- **API boundary:** Frontend network calls must use `/api/*` so proxy rewrite applies (`frontend/vite.config.ts:23`, `frontend/vite.config.ts:26`).

## Anti-Patterns

### Duplicated Backend App Wiring

**What happens:** Route/plugin registration appears in both `createApp(...)` and top-level startup path.
**Why it's wrong:** Two bootstrap paths increase divergence risk when new routes/plugins are added in one path but not the other.
**Do this instead:** Keep a single shared app-construction function used by both test/runtime startup paths (`backend/src/index.ts:133`, `backend/src/index.ts:207`, `backend/src/index.ts:289`).

### Oversized Frontend Orchestration Context

**What happens:** `AppContext` aggregates many unrelated concerns (medications, settings, doses, sharing, import/export, modal history) in one large provider.
**Why it's wrong:** High coupling and broad rerender surface make safe changes harder and increase regression risk.
**Do this instead:** Preserve existing provider contract, but move new domain concerns into focused hooks/providers and re-export through composition only when needed (`frontend/src/context/AppContext.tsx`, file size ~1035 lines).

## Error Handling

**Strategy:** Fail fast at route boundary with explicit status codes and schema validation, then log context-rich errors.

**Patterns:**
- Route validation + immediate 400 responses for invalid input (`backend/src/routes/medications.ts:76`, `backend/src/routes/medications.ts:584`).
- Planner routes return explicit channel/config errors (`backend/src/routes/planner.ts:204`, `backend/src/routes/planner.ts:509`).
- Frontend captures network errors and maps them to normalized error codes for UI handling (`frontend/src/hooks/useMedications.ts:80`).

## Cross-Cutting Concerns

**Logging:** Fastify logger options configured centrally with environment-aware formatting (`backend/src/index.ts:66`, `backend/src/index.ts:161`).
**Validation:** Zod validation for medication payloads and explicit OpenAPI schema contracts in routes (`backend/src/routes/medications.ts:76`, `backend/src/routes/planner.ts:157`).
**Authentication:** Route-level auth hooks and dual API-key/session handling (`backend/src/routes/planner.ts:141`, `backend/src/plugins/auth.ts:113`, `backend/src/plugins/auth.ts:236`).

---

*Architecture analysis: 2026-04-30*
