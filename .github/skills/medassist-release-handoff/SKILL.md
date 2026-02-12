---
name: medassist-release-handoff
description: Enforce MedAssist release ownership by preventing remote git/release actions by normal agents and delegating to release-manager, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when a request includes branch push, PR creation, merge, tagging, release notes publishing, or release orchestration.

## Ownership Rules

- Remote git/release actions are owned by `@release-manager`.
- Normal agent/Copilot must not perform:
  - `git push`
  - PR creation/merge
  - tag/release creation

## Required Behavior

1. Perform local code edits only.
2. Summarize local changes clearly.
3. Provide handoff instruction to `@release-manager` for shipping steps.

## Response Format

When this skill applies, return:

- "Release handoff required"
- Delegate target: `@release-manager`
- Shipping checklist (branch, PR, CI, merge, release)
