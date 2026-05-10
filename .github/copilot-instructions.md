# MedAssist-ng - Copilot Entry Point

## VERY IMPORTANT - Prioritized Constraints

**First: Update Memory and Reports**
- Always keep agent work memory updated in `doku/memory_notes.md` so progress and decisions remain recoverable across context loss.
  - If `doku/memory_notes.md` is missing, create it immediately.
- Always keep a user-facing work report updated in `doku/report.md` so completed work is easy to review.
  - If `doku/report.md` is missing, create it immediately.
- This memory/report rule replaces the previous `doku/APP_BEHAVIOR.md` persistence requirement.

**Second: Follow Governance Rules**
- Consult `AGENTS.md` for all governance, workflow, and skill rules.

Use `AGENTS.md` as the single source of truth for all governance, workflow, and skill rules.

## Required Startup Steps

1. Read `AGENTS.md` first.
2. Identify triggered skills from `AGENTS.md` and read each referenced `SKILL.md` before making changes.
3. Follow delegation boundaries exactly (`@testing-manager` for testing, `@release-manager` for release orchestration).

## Scope

This file intentionally stays minimal to prevent duplicated or conflicting instructions.
