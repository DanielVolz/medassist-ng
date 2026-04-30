# Testing Patterns

**Analysis Date:** 2026-04-30

## Test Framework

**Runner:**
- Vitest 4.x for unit/integration tests in both packages:
  - Frontend config: `frontend/vitest.config.ts`
  - Backend config: `backend/vitest.config.ts`
- Config evidence:
  - Frontend uses `environment: 'jsdom'` with React setup file `frontend/src/test/setup.ts`.
  - Backend uses `environment: 'node'` with setup file `backend/src/test/setup.ts`.

**Assertion Library:**
- Vitest `expect`.
- Frontend extends DOM assertions via `@testing-library/jest-dom` in `frontend/src/test/setup.ts`.

**Run Commands:**
```bash
cd frontend && npm test                 # Watch/unit tests
cd frontend && npm run test:run         # CI-style frontend run
cd frontend && npm run test:coverage    # Frontend coverage
cd backend && npm test                  # Watch/unit tests
cd backend && npm run test:run          # CI-style backend run
cd backend && npm run test:coverage     # Backend coverage
cd frontend && npm run test:e2e         # Stable Playwright suite
cd frontend && npm run test:e2e:all     # Cross-browser Playwright suite
```

## Test File Organization

**Location:**
- Backend unit/integration tests are in `backend/src/test/*.test.ts`.
- Frontend unit/component/hook/context tests are in `frontend/src/test/**`.
- Browser E2E tests are in `frontend/e2e/*.spec.ts`.

**Naming:**
- Unit/integration: `*.test.ts` or `*.test.tsx` (for example `backend/src/test/routes-real.test.ts`, `frontend/src/test/components/MedicationDialogs.test.tsx`).
- E2E: `*.spec.ts` (for example `frontend/e2e/medication-edit.spec.ts`).

**Structure:**
```
backend/src/test/
  setup.ts
  *.test.ts

frontend/src/test/
  setup.ts
  App.test.tsx
  components/*.test.tsx
  context/*.test.tsx
  hooks/*.test.ts
  pages/*.test.tsx
  utils/*.test.ts

frontend/e2e/
  auth.setup.ts
  fixtures/index.ts
  *.spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
describe("Feature Area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles expected behavior", async () => {
    // arrange
    // act
    // assert
    expect(result).toEqual(expected);
  });
});
```
Pattern evidence: `frontend/src/test/components/MobileEditModal.test.tsx`, `backend/src/test/planner.test.ts`.

**Patterns:**
- Setup pattern:
  - Frontend centralizes browser mocks in `frontend/src/test/setup.ts` (fetch, localStorage, clipboard, history, i18n).
  - Backend provides reusable app/database factories in `backend/src/test/setup.ts` (`buildTestApp`, `createTestUser`, `createTestMedication`).
- Teardown pattern:
  - `afterAll` closes Fastify app and DB clients (`backend/src/test/planner.test.ts`, `backend/src/test/integration.test.ts`).
- Assertion pattern:
  - Route tests assert both HTTP status and response body (`backend/src/test/routes-real.test.ts`).
  - UI tests assert presence and behavior via Testing Library role/test-id queries (`frontend/src/test/components/MedicationDialogs.test.tsx`).

## Mocking

**Framework:**
- Vitest mocks (`vi.mock`, `vi.fn`, `vi.hoisted`, `vi.stubGlobal`).

**Patterns:**
```typescript
const { testClient, testDb } = vi.hoisted(() => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  return { testClient: client, testDb: db };
});

vi.mock("../db/client.js", () => ({
  db: testDb,
  migrationsReady: Promise.resolve(),
}));
```
Pattern evidence: `backend/src/test/integration.test.ts`, `backend/src/test/routes-real.test.ts`.

```typescript
vi.mock("../../components/ConfirmModal", () => ({
  ConfirmModal: ({ onConfirm }) => <button onClick={onConfirm}>confirm</button>,
}));
```
Pattern evidence: `frontend/src/test/components/MedicationDialogs.test.tsx`.

**What to Mock:**
- External side effects and infrastructure boundaries: SMTP/nodemailer, fetch network calls, auth/plugin env modules, browser APIs.
- Component dependencies in focused unit tests (replace heavy children with stubs).

**What NOT to Mock:**
- Core business behavior under direct test (route handlers in route tests, hook logic in hook tests, E2E API + UI flow in Playwright).

## Fixtures and Factories

**Test Data:**
```typescript
const userId = await createTestUser(client, { username: "testuser" });
const medId = await createTestMedication(client, { userId, name: "Test Medication" });
```
Pattern evidence: `backend/src/test/setup.ts`, used by `backend/src/test/medications.test.ts`.

```typescript
export const test = base.extend({
  page: async ({ page }, use) => {
    await applyVideoSafetyMode(page);
    await setupAuthMeMock(page);
    await use(page);
  },
});
```
Pattern evidence: `frontend/e2e/fixtures/index.ts`.

**Location:**
- Backend factories/utilities: `backend/src/test/setup.ts`.
- Frontend E2E shared fixtures and API helpers: `frontend/e2e/fixtures/index.ts`.

## Coverage

**Requirements:**
- Frontend global thresholds in `frontend/vitest.config.ts`: lines/functions/branches/statements = 75.
- Backend global thresholds in `backend/vitest.config.ts`: lines 60, functions 65, branches 50, statements 60.

**View Coverage:**
```bash
cd frontend && npm run test:coverage
cd backend && npm run test:coverage
```

## Test Types

**Unit Tests:**
- Component/hook/utils tests in `frontend/src/test/**`.
- Utility/service route-unit style tests in `backend/src/test/*.test.ts`.

**Integration Tests:**
- Backend route interaction and multi-route behavior tests in files like:
  - `backend/src/test/integration.test.ts`
  - `backend/src/test/routes-real.test.ts`

**E2E Tests:**
- Playwright used with setup project and browser projects (`frontend/playwright.base.config.ts`).
- Auth/session and API seeding helpers in `frontend/e2e/fixtures/index.ts`.

## Common Patterns

**Async Testing:**
```typescript
await waitFor(() => {
  expect(mockFn).toHaveBeenCalledTimes(1);
});
```
Pattern evidence: `frontend/src/test/context/AppContext.test.tsx`.

```typescript
const response = await app.inject({ method: "GET", url: "/settings" });
expect(response.statusCode).toBe(200);
```
Pattern evidence: `backend/src/test/routes-real.test.ts`.

**Error Testing:**
```typescript
const response = await app.inject({ method: "POST", url: "/planner/send-email", payload: { rows: [] } });
expect(response.statusCode).toBe(400);
expect(response.json()).toEqual({ error: "Missing planner data" });
```
Pattern evidence: `backend/src/test/planner.test.ts`.

---

*Testing analysis: 2026-04-30*
