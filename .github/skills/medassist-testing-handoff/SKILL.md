---
name: medassist-testing-handoff
description: Enforce MedAssist testing ownership by delegating test planning, execution, and CI test failure triage to testing-manager, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill whenever a task includes writing tests, running tests, or diagnosing test-related CI failures.

## Ownership Rules

- Test planning, implementation, and execution are owned by `@testing-manager`.
- CI test-failure triage (`test.yml`, `e2e.yml`) is owned by `@testing-manager`.
- Normal coding agent should hand off testing tasks instead of executing testing workflows directly.

## Handoff Template

Use this structure for delegation:

1. Scope: feature/fix and affected files
2. Expected behavior
3. Suggested test layers (unit/integration/e2e)
4. CI failure context (if applicable)

## Response Format

When triggered, output:

- "Testing handoff required"
- Delegate target: `@testing-manager`
- Minimal handoff brief (scope + expected behavior)
