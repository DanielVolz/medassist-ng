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
  <img src="https://img.shields.io/badge/Backend_Tests-798%2F798-brightgreen?logo=vitest" alt="Backend Tests 454/454" />
  <img src="https://img.shields.io/badge/Frontend_Tests-962%2F962-brightgreen?logo=vitest" alt="Frontend Tests 611/611" />
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
- Optional medication lookup in the editor on desktop and mobile
- Supports `RxNorm`, `openFDA`, and `EMA` with source labels
- Review-and-apply flow with package-size suggestions when available
- Manual entry remains available

### Smart Inventory
- Track exact stock with package profiles (blister, bottle, tube, liquid container, inhaler, injection)
- Display remaining days of supply
- Automatic calculation based on intake schedule
- Manual stock corrections

### Medication Refill
- One-click refill
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
- Send demand reports via email or push notification

### Reports
- Generate medication reports as PDF, Markdown, or plain text
- Include intake history, refill history, and prescription details

### Multi-Person Support
- Manage medications for multiple people
- Share schedules via link. Recipients can mark doses as taken, you see it live
- Optionally allow shared links to view and edit intake journal notes for their visible schedule window
- Optionally embed the medication overview directly on shared links via a settings toggle

### Data Export & Import
- Export all your data (medications, dose history, intake journal notes, settings) as JSON
- Review validated import contents before replacing current data
- Optionally download a fresh backup before confirming import
- Import previously exported data with automatic ID remapping
- Choose whether to include sensitive data in exports

### Notifications
- Email via SMTP
- Push notifications via ntfy, Pushover, Gotify, Telegram, Discord & more ([Shoutrrr](https://containrrr.dev/shoutrrr/))
- Supports stock warnings and intake reminders

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

Before running `docker compose`, choose an authentication mode in `.env`.

For non-local deployments, enable authentication:

```bash
AUTH_ENABLED=true
JWT_SECRET=<output-of-openssl-rand-hex-32>
REFRESH_SECRET=<output-of-openssl-rand-hex-32>
COOKIE_SECRET=<output-of-openssl-rand-hex-32>
```

For a local/private-only trial that is not reachable from other networks, explicitly set:

```bash
ALLOW_UNAUTHENTICATED=true
```

Production startup refuses `AUTH_ENABLED=false` unless that local-only override is present.

Open `http://localhost:4174` and start tracking your medications.

### Verify Deployment

After the containers start, confirm the stack is actually healthy:

1. Run `docker compose ps` and confirm the `backend` service is `healthy` and the `frontend` service is running.
2. Open `http://localhost:4174/api/health` and confirm the backend responds through the frontend proxy with JSON that includes `"status":"ok"`.
3. Open `http://localhost:4174` and confirm the app loads.

If you use MedAssist from another device or domain, set `PUBLIC_APP_URL` to the address people actually use to open the app.

### Deployment Security

Public deployments must enable authentication. The default Docker Compose setup exposes only the frontend; keep the backend private and put public installations behind HTTPS.

More deployment and security options are documented in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

# Configuration

Configure the application with environment variables in `.env`. Keep the basic container settings in the README and use the dedicated docs for the full reference.

### Initial Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | User ID for container file permissions |
| `PGID` | `1000` | Group ID for container file permissions |
| `PORT` | `3000` | Backend API port |
| `CORS_ORIGINS` | `http://localhost:4174` in `.env.example` | Allowed frontend origins; backend defaults also include `http://localhost:5173` for local Vite development |
| `TZ` | `Europe/Berlin` | Default timezone for reminders |
| `AUTH_ENABLED` | `false` | Enable authentication; required for public production deployments |
| `ALLOW_UNAUTHENTICATED` | `false` | Explicit local/private-only override for production no-auth startup |

Optional but commonly needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_APP_URL` | — | Public base URL for notification action and share links |

Detailed configuration references:

- Full configuration reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- Push notifications: [docs/PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md)
- Default user settings: [docs/DEFAULT_USER_SETTINGS.md](docs/DEFAULT_USER_SETTINGS.md)

# Development

Development setup and local commands are documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

For cross-stack maintenance work and pre-PR validation, the repository root now exposes:

```bash
npm run check
npm run build
```

# Acknowledgements

This project was inspired by [MedAssist](https://github.com/njic/medassist) by njic.
