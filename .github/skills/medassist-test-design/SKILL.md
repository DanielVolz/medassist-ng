---
name: medassist-test-design
description: Plan, write, or change MedAssist unit, integration, and Playwright tests, including equivalent German requests.
---

# Test Design

## Use When

Use only to select a test layer or plan, write, update, or review test coverage.

## Do Not Use When

Do not use only to run local checks or diagnose GitHub CI workflows. Do not own
product implementation beyond identifying the repair owner.

## Responsibilities

- Select the smallest meaningful layer: backend Vitest in `backend/src/test/**`,
  frontend Vitest/Testing Library in `frontend/src/test/**`, or browser behavior in
  `frontend/e2e/**`.
- Place coverage beside existing domain patterns and use established fixtures,
  helpers, selectors, and app bootstraps.
- Define deterministic regression criteria that fail against the real defect and
  assert observable behavior rather than implementation details.
- Use Playwright when browser routing, auth/session, responsive interaction, or
  persisted user workflow behavior matters; use Vitest for isolated rendering,
  hooks, utilities, and request/state behavior.
- Keep mocks minimal, avoid timing-only assertions, and include boundary/error
  cases proportionate to risk.

## Medication Editor UI Gate

- Extend `frontend/e2e/medication-ui-regression.spec.ts` using the opt-in `uiTest`
  fixture when real light/dark themes and motion preferences matter. Preserve the
  ordinary fixture's existing behavior.
- Cover both desktop and mobile edit paths with deterministic fictional records;
  use geometry, scroll/action reachability, keyboard, and error-state assertions
  alongside the four visual references.
- The scoped axe audit permits exact reviewed existing rule/target findings,
  not blanket rule exclusions or a claim of full accessibility compliance.
  Report existing defects separately; do not silently approve new findings.
- Shared auth and destructive seed helpers are not worker-safe. Parallel coverage
  requires isolated accounts/data or separate containers, not just more workers.
- Baseline changes require rendered-image review and the explicit Docker update
  command documented in `docs/DEVELOPMENT.md`. Then hand execution to
  `medassist-test-local-validation` and compare without update mode.

## Output

Report selected layer, test location, regression criteria, required coverage or
Playwright scope, and whether local validation is now needed.
