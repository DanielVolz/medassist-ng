---
name: medassist-release-publish
description: Use only after a release PR has merged for tagging, GitHub release publication, and post-tag Docker assets; excludes PR creation, CI monitoring, and note drafting.
---

# Release Publish

Use only after the release branch has merged. Do not use for PR creation, PR CI monitoring, or drafting the release-note template. Before any `gh release create` or `gh release edit`, load `medassist-release-notes` and pass its pre-publication and rendered-body checks.

1. From merged authoritative `main`, create and publish the authorized signed `vX.Y.Z` tag only when both package versions and production compose image tags are exactly `X.Y.Z`.
2. Publish or update GitHub release notes only through the `gh release create` or `gh release edit` note-body action defined by `medassist-release-notes`.
3. Keep one state record while monitoring the tagged Docker workflow. Verify versioned `X.Y.Z`, `X.Y`, and `latest` backend/frontend images are published.
4. Verify the GitHub release includes `docker-compose.pinned.yml` with backend and frontend `X.Y.Z@sha256:...` references produced by the same tagged build, and that merged compose tags match `X.Y.Z`, not later `latest` images.
5. Verify post-build badge update completion. Report the release URL, tag/merge SHA, image/asset verification, badge result, and any genuine blocker.
