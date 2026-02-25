# MedAssist Agent Skills

This directory contains project skills for VS Code Copilot.

Each skill lives in its own folder and must include a `SKILL.md` file.

## Global Rule Reminder

When re-implementing a feature or fix path, remove obsolete/unused code immediately.
Do not leave dead code behind.
Also follow the canonical global engineering rules in `AGENTS.md`.
Use one governance source to avoid duplicated or conflicting policy text.

## Skills

- `medassist-karpathy-core` — enforce think-before-coding, simplicity-first changes, surgical diffs, and goal-driven verification.
- `medassist-architecture-guard` — enforce frontend/backend boundary and `/api/*` data-flow conventions.
- `medassist-db-compat-check` — enforce backward-compatible SQLite/Drizzle schema changes.
- `medassist-i18n-enforcer` — enforce translation-key-only UI copy with EN/DE parity.
- `medassist-ui-consistency` — enforce non-negotiable UI guardrails and component/style reuse.
- `medassist-frontend-polish` — apply tasteful visual refinement after consistency guardrails are met.
- `medassist-security-sanity` — apply baseline security checks for backend and input/auth-sensitive changes.
- `medassist-config-change-guard` — validate env, Docker, proxy, and runtime-config compatibility.
- `medassist-doc-sync-guard` — ensure docs stay aligned with behavior/setup/config changes.
- `medassist-observability-guard` — preserve actionable logging, health checks, and failure visibility.
- `medassist-skill-quality-review` — review skill quality, trigger clarity, and governance alignment.
- `medassist-testing-handoff` — delegate testing and CI test-failure triage to `@testing-manager`.
- `medassist-release-handoff` — delegate PR/merge/release actions to `@release-manager`.
