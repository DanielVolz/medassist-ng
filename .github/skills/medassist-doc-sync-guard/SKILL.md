---
name: medassist-doc-sync-guard
description: Ensure MedAssist documentation stays aligned with behavior changes in APIs, configuration, setup, and operations, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when code changes alter behavior, setup steps, environment variables, user workflows, or operational commands.

## Objective

Keep docs consistent with actual product behavior and avoid stale setup/run guidance.

## Required Checks

1. If API behavior changed, verify relevant docs are updated.
2. If ENV/config changed, update documented variables/defaults.
3. If workflow/commands changed, update setup/run instructions.
4. If user-facing behavior changed, update user-facing description.
5. If agents need a new reusable command, tool, or validation workflow, update
   its owning skill or add a short agent reference. Keep canonical policy in
   `AGENTS.md` and command details in `docs/DEVELOPMENT.md`; do not rely only on
   ignored local memory or duplicate procedures across unrelated agents.

## Candidate Documentation Files

- `README.md`
- `docs/DEVELOPMENT.md`
- `docs/TECH_STACK.md`

## Anti-Patterns

- Shipping behavior changes without docs updates.
- Updating docs with speculative/unverified commands.
- Duplicating conflicting instructions across files.

## Response Format

Return:

- Doc files that should change
- Proposed update summary per file
- Any intentionally skipped docs and reason
