---
name: medassist-test-local-validation
description: Run MedAssist local tests, lint, type checks, builds, or Playwright validation noninteractively, including equivalent German requests.
---

# Test Local Validation

## Use When

Use only to run local test, lint, type-check, build, or Playwright validation.

## Do Not Use When

Do not design or change tests, and do not inspect or triage GitHub CI failures.

## Procedure

- Start with the smallest check that directly exercises the requested behavior;
  widen to a package check, suite, or root `npm run check` only for shared scope,
  ambiguous failures, or release-gate evidence.
- Use finite noninteractive commands. Set `CI=true` for test runners where
  relevant, and set `PLAYWRIGHT_HTML_OPEN=never` on every Playwright command.
- Preserve CI-like single-worker Playwright execution when validating CI behavior.
- Prefer existing package scripts and report the exact command, result, scope,
  omitted broader checks with rationale, and residual risk.

## Representative Commands

```bash
cd backend && CI=true npm run test:run -- src/test/example.test.ts
cd frontend && CI=true npm run test:run -- src/test/example.test.tsx
cd frontend && CI=true PLAYWRIGHT_HTML_OPEN=never npm run test:e2e -- frontend/e2e/example.spec.ts
npm run check
```
