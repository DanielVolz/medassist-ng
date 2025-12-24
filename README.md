# MedAssist-ng

📊 Medication tracking and planning app with stock monitoring, intake reminders, and email notifications.

## Quick Start (Production)

```bash
# 1. Clone and configure
git clone https://github.com/your-username/medassist-ng.git
cd medassist-ng
cp .env.example .env

# 2. Generate secure secrets (required!)
# Edit .env and replace CHANGE_ME values with output of:
openssl rand -hex 32

# 3. Start
docker compose up -d

# App runs on http://localhost:4174 (frontend) and http://localhost:4000 (API)
```

## Development

```bash
# Start dev environment with hot-reload
docker compose -f docker-compose.dev.yml up

# Frontend: http://localhost:5173
# Backend:  http://localhost:3000
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Frontend       │    │  Backend        │    │  SQLite             │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

- **Frontend**: React 18 + Vite + TypeScript, nginx-unprivileged (prod)
- **Backend**: Fastify 5 + TypeScript + SQLite (Drizzle ORM)
- **Security**: Non-root containers, read-only filesystem, no-new-privileges

## Features

- 📦 **Medication Inventory** - Track packs, blisters, loose pills
- 📅 **Intake Scheduling** - Multiple daily schedules with reminders
- 📊 **Stock Monitoring** - Automatic low-stock detection
- 📧 **Notifications** - Email (SMTP) and Push (ntfy, Discord, Telegram)
- 🌍 **i18n** - German and English
- 🌙 **Dark/Light Mode**

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | Access token signing (min 10 chars) |
| `REFRESH_SECRET` | ✅ | Refresh token signing |
| `COOKIE_SECional) |

## File Structure

```
medassist-ng/
├── backend/           # Fastify API
│   ├── src/
│   │   ├── db/       # Schema + migrations
│   │   ├── routes/   # API endpoints
│   │   └── services/ # Business logic
│   └── Dockerfile
├── frontend/          # React SPA
│   ├── src/
│   │   ├── App.tsx   # Main application
│   │   └── i18n/     # Translations
│   └── Dockerfile
├── docker-compose.yml      # Production (default)
├── docker-compose.dev.yml  # Development
└── .env.example
```

## Reverse Proxy (Caddy example)

```
med.example.com {
    reverse_proxy localhost:4174
}
```

## License

MIT
