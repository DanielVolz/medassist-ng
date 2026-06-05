# Security Notes

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

## CORS Expectations

Credentialed browser CORS is allowed only for configured `CORS_ORIGINS`. An unconfigured browser origin does not receive `Access-Control-Allow-Origin`, so the browser cannot grant credentialed cross-origin API access. Requests from unconfigured origins may still reach the backend outside browser CORS enforcement, so server-side authentication and authorization remain mandatory.

Public notification action routes allow arbitrary browser origins without credentials. This is intentional so external notification providers can send token-based actions without receiving browser session cookies.

## CSRF Decision

No additional CSRF token is required for the current browser contract because state-changing session requests rely on `SameSite=Lax`, credentialed CORS allowlists, JSON/fetch-based clients, server-side auth, and current-password checks for sensitive account changes.

Add explicit CSRF-token protection before allowing any of these changes:

- `SameSite=None` cookies or third-party embedding.
- Simple cross-site form submissions for state-changing routes.
- New high-risk cookie-auth mutations that do not require JSON/fetch preflight or a separate confirmation factor.
- Broadening credentialed CORS beyond trusted application origins.
