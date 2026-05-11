# Configuration

Configure MedAssist with environment variables in `.env`. Start from `.env.example`.

## General

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | User ID for container file permissions |
| `PGID` | `1000` | Group ID for container file permissions |
| `PORT` | `3000` | Backend API port |
| `CORS_ORIGINS` | `http://localhost:4174` | Allowed origins for CORS |
| `TZ` | `Europe/Berlin` | Server default timezone for scheduled reminders |
| `PUBLIC_APP_URL` | — | Public base URL for notification action links |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error`, or `silent` |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per minute per IP |
| `OPENAPI_DOCS_ENABLED` | `auto` | Explicitly enable or disable `/docs` and `/docs/json` |

API docs behavior:

- If `OPENAPI_DOCS_ENABLED` is unset, docs are enabled outside production and disabled in production.
- `OPENAPI_DOCS_ENABLED=true` enables `/docs` and `/docs/json`.
- `OPENAPI_DOCS_ENABLED=false` disables the docs only.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable user authentication |
| `REGISTRATION_ENABLED` | `false` | Allow new user registrations |
| `FORM_LOGIN_ENABLED` | `true` | Enable username/password login |
| `JWT_SECRET` | — | Access token signing key; required when auth is enabled |
| `REFRESH_SECRET` | — | Refresh token signing key; required when auth is enabled |
| `COOKIE_SECRET` | — | Cookie signing key; required when auth is enabled |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token lifetime |

Generate secrets with `openssl rand -hex 32`.

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

## Push Notifications

Push notification setup, provider support, and URL examples are documented in [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

Recommended provider: `ntfy`, especially for intake reminders with direct actions.

## Default User Settings

Default values for newly created users are documented in [DEFAULT_USER_SETTINGS.md](DEFAULT_USER_SETTINGS.md).
