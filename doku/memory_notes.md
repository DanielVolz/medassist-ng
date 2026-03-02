# Agent Memory Notes

Purpose: persistent agent work memory to survive context loss.

## Usage Rules

- Update this file during and after meaningful work.
- Record decisions, touched files, constraints, and unresolved follow-ups.
- Keep entries concise and chronological.

## How to maintain (1-minute template)

Use this block for each meaningful task:

```md
### YYYY-MM-DD

- 🧩 Task:
- ✅ Decisions:
- 📁 Files touched:
- 🔜 Follow-up/open points:
```

## Entries

### 2026-03-02 (schedule usage label follows selected intake unit)

- 🧩 Task: Ensure liquid intake schedule label switches from ml to tsp/tbsp when intake unit is changed.
- ✅ Decisions:
	- Desktop schedule tab in `MedicationsPage` used a static `usageMl` label for `liquid_container`.
	- Replaced static usage label with per-intake unit mapping (`ml`, `tsp`, `tbsp`) using existing i18n keys.
	- Kept parity with `MobileEditModal`, which already had the correct per-intake label logic.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add/extend UI tests that assert label text updates after switching intake unit in desktop edit form.

### 2026-03-02 (recover missing desktop form detail: date/package field alignment)

- 🧩 Task: Restore missing desktop medication-form detail where date fields and package/form fields should be vertically paired.
- ✅ Decisions:
	- Confirmed secondary worktree had no frontend form edits; relevant data-loss signal was not from that worktree.
	- Searched stash inventory and validated missing detail should be restored directly on `main`.
	- Reordered `MedicationsPage` general-tab field sequence so layout pairs are stable in the two-column grid:
		- left column: `Medication Start Date` then `Medication End Date`
		- right column: `Package Type` then `Pill Form`/`Medication Form`
	- Kept labels/i18n keys and behavior unchanged; this is layout-order only.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If desired, mirror identical visual grouping hints in mobile form (functional order is already consistent there).

### 2026-03-02 (PR #364 CI triage: frontend build + Playwright stable)

- 🧩 Task: Diagnose and fix failing checks on `fix/frontend-tube-liquid-semantics-parity` for `Test/Frontend Build` and `E2E Tests/Playwright E2E Stable`.
- ✅ Decisions:
	- Pulled CI logs with `gh` and reproduced both failures locally before editing.
	- Fixed unit failure by switching `AppContext.test.tsx` schedule mock to a partial mock via `vi.importActual`, preserving `getStockStatus` export.
	- Updated stale stock-status fixture in the same test (`daysLeft: 8`) to reflect current critical-threshold semantics (`criticalStockDays` derives from `reminderDaysBefore`).
	- Fixed Playwright stable failure by replacing brittle `.table.table-7` selector with resilient `.dashboard-overview-section .table` in `e2e/schedule.spec.ts`.
	- Kept scope strictly frontend parity/check stabilization; no backend or feature behavior changes.
- 📁 Files touched:
	- `frontend/src/test/context/AppContext.test.tsx`
	- `frontend/e2e/schedule.spec.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Push/PR shipping steps must be handled by `@release-manager` per AGENTS policy.

### 2026-03-01 (backend CI triage: settings test-email delivery semantics)

- 🧩 Task: Reproduce and fix failing `Test / Backend Tests` check on branch `fix/backend-amount-stock-reminder-semantics`.
- ✅ Decisions:
	- Reproduced failure with the exact CI backend test command: `cd backend && CI=true npm run test:coverage`.
	- Root cause: `settings` route now validates SMTP delivery metadata (`accepted` recipients), but `routes-real.test.ts` still mocked `sendMail` as `undefined`, forcing the 500 error path.
	- Applied minimal, scope-safe fix in test only by mocking a realistic successful `sendMail` result with `accepted`/`rejected`/`response` fields.
	- Revalidated full backend CI gates locally (`lint`, `tsc --noEmit`, `test:coverage`) as passing.
- 📁 Files touched:
	- `backend/src/test/routes-real.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (frontend lint cleanup: nested ternaries, unused vars/imports, formatting)

- 🧩 Task: Make root lint fully clean for current working tree by fixing frontend `noNestedTernary`, unused variable/import findings, and formatter errors.
- ✅ Decisions:
	- Replaced nested ternaries with explicit `if/else` or small helper functions in `MedicationsPage`, `ReportModal`, `useMedicationForm`, and `useRefill`.
	- Removed unused symbols (`isTube`, `getIntakeUnitLabel`, unused schedule util param, unused test import).
	- Applied Biome formatting to lint-failing frontend files to clear formatter diagnostics without behavior changes.
	- Verified with root `npm run lint` until fully clean.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/hooks/useRefill.ts`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `frontend/src/test/utils/schedule.test.ts`
	- `frontend/src/utils/schedule.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (gate-fix: planner/settings lint + planner targeted tests)

- 🧩 Task: Fix requested local gate failures in backend planner/settings routes and planner targeted tests, then rerun verification commands.
- ✅ Decisions:
	- Kept implementation semantics in `planner.ts` (SMTP delivery requires accepted recipients) and aligned planner tests to this intended behavior.
	- Fixed Biome formatting-only failures in `backend/src/routes/planner.ts` and `backend/src/routes/settings.ts`.
	- Updated planner test success mocks to include SMTP acceptance metadata so email paths no longer return 500 in success scenarios.
	- Re-ran requested verification commands exactly.
- 📁 Files touched:
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/settings.ts`
	- `backend/src/test/planner.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Root `npm run lint` still fails due existing frontend lint findings unrelated to this backend gate-fix scope.

### 2026-03-01 (validation: pre-PR local quality gate for current uncommitted changes)

- 🧩 Task: Execute requested local gate checks (lint + specific backend/frontend tests) and report PASS/FAIL without source changes.
- ✅ Decisions:
	- Ran root lint (`npm run lint`), which already includes backend and frontend lint commands.
	- Ran only the explicitly requested backend tests and frontend tests in CI mode (`CI=true`) for deterministic non-watch execution.
	- Did not modify product source files; only captured results and recorded them.
	- Gate outcome is FAIL due to backend lint formatting errors and failing assertions in `planner.test.ts`.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Fix backend formatting issues in `backend/src/routes/planner.ts` and `backend/src/routes/settings.ts`.
	- Investigate `backend/src/test/planner.test.ts` failures where email paths now return HTTP 500 or message text differs from expectations.

### 2026-03-01 (ui: flat-text intake rows matching blister reference)

- 🧩 Task: Rewrite intake schedule rows in MedDetailModal to match the exact blister row rendering from MedicationsPage.
- ✅ Decisions:
	- Root cause: previous attempts used a grid layout with separate styled spans (`.med-schedule-item`, `.med-schedule-main`, `.med-schedule-usage`, etc.) which looked fundamentally different from the flat inline text of blister rows.
	- Fix: replaced the entire grid/flex structure with flat inline text + "·" separators inside a simple `.blister-row-simple` div — identical to how MedicationsPage renders blister rows.
	- Removed all now-unused CSS classes: `.med-detail-schedules`, `.med-schedule-item`, `.med-schedule-main`, `.med-schedule-usage`, `.med-schedule-freq`, `.med-schedule-time`, `.med-schedule-person`, `.med-schedule-bell`.
	- Container changed from `.med-detail-schedules` to `.blister-list` (matching MedicationsPage).
	- Updated unit tests to use new selectors (`.blister-list .blister-row-simple`).
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/styles.css`
	- `frontend/src/test/components/MedDetailModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None — visually verified via browser screenshot; rows are pixel-identical to MedicationsPage blister rows.

### 2026-03-01 (ui: force exact blister-row visual reuse in detail schedule)

- 🧩 Task: Resolve user feedback that bottle/tube/liquid intake rows still did not match blister reference quality.
- ✅ Decisions:
	- Reused the exact blister row visual class by adding `blister-row-simple` directly to detail schedule rows.
	- Reduced `med-schedule-item` styles to layout-only (grid + alignment), so visuals are inherited from the shared blister style tokens.
	- Kept shared left-content/right-time structure and adjusted header reminder icon visibility to `selectedMed.intakeRemindersEnabled || hasAnyIntakeReminder`.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/styles.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add visual snapshot regression test for `MedDetailModal` intake rows to detect future style drift immediately.

### 2026-03-01 (ui: strict blister-parity pass for bottle/tube/liquid intake rows)

- 🧩 Task: User requested explicit visual parity with blister reference layout for bottle/tube/liquid in medication detail intake schedule.
- ✅ Decisions:
	- Switched schedule row container to fixed 2-column layout (left content cluster, right time column) for deterministic alignment.
	- Tightened typography/spacing and row radius to match blister reference feel more closely.
	- Standardized bell rendering in each row and section-header bell visibility based on actual intake reminder presence.
	- Kept all behavior/data logic unchanged except reminder-header visibility correctness.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/styles.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add visual regression snapshot for `MedDetailModal` intake rows to prevent style drift.

### 2026-03-01 (ui: intake row structure parity for tube/liquid)

- 🧩 Task: Ensure tube and liquid intake rows in `Medication Details` are visibly formatted like blister rows, not only color-polished.
- ✅ Decisions:
	- Restructured intake row markup in `MedDetailModal` to a two-part layout:
		- left grouped content (`usage`, `frequency`, optional person/bell tags),
		- right aligned time block.
	- Added `.med-schedule-main` and updated `.med-schedule-item` spacing/alignment + mobile stacking behavior for reliable cross-size rendering.
	- Performed live browser verification for both `Liquid Mix E2E` and `Tube E2E`; both now show the same row structure pattern.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/styles.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: mirror this exact two-part intake-row structure in other schedule list components for full global visual parity.

### 2026-03-01 (ui: MedDetail intake rows aligned with blister style)

- 🧩 Task: Make intake rows in medication details visually match the existing blister-row quality.
- ✅ Decisions:
	- Updated `MedDetailModal` intake row styling (`.med-schedule-item`) to mirror blister-row language:
		- gradient background,
		- subtle border + accent left edge,
		- matching hover highlight.
	- Kept functionality unchanged (presentation-only change).
	- Improved time label contrast for readability.
- 📁 Files touched:
	- `frontend/src/styles.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: apply same style language to other schedule list surfaces for complete parity.

### 2026-03-01 (validation: broader tube/liquid_container regression sweep)

- 🧩 Task: Run broader regression validation after latest fixes focused on tube/liquid_container flows (mobile edit, detail stock wording, dashboard labels, schedule usage labels).
- ✅ Decisions:
	- Executed focused frontend unit/integration suites for MobileEditModal, MedDetailModal, DashboardPage, SchedulePage, schedule utils, type helpers, and medication-form hook.
	- Executed targeted Playwright browser runs (`chromium`, `workers=1`) for medication-edit and dashboard specs as quick browser-level signal.
	- All executed tests passed; no runtime duplicate-key warning surfaced in test output.
	- Identified residual risk as test-coverage gaps: no explicit tube/liquid_container assertions in current DashboardPage/SchedulePage page-test suites.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Add explicit page-level tests for tube/liquid labels in dashboard overview and schedule rows.
	- Add a dedicated MedDetailModal test for amount wording in Correct Stock for tube/liquid packages.
	- Optional: add explicit console-warning guard around duplicate-key behavior for intake rows.

### 2026-03-01 (fix: implement remaining E2E findings for tube/liquid)

- 🧩 Task: Implement the two remaining E2E bugfixes and close the related test drift.
- ✅ Decisions:
	- Fixed duplicate intake keys in `MobileEditModal` by making keys unique with an index suffix.
	- Fixed tube/liquid Correct Stock input label in `MedDetailModal` to amount wording (`form.currentAmount`) for amount packages.
	- Updated stale test expectation in `MobileEditModal.test.tsx` from `form.packageAmount` to `form.packageAmountPerBottle`.
	- Revalidated with focused component tests (via `@testing-manager`): `120 passed, 0 failed`.
- 📁 Files touched:
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add explicit regression assertions for duplicate-key absence and tube-label wording in tests.

### 2026-03-01 (validation: focused component tests after latest fixes)

- 🧩 Task: Run focused frontend component tests for `MobileEditModal` and `MedDetailModal` after latest fixes.
- ✅ Decisions:
	- Executed focused tests with test runner tooling per file.
	- Results: `MobileEditModal.test.tsx` passed (`59`), `MedDetailModal.test.tsx` passed (`61`), combined `120` passed / `0` failed.
	- Regression checkpoints requested by user show no remaining failing tests in this focused scope:
		- duplicate intake key regression risk: no failures
		- tube correct-stock label wording: no failures
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Focused run is clean; broader suite was not executed in this step.

### 2026-03-01 (validation: MobileEditModal duplicate keys + Correct Stock tube wording)

- 🧩 Task: Validate latest frontend fixes for duplicate React keys in mobile liquid intakes and amount-based wording in Correct Stock for tube/liquid packages.
- ✅ Decisions:
	- Performed focused static verification in changed paths:
		- `MobileEditModal` intake row key now includes `idx` suffix to avoid duplicate key collisions when intake values are identical.
		- `MedDetailModal` Correct Stock amount-package field label uses `form.currentAmount` (tube/liquid) instead of `editStock.totalPills`.
	- Ran focused frontend tests: `CI=true npm run test:run -- src/test/components/MobileEditModal.test.tsx src/test/components/MedDetailModal.test.tsx`.
	- Result: `MedDetailModal` suite passed; `MobileEditModal` suite had one failing assertion expecting old liquid label key `form.packageAmount`.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Add/adjust targeted tests for tube/liquid Correct Stock wording and key-regression behavior to avoid future drift.
	- Investigate/update outdated `MobileEditModal` liquid package-amount label test expectation.

### 2026-03-01 (feat: dashboard medication overview daily consumption column)

- 🧩 Task: Add a new column after stock showing daily consumption for pills and liquids.
- ✅ Decisions:
	- Added `Daily consumption` column to dashboard overview table directly after `Stock`.
	- Implemented per-medication daily consumption calculation from intake schedule (`usage / every`) with person multiplier for non-per-intake assignments.
	- Liquid consumption is normalized to `ml/day` (converts `tsp`/`tbsp` to ml).
	- Tube shows unit-aware per-day values (`applications/day` or `ml/day` for liquid-form tube).
	- Updated display formatting to remove explicit `/day` suffix because the column title already communicates time scope.
	- Added new i18n keys in EN/DE for column header and per-day unit formatting.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/styles.css`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add focused unit test for daily-consumption edge cases (mixed units + multi-person).

### 2026-03-01 (validation: focused tube + liquid_container E2E sweep)

- 🧩 Task: Run focused end-to-end validation for tube and liquid_container behavior across CRUD, dashboard, detail modal, correction modal, and schedule areas.
- ✅ Decisions:
	- Performed manual browser validation on `http://localhost:5173` with dedicated test meds (`Tube E2E`, `Liquid Mix E2E`).
	- Confirmed key expected behaviors:
		- Liquid mixed intake units (`ml`, `tsp`, `tbsp`) persist on edit and render correctly in schedule/detail surfaces.
		- Nested Escape behavior is correct: first Escape closes correction sub-modal only, second Escape closes parent detail modal.
		- Liquid correction bottle count is editable and syncs amount field/capacity correctly.
	- Found regressions:
		- Tube correction modal still labels amount input as `Total pills` (wording drift).
		- React duplicate-key errors occur when adding multiple intake rows with identical defaults (console spam, potential row identity issues).
	- Added focused automated confirmation: Playwright `medication-edit.spec.ts` under `chromium-data` project passed (11/11).
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Fix tube correction input label in `MedDetailModal` to amount-based wording.
	- Replace fragile intake row key strategy (currently value-derived) with stable per-row ids.
	- Add regression test for nested modal Escape behavior and mixed-intake key stability.

### 2026-03-01 (fix: liquid correction container count + nested Escape behavior)

- 🧩 Task: User reported two regressions in stock correction: liquid container count not editable and Escape in correction also closing parent detail modal.
- ✅ Decisions:
	- Restored editable liquid container count (`form.bottles`) in correction modal and synced amount field from `bottles * amountPerBottle`.
	- Kept direct amount correction field, but capped it by current bottle-derived capacity.
	- Updated nested Escape handling to capture phase for correction/refill sub-modals so Escape is consumed by topmost modal.
	- Changed correction modal keydown propagation handling to stop bubbling for all keys to avoid parent modal Escape side effects.
	- During live validation, also fixed residual copy regression in correction header (`Package size: ... pills` -> amount-based `Total Amount: ... ml/g` for tube/liquid).
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Validate live behavior in browser: Escape in correction closes only correction and keeps med detail open.

### 2026-03-01 (fix: intake schedule unit label in MedDetailModal)

- 🧩 Task: User reported liquid intake schedule showing `ml` although configured unit was `tbsp`.
- ✅ Decisions:
	- Updated `MedDetailModal` schedule usage label helper to respect `intakeUnit` for liquid intakes.
	- Liquid schedule rows now render `teaspoons`/`tablespoons` for `tsp`/`tbsp`, and `ml` only for ml/default unit.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: mirror identical display style in any remaining legacy schedule blocks if encountered.

### 2026-03-01 (fix: SchedulePage liquid/tube labels aligned with amount semantics)

- 🧩 Task: User requested full frontend wording regression cleanup after liquid meds still showed pill text in schedule rows.
- ✅ Decisions:
	- Added package-type-aware usage/total format helpers in `SchedulePage` (liquid/tube vs pill packages).
	- Replaced hardcoded `pill/pills` and `pillsTotal` render paths in both past and future schedule blocks.
	- Liquid rows now show ml/tsp/tbsp-aware output; tube rows show ml or application labels based on medication form.
- 📁 Files touched:
	- `frontend/src/pages/SchedulePage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Continue cross-view scan for any remaining hardcoded pill wording in package-type-specific contexts.

### 2026-03-01 (fix: MedDetailModal liquid/tube amount semantics restored)

- 🧩 Task: User reported MedDetailModal regression where `liquid_container` showed pill wording again (for example `Pills 150 / 150`).
- ✅ Decisions:
	- Restored amount-package rendering in `MedDetailModal` for `liquid_container`/`tube`.
	- Current stock label now uses `form.currentAmount` for amount packages and appends unit (`ml`/`g`).
	- Package details for amount packages now show package count + amount-per-package + total amount with unit.
	- Kept blister/bottle rendering unchanged.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If any other page still shows pill wording for `liquid_container`, apply the same amount-package pattern there.

### 2026-03-01 (fix: prevent false-positive email success on SMTP recipient rejection)

- 🧩 Task: User reported reminder mails not arriving although manual send path returned success.
- ✅ Decisions:
	- Confirmed runtime log visibility issue: `.env` had `LOG_LEVEL=warn`, which hides newly added `info` diagnostics.
	- Confirmed `/api/reminder/send-email` returned `200` in live repro.
	- Hardened email success criteria in reminder-related paths: treat nodemailer send as failed when SMTP reports no accepted recipients (even if `sendMail` resolves).
	- Applied same recipient-acceptance check to scheduler stock/prescription mail paths and `/settings/test-email`.
- 📁 Files touched:
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/routes/settings.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If detailed send traces are needed in container logs, temporarily set `LOG_LEVEL=info` and restart backend-dev.

### 2026-03-01 (ui: remove unnecessary scroll on empty medications page)

- 🧩 Task: User reported vertical page scrolling although medications list was empty.
- ✅ Decisions:
	- Replaced empty medication-grid rendering with a compact `med-empty-state` message.
	- Added i18n key `medications.list.emptyState` in EN/DE.
	- Reduced global `.page` bottom padding (`3rem -> 1.5rem`, mobile `2rem -> 1rem`) to avoid extra empty vertical overflow on sparse pages.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/styles.css`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If users still see a small scrollbar in specific viewport sizes, inspect per-route vertical spacing and header/card margins with live viewport metrics.

