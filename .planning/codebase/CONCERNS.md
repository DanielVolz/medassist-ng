# Codebase Concerns

**Analysis Date:** 2026-04-30

## Tech Debt

**Backend startup duplication and config drift:**
- Issue: `backend/src/index.ts` contains two parallel server setup paths (the exported `createApp(...)` flow and the top-level runtime bootstrap). Plugin/route registration and rate-limit defaults are duplicated in both branches.
- Files: `backend/src/index.ts`
- Impact: Configuration behavior can diverge between test/programmatic app construction and production startup (for example, `createApp` uses fixed `rateLimit` max `300`, while runtime startup uses `process.env.RATE_LIMIT_MAX` fallback `100`).
- Fix approach: Extract one canonical app-construction function and let both runtime startup and tests consume it; remove duplicated registration blocks.

**Notification architecture leakage and duplicated composition logic:**
- Issue: Notification delivery service code imports a route-layer helper (`sendShoutrrrNotification`) from settings routes, and large HTML/text reminder composition blocks are duplicated across manual and automatic reminder paths.
- Files: `backend/src/services/notifications/delivery.ts`, `backend/src/routes/settings.ts`, `backend/src/routes/planner.ts`, `backend/src/services/reminder-scheduler.ts`
- Impact: Layer boundary violations increase coupling, and duplicated notification formatting logic makes behavior regressions likely when changing message content or channel behavior.
- Fix approach: Move `sendShoutrrrNotification` to a service-layer module, make routes call service APIs only, and centralize email/push payload builders for planner + scheduler flows.

**Migration artifact ambiguity in drizzle numbering:**
- Issue: There are two migration files with `0008_` prefix, but the journal tracks only one `0008` tag and then jumps to `0009`.
- Files: `backend/drizzle/0008_add_obsolete_medications.sql`, `backend/drizzle/0008_add_prescription_tracking.sql`, `backend/drizzle/meta/_journal.json`
- Impact: Developer confusion and higher risk of migration-order mistakes during future schema changes.
- Fix approach: Align migration file names and journal tags so each migration number is unique and journal order is obvious.

**Monolithic UI/editor and route modules with broad lint suppressions:**
- Issue: Core interaction files are very large and rely on file-level `biome-ignore-all` suppressions for multiple rule categories.
- Files: `frontend/src/pages/MedicationsPage.tsx`, `frontend/src/components/MobileEditModal.tsx`, `frontend/src/components/SharedSchedule.tsx`, `frontend/src/components/MedDetailModal.tsx`, `backend/src/routes/medications.ts`
- Impact: Refactors become high-risk; local regressions are harder to isolate; suppressed rule categories hide legitimate quality issues in future edits.
- Fix approach: Split by domain slices (state orchestration vs rendering vs helper transforms), then replace file-level suppressions with narrow, local exceptions only where justified.

## Known Bugs

**Environment-dependent behavior mismatch between test app factory and runtime app:**
- Symptoms: Programmatic app creation and runtime startup can apply different operational defaults (rate limiting and selected config pathways).
- Files: `backend/src/index.ts`
- Trigger: Using `createApp(...)` in tests/integration contexts while production startup uses the top-level runtime branch.
- Workaround: Explicitly pass runtime-equivalent options into `createApp(...)` in tests until startup construction is unified.

## Security Considerations

**Server-side outbound notification surface is broad and sensitive to parser correctness:**
- Risk: The app performs server-side HTTP requests to user-configurable notification URLs, including multiple protocol handlers (`pushover://`, `telegram://`, `gotify://`, generic webhook URLs).
- Files: `backend/src/routes/settings.ts`
- Current mitigation: URL sanitation/validation and hostname checks are present (`sanitizeNotificationUrl`, `validateNotificationHostname` usage in route logic).
- Recommendations: Add focused security regression tests for sanitizer bypasses and callback URL edge cases, and keep all outbound request execution in a dedicated service layer.

**Auth-off bootstrap path creates implicit default user state:**
- Risk: In auth-disabled mode, startup creates/relies on a default user path automatically.
- Files: `backend/src/db/client.ts`
- Current mitigation: Controlled by `AUTH_ENABLED` environment setting.
- Recommendations: Add startup log warnings when running without auth outside development and enforce explicit environment confirmation in deployment templates.

## Performance Bottlenecks

