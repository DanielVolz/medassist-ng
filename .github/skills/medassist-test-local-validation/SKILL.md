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

## Medication Editor UI Gate

- Follow `AGENTS.md`'s UI Regression Validation rules for applicability and
  timing. For an applicable change, run this through `testing-manager` before
  handoff; report the exact command/result or an explicit blocker.
- Run `npm --prefix frontend run test:e2e:ui:docker` for the canonical functional
  and accessibility suite; the runner pins Playwright 1.63.0 and Linux AMD64.
  Pixel comparisons and screenshot baselines are not CI gates.
- The default is one shard/worker. `--shards=2` isolates containers, auth,
  databases, shared build output, results, and reports; it is opt-in because
  measured ARM-host emulation was slower with two shards. Do not equate more
  workers with faster or correct tests.
- Docker dependency volumes are keyed by manifests, locks, image, architecture,
  and shard, with installation locks. Use `--no-cache` for a disposable install.
  Auth state, databases, and results must never be added to the cache.
- Use `--repeat-each=N` for stability checks. Measure comparable wall/test times
  before claiming improvement; a 60-second in-progress message is not a hang.
- Traces and linked HTML reports are sensitive local evidence; the UI CI job
  uploads failure screenshots/video and reduced diagnostic counts/status codes
  for fictional data only. These artifacts are diagnostic evidence, not image
  comparison gates. See `docs/DEVELOPMENT.md` for locations and commands.

## Representative Commands

```bash
cd backend && CI=true npm run test:run -- src/test/example.test.ts
cd frontend && CI=true npm run test:run -- src/test/example.test.tsx
cd frontend && CI=true PLAYWRIGHT_HTML_OPEN=never npm run test:e2e -- frontend/e2e/example.spec.ts
npm run check
```
