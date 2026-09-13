---
name: medassist-test-ci-triage
description: Diagnose and coordinate repair of MedAssist test.yml or e2e.yml CI test failures, including equivalent German requests.
---

# Test CI Triage

## Use When

Use only for failures in `.github/workflows/test.yml` or `.github/workflows/e2e.yml`.

## Do Not Use When

Do not triage CodeQL, Docker, project, badge, release, or other non-test workflows.
Do not perform remote git, PR, tag, or release operations.

## Procedure

- Keep one CI state record: workflow/job, run URL or ID, exact failing log, current
  head, changed scope, classification, local reproduction, repair owner, and
  revalidation result.
- Use GitHub MCP as policy allows to obtain current check state and exact failure
  logs. Classify the failure before changing code: test defect, product defect,
  environment, or workflow infrastructure.
- Reproduce the narrow failure locally at the reported head. Load test design or
  local validation only when needed for that next phase.
- Send product repairs to the appropriate implementation owner; retain continuous
  testing ownership through deterministic revalidation.
- Hand a green result, commands, and remaining risk to `@release-manager`.
