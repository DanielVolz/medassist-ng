# MedAssist-ng - AI Coding Instructions

## Architecture Overview

MedAssist-ng is a **medication tracking and planning app** with a monorepo structure:

- **Backend**: Fastify 5 + TypeScript + SQLite (Drizzle ORM) at `backend/`
- **Frontend**: React 18 + Vite + TypeScript at `frontend/`
- **Database**: SQLite with migrations in `backend/src/db/migrations/`
- **Deployment**: Docker Compose with separate dev containers
- **i18n**: English (en) and German (de) via react-i18next

### Data Flow
```
Frontend (React) → /api/* proxy → Backend (Fastify) → SQLite
                   ↓ (Vite rewrites /api to /)
```

The Vite proxy at `frontend/vite.config.ts` rewrites `/api/*` to `/` - so frontend calls `/api/medications` but backend route is just `/medications`.

## Development Commands

```bash
# Start dev environment (preferred)
docker compose -f docker-compose.dev.yml up

# Or run services separately:
cd backend && npm run dev      # tsx watch on port 3000
cd frontend && npm run dev     # Vite on port 5173

# Production
docker compose up -d

# Database migrations
cd backend && npm run migrate
```

## Key Patterns

### Backend Routes (`backend/src/routes/`)
| Route File | Endpoints |
|------------|-----------|
| `auth.ts` | `/auth/login`, `/auth/register`, `/auth/logout`, `/auth/refresh`, `/auth/me` |
| `medications.ts` | CRUD `/medications`, `/medications/:id/image` |
| `doses.ts` | `/doses/taken` - track dose intake |
| `planner.ts` | `/medications/usage` - calculate usage for date range |
| `settings.ts` | `/settings` - user settings CRUD |
| `share.ts` | `/share` - create share tokens, `/share/:token` - public access |
| `health.ts` | `/health` - health check endpoint |

### Backend Services (`backend/src/services/`)
| Service | Description |
|---------|-------------|
| `reminder-scheduler.ts` | Stock reminder emails/push notifications |
| `intake-reminder-scheduler.ts` | Intake reminder notifications |

### Frontend (`frontend/src/App.tsx`)
- Single-file React app with all components and state
- Uses React Router for navigation
- API calls use `/api/` prefix (proxied by Vite)
- Medication scheduling logic with intake schedules (multiple time entries per medication)

## Frontend Components & Views

### Routes / Pages
| Route | Description |
|-------|-------------|
| `/dashboard` | Main view with Coverage Cards + Upcoming Schedules timeline |
| `/medications` | Medications list + New/Edit form with all fields |
| `/planner` | Usage planner - calculate needed pills for date range |
| `/settings` | App settings: notifications, email, thresholds, language |
| `/schedule` | Full schedule view (simplified, no coverage cards) |
| `/share/:token` | Public share link for "taken by" user schedule |

### Key React Components (in App.tsx)
| Component | Description |
|-----------|-------------|
| `App` | Root component with BrowserRouter |
| `AppRouter` | Handles auth check, renders AppContent or Auth |
| `AppContent` | Main app shell with navigation, header, all routes |
| `SharedSchedule` | Public share page for medication schedules by person |
| `MedicationAvatar` | Round avatar with medication image or colored initial |

### Dashboard Sections
| Section | Description |
|---------|-------------|
| **Coverage Cards** | Stock status cards per medication: days left, blisters, status (Normal/Warning/Critical) |
| **Upcoming Schedules** | Timeline grouped by day, collapsible days, dose tracking |

### Schedule/Timeline Elements
| Element | CSS Class | Description |
|---------|-----------|-------------|
| Past days toggle | `.past-days-toggle` | Click to show/hide past days |
| Day container | `.day-block` | Container for one day, collapsible |
| Today highlight | `.day-block.today` | Blue border/background for current day |
| Past day | `.day-block.past` | Dashed border, reduced opacity |
| All taken | `.day-block.all-taken` | Green styling when all doses taken |
| Day header | `.day-divider` | Date header with collapse toggle arrow |
| Collapse icon | `.day-collapse-icon` | ▶/▼ arrow for expand/collapse |
| Day summary | `.day-summary` | Shows "X/Y" doses taken or "✓ All taken" |
| Medication row | `.time-row` | One medication's doses for that day |
| Dose item | `.dose-item` | Individual dose with time, amount, take/undo button |
| Dose taken | `.dose-item.taken` | Green background when dose is marked taken |
| Dose overdue | `.dose-item.overdue` | Styling for past untaken doses |
| Dose future | `.dose-item.future` | Disabled button for future days |

### Medication Form (New/Edit)
| Field | Description |
|-------|-------------|
| Commercial Name | Main medication name (required) |
| Generic Name | Scientific/generic name (optional) |
| Taken By | Person taking the medication (optional, enables filtering/sharing) |
| Packs | Number of full packs |
| Blisters per Pack | Strips/blisters in each pack |
| Pills per Blister | Tablets per strip |
| Loose Pills | Extra pills not in blisters |
| Pill Weight (mg) | Weight per pill for dose calculation display |
| Expiry Date | Medication expiration |
| Notes | Free text notes |
| Image Upload | Medication photo (preview for new, direct upload for edit) |
| **Intake Schedule** | One or more intake entries defining usage pattern |

