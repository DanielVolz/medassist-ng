# Codebase Structure

**Analysis Date:** 2026-04-30

## Directory Layout

```
medassist/
├── frontend/                 # React + Vite SPA, UI, hooks, page routes, frontend tests
├── backend/                  # Fastify API, domain services, DB schema/migrations, backend tests
├── backend/drizzle/          # SQL migration files + drizzle meta journal
├── docs/                     # Product/ops docs and screenshots
├── doku/                     # Local-only working notes and reports (ignored)
├── .github/                  # CI workflows, agents, local skill/runtime metadata
├── .planning/codebase/       # Generated codebase mapping documents
├── data/                     # Runtime/local SQLite backups and scheduler files
└── package.json              # Root workspace scripts for lint orchestration
```

## Directory Purposes

**frontend/src:**
- Purpose: Product UI and client-side app logic.
- Contains: `pages/`, `components/`, `context/`, `hooks/`, `ui/`, `utils/`, `i18n/`, `test/`.
- Key files: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/context/AppContext.tsx`.

**backend/src:**
- Purpose: HTTP API, auth, domain services, and persistence access.
- Contains: `routes/`, `services/`, `plugins/`, `db/`, `utils/`, `test/`.
- Key files: `backend/src/index.ts`, `backend/src/routes/medications.ts`, `backend/src/routes/planner.ts`, `backend/src/db/client.ts`.

**backend/drizzle:**
- Purpose: SQL migration history for SQLite compatibility.
- Contains: numbered migration files and `meta/_journal.json`.
- Key files: `backend/drizzle/0000_init.sql`, `backend/drizzle/0014_add_user_settings_timezone.sql`.

**frontend/e2e:**
- Purpose: Playwright end-to-end scenarios and fixtures.
- Contains: browser tests + auth fixtures.
- Key files: `frontend/e2e/fixtures/` and spec files under `frontend/e2e/`.

**docs + doku:**
- Purpose: formal docs (`docs/`) and local-only work tracking (`doku/`).
- Contains: behavior/spec docs, screenshots, local report/memory logs.
- Key files: `docs/TECH_STACK.md`, `doku/memory_notes.md`, `doku/report.md`.

## Key File Locations

**Entry Points:**
- `frontend/src/main.tsx`: Browser bootstrap; mounts providers and router.
- `frontend/src/App.tsx`: Route graph and global modal/shell orchestration.
- `backend/src/index.ts`: Fastify app setup + startup runtime.

**Configuration:**
- `frontend/vite.config.ts`: Dev server, `/api` proxy rewrite, build-time constants.
- `frontend/vitest.config.ts`: Frontend unit test config.
- `backend/vitest.config.ts`: Backend unit/integration test config.
- `backend/drizzle.config.ts`: Drizzle migration configuration.
- `.gitignore`: Local-only/generated path policy (including `.planning/`, `doku/`, `data/`, coverage/test artifacts).

**Core Logic:**
- `backend/src/routes/`: API contracts and request handlers.
- `backend/src/services/`: Scheduler, notifications, medication helpers.
- `backend/src/db/schema.ts`: Source-of-truth table definitions.
- `frontend/src/context/`: Shared app orchestration state.
- `frontend/src/pages/`: Screen-level composition.

**Testing:**
- `frontend/src/test/`: Frontend unit/component tests.
- `frontend/e2e/`: Playwright E2E tests.
- `backend/src/test/`: Backend route/service/db tests.

## Naming Conventions

**Files:**
- React components/pages use PascalCase: `frontend/src/pages/MedicationsPage.tsx`, `frontend/src/components/MedDetailModal.tsx`.
- Hooks use `use*` naming: `frontend/src/hooks/useMedications.ts`, `frontend/src/hooks/useSettings.ts`.
- Backend routes/services use kebab-case: `backend/src/routes/medication-enrichment.ts`, `backend/src/services/reminder-scheduler.ts`.
- Migrations use numbered descriptive names: `backend/drizzle/0012_add_api_keys_and_package_amount_columns.sql`.

**Directories:**
- Feature/layer folders are lowercase: `frontend/src/context`, `backend/src/services`.
- Test directories stay colocated by runtime side (`frontend/src/test`, `backend/src/test`).

## Where to Add New Code

**New Feature:**
- Primary code:
  - Frontend UI route/screen: `frontend/src/pages/` (compose from existing `components/`, `hooks/`, `ui/`).
  - Backend endpoint: `backend/src/routes/` + matching domain logic in `backend/src/services/`.
  - Persistence additions: `backend/src/db/schema.ts` plus migration updates in `backend/src/db/client.ts` and `backend/drizzle/`.
- Tests:
  - Frontend unit/component: `frontend/src/test/`.
  - Backend unit/integration: `backend/src/test/`.
  - E2E flow: `frontend/e2e/`.

**New Component/Module:**
- Implementation:
  - Shared UI primitive/layout: `frontend/src/ui/`.
  - Domain-specific UI component: `frontend/src/components/` (or nested feature folder).
  - Backend reusable domain behavior: `backend/src/services/`.

**Utilities:**
- Shared helpers:
  - Frontend: `frontend/src/utils/`.
  - Backend: `backend/src/utils/`.
  - DB-specific helpers: `backend/src/db/` focused utility modules.

## Special Directories

**frontend/dist, backend/dist:**
- Purpose: build output artifacts.
- Generated: Yes.
- Committed: No (`dist/` ignored in `.gitignore`).

**frontend/playwright-report, frontend/test-results, frontend/coverage, backend/coverage:**
- Purpose: test artifacts/reports.
- Generated: Yes.
- Committed: No (ignored in `.gitignore`).

**data/:**
- Purpose: runtime/local DB, reminder state, scheduler locks.
- Generated: Yes.
- Committed: No (`data/` ignored in `.gitignore`).

**doku/:**
- Purpose: local work memory/reporting and internal notes.
- Generated: Mixed (manual local notes + artifacts).
- Committed: No (`doku/` ignored in `.gitignore`).

**.planning/codebase/:**
- Purpose: generated architecture/stack/convention/concern maps for GSD planning/execution.
- Generated: Yes.
- Committed: No (`.planning/` ignored by policy in this workspace).

---

*Structure analysis: 2026-04-30*
