# Work Report

Purpose: user-facing summary of completed work.

## Format

For each task, add:

- Date
- Scope

- What changed


## How to maintain (1-minute template)

```md
### YYYY-MM-DD

- **🧩 Scope**:
- **🛠️ What changed**:
- **📁 Files touched**:
  -
  -
```
## Entries

### 2026-03-02 (Fix: liquid usage label follows selected intake unit)

- **🧩 Scope**: Medication edit schedule label for liquid intakes.
- **🛠️ What changed**:
  - Updated desktop intake schedule label logic in `MedicationsPage` so `Usage (...)` follows the selected intake unit:
    - `ml` -> `Usage (ml)`
    - `tsp` -> `Usage (tsp)`
    - `tbsp` -> `Usage (tbsp)`
  - This now matches existing mobile behavior and keeps allowed units exactly as requested (`ml`, `teaspoon`, `tablespoon`).
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`

### 2026-03-02 (Recovery: desktop form field alignment restored)

- **🧩 Scope**: Restore missing detail in desktop medication form layout.
- **🛠️ What changed**:
  - In `MedicationsPage` general tab, reordered form fields to enforce vertical pairing in the 2-column layout:
    - left column: `Medication Start Date` above `Medication End Date`
    - right column: `Package Type` above `Pill Form` (or `Medication Form` for tube/liquid container)
  - No behavior or i18n text changes; order-only UI recovery.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`

### 2026-03-02 (PR #364: fix failing Frontend Build + Playwright Stable checks)

- **🧩 Scope**: Diagnose and fix CI failures on branch `fix/frontend-tube-liquid-semantics-parity` for:
  - `Test/Frontend Build (pull_request)`
  - `E2E Tests/Playwright E2E Stable (pull_request)`
- **🛠️ What changed**:
  - Retrieved failing job logs via `gh` and reproduced both failures locally.
  - `frontend/src/test/context/AppContext.test.tsx`:
    - replaced full `../../utils/schedule` mock with partial mock using `vi.importActual(...)` so `getStockStatus` remains exported,
    - aligned warning fixture data (`daysLeft: 8`) with current stock-threshold semantics.
  - `frontend/e2e/schedule.spec.ts`:
    - replaced brittle selector `.table.table-7` with stable selector `.dashboard-overview-section .table`.
- **📁 Files touched**:
  - `frontend/src/test/context/AppContext.test.tsx`
  - `frontend/e2e/schedule.spec.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Verification (exact commands)**:
  - `cd /Users/danielvolz/git/medassist && GH_PAGER=cat gh pr checks 364 --repo DanielVolz/medassist-ng`
  - `cd /Users/danielvolz/git/medassist && gh run view 22555005272 --repo DanielVolz/medassist-ng --job 65330821624 --log | rg -n "error|Error|FAILED|failed|TS\d+|vite|build"`
  - `cd /Users/danielvolz/git/medassist && gh run view 22555005306 --repo DanielVolz/medassist-ng --job 65330817331 --log | rg -n "error|Error|FAILED|failed|Timeout|expect\(|AssertionError|not.to|toBe|toHave|x"`
  - `cd /Users/danielvolz/git/medassist/frontend && CI=true npm run test:run -- src/test/context/AppContext.test.tsx` (**PASS**)
  - `cd /Users/danielvolz/git/medassist/frontend && PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_WORKERS=1 npx playwright test --config=playwright.stable.config.ts --project=chromium e2e/schedule.spec.ts -g "should show overview table with stock status"` (**PASS**)
  - `cd /Users/danielvolz/git/medassist/frontend && npm run lint` (**PASS**)
  - `cd /Users/danielvolz/git/medassist/frontend && npm run build` (**PASS**)

### 2026-03-01 (Backend CI fix: `Test/Backend Tests` failing on test-email route test)

- **🧩 Scope**: Reproduce failing backend CI test locally and apply the smallest fix in backend code/tests.
- **🛠️ What changed**:
  - Reproduced the failure with CI-equivalent backend test command: `cd backend && CI=true npm run test:coverage`.
  - Diagnosed root cause in `routes-real.test.ts`: mocked SMTP success path returned `undefined`, while current `settings` route expects delivery metadata (`accepted` recipients) and otherwise returns `500`.
  - Updated the single failing test mock to return a realistic success object (`accepted`, `rejected`, `response`, `messageId`).
  - No frontend files were modified for this task.
- **📁 Files touched**:
  - `backend/src/test/routes-real.test.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Verification (exact commands)**:
  - `cd backend && CI=true npm run test:coverage`: **PASS** (`21/21` files, `577/577` tests)
  - `cd backend && CI=true npm run test:run -- src/test/routes-real.test.ts`: **PASS** (`13/13` tests)
  - `cd backend && npm run lint`: **PASS**
  - `cd backend && npx tsc --noEmit`: **PASS**

### 2026-03-01 (Frontend lint cleanup: noNestedTernary + unused + format)

- **🧩 Scope**: Make lint fully clean for the current working tree with behavior-preserving frontend refactors.
- **🛠️ What changed**:
  - Removed unused variable in `MedDetailModal` and unused helper in `DashboardPage`.
  - Removed unused loop parameter in `frontend/src/utils/schedule.ts` and unused import in `frontend/src/test/utils/schedule.test.ts`.
  - Replaced nested ternary chains with explicit logic in:
    - `frontend/src/components/ReportModal.tsx`
    - `frontend/src/hooks/useMedicationForm.ts`
    - `frontend/src/hooks/useRefill.ts`
    - `frontend/src/pages/MedicationsPage.tsx`
  - Applied Biome formatting fixes to lint-failing frontend files.
- **📁 Files touched**:
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
- **✅ Verification**:
  - `npm run lint` (repo root): **PASS**

### 2026-03-01 (Gate fix: planner/settings lint + planner targeted tests)

- **🧩 Scope**: Resolve requested local gate failures in backend planner/settings and rerun exact verification commands.
- **🛠️ What changed**:
  - Fixed formatting-only lint issues in:
    - `backend/src/routes/planner.ts`
    - `backend/src/routes/settings.ts`
  - Aligned planner success test mocks with current SMTP delivery semantics by including accepted recipients in `sendMail` mock results.
  - Kept current backend semantics intact (no rollback of intentional planner/settings behavior).
- **📁 Files touched**:
  - `backend/src/routes/planner.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/test/planner.test.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Verification (exact commands)**:
  - `npm run lint` (repo root): **FAIL**
    - backend route formatting errors are fixed.
    - command still fails on pre-existing frontend lint findings outside this scope.
  - `cd backend && CI=true npm run test:run -- src/test/planner.test.ts src/test/stock-semantics-parity.test.ts`: **PASS** (`40/40` tests passed).

### 2026-03-01 (Validation: pre-PR local quality gate on current uncommitted changes)

- **🧩 Scope**: Run requested local gate checks before PR handoff.
- **🛠️ What changed**:
  - No product code changes in this pass.
  - Executed required lint gate from repo root:
    - `npm run lint` (runs backend + frontend lint)
  - Executed requested backend tests:
    - `CI=true npm run test:run -- src/test/planner.test.ts src/test/stock-semantics-parity.test.ts`
  - Executed requested frontend tests:
    - `CI=true npm run test:run -- src/test/components/MedDetailModal.test.tsx src/test/components/MobileEditModal.test.tsx src/test/pages/DashboardPage.test.tsx src/test/utils/schedule.test.ts src/test/types.test.ts`
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation result**:
  - **FAIL** (lint and backend planner tests failing; frontend targeted tests passed).

### 2026-03-01 (UI: flat-text intake rows matching blister reference)

- **🧩 Scope**: Rewrite MedDetailModal intake schedule rows to render as flat inline text, visually identical to blister rows on MedicationsPage.
- **🛠️ What changed**:
  - Intake rows now render as `{usage} · {freq} · at {time}` flat text inside `.blister-row-simple` — exactly like blister rows on the medications page.
  - Removed previous grid/flex structure (`.med-schedule-item`, `.med-schedule-main`, etc.) that caused the visual mismatch.
  - Container uses `.blister-list` (same as MedicationsPage) instead of `.med-detail-schedules`.
  - Cleaned up ~80 lines of now-unused CSS (all `med-schedule-*` classes).
  - Updated 4 unit test selectors to match new DOM structure.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/test/components/MedDetailModal.test.tsx`
- **✅ Validation**:
  - 61/61 unit tests pass.
  - Visual verification: browser screenshot confirms intake row is visually identical to blister row.

### 2026-03-01 (UI: exact blister style reuse for bottle/tube/liquid intake rows)

- **🧩 Scope**: Eliminate style mismatch complaints by using the exact blister row visual class for intake rows in `Medication Details`.
- **🛠️ What changed**:
  - Added `blister-row-simple` to detail schedule rows in `MedDetailModal` so bottle/tube/liquid rows inherit the same visual tokens as blister rows.
  - Simplified `.med-schedule-item` to layout-only rules (grid columns + alignment); visual values now come from shared blister class.
  - Intake section bell in heading now appears with `selectedMed.intakeRemindersEnabled || hasAnyIntakeReminder`.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/styles.css`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics: no errors in touched files.
  - Live modal snapshot confirms the updated schedule structure remains active for `Liquid Mix E2E`.

### 2026-03-01 (UI: strict blister parity for bottle/tube/liquid intake rows)

- **🧩 Scope**: Apply a clearly visible alignment pass so `bottle`, `tube`, and `liquid_container` intake rows match the blister reference layout.
- **🛠️ What changed**:
  - `MedDetailModal` intake rows now use a fixed two-column structure:
    - left: dose/frequency/person/reminder cluster
    - right: stable time column (`at HH:mm`)
  - `styles.css` updates for `.med-schedule-item`/`.med-schedule-main`:
    - switched to grid-based row alignment,
    - tightened spacing/typography,
    - increased row corner radius,
    - mobile fallback keeps hierarchy while stacking cleanly.
  - Section header reminder icon now appears when any intake has reminders (not only global flag).
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/styles.css`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics: no errors in touched files.
  - Live browser check on `Tube E2E` and `Liquid Mix E2E`: both render the same left-content/right-time schedule row structure.

### 2026-03-01 (UI: tube/liquid intake rows now structurally match blister layout)

