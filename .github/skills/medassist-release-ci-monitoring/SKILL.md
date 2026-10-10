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

Maintain one compact record:

```text
{ remote, branch, headSHA, prUrl, latestStateOrResult, nextAction }
```

Use a bounded continuous watch while checks are pending, for example `gh pr checks --watch --interval 30`, with a maximum of 45 minutes. Do not stop after an arbitrary number of status reads while the authorized merge is still actionable. On timeout, report the exact pending checks and incomplete operation. If the rollup is successful but mergeStateStatus is BLOCKED, inspect and report the blocker once; never poll an unchanged blocked PR.

Prefer the authenticated `gh` CLI, including OS-keyring authentication. Missing MCP tools or token environment variables are not evidence of missing access. Before declaring an access blocker, execute a read through the chosen transport and retain the actual error; never print or extract credentials.

## Gate, Merge, And Cleanup

- Use the authoritative PR gate above. Inspect individual checks only when that gate reports failure, the head changed, or GitHub reports a concrete blocker.
- Hand only test/E2E failures to `@testing-manager`; retain the current-head record for repairs and diagnose other release-operational failures without bypassing gates.
- When authorized and the gate is green, invoke the squash merge against the verified head (for example, `gh pr merge --squash --match-head-commit <headSHA>`). A green status or a handoff is not completion: read the PR again and require `MERGED`, its merge commit, and requested traceability before reporting success. Delete the merged branch when safe.
- Re-sync local `main` only when requested, then remove task worktrees and temporary state.
