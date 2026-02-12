---
name: medassist-architecture-guard
description: Guard MedAssist architectural boundaries and route/data-flow conventions when changing backend or frontend code, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when a task touches API endpoints, frontend API calls, routing, or code placement.

## Goals

- Keep responsibilities in the correct layer.
- Preserve MedAssist proxy and routing conventions.
- Prevent architecture drift and cross-layer anti-patterns.

## Required Checks

1. Frontend network calls use `/api/*` paths.
2. Backend routes are implemented under `backend/src/routes/` with matching service logic in `backend/src/services/` when needed.
3. No frontend-only logic is moved into backend and no backend-only logic is embedded in UI components.
4. Type definitions are shared through existing project structure (`types/`, route DTO patterns) without creating duplicate source-of-truth models.

## MedAssist-Specific Guardrails

- Respect Vite proxy behavior: frontend calls `/api/*`, backend exposes `/...` routes.
- Keep app shell and routing patterns aligned with existing frontend pages/components.
- Prefer minimal, local changes over broad restructures.

## Response Format

When this skill is used, summarize:

- Which architectural checks were applied
- Which files are affected
- Any boundary risks found and how they were resolved