### Intake Schedule
Each blister defines a recurring intake:
- **Usage (Pills)**: How many pills per dose
- **Every (Days)**: Interval (1 = daily, 7 = weekly)
- **Start (Date/Time)**: When the schedule starts (determines past/future doses)
- **Remind checkbox**: Enable intake reminders (🔔)

### Modals
| Modal | Trigger | Content |
|-------|---------|---------|
| Medication Detail | Click on coverage card or medication row | Full medication info, stock, schedule preview, edit/delete/ICS buttons |
| Image Lightbox | Click medication image | Full-size medication image |
| Share Dialog | "Share" button on schedules | Generate share link for specific "taken by" person |
| User Schedule Filter | Click on "taken by" badge | Filter schedule by person |

### Settings Sections
| Section | Settings |
|---------|----------|
| General | Language toggle (EN/DE) |
| Stock Thresholds | Warning days, critical days, expiry warning days |
| Email Notifications | Enable, email address, stock/intake toggles |
| Push Notifications (Shoutrrr) | Enable, URL (ntfy/gotify/etc), stock/intake toggles |
| Reminder Settings | Days before, repeat daily |
| SMTP | Email config (read-only from .env) |

## Database Schema (`backend/src/db/schema.ts`)

| Table | Description |
|-------|-------------|
| `users` | User accounts with password hash, auth provider, timestamps |
| `medications` | Per-user medications with inventory, schedules as JSON arrays |
| `userSettings` | Per-user settings: notifications, thresholds, language |
| `refreshTokens` | JWT refresh tokens for auth rotation |
| `shareTokens` | Public share links by takenBy person |
| `doseTracking` | Tracks when doses are marked as taken |

### Key Medication Fields
```typescript
{
  name, genericName, takenBy,           // Identity
  packCount, stripsPerPack, tabsPerStrip, looseTablets,  // Inventory
  count, strips, stripSize,              // Derived/legacy
  pillWeightMg,                          // For mg display
  usageJson, everyJson, startJson,       // Intake schedules as JSON arrays
  imageUrl, expiryDate, notes,           // Optional metadata
  intakeRemindersEnabled                 // Per-med reminder toggle
}
```

### Dose ID Format
Dose IDs follow the pattern: `{medicationId}-{blisterIndex}-{timestampMs}`
Example: `5-0-1735344000000` = Medication 5, Blister 0, timestamp

## State Management (AppContent)

### Key State Variables
| State | Purpose |
|-------|---------|
| `meds` | Array of all user's medications |
| `form` | Current medication form data |
| `editingId` | ID of medication being edited (null for new) |
| `pendingImage` / `pendingImagePreview` | Image upload for new medications |
| `settings` / `savedSettings` | User settings current vs saved |
| `scheduleDays` | How many days to show (30/90/180) |
| `showPastDays` | Toggle for past days visibility |
| `takenDoses` | Set of dose IDs that are marked taken |
| `manuallyCollapsedDays` / `manuallyExpandedDays` | Day collapse state |
| `selectedMed` | Medication shown in detail modal |
| `selectedUser` | Filter schedule by "taken by" person |

### Key Computed Values (useMemo)
| Value | Purpose |
|-------|---------|
| `schedule` | All scheduled events from `buildSchedulePreview()` |
| `groupedSchedule` | Events grouped by day |
| `pastDays` / `futureDays` | Split groupedSchedule by today |
| `coverage` | Stock coverage calculations |
| `coverageByMed` / `depletionByMed` | Coverage lookups |

## Conventions

- **TypeScript**: Strict mode, ESM modules (`"type": "module"`)
- **Styling**: CSS custom properties in `frontend/src/styles.css`, dark/light theme via `data-theme`
- **API responses**: Return objects directly, Fastify serializes to JSON
- **Environment**: Copy `.env.example` → `.env`, secrets must be 10+ chars
- **i18n**: All UI text via `t('key')` function, translations in `frontend/src/i18n/*.json`

## ⚠️ Database Migrations (CRITICAL)

**When adding/modifying database columns or tables, ALWAYS do ALL of the following:**

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
4. **Update migrate.ts**: `backend/src/db/migrate.ts`
   - This file contains `CREATE TABLE IF NOT EXISTS` statements for fresh database starts
   - Add new columns to the relevant table or add new tables
   - Without this, fresh installs will be missing the new columns/tables!

**Why this matters**: 
- Migration SQL files: Required for upgrading existing databases
- migrate.ts: Required for fresh database starts (creates tables with all columns)
- Forgetting either causes `SQLITE_ERROR: no such column` errors

## File Locations

| Purpose | Location |
|---------|----------|
| Backend entry | `backend/src/index.ts` |
| Database schema | `backend/src/db/schema.ts` |
| Migrations | `backend/src/db/migrations/*.sql` |
| Migration journal | `backend/src/db/migrations/meta/_journal.json` |
| Backend routes | `backend/src/routes/*.ts` |
| Backend services | `backend/src/services/*.ts` |
| Frontend app | `frontend/src/App.tsx` |
| Frontend auth | `frontend/src/components/Auth.tsx` |
| Styles | `frontend/src/styles.css` |
| i18n English | `frontend/src/i18n/en.json` |
| i18n German | `frontend/src/i18n/de.json` |
| Docker prod | `docker-compose.yml` |
| Docker dev | `docker-compose.dev.yml` |
| Env template | `.env.example` |
