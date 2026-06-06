# Configuration

Configure MedAssist with environment variables in `.env`. Start from `.env.example`.

## General

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | User ID for container file permissions |
| `PGID` | `1000` | Group ID for container file permissions |
| `PORT` | `3000` | Backend API port |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4174` | Allowed origins for CORS. The backend schema default covers local Vite development and the Docker Compose quickstart; `.env.example` sets only the Docker quickstart origin. |
| `TZ` | `Europe/Berlin` | Server default timezone for scheduled reminders |
| `PUBLIC_APP_URL` | — | Public base URL for notification action and share links. Strongly recommended for any deployment used from another device; do not point this to `localhost` or an internal Docker hostname. Local Vite development also allows this hostname automatically. |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error`, or `silent` |
| `SENSITIVE_LOGGING_ENABLED` | `false` | Allows sensitive dose/person details only in debug logging paths. Leave disabled outside local troubleshooting. |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per minute per IP |
| `OPENAPI_DOCS_ENABLED` | `auto` | Explicitly enable or disable `/docs` and `/docs/json` |
| `DOCS_AUTH_REQUIRED` | `auto` | Require authentication for enabled docs; defaults to `true` when `AUTH_ENABLED=true` |

API docs behavior:

- If `OPENAPI_DOCS_ENABLED` is unset, docs are enabled outside production and disabled in production.
- `OPENAPI_DOCS_ENABLED=true` enables `/docs` and `/docs/json`.
- `OPENAPI_DOCS_ENABLED=false` disables the docs only.
- If `DOCS_AUTH_REQUIRED` is unset, authenticated deployments require login/API authentication for `/docs` and `/docs/json`.
- Keep production docs disabled unless you specifically need them. If docs are enabled in public staging or production, protect them with authentication or a network boundary.

`CORS_ORIGINS` note:

- The `.env.example` file is optimized for the Docker Compose quickstart, where the frontend runs on `http://localhost:4174`.
- Local frontend development uses the Vite dev server instead, so the backend schema defaults cover `http://localhost:5173` and `http://localhost:4174`.
- If you use a custom hostname or reverse proxy, include that origin in `CORS_ORIGINS`.

## Authentication

Browser cookie, CORS, CSRF, Bearer token, and API-key security behavior is documented in [SECURITY.md](SECURITY.md).

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable user authentication. Required for public production deployments. |
| `ALLOW_UNAUTHENTICATED` | `false` | Explicit local/private-only escape hatch that allows production startup with `AUTH_ENABLED=false` |
| `REGISTRATION_ENABLED` | `false` | Allow new user registrations |
| `FORM_LOGIN_ENABLED` | `true` | Enable username/password login |
| `JWT_SECRET` | — | Access token signing key; required when auth is enabled |
| `REFRESH_SECRET` | — | Refresh token signing key; required when auth is enabled |
| `COOKIE_SECRET` | — | Cookie signing key; required when auth is enabled |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token lifetime |
| `API_KEY_PEPPER` | — | Optional dedicated pepper for API key hashes. Strongly recommended for production; if omitted, production requires a strong `JWT_SECRET` or `REFRESH_SECRET` for API key hashing. Generate with `openssl rand -hex 32`. |
| `API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES` | `15` | Minimum interval between API key `lastUsedAt` database writes per key |
| `SHARE_TOKEN_TTL_DAYS` | `90` | Default lifetime for newly generated public share links |

Generate secrets with `openssl rand -hex 32`.

Production startup fails fast when `NODE_ENV=production`, `AUTH_ENABLED=false`, and `ALLOW_UNAUTHENTICATED` is not `true`. This protects health-related personal data from accidental unauthenticated public deployments.

For public deployments, enable `AUTH_ENABLED=true` and configure local form login or OIDC SSO. If you run a private local-only instance without authentication, set `ALLOW_UNAUTHENTICATED=true` deliberately and keep the app off untrusted networks.

When a local user's password is changed, all existing refresh tokens for that user are revoked. The current browser session receives a newly issued access/refresh token pair, while other sessions must sign in again.