### 2026-03-01 (debug: add observability logs for email send paths)

- 🧩 Task: User reported manual email send does not arrive and no backend logs were visible.
- ✅ Decisions:
	- Added structured logs in manual email routes for request start, channel state, SMTP readiness, send attempt, success (`messageId`), and failure.
	- Added same logging for `/settings/test-email`.
	- Added `maskEmail(...)` helper in route files so logs do not expose full recipient addresses.
	- Kept behavior intact (diagnostic logging only, no credential logging).
- 📁 Files touched:
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/settings.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Verify logs in backend container while triggering manual send from UI and confirm whether failure is SMTP config, route usage, or transport error.

### 2026-03-01 (UI hints & deployment prep: tube/liquid package-type explanations)

- 🧩 Task: Add user-facing UI hints explaining tube/liquid package-type semantics; finalize deployment docs.
- ✅ Decisions:
	- Added i18n keys (EN + DE):
		- `settings.stock.packageTypesNote`: Explains tube exclusion + liquid single-baseline model
		- Enhanced `settings.stockReminder.infoTooltip`: Mentions tube/liquid semantics
		- `modal.packageTypeHint`: For med-detail tooltip explaining package types
	- SettingsPage: Added hint paragraph below stock threshold section displaying packageTypesNote
	- MedDetailModal: Added info icon (ℹ️) + tooltip on "Package Details" heading, only shown for tube/liquid types
	- Updated report.md with completion entry + release notes draft
- 📁 Files touched:
	- `frontend/src/i18n/en.json` (3 keys added/updated)
	- `frontend/src/i18n/de.json` (3 keys added/updated)
	- `frontend/src/pages/SettingsPage.tsx` (added hint note + fixed indentation after earlier replacements)
	- `frontend/src/components/MedDetailModal.tsx` (added tooltip icon + condition)
	- `doku/report.md`
	- `doku/memory_notes.md`
- ✅ Validation:
	- All touched files pass linter diagnostics (0 errors)
	- i18n JSON syntax valid (both EN + DE)
	- Translation keys correctly placed and referenced
- 🚀 Deployment readiness:
	- Feature complete: backend logic + frontend hints + test coverage
	- CI/CD pipeline should pass full suite
	- Ready for staging → user release with release notes explaining new semantics
- 🔜 Follow-up/open points:
	- None for this feature; ready for deployment

### 2026-03-01 (tests: focused coverage for package-type stock reminder semantics)

- 🧩 Task: Add focused test cases for tube/liquid package-type stock reminder behavior.
- ✅ Decisions:
	- Added 1 backend test in `planner.test.ts`: `/reminder/send-email` with tube-only meds → expect 400 "No active medications to notify"
	- Added 4 backend tests in `stock-semantics-parity.test.ts`: `getLiquidReminderThresholds` suite testing formula derivation (baseline, critical, boundary cases).
	- Added 5 frontend tests in `schedule.test.ts`: `getStockStatus` package-type branches:
		- Tube returns "normal" (no thresholds) except when empty.
		- Liquid applies derived thresholds (low=baseline, critical=ceil(baseline/2)).
		- Liquid boundary edge case (criticalStockDays=1).
	- Fixed syntax error in frontend test file (orphaned stray code).
	- All tests pass: backend 30/30 planner, 10/10 stock-semantics, frontend 82/82 schedule.
- 📁 Files touched:
	- `backend/src/test/planner.test.ts`
	- `backend/src/test/stock-semantics-parity.test.ts`
	- `frontend/src/test/utils/schedule.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None; test coverage gaps closed for core package-type semantics (tube exclusion, liquid derivation).

### 2026-03-01 (validation: package-type stock reminder behavior)

- 🧩 Task: Validate tube/liquid reminder behavior changes across backend and frontend.
- ✅ Decisions:
	- Ran focused backend suites: `planner.test.ts` + `stock-semantics-parity.test.ts` (pass).
	- Ran focused frontend suites: `schedule.test.ts`, `DashboardPage.test.tsx`, `SchedulePage.test.tsx`, `SharedScheduleTodayOnly.test.tsx`.
	- Fixed two failing dashboard helper tests caused by updated `getReminderStatusData` signature (added missing `meds` argument).
	- Re-ran frontend focused suites after fix (all pass).
	- Confirmed by code inspection that:
		- scheduler excludes `packageType=tube`
		- `/reminder/send-email` filters out tube meds from payload
		- liquid thresholds derive from `reminderDaysBefore` (`low=floor`, `critical=ceil(low/2)`).
- ⚠️ Gaps found:
	- No explicit backend test for `/reminder/send-email` tube payload rejection path.
	- No explicit backend test for liquid threshold derivation (critical vs low split from baseline).
	- Frontend `getStockStatus` tests do not yet assert tube/liquid package-type branches.
- 📁 Files touched:
	- `frontend/src/test/pages/DashboardPage.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Add targeted regression tests for tube exclusion and liquid-derived thresholds in backend + frontend utility layers.

### 2026-03-01 (feat: stock reminders updated for tube + liquid package semantics)

- 🧩 Task: Implement new stock-reminder behavior for package types (`tube` off, `liquid_container` single-threshold model).
- ✅ Decisions:
	- Added explicit hard skip for `tube` in backend auto-reminder candidate selection.
	- Added explicit `tube` filter in manual reminder send route (`/reminder/send-email`) so tube cannot be notified via payload manipulation.
	- Implemented liquid reminder model with exactly one baseline threshold (days):
		- baseline = existing `reminderDaysBefore` (default 7)
		- `critical` = `ceil(baseline/2)`
		- `low` = `baseline`
	- Kept non-liquid threshold behavior unchanged.
	- Updated frontend status logic and package-type-aware calls (Dashboard, Shared, Schedule, MedDetail, UserFilter, AppContext day status, reminder summary helper) to match backend semantics.
- 📁 Files touched:
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/routes/planner.ts`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/dashboard-helpers.ts`
	- `frontend/src/pages/SchedulePage.tsx`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/UserFilterModal.tsx`
	- `frontend/src/context/AppContext.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add dedicated backend/frontend regression tests for liquid derived thresholds and tube hard-exclusion paths.

### 2026-03-01 (fix: liquid correction total amount auto-syncs with bottle count)

- 🧩 Task: In `Correct Stock`, changing bottle count should immediately update `Total Amount`.
- ✅ Decisions:
	- For `liquid_container`, bottle stepper now always recalculates and overwrites correction total with `bottles * amountPerBottle`.
	- Applied for input typing, blur normalization, and plus/minus step actions.
	- Kept manual editing of total amount possible after bottle change, but bottle changes are now authoritative for immediate sync.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: decide if `Total Amount` should become read-only for liquid correction to avoid conflicting edits.

### 2026-03-01 (fix: liquid correction allows editing bottle count)

- 🧩 Task: In `Correct Stock`, `liquid_container` bottle count was still read-only and could not be corrected.
- ✅ Decisions:
	- Added editable `Bottles` stepper in the correction modal for `liquid_container`.
	- Correction package size (`ml`) now recalculates live from `bottles * amountPerBottle`.
	- Correction save now persists liquid base fields (`packCount`, `totalPills`) plus stock adjustment so both bottle count and current total stay consistent.
	- Backend stock-adjustment route now accepts base-field updates for `liquid_container` (previously tube-only).
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/hooks/useRefill.ts`
	- `backend/src/routes/medications.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add a focused regression test for liquid correction with bottle-count changes.

### 2026-03-01 (ui: liquid correction now shows bottle/container context)

- 🧩 Task: In liquid-container stock correction modal, show bottle-level context instead of only total amount.
- ✅ Decisions:
	- Kept correction input/value model unchanged (total amount remains editable value).
	- Added an extra helper line for `liquid_container` showing `Bottles` and `Amount per bottle` directly in the correction modal.
	- Reused existing i18n keys (`form.bottles`, `form.packageAmountPerBottle`, `form.packageAmountUnitMl`) to avoid introducing duplicate wording keys.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: if product wants, add a dedicated localized sentence key for this bottle breakdown line instead of composed label fragments.

### 2026-03-01 (fix: stock correction persistence for tube + wording parity for liquid/tube)

- 🧩 Task: Tube correction changed visible stock but left old amount values in detail/package data.
- ✅ Decisions:
	- `useRefill.submitStockCorrection` now treats `tube` as base-amount correction:
		- writes `totalPills`, `looseTablets`, `packageAmountValue`, `packCount=1`, `stockAdjustment=0`.
	- Backend `/medications/:id/stock-adjustment` now accepts and persists these optional base fields for `tube`.
	- Correction modal amount wording now applies to both `tube` and `liquid_container` (no pill wording for tube corrections).
	- Liquid correction behavior remains stock-adjustment based (capacity model unchanged).
- 📁 Files touched:
	- `frontend/src/hooks/useRefill.ts`
	- `backend/src/routes/medications.ts`
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add backend/frontend regression tests for tube correction persistence path.

### 2026-03-01 (ui: capacity label unified for tube/liquid cards)

- 🧩 Task: Rename tube/liquid card label from `Capacity per package` to `Capacity`.
- ✅ Decisions:
	- Reused existing `medications.details.totalCapacity` label for tube/liquid card details.
	- Left value calculation unchanged (still displays package amount value with unit).
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (fix: tube count fixed to read-only 1 in edit forms)

- 🧩 Task: Disallow more than one tube and make tube count read-only.
- ✅ Decisions:
	- Desktop and mobile edit forms now render `Tubes` as read-only value `1` (no stepper).
	- Form logic now enforces `packCount="1"` whenever `packageType=tube`.
	- Save normalization enforces `packCount=1` for tube payloads.
	- Edit normalization for legacy tube records maps `Amount per tube` to the current total amount to avoid accidental stock shrink on save.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: backend route-level hard guard for `tube packCount != 1` if strict server enforcement is desired.

### 2026-03-01 (cleanup: removed redundant tube stock section in detail modal)

- 🧩 Task: Remove redundant `Stock` block from tube medication detail modal.
- ✅ Decisions:
	- Hid full `Stock Info` section when `packageType=tube`.
	- Tube details remain in `Package Details` (tubes, amount per tube, total amount), which now serves as single source of truth.
	- Kept stock section unchanged for non-tube package types.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (fix: MedDetailModal tube details aligned to package-amount model)

- 🧩 Task: Replace tube detail modal pill/application stock semantics with package amount semantics.
- ✅ Decisions:
	- `tube` package details now mirror liquid structure:
		- number of tubes
		- amount per tube (`g`)
		- total amount (`g`)
	- Tube stock info row now renders single-value stock (`X g`) and no `X / Y` ratio.
	- Tube intake schedule keeps application wording and is decoupled from stock unit labels.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: align any remaining tube read-only surfaces to `g` package semantics if still showing legacy wording.

### 2026-03-01 (fix: hide "No Schedule" badges for tube)

- 🧩 Task: Remove confusing `No Schedule` stock status badges for `tube` medications.
- ✅ Decisions:
	- Added UI-level filtering for `status.noSchedule` when package type is `tube`.
	- Applied in dashboard overview/schedule chips, shared schedule chips, and schedule page chips.
	- Kept other status labels unchanged for non-tube package types.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: introduce a dedicated non-chip hint for tube stock semantics if product wants explicit explanation.

### 2026-03-01 (fix: tube card stock format without denominator)

- 🧩 Task: Change tube card stock display from `X / Y g` to single-value `X g`.
- ✅ Decisions:
	- In medication cards, `packageType=tube` now renders stock as a single amount value with unit.
	- Kept denominator-based stock display for other package types.
	- Disabled over-capacity warning icon for tube card stock line because no denominator is shown.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: apply same single-value stock pattern for tube in any other remaining read views if desired.

### 2026-03-01 (fix: tube stock no longer auto-consumed)

- 🧩 Task: Ensure `tube` stock stays fixed and is not reduced by scheduled applications.
- ✅ Decisions:
	- Updated stock usage normalization so `packageType=tube` always returns `0` consumption.
	- Kept liquid conversion logic only for `liquid_container` (`tsp/tbsp` -> `ml`).
	- Applied parity in frontend coverage, shared schedule coverage, and backend stock-based scheduler/planner paths.
- 📁 Files touched:
	- `backend/src/utils/scheduler-utils.ts`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/components/SharedSchedule.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add regression tests that assert tube coverage remains constant over time.

### 2026-03-01 (fix: shared schedule liquid-container parity)

- 🧩 Task: Bring `SharedSchedule` in line with dashboard/detail behavior for `liquid_container`.
- ✅ Decisions:
	- Added intake-unit-aware dose and total labels in shared timeline (`ml/tsp/tbsp` with converted `ml` context where needed).
	- Extended shared schedule dose model to carry `intakeUnit` through rendering.
	- Updated shared stock coverage math to convert liquid usage (`tsp/tbsp` -> `ml`) before daily-rate and consumed calculations.
	- Kept i18n key usage aligned with existing dashboard keys; no new translation keys required.
- 📁 Files touched:
	- `frontend/src/components/SharedSchedule.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add focused regression test for shared liquid labels and coverage computation.

### 2026-03-01 (hotfix: Vite/esbuild parse error in useEscapeKey)

- 🧩 Task: Fix frontend startup failure caused by malformed comment in `useEscapeKey.ts`.
- ✅ Decisions:
	- Corrected broken comment line to valid `//` syntax.
	- No logic change; this is a parser/build hotfix only.
- 📁 Files touched:
	- `frontend/src/hooks/useEscapeKey.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (fix: Escape closed nested + parent modal)

- 🧩 Task: Pressing `Escape` in stock-correction sub-modal closed all modals instead of only the sub-modal.
- ✅ Decisions:
	- Root cause: Escape was handled twice (nested modal hook + global App escape handler), causing duplicate close/back behavior.
	- Updated `useEscapeKey` capture mode to consume Escape (`preventDefault` + `stopPropagation`).
	- Enabled capture mode for nested sub-modals in `MedDetailModal` (`showEditStockModal`, `showRefillModal`).
	- Global App Escape handler now exits early for already-consumed events (`e.defaultPrevented`).
- 📁 Files touched:
	- `frontend/src/hooks/useEscapeKey.ts`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/App.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add focused UI test for nested modal Escape behavior regression.

### 2026-03-01 (fix: stock correction initial value for liquid container)

- 🧩 Task: `Correct Stock` modal opened with `0` instead of current amount for `liquid_container`.
- ✅ Decisions:
	- Root cause: `useRefill.openEditStockModal` and `submitStockCorrection` treated only `bottle` as amount package; `tube/liquid_container` fell into blister logic.
	- Added unified `isAmountPackage` handling (`bottle|tube|liquid_container`) in both open and submit paths.
	- Result: correction input now pre-fills with current stock amount for liquid container and uses consistent amount-package correction math.
- 📁 Files touched:
	- `frontend/src/hooks/useRefill.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add regression tests for `openEditStockModal` defaults on amount package types.

### 2026-03-01 (fix: stock correction modal wording for liquid container)

- 🧩 Task: Remove pill-based wording in `Correct Stock` modal for `liquid_container`.
- ✅ Decisions:
	- Correction input label now uses amount wording (`Total amount`) for liquid containers.
	- Package-size and max-exceeded info in correction modal now render with amount unit (`ml`) instead of `pills`.
	- Added dedicated i18n keys for amount-based package-size and cap-warning texts in EN/DE.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: align refill modal wording for liquid container (`Pills to add`) in a follow-up pass.

### 2026-03-01 (fix: MedDetailModal liquid container semantics)

- 🧩 Task: Correct liquid container medication detail modal where pill-based labels/values were shown.
- ✅ Decisions:
	- `Current Stock` row now uses amount semantics for `liquid_container` (`Current Amount`, values with `ml`).
	- Package details now show liquid-specific fields:
		- `Bottles`
		- `Amount per bottle` (`ml`)
		- `Total amount` (`ml`)
	- Intake schedule rows for liquid now format usage via intake unit conversion (`tsp`/`tbsp` -> total `ml`) instead of pill-style text.
	- Pill weight display is hidden for amount package types in this modal.
- 📁 Files touched:
	- `frontend/src/components/MedDetailModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: align refill modal input label wording for liquid container (`Pills to add` -> amount wording).

### 2026-03-01 (fix: missing i18n keys caused raw key text in dashboard)

- 🧩 Task: Resolve raw key output (`form.blisters.teaspoons`, `form.blisters.tablespoons`) in schedule rows.
- ✅ Decisions:
	- Root cause was missing translation keys in `en.json` and `de.json`.
	- Added plural-aware keys for `teaspoons` and `tablespoons` in both locales.
	- Kept dashboard rendering logic unchanged; only i18n completeness was missing.
- 📁 Files touched:
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (rollback: remove `intakes` wording in dashboard)

- 🧩 Task: User requested reverting the recent `X intakes` wording.
- ✅ Decisions:
	- Reverted dashboard liquid check-off labels from `X intakes` back to unit-based liquid labels.
	- Restored display path that uses intake unit (`ml/tsp/tbsp`) with converted `ml` total for liquid doses.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (dashboard liquid check-off: neutral intake count)

- 🧩 Task: Remove confusing spoon/ml text (`47 tablespoons`, `(5 ml)`) in schedule check-off area.
- ✅ Decisions:
	- For `liquid_container` in dashboard schedule/check-off cards, usage labels now show only intake count:
		- `2 intakes`, `47 intakes` (EN)
		- `2 Einnahmen`, `47 Einnahmen` (DE)
	- Removed `(x ml)` annotation from this specific area.
	- Added dedicated plural i18n key `form.blisters.intakes` (`_one/_other`) in EN/DE.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (dashboard liquid labels: plural + total ml, no parentheses)

- 🧩 Task: Fix intake checkbox area label format from `2 Teaspoon (5 ml)` to pluralized + total-ml form.
- ✅ Decisions:
	- Dashboard liquid dose labels now render as:
		- `2 teaspoons 10 ml`
		- `2 tablespoons 30 ml`
	- Removed per-unit parenthesis format in this view.
	- Added plural-aware i18n keys for teaspoon/tablespoon in EN/DE.
	- Daily total badge for liquid meds now derives from actual dose rows and shows converted total ml (mixed units fallback to ml total only).
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (hardening: intakeUnit hydration from intakesJson)

- 🧩 Task: Fix remaining case where UI still showed `ml` after saving `tbsp`/`tsp`.
- ✅ Decisions:
	- Verified DB persistence is correct (`intakes_json` stores `intakeUnit: "tbsp"`).
	- Added defensive hydration in `backend/src/routes/medications.ts`:
		- Parse `intakeUnit` directly from raw `intakesJson`.
		- Overlay parsed units onto route intakes by index.
	- Applied this helper on GET `/medications`, old-intake migration path in PUT, and planner payload path using same intake parse source.
	- Restarted `backend-dev` container to ensure route changes are active.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If issue persists, next diagnostic step is capturing live `/api/medications?includeObsolete=true` response for the edited medication ID.

### 2026-03-01 (fix: intake unit persistence + dashboard unit rendering)

- 🧩 Task: Fix `tbsp`/`tsp` not surviving save+reload and remove forced `ml` rendering in upcoming schedules.
- ✅ Decisions:
	- Root cause was backend read-path loss: `parseIntakesJson` dropped `intakeUnit` even though save-path persisted it.
	- Added strict intake-unit parsing (`ml|tsp|tbsp`) and preserved `intakeUnit` in parsed intakes.
	- Frontend schedule event pipeline now carries `intakeUnit` through `buildSchedulePreview -> AppContext DoseInfo -> Dashboard`.
	- Dashboard liquid usage labels now use per-dose intake unit (`ml`/`tsp`/`tbsp`) instead of always `ml`.
- 📁 Files touched:
	- `backend/src/utils/scheduler-utils.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/context/AppContext.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If mixed intake units are configured for a single liquid medication day, total badge currently reflects the first intake unit label.

