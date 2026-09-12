---
name: medassist-release-ci-monitoring
description: Use only after a PR exists to monitor required CI, merge readiness, and project completion; excludes release preparation, notes, tags, and publishing.
---

# Release CI Monitoring

Use only after a PR exists. Do not use for release versioning, note drafting, tags, or GitHub release publication.

## Continuous State

Maintain and continuously reuse one compact record:

```text
{ remote, branch, headSHA, prUrl, requiredChecks, latestStateOrResult, nextAction }
```

Keep one monitoring session/process for that record until completion or a genuine blocker. When checks are `pending` or `in_progress`, wait and refresh only current-head checks in the same session; do not return merely to be reinvoked. On resumption, refresh the remote head first. If it changed, update the record, replace required checks for that head, and restart only that monitoring cycle.

## Gate, Merge, And Cleanup

- Determine exact required checks for the recorded head. For backend, frontend, shared, package, Docker, workflow, or runtime diffs, visible `Container Smoke` is also mandatory; missing, skipped, or failed smoke blocks progress.
- Do not merge while a required current-head check is non-green, pending, missing, or obsolete. Hand only test/E2E failures to `@testing-manager`; retain the record and monitor the repaired head. Diagnose other release-operational failures without bypassing gates.
- When authorized and all gates are green, squash merge and delete the branch. Verify the merged commit, closed issue, and project status; if project automation missed Done, resolve current project IDs and update it through GraphQL. Record unavailable tooling.
- Re-sync the primary checkout to clean local `main` at `<remote>/main` when requested, then remove task worktrees and temporary stashes.
