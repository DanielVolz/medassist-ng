# MedAssist Copilot Instructions

Committed entry point for Copilot and remote/cloud agent sessions.

If `AGENTS.md` exists in the checkout or is provided in the session context, treat it as the canonical repository governance file. This file is only the portable baseline for sessions that do not have the local overlay.

## Startup

1. Read this file first.
2. Apply `AGENTS.md` when available.
3. Ensure `doku/memory_notes.md` exists, read its current-state/relevant durable notes before meaningful work, and keep it updated with concise continuity notes. It is local-only and must not be staged or committed unless explicitly requested.
4. Identify triggered skills and read only the matching `.github/skills/*/SKILL.md` files before changing code.
5. Keep work scoped to the user's current objective and existing repository patterns.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan.
<!-- SPECKIT END -->

## Baseline Rules

- Use English for code, comments, docs, and commit messages.
- Frontend browser code must call `/api/*`; do not hardcode backend hosts.
- Keep behavior, setup, config, workflow, and operations docs aligned with changes.
- Preserve backward compatibility for existing SQLite files; never remove or rename DB columns.
- Validate and surface errors clearly; do not add silent fallbacks that hide broken releases.
- Keep health checks and structured operational logging intact.
- Keep changes scoped and avoid unrelated cleanup.
- Do not push, tag, merge, create PRs, or publish releases from a normal agent session; hand off release work to `release-manager`.

## Placement

- Backend routes and validation: `backend/src/routes/**`.
- Backend services, schedulers, and domain behavior: `backend/src/services/**`.
- Persistence and migrations: `backend/src/db/**`, `backend/drizzle/**`.
- Frontend pages and UI flows: `frontend/src/pages/**`, `frontend/src/components/**`.
- Frontend orchestration and hooks: `frontend/src/context/**`, `frontend/src/hooks/**`.
- Localization: `frontend/src/i18n/en.json`, `frontend/src/i18n/de.json`.
- E2E tests: `frontend/e2e/**`.
- Unit tests: `backend/src/test/**`, `frontend/src/test/**`.

## Parity

- Medication edit changes must update both desktop and mobile edit flows.
- Notification behavior changes must update both scheduler and manual/planner code paths.

## Specialists

- Use `testing-manager` for test planning, test execution, and CI test triage.
- Use `release-manager` for PR shipping, merge, release, and workflow monitoring.
- Use `project-bot` for issue, PR metadata, and GitHub Project board coordination when no product code change is required.

## Local-Only Artifacts

Do not stage or commit local workspace state unless the user explicitly asks for that exact action:

- `doku/memory_notes.md`
- local planning, agent, or scratch artifacts
