# Coding Conventions

**Analysis Date:** 2026-04-30

## Naming Patterns

**Files:**
- Frontend React components and pages use PascalCase file names (for example `frontend/src/components/MobileEditModal.tsx`, `frontend/src/pages/MedicationsPage.tsx`).
- Hooks use `useX` camelCase naming in files and symbols (for example `frontend/src/hooks/useMedications.ts`, `frontend/src/hooks/useScheduleController.ts`).
- Backend routes/services use kebab-case file names with domain suffixes (for example `backend/src/routes/medications.ts`, `backend/src/services/medications-service.ts`).
- Test files use `*.test.ts` or `*.test.tsx` in dedicated test folders (for example `backend/src/test/planner.test.ts`, `frontend/src/test/components/MobileEditModal.test.tsx`).

**Functions:**
- Use camelCase names for functions and methods (for example `parseIntakesWithUnits` in `backend/src/services/medications-service.ts`, `loadMeds` in `frontend/src/hooks/useMedications.ts`).
- Use verb-first names for side-effect operations (`loadMeds`, `deleteMed`, `uploadMedImage` in `frontend/src/hooks/useMedications.ts`).

**Variables:**
- Use camelCase for local variables and state (`refillHistoryExpanded`, `scheduleDays`, `showFutureDays` in `frontend/src/context/AppContext.tsx`).
- Constant maps and singleton keys use UPPER_SNAKE_CASE (`LOG_LEVELS` in `backend/src/utils/logger.ts`, `APP_CONTEXT_SINGLETON_KEY` in `frontend/src/context/AppContext.tsx`).

**Types:**
- Type aliases and interfaces use PascalCase (`AppContextValue` in `frontend/src/context/AppContext.tsx`, `TestContext` in `backend/src/test/setup.ts`).
- Return-shape interfaces use `UseXReturn` convention for hooks (`UseMedicationsReturn` in `frontend/src/hooks/useMedications.ts`).

## Code Style

**Formatting:**
- Tool used: Biome (`biome.json`, scripts in `frontend/package.json`, `backend/package.json`, `package.json`).
- Key settings from `biome.json`:
  - `indentStyle: tab`
  - `indentWidth: 2`
  - `lineWidth: 120`
  - JavaScript quote style is double quotes, semicolons enabled, trailing commas `es5`.

**Linting:**
- Tool used: Biome linter (`biome.json`).
- Key rules enforced/relevant:
  - `style.useConst: error`
  - `style.noNestedTernary: warn`
  - `correctness.noUnusedVariables: warn`
  - `suspicious.noExplicitAny: warn`
- Project governance in `AGENTS.md` reinforces readable code, early returns, and no nested ternaries.

## Import Organization

**Order:**
1. Node built-ins first in backend modules (for example `node:path` in `backend/src/routes/medications.ts`, `node:crypto` in `backend/src/index.ts`).
2. External packages second (`fastify`, `zod`, `drizzle-orm` in backend; `react`, `@testing-library/*` in frontend).
3. Internal modules last with relative paths (`../db/client.js`, `../../types`).

**Path Aliases:**
- Not detected in TypeScript configs (`frontend/tsconfig.json`, `backend/tsconfig.json` do not define `paths`).
- Relative imports are the standard.

## Error Handling

**Patterns:**
- Backend validates request data with Zod schemas and `.refine(...)` constraints before route logic (`backend/src/routes/medications.ts`).
- Backend route tests assert explicit status codes and body shape (`backend/src/test/routes-real.test.ts`, `backend/src/test/planner.test.ts`).
- Frontend hooks often normalize recoverable API errors into UI-safe states (`frontend/src/hooks/useMedications.ts` converts network failures into `NETWORK_ERROR`).
- Some frontend fetch flows still use tolerant fallbacks (`catch(() => setMeds([]))` in `frontend/src/hooks/useMedications.ts`), so future changes should prefer explicit user-facing error channels per `AGENTS.md` fail-clear guidance.

## Logging

**Framework:**
- Backend startup logger wrapper over console with level filtering in `backend/src/utils/logger.ts`.
- Runtime HTTP logging via Fastify logger options in `backend/src/index.ts` (`buildLoggerOptions`, request correlation IDs).
- Frontend logging utility mirrors backend level semantics (`frontend/src/utils/logger.ts`).

**Patterns:**
- Central log-level maps (`LOG_LEVELS`) and `shouldLog` gating are standard in both frontend and backend logger modules.
- Correlation ID propagation is enforced at request boundaries (`backend/src/index.ts` onRequest hook setting `x-correlation-id`).

## Comments

**When to Comment:**
- Comments are used for rationale and test setup intent, not line-by-line narration.
- Typical examples:
  - Migration/setup intent in `backend/src/test/setup.ts`
  - E2E stability rationale in `frontend/e2e/fixtures/index.ts`
  - Timeout/determinism notes in `frontend/vitest.config.ts` and `frontend/playwright.base.config.ts`

**JSDoc/TSDoc:**
- Used selectively for exported utilities and test helpers (`backend/src/test/setup.ts`, `frontend/e2e/fixtures/index.ts`, `frontend/src/utils/logger.ts`).
- Not mandatory for every function; concise type annotations plus targeted comments are preferred.

## Function Design

**Size:**
- Small-to-medium focused functions are common in services/hooks (`parseRawIntakeUnits`, `normalizeDateTime` in `backend/src/services/medications-service.ts`).
- Larger orchestrator modules exist where domain aggregation is required (`frontend/src/context/AppContext.tsx`).

**Parameters:**
- Object parameters are used for extensibility in test factories and route payload shapes (`CreateMedicationOptions` in `backend/src/test/setup.ts`).
- Explicit primitive parameters used for concise helpers (`clickEditMed(page, medName)` in `frontend/e2e/medication-edit.spec.ts`).

**Return Values:**
- Explicit return types are common on exported functions (`Promise<TestContext>`, `UseMedicationsReturn`).
- Guard-clause returns are common for invalid input or unavailable state (`if (!intakesJson) return [];` in `backend/src/services/medications-service.ts`).

## Module Design

**Exports:**
- Named exports are preferred for utilities, hooks, and service functions (`backend/src/services/notifications/index.ts`, `frontend/src/hooks/index.ts`).
- Mixed export style is used where legacy/default exports remain practical (`default` exports in component barrel `frontend/src/components/index.ts`).

**Barrel Files:**
- Barrel files are actively used for stable import surfaces:
  - `frontend/src/components/index.ts`
  - `frontend/src/hooks/index.ts`
  - `backend/src/services/notifications/index.ts`
- Practical rule for new code: export domain-level public APIs through local barrels, keep deep internal helpers imported directly.

---

*Convention analysis: 2026-04-30*
