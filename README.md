<p align="center">
  <img src="frontend/public/web-app-manifest-512x512.png" alt="MedAssist-ng Logo" width="120" />
</p>

<h1 align="center">MedAssist-ng</h1>

<p align="center">
  <strong>Never run out of your medications again.</strong><br>
  A medication tracking and planning app with stock monitoring, intake schedules, and reminder notifications.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/SQLite-Database-003B57?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Backend_Tests-639%2F639-brightgreen?logo=vitest" alt="Backend Tests 454/454" />
  <img src="https://img.shields.io/badge/Frontend_Tests-882%2F882-brightgreen?logo=vitest" alt="Frontend Tests 611/611" />
</p>

### 🤖 AI-Generated Code

> This app was 100% coded with [Claude Opus 4.6](https://www.anthropic.com/claude) and [GPT-5.3 Codex](https://openai.com/index/gpt-5/). Use at your own risk.

### ⚠️ Disclaimer

> **Your health is your responsibility.** This app may contain bugs. Follow your doctor's instructions closely, keep track of your medication supply, and plan ahead for reordering.
>
> **Think of this app as a helpful tool, but make all health decisions independently!**

- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Development](#development)

# Features

<p align="center">
  <img src="docs/gifs/MedAssist-demo.gif" alt="MedAssist-ng Dashboard" width="100%" />
</p>

<a id="screenshots"></a>
<details>
<summary><strong>Screenshots</strong></summary>
<blockquote>

<details>
<summary>Dashboard</summary>

Overview with stock status, reorder reminders, and upcoming schedules.

<img src="docs/screenshots/dashboard-desktop.png" alt="Dashboard" width="100%" />

</details>

<details>
<summary>Medication Detail</summary>

View medication details, stock information, and intake schedule.

<img src="docs/screenshots/medication-detail-modal.png" alt="Medication Detail Modal" width="100%" />

</details>

<details>
<summary>Medications & Edit Form</summary>

Manage your medications with the edit form and refill feature.

<img src="docs/screenshots/medications-edit-desktop.png" alt="Medications Edit Form" width="100%" />

</details>

<details>
<summary>Demand Calculator (Planner)</summary>

Calculate how many pills you need for a specific date range.

<img src="docs/screenshots/planner-desktop.png" alt="Planner - Demand Calculator" width="100%" />

</details>

<details>
<summary>Shared Schedule</summary>

Share your medication schedule with others via a public link.

<img src="docs/screenshots/share-schedule-desktop.png" alt="Shared Schedule" width="100%" />

</details>

<details>
<summary>Mobile Views</summary>

<table>
  <tr>
    <td align="center" width="33%">
      <strong>Dashboard</strong><br>
      <img src="docs/screenshots/dashboard-mobile.png" alt="Mobile Dashboard" width="100%" />
    </td>
    <td align="center" width="33%">
      <strong>Medications</strong><br>
      <img src="docs/screenshots/medications-mobile.png" alt="Mobile Medications" width="100%" />
    </td>
    <td align="center" width="33%">
      <strong>Schedule</strong><br>
      <img src="docs/screenshots/schedule-mobile.png" alt="Mobile Schedule" width="100%" />
    </td>
  </tr>
</table>

</details>

</blockquote>
</details>

### Medication Setup
- Optional multi-source lookup inside the medication editor on desktop and mobile, prioritizing `RxNorm` and `openFDA` before `EMA`, including package-size suggestions when the source exposes them
- Explicit review-and-apply flow with low-risk suggestions only
- Additional lookup results can be revealed on demand instead of being hard-cut at the initial small result set
- Honest incomplete-coverage messaging with source labels; manual entry always remains available

### Smart Inventory
- Track exact stock with package profiles (blister, bottle, tube, liquid container)
- Display remaining days of supply
- Automatic calculation based on intake schedule
- Manual stock correction supports profile-specific stock semantics (sealed units + loose stock for blister, amount-based stock for bottle/tube/liquid)

### Medication Refill
- One-click refill with pack or loose pill options
- Complete refill history per medication
- Automatic stock updates after each refill

### Flexible Schedules
- Daily, weekly, or custom intervals per medication
- Independent schedules for each medication
- Optional timeline filters for dashboard and shared schedule views

### Stock Alerts & Reminders
- Notifications before stock runs out
- Configurable warning thresholds
- Intake reminders via push notifications

### Trip Planner
- Calculate medication demand for a trip or date range with package-aware units
- Plan ahead for vacations, business trips, or hospital stays
- Send demand reports via email or push notification

### Reports
- Generate medication reports as PDF, Markdown, or plain text
- Include intake history, refill history, and prescription details

### Multi-Person Support
- Manage medications for multiple people
- Share schedules via link. Recipients can mark doses as taken, you see it live
- Optionally embed the medication overview directly on shared links via a settings toggle

### Data Export & Import
- Export all your data (medications, dose history, settings) as JSON
- Import previously exported data with automatic ID remapping
- Choose whether to include sensitive data in exports

### Notifications
- Email via SMTP
- Push notifications via ntfy, Pushover, Gotify, Telegram, Discord & more ([Shoutrrr](https://containrrr.dev/shoutrrr/))
- Supports both stock warnings and intake reminders

### Privacy & Security
- Fully self-hosted
- SSO via OIDC (Authelia, Authentik, Pocket ID, Keycloak)
- Non-root containers
- Dark mode included 😎

# Getting Started

The easiest way to deploy MedAssist-ng is with Docker Compose:

```bash
git clone https://github.com/DanielVolz/medassist-ng.git
cd medassist-ng
cp .env.example .env
docker compose -p medassist-ng up -d
```

Open `http://localhost:4174` and start tracking your medications.

# Configuration

All configuration is done via environment variables in `.env`. Copy `.env.example` to get started.

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | User ID for container file permissions |
| `PGID` | `1000` | Group ID for container file permissions |
| `PORT` | `3000` | Backend API port |
| `CORS_ORIGINS` | `http://localhost:4174` | Allowed origins for CORS |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`, `silent`). At `info` (default), high-frequency polling endpoints are suppressed. Set `debug` to see all requests. |
| `OPENAPI_DOCS_ENABLED` | `auto` | Enables API docs in non-production by default. Set explicitly to `true`/`false` to override. |
| `TZ` | `Europe/Berlin` | Timezone for scheduled reminders |

Recommended values for API docs by environment:

| Environment | Recommendation |
|-------------|----------------|
| Development | `OPENAPI_DOCS_ENABLED=true` |
| Staging/Test | `OPENAPI_DOCS_ENABLED=true` |
| Production | leave it unset, or set `OPENAPI_DOCS_ENABLED=false` |

Notes:

- If `OPENAPI_DOCS_ENABLED` is not set, docs are enabled outside production and disabled in production.
- If `OPENAPI_DOCS_ENABLED=true`, docs are available on `/docs` and `/docs/json`.
- If `OPENAPI_DOCS_ENABLED=false`, only the docs are disabled. The API still works normally.

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable user authentication |
| `REGISTRATION_ENABLED` | `false` | Allow new user registrations |
| `JWT_SECRET` | — | Access token signing key (required if auth enabled) |
| `REFRESH_SECRET` | — | Refresh token signing key (required if auth enabled) |
| `COOKIE_SECRET` | — | Cookie signing key (required if auth enabled) |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token lifetime |

Generate secrets with: `openssl rand -hex 32`

### API Keys (Programmatic API Access)

When `AUTH_ENABLED=true`, you can create personal API keys and call protected endpoints with:

```bash
Authorization: Bearer ma_...
```

Available scopes:

- `read`: read-only access (`GET`, `HEAD`, `OPTIONS`)
- `write`: read + write access

Essential notes:

- Create keys in the app when authentication is enabled.
- The token is shown only once after creation.
- Creating a new key automatically deactivates previously active keys for the same user.
- API keys are stored hashed in the database.

Example usage:

```bash
curl http://localhost:3000/settings \
  -H "Authorization: Bearer ma_..."
```

API reference:

- Interactive docs: `/docs`
- OpenAPI JSON: `/docs/json`
- With the bundled frontend ingress, these paths work on the normal app URL as well, for example `http://localhost:4174/docs` when docs are enabled.
- Key management endpoints for authenticated users:
  - `GET /auth/api-keys`
  - `POST /auth/api-keys`
  - `DELETE /auth/api-keys/:id`

### OIDC / SSO

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ENABLED` | `false` | Enable OIDC authentication |
| `OIDC_ISSUER_URL` | — | OIDC provider URL |
| `OIDC_CLIENT_ID` | — | Client ID from OIDC provider |
| `OIDC_CLIENT_SECRET` | — | Client secret from OIDC provider |
| `OIDC_REDIRECT_URI` | — | Full callback URL (e.g., `https://your-domain.com/api/auth/oidc/callback`) |
| `OIDC_SCOPES` | `openid profile email` | Scopes to request |
| `OIDC_USERNAME_CLAIM` | `preferred_username` | Claim for username |
| `OIDC_AUTO_CREATE_USERS` | `true` | Auto-create users on first SSO login |
| `OIDC_PROVIDER_NAME` | `SSO` | Name shown on login button |

### Email (SMTP)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_TOKEN` | — | OAuth2/App token (takes precedence over password) |
| `SMTP_FROM` | — | Sender email address |
| `SMTP_SECURE` | `false` | Use TLS |

### Reminders

| Variable | Default | Description |
|----------|---------|-------------|
| `REMINDER_DAYS_BEFORE` | `7` | Days before stock runs out to send reminder |
| `REMINDER_HOUR` | `6` | Hour to send daily reminders (24h format) |
| `REMINDER_MINUTES_BEFORE` | `15` | Minutes before intake to send reminder |
| `EXPIRY_WARNING_DAYS` | `30` | Days before expiry to show warning |

### Push Notifications (Shoutrrr)

MedAssist uses [Shoutrrr](https://containrrr.dev/shoutrrr/) for push notifications, supporting many services with a single URL format.

**Implemented URL schemes in MedAssist:** `ntfy://`, `discord://`, `pushover://`, `gotify://`, `telegram://`, plus direct `https://` webhooks.

This covers common providers like ntfy, Discord, Pushover, Gotify, Telegram, Slack webhooks, and many others via webhook URLs.

Configure push notifications in Settings → Push, or set defaults via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_SHOUTRRR_ENABLED` | `false` | Enable push notifications by default |
| `DEFAULT_SHOUTRRR_URL` | — | Shoutrrr URL (see examples below) |
| `DEFAULT_SHOUTRRR_STOCK_REMINDERS` | `true` | Send stock warnings via push |
| `DEFAULT_SHOUTRRR_INTAKE_REMINDERS` | `true` | Send intake reminders via push |

### Default User Settings

These defaults are applied when a new user is created. Once a user saves settings in the app, their values take precedence.

Complete list and details:

- [docs/DEFAULT_USER_SETTINGS.md](docs/DEFAULT_USER_SETTINGS.md)

#### URL Examples

**ntfy** (free, self-hostable):
```
ntfy://ntfy.sh/your-topic
ntfy://user:password@your-server.com/topic
```

**Pushover** (free app for iOS/Android):
```
pushover://shoutrrr:API_TOKEN@USER_KEY/
```
Get your keys at [pushover.net](https://pushover.net/):
- **User Key**: Shown on your dashboard (top right)
- **API Token**: Create an application → copy the API Token

**Gotify** (self-hosted):
```
gotify://your-server.com/TOKEN
gotify://your-server.com:443/path/to/gotify/TOKEN?priority=1
```

**Discord**:
```
discord://TOKEN@WEBHOOK_ID
```

**Telegram**:
```
telegram://TOKEN@telegram?chats=CHAT_ID
telegram://TOKEN@telegram?chats=@your_channel,-1001234567890
```

For all services and options, see the [Shoutrrr documentation](https://containrrr.dev/shoutrrr/v0.8/services/overview/).

# Development

```bash
docker compose -p medassist-dev -f docker-compose.dev.yml up
```

- Frontend: `http://localhost:5173` (hot reload)
- Backend: `http://localhost:3000`
- API docs UI: `http://localhost:3000/docs` (when docs are enabled)
- OpenAPI JSON: `http://localhost:3000/docs/json` (when docs are enabled)

Useful local commands:

```bash
npm run lint
cd backend && npm run test:run
cd frontend && npm run test:run
```

# Acknowledgements

This project was inspired by [MedAssist](https://github.com/njic/medassist) by njic.
