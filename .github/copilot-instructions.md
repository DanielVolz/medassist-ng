# MedAssist-ng - AI Coding Instructions

## Purpose

This file is intentionally short.
Use `AGENTS.md` as the canonical governance source and `.github/skills/*/SKILL.md` for detailed workflows.

## Always-On Rules

- English only for project artifacts.
- No remote git/release actions by normal agent (`git push`, PR create/merge, tag/release).
- Testing work belongs to `@testing-manager`.
- PR/release/CI orchestration belongs to `@release-manager`.
- Keep changes local, focused, and consistent with existing UI/API patterns.

## MedAssist Essentials

- Frontend calls backend through `/api/*`.
- All UI text must use i18n keys (`t("...")`) with EN/DE entries.
- DB changes must stay backward-compatible (schema default + alter migration + null-safe reads).

## Skill Routing

- Architecture/boundaries: `medassist-architecture-guard`
- DB compatibility: `medassist-db-compat-check`
- i18n rules: `medassist-i18n-enforcer`
- UI consistency: `medassist-ui-consistency`
- Testing delegation: `medassist-testing-handoff`
- Release delegation: `medassist-release-handoff`

## Key References

- Canonical governance: `AGENTS.md`
- Global engineering rules: see `AGENTS.md` (`Global Engineering Rules` section).
- Project skills: `.github/skills/README.md`
- Specialist agents: `.github/agents/testing-manager.agent.md`, `.github/agents/release-manager.agent.md`
