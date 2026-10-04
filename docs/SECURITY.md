# Security Notes

## Backup Import Contract

Preview and commit both validate backups before replacement. Supported formats remain `1` and
`1.0`–`1.9`; pre-1.9 backups may omit `asNeededIntakes`. Unknown fields are rejected at every
import-object boundary, including account IDs, tokens and filesystem paths. The legacy
`settings.shareStockStatus` field is accepted but not restored. Empty optional medication dates
and legacy language aliases remain supported.

Both endpoints enforce a 50 MiB JSON-body limit (HTTP 413). The browser rejects files above
50 MiB before reading them and uses the existing feedback UI for size/validation errors.
Embedded images must be canonical base64 data URLs for supported raster formats, at most
10 MiB decoded and 40 million pixels. Preview decodes images without writing files.

Commit revalidates independently and replaces the account graph in the production SQLite
write transaction. Import image sets use random names and exclusive creation; any failed
write cleans only files it created. Transaction failure removes newly created image sets,
while previous images are deleted only after commit. This covers handled validation, I/O
and database failures, not process crashes or power loss; cross-resource crash recovery is
not implemented.

## Browser Session And CSRF Contract

MedAssist uses HTTP-only cookies for browser sessions and also accepts `Authorization: Bearer ...` for JWT and API-key clients on authenticated API routes.

Session cookies are configured as:

- `httpOnly=true`, so browser JavaScript cannot read token values.
- `sameSite=lax`, so cross-site subresource and form-style POST requests do not include session cookies in modern browsers.
- `secure=true` in production and `secure=false` only for local development/test.

Authenticated state-changing routes are protected server-side by `requireAuth`. When authentication is enabled, these routes accept either a same-site session cookie, a valid Bearer JWT, or a write-scoped API key unless the route adds a stricter local check. Read-scoped API keys are rejected for mutation methods.

Cookie-auth state-changing route groups:

- Auth/session: `POST /auth/logout`, `PUT /auth/me`, `POST /auth/avatar`, `DELETE /auth/avatar`, `DELETE /auth/me`
- API keys: `POST /auth/api-keys`, `DELETE /auth/api-keys/:id`
- Medication data: medication create/update/delete, stock/refill/package actions, dose tracking, intake journal, refill history
- Settings and reminder tests: `PUT /settings`, `PUT /settings/language`, test email/push endpoints, planner send/reminder endpoints
- Export/import/report/share management: export request/import, report generation, share create/revoke/regenerate
- Medication enrichment: authenticated enrichment requests

Public token routes are not cookie-auth endpoints. Share links, share dose actions, and notification action tokens are authorized by their own opaque token values and must stay scoped to the token target.

## Password-Change Session Rotation

`PUT /auth/me` requires the current local password for a password change. Password hashing and replacement-token
signing happen before the write transaction. The user update (including any accompanying email change),
revocation of all existing refresh tokens, and insertion of the replacement refresh session commit in one
SQLite write transaction. Replacement cookies are sent only after commit.

If a write fails, the prior password and refresh sessions remain intact and no replacement cookies are sent.
On success, old refresh tokens are rejected and the initiating browser receives a usable replacement session.
Profile-only changes do not rotate or revoke sessions. Existing credential-version checks for access tokens
are unchanged.

## Public Auth State

`GET /auth/state` is intentionally public because the browser must know which login/setup UI to render before a user can authenticate. The response is limited to UX routing fields:

- whether authentication is enabled
- whether registration, form login, and OIDC login are available
- the configured OIDC provider display name
- whether first-user setup should be shown

The endpoint does not expose user records, usernames, provider issuer URLs, client IDs, secrets, token settings, or the raw user count. It is rate-limited and sends `Cache-Control: no-store` so browser setup state does not become stale after first-user registration.

## CORS Expectations

Credentialed browser CORS is allowed only for configured `CORS_ORIGINS`. An unconfigured browser origin does not receive `Access-Control-Allow-Origin`, so the browser cannot grant credentialed cross-origin API access. Requests from unconfigured origins may still reach the backend outside browser CORS enforcement, so server-side authentication and authorization remain mandatory.

Public notification action routes allow arbitrary browser origins without credentials. This is intentional so external notification providers can send token-based actions without receiving browser session cookies.

## OpenAPI Docs Exposure

`/docs` and `/docs/json` are enabled by default only outside production. Production deployments should leave `OPENAPI_DOCS_ENABLED` unset or set it to `false` unless interactive API docs are intentionally needed.

When docs are enabled while `AUTH_ENABLED=true`, `DOCS_AUTH_REQUIRED` defaults to `true`. If a deployment explicitly sets `DOCS_AUTH_REQUIRED=false`, only the documentation routes become public; protected API routes still require their normal cookie, Bearer JWT, or API-key authentication.

## CSRF Decision

No additional CSRF token is required for the current browser contract because state-changing session requests rely on `SameSite=Lax`, credentialed CORS allowlists, JSON/fetch-based clients, server-side auth, and current-password checks for sensitive account changes.

Add explicit CSRF-token protection before allowing any of these changes:

- `SameSite=None` cookies or third-party embedding.
- Simple cross-site form submissions for state-changing routes.
- New high-risk cookie-auth mutations that do not require JSON/fetch preflight or a separate confirmation factor.
- Broadening credentialed CORS beyond trusted application origins.