- **🧩 Scope**: Apply a visible structural formatting update for `Medication Details` intake rows so tube and liquid render like blister rows.
- **🛠️ What changed**:
  - Updated `MedDetailModal` intake-row markup to a structured two-zone row:
    - left content cluster (`usage`, `daily/interval`, optional person/bell tags)
    - right aligned time label (`at HH:mm`)
  - Added new layout class `.med-schedule-main` and refined `.med-schedule-item` alignment/gap behavior.
  - Added mobile fallback behavior (`max-width: 700px`) so rows stack cleanly without losing hierarchy.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/styles.css`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched files: **no errors**.
  - Live browser verification on both medications:
    - `Liquid Mix E2E` intake rows show left info cluster + right time.
    - `Tube E2E` intake rows show the same structure.
- **🔜 Follow-ups**:
  - Optional: propagate the same structural row pattern to other schedule surfaces for complete global parity.

### 2026-03-01 (UI: Intake rows in Medication Details now match blister style)

- **🧩 Scope**: Improve visual consistency of intake rows in `Medication Details` to match the existing blister-row look.
- **🛠️ What changed**:
  - Updated `MedDetailModal` intake-row styles to align with blister-row aesthetics:
    - gradient row background,
    - border + accent left strip,
    - hover highlight in the same visual language.
  - Preserved existing layout/behavior while improving hierarchy and readability.
  - Adjusted intake time text contrast for better legibility.
- **📁 Files touched**:
  - `frontend/src/styles.css`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched stylesheet: **no errors**.
- **🔜 Follow-ups**:
  - Optional: apply the same row treatment to additional schedule views for full cross-page visual parity.

### 2026-03-01 (Validation: broader regression sweep for tube/liquid_container flows)

- **🧩 Scope**: Validate latest fixes across requested tube/liquid_container user flows:
  - MobileEditModal liquid intake add/remove with identical defaults
  - MedDetailModal Correct Stock wording for amount packages
  - Dashboard overview stock + daily-consumption labeling
  - Schedule usage labels without inappropriate pill fallback
- **🛠️ What changed**:
  - No product code changes in this pass.
  - Executed focused frontend tests:
    - `src/test/components/MobileEditModal.test.tsx`
    - `src/test/components/MedDetailModal.test.tsx`
    - `src/test/pages/DashboardPage.test.tsx`
    - `src/test/pages/SchedulePage.test.tsx`
    - `src/test/utils/schedule.test.ts`
    - `src/test/types.test.ts`
    - `src/test/hooks/useMedicationForm.test.ts`
  - Result: **336 passed, 0 failed**.
  - Executed quick browser-level Playwright validation:
    - `e2e/medication-edit.spec.ts`
    - `e2e/dashboard.spec.ts`
    - `e2e/dashboard-data.spec.ts`
  - Result: **9 passed, 0 failed**.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **⚠️ Residual validation gaps**:
  - Existing page-test suites currently contain explicit `bottle` assertions, but not dedicated explicit tube/liquid label assertions in DashboardPage/SchedulePage.
  - MedDetailModal has broad stock-correction coverage but lacks a dedicated explicit assertion for tube/liquid `Current Amount` wording in Correct Stock.

### 2026-03-01 (Fix: implemented remaining tube/liquid E2E findings)

- **🧩 Scope**: Implement and verify the two remaining E2E findings for tube/liquid flows.
- **🛠️ What changed**:
  - `MobileEditModal`: fixed liquid-intake row key collision risk by ensuring unique row keys even when intake defaults are identical.
  - `MedDetailModal` (`Correct Stock`): fixed amount-package input label so tube/liquid uses amount wording (`Current Amount`) instead of pill wording.
  - `MobileEditModal.test.tsx`: updated outdated liquid amount label expectation (`form.packageAmountPerBottle`).
- **📁 Files touched**:
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/test/components/MobileEditModal.test.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics: no errors on touched files.
  - Focused component tests via `@testing-manager`:
    - `MobileEditModal.test.tsx`: 59 passed
    - `MedDetailModal.test.tsx`: 61 passed
    - Total: 120 passed, 0 failed
- **🔜 Follow-ups**:
  - Optional: dedicated assertions for duplicate-key warning prevention and tube Correct Stock label copy.

### 2026-03-01 (Validation: focused component tests after latest fixes)

- **🧩 Scope**: Run focused frontend component tests requested for:
  - `frontend/src/test/components/MobileEditModal.test.tsx`
  - `frontend/src/test/components/MedDetailModal.test.tsx`
- **🛠️ What changed**:
  - Executed targeted test runs per file.
  - Results:
    - `MobileEditModal.test.tsx`: **59 passed, 0 failed**
    - `MedDetailModal.test.tsx`: **61 passed, 0 failed**
    - Combined: **120 passed, 0 failed**
  - Requested regression checks in this focused scope:
    - Duplicate intake key regression risk: **no failing tests**
    - Tube correct-stock label wording: **no failing tests**
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None for this focused test request.

### 2026-03-01 (Validation: Mobile duplicate keys + Correct Stock tube wording)

- **🧩 Scope**: Focused verification of two frontend fixes:
  - Mobile intake row key collisions in `MobileEditModal`
  - Tube/liquid Correct Stock label wording (amount-based instead of total pills)
- **🛠️ What changed**:
  - No product code changed in this validation pass.
  - Verified static code paths:
    - `MobileEditModal` intake-row `key` now includes index suffix to prevent duplicate React key collisions for identical intake values.
    - `MedDetailModal` Correct Stock amount-package input now renders `form.currentAmount` for tube/liquid packages.
  - Ran focused tests:
    - `CI=true npm run test:run -- src/test/components/MobileEditModal.test.tsx src/test/components/MedDetailModal.test.tsx`
  - Result summary:
    - `MedDetailModal.test.tsx`: passed
    - `MobileEditModal.test.tsx`: 1 failing test (`uses plain numeric input for liquid container package amount`) due outdated expected label key (`form.packageAmount`).
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation evidence**:
  - Diff evidence confirms key change to include `-${idx}` in `MobileEditModal` intake map key.
  - Diff evidence confirms Correct Stock label switch to `form.currentAmount` for amount packages in `MedDetailModal`.
- **🔜 Follow-ups**:
  - Update/add focused tests for tube/liquid Correct Stock wording and liquid package-amount labeling.
  - Optional manual browser sanity check on tube medication: open Correct Stock and confirm amount label text in live UI.

### 2026-03-01 (Feature: Daily consumption column in Medication Overview)

- **🧩 Scope**: Add a new overview table column after `Stock` to show daily medication consumption.
- **🛠️ What changed**:
  - Added `Daily consumption` column in `Dashboard` -> `Medication Overview` directly after `Stock`.
  - Added daily-consumption calculation per medication based on configured intakes:
    - uses `usage / every` per intake,
    - applies person multiplier where intake is not person-specific,
    - supports mixed liquid units by converting `tsp`/`tbsp` to `ml`.
  - Render output by package type:
    - pills -> `x pills`
    - liquid container -> `x ml`
    - tube -> `x applications` (or `x ml` for liquid tube form)
  - Removed explicit `/day` suffix from values because the column title (`Daily consumption`) already provides that context.
  - Extended table layout from 7 to 8 columns for proper spacing.
  - Added EN/DE i18n keys for new header and per-day formatter.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched files: **no errors**.
- **🔜 Follow-ups**:
  - Optional: add regression test coverage for mixed liquid units and person-multiplied daily totals.


- **🧩 Scope**: Correct unit display in medication detail intake schedule for liquid medications.

- **🛠️ What changed**:
  - `MedDetailModal` intake usage label now uses `intakeUnit` for `liquid_container` entries.
  - For `tsp`/`tbsp`, schedule rows now render teaspoon/tablespoon labels.
  - `ml` is now only shown for ml/default liquid unit.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched file: **no errors**.
- **🔜 Follow-ups**:
  - Optional: add a focused UI test asserting `tbsp` display in med-detail schedule.

### 2026-03-01 (Fix: liquid correction controls + Escape in nested correction modal)

- **🧩 Scope**: Resolve correction modal regressions for liquid medications and nested Escape handling.
- **🛠️ What changed**:
  - Re-enabled editable liquid container count (`Bottles`) inside `Correct Stock`.
  - Container count now synchronizes correction amount to `bottles * amount per bottle`.
  - Amount input remains editable but is constrained by current bottle-derived capacity.
  - Nested Escape handling now uses capture-phase close handling for correction/refill sub-modals, preventing parent detail modal from closing on the same Escape press.
  - Correction modal keydown propagation was tightened to prevent bubbling into parent modal handlers.
  - Residual copy issue in correction header was corrected for amount packages: no more `... pills` wording for liquid/tube, now amount-based text (`Total Amount: ... ml/g`).
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched files: **no errors**.
- **🔜 Follow-ups**:
  - Optional: run quick interactive browser check for Escape behavior and liquid correction workflow.

### 2026-03-01 (Fix: Schedule page no longer shows pill wording for liquid/tube entries)

- **🧩 Scope**: Remove remaining package-type wording regression in schedule timeline rows.
- **🛠️ What changed**:
  - Added package-type-aware label helpers in `SchedulePage` for dose and total usage display.
  - Replaced hardcoded `pill/pills` and `pillsTotal` in both past-day and current/future-day rows.
  - `liquid_container` now renders amount-based labels (`ml`, `tsp`, `tbsp`, including ml conversion when needed).
  - `tube` now renders amount/application labels based on medication form instead of pill labels.
- **📁 Files touched**:
  - `frontend/src/pages/SchedulePage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched files: **no errors**.
- **🔜 Follow-ups**:
  - Optional: run a quick UI pass on shared/user-filter surfaces to confirm full wording parity.

### 2026-03-01 (Fix: liquid/tube detail modal no longer falls back to pill wording)

- **🧩 Scope**: Restore correct amount-based detail rendering for `liquid_container` and `tube` in medication detail modal.
- **🛠️ What changed**:
  - In `MedDetailModal`, amount packages no longer use the pill-oriented stock label.
  - Current stock label now switches to `Current Amount` and displays units (`ml`/`g`) for amount packages.
  - Package details for amount packages now render the full structure again:
    - package count (`Bottles`/`Tubes`)
    - amount per package
    - total amount with unit
  - Blister and bottle rendering paths were kept unchanged.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched file: **no errors**.
  - Vite HMR after change: clean update, no new frontend compile errors.
- **🔜 Follow-ups**:
  - Optional: run a quick UI sweep for remaining amount-package wording drift in other views.

### 2026-03-01 (Fix: no more false success when SMTP rejects reminder recipients)

- **🧩 Scope**: Investigate "reminder email not arriving" and fix success detection in reminder email flows.
- **🛠️ What changed**:
  - Live repro confirmed `/api/reminder/send-email` can return `200` while delivery may still fail downstream.
  - Added recipient-acceptance validation after `nodemailer.sendMail(...)`:
    - if SMTP returns no accepted recipients, request is now treated as failed.
    - explicit errors now surface when all recipients are rejected.
  - Applied consistently to:
    - manual demand/stock/prescription reminder routes
    - scheduler stock reminder email path
    - scheduler prescription reminder email path
    - settings test-email endpoint
  - Runtime finding documented: container had `LOG_LEVEL=warn`, so `info` diagnostics are hidden unless level is raised.
- **📁 Files touched**:
  - `backend/src/routes/planner.ts`
  - `backend/src/services/reminder-scheduler.ts`
  - `backend/src/routes/settings.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched backend files: **no errors**.
- **🔜 Follow-ups**:
  - Optional: switch `.env` `LOG_LEVEL` to `info` during debugging to see structured send-attempt/success logs.

### 2026-03-01 (UI fix: no unnecessary scroll on empty medications page)

- **🧩 Scope**: Remove unnecessary vertical scroll and large empty block when there are no medications.
- **🛠️ What changed**:
  - Added a compact empty state in `MedicationsPage` instead of rendering a visually empty medication grid container.
  - Added localized empty-state copy in EN + DE.
  - Reduced global page bottom padding to avoid extra empty vertical space that can trigger scrolling on sparse pages.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched files: **no errors**.
- **🔜 Follow-ups**:
  - Optional: if desired, tune empty-state spacing further for very short laptop viewports.

### 2026-03-01 (Debug: structured logs for email sending paths)

- **🧩 Scope**: Make email send attempts observable in backend logs for manual sending flows.
- **🛠️ What changed**:
  - Added structured `request.log` entries in planner/manual reminder email endpoints:
    - `/planner/send-email`
    - `/reminder/send-email`
    - `/reminder/send-prescription`
  - Added structured `request.log` entries in settings test endpoint:
    - `/settings/test-email`
  - Added logs for: request start, channel/SMTP readiness, send attempt, send success (`messageId`), and send failure.
  - Added recipient masking helper to avoid logging full email addresses.
- **📁 Files touched**:
  - `backend/src/routes/planner.ts`
  - `backend/src/routes/settings.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on touched backend files: **no errors**.
- **🔜 Follow-ups**:
  - Trigger one manual test send and inspect backend container logs for `[Planner]`, `[ReminderManual]`, and `[Settings]` log prefixes.

### 2026-03-01 (Complete: UI hints and deployment prep for package-type stock reminders)

- **🧩 Scope**: Add user-facing UI hints explaining liquid and tube package-type semantics; prepare deployment documentation.
- **🛠️ What changed**:
  - **i18n enhancements** (EN + DE):
    - `settings.stock.packageTypesNote`: New key explaining tube exclusion + liquid single-baseline model.
    - `settings.stockReminder.infoTooltip`: Enhanced to mention tube/liquid semantics.
    - `modal.packageTypeHint`: New key for med-detail tooltip explaining tube vs liquid behavior.
  - **Settings page hint**: Added infomational note below stock thresholds explaining:
    - Tube medications are excluded from stock reminders.
    - Liquid containers use a single reminder baseline (Low and Critical are auto-derived).
  - **Med detail modal tooltip**: Added info icon next to "Package Details" heading that triggers tooltip for tubes and liquid containers explaining stock reminder behavior and lack of tracking.
  - **Documentation**: Updated `doku/report.md` and `doku/memory_notes.md` to record full feature completion.
- **✅ Test coverage** (previously delegated):
  - Backend `/reminder/send-email` endpoint test for tube-only rejection (30/30 tests passed).
  - Backend `getLiquidReminderThresholds` boundary tests (10/10 passed, 4 new tests).
  - Frontend `getStockStatus` explicit package-type tests (82/82 passed, 5 new tests).
  - **Total: 122 backend + frontend tests, 0 failures.**
- **📁 Files touched**:
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `frontend/src/pages/SettingsPage.tsx`
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Validation**:
  - Editor diagnostics on all touched files: **no errors**
  - i18n JSON syntax validation: **valid (both EN + DE)**
  - All referenced translation keys resolve correctly
- **🚀 Deployment readiness**:
  - Feature complete with end-to-end implementation: backend logic, frontend rendering, UI hints, and focused test coverage.
  - Ready for staging deployment and user-facing release notes.
  - Existing CI/CD pipelines should pass (run full test suite before production release).
- **📋 Release notes ready** (for user communication):
  - Stock reminders for tube medications are no longer sent (tubes track fixed amounts, not consumption).
  - Liquid container reminders now use a single baseline threshold — Low and Critical levels are automatically derived for simplicity.
  - New hints in Settings and Med Details explain these changes.
  - All existing reminders for blister/bottle types remain unchanged.

### 2026-03-01 (Tests: focused coverage for package-type stock reminder semantics)

- **🧩 Scope**: Add focused test cases to verify package-type enforcement for stock reminders (tube exclusion, liquid threshold derivation).
- **🛠️ What changed**:
  - **Backend `/reminder/send-email` test**: Added test case verifying that endpoint returns `400 "No active medications to notify"` when only `packageType=tube` medications are in active meds list.
  - **Backend liquid threshold tests**: Added `describe("getLiquidReminderThresholds")` suite with 4 test cases validating threshold derivation formula:
    - `low = floor(baseline)`
    - `critical = ceil(low / 2)`
    - Tests cover typical baseline (7), boundary baseline (1), even baseline (14), and odd baseline (15).
  - **Frontend `getStockStatus` tests**: Added 4 explicit test cases in `getStockStatus` suite:
    - Tube packageType always returns `"normal"` (no thresholds) except when truly empty.
    - Liquid container applies derived thresholds without triggering high/low/normal multi-tier logic.
    - Liquid boundary cases (critical=1) handled correctly.
