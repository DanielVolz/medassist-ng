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

## Local UI Sandbox Modes

- Preserve anonymous `dev:ui` behavior when changing the opt-in `dev:ui:oidc`
  launcher. OIDC mode selects only the issuer/client allowlist plus exactly
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
  from the original worktree. Parse selected single-line assignments only,
  never source the file or load the whole dotenv into `process.env`. Do not
  include `SMTP_TOKEN`, recipients, or unrelated secrets.
- Force `PUBLIC_APP_URL=http://localhost:5176/` in OIDC mode; never select,
  parse, or import the original URL. Keep localhost auth/callback/CORS settings,
  isolated `.ui-dev/oidc-data`, and no anonymous fixtures or LAN configuration.
  Anonymous mode's separate SMTP/LAN behavior and production defaults stay unchanged.
- Local login/registration are enabled alongside Pocket ID only by that
  opt-in launcher's explicit overrides. Keep production auth defaults and
  endpoint rate limits unchanged; never create accounts or restart an existing
  user sandbox merely to validate these settings.
- Diagnose missing **Forgot password** against the existing server gate (auth,
  form login, safe public URL, SMTP host/user/from), not by bypassing it. Preserve
  server-side provider checks for recovery requests and reset-token consumption:
  OIDC accounts, including legacy password-backed rows, must remain ineligible.
- Start with the no-port configuration checks documented in
  `docs/DEVELOPMENT.md`; do not start services or run occupied-port integration
  tests when an existing user sandbox must remain untouched. Never print `.env`
  values or change external identity-provider configuration to validate tooling.
  Configuration validation must not send email or alter recipients/accounts;
  leave existing `.invalid` recipients and OIDC users/data untouched. Hand test
  execution to testing-manager using the documented disposable-fixture checks.

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