### 2026-03-01 (card details: bottle count added)

- 🧩 Task: Add bottle count to `Pill Bottle` medication cards.
- ✅ Decisions:
	- Added dedicated `packageType === bottle` card detail branch.
	- Bottle cards now show:
		- `Bottles: <packCount>`
		- `Capacity: <totalPills|looseTablets>`
	- Existing stock line remains unchanged.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add bottle count to additional read-only views for parity.

### 2026-03-01 (hotfix: MobileEditModal runtime crash)

- 🧩 Task: Fix `Uncaught ReferenceError: useCallback is not defined` in mobile edit modal.
- ✅ Decisions:
	- Added missing React hook import (`useCallback`) in `MobileEditModal` after introducing dynamic usage label callback.
	- Verified diagnostics for touched file are clean.
- 📁 Files touched:
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-03-01 (liquid intake unit conversion + dynamic usage labels)

- 🧩 Task: Make `intakeUnit` affect stock math (`ml/tsp/tbsp`) and update usage labels accordingly.
- ✅ Decisions:
	- Implemented stock conversion rules for liquid dosing:
		- `ml` -> `usage`
		- `tsp` -> `usage * 5`
		- `tbsp` -> `usage * 15`
	- Conversion is applied in backend and frontend coverage/consumption paths to keep behavior consistent.
	- Desktop and mobile schedule forms now show dynamic usage labels for liquid container rows:
		- `Usage (ml)` / `Usage (tsp)` / `Usage (tbsp)`.
	- Added EN/DE i18n keys for `usageTsp` and `usageTbsp`.
- 📁 Files touched:
	- `backend/src/utils/scheduler-utils.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: expose intake unit in read-only schedule lines/cards (currently this change focused on form labels + stock math).

### 2026-03-01 (card details: package count for tube/liquid)

- 🧩 Task: Show package count in medication cards for `tube` and `liquid_container`.
- ✅ Decisions:
	- Added package-count line to amount-package card details.
	- Label is type-specific:
		- `tube` -> `form.tubes`
		- `liquid_container` -> `form.bottles`
	- Capacity-per-package line remains unchanged below count.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: add same package-count info to detail modal/report view for parity.

### 2026-03-01 (dashboard tube singular/plural label fix)

- 🧩 Task: Fix singular/plural wording in Upcoming Schedules for `tube` usage labels.
- ✅ Decisions:
	- Dashboard now resolves tube unit labels with count-aware i18n (`form.blisters.applications`, `{ count }`).
	- Added explicit plural forms in EN/DE:
		- `applications_one`
		- `applications_other`
	- Kept liquid units as fixed `ml` labels.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional: apply the same count-aware wording pattern to any other UI surface that still hardcodes plural unit labels.

### 2026-03-01 (dashboard upcoming labels fixed for tube/liquid)

- 🧩 Task: Upcoming schedule rows showed raw i18n keys (`blisters.applications`, `form.ml`) for `tube` and `liquid_container`.
- ✅ Decisions:
	- Replaced wrong key paths in `DashboardPage` label formatters.
	- Correct keys now use nested path under `form.blisters` and existing unit key:
		- `form.blisters.applications`
		- `form.packageAmountUnitMl`
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If similar raw keys appear elsewhere, run a broader key-path audit for legacy references.

### 2026-02-28 (package_types plan: added 1:1 remediation execution order)

- 🧩 Task: Write the full executable remediation order directly into `doku/package_types.md`.
- ✅ Decisions:
	- Added a mandatory file-by-file sequence with explicit `file -> change -> acceptance` structure.
	- Included all previously identified impacted backend, frontend, i18n, test, e2e, and documentation files.
	- Added an execution gate: skipped files require explicit technical rationale, otherwise rollout is incomplete.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the remediation in code in exactly this order and track skipped items with rationale.

### 2026-02-28 (package_types plan made coherent + full impact inventory)

- 🧩 Task: Adjust `doku/package_types.md` so the plan is coherent and explicitly lists all affected code/test/doc areas.
- ✅ Decisions:
	- Fixed top-level contradiction by documenting current container reality as `blister|bottle|tube`.
	- Added a mandatory explicit affected-file inventory across backend routes/services/schema, frontend runtime surfaces, i18n, backend tests, frontend tests, and e2e specs.
	- Kept the no-partial-rollout enforcement and linked it to concrete file groups for execution control.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Implement remediation in code according to the newly enumerated file inventory (starting with planner/schedule wording and corresponding tests).

### 2026-02-28 (package type plan hardening against partial implementation)

- 🧩 Task: Strengthen `doku/package_types.md` so package/form changes cannot be considered done when only partial surfaces are updated.
- ✅ Decisions:
	- Added a mandatory cross-layer implementation coverage section (backend validation, backend logic, desktop+mobile parity, read views, i18n, import/export/share, tests).
	- Added explicit definition of done: all checklist areas must be updated or explicitly marked not impacted with rationale.
	- Grounded follow-up review findings with concrete gap examples still visible in code (notably planner/schedule pill-only wording paths).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute a dedicated cleanup pass for planner/schedule/backend planner notification wording and corresponding tests.

### 2026-02-28 (release-manager doc cleanup: remove app-feature example)

- 🧩 Task: Remove product-feature-specific text from `.github/agents/release-manager.agent.md` and keep it process-focused.
- ✅ Decisions:
	- Replaced concrete app feature example under release notes guidance with a neutral, reusable template using placeholders.
	- Kept release process rules intact; only example content was generalized.
- 📁 Files touched:
	- `.github/agents/release-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optionally align the Breaking Changes heading example with the no-emoji rule in a separate doc cleanup pass.

### 2026-02-27 (dashboard overview tube unit fix)

- 🧩 Task: Fix dashboard medication overview showing `pill` for `tube` medications.
- ✅ Decisions:
	- Replaced pill-based stock label in dashboard overview with tube-aware amount labels.
	- Added local dashboard helpers to render `tube` values as `ml` (liquid) or `applications` (topical).
	- Updated timeline dose/total tags in dashboard day blocks to use tube-aware units and suppress pill-weight mg details for tube.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (date input placeholder casing fix)

- 🧩 Task: Keep `optional` placeholder text lowercase in date inputs instead of inherited uppercase styling.
- ✅ Decisions:
	- Root cause is inherited `text-transform: uppercase` from `.form-grid label`.
	- Applied local override on `.date-input-display` (`text-transform: none`, `letter-spacing: normal`) to preserve calm, readable lowercase placeholder text.
- 📁 Files touched:
	- `frontend/src/styles/schedule-mobile-edit.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (tube wording consistency in report exports)

- 🧩 Task: Complete tube-specific wording consistency in medication report exports (text + print/PDF).
- ✅ Decisions:
	- Added helper functions in `ReportModal` to centralize tube unit/label logic (`ml` vs `applications`).
	- Replaced pill-centric wording with amount-based wording for `tube` in current stock, total capacity label, intake schedule entries, and refill history entries.
	- Hid `Dose per pill` row for `tube` in both text and print report outputs.
- 📁 Files touched:
	- `frontend/src/components/ReportModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Dashboard/Planner wording parity should be rechecked in a dedicated pass if product wants full app-wide amount terminology normalization for tube.

### 2026-02-27 (holistic package-specific UI behavior for tube)

- 🧩 Task: Make package tab behavior fully package-specific so `tube` does not show pill/mg-oriented fields.
- ✅ Decisions:
	- For `tube`, relabeled stock fields from pill terminology to amount terminology.
	- Hid the pill-specific strength field (`Dose per pill`) for `tube` in desktop and mobile package tabs.
	- Adjusted total display text for `tube` to avoid `pill/pills` wording.
	- Added tube-form default unit behavior: `liquid -> ml`, `topical -> units`.
	- Added EN/DE i18n keys for amount-based labels.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend extension: distinguish volume-based depletion for liquid vs application-based depletion for topical in planner/reminder calculations.

### 2026-02-27 (align package_types doc with implemented tube/liquid/topical behavior)

- 🧩 Task: Resolve contradiction between implementation and `doku/package_types.md` technical constraints.
- ✅ Decisions:
	- Updated constraints to reflect actual support for `packageType=blister|bottle|tube`.
	- Documented current UX split:
		- `blister`/`bottle` use `pillForm`.
		- `tube` uses `medicationForm` (`liquid`/`topical`).
	- Removed stale claim that only `blister|bottle` are supported end-to-end.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep docs in lockstep with model/UI changes to avoid product-level confusion.

### 2026-02-27 (restore liquid vs topical distinction for tube)

- 🧩 Task: Reintroduce meaningful liquid/topical distinction after pillForm-first simplification removed explicit tube subform choice.
- ✅ Decisions:
	- Keep `pillForm` as primary for non-tube packages.
	- For `packageType=tube`, show `medicationForm` selector with only `liquid` and `topical` options.
	- Tube intake behavior now respects selected tube subform:
		- `liquid` -> fractional intake allowed, `usageMl` label.
		- `topical` -> integer/application-style intake, `usageApplication` label.
	- Default when switching to tube is now `liquid` unless an existing tube subform already exists.
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If stock math for liquid should be volume-precise vs application-based, add explicit unit/policy handling in backend planner/reminder calculations.

### 2026-02-27 (pillForm-first UX: removed medicationForm selector)

- 🧩 Task: Remove semantically redundant `medicationForm` vs `pillForm` user choice and make `pillForm` the primary user-facing control.
- ✅ Decisions:
	- Removed `medicationForm` selector from desktop and mobile forms.
	- Kept `pillForm` as the user-facing form mechanic for non-tube package types.
	- Kept `packageType` explicit (`blister`, `bottle`, `tube`) and derive `medicationForm` internally on save for backend compatibility.
	- Intake behavior now keys off `packageType`/`pillForm` in UI logic (fraction rule + usage labels).
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If liquid vs topical needs separate user-facing control later, add it only with concrete behavior differences.

### 2026-02-27 (remove non-functional lifecycle selector from UI)

- 🧩 Task: Ensure users only see options with concrete app impact.
- ✅ Decisions:
	- Removed `lifecycleCategory` selector from desktop and mobile medication edit forms because both options currently have no distinct runtime behavior.
	- Kept persistence/internal field compatibility untouched to avoid DB/API churn in the same scope.
	- Documented that lifecycle selector remains hidden until it drives differentiated planner/reminder/stock behavior.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If lifecycle should return as a visible control, implement real behavior differences first and then re-enable UI.

### 2026-02-27 (package type pivot: liquid/topical use tube, not bottle)

- 🧩 Task: Complete cross-layer pivot after user correction that liquid/topical must not use pill-bottle semantics.
- ✅ Decisions:
	- Introduced/propagated dedicated `tube` package type in backend validation/export and frontend domain/UI types.
	- Enforced medication-form mapping: liquid/topical -> `tube`; capsule/tablet keep blister/bottle options.
	- Standardized stock logic so container semantics (`bottle` and `tube`) use direct loose/total capacity handling across planner/dashboard/detail/refill/report/scheduler.
	- Added missing i18n keys for tube labels in form/report contexts (EN/DE).
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/hooks/useRefill.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/utils/stock.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Tests are owned by `@testing-manager`; no test execution was performed in this step.

### 2026-02-27 (rest_api_med_overview plan improved)

- 🧩 Task: Improve `doku/feat/rest_api_med_overview.md` based on review findings.
- ✅ Decisions:
	- Added missing mandatory test workstream (backend, frontend, e2e).
	- Corrected rate-limit implementation target to existing architecture (`share.ts` + plugin in `backend/src/index.ts`).
	- Clarified response contract details: token format validation, `Cache-Control: no-store`, date format (`YYYY-MM-DD`), `shareStockStatus=false` nulling behavior.
	- Clarified image strategy for v1: reuse existing image filename + `/api/images/...` flow (no new share image proxy endpoint in this phase).
	- Updated effort estimate and explicitly recommended PR split due to scope size.
- 📁 Files touched:
	- `doku/feat/rest_api_med_overview.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If strict 500-line PR target must be enforced, execute as 3 linked PRs.

### 2026-02-27 (review of shared overview API plan completeness)

- 🧩 Task: Review `doku/feat/rest_api_med_overview.md` for quality and completeness.
- ✅ Decisions:
	- Plan is directionally good, but not complete for implementation-readiness.
	- Critical gaps identified: missing explicit test workstream, incorrect/unclear target file for rate-limit wiring (`backend/src/app.ts` does not exist), and unresolved image-delivery contract for share overview payload.
	- Confirmed project uses `backend/src/index.ts` for Fastify plugin registration and already has `@fastify/rate-limit` registered globally.
	- Confirmed share tokens are generated via `randomBytes(8).toString("hex")` (16 hex chars), so token-format checklist is consistent with current implementation.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Plan should be revised to include concrete backend/frontend/e2e tests and exact implementation locations before execution.

### 2026-02-27 (auth loading/error screen follows light/dark theme)

- 🧩 Task: Ensure the loading/connection screens shown before main app mount respect the selected theme.
- ✅ Decisions:
	- Implemented theme resolution directly in `App.tsx` for pre-auth screens (`loading`, `authError`, `!authState`).
	- Read `localStorage.theme` and support `light`, `dark`, and `system` (matchMedia fallback).
	- Applied resolved theme via `data-theme` on the auth container so CSS variables immediately match the chosen theme.
- 📁 Files touched:
	- `frontend/src/App.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (testing handoff + auth/registration env dependency clarification)

- 🧩 Task: User requested broad Playwright improvements (auth setup fallback, planner logic assertions, lifecycle integration, retry robustness, performance timeline tests) and asked whether login/registration behavior depends on env flags.
- ✅ Decisions:
	- Applied governance rule from `.github/skills/medassist-testing-handoff/SKILL.md`: test planning/writing/execution must be delegated to `@testing-manager`.
	- Confirmed env dependency chain:
		- Backend source of truth: `getAuthState()` in `backend/src/plugins/auth.ts`.
		- `authEnabled` comes from `AUTH_ENABLED`.
		- `registrationEnabled` is `REGISTRATION_ENABLED || !hasUsers`.
		- `formLoginEnabled` is `needsSetup || (AUTH_ENABLED && FORM_LOGIN_ENABLED)`.
		- OIDC visibility/flow depends on `OIDC_ENABLED` (+ OIDC config vars).
	- Identified why current E2E auth setup can fail in SSO-only mode: `frontend/e2e/auth.setup.ts` assumes `#username/#password` are always present.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Hand off requested Playwright implementation scope to `@testing-manager` with concrete file-level guidance.

### 2026-02-27 (intake reminder fallback removal)

- 🧩 Task: Make intake reminders strictly per-intake and remove medication-level fallback override.
- ✅ Decisions:
	- In `backend/src/services/intake-reminder-scheduler.ts`, removed effective reminder condition `intake.intakeRemindersEnabled || med.intakeRemindersEnabled`.
	- Reminder eligibility is now strictly `intake.intakeRemindersEnabled`.
	- Removed medication-level fallback argument when parsing intakes for reminder checks (`parseIntakesJson(..., false)`).
	- Medication prefilter now checks whether any intake has `intakeRemindersEnabled=true`.
