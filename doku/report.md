# Work Report

Purpose: user-facing summary of completed work.

## Format

For each task, add:

- Date
- Scope
- What changed
- Files touched
- Follow-ups (if any)

## How to maintain (1-minute template)

```md
### YYYY-MM-DD

- **🧩 Scope**:
- **🛠️ What changed**:
  -
- **📁 Files touched**:
  -
- **🔜 Follow-ups**:
  -
```

## Entries

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