## Backend Exposure

The default Docker Compose stack exposes only the frontend. The backend listens on the internal Docker network and is reached through the frontend `/api` proxy.

Do not publish the backend directly to the Internet. For local debugging only, create a local `docker-compose.override.yml` with a loopback-only binding:

```yaml
services:
  backend:
    ports:
      - "127.0.0.1:4000:3000"
```

## Medication Schedule Compatibility

Medication rows still retain legacy schedule columns (`usage_json`, `every_json`, `start_json`) next to the unified `intakes_json` column so existing SQLite files and imports keep working without a migration.

Backend code should consume medication schedules through the canonical normalization helpers in `backend/src/utils/scheduler-utils.ts` (`normalizeMedicationSchedule()` or `normalizeMedicationIntakes()`). Direct legacy parsing should stay inside that utility boundary until a reviewed migration policy can remove the old columns safely.

## Docker Image Pinning

The default `docker-compose.yml` uses readable versioned image tags. Each GitHub release also attaches `docker-compose.pinned.yml` with the same release tags plus immutable image digests for deployments that need stricter reproducibility.

Release images also publish OCI SBOM/provenance attestations through the Docker build workflow. Use the pinned compose file when you want immutable deployment references, and use the published attestations when you need supply-chain metadata for the exact shipped image.

## API Keys

When `AUTH_ENABLED=true`, authenticated users can create API keys and call protected endpoints with:

```text
Authorization: Bearer ma_...
```

Available scopes:

- `read`: read-only access (`GET`, `HEAD`, `OPTIONS`)
- `write`: read and write access

Notes:

- The token is shown only once after creation.
- Creating a new key deactivates previously active keys for the same user.
- API keys are stored hashed in the database.

API reference:

- Interactive docs: `/docs`
- OpenAPI JSON: `/docs/json`
- Key management endpoints:
  - `GET /auth/api-keys`
  - `POST /auth/api-keys`
  - `DELETE /auth/api-keys/:id`

## OIDC / SSO

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ENABLED` | `false` | Enable OIDC authentication |
| `OIDC_ISSUER_URL` | — | OIDC provider URL |
| `OIDC_CLIENT_ID` | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | OIDC client secret |
| `OIDC_REDIRECT_URI` | — | OIDC callback URL |
| `OIDC_SCOPES` | `openid profile email` | Requested scopes |
| `OIDC_USERNAME_CLAIM` | `preferred_username` | Username claim |
| `OIDC_AUTO_CREATE_USERS` | `true` | Auto-create users on first SSO login |
| `OIDC_PROVIDER_NAME` | `SSO` | Login button label |

## Email (SMTP)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_TOKEN` | — | OAuth2 or app token; takes precedence over `SMTP_PASS` |
| `SMTP_FROM` | — | Sender email address |
| `SMTP_SECURE` | `false` | Use TLS |

## Reminders

| Variable | Default | Description |
|----------|---------|-------------|
| `REMINDER_DAYS_BEFORE` | `7` | Days before stock runs out to send reminder |
| `REMINDER_HOUR` | `6` | Hour to send daily reminders (24h format) |
| `REMINDER_MINUTES_BEFORE` | `15` | Minutes before intake to send reminder |
| `EXPIRY_WARNING_DAYS` | `30` | Days before expiry warning |

Reminder timing uses IANA timezones. `TZ` is the server default. Users can override it in Settings.

These values are runtime defaults. User-specific settings can override reminder behavior after first save.

## Push Notifications

Push notification setup, provider support, and URL examples are documented in [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

Recommended provider: `ntfy`, especially for intake reminders with direct actions.

Notification action and share links should use `PUBLIC_APP_URL` as their reachable base URL. For self-hosted setups, this should normally be your externally reachable HTTPS address, for example `https://med.example.com`.

If `PUBLIC_APP_URL` is missing in a remote deployment, reminder links can still be generated from local origins that are unreachable from phones or external browsers.

## Default User Settings

Default values for newly created users are documented in [DEFAULT_USER_SETTINGS.md](DEFAULT_USER_SETTINGS.md).
