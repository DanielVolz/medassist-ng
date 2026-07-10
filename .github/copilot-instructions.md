# MedAssist Copilot Instructions

Committed entry point for Copilot and remote/cloud agent sessions.

If `AGENTS.md` exists in the checkout or is provided in the session context, treat it as the canonical repository governance file. This file is the complete portable baseline for Copilot/cloud sessions where the local-only overlay is unavailable.

## Startup

1. Read this file first.
2. Apply `AGENTS.md` when available.
3. Ensure root `MEMORY.md` exists, read its current-state/relevant durable notes before meaningful work, and keep it updated with concise durable context: project decisions, conventions, recurring pitfalls, validation state, and open risks. It is local-only and must not be staged or committed unless explicitly requested.
4. Inspect `git status` before editing. Preserve unrelated local changes.
5. Identify triggered skills and read only the matching `.github/skills/*/SKILL.md` files before changing code.
6. Keep work scoped to the user's current objective and existing repository patterns.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan.
<!-- SPECKIT END -->

## Baseline Rules

- Use English for code, comments, docs, and commit messages.
- Frontend browser code must call `/api/*`; do not hardcode backend hosts.
- Shared TypeScript contracts and helpers belong in `shared/`; do not duplicate them across backend and frontend.
- Keep behavior, setup, config, workflow, and operations docs aligned with changes.
- Preserve backward compatibility for existing SQLite files: add defaults in schema, add `runAlterMigrations()` compatibility handling, read new fields null-safe, and never remove or rename DB columns.
- Validate and surface errors clearly; do not add silent fallbacks that hide broken releases.
- Keep health checks and structured operational logging intact.
- Keep changes scoped and avoid unrelated cleanup.
- Do not commit automatically. Keep one logical change per PR and split scope that crosses unrelated domains.
- Remove obsolete code paths when replacing behavior; do not leave dead fallbacks, commented-out implementations, or stale tests.
- For authenticated UI work, inspect the real logged-in screen before editing. Ask for login context if it is unavailable.
- Do not push, tag, merge, create PRs, or publish releases from a normal agent session; hand off release work to `release-manager`.
- Route implementation, testing, CI, and repository operations through `model-router` before work starts. It hands off to `fast-task`, `standard-task`, or `complex-task` based on task risk. Model choice is developer or organization configuration; PR, push, release coordination, and workflow monitoring remain standard-tier work through `release-manager` unless the underlying change has a concrete complex trigger.

## Placement

- Backend routes and validation: `backend/src/routes/**`.
- Backend services, schedulers, and domain behavior: `backend/src/services/**`.
- Persistence and migrations: `backend/src/db/**`, `backend/drizzle/**`.
- Frontend pages and UI flows: `frontend/src/pages/**`, `frontend/src/components/**`.
- Frontend orchestration and hooks: `frontend/src/context/**`, `frontend/src/hooks/**`.
- Shared contracts and helpers: `shared/**`.
- Localization: `frontend/src/i18n/en.json`, `frontend/src/i18n/de.json`.
- E2E tests: `frontend/e2e/**`.
- Unit tests: `backend/src/test/**`, `frontend/src/test/**`.

## Parity

- Medication edit changes must update both desktop and mobile edit flows.
- Notification behavior changes must update both scheduler and manual/planner code paths.
- User-facing text must use `frontend/src/i18n/en.json` and `frontend/src/i18n/de.json`; do not hardcode copy in TS/TSX.

## Specialists

- Use `testing-manager` for test planning, test execution, and CI test triage.
- Use `release-manager` for PR shipping, merge, release, and workflow monitoring.
- Use `project-bot` for issue, PR metadata, and GitHub Project board coordination when no product code change is required.

## Validation

- Start with the smallest relevant test or check; expand only for shared or cross-cutting changes.
- Run `npm run check` after code changes; it validates `shared`, `backend`, and `frontend`.
- Frontend browser behavior needs Playwright when the real browser path matters. Use non-interactive runs with `PLAYWRIGHT_HTML_OPEN=never`.
- Do not modify generated reports, coverage, `data/**`, `.specify/**`, or `specs/**` unless the user explicitly requests that artifact.

## Local-Only Artifacts

Do not stage or commit local workspace state unless the user explicitly asks for that exact action:

- `MEMORY.md`
- local planning, agent, or scratch artifacts