- 📁 Files touched:
	- `backend/src/services/intake-reminder-scheduler.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Legacy medications that relied only on medication-level reminder flag will no longer trigger reminders until intake-level flags are enabled.

### 2026-02-27 (remove legacy `medassist.db` leftovers)

- 🧩 Task: Investigate why `backend/data/medassist.db` and `data/medassist.db` existed and remove old-path remnants.
- ✅ Decisions:
	- Verified runtime DB path is `medassist-ng.db` via `getDbPaths()` in `backend/src/db/db-utils.ts`; no production code references `medassist.db`.
	- Found remaining string references only in `backend/src/test/db-client.test.ts` mocks/assertions.
	- Updated those test references to `medassist-ng.db` and removed legacy files `backend/data/medassist.db` and `data/medassist.db` from disk.
- 📁 Files touched:
	- `backend/src/test/db-client.test.ts`
	- `backend/data/medassist.db` (removed)
	- `data/medassist.db` (removed)
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None; global search shows no remaining `medassist.db` code references.

### 2026-02-28 (stacked branch validation: package amount + liquid units + topical no-depletion)

- 🧩 Task: Validate stacked branch readiness and make tests compatible with new medication/package semantics.
- ✅ Decisions:
	- Confirmed stack order on `feat/topical-no-depletion-planner`: `7ebd253` -> `3954ed2` -> `e689720` -> `f9deb1b`.
	- Fixed backend in-memory test schemas (integration/planner/e2e-routes) to include new medication columns so route tests stop failing with fixture-level `500` errors.
	- Updated focused E2E selectors/assertions for schedule usage labels and planner stock wording after liquid/topical/package updates.
	- Stabilized medication lifecycle E2E edit flow by cleaning per-test medication state and using current edit-form labels.
- 📁 Files touched:
	- `backend/src/test/integration.test.ts`
	- `backend/src/test/planner.test.ts`
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/e2e/medication-edit.spec.ts`
	- `frontend/e2e/medication-lifecycle.spec.ts`
	- `frontend/e2e/planner-data.spec.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Frontend lint still reports 12 pre-existing `noNestedTernary` warnings in `MedicationsPage.tsx` and `ReportModal.tsx` (outside this compatibility-fix scope).

### 2026-02-28 (package amount UX: numeric input only for tube and liquid)

- 🧩 Task: Remove `+/-` steppers for non-tablet package amount fields.
- ✅ Decisions:
	- Replaced `FormNumberStepper` with a plain numeric text input for:
		- `tube` -> `Amount per tube`
		- `liquid_container` -> `Package amount`
	- Kept unit selectors read-only and fixed per domain rule:
		- `tube` unit fixed to `g`
		- `liquid_container` unit fixed to `ml`
	- Added component regression tests in mobile modal suite to validate the new input style and fixed units.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Existing unrelated `noNestedTernary` lint warnings remain in `MedicationsPage.tsx` (pre-existing scope).

### 2026-02-28 (test update: tube grams + liquid ml regression coverage)

- 🧩 Task: Review and update tests for the new package-unit behavior rules.
- ✅ Decisions:
	- Extended existing `useMedicationForm` tests to assert `packageAmountUnit="ml"` for `liquid_container` defaults/locks.
	- Added regression test that `tube` enforces/keeps `packageAmountUnit="g"` even if UI attempts to set `ml`.
	- Added regression test that legacy `tube` records with `packageAmountUnit="ml"` are normalized to `g` during `startEdit`.
	- Refactored touched code paths to satisfy `noNestedTernary` lint in changed files.
- 📁 Files touched:
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend route-level validation for `tube+ml` remains open if full server-side enforcement is desired.

### 2026-02-28 (tube unit correction: no ml for tubes)

- 🧩 Task: Enforce domain rule from user feedback: tubes use `g`, not `ml`.
- ✅ Decisions:
	- Removed `ml` choice from tube amount input in desktop and mobile edit forms (unit is fixed to `g`).
	- Added hard normalization so tube edit state and save payload always persist `packageAmountUnit="g"`.
	- Added payload guard so `liquid_container` is normalized to `packageAmountUnit="ml"`.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend validation hardening can be added later to reject historic `tube+ml` payloads server-side.

### 2026-02-28 (tube package UX simplification: 1 tube x 150 g)

- 🧩 Task: Make `tube` package fields intuitive and remove conflicting stock inputs.
- ✅ Decisions:
	- Reworked stock UI for `packageType=tube` in desktop and mobile to show only `Tubes` + `Amount per tube` + computed total amount.
	- Removed `total/current amount` steppers for tube to avoid contradictory input combinations.
	- Save payload now normalizes tube values to a consistent amount model (`totalPills` and `looseTablets` derived from `packCount * packageAmountValue`).
	- Added i18n keys for tube-specific labels (`form.tubes`, `form.packageAmountPerTube`) in EN/DE.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If needed, align planner/report wording to explicitly display tube multiplication format (`NxY unit`) everywhere.

### 2026-02-28 (start date optional placeholder consistency)

- 🧩 Task: Make start-date hint consistent with other optional date fields.
- ✅ Decisions:
	- Added `common.optional` placeholder to `Medication Start Date` in desktop and mobile edit forms.
	- Kept validation behavior unchanged (start date remains optional).
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-28 (full implementation: liquid units + topical stock behavior + package amount metadata)

- 🧩 Task: Implement the approved suggestions end-to-end: liquid intake unit conversion, topical non-depleting stock logic, and package amount metadata.
- ✅ Decisions:
	- Added persisted medication metadata fields `packageAmountValue` + `packageAmountUnit` (`ml|g`) in DB schema/migration and API/export/import mappings.
	- Extended intake model with `intakeUnit` (`ml|tsp|tbsp`) and conversion logic (`tsp=5 ml`, `tbsp=15 ml`) for stock calculations.
	- Enforced topical stock behavior as metadata-only depletion path in planner/reminder/frontend coverage calculations (`topical`/`tube` does not reduce stock in V1.1 behavior).
	- Added desktop+mobile parity UI for liquid intake-unit selection and package-amount metadata inputs.
	- Added EN/DE i18n keys for new fields and bumped export format to `1.3`.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/routes/export.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Testing execution remains delegated to `@testing-manager` per governance.

### 2026-02-28 (topical non-measurable vs liquid measurable + tbsp conversion)

- 🧩 Task: Clarify that topical content should not affect stock math while liquid should, and define tablespoon conversion.
- ✅ Decisions:
	- Updated `doku/package_types.md` so `topical` package amount is metadata-only (no depletion effect) in V1/V1.1.
	- Kept `liquid` as measurable stock with canonical `ml` deduction.
	- Added liquid intake conversion rules: `1 tsp = 5 ml`, `1 tbsp = 15 ml`.
	- Locked MedAssist conversion to medical metric convention (`tbsp=15 ml`), excluding regional culinary variants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved for implementation: add intake-unit enum (`ml|tsp|tbsp`) and conversion logic in frontend/backend.

### 2026-02-28 (packaging quantity unit decision for liquids/topicals)

- 🧩 Task: Clarify how package amount should be measured for liquid and topical medications.
- ✅ Decisions:
	- Added explicit recommendation in `doku/package_types.md` to introduce package quantity fields: `packageAmountValue` + `packageAmountUnit` (`ml|g`).
	- Documented default mapping: `liquid_container -> ml`, `tube(topical) -> g`, with manual override to `ml` for topical liquids.
	- Clarified separation between `doseUnit`, `packageAmountUnit`, and `strengthUnit`.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved, implement DB/API/frontend fields and migrations in a dedicated PR.

### 2026-02-28 (liquid_container regression tests implemented)

- 🧩 Task: Convert the checklist handoff into executable regression coverage for `liquid_container` and run targeted validation.
- ✅ Decisions:
	- Added backend real-route regression tests in `e2e-routes.test.ts` for create/share semantics and invalid liquid/package combination rejection.
	- Added frontend hook regression tests in `useMedicationForm.test.ts` for `liquid_container` form derivation (`medicationForm=liquid`, `doseUnit=ml`) and lock behavior.
	- Fixed outdated in-memory test schema in `e2e-routes.test.ts` by adding missing medication columns (`medication_form`, `pill_form`, `lifecycle_category`, `medication_end_date`, `auto_mark_obsolete_after_end_date`) so current route inserts can be tested reliably.
	- Executed only targeted test names to isolate new behavior from unrelated legacy failures in the larger file.
- 📁 Files touched:
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional next step: expand backend package/form matrix coverage beyond these focused regressions.

### 2026-02-28 (testing-manager handoff checklist for liquid_container)

- 🧩 Task: Create a concrete test handoff checklist after user confirmation.
- ✅ Decisions:
	- Added a dedicated `@testing-manager` section to `doku/package_types.md` with backend validation cases, frontend desktop/mobile parity checks, data exchange checks, and E2E minimum scenarios.
	- Kept checklist scoped to the `liquid_container` rollout and package/form invariants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the checklist via `@testing-manager` ownership path.

### 2026-02-28 (liquid_container rollout)

- 🧩 Task: Implement dedicated liquid package type end-to-end (`liquid_container`) after user decision.
- ✅ Decisions:
	- Added `liquid_container` to backend and frontend package type contracts.
	- Enforced compatibility: `liquid -> liquid_container`, `topical -> tube`, `capsule/tablet -> not tube/not liquid_container`.
	- Updated desktop/mobile medication forms with explicit `liquid_container` option and fixed unit/label behavior (`ml`) in planner/schedule/dashboard/detail/report flows.
	- Updated backend planner/reminder/export/refill/share logic to treat `liquid_container` as container stock semantics where applicable.
	- Updated `doku/package_types.md` constraints to reflect new canonical mapping.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Run full regression via `@testing-manager` (ownership rule).

### 2026-02-28 (logic correction: liquid cannot be in tube)

- 🧩 Task: Fix package-type logic after user report that `liquid` in `tube` is invalid.
- ✅ Decisions:
	- Backend validation changed to `topical -> tube` and `liquid != tube`.
	- UI for `packageType=tube` now only allows `topical`; the `liquid` option was removed in desktop and mobile edit flows.
	- Form defaults/derivations for `tube` now force `medicationForm=topical` with `doseUnit=units`.
	- Updated source-of-truth plan wording in `doku/package_types.md` to match corrected logic.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Re-check if a dedicated `liquid` package path should be modeled explicitly in a future master-plan phase.

### 2026-02-28 (package-type hardening pass implemented)

- 🧩 Task: Implement as much of the package-type remediation as possible before the master-plan rollout.
- ✅ Decisions:
	- Hardened backend API validation in `medications.ts` by adding inverse compatibility rule (`capsule/tablet` cannot use `tube`).
	- Updated frontend planner and schedule views to stop pill-only wording for `tube` medications and to render form-aware units.
	- Updated backend planner/reminder notification wording to avoid pill assumptions for `tube` and use form-aware/generic unit terms.
	- Extended backend translation common keys with unit terms required for the updated notification wording.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/i18n/translations.ts`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Test ownership remains with `@testing-manager`; full four-form regression coverage still pending.

### 2026-02-28 (package_types full-plan refresh to current implementation status)

- 🧩 Task: Review the full `doku/package_types.md` and bring it to the latest code-aligned state.
- ✅ Decisions:
	- Added a dated status snapshot (`2026-02-28`) with explicit split between implemented and still-open items.
	- Removed scope ambiguity by changing V1 section into `already implemented` baseline plus `remaining work`.
	- Added explicit note that persisted lifecycle values are currently limited to `refill_when_empty|treatment_period`, while `ongoing` is runtime-derived.
	- Added progress interpretation to the 1:1 remediation section (verify-and-align for completed parts, prioritize known open gaps).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Next implementation focus remains planner/schedule/reminder wording normalization and full four-form regression coverage.

### 2026-02-28 (package_types plan: added 1:1 remediation execution order)

- 🧩 Task: Write the full executable remediation order directly into `doku/package_types.md`.
- ✅ Decisions:
	- Added a mandatory file-by-file sequence with explicit `file -> change -> acceptance` structure.
	- Included all previously identified impacted backend, frontend, i18n, test, e2e, and documentation files.
	- Added an execution gate: skipped files require explicit technical rationale, otherwise rollout is incomplete.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the remediation in code in exactly this order and track skipped items with rationale.

### 2026-02-28 (package_types plan made coherent + full impact inventory)

- 🧩 Task: Adjust `doku/package_types.md` so the plan is coherent and explicitly lists all affected code/test/doc areas.
- ✅ Decisions:
	- Fixed top-level contradiction by documenting current container reality as `blister|bottle|tube`.
	- Added a mandatory explicit affected-file inventory across backend routes/services/schema, frontend runtime surfaces, i18n, backend tests, frontend tests, and e2e specs.
	- Kept the no-partial-rollout enforcement and linked it to concrete file groups for execution control.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Implement remediation in code according to the newly enumerated file inventory (starting with planner/schedule wording and corresponding tests).

### 2026-02-28 (package type plan hardening against partial implementation)

- 🧩 Task: Strengthen `doku/package_types.md` so package/form changes cannot be considered done when only partial surfaces are updated.
- ✅ Decisions:
	- Added a mandatory cross-layer implementation coverage section (backend validation, backend logic, desktop+mobile parity, read views, i18n, import/export/share, tests).
	- Added explicit definition of done: all checklist areas must be updated or explicitly marked not impacted with rationale.
	- Grounded follow-up review findings with concrete gap examples still visible in code (notably planner/schedule pill-only wording paths).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute a dedicated cleanup pass for planner/schedule/backend planner notification wording and corresponding tests.

### 2026-02-28 (release-manager doc cleanup: remove app-feature example)

- 🧩 Task: Remove product-feature-specific text from `.github/agents/release-manager.agent.md` and keep it process-focused.
- ✅ Decisions:
	- Replaced concrete app feature example under release notes guidance with a neutral, reusable template using placeholders.
	- Kept release process rules intact; only example content was generalized.
- 📁 Files touched:
	- `.github/agents/release-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optionally align the Breaking Changes heading example with the no-emoji rule in a separate doc cleanup pass.

### 2026-02-27 (dashboard overview tube unit fix)

- 🧩 Task: Fix dashboard medication overview showing `pill` for `tube` medications.
- ✅ Decisions:
	- Replaced pill-based stock label in dashboard overview with tube-aware amount labels.
	- Added local dashboard helpers to render `tube` values as `ml` (liquid) or `applications` (topical).
	- Updated timeline dose/total tags in dashboard day blocks to use tube-aware units and suppress pill-weight mg details for tube.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (date input placeholder casing fix)

- 🧩 Task: Keep `optional` placeholder text lowercase in date inputs instead of inherited uppercase styling.
- ✅ Decisions:
	- Root cause is inherited `text-transform: uppercase` from `.form-grid label`.
	- Applied local override on `.date-input-display` (`text-transform: none`, `letter-spacing: normal`) to preserve calm, readable lowercase placeholder text.
- 📁 Files touched:
	- `frontend/src/styles/schedule-mobile-edit.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (tube wording consistency in report exports)

- 🧩 Task: Complete tube-specific wording consistency in medication report exports (text + print/PDF).
- ✅ Decisions:
	- Added helper functions in `ReportModal` to centralize tube unit/label logic (`ml` vs `applications`).
	- Replaced pill-centric wording with amount-based wording for `tube` in current stock, total capacity label, intake schedule entries, and refill history entries.
	- Hid `Dose per pill` row for `tube` in both text and print report outputs.
- 📁 Files touched:
	- `frontend/src/components/ReportModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Dashboard/Planner wording parity should be rechecked in a dedicated pass if product wants full app-wide amount terminology normalization for tube.

### 2026-02-27 (holistic package-specific UI behavior for tube)

- 🧩 Task: Make package tab behavior fully package-specific so `tube` does not show pill/mg-oriented fields.
- ✅ Decisions:
	- For `tube`, relabeled stock fields from pill terminology to amount terminology.
	- Hid the pill-specific strength field (`Dose per pill`) for `tube` in desktop and mobile package tabs.
	- Adjusted total display text for `tube` to avoid `pill/pills` wording.
	- Added tube-form default unit behavior: `liquid -> ml`, `topical -> units`.
	- Added EN/DE i18n keys for amount-based labels.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend extension: distinguish volume-based depletion for liquid vs application-based depletion for topical in planner/reminder calculations.

### 2026-02-27 (align package_types doc with implemented tube/liquid/topical behavior)

- 🧩 Task: Resolve contradiction between implementation and `doku/package_types.md` technical constraints.
- ✅ Decisions:
	- Updated constraints to reflect actual support for `packageType=blister|bottle|tube`.
	- Documented current UX split:
		- `blister`/`bottle` use `pillForm`.
		- `tube` uses `medicationForm` (`liquid`/`topical`).
	- Removed stale claim that only `blister|bottle` are supported end-to-end.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep docs in lockstep with model/UI changes to avoid product-level confusion.

### 2026-02-27 (restore liquid vs topical distinction for tube)

- 🧩 Task: Reintroduce meaningful liquid/topical distinction after pillForm-first simplification removed explicit tube subform choice.
- ✅ Decisions:
	- Keep `pillForm` as primary for non-tube packages.
	- For `packageType=tube`, show `medicationForm` selector with only `liquid` and `topical` options.
	- Tube intake behavior now respects selected tube subform:
		- `liquid` -> fractional intake allowed, `usageMl` label.
		- `topical` -> integer/application-style intake, `usageApplication` label.
	- Default when switching to tube is now `liquid` unless an existing tube subform already exists.
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If stock math for liquid should be volume-precise vs application-based, add explicit unit/policy handling in backend planner/reminder calculations.

### 2026-02-27 (pillForm-first UX: removed medicationForm selector)

- 🧩 Task: Remove semantically redundant `medicationForm` vs `pillForm` user choice and make `pillForm` the primary user-facing control.
- ✅ Decisions:
	- Removed `medicationForm` selector from desktop and mobile forms.
	- Kept `pillForm` as the user-facing form mechanic for non-tube package types.
	- Kept `packageType` explicit (`blister`, `bottle`, `tube`) and derive `medicationForm` internally on save for backend compatibility.
	- Intake behavior now keys off `packageType`/`pillForm` in UI logic (fraction rule + usage labels).
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If liquid vs topical needs separate user-facing control later, add it only with concrete behavior differences.

### 2026-02-27 (remove non-functional lifecycle selector from UI)

- 🧩 Task: Ensure users only see options with concrete app impact.
- ✅ Decisions:
	- Removed `lifecycleCategory` selector from desktop and mobile medication edit forms because both options currently have no distinct runtime behavior.
	- Kept persistence/internal field compatibility untouched to avoid DB/API churn in the same scope.
	- Documented that lifecycle selector remains hidden until it drives differentiated planner/reminder/stock behavior.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If lifecycle should return as a visible control, implement real behavior differences first and then re-enable UI.

### 2026-02-27 (package type pivot: liquid/topical use tube, not bottle)

- 🧩 Task: Complete cross-layer pivot after user correction that liquid/topical must not use pill-bottle semantics.
- ✅ Decisions:
	- Introduced/propagated dedicated `tube` package type in backend validation/export and frontend domain/UI types.
	- Enforced medication-form mapping: liquid/topical -> `tube`; capsule/tablet keep blister/bottle options.
	- Standardized stock logic so container semantics (`bottle` and `tube`) use direct loose/total capacity handling across planner/dashboard/detail/refill/report/scheduler.
	- Added missing i18n keys for tube labels in form/report contexts (EN/DE).
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/hooks/useRefill.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/utils/stock.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Tests are owned by `@testing-manager`; no test execution was performed in this step.

### 2026-02-27 (rest_api_med_overview plan improved)

- 🧩 Task: Improve `doku/feat/rest_api_med_overview.md` based on review findings.
- ✅ Decisions:
	- Added missing mandatory test workstream (backend, frontend, e2e).
	- Corrected rate-limit implementation target to existing architecture (`share.ts` + plugin in `backend/src/index.ts`).
	- Clarified response contract details: token format validation, `Cache-Control: no-store`, date format (`YYYY-MM-DD`), `shareStockStatus=false` nulling behavior.
	- Clarified image strategy for v1: reuse existing image filename + `/api/images/...` flow (no new share image proxy endpoint in this phase).
	- Updated effort estimate and explicitly recommended PR split due to scope size.
- 📁 Files touched:
	- `doku/feat/rest_api_med_overview.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If strict 500-line PR target must be enforced, execute as 3 linked PRs.

### 2026-02-27 (review of shared overview API plan completeness)

- 🧩 Task: Review `doku/feat/rest_api_med_overview.md` for quality and completeness.
- ✅ Decisions:
	- Plan is directionally good, but not complete for implementation-readiness.
	- Critical gaps identified: missing explicit test workstream, incorrect/unclear target file for rate-limit wiring (`backend/src/app.ts` does not exist), and unresolved image-delivery contract for share overview payload.
	- Confirmed project uses `backend/src/index.ts` for Fastify plugin registration and already has `@fastify/rate-limit` registered globally.
	- Confirmed share tokens are generated via `randomBytes(8).toString("hex")` (16 hex chars), so token-format checklist is consistent with current implementation.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Plan should be revised to include concrete backend/frontend/e2e tests and exact implementation locations before execution.

### 2026-02-27 (auth loading/error screen follows light/dark theme)

- 🧩 Task: Ensure the loading/connection screens shown before main app mount respect the selected theme.
- ✅ Decisions:
	- Implemented theme resolution directly in `App.tsx` for pre-auth screens (`loading`, `authError`, `!authState`).
	- Read `localStorage.theme` and support `light`, `dark`, and `system` (matchMedia fallback).
	- Applied resolved theme via `data-theme` on the auth container so CSS variables immediately match the chosen theme.
- 📁 Files touched:
	- `frontend/src/App.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (testing handoff + auth/registration env dependency clarification)

- 🧩 Task: User requested broad Playwright improvements (auth setup fallback, planner logic assertions, lifecycle integration, retry robustness, performance timeline tests) and asked whether login/registration behavior depends on env flags.
- ✅ Decisions:
	- Applied governance rule from `.github/skills/medassist-testing-handoff/SKILL.md`: test planning/writing/execution must be delegated to `@testing-manager`.
	- Confirmed env dependency chain:
		- Backend source of truth: `getAuthState()` in `backend/src/plugins/auth.ts`.
		- `authEnabled` comes from `AUTH_ENABLED`.
		- `registrationEnabled` is `REGISTRATION_ENABLED || !hasUsers`.
		- `formLoginEnabled` is `needsSetup || (AUTH_ENABLED && FORM_LOGIN_ENABLED)`.
		- OIDC visibility/flow depends on `OIDC_ENABLED` (+ OIDC config vars).
	- Identified why current E2E auth setup can fail in SSO-only mode: `frontend/e2e/auth.setup.ts` assumes `#username/#password` are always present.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Hand off requested Playwright implementation scope to `@testing-manager` with concrete file-level guidance.

### 2026-02-27 (intake reminder fallback removal)

- 🧩 Task: Make intake reminders strictly per-intake and remove medication-level fallback override.
- ✅ Decisions:
	- In `backend/src/services/intake-reminder-scheduler.ts`, removed effective reminder condition `intake.intakeRemindersEnabled || med.intakeRemindersEnabled`.
	- Reminder eligibility is now strictly `intake.intakeRemindersEnabled`.
	- Removed medication-level fallback argument when parsing intakes for reminder checks (`parseIntakesJson(..., false)`).
	- Medication prefilter now checks whether any intake has `intakeRemindersEnabled=true`.
