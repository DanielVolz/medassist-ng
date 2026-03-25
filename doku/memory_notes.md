# Agent Memory Notes

Purpose: persistent agent work memory to survive context loss.

## Entries

### 2026-03-25

- Task: Split the stock/refill semantics changes into a standalone release branch and repair split-induced frontend test corruption until focused local validation passed.
- Decisions: Kept this branch limited to stock/refill semantics, repaired the shared MedicationsPage/UI tests against clean main structure, and kept root main clean by moving releasable scope into this worktree.
- Files touched: backend/src/routes/medications.ts, backend/src/routes/refills.ts, backend/src/test/e2e-routes.test.ts, frontend/src/components/MedDetailModal.tsx, frontend/src/components/ReportModal.tsx, frontend/src/components/UserFilterModal.tsx, frontend/src/hooks/useRefill.ts, frontend/src/pages/MedicationsPage.tsx, frontend/src/test/components/MedDetailModal.test.tsx, frontend/src/test/components/ReportModal.test.tsx, frontend/src/test/components/UserFilterModal.test.tsx, frontend/src/test/hooks/useRefill.test.ts, frontend/src/test/pages/MedicationsPage.test.tsx, frontend/src/test/types.test.ts, frontend/src/types/index.ts.
- Follow-up: Create a dedicated bug issue, push the branch, open a PR, and wait for GitHub CI before merge.
