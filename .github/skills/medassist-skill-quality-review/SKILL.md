---
name: medassist-skill-quality-review
description: Review MedAssist skills for trigger quality, scope boundaries, and conflicts with AGENTS governance, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when creating or modifying any skill under `.github/skills/`.

## Objective

Keep skills discoverable, non-overlapping, and aligned with canonical governance in `AGENTS.md`.

## Required Checks

1. Frontmatter has clear `name` and specific `description` trigger language.
2. Scope boundaries are explicit (`when to use` / `do not use`).
3. No conflicts with `AGENTS.md` ownership rules.
4. No policy duplication that can drift from canonical governance.
5. References to related skills are explicit where workflows chain.

## Quality Signals

- Trigger phrases are concrete and task-shaped.
- Instructions are concise, actionable, and deterministic.
- Response format is clear and useful for downstream handoff.

## Anti-Patterns

- Vague descriptions that match everything.
- Duplicate skills with overlapping responsibilities.
- Contradictory ownership guidance.
- Long policy blocks copied from other files.

## Response Format

Return:

- Scope/trigger issues found
- Overlap/conflict findings
- Suggested minimal edits
- Final pass/fail recommendation
