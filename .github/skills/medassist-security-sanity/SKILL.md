---
name: medassist-security-sanity
description: Apply baseline security checks to MedAssist code changes, especially for backend routes, auth flows, and input handling, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when a change touches backend routes, auth/session logic, file handling, imports/exports, or external input.

## Objective

Prevent common security regressions with fast, practical checks during implementation.

## Required Checks

1. Validate and sanitize external input at API boundaries.
2. Enforce auth/authz server-side for protected actions.
3. Ensure secrets/tokens are never hardcoded or logged.
4. Avoid information leakage in error responses.
5. Keep permission-sensitive operations explicit and auditable.

## MedAssist Focus Areas

- Route handlers in `backend/src/routes/`.
- Auth-related code in `backend/src/plugins/` and auth routes.
- Data import/export and sharing endpoints.
- File/image upload and serving paths.

## Anti-Patterns

- Trusting frontend-only checks.
- Accepting unchecked query/body/path input.
- Returning raw internal errors to clients.
- Weak defaults for sensitive operations.

## Response Format

Report:

- Security-sensitive files reviewed
- Findings by severity (critical/major/minor)
- Concrete remediation actions
- Residual risk (if any)
