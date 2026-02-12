# MedAssist-ng - AI Coding Instructions

## General Rules

- **English is the primary language**: All code, comments, documentation, commit messages, PR descriptions, and GitHub releases MUST be written in English. The user may communicate in German, but all project artifacts must be in English.
- **NEVER release without explicit permission**: Do NOT create tags, releases, or version bumps unless the user explicitly asks for it. Always wait for explicit confirmation before any release action.
- **NEVER create PRs, push, or merge**: Only the **release-manager agent** (`@release-manager`) is allowed to create Pull Requests, push branches to the remote, or merge code. Regular agents and Copilot MUST NOT perform any git operations that affect the remote repository (no `git push`, no `gh pr create`, no `gh pr merge`). Present your local changes and tell the user to invoke `@release-manager` when ready to ship.
- **No temporary files**: Delete temporary scripts/files immediately after use. Do not commit temporary debug scripts, test files, or one-off utilities to the repository.
- **Clean workspace**: Always clean up after yourself. If you create a file for a specific task, delete it once done.
- **Remove old code when re-implementing**: When fixing a bug or re-implementing a feature that didn't work, ALWAYS remove the old/broken code completely. Never leave dead code, unused functions, or obsolete implementations in the codebase.
- **Tests are mandatory**: Every new feature and every bug fix MUST have corresponding tests. When modifying existing features, update or add tests accordingly. If old tests become obsolete due to code changes, remove or update them.
- **Fix bugs, don't test around them**: If you discover incorrect behavior in the code while writing tests, ALWAYS fix the buggy code first, then write tests that verify the correct behavior. NEVER write tests that mimic or assert broken behavior. The user's time is finite and irreplaceable — every bug left unfixed wastes it.
- **Keep README.md up to date**: After implementing code changes, check whether the `README.md` needs to be updated (e.g., new features, changed ENV variables, new commands, changed architecture, new endpoints, updated screenshots). If changes are relevant to the README, **ask the user for confirmation** before updating it. Do NOT silently update the README — always present the proposed README changes and wait for approval. Examples of README-relevant changes: new ENV variables, new API endpoints, new UI features, changed setup/install steps, new dependencies, changed Docker configuration.
- **Track work in GitHub Project**: All features, bugs, and tasks MUST be tracked in the [GitHub Project board](https://github.com/users/DanielVolz/projects/1). Before starting work, ensure a corresponding issue exists. Use the `enhancement`, `bug`, or `triage` labels so the issue is automatically added to the board. Update the issue status as work progresses (Triage → Backlog → Ready → In progress → Done).

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

# Run tests
cd backend && npm test              # Run all tests
cd backend && npm run test:coverage # Run with coverage report
```

## GitHub CLI Safety (Non-Interactive Only)

- Never use `gh` commands that can open an interactive pager and block execution (requiring `q`).
- Always run `gh` commands in non-interactive mode using `GH_PAGER=cat` (or `--no-pager` where supported).
- Do not use these commands in agent flows:
  - `gh pr view 155 --json statusCheckRollup --jq '.statusCheckRollup[] | {name:.name,conclusion:.conclusion,detailsUrl:.detailsUrl,workflowName:.workflowName}'`
  - `SHA=$(gh pr view 155 --json headRefOid --jq .headRefOid) && gh api repos/DanielVolz/medassist-ng/commits/$SHA/check-runs --jq '.check_runs[] | {name,conclusion,details_url,html_url,app:.app.name}'`
- Use safe variants instead:
  - `GH_PAGER=cat gh pr view <PR_NUMBER> --json statusCheckRollup --jq '<jq-filter>'`
  - `GH_PAGER=cat gh api repos/<owner>/<repo>/commits/<sha>/check-runs --jq '<jq-filter>'`

## Testing (MANDATORY)

> ⚠️ **IMPORTANT**: Every new feature MUST be covered by tests!
> Pull Requests without tests for new features will not be accepted.

### Test Framework
- **Vitest 2.1** with v8 Coverage
- Tests in `backend/src/test/*.test.ts`
- Coverage goal: At least equal or better coverage after changes

### Test Structure
| File | Tests |
|------|-------|
| `routes.test.ts` | API endpoints (Auth, Medications, Doses, Settings, Share, Planner) |
| `services.test.ts` | Scheduler utilities (Timezone, Blisters, Usage calculation) |
| `db.test.ts` | Database schema and operations |

### Writing Tests

```typescript
// Backend Test Example (backend/src/test/example.test.ts)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, createTestUser } from './routes.test'; // Test-Utilities

describe('Feature Name', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    const user = await createTestUser(app);
    authToken = user.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should do something specific', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/endpoint',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('expectedField');
  });
});
```

### Test Commands
```bash
cd backend
CI=true npm test            # Run tests once (ALWAYS run this way!)
CI=true npm run test:coverage  # With coverage report
npm test -- --watch         # Watch mode for manual development
npm test -- -t "test name"  # Run single test
```

> ⚠️ **IMPORTANT for AI agents**: ALWAYS run tests with `CI=true`!
> Without `CI=true`, Vitest runs in watch mode and waits for input.

## CI/CD Pipeline (GitHub Actions)

### Workflow Overview

```
Pull Request created
        ↓
┌─────────────────────────────────────┐
│  test.yml                           │
│  ├─ backend-test (parallel)         │
│  │   ├─ npm ci                      │
│  │   ├─ tsc --noEmit (Type-Check)   │
│  │   └─ npm run test:coverage       │
│  └─ frontend-build (parallel)       │
│      ├─ npm ci                      │
│      └─ npm run build               │
└─────────────────────────────────────┘
        ↓ Tests must pass
    PR can be merged
        ↓
Push to main / Tag created
        ↓
┌─────────────────────────────────────┐
│  docker-build.yml                   │
│  └─ build-and-push                  │
│      ├─ Build Docker images         │
│      └─ Push to GHCR                │
│      (Tag builds also set "latest") │
└─────────────────────────────────────┘
        ↓ After successful build
┌─────────────────────────────────────┐
│  update-test-badges.yml             │
│  (workflow_run after docker-build)  │
│  └─ Run tests, update badge counts  │
└─────────────────────────────────────┘
```

### Branch Protection

> ⚠️ **IMPORTANT**: The `main` branch is protected!  
> Direct pushing to `main` is **not possible** - GitHub will reject the push.  
> All changes must go through Pull Requests.

- **main** branch is protected (Repository Rules)
- Direct pushing is rejected by GitHub with: `GH013: Repository rule violations`
- PRs require:
  - ✅ `backend-test` Status Check passed
  - ✅ `frontend-build` Status Check passed
- After successful merge, the feature branch is automatically deleted

**Workflow for changes:**
```bash
# 1. Create feature branch
git checkout -b feat/my-feature

# 2. Commit and push changes
git add . && git commit -m "feat: Description"
git push -u origin feat/my-feature

# 3. Create PR (via GitHub CLI or Web)
gh pr create --title "My Feature" --body "Description"

# 4. Wait until CI is green, then merge
gh pr merge --squash --delete-branch
```

### Workflow Files
| File | Trigger | Purpose |
|------|---------|--------|
| `.github/workflows/test.yml` | Pull Requests | Run tests, block PR on failures |
| `.github/workflows/docker-build.yml` | Push to main, Tags | Build and push Docker images (+ create GitHub release on tags) |
| `.github/workflows/update-test-badges.yml` | After successful docker-build | Update test count badges in README |
| `.github/workflows/codeql.yml` | Push to main, PRs, Weekly | Security analysis |
| `.github/workflows/add-to-project.yml` | Issues opened/labeled | Auto-add issues with `enhancement`, `bug`, or `triage` labels to GitHub Project |

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
| Reminder Settings | Days before, repeat daily, skip for taken, repeat/nagging |
| SMTP | Email config (read-only from .env) |

### Settings ENV Defaults
All user settings can be pre-configured via ENV variables (see `.env.example`).
These are only used as **defaults when a new user is created**.
Once a user saves settings in the app, their saved values take precedence over ENV.

| ENV Variable | Setting | Default |
|--------------|---------|---------|
| `DEFAULT_EMAIL_ENABLED` | Email notifications | false |
| `DEFAULT_SHOUTRRR_ENABLED` | Push notifications | false |
| `DEFAULT_SHOUTRRR_URL` | ntfy/gotify URL | (empty) |
| `DEFAULT_REPEAT_REMINDERS_ENABLED` | Nagging reminders | false |
| `DEFAULT_REMINDER_REPEAT_INTERVAL_MINUTES` | Nag interval | 30 |
| `DEFAULT_MAX_NAGGING_REMINDERS` | Max nags | 5 |
| `DEFAULT_LOW_STOCK_DAYS` | Low stock threshold | 30 |
| `DEFAULT_LANGUAGE` | UI language | en |

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
  name, genericName, takenByJson,        // Identity (takenByJson is JSON array)
  packCount, blistersPerPack, pillsPerBlister, looseTablets,  // Inventory
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
- **UI Consistency**: Always use existing components for modals, buttons, and forms. For confirmation dialogs, use `ConfirmModal` component. Never create inline modals with custom button styling - all UI elements must match the existing design system. When adding new sections to existing components, ensure font sizes, spacing, margins, and button styles match exactly with other sections. Check existing CSS classes before creating new ones.

## Database Schema Changes (IMPORTANT: Backward Compatibility!)

> ⚠️ **CRITICAL**: The app MUST remain backward compatible with older databases!
> Users upgrade their Docker containers but keep their existing DB.
> The app must NOT crash if old columns are missing.

### ⚠️ MANDATORY for EVERY New Feature

**Before implementing ANY feature that touches user data or settings:**

1. **Check if new DB columns are needed** - Does the feature require storing new data?
2. **If YES → Follow ALL steps below** - Schema.ts + Drizzle migration + ALTER migration + NULL-safe code
3. **NEVER skip the ALTER migration** - This is the #1 cause of production 500 errors!

**Common mistake:** Adding a column to `schema.ts` and forgetting the ALTER migration in `client.ts`.
The Drizzle migration only works for NEW databases. Existing production databases need the ALTER migration!

### Schema Management with Drizzle Kit

The database schema uses **Drizzle Kit** for migrations. There is a **single source of truth**:

- **`backend/src/db/schema.ts`** - Drizzle ORM schema definitions (TypeScript)
- **`backend/drizzle/`** - Generated SQL migrations (auto-generated from schema.ts)

**DO NOT manually edit migration files!** They are generated from schema.ts.

### Adding New Columns

1. **Add to schema.ts** with DEFAULT value:
   ```typescript
   maxNaggingReminders: integer("max_nagging_reminders").notNull().default(5),
   ```

2. **Generate migration**:
   ```bash
   cd backend && npx drizzle-kit generate --name add_column_name
   ```

3. **Add backward-compatible ALTER migration** in `client.ts` `runAlterMigrations()`:
   ```typescript
   `ALTER TABLE user_settings ADD COLUMN max_nagging_reminders integer NOT NULL DEFAULT 5`,
   ```

4. **NULL-safe reading** in routes:
   ```typescript
   maxNaggingReminders: settings.maxNaggingReminders ?? 5,
   ```

### Rules for New Columns

1. **ALWAYS with DEFAULT value**: New columns must have `NOT NULL DEFAULT <value>`
2. **NULL-safe in code**: All queries must use `?? defaultValue` or `?? false`
3. **Generate migration**: Run `npx drizzle-kit generate` after schema changes
4. **Add ALTER migration**: For backward compatibility with existing DBs

### What is NOT Allowed

- ❌ Deleting or renaming columns (breaks old DBs)
- ❌ `NOT NULL` without `DEFAULT` (INSERT fails)
- ❌ Reading columns without fallback in code
- ❌ Manually editing migration SQL files
- ❌ Documenting "delete DB" as a solution

### When Backward Compatibility is NOT Possible

If a breaking change is unavoidable:
1. **Explicitly communicate**: Document in release notes
2. **Migration script**: Provide automatic upgrade script
3. **Version check**: App should check DB version and warn

## File Locations

| Purpose | Location |
|---------|----------|
| Backend entry | `backend/src/index.ts` |
| Database schema | `backend/src/db/schema.ts` |
| Drizzle migrations | `backend/drizzle/*.sql` |
| Drizzle config | `backend/drizzle.config.ts` |
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
| Project setup | `docs/PROJECT_SETUP.md` |

## GitHub Project Management

All work is tracked in the [GitHub Project board](https://github.com/users/DanielVolz/projects/1) (Project ID: `PVT_kwHOADH82s4BO2OT`).

### Board Columns (Status)
| Column | Color | Description |
|--------|-------|-------------|
| Triage | Purple | New issues needing review |
| Backlog | Green | Accepted, not yet started |
| Ready | Blue | Ready to be picked up |
| In progress | Yellow | Currently being worked on |
| Done | Orange | Completed |

### Custom Fields
| Field | Options | Usage |
|-------|---------|-------|
| **Type** | Bug (red), Feature (green), Chore (gray), Documentation (blue) | Categorize the work |
| **Priority** | High (red), Medium (orange), Low (yellow) | Set urgency |
| **Size** | XS, S, M, L, XL | Estimate effort |

### Agent Workflow for Issues

1. **Before starting work**: Check the Project board for existing issues. If the task has no issue yet, create one:
   ```bash
   gh issue create --title "feat: description" --label enhancement
   ```
   Issues with `enhancement`, `bug`, or `triage` labels are **automatically added** to the Project board.

2. **When starting work**: Move the issue to "In progress":
   ```bash
   # List items to find the item ID
   gh project item-list 1 --owner DanielVolz
   # Update status (use GraphQL for field updates)
   ```

3. **When work is done locally**: Leave in "In progress" and tell the user to invoke `@release-manager`.

4. **After merge**: The issue moves to "Done" (via `closes #N` in PR body or manually).

### Issue Labels
| Label | Applied by | Purpose |
|-------|-----------|--------|
| `enhancement` | Feature request template | New features |
| `bug` | Bug report template | Bug fixes |
| `triage` | Both templates | Needs review |

All three labels trigger the `add-to-project.yml` workflow, which automatically adds the issue to the Project board.