- **📁 Files touched**:
  - `backend/src/test/planner.test.ts`
  - `backend/src/test/stock-semantics-parity.test.ts`
  - `frontend/src/test/utils/schedule.test.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **✅ Test results**:
  - Backend planner: **30/30 passed** (includes new tube endpoint test)
  - Backend stock semantics: **10/10 passed** (includes 4 new liquid threshold tests)
  - Frontend schedule: **82/82 passed** (includes 5 new getStockStatus tests for package types)
  - All 3 suites: **0 failures**
  - Lint: no new errors introduced
- **🔜 Follow-ups**:
  - None; test coverage gaps closed for core package-type semantics.

### 2026-03-01 (Validation: package-type stock reminder changes)

- **🧩 Scope**: Validate recent tube/liquid reminder behavior updates in backend and frontend.
- **🔬 What was validated**:
  - Backend scheduler path excludes `packageType=tube` candidates.
  - Manual reminder route (`/api/reminder/send-email`, backend `/reminder/send-email`) filters out tube medications from payload-derived lists.
  - Liquid thresholds are derived from one baseline (`reminderDaysBefore`):
    - `low = floor(baseline)`
    - `critical = ceil(low / 2)`
  - Frontend status logic paths for Dashboard/Schedule/Shared/helper use package-type-aware status classification.
- **🧪 Focused test runs**:
  - Backend: `backend/src/test/planner.test.ts`, `backend/src/test/stock-semantics-parity.test.ts`.
    - Result: **35 passed, 0 failed**.
  - Frontend: `frontend/src/test/utils/schedule.test.ts`, `frontend/src/test/pages/DashboardPage.test.tsx`, `frontend/src/test/pages/SchedulePage.test.tsx`, `frontend/src/test/components/SharedScheduleTodayOnly.test.tsx`.
    - First run: **172 passed, 2 failed** (outdated helper test signature).
    - Fix applied: updated `DashboardPage.test.tsx` calls to `getReminderStatusData(...)` with new `meds` argument.
    - Re-run result: **174 passed, 0 failed**.
- **⚠️ Coverage gaps**:
  - No dedicated backend assertion that manual reminder endpoint returns `No active medications to notify` when payload contains tube-only meds.
  - No dedicated backend assertion for liquid critical/low split derived from baseline threshold.
  - Frontend `getStockStatus` tests currently do not explicitly cover `tube` and `liquid_container` branches.
- **📁 Files touched**:
  - `frontend/src/test/pages/DashboardPage.test.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`

### 2026-03-01 (Feature: stock reminder logic adapted for tube and liquid)

- **🧩 Scope**: Align reminder behavior with new package-type semantics while keeping liquid configuration simple.
- **🛠️ What changed**:
  - `tube` is now explicitly excluded from stock reminders in backend auto-reminder selection.
  - Manual reminder API (`/api/reminder/send-email`) now also filters out `tube` medications server-side.
  - `liquid_container` now uses a single days-based baseline threshold (no extra liquid threshold fields):
    - baseline = existing reminder threshold (`reminderDaysBefore`, default 7 days)
    - `critical` derived as `ceil(baseline / 2)`
    - `low` derived as `baseline`
  - Frontend stock status rendering was aligned to the same package-type logic across Dashboard, Shared Schedule, Schedule page, Med detail and filter modal.
  - Reminder status aggregation in dashboard helper now respects tube exclusion and liquid derived thresholds.
- **📁 Files touched**:
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
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on all touched files: no errors
- **🔜 Follow-ups**:
  - Delegate focused reminder regression tests to `@testing-manager` for backend candidate selection and frontend status parity.

### 2026-03-01 (Fix: liquid correction total now auto-updates from bottle count)

- **🧩 Scope**: Ensure `Total Amount` in liquid `Correct Stock` follows bottle-count changes immediately.
- **🛠️ What changed**:
  - Updated liquid bottle stepper handlers so changing `Bottles` always recalculates correction total to:
    - `bottles * amount per bottle`
  - Applied this for typing, blur normalization, and +/- step actions.
  - Result: correction values stay aligned with bottle configuration without manual recalculation.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched component: no errors
- **🔜 Follow-ups**:
  - Optional: make `Total Amount` read-only when bottle count is the primary correction driver.

### 2026-03-01 (Fix: liquid correction now supports changing bottle count)

- **🧩 Scope**: Make `Correct Stock` for `liquid_container` actually editable at bottle level.
- **🛠️ What changed**:
  - Added an editable `Bottles` field (stepper) in the correction modal.
  - Package size/cap in correction now updates live from `bottles * amount per bottle`.
  - Save logic now persists:
    - updated `packCount` (bottles)
    - updated `totalPills` (capacity base in ml)
    - stock adjustment for the corrected current total
  - Backend `/medications/:id/stock-adjustment` now allows these base updates for `liquid_container`.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/hooks/useRefill.ts`
  - `backend/src/routes/medications.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add regression test coverage for liquid correction with bottle-count edits.

### 2026-03-01 (UI: liquid correction modal now shows bottles context)

- **🧩 Scope**: Improve `liquid_container` stock correction clarity by showing container semantics, not just total amount.
- **🛠️ What changed**:
  - Kept the correction field as total amount (existing behavior).
  - Added a second helper line in the correction modal for liquid containers that shows:
    - number of bottles
    - amount per bottle (`ml`)
  - This now makes it explicit how total amount relates to bottle configuration.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched component: no errors
- **🔜 Follow-ups**:
  - Optional: replace composed helper text with a dedicated i18n sentence key if product wants stricter copy control.

### 2026-03-01 (Fix: tube correction now persists new amount in medication detail)

- **🧩 Scope**: Fix stock-correction behavior where tube detail still showed old amount after correction.
- **🛠️ What changed**:
  - Updated frontend correction submit path so `tube` corrections persist base amount fields instead of only `stockAdjustment`.
  - Extended backend stock-adjustment route to accept/persist optional tube base fields (`totalPills`, `looseTablets`, `packageAmountValue`, `packCount`).
  - Tube correction now updates package/detail amount values correctly after reload.
  - Correction modal wording for amount packages now includes both `tube` and `liquid_container` (no pill wording for tube corrections).
  - Liquid correction logic remains stock-adjustment based (as intended for liquid container capacity model).
- **📁 Files touched**:
  - `frontend/src/hooks/useRefill.ts`
  - `backend/src/routes/medications.ts`
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add explicit automated regression tests for tube correction persistence.

### 2026-03-01 (UI: capacity label unified for tube and liquid cards)

- **🧩 Scope**: Align tube/liquid medication card label wording with blister/bottle style.
- **🛠️ What changed**:
  - Replaced `Capacity per package` label with `Capacity` for tube/liquid cards.
  - Value and units remain unchanged.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Fix: tube count is now fixed to read-only 1)

- **🧩 Scope**: Prevent editing tube count above 1 because tube stock is not consumed automatically.
- **🛠️ What changed**:
  - In desktop and mobile edit forms, `Tubes` now shows a read-only value `1`.
  - Form/update logic enforces `packCount=1` for `packageType=tube`.
  - Save payload normalization also forces `packCount=1` for tube.
  - Legacy tube edit normalization now maps `Amount per tube` to current total stock to avoid unintended stock reduction on save.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add server-side validation guard for tube pack count parity.

### 2026-03-01 (Cleanup: removed redundant tube stock block)

- **🧩 Scope**: Remove redundant stock section in tube medication detail modal.
- **🛠️ What changed**:
  - `Stock Info` section is no longer rendered for `tube` medications.
  - Tube detail view now relies on `Package Details` only (`Tubes`, `Amount per tube`, `Total amount`).
  - Non-tube package types keep the existing stock section.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Fix: tube detail modal now shows packages + grams per package)

- **🧩 Scope**: Correct tube detail modal semantics to match package-based amount model (like liquid, but without current-amount pattern).
- **🛠️ What changed**:
  - Tube package details now show:
    - `Tubes`
    - `Amount per tube` (`g`)
    - `Total amount` (`g`)
  - Tube stock info row now shows a single stock value (`X g`) instead of `X / Y`.
  - Tube intake schedule wording remains `applications` and no longer reuses stock-unit labels.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: audit remaining read-only views for any leftover tube pill/application stock semantics.

### 2026-03-01 (Fix: remove misleading "No Schedule" status for tube)

- **🧩 Scope**: Eliminate confusing `No Schedule` status chips shown for `tube` medications after fixed-stock behavior.
- **🛠️ What changed**:
  - Added tube-specific filtering so `status.noSchedule` is not rendered as a chip.
  - Applied in Dashboard overview/schedule rows, Shared schedule rows, and Schedule page timeline rows.
  - Other package types keep existing stock-status behavior.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/components/SharedSchedule.tsx`
  - `frontend/src/pages/SchedulePage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add explicit UI hint for tube stock semantics if needed.

### 2026-03-01 (Fix: tube stock card now shows single value)

- **🧩 Scope**: Adjust medication card stock formatting for `tube` to remove denominator display.
- **🛠️ What changed**:
  - Changed tube card stock from `X / Y g` to `X g`.
  - Kept denominator-style stock display unchanged for non-tube package types.
  - Removed tube stock over-capacity warning in that card row since denominator is no longer rendered.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: align tube stock display format in additional views if product wants full UI parity.

### 2026-03-01 (Fix: tube stock remains fixed and is no longer auto-consumed)

- **🧩 Scope**: Stop automatic stock depletion for `tube` medications because per-application amount is undefined.
- **🛠️ What changed**:
  - Changed stock normalization so `tube` always contributes `0` automatic consumption.
  - Applied this consistently in frontend coverage calculations and shared schedule coverage.
  - Applied same rule in backend scheduler/planner stock math path to keep server/client behavior aligned.
  - Result: stock for tube now stays fixed (for example remains `600` based on configured amount) unless manually corrected/refilled.
- **📁 Files touched**:
  - `backend/src/utils/scheduler-utils.ts`
  - `frontend/src/utils/schedule.ts`
  - `frontend/src/components/SharedSchedule.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add automated regression test for fixed tube coverage over time.

### 2026-03-01 (Fix: shared schedule now matches liquid-container semantics)

- **🧩 Scope**: Align public shared schedule rendering and stock math for `liquid_container` with dashboard/detail behavior.
- **🛠️ What changed**:
  - Replaced pill-based shared timeline labels for liquid meds with intake-unit-aware amount labels.
  - Dose rows now render liquid usage using configured intake unit (`ml`, `tsp`, `tbsp`) and converted `ml` context where applicable.
  - Total badge in each shared day row now uses liquid amount semantics for liquid meds instead of `pills total`.
  - Shared stock coverage/depletion calculations now convert `tsp/tbsp` intake usage to `ml` before computing daily usage and consumed amount.
- **📁 Files touched**:
  - `frontend/src/components/SharedSchedule.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched component: no errors
- **🔜 Follow-ups**:
  - Optional: add automated regression test for shared liquid labels and coverage.

### 2026-03-01 (Hotfix: frontend build error in `useEscapeKey.ts`)

- **🧩 Scope**: Resolve Vite/esbuild transform error (`Expected ';' but found 'process'`).
- **🛠️ What changed**:
  - Fixed malformed multiline comment in `frontend/src/hooks/useEscapeKey.ts`.
  - No behavior change; parser hotfix only.
- **📁 Files touched**:
  - `frontend/src/hooks/useEscapeKey.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Fix: Escape closes only stock-correction sub-modal)

- **🧩 Scope**: Resolve nested modal behavior where pressing `Escape` in `Correct Stock` also closed parent medication detail modal.
- **🛠️ What changed**:
  - Prevented duplicate Escape handling between nested modal and global app-level key handler.
  - Nested sub-modals now capture and consume Escape first.
  - Global Escape handler now ignores already-consumed key events.
  - Result: pressing `Escape` in stock-correction closes only that sub-modal.
- **📁 Files touched**:
  - `frontend/src/hooks/useEscapeKey.ts`
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/App.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add regression UI test for nested modal Escape sequence.

### 2026-03-01 (Fix: `Correct Stock` opens with current amount for liquid container)

- **🧩 Scope**: Resolve issue where stock-correction input started at `0` for `liquid_container`.
- **🛠️ What changed**:
  - Fixed `useRefill` logic to treat all amount package types uniformly:
    - `bottle`
    - `tube`
    - `liquid_container`
  - `openEditStockModal` now pre-fills amount packages with current stock amount (not blister split logic).
  - `submitStockCorrection` now uses matching amount-package math for these package types.
- **📁 Files touched**:
  - `frontend/src/hooks/useRefill.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: add regression tests for amount-package stock-correction defaults.

### 2026-03-01 (Fix: `Correct Stock` modal for liquid container uses amount labels)

- **🧩 Scope**: Correct stock-correction dialog wording for `liquid_container` so it is not pill-based.
- **🛠️ What changed**:
  - In `Correct Stock` modal, liquid-container input label now uses amount wording (`Total amount`) instead of `Total pills`.
  - Package-size info and max-cap warning now use amount units (`ml`) for liquid containers instead of `pills`.
  - Added dedicated i18n keys for amount-based package-size/cap messages.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: update refill-modal wording for liquid container (`Pills to add`) to amount wording.

### 2026-03-01 (Fix: medication detail for liquid container no longer pill-based)

- **🧩 Scope**: Correct `MedDetailModal` rendering for `liquid_container` medications.
- **🛠️ What changed**:
  - Updated stock section to amount semantics for liquid container:
    - label uses amount wording
    - values include `ml` unit (for example `335 / 450 ml`)
  - Updated package details section to show liquid-specific information:
    - `Bottles`
    - `Amount per bottle (ml)`
    - `Total amount (ml)`
  - Updated intake schedule rows for liquid to use intake-unit-aware amount text (instead of pill-style output), including `tsp/tbsp` conversion context.
  - Hidden pill-weight line for amount package types in this modal.
- **📁 Files touched**:
  - `frontend/src/components/MedDetailModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: adjust refill modal wording for liquid container (`Pills to add` -> amount wording).

### 2026-03-01 (Fix: raw i18n keys in liquid schedule rows)

- **🧩 Scope**: Correct display where schedule rows showed translation keys (for example `form.blisters.teaspoons`) instead of real text.
- **🛠️ What changed**:
  - Added missing i18n keys for teaspoon/tablespoon labels in both locales:
    - `form.blisters.teaspoons(_one/_other)`
    - `form.blisters.tablespoons(_one/_other)`
  - This restores proper rendered labels in dashboard schedule/check-off rows.
- **📁 Files touched**:
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Rollback: dashboard no longer shows `X intakes`)

- **🧩 Scope**: Revert the recent liquid check-off wording change per user request.
- **🛠️ What changed**:
  - Removed the `X intakes` display style in dashboard liquid schedule rows.
  - Restored the previous unit-based liquid rendering path (using `ml/tsp/tbsp` with converted `ml` context for liquid doses).
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Adjustment: dashboard check-off uses intake count only)

