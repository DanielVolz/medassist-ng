---
name: medassist-release-preflight
description: Use only when deciding a release version or preparing a release branch or PR; excludes CI monitoring, release notes, tags, and publishing.
---

# Release Preflight

Use only before a release PR exists. Do not use for PR CI monitoring, release-note drafting, tag creation, or post-tag assets.

## Clean Source And Version

1. Fetch the authoritative remote default `main`; compare the intended scope against it. Never use dirty, behind, mixed, or already-upstream local `main` as release truth. Classify unrelated changes and use a clean worktree when needed.
2. Inspect both package versions, the latest tag, and actual changes since that tag. Recommend SemVer: fixes are patch, backward-compatible user-facing features minor, and breaking API/config/data changes major. Prefer minor when user-visible new behavior is uncertain. Wait for confirmation before a bump.
3. For a minor or major release, assess README impact and obtain approval for needed documentation changes. A patch needs this only when documented behavior changes.
4. Create `chore/release-X.Y.Z` from authoritative `main`. Set `backend/package.json` and `frontend/package.json` to `X.Y.Z`, and pin production `docker-compose.yml` backend/frontend images to `ghcr.io/danielvolz/medassist-ng-{backend,frontend}:X.Y.Z`; never leave production compose on `:latest`.

## Local Gate And Traceability

- Require `@testing-manager`'s local gate before creating a PR: clean lint without simple/fixable warnings and relevant tests passing. Do not use CI as first detection for local regressions.
- Ensure a related `enhancement`, `bug`, or `triage` issue and move it to In progress when tooling is available; record any limitation.
- Create one logical branch and PR with English conventional title, `Closes #N`, assignee `DanielVolz`, type-matched label, and `@DanielVolz's MedAssist-ng project`. Add an issue comment linking the PR and summarizing the change.
- Store remote, branch, current head SHA, PR URL, local gate, and traceability result for `medassist-release-ci-monitoring`.
