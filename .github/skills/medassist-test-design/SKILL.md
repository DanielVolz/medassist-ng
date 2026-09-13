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

## Output

Report selected layer, test location, regression criteria, required coverage or
Playwright scope, and whether local validation is now needed.