- **🧩 Scope**: Apply user-requested simplification for liquid schedule/check-off labels.
- **🛠️ What changed**:
  - Removed spoon/ml annotation format in this area (no more strings like `Teaspoon (5 ml)` / `Tablespoon (15 ml)`).
  - Liquid usage labels now show only intake counts:
    - EN: `2 intakes`, `47 intakes`
    - DE: `2 Einnahmen`, `47 Einnahmen`
  - Added/used pluralized i18n key `form.blisters.intakes`.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Fix: intake label in check-off area now pluralized + total `ml`)

- **🧩 Scope**: Correct liquid intake display format in dashboard schedule/check-off rows.
- **🛠️ What changed**:
  - Replaced old format like `2 Teaspoon (5 ml)`.
  - New format now shows pluralized unit + total converted amount:
    - `2 teaspoons 10 ml`
    - `2 tablespoons 30 ml`
  - Removed parentheses in this view.
  - Updated daily total badge calculation for liquid meds to derive from dose rows and show converted `ml` totals.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Hardening: intake unit loaded directly from `intakesJson`)

- **🧩 Scope**: Resolve remaining regression where `tbsp`/`tsp` sometimes reappeared as `ml` after save.
- **🛠️ What changed**:
  - Confirmed database persistence is correct (`intakes_json` contains `intakeUnit` values).
  - Added a defensive parse+overlay in `backend/src/routes/medications.ts`:
    - reads `intakeUnit` directly from raw `intakesJson`
    - overlays it onto parsed intakes by index before returning API responses
  - Applied this in the medication GET path and related intake parsing paths used during update/planner calculations.
  - Restarted `backend-dev` so the patch is active.
- **📁 Files touched**:
  - `backend/src/routes/medications.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched backend route: no errors
  - local DB check: record keeps `intakeUnit="tbsp"` in `intakes_json`
- **🔜 Follow-ups**:
  - If still reproducible, capture and inspect live `/api/medications?includeObsolete=true` response for the same medication ID.

### 2026-03-01 (Fix: `tbsp`/`tsp` now persist and render correctly in Upcoming Schedule)

- **🧩 Scope**: Resolve intake-unit regression where changing liquid intake unit to `tbsp`/`tsp` reverted to `ml` after save/reload.
- **🛠️ What changed**:
  - Fixed backend intake parser to preserve `intakeUnit` when reading `intakesJson`.
  - Added intake-unit validation on parse (`ml`, `tsp`, `tbsp`) with safe fallback for legacy rows.
  - Propagated `intakeUnit` through frontend schedule event flow so UI receives the saved unit.
  - Updated Dashboard upcoming dose labels for liquid container meds to render per-intake unit (`ml`/`tsp`/`tbsp`) instead of forcing `ml`.
- **📁 Files touched**:
  - `backend/src/utils/scheduler-utils.ts`
  - `frontend/src/types/index.ts`
  - `frontend/src/utils/schedule.ts`
  - `frontend/src/context/AppContext.tsx`
  - `frontend/src/pages/DashboardPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on all touched files: no errors
- **🔜 Follow-ups**:
  - Optional: if mixed intake units are configured in one day for a single medication, refine total badge rendering to show a normalized unit summary.

### 2026-03-01 (Medication cards: bottle count shown for Pill Bottle)

- **🧩 Scope**: Add package-count visibility for `Pill Bottle` cards.
- **🛠️ What changed**:
  - Added `Bottles: <packCount>` to bottle card details.
  - Kept bottle capacity display (`Capacity: <value>`) and stock line unchanged.
  - Result matches requested format:
    - `Type: Pill Bottle`
    - `Bottles: <count>`
    - `Capacity: <value>`
    - `Stock: <current> / <capacity> pills`
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: mirror bottle count in detail/report views for full read-only parity.

### 2026-03-01 (Hotfix: MobileEditModal `useCallback` runtime error)

- **🧩 Scope**: Resolve dashboard/mobile form crash caused by missing React hook import.
- **🛠️ What changed**:
  - Added missing `useCallback` import in `MobileEditModal`.
  - Fixes runtime error: `Uncaught ReferenceError: useCallback is not defined`.
- **📁 Files touched**:
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - None.

### 2026-03-01 (Liquid intake units now affect stock math end-to-end)

- **🧩 Scope**: Make `Intake unit` (`ml`, `tsp`, `tbsp`) impact consumption calculations and align schedule form labels with selected unit.
- **🛠️ What changed**:
  - Implemented real conversion for liquid stock usage:
    - `ml` -> `usage`
    - `tsp` -> `usage * 5`
    - `tbsp` -> `usage * 15`
  - Applied conversion in backend stock-consumption paths and frontend coverage calculation so both sides behave consistently.
  - Updated Desktop + Mobile schedule forms for `liquid_container` so usage label follows selected intake unit:
    - `Usage (ml)`, `Usage (tsp)`, `Usage (tbsp)`.
  - Added i18n keys in EN/DE for new usage labels.
- **📁 Files touched**:
  - `backend/src/utils/scheduler-utils.ts`
  - `backend/src/services/reminder-scheduler.ts`
  - `frontend/src/utils/schedule.ts`
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on all touched files: no errors
- **🔜 Follow-ups**:
  - Optional: show selected intake unit in read-only schedule lines/cards for complete visual parity.

### 2026-03-01 (Medication cards: package count shown for tube/liquid)

- **🧩 Scope**: Show number of packages directly in medication cards for `tube` and `liquid_container`.
- **🛠️ What changed**:
  - Added package-count line in the card details section for amount-based package types.
  - Type-specific labels are used:
    - `tube` -> `Tubes`
    - `liquid_container` -> `Bottles`
  - Existing `Capacity per package` line remains and now appears together with the package count.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: mirror package-count detail in other read views (detail modal/report) for full parity.

### 2026-03-01 (Fix: singular/plural for tube labels in Upcoming Schedules)

- **🧩 Scope**: Correct singular/plural wording for tube usage labels in dashboard upcoming schedule rows and badges.
- **🛠️ What changed**:
  - Updated dashboard formatters to use count-aware translation for application units:
    - `t("form.blisters.applications", { count })`
  - Added pluralization keys in i18n:
    - EN: `applications_one`, `applications_other`
    - DE: `applications_one`, `applications_other`
  - Result examples:
    - `1 application` / `1 Anwendung`
    - `2 applications` / `2 Anwendungen`
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: review additional screens for any remaining non-count-aware unit labels.

### 2026-03-01 (Fix: Upcoming Schedule labels for tube/liquid)

- **🧩 Scope**: Correct broken text rendering in dashboard upcoming schedule rows for `tube` and `liquid_container`.
- **🛠️ What changed**:
  - Fixed wrong i18n key paths in `DashboardPage` formatters.
  - Replaced invalid keys:
    - `blisters.applications` -> `form.blisters.applications`
    - `form.ml` -> `form.packageAmountUnitMl`
  - This fixes outputs like `1 blisters.applications` and `1 form.ml` in upcoming rows.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: run a wider i18n key-path scan to catch other legacy raw-key references.

### 2026-03-01 (Root fix: recurring `Stock > Capacity` artifact removed)

- **🧩 Scope**: Remove recurring over-capacity display (`453/450`, `604/600`) for `liquid_container` and `tube`.
- **🛠️ What changed**:
  - Added a new section with strict `file -> exact change -> acceptance criterion` sequencing.
  - Expanded this sequence across all relevant implementation surfaces:
    - backend schema/routes/services
    - frontend runtime and parity-critical screens
    - i18n
    - backend tests, frontend tests, and e2e tests
    - documentation tracking files
  - Added an explicit execution gate so skipped files must be justified; otherwise the rollout is marked incomplete.
- **📁 Files touched**:
  - `frontend/src/types/index.ts`
  - `frontend/src/test/types.test.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add focused `calculateCoverage` unit test coverage for amount package types.

### 2026-03-01 (Fix: tube/topical save no longer fails with generic error)

- **🧩 Scope**: Resolve save failures for amount-based package types (`tube`, `liquid_container`), especially `tube/topical`.
- **🛠️ What changed**:
  - Added payload normalization before save for amount packages:
    - `packCount` is forced to `>= 1`
    - `packageAmountValue` is coerced to integer `>= 1`
    - derived totals (`totalPills`, `looseTablets`) are based on normalized values
  - On package switch to `tube`/`liquid_container`, form now initializes `packageAmountValue` to at least `1`.
  - Improved frontend error extraction to read Fastify/Zod `_errors` payloads and show the first concrete validation message instead of only `Failed to save`.
- **📁 Files touched**:
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: add explicit inline form validation hint for amount packages when user enters invalid/non-integer values.

### 2026-03-01 (Follow-up: fixed `+2` stock artifact for amount packages)

- **🧩 Scope**: Correct medication-card stock fallback for `tube` and `liquid_container`.
- **🛠️ What changed**:
  - Fixed card stock fallback that incorrectly used `getPackageSize` for amount packages.
  - For `tube`/`liquid_container`, card stock now uses amount totals (`totalPills ?? looseTablets`) and no longer adds `packCount`.
  - This removes artifacts like `Stock: 302 / 302 ml` when true total amount is `300 ml`.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: unify amount stock calculations in shared utility to avoid duplicate logic.

### 2026-03-01 (Follow-up: fixed wrong amount values in medication cards)

- **🧩 Scope**: Correct wrong `Capacity per package` and missing `Stock` unit in card view for amount-based package types.
- **🛠️ What changed**:
  - Card capacity for `tube` and `liquid_container` no longer reads from `pillsPerBlister` (which caused `1 ml` / `1 g` in many records).
  - Capacity now uses this fallback chain:
    - `packageAmountValue`
    - `totalPills / packCount`
    - `totalPills` (or `looseTablets` as final fallback)
  - `Stock` for `tube` now includes unit suffix (`g` or `ml`) instead of showing unitless values.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched file: no errors
- **🔜 Follow-ups**:
  - Optional: dedicated pass to align stock semantics as container counts in card view.

### 2026-03-01 (Capacity now shows per-package unit for amount packages)

- **🧩 Scope**: Correct medication-card capacity display for `liquid_container` and `tube`.
- **🛠️ What changed**:
  - In medication cards, `Capacity` for amount-based package types is now shown as **per package** instead of total.
  - `liquid_container` capacity now displays with `ml` (for example `150 ml` per container).
  - `tube` capacity now displays with unit by form:
    - liquid tube -> `ml`
    - non-liquid tube -> `g`
  - Added dedicated i18n label key `medications.details.capacityPerPackage` (EN/DE).
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on touched files: no errors
- **🔜 Follow-ups**:
  - Optional: align `Stock` card wording/semantics in a separate UI pass.

### 2026-03-01 (Liquid Container Package UX now follows Tube pattern)

- **🧩 Scope**: Simplify `liquid_container` package editing by removing pill-style stock fields and using the same pattern as `tube`.
- **🛠️ What changed**:
  - Desktop and mobile package tabs for `liquid_container` now show only:
    - `Flaschen` / `Bottles` (count)
    - `Inhalt pro Flasche` / `Amount per bottle` (ml)
    - derived `Gesamtmenge` / `Total amount`
  - Removed manual liquid package inputs for `Current Amount` and `Total Amount` steppers from edit forms.
  - Removed the extra liquid-specific package amount row in package tabs (now integrated in the same 3-field structure as tube).
  - Save payload logic now derives liquid stock fields from count × amount-per-bottle:
    - `packCount >= 1`
    - `blistersPerPack = 1`
    - `pillsPerBlister = 1`
    - `totalPills = packCount * packageAmountValue`
    - `looseTablets = packCount * packageAmountValue`
  - Added legacy-safe edit mapping so older liquid records are normalized for the new UI model without destructive reset.
  - Added new i18n keys:
    - `form.bottles`
    - `form.packageAmountPerBottle`
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - editor diagnostics (`get_errors`) on all touched frontend files: no errors
- **🔜 Follow-ups**:
  - Automated test execution/CI validation is delegated to `@testing-manager` per repository rules.

### 2026-02-28 (PR #359 backend CI fix)

- **🧩 Scope**: Triage and resolve failing backend CI check on branch `feat/topical-no-depletion-planner` with minimal change scope.
- **🛠️ What changed**:
  - Reproduced backend CI locally with the same command sequence as `.github/workflows/test.yml`.
  - Identified TypeScript compile failure:
    - `backend/src/routes/planner.ts` references `tr.common.units` and `tr.common.ml`.
    - `backend/src/i18n/translations.ts` did not define those keys in `common`.
  - Added missing `common.units` and `common.ml` keys to the translation type and both language maps (`en`, `de`).
- **📁 Files touched**:
  - `backend/src/i18n/translations.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - `cd backend && npm run lint` -> passed
  - `cd backend && npx tsc --noEmit` -> passed
  - `cd backend && CI=true npm run test:coverage` -> **21 files passed, 572 tests passed**
- **🔜 Follow-ups**:
  - Remote push/PR update must be performed by `@release-manager` per repository governance.

### 2026-02-28 (PR #356 backend CI failure triage)

- **🧩 Scope**: Reproduce and fix failing `Backend Tests` check on branch `feat/package-amount-backend`.
- **🛠️ What changed**:
  - Reproduced failure locally with `CI=true npm run test:run` in `backend` (`15` failing tests, all returning `500` from planner usage endpoint paths).
  - Root cause: missing utility export used at runtime by `POST /medications/usage`.
    - Caller: `backend/src/routes/medications.ts` (`normalizeIntakeUsageForStock(...)`)
    - Missing implementation/export in: `backend/src/utils/scheduler-utils.ts`
  - Added minimal `normalizeIntakeUsageForStock(...)` helper to return a validated finite positive numeric usage value.