- 📁 Files touched:
	- `backend/src/services/intake-reminder-scheduler.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Legacy medications that relied only on medication-level reminder flag will no longer trigger reminders until intake-level flags are enabled.

### 2026-02-27 (remove legacy `medassist.db` leftovers)

- 🧩 Task: Investigate why `backend/data/medassist.db` and `data/medassist.db` existed and remove old-path remnants.
- ✅ Decisions:
	- Verified runtime DB path is `medassist-ng.db` via `getDbPaths()` in `backend/src/db/db-utils.ts`; no production code references `medassist.db`.
	- Found remaining string references only in `backend/src/test/db-client.test.ts` mocks/assertions.
	- Updated those test references to `medassist-ng.db` and removed legacy files `backend/data/medassist.db` and `data/medassist.db` from disk.
- 📁 Files touched:
	- `backend/src/test/db-client.test.ts`
	- `backend/data/medassist.db` (removed)
	- `data/medassist.db` (removed)
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None; global search shows no remaining `medassist.db` code references.

### 2026-02-28 (CI triage: Backend Tests failure on PR #356)

- 🧩 Task: Reproduce and fix `Backend Tests` CI failure on `feat/package-amount-backend`.
- ✅ Decisions:
	- Reproduced local backend failure (`15` failing tests) with `500` responses from `POST /medications/usage`.
	- Identified root cause: `backend/src/routes/medications.ts` called `normalizeIntakeUsageForStock(...)` but helper export was missing from `backend/src/utils/scheduler-utils.ts`.
	- Added minimal helper implementation that normalizes finite positive usage values and keeps stock usage semantics centralized.
	- Re-ran targeted failing suites, then full backend suite; all passed.
- 📁 Files touched:
	- `backend/src/utils/scheduler-utils.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None for backend test check; release handoff can proceed without push from this agent.

### 2026-02-28 (stacked branch validation: package amount + liquid units + topical no-depletion)

- 🧩 Task: Validate stacked branch readiness and make tests compatible with new medication/package semantics.
- ✅ Decisions:
	- Confirmed stack order on `feat/topical-no-depletion-planner`: `7ebd253` -> `3954ed2` -> `e689720` -> `f9deb1b`.
	- Fixed backend in-memory test schemas (integration/planner/e2e-routes) to include new medication columns so route tests stop failing with fixture-level `500` errors.
	- Updated focused E2E selectors/assertions for schedule usage labels and planner stock wording after liquid/topical/package updates.
	- Stabilized medication lifecycle E2E edit flow by cleaning per-test medication state and using current edit-form labels.
- 📁 Files touched:
	- `backend/src/test/integration.test.ts`
	- `backend/src/test/planner.test.ts`
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/e2e/medication-edit.spec.ts`
	- `frontend/e2e/medication-lifecycle.spec.ts`
	- `frontend/e2e/planner-data.spec.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Frontend lint still reports 12 pre-existing `noNestedTernary` warnings in `MedicationsPage.tsx` and `ReportModal.tsx` (outside this compatibility-fix scope).

### 2026-02-28 (package amount UX: numeric input only for tube and liquid)

- 🧩 Task: Remove `+/-` steppers for non-tablet package amount fields.
- ✅ Decisions:
	- Replaced `FormNumberStepper` with a plain numeric text input for:
		- `tube` -> `Amount per tube`
		- `liquid_container` -> `Package amount`
	- Kept unit selectors read-only and fixed per domain rule:
		- `tube` unit fixed to `g`
		- `liquid_container` unit fixed to `ml`
	- Added component regression tests in mobile modal suite to validate the new input style and fixed units.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Existing unrelated `noNestedTernary` lint warnings remain in `MedicationsPage.tsx` (pre-existing scope).

### 2026-02-28 (test update: tube grams + liquid ml regression coverage)

- 🧩 Task: Review and update tests for the new package-unit behavior rules.
- ✅ Decisions:
	- Extended existing `useMedicationForm` tests to assert `packageAmountUnit="ml"` for `liquid_container` defaults/locks.
	- Added regression test that `tube` enforces/keeps `packageAmountUnit="g"` even if UI attempts to set `ml`.
	- Added regression test that legacy `tube` records with `packageAmountUnit="ml"` are normalized to `g` during `startEdit`.
	- Refactored touched code paths to satisfy `noNestedTernary` lint in changed files.
- 📁 Files touched:
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend route-level validation for `tube+ml` remains open if full server-side enforcement is desired.

### 2026-02-28 (tube unit correction: no ml for tubes)

- 🧩 Task: Enforce domain rule from user feedback: tubes use `g`, not `ml`.
- ✅ Decisions:
	- Removed `ml` choice from tube amount input in desktop and mobile edit forms (unit is fixed to `g`).
	- Added hard normalization so tube edit state and save payload always persist `packageAmountUnit="g"`.
	- Added payload guard so `liquid_container` is normalized to `packageAmountUnit="ml"`.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend validation hardening can be added later to reject historic `tube+ml` payloads server-side.

### 2026-02-28 (tube package UX simplification: 1 tube x 150 g)

- 🧩 Task: Make `tube` package fields intuitive and remove conflicting stock inputs.
- ✅ Decisions:
	- Reworked stock UI for `packageType=tube` in desktop and mobile to show only `Tubes` + `Amount per tube` + computed total amount.
	- Removed `total/current amount` steppers for tube to avoid contradictory input combinations.
	- Save payload now normalizes tube values to a consistent amount model (`totalPills` and `looseTablets` derived from `packCount * packageAmountValue`).
	- Added i18n keys for tube-specific labels (`form.tubes`, `form.packageAmountPerTube`) in EN/DE.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If needed, align planner/report wording to explicitly display tube multiplication format (`NxY unit`) everywhere.

### 2026-02-28 (start date optional placeholder consistency)

- 🧩 Task: Make start-date hint consistent with other optional date fields.
- ✅ Decisions:
	- Added `common.optional` placeholder to `Medication Start Date` in desktop and mobile edit forms.
	- Kept validation behavior unchanged (start date remains optional).
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-28 (full implementation: liquid units + topical stock behavior + package amount metadata)

- 🧩 Task: Implement the approved suggestions end-to-end: liquid intake unit conversion, topical non-depleting stock logic, and package amount metadata.
- ✅ Decisions:
	- Added persisted medication metadata fields `packageAmountValue` + `packageAmountUnit` (`ml|g`) in DB schema/migration and API/export/import mappings.
	- Extended intake model with `intakeUnit` (`ml|tsp|tbsp`) and conversion logic (`tsp=5 ml`, `tbsp=15 ml`) for stock calculations.
	- Enforced topical stock behavior as metadata-only depletion path in planner/reminder/frontend coverage calculations (`topical`/`tube` does not reduce stock in V1.1 behavior).
	- Added desktop+mobile parity UI for liquid intake-unit selection and package-amount metadata inputs.
	- Added EN/DE i18n keys for new fields and bumped export format to `1.3`.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/routes/export.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Testing execution remains delegated to `@testing-manager` per governance.

### 2026-02-28 (topical non-measurable vs liquid measurable + tbsp conversion)

- 🧩 Task: Clarify that topical content should not affect stock math while liquid should, and define tablespoon conversion.
- ✅ Decisions:
	- Updated `doku/package_types.md` so `topical` package amount is metadata-only (no depletion effect) in V1/V1.1.
	- Kept `liquid` as measurable stock with canonical `ml` deduction.
	- Added liquid intake conversion rules: `1 tsp = 5 ml`, `1 tbsp = 15 ml`.
	- Locked MedAssist conversion to medical metric convention (`tbsp=15 ml`), excluding regional culinary variants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved for implementation: add intake-unit enum (`ml|tsp|tbsp`) and conversion logic in frontend/backend.

### 2026-02-28 (packaging quantity unit decision for liquids/topicals)

- 🧩 Task: Clarify how package amount should be measured for liquid and topical medications.
- ✅ Decisions:
	- Added explicit recommendation in `doku/package_types.md` to introduce package quantity fields: `packageAmountValue` + `packageAmountUnit` (`ml|g`).
	- Documented default mapping: `liquid_container -> ml`, `tube(topical) -> g`, with manual override to `ml` for topical liquids.
	- Clarified separation between `doseUnit`, `packageAmountUnit`, and `strengthUnit`.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved, implement DB/API/frontend fields and migrations in a dedicated PR.

### 2026-02-28 (liquid_container regression tests implemented)

- 🧩 Task: Convert the checklist handoff into executable regression coverage for `liquid_container` and run targeted validation.
- ✅ Decisions:
	- Added backend real-route regression tests in `e2e-routes.test.ts` for create/share semantics and invalid liquid/package combination rejection.
	- Added frontend hook regression tests in `useMedicationForm.test.ts` for `liquid_container` form derivation (`medicationForm=liquid`, `doseUnit=ml`) and lock behavior.
	- Fixed outdated in-memory test schema in `e2e-routes.test.ts` by adding missing medication columns (`medication_form`, `pill_form`, `lifecycle_category`, `medication_end_date`, `auto_mark_obsolete_after_end_date`) so current route inserts can be tested reliably.
	- Executed only targeted test names to isolate new behavior from unrelated legacy failures in the larger file.
- 📁 Files touched:
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional next step: expand backend package/form matrix coverage beyond these focused regressions.

### 2026-02-28 (testing-manager handoff checklist for liquid_container)

- 🧩 Task: Create a concrete test handoff checklist after user confirmation.
- ✅ Decisions:
	- Added a dedicated `@testing-manager` section to `doku/package_types.md` with backend validation cases, frontend desktop/mobile parity checks, data exchange checks, and E2E minimum scenarios.
	- Kept checklist scoped to the `liquid_container` rollout and package/form invariants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the checklist via `@testing-manager` ownership path.

### 2026-02-28 (liquid_container rollout)

- 🧩 Task: Implement dedicated liquid package type end-to-end (`liquid_container`) after user decision.
- ✅ Decisions:
	- Added `liquid_container` to backend and frontend package type contracts.
	- Enforced compatibility: `liquid -> liquid_container`, `topical -> tube`, `capsule/tablet -> not tube/not liquid_container`.
	- Updated desktop/mobile medication forms with explicit `liquid_container` option and fixed unit/label behavior (`ml`) in planner/schedule/dashboard/detail/report flows.
	- Updated backend planner/reminder/export/refill/share logic to treat `liquid_container` as container stock semantics where applicable.
	- Updated `doku/package_types.md` constraints to reflect new canonical mapping.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Run full regression via `@testing-manager` (ownership rule).

### 2026-02-28 (logic correction: liquid cannot be in tube)

- 🧩 Task: Fix package-type logic after user report that `liquid` in `tube` is invalid.
- ✅ Decisions:
	- Backend validation changed to `topical -> tube` and `liquid != tube`.
	- UI for `packageType=tube` now only allows `topical`; the `liquid` option was removed in desktop and mobile edit flows.
	- Form defaults/derivations for `tube` now force `medicationForm=topical` with `doseUnit=units`.
	- Updated source-of-truth plan wording in `doku/package_types.md` to match corrected logic.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Re-check if a dedicated `liquid` package path should be modeled explicitly in a future master-plan phase.

### 2026-02-28 (package-type hardening pass implemented)

- 🧩 Task: Implement as much of the package-type remediation as possible before the master-plan rollout.
- ✅ Decisions:
	- Hardened backend API validation in `medications.ts` by adding inverse compatibility rule (`capsule/tablet` cannot use `tube`).
	- Updated frontend planner and schedule views to stop pill-only wording for `tube` medications and to render form-aware units.
	- Updated backend planner/reminder notification wording to avoid pill assumptions for `tube` and use form-aware/generic unit terms.
	- Extended backend translation common keys with unit terms required for the updated notification wording.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/i18n/translations.ts`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Test ownership remains with `@testing-manager`; full four-form regression coverage still pending.

### 2026-02-28 (package_types full-plan refresh to current implementation status)

- 🧩 Task: Review the full `doku/package_types.md` and bring it to the latest code-aligned state.
- ✅ Decisions:
	- Added a dated status snapshot (`2026-02-28`) with explicit split between implemented and still-open items.
	- Removed scope ambiguity by changing V1 section into `already implemented` baseline plus `remaining work`.
	- Added explicit note that persisted lifecycle values are currently limited to `refill_when_empty|treatment_period`, while `ongoing` is runtime-derived.
	- Added progress interpretation to the 1:1 remediation section (verify-and-align for completed parts, prioritize known open gaps).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Next implementation focus remains planner/schedule/reminder wording normalization and full four-form regression coverage.

### 2026-02-28 (package_types plan: added 1:1 remediation execution order)

- 🧩 Task: Write the full executable remediation order directly into `doku/package_types.md`.
- ✅ Decisions:
	- Added a mandatory file-by-file sequence with explicit `file -> change -> acceptance` structure.
	- Included all previously identified impacted backend, frontend, i18n, test, e2e, and documentation files.
	- Added an execution gate: skipped files require explicit technical rationale, otherwise rollout is incomplete.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the remediation in code in exactly this order and track skipped items with rationale.

### 2026-02-28 (package_types plan made coherent + full impact inventory)

- 🧩 Task: Adjust `doku/package_types.md` so the plan is coherent and explicitly lists all affected code/test/doc areas.
- ✅ Decisions:
	- Fixed top-level contradiction by documenting current container reality as `blister|bottle|tube`.
	- Added a mandatory explicit affected-file inventory across backend routes/services/schema, frontend runtime surfaces, i18n, backend tests, frontend tests, and e2e specs.
	- Kept the no-partial-rollout enforcement and linked it to concrete file groups for execution control.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Implement remediation in code according to the newly enumerated file inventory (starting with planner/schedule wording and corresponding tests).

### 2026-02-28 (package type plan hardening against partial implementation)

- 🧩 Task: Strengthen `doku/package_types.md` so package/form changes cannot be considered done when only partial surfaces are updated.
- ✅ Decisions:
	- Added a mandatory cross-layer implementation coverage section (backend validation, backend logic, desktop+mobile parity, read views, i18n, import/export/share, tests).
	- Added explicit definition of done: all checklist areas must be updated or explicitly marked not impacted with rationale.
	- Grounded follow-up review findings with concrete gap examples still visible in code (notably planner/schedule pill-only wording paths).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute a dedicated cleanup pass for planner/schedule/backend planner notification wording and corresponding tests.

### 2026-02-28 (release-manager doc cleanup: remove app-feature example)

- 🧩 Task: Remove product-feature-specific text from `.github/agents/release-manager.agent.md` and keep it process-focused.
- ✅ Decisions:
	- Replaced concrete app feature example under release notes guidance with a neutral, reusable template using placeholders.
	- Kept release process rules intact; only example content was generalized.
- 📁 Files touched:
	- `.github/agents/release-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optionally align the Breaking Changes heading example with the no-emoji rule in a separate doc cleanup pass.

### 2026-02-27 (dashboard overview tube unit fix)

- 🧩 Task: Fix dashboard medication overview showing `pill` for `tube` medications.
- ✅ Decisions:
	- Replaced pill-based stock label in dashboard overview with tube-aware amount labels.
	- Added local dashboard helpers to render `tube` values as `ml` (liquid) or `applications` (topical).
	- Updated timeline dose/total tags in dashboard day blocks to use tube-aware units and suppress pill-weight mg details for tube.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (date input placeholder casing fix)

- 🧩 Task: Keep `optional` placeholder text lowercase in date inputs instead of inherited uppercase styling.
- ✅ Decisions:
	- Root cause is inherited `text-transform: uppercase` from `.form-grid label`.
	- Applied local override on `.date-input-display` (`text-transform: none`, `letter-spacing: normal`) to preserve calm, readable lowercase placeholder text.
- 📁 Files touched:
	- `frontend/src/styles/schedule-mobile-edit.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (tube wording consistency in report exports)

- 🧩 Task: Complete tube-specific wording consistency in medication report exports (text + print/PDF).
- ✅ Decisions:
	- Added helper functions in `ReportModal` to centralize tube unit/label logic (`ml` vs `applications`).
	- Replaced pill-centric wording with amount-based wording for `tube` in current stock, total capacity label, intake schedule entries, and refill history entries.
	- Hid `Dose per pill` row for `tube` in both text and print report outputs.
- 📁 Files touched:
	- `frontend/src/components/ReportModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Dashboard/Planner wording parity should be rechecked in a dedicated pass if product wants full app-wide amount terminology normalization for tube.

### 2026-02-27 (holistic package-specific UI behavior for tube)

- 🧩 Task: Make package tab behavior fully package-specific so `tube` does not show pill/mg-oriented fields.
- ✅ Decisions:
	- For `tube`, relabeled stock fields from pill terminology to amount terminology.
	- Hid the pill-specific strength field (`Dose per pill`) for `tube` in desktop and mobile package tabs.
	- Adjusted total display text for `tube` to avoid `pill/pills` wording.
	- Added tube-form default unit behavior: `liquid -> ml`, `topical -> units`.
	- Added EN/DE i18n keys for amount-based labels.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend extension: distinguish volume-based depletion for liquid vs application-based depletion for topical in planner/reminder calculations.

### 2026-02-27 (align package_types doc with implemented tube/liquid/topical behavior)

- 🧩 Task: Resolve contradiction between implementation and `doku/package_types.md` technical constraints.
- ✅ Decisions:
	- Updated constraints to reflect actual support for `packageType=blister|bottle|tube`.
	- Documented current UX split:
		- `blister`/`bottle` use `pillForm`.
		- `tube` uses `medicationForm` (`liquid`/`topical`).
	- Removed stale claim that only `blister|bottle` are supported end-to-end.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep docs in lockstep with model/UI changes to avoid product-level confusion.

### 2026-02-27 (restore liquid vs topical distinction for tube)

- 🧩 Task: Reintroduce meaningful liquid/topical distinction after pillForm-first simplification removed explicit tube subform choice.
- ✅ Decisions:
	- Keep `pillForm` as primary for non-tube packages.
	- For `packageType=tube`, show `medicationForm` selector with only `liquid` and `topical` options.
	- Tube intake behavior now respects selected tube subform:
		- `liquid` -> fractional intake allowed, `usageMl` label.
		- `topical` -> integer/application-style intake, `usageApplication` label.
	- Default when switching to tube is now `liquid` unless an existing tube subform already exists.
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If stock math for liquid should be volume-precise vs application-based, add explicit unit/policy handling in backend planner/reminder calculations.

### 2026-02-27 (pillForm-first UX: removed medicationForm selector)

- 🧩 Task: Remove semantically redundant `medicationForm` vs `pillForm` user choice and make `pillForm` the primary user-facing control.
- ✅ Decisions:
	- Removed `medicationForm` selector from desktop and mobile forms.
	- Kept `pillForm` as the user-facing form mechanic for non-tube package types.
	- Kept `packageType` explicit (`blister`, `bottle`, `tube`) and derive `medicationForm` internally on save for backend compatibility.
	- Intake behavior now keys off `packageType`/`pillForm` in UI logic (fraction rule + usage labels).
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If liquid vs topical needs separate user-facing control later, add it only with concrete behavior differences.

### 2026-02-27 (remove non-functional lifecycle selector from UI)