**Reminder scheduling uses repeated full scans over users and medication/dose datasets:**
- Problem: Reminder checks iterate all user settings and compute stock/prescription reminders with repeated in-memory loops over medication and dose collections.
- Files: `backend/src/services/reminder-scheduler.ts`, `backend/src/utils/scheduler-utils.ts`
- Cause: Polling/check strategy prioritizes correctness and compatibility over incremental indexing.
- Improvement path: Introduce incremental candidate selection (changed-medication windows, per-user next-check indices) and reduce repeated whole-set scans.

**Intake reminder scheduler polls every minute and may scale linearly with active schedules:**
- Problem: Intake reminder check loop runs continuously at 60s interval and processes all due reminders/users each tick.
- Files: `backend/src/services/intake-reminder-scheduler.ts`
- Cause: Fixed-interval scheduler (`CHECK_INTERVAL_MS = 60 * 1000`) with loop-driven due-item selection.
- Improvement path: Move toward next-due-time scheduling or bucketing strategy; keep minute polling as fallback only.

## Fragile Areas

**Reminder state persistence and lock handling mix sync file IO with best-effort catches:**
- Files: `backend/src/services/notifications/state.ts`, `backend/src/services/reminder-scheduler.ts`
- Why fragile: Reminder state writes are synchronous file writes and some read paths swallow errors (`catch {}`), while lock/state files are local filesystem coordination primitives.
- Safe modification: Keep file format backward-compatible, add explicit error telemetry, and add tests for concurrent/failed write scenarios before changing scheduler state logic.
- Test coverage: No direct tests detected for `notifications/delivery.ts` and only limited direct state-function assertions.

**Desktop/mobile medication edit parity depends on two large independent UI paths:**
- Files: `frontend/src/pages/MedicationsPage.tsx`, `frontend/src/components/MobileEditModal.tsx`, `frontend/src/components/medications/MedicationEditCoordinator.tsx`
- Why fragile: The same editing domain is implemented in separate surfaces, each with dense UI logic and custom interaction handling.
- Safe modification: Apply shared form-section components first, then update desktop and mobile in the same change; validate both paths with targeted tests.
- Test coverage: Coverage exists (`MedicationEditCoordinator`, `MobileEditModal`, `MedicationDialogs` tests), but parity regressions remain a recurring risk due to file size/complexity.

## Scaling Limits

**Current reminder architecture is single-node/local-state oriented:**
- Current capacity: Scheduler state and lock coordination are local files under data directory (`reminder-state.json`, `scheduler-locks/*`).
- Limit: Horizontal multi-instance scaling can duplicate work or require externalized coordination.
- Scaling path: Move reminder state/locks to DB or distributed lock backend and make scheduler execution leader-aware.

**SQLite file-backed persistence constrains concurrent write scaling:**
- Current capacity: Single SQLite file with local filesystem path resolution.
- Limit: Higher write concurrency and distributed deployments will hit filesystem/database locking and throughput limits.
- Scaling path: Keep SQLite for local/small deployments; define migration path to managed DB for larger multi-user workloads.

## Dependencies at Risk

**Route-to-service coupling in notification stack:**
- Risk: Service-layer delivery module depends on route-layer helper import.
- Impact: Refactors of route modules can break unrelated notification infrastructure and complicate testing boundaries.
- Migration plan: Move shared notification send helpers into `backend/src/services/notifications/*` and keep route modules thin.

## Missing Critical Features

**Risk-driven scheduler stress/integration test suite for state-lock edge cases:**
- Problem: Complex scheduler/state code paths rely on file coordination and mixed channel delivery outcomes, but dedicated stress/chaos-style verification is limited.
- Blocks: High-confidence scaling and reliability changes in reminder subsystems.

## Test Coverage Gaps

**Notification delivery abstraction lacks direct unit tests:**
- What's not tested: Direct behavior of SMTP transport creation/result validation and push delivery helpers in the dedicated delivery module.
- Files: `backend/src/services/notifications/delivery.ts`
- Risk: Regressions in recipient validation, SMTP response handling, or provider fallback can ship unnoticed.
- Priority: High

**Reminder state persistence/locking has limited direct verification:**
- What's not tested: Corrupted file recovery, concurrent state writes, and lock stale-file behavior under failure modes.
- Files: `backend/src/services/notifications/state.ts`, `backend/src/services/reminder-scheduler.ts`
- Risk: Duplicate sends or missed sends after crashes/restarts are difficult to detect early.
- Priority: High

---

*Concerns audit: 2026-04-30*