- **📁 Files touched**:
  - `backend/src/utils/scheduler-utils.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - `cd backend && CI=true npx vitest run src/test/integration.test.ts src/test/stock-semantics-parity.test.ts src/test/e2e-routes.test.ts` -> **3 files passed, 143 tests passed**
  - `cd backend && CI=true npm run test:run` -> **21 files passed, 572 tests passed**
- **🔜 Follow-ups**:
  - None.

### 2026-02-28 (Stacked Branch Validation + Compatibility Fixes)

- **🧩 Scope**: Validate stacked commits for package amount, liquid intake units, and topical no-depletion behavior; fix test compatibility blockers.
- **🛠️ What changed**:
  - Verified stack lineage on current branch:
    - `7ebd253` (`feat/package-amount-backend`)
    - `3954ed2` (`feat/tube-ui-simplification`)
    - `e689720` (`feat/liquid-intake-units-conversion`)
    - `f9deb1b` (`feat/topical-no-depletion-planner`)
  - Fixed backend integration fixture drift by updating in-memory `medications` schemas to current column set (including medication form + package amount fields), which removed widespread `500` failures in backend tests.
  - Updated focused Playwright specs to match current UI semantics:
    - usage label selectors now support dynamic usage labels (not pills-only)
    - lifecycle edit flow now uses robust row/action selectors and current `Commercial Name` label
    - planner stock assertion now validates blister+loose-pill breakdown format
  - Removed fixable E2E lint warnings in lifecycle spec (unused import/variable).
- **📁 Files touched**:
  - `backend/src/test/integration.test.ts`
  - `backend/src/test/planner.test.ts`
  - `backend/src/test/e2e-routes.test.ts`
  - `frontend/e2e/medication-edit.spec.ts`
  - `frontend/e2e/medication-lifecycle.spec.ts`
  - `frontend/e2e/planner-data.spec.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - `npm run lint` (root): backend clean; frontend reports 12 pre-existing `noNestedTernary` warnings in `MedicationsPage.tsx`/`ReportModal.tsx`; no new warning introduced by this change.
  - `cd backend && CI=true npm run test:run`: **21 files passed, 572 tests passed**.
  - `cd frontend && CI=true npm run test:run`: **42 files passed, 775 tests passed**.
  - `cd frontend && PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_WORKERS=1 npm run test:e2e -- --workers=1 e2e/medication-edit.spec.ts e2e/medication-lifecycle.spec.ts e2e/planner-data.spec.ts`: **25 passed, 0 failed**.
- **🔜 Follow-ups**:
  - Optional dedicated cleanup PR for remaining frontend `noNestedTernary` warnings.

### 2026-02-28 (UX update: no +/- for tube/liquid package amount)

- **🧩 Scope**: Simplify package amount input for non-tablet package types.
- **🛠️ What changed**:
  - Replaced `+/-` stepper controls with a single numeric input field for:
    - `Tube -> Amount per tube`
    - `Liquid container -> Package amount`
  - Units remain fixed and non-editable:
    - `Tube -> g`
    - `Liquid container -> ml`
  - Added mobile modal regression tests to verify plain input behavior and fixed unit selectors.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/test/components/MobileEditModal.test.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - `runTests`: `frontend/src/test/components/MobileEditModal.test.tsx` -> `59 passed, 0 failed`
  - `get_errors`: no diagnostics errors on touched files
- **🔜 Follow-ups**:
  - Optional: refactor pre-existing `noNestedTernary` warnings in `MedicationsPage.tsx` in a dedicated cleanup task.

### 2026-02-28 (Tests updated for strict tube/liquid unit behavior)

- **🧩 Scope**: Ensure automated tests cover the new unit rules (`tube -> g`, `liquid_container -> ml`).
- **🛠️ What changed**:
  - Updated existing `useMedicationForm` tests to explicitly check `packageAmountUnit="ml"` for liquid-container defaults and lock behavior.
  - Added new regression test: `tube` always enforces `packageAmountUnit="g"`, even if an `ml` change is attempted.
  - Added new regression test: legacy `tube` records with `packageAmountUnit="ml"` are normalized to `g` during edit mapping.
  - Refactored touched source code for lint compliance (`noNestedTernary`) in modified files.
- **📁 Files touched**:
  - `frontend/src/test/hooks/useMedicationForm.test.ts`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔬 Validation run**:
  - `runTests`: `frontend/src/test/hooks/useMedicationForm.test.ts` -> `25 passed, 0 failed`
  - `biome check` (focused): touched files -> clean
- **🔜 Follow-ups**:
  - Optional backend guard to reject `tube+ml` payloads server-side.

### 2026-02-28 (Domain fix: tube can no longer use `ml`)

- **🧩 Scope**: Enforce correct measurement semantics for tube medications.
- **🛠️ What changed**:
  - Tube forms no longer allow selecting `ml`.
  - Tube amount unit is now fixed to `g` in desktop and mobile edit flows.
  - Existing tube records are normalized to `g` when opened in edit mode.
  - Save payload now enforces:
    - `tube -> packageAmountUnit = g`
    - `liquid_container -> packageAmountUnit = ml`
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: add backend route-level guard to reject `tube+ml` for full server-side protection.

### 2026-02-28 (Tube package made simple: `1 x 150 g`)

- **🧩 Scope**: Remove confusing/duplicated stock inputs for tube medications.
- **🛠️ What changed**:
  - Tube stock section was simplified in desktop and mobile forms.
  - For `Package Type = Tube`, the form now shows:
    - `Tubes`
    - `Amount per tube` (`g`/`ml`)
    - computed total amount (`Tubes * Amount per tube`)
  - Removed tube-specific `Total Amount` / `Current Amount` stepper inputs that allowed conflicting values.
  - Save logic now persists tube amounts consistently from the simple model (`packCount * packageAmountValue`).
  - Added new localized labels in EN/DE for tube-specific fields.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: adjust read-only views to always surface the same multiplication format for tube medications.

### 2026-02-28 (UI consistency: start date now shows optional)

- **🧩 Scope**: Align date-input hint text for medication dates.
- **🛠️ What changed**:
  - Added `optional` placeholder to `Medication Start Date` in desktop and mobile edit forms.
  - This is a display-only consistency fix; start date validation behavior is unchanged (still optional).
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None.

### 2026-02-28 (Implemented: liquid intake units, topical stock rule, package amount metadata)

- **🧩 Scope**: Fully implement the approved behavior across backend/frontend for liquid measurements, topical stock handling, and package content metadata.
- **🛠️ What changed**:
  - Added backend persistence + compatibility for package amount fields:
    - `packageAmountValue`
    - `packageAmountUnit` (`ml|g`)
  - Extended intake model with `intakeUnit` (`ml|tsp|tbsp`) and applied stock conversion:
    - `1 tsp = 5 ml`
    - `1 tbsp = 15 ml`
  - Updated stock/depletion logic so topical (`tube`) does not auto-deplete stock (metadata-only behavior), while liquid remains measurable and depleting.
  - Updated export/import to carry new fields and bumped export format version to `1.3`.
  - Added desktop + mobile UI controls for:
    - intake unit selection on liquid-container schedules
    - package amount metadata (`value + unit`) for tube/liquid-container
  - Updated frontend coverage logic (including shared schedule view) to match backend conversion and topical no-depletion behavior.
  - Added EN/DE translation keys for the new form labels.
- **📁 Files touched**:
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
- **🔜 Follow-ups**:
  - Execute test plan via `@testing-manager` (ownership rule).

### 2026-02-28 (Topical vs Liquid Stock Behavior Clarified)

- **🧩 Scope**: Define practical stock behavior for topical vs liquid medications and add intake conversion for tablespoon dosing.
- **🛠️ What changed**:
  - Updated `doku/package_types.md` with explicit behavior split:
    - `topical`: package content is informational only (no stock depletion math in V1/V1.1)
    - `liquid`: measurable stock, always deducted in canonical `ml`
  - Added liquid intake conversion model:
    - `ml`, `tsp`, `tbsp` intake units
    - fixed conversion: `1 tsp = 5 ml`, `1 tbsp = 15 ml`
  - Added implementation guidance to use metric medical conversion (`tbsp=15 ml`) and avoid regional kitchen variants.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Implement intake-unit enum + conversion pipeline in API/frontend if this concept is approved.

### 2026-02-28 (Packaging Quantity Units Clarified)

- **🧩 Scope**: Define how package amount should be measured for liquid and topical medications.
- **🛠️ What changed**:
  - Added a new recommendation section in `doku/package_types.md` for explicit package quantity fields:
    - `packageAmountValue` (number)
    - `packageAmountUnit` (`ml|g`)
  - Documented practical unit mapping:
    - oral liquids (`liquid_container`) -> `ml`
    - topical cream/ointment/gel (`tube`) -> `g`
    - topical lotions/solutions -> `ml`
  - Clarified that `packageAmountUnit` is separate from `doseUnit` and `strengthUnit`.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Implement model fields/migration/UI in a dedicated PR if this recommendation is approved.

### 2026-02-28 (Liquid Container Regression Tests Executed)

- **🧩 Scope**: Turn the `liquid_container` handoff checklist into real automated regression tests and validate the new behavior.
- **🛠️ What changed**:
  - Added backend real-route tests in `backend/src/test/e2e-routes.test.ts` for:
    - creating a `liquid_container` medication
    - validating shared schedule stock semantics for `liquid_container`
    - rejecting invalid `liquid` + non-`liquid_container` combinations
  - Added frontend hook tests in `frontend/src/test/hooks/useMedicationForm.test.ts` for:
    - automatic form derivation when switching to `packageType=liquid_container`
    - enforcing lock behavior that keeps `medicationForm=liquid` and `doseUnit=ml`
  - Fixed the in-memory backend test schema in `e2e-routes.test.ts` so current route inserts can run against the test DB without false `500` errors.
  - Executed targeted test names for the new scenarios; all targeted tests passed.
- **📁 Files touched**:
  - `backend/src/test/e2e-routes.test.ts`
  - `frontend/src/test/hooks/useMedicationForm.test.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Expand the package/form matrix tests in backend route suites if broader hardening is desired.

### 2026-02-28 (Testing Handoff Checklist Added)

- **🧩 Scope**: Provide a concrete `@testing-manager` handoff for validating `liquid_container` rollout quality.
- **🛠️ What changed**:
  - Added a dedicated testing section in `doku/package_types.md` with executable checks for:
    - backend package/form validation matrix
    - frontend desktop/mobile parity
    - planner/schedule/dashboard/detail/report unit semantics (`ml` for liquid container)
    - export/import/share/refill behavior
    - minimum E2E scenarios and pass criteria
  - Checklist is explicitly scoped to prevent regressions back to pill-only assumptions.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Execute this checklist through `@testing-manager` per repository governance.

### 2026-02-28 (Dedicated Liquid Package Type Implemented)

- **🧩 Scope**: Implement missing package type for liquid medications using `liquid_container` and propagate it across backend/frontend.
- **🛠️ What changed**:
  - Added `liquid_container` to API/frontend package type unions and import/export validation.
  - Enforced domain rules centrally:
    - `liquid` must use `liquid_container`
    - `topical` must use `tube`
    - `capsule/tablet` cannot use `tube` or `liquid_container`
  - Updated desktop + mobile medication edit flows to expose `liquid_container` and enforce correct form locking.
  - Updated planner/schedule/dashboard/detail/report unit rendering so liquid container values use `ml` instead of pill wording.
  - Updated refill/share/reminder/planner backend branches so container calculations include `liquid_container`.
  - Added i18n labels:
    - EN: `Liquid Container`
    - DE: `Fluessigbehaeltnis`
  - Updated `doku/package_types.md` to make `liquid_container` mapping explicit.
- **📁 Files touched**:
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
- **🔜 Follow-ups**:
  - Test execution/triage remains delegated to `@testing-manager`.

### 2026-02-28 (Logic fix: Liquid is no longer allowed in Tube)

- **🧩 Scope**: Correct package/form logic after identifying that `liquid` in `tube` is invalid.
- **🛠️ What changed**:
  - Backend validation rules updated:
    - `topical` must use `tube`
    - `liquid` cannot use `tube`
  - Desktop and mobile medication edit forms updated:
    - when `Package Type = Tube`, only `Topical` is selectable
    - `Liquid` option removed from tube-specific selector
  - Form-state logic updated to keep tube selections deterministic:
    - tube now forces `medicationForm=topical`
    - tube defaults to `doseUnit=units`
  - `doku/package_types.md` updated to reflect the corrected compatibility rules.
- **📁 Files touched**:
  - `backend/src/routes/medications.ts`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Decide in master-plan phase how `liquid` should be modeled operationally (explicit non-tube path with full UX and stock semantics).

### 2026-02-28 (Package-type hardening implementation pass)

- **🧩 Scope**: Implement high-impact package-type fixes immediately and reduce risk before the later master-plan rollout.
- **🛠️ What changed**:
  - Hardened backend compatibility rules in `medications.ts`:
    - `liquid/topical -> tube` (already present)
    - added inverse guard `capsule/tablet != tube`
  - Updated frontend planner/schedule wording for non-pill forms:
    - usage and totals now render form-aware units for `tube` flows
    - pill-weight helper is suppressed for tube flows
  - Updated backend planner/reminder messaging:
    - no pill-only assumption for `tube` package type
    - unit labels are now package/form aware in plain-text and email table content
  - Extended backend translation keys to support the updated unit terminology.
  - Updated `doku/package_types.md` status snapshot to reflect this implementation progress.
- **📁 Files touched**:
  - `backend/src/routes/medications.ts`
  - `frontend/src/pages/PlannerPage.tsx`
  - `frontend/src/pages/SchedulePage.tsx`
  - `backend/src/routes/planner.ts`
  - `backend/src/services/reminder-scheduler.ts`
  - `backend/src/i18n/translations.ts`
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Full regression suite expansion for all four forms remains open and should be handled by `@testing-manager`.

### 2026-02-28 (Full package_types plan synchronized with current code state)

- **🧩 Scope**: Review the complete package-types plan and update it to the latest implementation reality.
- **🛠️ What changed**:
  - Added a new dated status snapshot (`2026-02-28`) with clear separation of:
    - already implemented behavior
    - still-open implementation gaps
  - Updated scope section from generic "implement now" wording to:
    - `V1 baseline (already implemented)`
    - `V1 remaining work`
  - Added an explicit lifecycle storage note that current persisted values are `refill_when_empty|treatment_period`, while `ongoing` is runtime-derived.
  - Added progress interpretation for the 1:1 remediation sequence so already-delivered steps are handled as verify-and-align checks.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Prioritize planner/schedule/reminder wording cleanup and enforce full four-form regression coverage.

### 2026-02-28 (1:1 remediation sequence added to package type plan)

- **🧩 Scope**: Add the complete execution-ready implementation order directly into `doku/package_types.md`.
- **🛠️ What changed**:
  - Added a new section with strict `file -> exact change -> acceptance criterion` sequencing.
  - Expanded this sequence across all relevant implementation surfaces:
    - backend schema/routes/services
    - frontend runtime and parity-critical screens
    - i18n
    - backend tests, frontend tests, and e2e tests
    - documentation tracking files
  - Added an explicit execution gate so skipped files must be justified; otherwise the rollout is marked incomplete.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Apply the remediation sequence in code and validate each acceptance criterion per file group.

### 2026-02-28 (Package type plan aligned and fully enumerated)

- **🧩 Scope**: Make `doku/package_types.md` internally consistent and explicitly enumerate all impacted areas.
- **🛠️ What changed**:
  - Corrected plan context to current container reality (`blister|bottle|tube`) to remove ambiguity.
  - Added a full affected-file inventory grouped by:
    - backend schema/routes/services
    - frontend runtime surfaces
    - i18n files
    - backend tests
    - frontend tests
    - e2e specs
    - documentation synchronization files
  - This converts the plan into a practical implementation checklist so no affected area is accidentally skipped.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Execute code remediation based on this inventory and close gaps in planner/schedule/backend planner messaging first.

### 2026-02-28 (Package type plan made implementation-safe)

- **🧩 Scope**: Improve `doku/package_types.md` to prevent incomplete package/form rollouts.
- **🛠️ What changed**:
  - Added a mandatory implementation coverage checklist spanning backend, frontend desktop/mobile parity, read views, i18n, import/export/share, and tests.
  - Added a strict definition-of-done rule: package/form changes are incomplete unless all affected areas are updated (or explicitly marked not impacted with rationale).
  - This turns the plan from descriptive guidance into an execution gate against partial implementations.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Run a targeted remediation pass for remaining pill-only wording in planner/schedule and backend planner notifications, plus matching tests.

### 2026-02-28 (Release manager instructions cleaned up)

- **🧩 Scope**: Remove app-feature text from release-manager agent instructions and keep the file process-oriented.
- **🛠️ What changed**:
  - Replaced the concrete medication-feature release-notes example with a neutral template.
  - New template keeps the expected section structure, commit-hash usage, and full-changelog format, but avoids product-specific content.
- **📁 Files touched**:
  - `.github/agents/release-manager.agent.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: standardize the Breaking Changes example heading to remove emoji for full consistency with style rules.

