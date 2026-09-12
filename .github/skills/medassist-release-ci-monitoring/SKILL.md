---
name: medassist-release-ci-monitoring
description: Use only after a PR exists to monitor required CI, merge readiness, and project completion; excludes release preparation, notes, tags, and publishing.
---

# Release CI Monitoring

Use only after a PR exists. Do not use for release versioning, note drafting, tags, or GitHub release publication.

## Authoritative PR Gate

When the user reports that a PR is green, perform one authenticated PR-level query for the current head containing headRefOid, statusCheckRollup, mergeable, and mergeStateStatus. Treat the PR as green only when statusCheckRollup is SUCCESS, mergeable is MERGEABLE, and mergeStateStatus is CLEAN. Do not enumerate individual checks when this aggregate gate is successful. Inspect individual check details only when the aggregate is not successful, the head changed, or GitHub reports a concrete blocker.

Container Smoke is already included in the PR rollup when required by the workflow; do not query it a second time after a successful aggregate gate. A successful rollup alone is not merge authorization if mergeable or mergeStateStatus is blocked.

## Continuous State

Maintain and continuously reuse one compact record:

```text
{ remote, branch, headSHA, prUrl, requiredChecks, latestStateOrResult, nextAction }
```

Keep one monitoring session/process for that record until completion or a genuine blocker. When checks are `pending` or `in_progress`, wait and refresh only current-head checks in the same session; do not return merely to be reinvoked. On resumption, refresh the remote head first. If it changed, update the record, replace required checks for that head, and restart only that monitoring cycle.

## Gate, Merge, And Cleanup

- Use the authoritative PR gate above. Inspect individual checks only when that gate reports failure, the head changed, or GitHub reports a concrete blocker.
- Hand only test/E2E failures to `-manager`; retain the current-head record for repairs and diagnose other release-operational failures without bypassing gates.
- When authorized and the gate is green, squash merge and delete the branch. Verify the merged commit and requested traceability.
- Re-sync local `main` only when requested, then remove task worktrees and temporary state.