- 🧩 Task: Ensure users only see options with concrete app impact.
- ✅ Decisions:
	- Removed `lifecycleCategory` selector from desktop and mobile medication edit forms because both options currently have no distinct runtime behavior.
	- Kept persistence/internal field compatibility untouched to avoid DB/API churn in the same scope.
	- Documented that lifecycle selector remains hidden until it drives differentiated planner/reminder/stock behavior.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If lifecycle should return as a visible control, implement real behavior differences first and then re-enable UI.

### 2026-02-27 (package type pivot: liquid/topical use tube, not bottle)

- 🧩 Task: Complete cross-layer pivot after user correction that liquid/topical must not use pill-bottle semantics.
- ✅ Decisions:
	- Introduced/propagated dedicated `tube` package type in backend validation/export and frontend domain/UI types.
	- Enforced medication-form mapping: liquid/topical -> `tube`; capsule/tablet keep blister/bottle options.
	- Standardized stock logic so container semantics (`bottle` and `tube`) use direct loose/total capacity handling across planner/dashboard/detail/refill/report/scheduler.
	- Added missing i18n keys for tube labels in form/report contexts (EN/DE).
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/hooks/useRefill.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/utils/stock.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Tests are owned by `@testing-manager`; no test execution was performed in this step.

### 2026-02-27 (rest_api_med_overview plan improved)

- 🧩 Task: Improve `doku/feat/rest_api_med_overview.md` based on review findings.
- ✅ Decisions:
	- Added missing mandatory test workstream (backend, frontend, e2e).
	- Corrected rate-limit implementation target to existing architecture (`share.ts` + plugin in `backend/src/index.ts`).
	- Clarified response contract details: token format validation, `Cache-Control: no-store`, date format (`YYYY-MM-DD`), `shareStockStatus=false` nulling behavior.
	- Clarified image strategy for v1: reuse existing image filename + `/api/images/...` flow (no new share image proxy endpoint in this phase).
	- Updated effort estimate and explicitly recommended PR split due to scope size.
- 📁 Files touched:
	- `doku/feat/rest_api_med_overview.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If strict 500-line PR target must be enforced, execute as 3 linked PRs.

### 2026-02-27 (review of shared overview API plan completeness)

- 🧩 Task: Review `doku/feat/rest_api_med_overview.md` for quality and completeness.
- ✅ Decisions:
	- Plan is directionally good, but not complete for implementation-readiness.
	- Critical gaps identified: missing explicit test workstream, incorrect/unclear target file for rate-limit wiring (`backend/src/app.ts` does not exist), and unresolved image-delivery contract for share overview payload.
	- Confirmed project uses `backend/src/index.ts` for Fastify plugin registration and already has `@fastify/rate-limit` registered globally.
	- Confirmed share tokens are generated via `randomBytes(8).toString("hex")` (16 hex chars), so token-format checklist is consistent with current implementation.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Plan should be revised to include concrete backend/frontend/e2e tests and exact implementation locations before execution.

### 2026-02-27 (auth loading/error screen follows light/dark theme)

- 🧩 Task: Ensure the loading/connection screens shown before main app mount respect the selected theme.
- ✅ Decisions:
	- Implemented theme resolution directly in `App.tsx` for pre-auth screens (`loading`, `authError`, `!authState`).
	- Read `localStorage.theme` and support `light`, `dark`, and `system` (matchMedia fallback).
	- Applied resolved theme via `data-theme` on the auth container so CSS variables immediately match the chosen theme.
- 📁 Files touched:
	- `frontend/src/App.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (testing handoff + auth/registration env dependency clarification)

- 🧩 Task: User requested broad Playwright improvements (auth setup fallback, planner logic assertions, lifecycle integration, retry robustness, performance timeline tests) and asked whether login/registration behavior depends on env flags.
- ✅ Decisions:
	- Applied governance rule from `.github/skills/medassist-testing-handoff/SKILL.md`: test planning/writing/execution must be delegated to `@testing-manager`.
	- Confirmed env dependency chain:
		- Backend source of truth: `getAuthState()` in `backend/src/plugins/auth.ts`.
		- `authEnabled` comes from `AUTH_ENABLED`.
		- `registrationEnabled` is `REGISTRATION_ENABLED || !hasUsers`.
		- `formLoginEnabled` is `needsSetup || (AUTH_ENABLED && FORM_LOGIN_ENABLED)`.
		- OIDC visibility/flow depends on `OIDC_ENABLED` (+ OIDC config vars).
	- Identified why current E2E auth setup can fail in SSO-only mode: `frontend/e2e/auth.setup.ts` assumes `#username/#password` are always present.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Hand off requested Playwright implementation scope to `@testing-manager` with concrete file-level guidance.

### 2026-02-27 (intake reminder fallback removal)

- 🧩 Task: Make intake reminders strictly per-intake and remove medication-level fallback override.
- ✅ Decisions:
	- In `backend/src/services/intake-reminder-scheduler.ts`, removed effective reminder condition `intake.intakeRemindersEnabled || med.intakeRemindersEnabled`.
	- Reminder eligibility is now strictly `intake.intakeRemindersEnabled`.
	- Removed medication-level fallback argument when parsing intakes for reminder checks (`parseIntakesJson(..., false)`).
	- Medication prefilter now checks whether any intake has `intakeRemindersEnabled=true`.
- 📁 Files touched:
	- `backend/src/services/intake-reminder-scheduler.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Legacy medications that relied only on medication-level reminder flag will no longer trigger reminders until intake-level flags are enabled.

### 2026-02-27 (remove legacy `medassist.db` leftovers)

- 🧩 Task: Investigate why `backend/data/medassist.db` and `data/medassist.db` existed and remove old-path remnants.
- ✅ Decisions:
	- Verified runtime DB path is `medassist-ng.db` via `getDbPaths()` in `backend/src/db/db-utils.ts`; no production code references `medassist.db`.
	- Found remaining string references only in `backend/src/test/db-client.test.ts` mocks/assertions.
	- Updated those test references to `medassist-ng.db` and removed legacy files `backend/data/medassist.db` and `data/medassist.db` from disk.
- 📁 Files touched:
	- `backend/src/test/db-client.test.ts`
	- `backend/data/medassist.db` (removed)
	- `data/medassist.db` (removed)
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None; global search shows no remaining `medassist.db` code references.

### 2026-02-28 (PR #359 backend CI failure triage)

- 🧩 Task: Reproduce and fix failing backend CI check on `feat/topical-no-depletion-planner`.
- ✅ Decisions:
	- Reproduced CI sequence locally (`lint`, `tsc --noEmit`, `test:coverage`) and identified TypeScript failure in `backend/src/routes/planner.ts`.
	- Root cause: route referenced `tr.common.units` and `tr.common.ml`, but these keys were missing from `TranslationKeys.common` and both language dictionaries.
	- Applied minimal backend-only fix by adding `units` and `ml` to `backend/src/i18n/translations.ts` type + EN/DE values.
	- Revalidated backend CI steps locally: lint pass, typecheck pass, full coverage suite pass.
- 📁 Files touched:
	- `backend/src/i18n/translations.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Branch is ready for release-manager handoff for remote push/PR operations (not performed by this agent).

### 2026-02-28 (CI triage: Backend Tests failure on PR #356)

- 🧩 Task: Reproduce and fix `Backend Tests` CI failure on `feat/package-amount-backend`.
- ✅ Decisions:
	- Reproduced local backend failure (`15` failing tests) with `500` responses from `POST /medications/usage`.
	- Identified root cause: `backend/src/routes/medications.ts` called `normalizeIntakeUsageForStock(...)` but helper export was missing from `backend/src/utils/scheduler-utils.ts`.
	- Added minimal helper implementation that normalizes finite positive usage values and keeps stock usage semantics centralized.
	- Re-ran targeted failing suites, then full backend suite; all passed.
- 📁 Files touched:
	- `backend/src/utils/scheduler-utils.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None for backend test check; release handoff can proceed without push from this agent.

### 2026-02-28 (stacked branch validation: package amount + liquid units + topical no-depletion)

- 🧩 Task: Validate stacked branch readiness and make tests compatible with new medication/package semantics.
- ✅ Decisions:
	- Confirmed stack order on `feat/topical-no-depletion-planner`: `7ebd253` -> `3954ed2` -> `e689720` -> `f9deb1b`.
	- Fixed backend in-memory test schemas (integration/planner/e2e-routes) to include new medication columns so route tests stop failing with fixture-level `500` errors.
	- Updated focused E2E selectors/assertions for schedule usage labels and planner stock wording after liquid/topical/package updates.
	- Stabilized medication lifecycle E2E edit flow by cleaning per-test medication state and using current edit-form labels.
- 📁 Files touched:
	- `backend/src/test/integration.test.ts`
	- `backend/src/test/planner.test.ts`
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/e2e/medication-edit.spec.ts`
	- `frontend/e2e/medication-lifecycle.spec.ts`
	- `frontend/e2e/planner-data.spec.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Frontend lint still reports 12 pre-existing `noNestedTernary` warnings in `MedicationsPage.tsx` and `ReportModal.tsx` (outside this compatibility-fix scope).

### 2026-02-28 (package amount UX: numeric input only for tube and liquid)

- 🧩 Task: Remove `+/-` steppers for non-tablet package amount fields.
- ✅ Decisions:
	- Replaced `FormNumberStepper` with a plain numeric text input for:
		- `tube` -> `Amount per tube`
		- `liquid_container` -> `Package amount`
	- Kept unit selectors read-only and fixed per domain rule:
		- `tube` unit fixed to `g`
		- `liquid_container` unit fixed to `ml`
	- Added component regression tests in mobile modal suite to validate the new input style and fixed units.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Existing unrelated `noNestedTernary` lint warnings remain in `MedicationsPage.tsx` (pre-existing scope).

### 2026-02-28 (test update: tube grams + liquid ml regression coverage)

- 🧩 Task: Review and update tests for the new package-unit behavior rules.
- ✅ Decisions:
	- Extended existing `useMedicationForm` tests to assert `packageAmountUnit="ml"` for `liquid_container` defaults/locks.
	- Added regression test that `tube` enforces/keeps `packageAmountUnit="g"` even if UI attempts to set `ml`.
	- Added regression test that legacy `tube` records with `packageAmountUnit="ml"` are normalized to `g` during `startEdit`.
	- Refactored touched code paths to satisfy `noNestedTernary` lint in changed files.
- 📁 Files touched:
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend route-level validation for `tube+ml` remains open if full server-side enforcement is desired.

### 2026-02-28 (tube unit correction: no ml for tubes)

- 🧩 Task: Enforce domain rule from user feedback: tubes use `g`, not `ml`.
- ✅ Decisions:
	- Removed `ml` choice from tube amount input in desktop and mobile edit forms (unit is fixed to `g`).
	- Added hard normalization so tube edit state and save payload always persist `packageAmountUnit="g"`.
	- Added payload guard so `liquid_container` is normalized to `packageAmountUnit="ml"`.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend validation hardening can be added later to reject historic `tube+ml` payloads server-side.

### 2026-02-28 (tube package UX simplification: 1 tube x 150 g)

- 🧩 Task: Make `tube` package fields intuitive and remove conflicting stock inputs.
- ✅ Decisions:
	- Reworked stock UI for `packageType=tube` in desktop and mobile to show only `Tubes` + `Amount per tube` + computed total amount.
	- Removed `total/current amount` steppers for tube to avoid contradictory input combinations.
	- Save payload now normalizes tube values to a consistent amount model (`totalPills` and `looseTablets` derived from `packCount * packageAmountValue`).
	- Added i18n keys for tube-specific labels (`form.tubes`, `form.packageAmountPerTube`) in EN/DE.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If needed, align planner/report wording to explicitly display tube multiplication format (`NxY unit`) everywhere.

### 2026-02-28 (start date optional placeholder consistency)

- 🧩 Task: Make start-date hint consistent with other optional date fields.
- ✅ Decisions:
	- Added `common.optional` placeholder to `Medication Start Date` in desktop and mobile edit forms.
	- Kept validation behavior unchanged (start date remains optional).
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-28 (full implementation: liquid units + topical stock behavior + package amount metadata)

- 🧩 Task: Implement the approved suggestions end-to-end: liquid intake unit conversion, topical non-depleting stock logic, and package amount metadata.
- ✅ Decisions:
	- Added persisted medication metadata fields `packageAmountValue` + `packageAmountUnit` (`ml|g`) in DB schema/migration and API/export/import mappings.
	- Extended intake model with `intakeUnit` (`ml|tsp|tbsp`) and conversion logic (`tsp=5 ml`, `tbsp=15 ml`) for stock calculations.
	- Enforced topical stock behavior as metadata-only depletion path in planner/reminder/frontend coverage calculations (`topical`/`tube` does not reduce stock in V1.1 behavior).
	- Added desktop+mobile parity UI for liquid intake-unit selection and package-amount metadata inputs.
	- Added EN/DE i18n keys for new fields and bumped export format to `1.3`.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/routes/export.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/utils/schedule.ts`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Testing execution remains delegated to `@testing-manager` per governance.

### 2026-02-28 (topical non-measurable vs liquid measurable + tbsp conversion)

- 🧩 Task: Clarify that topical content should not affect stock math while liquid should, and define tablespoon conversion.
- ✅ Decisions:
	- Updated `doku/package_types.md` so `topical` package amount is metadata-only (no depletion effect) in V1/V1.1.
	- Kept `liquid` as measurable stock with canonical `ml` deduction.
	- Added liquid intake conversion rules: `1 tsp = 5 ml`, `1 tbsp = 15 ml`.
	- Locked MedAssist conversion to medical metric convention (`tbsp=15 ml`), excluding regional culinary variants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved for implementation: add intake-unit enum (`ml|tsp|tbsp`) and conversion logic in frontend/backend.

### 2026-02-28 (packaging quantity unit decision for liquids/topicals)

- 🧩 Task: Clarify how package amount should be measured for liquid and topical medications.
- ✅ Decisions:
	- Added explicit recommendation in `doku/package_types.md` to introduce package quantity fields: `packageAmountValue` + `packageAmountUnit` (`ml|g`).
	- Documented default mapping: `liquid_container -> ml`, `tube(topical) -> g`, with manual override to `ml` for topical liquids.
	- Clarified separation between `doseUnit`, `packageAmountUnit`, and `strengthUnit`.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If approved, implement DB/API/frontend fields and migrations in a dedicated PR.

### 2026-02-28 (liquid_container regression tests implemented)

- 🧩 Task: Convert the checklist handoff into executable regression coverage for `liquid_container` and run targeted validation.
- ✅ Decisions:
	- Added backend real-route regression tests in `e2e-routes.test.ts` for create/share semantics and invalid liquid/package combination rejection.
	- Added frontend hook regression tests in `useMedicationForm.test.ts` for `liquid_container` form derivation (`medicationForm=liquid`, `doseUnit=ml`) and lock behavior.
	- Fixed outdated in-memory test schema in `e2e-routes.test.ts` by adding missing medication columns (`medication_form`, `pill_form`, `lifecycle_category`, `medication_end_date`, `auto_mark_obsolete_after_end_date`) so current route inserts can be tested reliably.
	- Executed only targeted test names to isolate new behavior from unrelated legacy failures in the larger file.
- 📁 Files touched:
	- `backend/src/test/e2e-routes.test.ts`
	- `frontend/src/test/hooks/useMedicationForm.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional next step: expand backend package/form matrix coverage beyond these focused regressions.

### 2026-02-28 (testing-manager handoff checklist for liquid_container)

- 🧩 Task: Create a concrete test handoff checklist after user confirmation.
- ✅ Decisions:
	- Added a dedicated `@testing-manager` section to `doku/package_types.md` with backend validation cases, frontend desktop/mobile parity checks, data exchange checks, and E2E minimum scenarios.
	- Kept checklist scoped to the `liquid_container` rollout and package/form invariants.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the checklist via `@testing-manager` ownership path.

### 2026-02-28 (liquid_container rollout)

- 🧩 Task: Implement dedicated liquid package type end-to-end (`liquid_container`) after user decision.
- ✅ Decisions:
	- Added `liquid_container` to backend and frontend package type contracts.
	- Enforced compatibility: `liquid -> liquid_container`, `topical -> tube`, `capsule/tablet -> not tube/not liquid_container`.
	- Updated desktop/mobile medication forms with explicit `liquid_container` option and fixed unit/label behavior (`ml`) in planner/schedule/dashboard/detail/report flows.
	- Updated backend planner/reminder/export/refill/share logic to treat `liquid_container` as container stock semantics where applicable.
	- Updated `doku/package_types.md` constraints to reflect new canonical mapping.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Run full regression via `@testing-manager` (ownership rule).

### 2026-02-28 (logic correction: liquid cannot be in tube)

- 🧩 Task: Fix package-type logic after user report that `liquid` in `tube` is invalid.
- ✅ Decisions:
	- Backend validation changed to `topical -> tube` and `liquid != tube`.
	- UI for `packageType=tube` now only allows `topical`; the `liquid` option was removed in desktop and mobile edit flows.
	- Form defaults/derivations for `tube` now force `medicationForm=topical` with `doseUnit=units`.
	- Updated source-of-truth plan wording in `doku/package_types.md` to match corrected logic.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Re-check if a dedicated `liquid` package path should be modeled explicitly in a future master-plan phase.

### 2026-02-28 (package-type hardening pass implemented)

- 🧩 Task: Implement as much of the package-type remediation as possible before the master-plan rollout.
- ✅ Decisions:
	- Hardened backend API validation in `medications.ts` by adding inverse compatibility rule (`capsule/tablet` cannot use `tube`).
	- Updated frontend planner and schedule views to stop pill-only wording for `tube` medications and to render form-aware units.
	- Updated backend planner/reminder notification wording to avoid pill assumptions for `tube` and use form-aware/generic unit terms.
	- Extended backend translation common keys with unit terms required for the updated notification wording.
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/pages/SchedulePage.tsx`
	- `backend/src/routes/planner.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `backend/src/i18n/translations.ts`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Test ownership remains with `@testing-manager`; full four-form regression coverage still pending.

### 2026-02-28 (package_types full-plan refresh to current implementation status)

- 🧩 Task: Review the full `doku/package_types.md` and bring it to the latest code-aligned state.
- ✅ Decisions:
	- Added a dated status snapshot (`2026-02-28`) with explicit split between implemented and still-open items.
	- Removed scope ambiguity by changing V1 section into `already implemented` baseline plus `remaining work`.
	- Added explicit note that persisted lifecycle values are currently limited to `refill_when_empty|treatment_period`, while `ongoing` is runtime-derived.
	- Added progress interpretation to the 1:1 remediation section (verify-and-align for completed parts, prioritize known open gaps).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Next implementation focus remains planner/schedule/reminder wording normalization and full four-form regression coverage.

### 2026-02-28 (package_types plan: added 1:1 remediation execution order)

- 🧩 Task: Write the full executable remediation order directly into `doku/package_types.md`.
- ✅ Decisions:
	- Added a mandatory file-by-file sequence with explicit `file -> change -> acceptance` structure.
	- Included all previously identified impacted backend, frontend, i18n, test, e2e, and documentation files.
	- Added an execution gate: skipped files require explicit technical rationale, otherwise rollout is incomplete.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute the remediation in code in exactly this order and track skipped items with rationale.

### 2026-02-28 (package_types plan made coherent + full impact inventory)

- 🧩 Task: Adjust `doku/package_types.md` so the plan is coherent and explicitly lists all affected code/test/doc areas.
- ✅ Decisions:
	- Fixed top-level contradiction by documenting current container reality as `blister|bottle|tube`.
	- Added a mandatory explicit affected-file inventory across backend routes/services/schema, frontend runtime surfaces, i18n, backend tests, frontend tests, and e2e specs.
	- Kept the no-partial-rollout enforcement and linked it to concrete file groups for execution control.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Implement remediation in code according to the newly enumerated file inventory (starting with planner/schedule wording and corresponding tests).

### 2026-02-28 (package type plan hardening against partial implementation)

- 🧩 Task: Strengthen `doku/package_types.md` so package/form changes cannot be considered done when only partial surfaces are updated.
- ✅ Decisions:
	- Added a mandatory cross-layer implementation coverage section (backend validation, backend logic, desktop+mobile parity, read views, i18n, import/export/share, tests).
	- Added explicit definition of done: all checklist areas must be updated or explicitly marked not impacted with rationale.
	- Grounded follow-up review findings with concrete gap examples still visible in code (notably planner/schedule pill-only wording paths).
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Execute a dedicated cleanup pass for planner/schedule/backend planner notification wording and corresponding tests.

### 2026-02-28 (release-manager doc cleanup: remove app-feature example)

- 🧩 Task: Remove product-feature-specific text from `.github/agents/release-manager.agent.md` and keep it process-focused.
- ✅ Decisions:
	- Replaced concrete app feature example under release notes guidance with a neutral, reusable template using placeholders.
	- Kept release process rules intact; only example content was generalized.
- 📁 Files touched:
	- `.github/agents/release-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optionally align the Breaking Changes heading example with the no-emoji rule in a separate doc cleanup pass.