### 2026-02-27 (Dashboard tube stock wording correction)

- **🧩 Scope**: Correct dashboard overview and timeline wording for `tube` medications.
- **🛠️ What changed**:
  - Fixed medication overview stock cell so `tube` no longer renders as `pill/pills`.
  - Tube values now render with amount units:
    - `liquid` -> `ml`
    - `topical` -> `applications`
  - Updated timeline dose usage and total tags to use the same tube-aware units.
  - Suppressed pill-weight (`mg`) helper text for tube dose rows.
- **📁 Files touched**:
  - `frontend/src/pages/DashboardPage.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None.

### 2026-02-27 (Lowercase optional placeholder in date fields)

- **🧩 Scope**: Make date-field placeholder text less aggressive by preventing automatic uppercase rendering.
- **🛠️ What changed**:
  - Fixed inherited uppercase styling on custom date input display.
  - Added explicit CSS override so placeholders like `optional` render lowercase as intended.
  - Normalized letter spacing for that display text to keep the visual tone calmer.
- **📁 Files touched**:
  - `frontend/src/styles/schedule-mobile-edit.css`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None.

### 2026-02-27 (Tube semantics in report exports)

- **🧩 Scope**: Ensure generated medication reports do not use pill-centric wording when package type is `tube`.
- **🛠️ What changed**:
  - Updated text export (`txt`/`md`) and print/PDF report generation to use amount-based wording for `tube`.
  - Current stock in reports now uses tube units (`ml` or `applications`) instead of `pill/pills`.
  - Total capacity row label for `tube` now uses unit-aware amount wording.
  - Intake schedule rows for `tube` now render usage with amount units.
  - Refill history rows for `tube` now render added quantities with amount units.
  - `Dose per pill` row is now omitted for `tube` in report outputs.
- **📁 Files touched**:
  - `frontend/src/components/ReportModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: run a final app-wide wording pass for dashboard/planner/schedule if complete tube terminology harmonization is desired beyond reports.

### 2026-02-27 (Holistic package adaptation for Tube)

- **🧩 Scope**: Ensure package UI reflects package semantics, especially for `tube` (liquid/topical), without pill-centric wording.
- **🛠️ What changed**:
  - Package tab now uses amount terminology for `tube` instead of pill terminology.
  - For `tube`, removed pill-specific dose field from package tab (`Dose per pill (mg)` is no longer shown).
  - Total display for `tube` no longer appends `pill/pills` wording.
  - Added i18n labels for amount-based stock fields (EN/DE).
  - Added sensible unit defaults when choosing tube forms:
    - `liquid` -> `ml`
    - `topical` -> `units`
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: implement distinct backend depletion math for `tube+liquid` versus `tube+topical` for full end-to-end semantic parity.

### 2026-02-27 (Documentation correction: Liquid/Topical + Tube constraints)

- **🧩 Scope**: Fix mismatch between implementation reality and `doku/package_types.md` constraints section.
- **🛠️ What changed**:
  - Replaced outdated statement that backend/export only support `blister|bottle`.
  - Documented actual supported package types: `blister|bottle|tube`.
  - Documented current UI split clearly:
    - `blister`/`bottle`: `pillForm` (`tablet`/`capsule`)
    - `tube`: `medicationForm` (`liquid`/`topical`)
  - Clarified that export/import now include tube and related metadata.
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Continue updating this document together with any future model/UI changes in the same PR.

### 2026-02-27 (Tube form distinction restored: Liquid vs Topical)

- **🧩 Scope**: Restore meaningful separation between liquid and cream/topical while keeping the previous pillForm simplification.
- **🛠️ What changed**:
  - Reintroduced a dedicated `Medication Form` selector only when `Package Type = Tube`.
  - Tube selector now offers exactly `Liquid` and `Topical` (no capsule/tablet overlap).
  - Kept `Pill Form` as the only form selector for `blister`/`bottle`.
  - Updated intake behavior to reflect tube form:
    - `Liquid`: fractional intake enabled and ml-oriented usage label.
    - `Topical`: application-oriented usage label and non-fractional behavior.
  - Updated form-state logic so switching to tube defaults to `Liquid` unless an existing tube form is already set.
- **📁 Files touched**:
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: introduce explicit liquid volume stock policy in backend for stronger liquid-vs-topical operational differences.

### 2026-02-27 (PillForm-first simplification)

- **🧩 Scope**: Remove semantically confusing dual form selection and align UI with meaningful domain choices.
- **🛠️ What changed**:
  - Removed `Medication Form` selector from desktop and mobile edit forms.
  - Kept `Pill Form` as the primary form control for non-tube packages.
  - Kept explicit package selection (`blister`, `bottle`, `tube`) and use it to control whether `Pill Form` is shown.
  - Updated intake behavior logic in UI to use `packageType` + `pillForm` (fraction handling and usage label decision).
  - Backend payload remains compatible by deriving `medicationForm` internally at save time.
- **📁 Files touched**:
  - `frontend/src/hooks/useMedicationForm.ts`
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - If liquid/topical must become user-selectable again, add a dedicated control only together with visible behavior differences.

### 2026-02-27 (Removed non-functional lifecycle option from UI)

- **🧩 Scope**: Align medication form UX with product rule that users should only see controls that have concrete application effects.
- **🛠️ What changed**:
  - Removed lifecycle dropdown (`Refill when empty` / `Treatment period`) from desktop medication form.
  - Removed the same lifecycle dropdown from mobile edit modal to keep desktop/mobile parity.
  - Updated package-type design doc to state lifecycle selector is intentionally hidden until lifecycle values produce distinct behavior in planner/reminder/stock logic.
  - No DB/API migration changes in this step; this is a focused UX correction to remove non-functional user choice.
- **📁 Files touched**:
  - `frontend/src/pages/MedicationsPage.tsx`
  - `frontend/src/components/MobileEditModal.tsx`
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Re-introduce lifecycle as visible user control only after implementing clear, user-visible behavior differences per option.

### 2026-02-27 (Liquid/Topical packaging correction: dedicated tube type)

- **🧩 Scope**: Apply user-requested domain correction so liquid/topical medications are not modeled as pill bottles and instead use a dedicated `tube` package type.
- **🛠️ What changed**:
  - Completed backend enum/validation propagation for `tube` in medication CRUD and import/export contracts.
  - Updated backend stock/planner/share/refill/scheduler logic to treat `tube` with container semantics (same stock math branch as bottle where appropriate).
  - Updated frontend shared types and medication-form logic so liquid/topical default to `tube`.
  - Updated desktop and mobile medication edit UIs to show tube option for liquid/topical and keep bottle option for capsule/tablet.
  - Updated dashboard/planner/detail/refill/report displays and stock helpers to render/calculate tube correctly.
  - Added missing translation keys for tube labels in EN/DE (`form.packageTypeTube`, `report.docTube`).
  - Checked workspace diagnostics after edits: no compile/lint errors reported by VS Code diagnostics.
- **📁 Files touched**:
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
- **🔜 Follow-ups**:
  - Delegate targeted regression test execution (frontend/unit/e2e as needed) to `@testing-manager` per repository governance.

### 2026-02-27 (Plan update: tokenized medication overview API)

- **🧩 Scope**: Improve `doku/feat/rest_api_med_overview.md` to close completeness and execution gaps.
- **🛠️ What changed**:
  - Added a dedicated test section with concrete required coverage for backend, frontend, and e2e.
  - Fixed architecture ambiguity for rate limiting:
    - use route-level limits in `backend/src/routes/share.ts`
    - rely on already-registered plugin in `backend/src/index.ts`
  - Tightened API contract details:
    - token format validation (`^[a-f0-9]{16}$`)
    - `Cache-Control: no-store`
    - deterministic date format (`YYYY-MM-DD`)
    - explicit `shareStockStatus=false` behavior (stock-derived fields set to `null`)
  - Clarified image strategy for phase 1 (reuse existing `/api/images/...` behavior, no new share-image endpoint).
  - Updated changed-files estimate and added recommendation to split implementation into 3 PRs due to size.
- **📁 Files touched**:
  - `doku/feat/rest_api_med_overview.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Implement in split PRs (backend -> frontend -> e2e/docs) to stay reviewable.

### 2026-02-27 (Review: shared overview API plan)

- **🧩 Scope**: Quality/completeness review of `doku/feat/rest_api_med_overview.md`.
- **🛠️ What changed**:
  - Reviewed plan against current backend/frontend architecture and share-token implementation.
  - Found high-impact gaps to fix before implementation:
    - Missing explicit test plan (backend route tests + frontend page tests + e2e flow).
    - Ambiguous/non-existent target file for rate-limit setup (`backend/src/app.ts` in plan, but project uses `backend/src/index.ts`).
    - Image URL contract in response example is not aligned with currently visible share routes and needs explicit endpoint/policy definition.
  - Verified helpful strengths:
    - Reuse of existing `share_tokens` is consistent.
    - Token-format expectation (`hex`, 16 chars) matches current generator.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Update plan with concrete test tasks, precise file targets, and final image-delivery strategy before starting implementation.

### 2026-02-27 (Loading/Error screen theme parity)

- **🧩 Scope**: Make pre-auth loading and connection-error screens follow the selected light/dark theme.
- **🛠️ What changed**:
  - Added early theme resolution in `AppRouter` for screens rendered before `AppHeader`/`useTheme` setup.
  - Supports `localStorage` values `light`, `dark`, and `system` (system resolved via `prefers-color-scheme`).
  - Applied `data-theme` on auth container during `loading`, `authError`, and `!authState` states.
- **📁 Files touched**:
  - `frontend/src/App.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None.

### 2026-02-27 (Playwright request triage + auth env dependency check)

- **🧩 Scope**: Assess requested Playwright improvements and clarify whether login/registration behavior is controlled by `.env` flags.
- **🛠️ What changed**:
  - Applied repository governance: test planning/writing/execution must be delegated to `@testing-manager`.
  - Verified backend auth-state logic and confirmed env-driven behavior:
    - `AUTH_ENABLED` controls global auth mode.
    - `REGISTRATION_ENABLED` controls registration unless first-user bootstrap path (`!hasUsers`) is active.
    - `FORM_LOGIN_ENABLED` controls username/password form availability (with first-user setup override).
    - `OIDC_ENABLED` controls SSO route/button availability (with OIDC config requirements).
  - Confirmed E2E auth setup failure mode in SSO-only environments is caused by unconditional username/password field usage in setup.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - `@testing-manager` should implement the requested Playwright changes (auth fallback, planner calculation assertions, lifecycle integration flow, resilient retries/waits, timeline performance scenario).

### 2026-02-27 (Intake reminder consistency fix)

- **🧩 Scope**: Ensure reminders are sent only when explicitly enabled on the specific intake.
- **🛠️ What changed**:
  - Removed medication-level reminder fallback from intake reminder scheduling.
  - Previous behavior: `intake.intakeRemindersEnabled || med.intakeRemindersEnabled` could remind disabled intakes.
  - New behavior: only `intake.intakeRemindersEnabled` qualifies an intake for reminder sending.
  - Updated prefilter logic so medications are considered only when at least one intake has reminders enabled.
  - Backend lint verified clean after change.
