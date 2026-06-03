# MedAssist Committed Governance

This file is the committed governance source for Copilot and remote/cloud agent sessions.

If a local-only `AGENTS.md` exists in a workspace checkout, treat it as a local overlay for that checkout. Durable repository rules belong here so they remain available upstream.

## Product and stack

- MedAssist-ng is a medication planning app with stock tracking, reminders, refill history, sharing, and optional auth/SSO.
- Frontend: React + TypeScript + Vite in `frontend/`
- Backend: Fastify + TypeScript + Drizzle + SQLite in `backend/`
- Shared package: `shared/`

## Repo-critical rules

- English only for code, comments, docs, and commit messages.
- Frontend browser code must call `/api/*`; do not hardcode backend hostnames in UI code.
- Docs must be updated when behavior, setup, workflow, or operational commands change.
- Keep changes scoped and surgical. Do not fix unrelated issues while touching CI or release files.
- Never push, tag, merge, or create a release from an agent session unless the repository's explicit release workflow says so.

## Placement and parity rules

- Backend HTTP routes and validation live in `backend/src/routes/**`.
- Backend business logic and schedulers live in `backend/src/services/**`.
- Persistence/schema compatibility lives in `backend/src/db/**` and `backend/drizzle/**`.
- Frontend page/UI flow changes belong in `frontend/src/pages/**` and `frontend/src/components/**`.
- Frontend orchestration belongs in `frontend/src/context/**` and `frontend/src/hooks/**`.
- Localization strings belong in `frontend/src/i18n/en.json` and `frontend/src/i18n/de.json`.

Always preserve these parity rules:

1. Medication edit changes must update both desktop and mobile edit flows.
2. Notification behavior changes must update both scheduler and manual/planner code paths.

## Safety rules

- Preserve backward compatibility for existing SQLite data files.
- Never remove or rename existing database columns.
- Validate and surface configuration errors clearly; do not add silent fallbacks that hide broken releases.
- Keep health checks and structured operational logging intact.

## CI and release expectations

- PR validation lives in `.github/workflows/test.yml` and `.github/workflows/e2e.yml`.
- Docker release publishing lives in `.github/workflows/docker-build.yml`.
- Project automation lives in `.github/workflows/add-to-project.yml` and related project workflows.
- CI changes must keep docs and operational guidance in sync.

## Local-only artifacts

The following are local workspace state and must not be committed unless a user explicitly asks for that exact action:

- `doku/memory_notes.md`
- `doku/report.md`
- local planning / agent scratch artifacts

