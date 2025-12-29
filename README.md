<p align="center">
  <img src="frontend/public/web-app-manifest-512x512.png" alt="MedAssist-ng Logo" width="120" />
</p>

<h1 align="center">MedAssist-ng</h1>

<p align="center">
  <strong>Never run out of your medications again.</strong><br>
  A medication tracking and planning app with stock monitoring, intake schedules, and reminder notifications.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/SQLite-Database-003B57?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker" />
</p>

### 🤖 AI-Generated Code

> This app was 100% coded with Claude Opus 4.5. Use at your own risk.

### ⚠️ Disclaimer

> **Your health is your responsibility.** This app may contain bugs. Follow your doctor's instructions closely, keep track of your medication supply, and plan ahead for reordering.
>
> **Think of this app as a helpful tool, but make all health decisions independently!**

- [Features](#features)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Development](#development)

# Features

<p align="center">
  <img src="docs/gifs/MedAssist-demo.gif" alt="MedAssist-ng Dashboard" width="100%" />
</p>

### Smart Inventory
- Track exact stock: packs, blisters, and loose pills
- Display remaining days of supply
- Automatic calculation based on intake schedule

### Flexible Schedules
- Daily, weekly, or custom intervals per medication
- Independent schedules for each medication

### Stock Alerts & Reminders
- Notifications before stock runs out
- Configurable warning thresholds
- Intake reminders via push notifications

### Trip Planner
- Calculate how many pills you need for a trip or date range
- Plan ahead for vacations, business trips, or hospital stays

### Multi-Person Support
- Manage medications for multiple people
- Share schedules via link. Recipients can mark doses as taken, you see it live

### Notifications
- Email via SMTP
- Push notifications via ntfy, Gotify, Telegram, Discord (Shoutrrr)
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
docker compose up -d
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
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `TZ` | `Europe/Berlin` | Timezone for scheduled reminders |

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

### OIDC / SSO

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ENABLED` | `false` | Enable OIDC authentication |
| `OIDC_ISSUER_URL` | — | OIDC provider URL |
| `OIDC_CLIENT_ID` | — | Client ID from OIDC provider |
| `OIDC_CLIENT_SECRET` | — | Client secret from OIDC provider |
| `OIDC_REDIRECT_URI` | — | Callback URL |
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

# Development

```bash
docker compose -f docker-compose.dev.yml up
```

- Frontend: `http://localhost:5173` (hot reload)
- Backend: `http://localhost:3000`

# Acknowledgements

This project was inspired by [MedAssist](https://github.com/njic/medassist) by njic.