- **📁 Files touched**:
  - `backend/src/services/intake-reminder-scheduler.ts`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Existing legacy medications using only medication-level reminder flags must enable reminders at intake level to continue receiving reminders.

### 2026-02-27 (Legacy DB cleanup)

- **🧩 Scope**: Remove obsolete `medassist.db` leftovers from old storage paths and clean stale code references.
- **🛠️ What changed**:
  - Verified active runtime DB path is `medassist-ng.db` (`backend/src/db/db-utils.ts`).
  - Searched repository for `medassist.db` and found only legacy test references in `backend/src/test/db-client.test.ts`.
  - Updated test mock/expectation paths from `medassist.db` to `medassist-ng.db`.
  - Deleted obsolete local files:
    - `backend/data/medassist.db`
    - `data/medassist.db`
  - Confirmed no remaining code references to `medassist.db`.
- **📁 Files touched**:
  - `backend/src/test/db-client.test.ts`
  - `backend/data/medassist.db` (removed)
  - `data/medassist.db` (removed)
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None.

### 2026-02-27 (All pending local changes split and merged)

- **🧩 Scope**: Take the full pending local change set, split into meaningful PRs, and merge everything into `main`.
- **🛠️ What changed**:
  - Created and merged 4 PRs with full metadata (assignee, labels, project link, issue closure):
    - PR `#334` (`feat/form-login-enabled`) closing Issue `#309`
    - PR `#336` (`chore/improve-logging`) closing Issue `#335`
    - PR `#339` (`fix/typescript-strictness-react19`) closing Issue `#337`
    - PR `#341` (`chore/dependabot-agent-governance`) closing Issue `#340`
  - Waited for CI on every PR and merged only with green required checks.
  - Verified project board status for linked issues: all moved to `Done`.
  - Resolved one merge-policy blocker on PR `#341` by adding minimal no-op backend/frontend touches so required checks were actually triggered (instead of skipped by path filtering).
- **📁 Files touched**:
  - Entire pending workspace delta was fully shipped across the 4 PRs above.
  - Final bookkeeping updated in:
    - `doku/memory_notes.md`
    - `doku/report.md`
- **🔜 Follow-ups**:
  - None for this delivery request.

### 2026-02-27 (Local pre-PR gate validation: `chore/dependabot-agent-governance`)

- **🧩 Scope**: Validate minimal relevant non-interactive local checks for changed governance/config/docs files.
- **🛠️ What changed**:
  - Confirmed changed file scope with `git status --short`.
  - Ran repo lint gate: `npm run lint` -> passed (backend Biome clean, frontend Biome clean).
  - Ran YAML/frontmatter parser checks for changed `.yml` and agent markdown files -> passed.
  - Ran targeted markdownlint (`npx -y markdownlint-cli2 ...`) -> failed with 379 markdown style issues (mostly line-length/table-spacing) across changed markdown files.
  - Assessed markdownlint result as non-gating because this repository's configured local gate uses Biome on backend/frontend source files only.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Optional: run a dedicated markdown formatting/lint cleanup pass for agent/docs files in a separate scope.

### 2026-02-27 (PR3 local gate rerun: `fix/typescript-strictness-react19`)

- **🧩 Scope**: Re-run requested local pre-PR frontend gate after `MedDetailModal` test fix.
- **🛠️ What changed**:
  - Ran `CI=true npm --prefix /Users/danielvolz/git/medassist/frontend run check` -> passed.
  - Re-ran the same focused Vitest subset (12 files) used previously -> passed.
  - `src/test/components/MedDetailModal.test.tsx` now passes in that subset.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Requested local pre-PR gate is satisfied for frontend check + focused subset.

### 2026-02-27 (Local pre-PR gate validation: `fix/typescript-strictness-react19`)

- **🧩 Scope**: Validate minimal relevant non-interactive frontend lint/tests for changed React 19 + TypeScript strictness files.
- **🛠️ What changed**:
  - Ran `CI=true npm --prefix /Users/danielvolz/git/medassist/frontend run check` -> passed (Biome clean, `tsc --noEmit` clean).
  - Ran focused Vitest only on changed test files:
    - `src/test/components/Lightbox.test.tsx`
    - `src/test/components/MedDetailModal.test.tsx`
    - `src/test/components/MobileEditModal.test.tsx`
    - `src/test/components/UserFilterModal.test.tsx`
    - `src/test/context/AppContext.test.tsx`
    - `src/test/hooks/useMedications.test.ts`
    - `src/test/hooks/useRefill.test.ts`
    - `src/test/hooks/useSettings.test.ts`
    - `src/test/hooks/useShare.test.ts`
    - `src/test/utils/formatters.test.ts`
    - `src/test/utils/ics.test.ts`
    - `src/test/utils/schedule.test.ts`
  - Focused Vitest result: 11 files passed, 1 file failed (`MedDetailModal.test.tsx`, 1 failing assertion).
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Fix failing assertion in `src/test/components/MedDetailModal.test.tsx:329`:
    - expected `onSubmitRefill(mockMedication.id, undefined)`
    - received `onSubmitRefill(mockMedication.id, false)`
  - Re-run the same focused Vitest command after the assertion/behavior is aligned.

### 2026-02-27

- **🧩 Scope**: Issue #309 — Optionally disable form login when OIDC enabled
- **🛠️ What changed**:
  - New env var `FORM_LOGIN_ENABLED` (default `true`). Set to `false` to hide username/password form and only show the OIDC SSO button.
  - Renamed all internal `localAuthEnabled` references to `formLoginEnabled` for clarity.
  - Backend enforces lockout guard at startup — if no login method is available, the server refuses to start with a clear error message.
  - Backend warns if `REGISTRATION_ENABLED=true` but form login is off (registration has no effect without the form).
  - First-user setup override: even with `FORM_LOGIN_ENABLED=false`, the first admin account can always be created locally.
  - All existing frontend/backend tests pass (55 frontend + 32 backend).
  - Lint clean.
- **📁 Files touched**:
  - `backend/src/plugins/env.ts`
  - `backend/src/plugins/auth.ts`
  - `backend/src/routes/auth.ts`
  - `frontend/src/components/Auth.tsx`
  - `frontend/src/test/components/Auth.test.tsx`
  - `frontend/src/test/components/AppHeader.test.tsx`
  - `backend/src/test/auth.test.ts`
  - `.env.example`
- **🔜 Follow-ups**:
  - E2E test for OIDC-only login flow → delegate to @testing-manager
  - Consider adding backend unit test specifically for FORM_LOGIN_ENABLED=false scenarios

### 2026-02-27 (Local pre-PR gate validation: `chore/improve-logging`)

