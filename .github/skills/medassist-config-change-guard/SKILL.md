---
name: medassist-config-change-guard
description: Validate MedAssist configuration changes across env vars, Docker compose, proxy settings, runtime defaults, and MCP server connections, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when changes touch `.env`, Docker files, Vite proxy settings, runtime defaults, app startup behavior, or MCP configuration.

## Objective

Prevent configuration drift and broken local/CI environments.

## Required Checks

1. New/changed config has safe defaults.
2. Env changes are backward-compatible where feasible.
3. Docker/dev runtime changes remain consistent across services.
4. Frontend/backend URL/proxy conventions remain valid (`/api/*`).
5. Documentation reflects configuration changes.
6. For MCP changes, perform an actual harmless tool call, not only discovery. Distinguish a running server from tools exposed to the active agent. Verify GitHub with a repository-scoped read and SQLite with `SELECT 1`; never inspect private records merely to test connectivity.

## Files to Prioritize

- `.env.example`
- `.mcp.json` and its launcher scripts
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `frontend/vite.config.ts`
- Relevant package scripts and startup files

## Anti-Patterns

- Hidden required env vars with no defaults.
- Inconsistent host/port/proxy settings across environments.
- Config changes without doc updates.

## Response Format

Report:

- Config files reviewed
- Compatibility impact (none/low/high)
- Required follow-up updates
- Final readiness recommendation
