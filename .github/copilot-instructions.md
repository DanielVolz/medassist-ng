# MedAssist-ng - AI Coding Instructions

## Purpose

Use `AGENTS.md` as the canonical governance source. Read the referenced skill files before starting any task.

## Project Orientation (Read First)

- **Product**: MedAssist-ng is a medication planner with stock tracking, reminders (email/push), refill history, and schedule sharing.
- **Tech stack**: React + TypeScript + Vite (`frontend/`), Fastify + TypeScript + Drizzle + SQLite (`backend/`).
- **Request path**: Frontend uses `/api/*` only; backend route handlers live in `backend/src/routes/`.
- **Primary backend modules**:
	- Auth/SSO: `backend/src/routes/auth.ts`, `backend/src/routes/oidc.ts`, `backend/src/plugins/auth.ts`
	- Medications/data: `backend/src/routes/medications.ts`, `backend/src/db/schema.ts`
	- Reminders: `backend/src/services/reminder-scheduler.ts`, `backend/src/routes/planner.ts`, `backend/src/routes/settings.ts`
- **Primary frontend modules**:
	- Pages: `frontend/src/pages/`
	- Shared app state: `frontend/src/context/AppContext.tsx`
	- Domain hooks: `frontend/src/hooks/`
	- Translations: `frontend/src/i18n/en.json`, `frontend/src/i18n/de.json`

Use this orientation for quick navigation before applying the rules below.

## Always-On Rules

- English only for project artifacts.
- **NEVER run remote git commands** — no `git push`, no `gh pr create/merge`, no `gh release`, no `git tag`. Prepare locally, then hand off to `@release-manager`.
- Testing work belongs to `@testing-manager`.
- PR/release/CI orchestration belongs to `@release-manager`.
- Keep changes local, focused, and consistent with existing UI/API patterns.
- Remove obsolete code when re-implementing — never leave dead code behind.
- **Document behavioral discoveries**: When you discover or clarify how a feature works (e.g., what triggers notifications, how thresholds interact, which code paths exist), **always** add or update the relevant section in `doku/APP_BEHAVIOR.md`. This is mandatory — do not rely on conversation context alone.

## MedAssist Essentials

- Frontend calls backend through `/api/*`.
- DB changes must stay backward-compatible (schema default + alter migration + null-safe reads).

---

## Skills (MANDATORY — read before every task)

Before starting any task, identify which skills apply and **read their full SKILL.md file** for detailed rules.

| Skill | Trigger | File |
|---|---|---|
| **Architecture Guard** | API endpoints, frontend API calls, routing, code placement | `.github/skills/medassist-architecture-guard/SKILL.md` |
| **DB Compatibility** | Persisted data, schema changes, migrations | `.github/skills/medassist-db-compat-check/SKILL.md` |
| **i18n Enforcer** ⚠️ | Any user-facing text in frontend or backend | `.github/skills/medassist-i18n-enforcer/SKILL.md` |
| **UI Consistency** | UI flows, modals, buttons, forms, settings | `.github/skills/medassist-ui-consistency/SKILL.md` |
| **Frontend Polish** | Visual quality improvements | `.github/skills/medassist-frontend-polish/SKILL.md` |
| **Security Sanity** | Backend routes, auth, file handling, external input | `.github/skills/medassist-security-sanity/SKILL.md` |
| **Observability Guard** | Services, schedulers, startup, failure handling | `.github/skills/medassist-observability-guard/SKILL.md` |
| **Config Change Guard** | `.env`, Docker, Vite proxy, runtime defaults | `.github/skills/medassist-config-change-guard/SKILL.md` |
| **Doc Sync Guard** | Behavior changes, setup, env vars, workflows | `.github/skills/medassist-doc-sync-guard/SKILL.md` |
| **Testing Handoff** | Writing/running tests, CI test failures | `.github/skills/medassist-testing-handoff/SKILL.md` |
| **Release Handoff** | Branch push, PR, merge, tagging, release | `.github/skills/medassist-release-handoff/SKILL.md` |
| **Skill Quality Review** | Creating/modifying skills | `.github/skills/medassist-skill-quality-review/SKILL.md` |

### Non-negotiable parity rules (always apply)

1. **Desktop + Mobile Parity**: Medication edit has two paths — `MedicationsPage.tsx` (desktop) and `MobileEditModal` (mobile). **Always update BOTH**.
2. **Notification Dual Code Paths**: Notifications have two code paths — `backend/src/services/reminder-scheduler.ts` (scheduler) and `backend/src/routes/planner.ts` (manual). **Always update BOTH**.

---

## Delegation

- **Testing handoff → `@testing-manager`**: test planning, writing, execution, CI test triage.
- **Release handoff → `@release-manager`**: PR/release orchestration, merge flow, workflow monitoring.

## Key References

- Canonical governance: `AGENTS.md`
- Skill files: `.github/skills/*/SKILL.md`
- Specialist agents: `.github/agents/testing-manager.agent.md`, `.github/agents/release-manager.agent.md`