### 2026-02-27 (dashboard overview tube unit fix)

- 🧩 Task: Fix dashboard medication overview showing `pill` for `tube` medications.
- ✅ Decisions:
	- Replaced pill-based stock label in dashboard overview with tube-aware amount labels.
	- Added local dashboard helpers to render `tube` values as `ml` (liquid) or `applications` (topical).
	- Updated timeline dose/total tags in dashboard day blocks to use tube-aware units and suppress pill-weight mg details for tube.
- 📁 Files touched:
	- `frontend/src/pages/DashboardPage.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (date input placeholder casing fix)

- 🧩 Task: Keep `optional` placeholder text lowercase in date inputs instead of inherited uppercase styling.
- ✅ Decisions:
	- Root cause is inherited `text-transform: uppercase` from `.form-grid label`.
	- Applied local override on `.date-input-display` (`text-transform: none`, `letter-spacing: normal`) to preserve calm, readable lowercase placeholder text.
- 📁 Files touched:
	- `frontend/src/styles/schedule-mobile-edit.css`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (tube wording consistency in report exports)

- 🧩 Task: Complete tube-specific wording consistency in medication report exports (text + print/PDF).
- ✅ Decisions:
	- Added helper functions in `ReportModal` to centralize tube unit/label logic (`ml` vs `applications`).
	- Replaced pill-centric wording with amount-based wording for `tube` in current stock, total capacity label, intake schedule entries, and refill history entries.
	- Hid `Dose per pill` row for `tube` in both text and print report outputs.
- 📁 Files touched:
	- `frontend/src/components/ReportModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Dashboard/Planner wording parity should be rechecked in a dedicated pass if product wants full app-wide amount terminology normalization for tube.

### 2026-02-27 (holistic package-specific UI behavior for tube)

- 🧩 Task: Make package tab behavior fully package-specific so `tube` does not show pill/mg-oriented fields.
- ✅ Decisions:
	- For `tube`, relabeled stock fields from pill terminology to amount terminology.
	- Hid the pill-specific strength field (`Dose per pill`) for `tube` in desktop and mobile package tabs.
	- Adjusted total display text for `tube` to avoid `pill/pills` wording.
	- Added tube-form default unit behavior: `liquid -> ml`, `topical -> units`.
	- Added EN/DE i18n keys for amount-based labels.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Optional backend extension: distinguish volume-based depletion for liquid vs application-based depletion for topical in planner/reminder calculations.

### 2026-02-27 (align package_types doc with implemented tube/liquid/topical behavior)

- 🧩 Task: Resolve contradiction between implementation and `doku/package_types.md` technical constraints.
- ✅ Decisions:
	- Updated constraints to reflect actual support for `packageType=blister|bottle|tube`.
	- Documented current UX split:
		- `blister`/`bottle` use `pillForm`.
		- `tube` uses `medicationForm` (`liquid`/`topical`).
	- Removed stale claim that only `blister|bottle` are supported end-to-end.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep docs in lockstep with model/UI changes to avoid product-level confusion.

### 2026-02-27 (restore liquid vs topical distinction for tube)

- 🧩 Task: Reintroduce meaningful liquid/topical distinction after pillForm-first simplification removed explicit tube subform choice.
- ✅ Decisions:
	- Keep `pillForm` as primary for non-tube packages.
	- For `packageType=tube`, show `medicationForm` selector with only `liquid` and `topical` options.
	- Tube intake behavior now respects selected tube subform:
		- `liquid` -> fractional intake allowed, `usageMl` label.
		- `topical` -> integer/application-style intake, `usageApplication` label.
	- Default when switching to tube is now `liquid` unless an existing tube subform already exists.
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If stock math for liquid should be volume-precise vs application-based, add explicit unit/policy handling in backend planner/reminder calculations.

### 2026-02-27 (pillForm-first UX: removed medicationForm selector)

- 🧩 Task: Remove semantically redundant `medicationForm` vs `pillForm` user choice and make `pillForm` the primary user-facing control.
- ✅ Decisions:
	- Removed `medicationForm` selector from desktop and mobile forms.
	- Kept `pillForm` as the user-facing form mechanic for non-tube package types.
	- Kept `packageType` explicit (`blister`, `bottle`, `tube`) and derive `medicationForm` internally on save for backend compatibility.
	- Intake behavior now keys off `packageType`/`pillForm` in UI logic (fraction rule + usage labels).
- 📁 Files touched:
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If liquid vs topical needs separate user-facing control later, add it only with concrete behavior differences.

### 2026-02-27 (remove non-functional lifecycle selector from UI)

- 🧩 Task: Ensure users only see options with concrete app impact.
- ✅ Decisions:
	- Removed `lifecycleCategory` selector from desktop and mobile medication edit forms because both options currently have no distinct runtime behavior.
	- Kept persistence/internal field compatibility untouched to avoid DB/API churn in the same scope.
	- Documented that lifecycle selector remains hidden until it drives differentiated planner/reminder/stock behavior.
- 📁 Files touched:
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If lifecycle should return as a visible control, implement real behavior differences first and then re-enable UI.

### 2026-02-27 (package type pivot: liquid/topical use tube, not bottle)

- 🧩 Task: Complete cross-layer pivot after user correction that liquid/topical must not use pill-bottle semantics.
- ✅ Decisions:
	- Introduced/propagated dedicated `tube` package type in backend validation/export and frontend domain/UI types.
	- Enforced medication-form mapping: liquid/topical -> `tube`; capsule/tablet keep blister/bottle options.
	- Standardized stock logic so container semantics (`bottle` and `tube`) use direct loose/total capacity handling across planner/dashboard/detail/refill/report/scheduler.
	- Added missing i18n keys for tube labels in form/report contexts (EN/DE).
- 📁 Files touched:
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/src/routes/refills.ts`
	- `backend/src/routes/planner.ts`
	- `backend/src/routes/share.ts`
	- `backend/src/services/reminder-scheduler.ts`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/hooks/useRefill.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/pages/PlannerPage.tsx`
	- `frontend/src/components/MedDetailModal.tsx`
	- `frontend/src/components/ReportModal.tsx`
	- `frontend/src/utils/stock.ts`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Tests are owned by `@testing-manager`; no test execution was performed in this step.

### 2026-02-27 (rest_api_med_overview plan improved)

- 🧩 Task: Improve `doku/feat/rest_api_med_overview.md` based on review findings.
- ✅ Decisions:
	- Added missing mandatory test workstream (backend, frontend, e2e).
	- Corrected rate-limit implementation target to existing architecture (`share.ts` + plugin in `backend/src/index.ts`).
	- Clarified response contract details: token format validation, `Cache-Control: no-store`, date format (`YYYY-MM-DD`), `shareStockStatus=false` nulling behavior.
	- Clarified image strategy for v1: reuse existing image filename + `/api/images/...` flow (no new share image proxy endpoint in this phase).
	- Updated effort estimate and explicitly recommended PR split due to scope size.
- 📁 Files touched:
	- `doku/feat/rest_api_med_overview.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If strict 500-line PR target must be enforced, execute as 3 linked PRs.

### 2026-02-27 (review of shared overview API plan completeness)

- 🧩 Task: Review `doku/feat/rest_api_med_overview.md` for quality and completeness.
- ✅ Decisions:
	- Plan is directionally good, but not complete for implementation-readiness.
	- Critical gaps identified: missing explicit test workstream, incorrect/unclear target file for rate-limit wiring (`backend/src/app.ts` does not exist), and unresolved image-delivery contract for share overview payload.
	- Confirmed project uses `backend/src/index.ts` for Fastify plugin registration and already has `@fastify/rate-limit` registered globally.
	- Confirmed share tokens are generated via `randomBytes(8).toString("hex")` (16 hex chars), so token-format checklist is consistent with current implementation.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Plan should be revised to include concrete backend/frontend/e2e tests and exact implementation locations before execution.

### 2026-02-27 (auth loading/error screen follows light/dark theme)

- 🧩 Task: Ensure the loading/connection screens shown before main app mount respect the selected theme.
- ✅ Decisions:
	- Implemented theme resolution directly in `App.tsx` for pre-auth screens (`loading`, `authError`, `!authState`).
	- Read `localStorage.theme` and support `light`, `dark`, and `system` (matchMedia fallback).
	- Applied resolved theme via `data-theme` on the auth container so CSS variables immediately match the chosen theme.
- 📁 Files touched:
	- `frontend/src/App.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None.

### 2026-02-27 (testing handoff + auth/registration env dependency clarification)

- 🧩 Task: User requested broad Playwright improvements (auth setup fallback, planner logic assertions, lifecycle integration, retry robustness, performance timeline tests) and asked whether login/registration behavior depends on env flags.
- ✅ Decisions:
	- Applied governance rule from `.github/skills/medassist-testing-handoff/SKILL.md`: test planning/writing/execution must be delegated to `@testing-manager`.
	- Confirmed env dependency chain:
		- Backend source of truth: `getAuthState()` in `backend/src/plugins/auth.ts`.
		- `authEnabled` comes from `AUTH_ENABLED`.
		- `registrationEnabled` is `REGISTRATION_ENABLED || !hasUsers`.
		- `formLoginEnabled` is `needsSetup || (AUTH_ENABLED && FORM_LOGIN_ENABLED)`.
		- OIDC visibility/flow depends on `OIDC_ENABLED` (+ OIDC config vars).
	- Identified why current E2E auth setup can fail in SSO-only mode: `frontend/e2e/auth.setup.ts` assumes `#username/#password` are always present.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Hand off requested Playwright implementation scope to `@testing-manager` with concrete file-level guidance.

### 2026-02-27 (intake reminder fallback removal)

- 🧩 Task: Make intake reminders strictly per-intake and remove medication-level fallback override.
- ✅ Decisions:
	- In `backend/src/services/intake-reminder-scheduler.ts`, removed effective reminder condition `intake.intakeRemindersEnabled || med.intakeRemindersEnabled`.
	- Reminder eligibility is now strictly `intake.intakeRemindersEnabled`.
	- Removed medication-level fallback argument when parsing intakes for reminder checks (`parseIntakesJson(..., false)`).
	- Medication prefilter now checks whether any intake has `intakeRemindersEnabled=true`.
- 📁 Files touched:
	- `backend/src/services/intake-reminder-scheduler.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Legacy medications that relied only on medication-level reminder flag will no longer trigger reminders until intake-level flags are enabled.

### 2026-02-27 (remove legacy `medassist.db` leftovers)

- 🧩 Task: Investigate why `backend/data/medassist.db` and `data/medassist.db` existed and remove old-path remnants.
- ✅ Decisions:
	- Verified runtime DB path is `medassist-ng.db` via `getDbPaths()` in `backend/src/db/db-utils.ts`; no production code references `medassist.db`.
	- Found remaining string references only in `backend/src/test/db-client.test.ts` mocks/assertions.
	- Updated those test references to `medassist-ng.db` and removed legacy files `backend/data/medassist.db` and `data/medassist.db` from disk.
- 📁 Files touched:
	- `backend/src/test/db-client.test.ts`
	- `backend/data/medassist.db` (removed)
	- `data/medassist.db` (removed)
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- None; global search shows no remaining `medassist.db` code references.

### 2026-02-27 (split-and-ship all pending local changes)

- 🧩 Task: Split one large local working tree into coherent PRs and merge all to `main` end-to-end.
- ✅ Decisions:
	- Created and merged 4 PRs to keep scopes reviewable while ensuring all pending changes were shipped.
	- PR mapping:
		- #334 `feat/form-login-enabled` (Issue #309)
		- #336 `chore/improve-logging` (Issue #335)
		- #339 `fix/typescript-strictness-react19` (Issue #337)
		- #341 `chore/dependabot-agent-governance` (Issue #340)
	- For PR #341, required checks were initially skipped by path filtering; added minimal no-op backend/frontend comment touches so required checks executed and merge satisfied ruleset.
	- Verified linked project items for issues `#309`, `#335`, `#337`, `#340` are `Done`.
- 📁 Files touched:
	- All changed files were fully distributed across PRs and merged.
	- Mandatory reporting updated: `doku/memory_notes.md`, `doku/report.md`.
- 🔜 Follow-up/open points:
	- None pending from this split/merge task.

### 2026-02-27 (pre-PR gate validation for `chore/dependabot-agent-governance`)

- 🧩 Task: Validate minimal relevant local non-interactive checks for governance/config/docs changes.
- ✅ Decisions:
	- Confirmed changed scope with `git status --short` and validated only listed files.
	- Ran repo-defined lint gate (`npm run lint`) to satisfy local pre-PR lint requirement.
	- Ran parser-level YAML/frontmatter checks for changed `.yml` and agent markdown files.
	- Ran a targeted `markdownlint-cli2` check; it reported many style errors, but this linter is not part of this repository's configured gate.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Local pre-PR gate for this scope is satisfied by configured checks (lint + syntax validation); optional markdown style cleanup can be handled in a separate docs-formatting pass.

### 2026-02-27 (PR3 local gate rerun after MedDetailModal test fix)

- 🧩 Task: Re-run PR3 local gate on `fix/typescript-strictness-react19` after `MedDetailModal` assertion fix.
- ✅ Decisions:
	- Re-ran `frontend check` via `CI=true npm --prefix /Users/danielvolz/git/medassist/frontend run check`.
	- Re-ran the same focused Vitest subset from prior gate run (12 files including `MedDetailModal.test.tsx`).
	- Treated React `act(...)` warnings and JSDOM `scrollTo()` notices as non-blocking because all tests passed.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Pre-PR local gate for the requested frontend scope is now satisfied.

### 2026-02-27 (pre-PR gate validation for `fix/typescript-strictness-react19`)

- 🧩 Task: Validate minimal relevant local non-interactive frontend lint/tests for React 19 + TS strictness scope.
- ✅ Decisions:
	- Ran only frontend checks relevant to the changed scope: `check` (Biome + `tsc --noEmit`) and targeted Vitest on changed test files.
	- Treated React `act(...)` warnings and JSDOM `scrollTo` notices as non-blocking because they did not fail tests.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Gate is blocked by one failing test assertion in `src/test/components/MedDetailModal.test.tsx` expecting `undefined` where implementation currently passes `false` as second arg to `onSubmitRefill`.

### 2026-02-27

- 🧩 Task: Implement Issue #309 — Optionally disable form login when OIDC enabled
- ✅ Decisions:
  - Env var: `FORM_LOGIN_ENABLED` (not `LOCAL_AUTH_ENABLED` — "local" is ambiguous, "form login" matches the UI element)
  - Renamed internal field `localAuthEnabled` → `formLoginEnabled` throughout for consistency
  - Default `true` for backward compat
  - First-user override: form login forced on when no users exist (needsSetup)
  - Lockout guard: startup error when no login method available
  - Mismatch warning: log when REGISTRATION_ENABLED=true but form login off
  - No DB changes, no i18n changes, no README update
- 📁 Files touched:
  - `backend/src/plugins/env.ts` — added FORM_LOGIN_ENABLED + validation
  - `backend/src/plugins/auth.ts` — renamed field + wired to env var + first-user override
  - `backend/src/routes/auth.ts` — renamed guard references + error code
  - `frontend/src/components/Auth.tsx` — renamed interface + conditionals
  - `frontend/src/test/components/Auth.test.tsx` — renamed in mocks
  - `frontend/src/test/components/AppHeader.test.tsx` — renamed in mocks
  - `backend/src/test/auth.test.ts` — renamed env mock + assertion
  - `.env.example` — documented new var
- 🔜 Follow-up: E2E tests for OIDC-only mode (delegate to @testing-manager)

### 2026-02-27 (pre-PR gate validation for chore/improve-logging)

- 🧩 Task: Validate local lint/tests for branch `chore/improve-logging` on changed logging/nginx/backend-route files.
- ✅ Decisions:
	- Ran minimal relevant non-interactive checks only: backend lint, frontend lint, and targeted backend route test file (`e2e-routes.test.ts`).
	- No additional broad suites were executed to keep scope minimal.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Frontend lint still reports one warning in `frontend/src/components/MedicationAvatar.tsx` (`useExhaustiveDependencies`, extra dependency `imageUrl`).
	- Pre-PR gate is not clean until this lint warning is resolved.

### 2026-02-26

- Added mandatory memory/report persistence rules to `.github/copilot-instructions.md` and `AGENTS.md`.
- Removed obsolete mandatory persistence rule for `doku/APP_BEHAVIOR.md` from `AGENTS.md`.
- Created `doku/memory_notes.md` and `doku/report.md` as the new required persistence/reporting files.

### 2026-02-26 — Logging Implementation Plan

- 🧩 Task: Create implementation plan to fix noisy logging (nginx 5s polling spam, missing timestamps, unfilterable levels).
- ✅ Decisions:
  - Use Fastify per-route `logLevel` option (not `disableRequestLogging`) to suppress health/polling request logs.
  - Suppress `GET /doses/taken` and `GET /health` at `info` level (visible at `debug`).
  - Add separate nginx location blocks for polling paths with `access_log off` at `info` level.
  - Add ISO timestamps to startup logger (`backend/src/utils/logger.ts`).
  - Add `pino-pretty` as devDependency for human-readable dev logs.
  - Use nginx `log_format timed` with `$time_iso8601`.
- 📁 Files touched: `plan/feature-structured-logging-1.md` (created).
- 🔜 Follow-up: Implement the plan (5 phases, 18 tasks).

### 2026-02-26 — Logging Plan Implementation (complete)

- 🧩 Task: Implement all 5 phases of the structured logging plan.
- ✅ Decisions:
  - Phase 1: Added `logLevel: 'warn'` to `GET /health`, `logLevel: 'debug'` to `GET /doses/taken` and `GET /share/:token/doses` — suppresses Pino automatic request logs at `info` level.
  - Phase 2: Updated startup logger (`backend/src/utils/logger.ts`) to prepend `[ISO timestamp] [LEVEL]` prefix. Added `pino-pretty` devDependency with transport config active only when `NODE_ENV !== 'production' && !== 'test'`.
  - Phase 3+4: nginx.conf now has dedicated location blocks for polling endpoints using `${NGINX_POLLING_LOG}` variable. `nginx-entrypoint.sh` differentiates `debug` (all logs) / `info` (polling suppressed) / `warn+` (all suppressed). Added `log_format timed` with ISO timestamps.
  - Phase 5: Updated `.env.example` and `README.md` with detailed LOG_LEVEL behavior descriptions.
