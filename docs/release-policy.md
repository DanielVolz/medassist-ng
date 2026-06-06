# Release Version Policy

MedAssist-ng uses strict runtime package versioning.

For every release tag `vX.Y.Z`, these package versions must be exactly `X.Y.Z`:

- `backend/package.json`
- `frontend/package.json`
- `shared/package.json`

The root `package.json` is a private orchestration package and does not carry the runtime release version.

## Shared Package Contract

Backend and frontend both consume `@medassist/shared` through `file:../shared`. Because the shared package is built into the backend and frontend release artifacts, it must be versioned with the same release number as the runtime packages. Version drift is not allowed.

The release preflight validates:

- backend, frontend and shared package versions match the release tag
- backend and frontend keep `@medassist/shared` as `file:../shared`
- package lock entries record the same shared package version
- Docker builds copy and build the shared package from source
- the backend runtime image contains the built shared package manifest and `dist/`

## Release Checklist

When preparing a release:

1. Update `backend/package.json`, `frontend/package.json` and `shared/package.json` to the release version.
2. Refresh all affected lockfiles.
3. Run `npm run release:preflight -- --tag vX.Y.Z --static-only`.
4. Continue the release only when preflight passes.

Do not intentionally ship backend/frontend/shared version drift. If independent package versioning is ever needed, update this document, `release-policy.json` and `scripts/release-preflight.mjs` in the same policy PR before changing release behavior.
