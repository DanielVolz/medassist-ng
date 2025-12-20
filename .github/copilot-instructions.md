# MedAssist - AI Coding Instructions

## Architecture Overview

MedAssist is a **medication tracking and planning app** with a monorepo structure:

- **Backend**: Fastify 5 + TypeScript + SQLite (Drizzle ORM) at `backend/`
- **Frontend**: React 18 + Vite + TypeScript at `frontend/`
- **Database**: SQLite with migrations in `backend/src/db/migrations/`
- **Deployment**: Docker Compose with separate dev containers

### Data Flow
```
Frontend (React) → /api/* proxy → Backend (Fastify) → SQLite
                   ↓ (Vite rewrites /api to /)
```

The Vite proxy at `frontend/vite.config.ts` rewrites `/api/*` to `/` - so frontend calls `/api/medications` but backend route is just `/medications`.

## Development Commands

```bash
# Start dev environment (preferred)
docker compose up

# Or run services separately:
cd backend && npm run dev      # tsx watch on port 3000
cd frontend && npm run dev     # Vite on port 5173

# Database migrations
cd backend && npm run migrate
```

## Key Patterns

### Backend Routes (`backend/src/routes/`)
- Routes register directly on app without `/api` prefix
- Use Fastify's type-safe body/params: `app.put<{ Body: MyType }>()`
- Settings: notification config → JSON file (`data/notification-settings.json`), SMTP → `.env`

### Frontend (`frontend/src/App.tsx`)
- Single-file React app with all components and state
- Uses React Router for navigation (`/dashboard`, `/medications`, `/planner`, `/settings`)
- API calls use `/api/` prefix (proxied by Vite)
- Medication scheduling logic with "slices" (usage patterns)

### Database Schema (`backend/src/db/schema.ts`)
- `medications`: tracks count, strips, pack inventory, usage schedules as JSON
- `users`, `refreshTokens`: JWT auth with rotating refresh tokens
- `settings`: legacy table (SMTP now from `.env`, notifications from JSON file)

### Settings Architecture
```
SMTP config:     .env file (read-only in UI, loaded via env_file in docker-compose)
Notifications:   data/notification-settings.json (editable via UI)
```

## Conventions

- **TypeScript**: Strict mode, ESM modules (`"type": "module"`)
- **Styling**: CSS custom properties in `frontend/src/styles.css`, dark/light theme via `data-theme`
- **API responses**: Return objects directly, Fastify serializes to JSON
- **Environment**: Copy `.env.example` → `.env`, secrets must be 10+ chars

## ⚠️ Database Migrations (CRITICAL)

**When adding/modifying database columns, ALWAYS:**

1. **Update schema**: `backend/src/db/schema.ts`
2. **Create migration file**: `backend/src/db/migrations/XXXX_description.sql`
   ```sql
   -- Example: Adding a new column
   ALTER TABLE medications ADD COLUMN new_column TEXT;
   ```
3. **Update journal**: `backend/src/db/migrations/meta/_journal.json`
   ```json
   { "idx": X, "version": 1, "when": TIMESTAMP, "tag": "XXXX_description", "breakpoint": false }
   ```

**Why this matters**: The dev database might get updated manually, but production will break without proper migration files. This causes `SQLITE_ERROR: no such column` errors in prod.

**Migration naming**: `0001_add_strips.sql`, `0002_pack_inventory.sql`, `0003_add_image_url.sql`

## File Locations

| Purpose | Location |
|---------|----------|
| Backend entry | `backend/src/index.ts` |
| Database schema | `backend/src/db/schema.ts` |
| Migrations | `backend/src/db/migrations/*.sql` |
| Frontend app | `frontend/src/App.tsx` |
| Styles | `frontend/src/styles.css` |
| Docker dev setup | `docker-compose.yml` |
| Env template | `.env.example` |
