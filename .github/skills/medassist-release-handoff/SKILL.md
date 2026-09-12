---
name: medassist-release-handoff
description: Route broad MedAssist push, PR, merge, tag, or release requests to release-manager; do not use for a specific release phase.
---

# Release Handoff

Use only for an initial broad remote-operation request. Do not use it for release preparation, PR CI monitoring, release-note work, or publishing; release-manager selects the matching phase skill.

## Ownership

- `@release-manager` solely owns remote release operations.
- Normal agents prepare local work and hand shipping to `@release-manager`; they must not push, create or merge PRs, tag, or publish releases.
- Follow `AGENTS.md` for authorization, testing, project traceability, and global policy.

## Compact Handoff

Provide `@release-manager`: authorized actions, intended scope, authoritative remote/base evidence, `@testing-manager` local-gate result, known issue/PR/CI state, and any confirmed or proposed version.