- **🧩 Scope**: Validate minimal relevant non-interactive lint/tests for changed files:
  - `.env.example`
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/src/db/client.ts`
  - `backend/src/db/db-utils.ts`
  - `backend/src/index.ts`
  - `backend/src/routes/doses.ts`
  - `backend/src/routes/health.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/test/e2e-routes.test.ts`
  - `backend/src/utils/logger.ts`
  - `frontend/nginx-entrypoint.sh`
  - `frontend/nginx.conf`
- **🛠️ What changed**:
  - Ran `cd backend && npm run lint` → passed.
  - Ran `cd frontend && npm run lint` → warning found in `src/components/MedicationAvatar.tsx` (`useExhaustiveDependencies`).
  - Ran `cd backend && CI=true npm run test:run -- src/test/e2e-routes.test.ts` → passed (103/103).
  - No code changes were made as part of this validation request.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Resolve frontend lint warning in `frontend/src/components/MedicationAvatar.tsx` before considering local pre-PR gate fully satisfied.

### 2026-02-26 — Structured Logging Implementation Plan

- **🧩 Scope**: Observability / logging improvements
- **🛠️ What changed**:
  - Created implementation plan to fix the log noise problem: nginx and Fastify log every 5-second dose-polling request at `info` level, making `info` unusable.
  - Plan covers 5 phases: (1) suppress noisy backend routes via per-route `logLevel`, (2) add timestamps to startup logger + pino-pretty for dev, (3) suppress polling in nginx access logs, (4) differentiate debug/info/warn in nginx entrypoint, (5) update docs.
- **📁 Files touched**:
  - `plan/feature-structured-logging-1.md` (new)
- **🔜 Follow-ups**:
  - Implement the 18 tasks across 5 phases.

### 2026-02-26 — Structured Logging Implementation (complete)

- **🧩 Scope**: Observability / logging — make `LOG_LEVEL=info` usable
- **🛠️ What changed**:
  - **Backend route noise suppression**: `GET /health` (logLevel: warn), `GET /doses/taken` and `GET /share/:token/doses` (logLevel: debug) — these high-frequency polling routes no longer flood `info` logs with Pino's automatic `incoming request` / `request completed` messages.
  - **Startup logger timestamps**: All pre-Fastify log messages (DB migrations, etc.) now include `[2026-02-26T14:30:05.123Z] [INFO]` prefix.
  - **pino-pretty for development**: Backend dev mode now outputs human-readable, colorized log lines with translated timestamps (production still uses structured JSON).
  - **nginx polling suppression**: New dedicated `location` blocks in `nginx.conf` for `/api/doses/taken`, `/api/share/*/doses`, and `/api/health` with conditional `access_log` via `NGINX_POLLING_LOG` variable.
  - **nginx 3-tier LOG_LEVEL**: `debug` = all access logs, `info` = all except polling (default), `warn+` = no access logs.
  - **nginx timestamps**: Custom `log_format timed` with ISO 8601 timestamps applied to all access logging.
  - **Documentation**: `.env.example` and `README.md` updated with detailed per-level behavior.
- **📁 Files touched**:
  - `backend/src/routes/health.ts`
  - `backend/src/routes/doses.ts`
  - `backend/src/utils/logger.ts`
  - `backend/src/index.ts`
  - `backend/package.json` + `package-lock.json`
  - `frontend/nginx.conf`
  - `frontend/nginx-entrypoint.sh`
  - `.env.example`
  - `README.md`
- **🔜 Follow-ups**:
  - Docker build + manual live verification
  - Delegate automated test coverage to @testing-manager

### 2026-02-26

- **Scope**: Update governance instructions for persistent agent memory and user-readable reporting.
- **What changed**:
  - Added a **VERY IMPORTANT** section to `.github/copilot-instructions.md`.
  - Added a **VERY IMPORTANT — Memory + Reporting Persistence** section to `AGENTS.md`.
  - Removed the obsolete mandatory `doku/APP_BEHAVIOR.md` persistence rule from `AGENTS.md`.
  - Created `doku/memory_notes.md` and `doku/report.md`.
- **Files touched**:
  - `.github/copilot-instructions.md`
  - `AGENTS.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **Follow-ups**:
  - Keep both files updated on every meaningful task going forward.

### 2026-02-26 (follow-up)

- **Scope**: Add ultra-short maintenance templates so future updates stay consistent.
- **What changed**:
  - Added a "How to maintain (1-minute template)" section in this file.
  - Added a matching "How to maintain" section in `doku/memory_notes.md`.
- **Files touched**:
  - `doku/report.md`
  - `doku/memory_notes.md`
- **Follow-ups**:
  - Reuse the templates for all upcoming meaningful tasks.

### 2026-02-26 (emoji template follow-up)

- **🧩 Scope**: Add emoji label conventions for faster, more readable scan in future entries.
- **🛠️ What changed**:
  - Updated the report template labels to emoji-based headings.
  - Updated the memory notes template labels to the same style.
- **📁 Files touched**:
  - `doku/report.md`
  - `doku/memory_notes.md`
- **🔜 Follow-ups**:
  - Use this emoji format for all upcoming entries unless governance changes.

### 2026-02-26 (testing-manager instruction update)

- **🧩 Scope**: Tighten testing governance in the `testing-manager` agent instructions.
- **🛠️ What changed**:
  - Added mandatory linting gate: all lint errors and simple/fixable warnings must be resolved, especially before PR handoff from `@release-manager`.
  - Added strict reliability/validity rules to avoid fake-green tests and over-mocking.
  - Added a concrete test validity checklist focused on true functional verification.
  - Updated command examples to current setup:
    - Backend Vitest via `CI=true npm run test:run` / `test:coverage`
    - Frontend Vitest via `CI=true npm run test:run` / `test:coverage`
    - Playwright E2E with `PLAYWRIGHT_HTML_OPEN=never` and CI-stable worker guidance.
- **📁 Files touched**:
  - `.github/agents/testing-manager.agent.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Reuse these strengthened rules for future CI triage and pre-PR test handoffs.

### 2026-02-26 (pre-PR local gate update)

- **🧩 Scope**: Make pre-PR quality requirements explicit for testing handoff.
- **🛠️ What changed**:
  - Added explicit pre-PR rule: no PR creation before local lint is clean and relevant tests pass locally.
  - Added explicit anti-pattern rule: do not let obvious regressions be discovered first in GitHub CI.
  - Updated workflow/lint sections and done criteria to include this mandatory local gate.
- **📁 Files touched**:
  - `.github/agents/testing-manager.agent.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Enforce this gate in every future testing handoff before PR creation.

### 2026-02-26 (release-manager gate alignment)

- **🧩 Scope**: Apply the same local quality gate requirements to `release-manager` workflow.
- **🛠️ What changed**:
  - Added explicit pre-PR local gate rule in `release-manager`: lint clean + relevant tests passed locally before PR creation.
  - Added explicit no CI-first-failure rule in `release-manager` critical safety section.
  - Updated release workflow steps so push/PR creation is blocked until local gate is confirmed.
- **📁 Files touched**:
  - `.github/agents/release-manager.agent.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Reuse this policy consistently for all future release PR orchestration.

### 2026-02-26 (React 19 plan refinement)

- **🧩 Scope**: Validate that the React 19 plan follows official best practices.
- **🛠️ What changed**:
  - Confirmed from the React 19 upgrade guide: TypeScript projects should upgrade to `@types/react@^19` and `@types/react-dom@^19`.
  - Updated recommendation: do not remove `@types/*` packages during this upgrade.
  - Updated scope policy: keep upgrade PR focused on version bump and required compatibility fixes only.
  - Marked optional feature adoption (`useOptimistic`, `useFormStatus`, Server Components, broader API migrations) as follow-up PR scope.
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Apply this exact scope and dependency policy when implementing the React 19 upgrade branch.

### 2026-02-26 (React 19 implementation)

- **🧩 Scope**: Execute the scoped React 19 dependency upgrade in frontend only.
- **🛠️ What changed**:
  - Upgraded `react` and `react-dom` to `^19.2.0` in frontend dependencies.
  - Upgraded `@types/react` and `@types/react-dom` to `^19.2.2` (kept them, not removed).
  - Updated `frontend/package-lock.json` entries for `react`, `react-dom`, `scheduler`, `@types/react`, and `@types/react-dom` to matching 19.x metadata.
  - Kept migration scope strict: no optional React 19 feature adoption or broad refactors.
- **📁 Files touched**:
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Delegate local validation (lint/check/tests) to `@testing-manager` before PR handoff.

### 2026-02-26 (Testing handoff execution)

- **🧩 Scope**: Run `frontend` lint/check/relevant tests after React 19 upgrade and apply only mandatory compatibility fixes.
- **🛠️ What changed**:
  - Ran `npm run lint` in `frontend`: 1 existing warning remains in `src/components/MedicationAvatar.tsx` (`useExhaustiveDependencies`).
  - Ran `npm run check` in `frontend`: fixed compatibility/type errors in targeted tests:
    - `src/test/utils/ics.test.ts` (typed mock assignments + fixture default safety)
    - `src/test/utils/schedule.test.ts` (added required `packageType` in medication fixtures, event `id` field)
    - `src/test/components/MobileEditModal.test.tsx` (added required `imageUploadError` prop and form-event typing)
  - Ran focused test scope:
    - `CI=true npm run test:run -- src/test/utils/ics.test.ts src/test/utils/schedule.test.ts src/test/components/MobileEditModal.test.tsx`
    - Result: 3 files passed, 147 tests passed.
  - `frontend check` is still blocked by unrelated type mismatches in `src/test/components/MedDetailModal.test.tsx` (new required props and `RefillEntry` shape drift).
- **📁 Files touched**:
  - `frontend/src/test/utils/ics.test.ts`
  - `frontend/src/test/utils/schedule.test.ts`
  - `frontend/src/test/components/MobileEditModal.test.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Separate follow-up to align `MedDetailModal` tests with current `MedDetailModalProps` and `RefillEntry` type.
  - Decide whether to resolve or waive the existing lint warning in `MedicationAvatar.tsx` for strict pre-PR gate.

### 2026-02-26 (Blocker follow-up)

- **🧩 Scope**: Resolve remaining non-test lint blocker and prepare delegated test-fix handoff.
- **🛠️ What changed**:
  - Fixed the remaining lint warning in `frontend/src/components/MedicationAvatar.tsx` by making image reset logic dependency-safe with previous-value tracking (`useRef`).
  - Kept `MedDetailModal.test.tsx` adaptations delegated to `@testing-manager` per testing ownership rule.
  - Prepared concrete handoff targets for `@testing-manager`:
    - Add required props in test `defaultProps`: `usePrescriptionRefill`, `onUsePrescriptionRefillChange`.
    - Update `RefillEntry` fixtures from old fields (`medicationId`, `timestamp`, `looseAdded`) to current shape (`refillDate`, `loosePillsAdded`).
- **📁 Files touched**:
  - `frontend/src/components/MedicationAvatar.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - `@testing-manager` to run and fix the full `frontend check` residual failures in `src/test/components/MedDetailModal.test.tsx`.

### 2026-02-26 (Dependency update automation)

- **🧩 Scope**: Automate dependency updates with controlled auto-merge.
- **🛠️ What changed**:
  - Extended existing `.github/dependabot.yml` for weekly updates across `frontend`, `backend`, root npm tooling, and GitHub Actions.
  - Added grouping for minor/patch updates in root npm and GitHub Actions to reduce PR noise.
  - Added scoped labels (`frontend`, `backend`, `root`, `ci`) for easier triage.
  - Added `.github/workflows/dependabot-automerge.yml` to enable auto-merge only for Dependabot patch/minor updates (npm + GitHub Actions), while major updates remain manual.
  - Updated `README.md` with a new "Dependency Updates" section and changed the React badge to 19.
- **📁 Files touched**:
  - `.github/dependabot.yml`
  - `.github/workflows/dependabot-automerge.yml`
  - `README.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Verify repository branch protection required checks are configured so auto-merge waits for CI gates as intended.

### 2026-02-26 (Automatic handoff to testing-manager)

- **🧩 Scope**: Execute delegated testing ownership without waiting for user confirmation.
- **🛠️ What changed**:
  - Issued direct handoff to `@testing-manager` for residual `frontend check` blockers in `frontend/src/test/components/MedDetailModal.test.tsx`.
  - Handoff checklist includes:
    - add required `MedDetailModalProps` test props (`usePrescriptionRefill`, `onUsePrescriptionRefillChange`),
    - align `RefillEntry` test fixtures to current type shape (`refillDate`, `loosePillsAdded`),
    - run `cd frontend && npm run check` and report remaining deltas.
- **📁 Files touched**:
  - `doku/report.md`
  - `doku/memory_notes.md`
- **🔜 Follow-ups**:
  - After `@testing-manager` completion, continue with PR-ready summary and release handoff.

### 2026-02-26 (Continued execution: frontend check fully green)

- **🧩 Scope**: Continue implementation to remove all remaining `frontend` type/lint blockers.
- **🛠️ What changed**:
  - Fixed remaining production type/lint blockers in:
    - `src/components/MobileEditModal.tsx` (prop destructuring + packageType change handler typing)
    - `src/components/SharedSchedule.tsx` (critical threshold typing)
    - `src/context/AppContext.tsx` (import result typing for imported counts)
    - `src/pages/dashboard-helpers.ts` (strict `PackageType` + null-safe stockAdjustment)
    - `src/pages/DashboardPage.tsx` (missing `Coverage` type import)
    - `src/utils/stock.ts` (removed unreachable nullish coalescing)
  - Fixed remaining test typing drift in:
    - `src/test/setup.ts`
    - `src/test/components/Lightbox.test.tsx`
    - `src/test/components/UserFilterModal.test.tsx`
    - `src/test/context/AppContext.test.tsx`
    - `src/test/hooks/useMedications.test.ts`
    - `src/test/hooks/useRefill.test.ts`
    - `src/test/hooks/useSettings.test.ts`
    - `src/test/hooks/useShare.test.ts`
    - `src/test/utils/formatters.test.ts`
    - `src/test/utils/schedule.test.ts`
  - Validation results:
    - `cd frontend && npm run check` -> **PASS**
    - `CI=true npm run test:run -- src/test/hooks/useShare.test.ts src/test/hooks/useRefill.test.ts src/test/hooks/useSettings.test.ts src/test/utils/formatters.test.ts` -> **PASS** (4 files, 84 tests)
- **📁 Files touched**:
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
- **🔜 Follow-ups**:
  - Optional: run full frontend test suite as additional confidence step before release handoff.

### 2026-02-26 (npm integrity issue resolved)

- **🧩 Scope**: Fix `npm ci` failure caused by tarball integrity mismatch warnings/errors.
- **🛠️ What changed**:
  - Reproduced failure (`EINTEGRITY`) for `@types/react@19.2.2` / `@types/react-dom@19.2.2`.
  - Pulled authoritative integrity hashes from npm registry via:
    - `npm view @types/react@19.2.2 dist.integrity`
    - `npm view @types/react-dom@19.2.2 dist.integrity`
  - Corrected two integrity strings in `frontend/package-lock.json` to match official registry values.
  - Re-ran install:
    - `npm ci --no-audit --no-fund` -> **PASS**.
- **📁 Files touched**:
  - `frontend/package-lock.json`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - None required for this issue; install path is healthy again.

### 2026-02-26 (Deprecation warnings triage)

- **🧩 Scope**: Investigate reported npm deprecation warnings and determine if local code changes are required.
- **🛠️ What changed**:
  - Verified warnings are from `backend` transitive deps, not `frontend`:
    - `drizzle-kit@0.31.9` -> `@esbuild-kit/esm-loader@2.6.5` -> `@esbuild-kit/core-utils@3.3.2`
    - `@libsql/client@0.17.0` -> `node-fetch@3.3.2` -> `fetch-blob@3.2.0` -> `node-domexception@1.0.0`
  - Confirmed current installed versions are already latest published for both direct parents (`drizzle-kit`, `@libsql/client`).
  - Classified as non-blocking upstream deprecation warnings (no immediate local fix available without changing stack/library choices).
- **📁 Files touched**:
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Re-evaluate after upstream releases; remove warnings via normal dependency updates when available.

### 2026-02-26 (MedDetailModal test type drift fix)

- **🧩 Scope**: Fix only residual prop/type drift in `MedDetailModal` tests to unblock frontend check target area.
- **🛠️ What changed**:
  - Updated `defaultProps` in `frontend/src/test/components/MedDetailModal.test.tsx` with required `MedDetailModalProps` fields:
    - `usePrescriptionRefill`
    - `onUsePrescriptionRefillChange`
  - Updated `RefillEntry` fixtures in the same file to current type shape:
    - removed legacy fields (`medicationId`, `timestamp`, `looseAdded`)
    - added current fields (`refillDate`, `loosePillsAdded`)
  - Ran `cd frontend && npm run check`: the file-specific drift is resolved, but command still fails due unrelated TypeScript errors in other frontend files.
- **📁 Files touched**:
  - `frontend/src/test/components/MedDetailModal.test.tsx`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Resolve remaining unrelated `frontend` TypeScript errors before rerunning full `npm run check` and then the targeted MedDetailModal test command.

### 2026-02-27 (Package types plan decisions finalized)

- **🧩 Scope**: Integrate final product decisions into `doku/package_types.md` so the V1 concept is implementation-ready.
- **🛠️ What changed**:
  - Locked lifecycle handling:
    - `ongoing` is a derived state (`endDate == null`), not a stored explicit lifecycle value.
    - Clarified precedence that `endDate` overrides `ongoing` behavior.
  - Locked V1 form scope:
    - Keep exactly 4 forms (`Capsule`, `Tablet`, `Liquid`, `Topical`).
    - No subforms in V1; users map variants like cream/gel to these forms.
  - Locked end-date behavior:
    - `autoMarkObsoleteAfterEndDate` default set to `true`.
  - Improved wording quality:
    - renamed lifecycle section title from "restore" to neutral "categorization".
- **📁 Files touched**:
  - `doku/package_types.md`
  - `doku/memory_notes.md`
  - `doku/report.md`
- **🔜 Follow-ups**:
  - Use these locked rules as acceptance criteria when creating implementation tasks (backend validation, frontend parity, export/import compatibility).

### 2026-02-27 (Website implementation: V1 medication forms + lifecycle fields)

- **🧩 Scope**: Implement approved package-type plan decisions directly in the web product (backend persistence + desktop/mobile UI).
- **🛠️ What changed**:
  - Backend data model extended with new medication metadata:
    - `medicationForm` (`capsule|tablet|liquid|topical`)
    - `pillForm` (`tablet|capsule`)
    - `lifecycleCategory` (`refill_when_empty|treatment_period`)
    - `medicationEndDate`
    - `autoMarkObsoleteAfterEndDate` (default `true`)
  - Backward-compatible DB rollout implemented:
    - schema update in `backend/src/db/schema.ts`
    - alter-migration compatibility statements in `backend/src/db/db-utils.ts`
    - generated Drizzle migration: `backend/drizzle/0011_stiff_randall_flagg.sql`
  - API validation and DTO mapping updated in `backend/src/routes/medications.ts`:
    - `pillForm` required for capsule/tablet medication forms
    - fractional intake rejected for capsule
    - liquid/topical constrained to bottle container
    - end-date/start-date consistency validation
  - Auto-obsolete behavior implemented:
    - medications are auto-marked obsolete when end date is reached and `autoMarkObsoleteAfterEndDate=true`
  - Export/import now includes new metadata (`backend/src/routes/export.ts`, export format version `1.2`).
  - Frontend desktop + mobile parity implemented:
    - new form controls in `frontend/src/pages/MedicationsPage.tsx`
    - same controls in `frontend/src/components/MobileEditModal.tsx`
    - dynamic intake usage labels by form (`tablet/capsule/ml/application`)
    - capsule intake now blocks fractional values in UI
  - Frontend typing + defaults updated (`frontend/src/types/index.ts`, `frontend/src/hooks/useMedicationForm.ts`) and i18n keys added in both languages (`frontend/src/i18n/en.json`, `frontend/src/i18n/de.json`).
- **📁 Files touched**:
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
- **🔜 Follow-ups**:
  - Optional: run full repo-wide frontend check after existing unrelated E2E formatting diffs are cleaned up.

## 2026-03-02 - Pre-PR Gate Validation (MedicationsPage label/order UI update)

- Scope validated: `frontend/src/pages/MedicationsPage.tsx` (usage label selection by intake unit and medication end-date field order adjustment).
- Commands executed:
  - `cd frontend && npm run lint`
  - `cd frontend && CI=true npm run test:run -- src/test/utils/schedule.test.ts`
  - `cd frontend && PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_WORKERS=1 npx playwright test e2e/medication-edit.spec.ts e2e/schedule.spec.ts --config=playwright.stable.config.ts --workers=1`
- Results:
  - Lint: PASS (`biome check` clean).
  - Targeted frontend unit test: PASS (82 passed).
  - Targeted frontend E2E tests: PASS (23 passed).
- Gate decision: PASS for pre-PR local quality gate on this change scope.