- 📁 Files touched:
  - `backend/src/routes/health.ts` — logLevel: 'warn'
  - `backend/src/routes/doses.ts` — logLevel: 'debug' on GET /doses/taken and GET /share/:token/doses
  - `backend/src/utils/logger.ts` — ISO timestamps on all startup log messages
  - `backend/src/index.ts` — pino-pretty transport for dev mode
  - `backend/package.json` — added pino-pretty devDependency
  - `frontend/nginx.conf` — polling location blocks, log_format timed
  - `frontend/nginx-entrypoint.sh` — 3-tier LOG_LEVEL logic (debug/info/warn+)
  - `.env.example` — expanded LOG_LEVEL docs
  - `README.md` — expanded LOG_LEVEL description
- 🔜 Follow-up: Docker build + manual verification (TEST-004 through TEST-008). Hand off to @testing-manager for any automated test coverage.

### 2026-02-26 (follow-up)

- Added a short "How to maintain" template section to this file and to `doku/report.md`.
- Updated report entry so this follow-up is documented for user review.

### 2026-02-26 (emoji template follow-up)

- Added emoji-based label conventions for faster scanning in this file template.
- Updated `doku/report.md` template to match the same emoji convention.

### 2026-02-26 (testing-manager instruction hardening)

- 🧩 Task: Strengthen `testing-manager` agent instructions for lint gates, real/reliable tests, and current test setup commands.
- ✅ Decisions:
	- Added hard lint gate: all errors and simple/fixable warnings must be resolved before PR-ready handoff.
	- Added explicit anti-fake-test rules and validity checklist to enforce real functional verification and regression safety.
	- Updated backend/frontend Vitest commands to non-watch CI-safe `test:run` usage and aligned Playwright examples.
- 📁 Files touched:
	- `.github/agents/testing-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep this instruction set mirrored if additional testing policy docs are introduced later.

### 2026-02-26 (pre-PR local quality gate clarification)

- 🧩 Task: Clarify that PRs must not be created before local lint/tests are green.
- ✅ Decisions:
	- Added explicit rule: before PR creation, all lint errors and relevant tests must pass locally.
	- Added explicit rule: no CI-first failures; broken behavior must reproduce and be fixed locally before handoff.
- 📁 Files touched:
	- `.github/agents/testing-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Apply same wording to other governance docs only if requested.

### 2026-02-26 (release-manager local gate alignment)

- 🧩 Task: Apply the same pre-PR local lint/test gate policy to `release-manager` instructions.
- ✅ Decisions:
	- Added explicit pre-PR local quality gate requirement to `release-manager` critical rules.
	- Added explicit no CI-first-failure policy for release orchestration.
	- Updated PR workflow steps to require local gate confirmation before push/PR creation.
- 📁 Files touched:
	- `.github/agents/release-manager.agent.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep both manager agents (`testing-manager`, `release-manager`) aligned on this gate language.

### 2026-02-26 (React 19 upgrade best-practice clarification)

- 🧩 Task: Validate and refine the React 19 upgrade plan with official guidance.
- ✅ Decisions:
	- Keep `@types/react` and `@types/react-dom`, but bump both to `^19.x` during the React upgrade.
	- Do not force `useContext` to `use()` migration in the upgrade PR; only fix what is required for compatibility.
	- Keep strict scope boundary: version upgrade only; adopt new React 19 features in separate follow-up PRs.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- When implementation starts, apply the same scope boundary in commit and PR structure.

### 2026-02-26 (React 19 implementation)

- 🧩 Task: Implement the scoped React 19 dependency upgrade.
- ✅ Decisions:
	- Upgraded `react`/`react-dom` to `^19.2.0`.
	- Kept `@types/react` and `@types/react-dom` and upgraded both to `^19.2.2`.
	- Did not include optional API migrations (`useContext` to `use()`, Actions APIs, RSC changes).
- 📁 Files touched:
	- `frontend/package.json`
	- `frontend/package-lock.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Run local install/lint/check in a dedicated testing handoff to validate full dependency tree behavior.

### 2026-02-26 (testing handoff run for React 19 upgrade)

- 🧩 Task: Execute frontend lint/check/relevant tests and apply only mandatory compatibility fixes.
- ✅ Decisions:
	- Fixed only strict compatibility/type issues in touched tests (`ics`, `schedule`, `MobileEditModal`) without feature migration.
	- Did not expand scope into broad unrelated test refactors.
- 📁 Files touched:
	- `frontend/src/test/utils/ics.test.ts`
	- `frontend/src/test/utils/schedule.test.ts`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- `frontend check` still blocked by unrelated `MedDetailModal.test.tsx` prop-shape mismatches (`usePrescriptionRefill`, `onUsePrescriptionRefillChange`, and `RefillEntry` field changes).
	- Existing lint warning remains in `frontend/src/components/MedicationAvatar.tsx` (`useExhaustiveDependencies`).

### 2026-02-26 (blocker follow-up: lint fix + testing-manager handoff)

- 🧩 Task: Remove remaining lint warning and prepare formal handoff for out-of-scope MedDetailModal test drift.
- ✅ Decisions:
	- Fixed `MedicationAvatar` warning by tracking previous `imageUrl` via ref in effect logic.
	- Kept `MedDetailModal.test.tsx` changes out of this implementation due testing ownership boundary and prepared explicit handoff content instead.
- 📁 Files touched:
	- `frontend/src/components/MedicationAvatar.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- `@testing-manager` should align `MedDetailModal` tests with current `MedDetailModalProps` (`usePrescriptionRefill`, `onUsePrescriptionRefillChange`) and `RefillEntry` shape (`refillDate`, `loosePillsAdded`).

### 2026-02-26 (automatic delegation preference applied)

- 🧩 Task: Apply user preference to delegate testing work automatically without additional confirmation prompts.
- ✅ Decisions:
	- Hand off residual test/type drift work to `@testing-manager` immediately when detected.
	- Do not pause for approval before delegation unless there is a blocking ambiguity.
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Keep this delegation style for future testing ownership boundaries.

### 2026-02-26 (continued type-fix sweep to green frontend check)

- 🧩 Task: Continue and clear remaining `frontend check` blockers after delegated MedDetailModal fixes.
- ✅ Decisions:
	- Applied minimal compatibility fixes in production files only where type/lint failed (`MobileEditModal`, `SharedSchedule`, `AppContext`, `dashboard-helpers`, `DashboardPage`, `stock.ts`).
	- Applied fixture-only updates in tests for new required `Medication`/`StockThresholds` shapes and minor mock typing issues.
	- Kept scope to type/lint compatibility; no feature behavior migration.
- 📁 Files touched:
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/components/SharedSchedule.tsx`
	- `frontend/src/context/AppContext.tsx`
	- `frontend/src/pages/dashboard-helpers.ts`
	- `frontend/src/pages/DashboardPage.tsx`
	- `frontend/src/utils/stock.ts`
	- `frontend/src/test/setup.ts`
	- `frontend/src/test/components/Lightbox.test.tsx`
	- `frontend/src/test/components/UserFilterModal.test.tsx`
	- `frontend/src/test/context/AppContext.test.tsx`
	- `frontend/src/test/hooks/useMedications.test.ts`
	- `frontend/src/test/hooks/useRefill.test.ts`
	- `frontend/src/test/hooks/useSettings.test.ts`
	- `frontend/src/test/hooks/useShare.test.ts`
	- `frontend/src/test/utils/formatters.test.ts`
	- `frontend/src/test/utils/schedule.test.ts`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- `frontend check` is now green.
	- Focused tests pass; remaining broader suite execution can be done as separate validation step if requested.

### 2026-02-26 (npm EINTEGRITY fix)

- 🧩 Task: Resolve npm tarball corruption/integrity install failure after React 19 lockfile update.
- ✅ Decisions:
	- Verified official registry integrity values with `npm view` and corrected lockfile hashes.
	- Did not change versions; only fixed integrity metadata for `@types/react@19.2.2` and `@types/react-dom@19.2.2`.

### 2026-02-26 (dependency update automation)

- 🧩 Task: Implement automatic dependency update flow with safe merge policy.
- ✅ Decisions:
	- Extended existing `.github/dependabot.yml` instead of replacing it.
	- Added grouped minor/patch updates for root npm and GitHub Actions, plus scoped labels (`frontend`, `backend`, `root`).
	- Added `.github/workflows/dependabot-automerge.yml` to enable auto-merge only for Dependabot npm/GitHub Actions patch+minor updates.
	- Kept major updates manual by design.
	- Synced docs in `README.md` and updated React badge to 19.
- 📁 Files touched:
	- `.github/dependabot.yml`
	- `.github/workflows/dependabot-automerge.yml`
	- `README.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- If branch protection requires specific checks, ensure required status checks are set so auto-merge waits correctly.
- 📁 Files touched:
	- `frontend/package-lock.json`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- `npm ci` now succeeds cleanly.

### 2026-02-26 (npm deprecation warnings assessment)

- 🧩 Task: Assess reported npm deprecation warnings and identify real source/package owners.
- ✅ Decisions:
	- Warnings are not from `frontend`; they originate in `backend` transitive dependencies.
	- `@esbuild-kit/*` comes from `drizzle-kit@0.31.9` (currently latest).
	- `node-domexception` comes via `@libsql/client -> node-fetch -> fetch-blob` (currently latest published chain).
	- Treat as non-blocking upstream warnings for now (no local secure/functional regression).
- 📁 Files touched:
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Re-check on future dependency releases; warnings can be removed once upstream chains migrate.

### 2026-02-26 (MedDetailModal test type drift fix)

- 🧩 Task: Unblock the targeted `MedDetailModal` test type drift after React 19 changes.
- ✅ Decisions:
	- Kept scope minimal and test-only: updated `frontend/src/test/components/MedDetailModal.test.tsx` only.
	- Added missing required props in `defaultProps`: `usePrescriptionRefill`, `onUsePrescriptionRefillChange`.
	- Updated `RefillEntry` fixtures to current shape by replacing legacy fields with `refillDate` and `loosePillsAdded`.
	- Did not run the targeted test command because the requested precondition (`npm run check` passing) is not met.
- 📁 Files touched:
	- `frontend/src/test/components/MedDetailModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- `frontend check` remains blocked by unrelated TypeScript errors in other files (outside MedDetailModal test scope).

### 2026-02-27 (package types plan decision lock)

- 🧩 Task: Capture user-approved decisions for lifecycle derivation and V1 scope in package type planning.
- ✅ Decisions:
	- `ongoing` is derived from `endDate == null` and should not be stored as an explicit lifecycle value.
	- V1 form scope remains exactly 4 forms (`Capsule`, `Tablet`, `Liquid`, `Topical`) without subforms.
	- `autoMarkObsoleteAfterEndDate` default is `true`.
	- Updated wording to remove ambiguous `restore` label in lifecycle section.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Reflect these locked decisions in implementation tickets before coding starts.

### 2026-02-27 (implemented V1 medication form model in web app)

- 🧩 Task: Implement the approved V1 medication-form concept end-to-end on website (desktop + mobile) with persistence.
- ✅ Decisions:
	- Added persisted fields: `medicationForm`, `pillForm`, `lifecycleCategory`, `medicationEndDate`, `autoMarkObsoleteAfterEndDate`.
	- Kept `ongoing` derived only: no explicit stored `ongoing` value introduced.
	- Enforced validation rules:
		- `pillForm` required for capsule/tablet medication forms.
		- fractional intake forbidden for capsule.
		- liquid/topical restricted to bottle container.
	- Implemented automatic obsolete marking during medication fetch when end date has passed and auto-mark toggle is enabled.
	- Preserved desktop/mobile parity by adding identical form controls to `MedicationsPage` and `MobileEditModal`.
	- Updated export/import format to include new metadata (`EXPORT_VERSION` bumped to `1.2`).
- 📁 Files touched:
	- `backend/src/db/schema.ts`
	- `backend/src/db/db-utils.ts`
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/drizzle/0011_stiff_randall_flagg.sql`
	- `backend/drizzle/meta/_journal.json`
	- `backend/drizzle/meta/0011_snapshot.json`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Full repo-wide frontend `npm run check` still reports unrelated pre-existing e2e formatting issues outside this scope.

### 2026-03-02 (pre-PR frontend MedicationsPage label/order gate)

- 🧩 Task: Validate local pre-PR quality gate for `frontend/src/pages/MedicationsPage.tsx` UI label/order updates.
- ✅ Validation run:
	- `cd frontend && npm run lint` -> passed (`npx biome check .` reported no issues).
	- `cd frontend && CI=true npm run test:run -- src/test/utils/schedule.test.ts` -> passed (82/82).
	- `cd frontend && PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_WORKERS=1 npx playwright test e2e/medication-edit.spec.ts e2e/schedule.spec.ts --config=playwright.stable.config.ts --workers=1` -> passed (23/23).
- 📌 Outcome:
	- Local pre-PR gate for this scoped frontend change is PASS.

### 2026-02-27 (package types plan decision lock)

- 🧩 Task: Capture user-approved decisions for lifecycle derivation and V1 scope in package type planning.
- ✅ Decisions:
	- `ongoing` is derived from `endDate == null` and should not be stored as an explicit lifecycle value.
	- V1 form scope remains exactly 4 forms (`Capsule`, `Tablet`, `Liquid`, `Topical`) without subforms.
	- `autoMarkObsoleteAfterEndDate` default is `true`.
	- Updated wording to remove ambiguous `restore` label in lifecycle section.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Reflect these locked decisions in implementation tickets before coding starts.

### 2026-02-27 (implemented V1 medication form model in web app)

- 🧩 Task: Implement the approved V1 medication-form concept end-to-end on website (desktop + mobile) with persistence.
- ✅ Decisions:
	- Added persisted fields: `medicationForm`, `pillForm`, `lifecycleCategory`, `medicationEndDate`, `autoMarkObsoleteAfterEndDate`.
	- Kept `ongoing` derived only: no explicit stored `ongoing` value introduced.
	- Enforced validation rules:
		- `pillForm` required for capsule/tablet medication forms.
		- fractional intake forbidden for capsule.
		- liquid/topical restricted to bottle container.
	- Implemented automatic obsolete marking during medication fetch when end date has passed and auto-mark toggle is enabled.
	- Preserved desktop/mobile parity by adding identical form controls to `MedicationsPage` and `MobileEditModal`.
	- Updated export/import format to include new metadata (`EXPORT_VERSION` bumped to `1.2`).
- 📁 Files touched:
	- `backend/src/db/schema.ts`
	- `backend/src/db/db-utils.ts`
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/drizzle/0011_stiff_randall_flagg.sql`
	- `backend/drizzle/meta/_journal.json`
	- `backend/drizzle/meta/0011_snapshot.json`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Full repo-wide frontend `npm run check` still reports unrelated pre-existing e2e formatting issues outside this scope.

### 2026-02-27 (package types plan decision lock)

- 🧩 Task: Capture user-approved decisions for lifecycle derivation and V1 scope in package type planning.
- ✅ Decisions:
	- `ongoing` is derived from `endDate == null` and should not be stored as an explicit lifecycle value.
	- V1 form scope remains exactly 4 forms (`Capsule`, `Tablet`, `Liquid`, `Topical`) without subforms.
	- `autoMarkObsoleteAfterEndDate` default is `true`.
	- Updated wording to remove ambiguous `restore` label in lifecycle section.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Reflect these locked decisions in implementation tickets before coding starts.

### 2026-02-27 (implemented V1 medication form model in web app)

- 🧩 Task: Implement the approved V1 medication-form concept end-to-end on website (desktop + mobile) with persistence.
- ✅ Decisions:
	- Added persisted fields: `medicationForm`, `pillForm`, `lifecycleCategory`, `medicationEndDate`, `autoMarkObsoleteAfterEndDate`.
	- Kept `ongoing` derived only: no explicit stored `ongoing` value introduced.
	- Enforced validation rules:
		- `pillForm` required for capsule/tablet medication forms.
		- fractional intake forbidden for capsule.
		- liquid/topical restricted to bottle container.
	- Implemented automatic obsolete marking during medication fetch when end date has passed and auto-mark toggle is enabled.
	- Preserved desktop/mobile parity by adding identical form controls to `MedicationsPage` and `MobileEditModal`.
	- Updated export/import format to include new metadata (`EXPORT_VERSION` bumped to `1.2`).
- 📁 Files touched:
	- `backend/src/db/schema.ts`
	- `backend/src/db/db-utils.ts`
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/drizzle/0011_stiff_randall_flagg.sql`
	- `backend/drizzle/meta/_journal.json`
	- `backend/drizzle/meta/0011_snapshot.json`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Full repo-wide frontend `npm run check` still reports unrelated pre-existing e2e formatting issues outside this scope.

### 2026-02-27 (package types plan decision lock)

- 🧩 Task: Capture user-approved decisions for lifecycle derivation and V1 scope in package type planning.
- ✅ Decisions:
	- `ongoing` is derived from `endDate == null` and should not be stored as an explicit lifecycle value.
	- V1 form scope remains exactly 4 forms (`Capsule`, `Tablet`, `Liquid`, `Topical`) without subforms.
	- `autoMarkObsoleteAfterEndDate` default is `true`.
	- Updated wording to remove ambiguous `restore` label in lifecycle section.
- 📁 Files touched:
	- `doku/package_types.md`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Reflect these locked decisions in implementation tickets before coding starts.

### 2026-02-27 (implemented V1 medication form model in web app)

- 🧩 Task: Implement the approved V1 medication-form concept end-to-end on website (desktop + mobile) with persistence.
- ✅ Decisions:
	- Added persisted fields: `medicationForm`, `pillForm`, `lifecycleCategory`, `medicationEndDate`, `autoMarkObsoleteAfterEndDate`.
	- Kept `ongoing` derived only: no explicit stored `ongoing` value introduced.
	- Enforced validation rules:
		- `pillForm` required for capsule/tablet medication forms.
		- fractional intake forbidden for capsule.
		- liquid/topical restricted to bottle container.
	- Implemented automatic obsolete marking during medication fetch when end date has passed and auto-mark toggle is enabled.
	- Preserved desktop/mobile parity by adding identical form controls to `MedicationsPage` and `MobileEditModal`.
	- Updated export/import format to include new metadata (`EXPORT_VERSION` bumped to `1.2`).
- 📁 Files touched:
	- `backend/src/db/schema.ts`
	- `backend/src/db/db-utils.ts`
	- `backend/src/routes/medications.ts`
	- `backend/src/routes/export.ts`
	- `backend/drizzle/0011_stiff_randall_flagg.sql`
	- `backend/drizzle/meta/_journal.json`
	- `backend/drizzle/meta/0011_snapshot.json`
	- `frontend/src/types/index.ts`
	- `frontend/src/hooks/useMedicationForm.ts`
	- `frontend/src/pages/MedicationsPage.tsx`
	- `frontend/src/components/MobileEditModal.tsx`
	- `frontend/src/i18n/en.json`
	- `frontend/src/i18n/de.json`
	- `frontend/src/test/components/MobileEditModal.test.tsx`
	- `doku/memory_notes.md`
	- `doku/report.md`
- 🔜 Follow-up/open points:
	- Full repo-wide frontend `npm run check` still reports unrelated pre-existing e2e formatting issues outside this scope.
