---
name: medassist-observability-guard
description: Ensure MedAssist changes preserve actionable logging, health checks, and clear operational error visibility, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when changes affect backend services, schedulers, integrations, startup flow, or failure handling.

## Objective

Maintain operational visibility so failures are detectable, diagnosable, and actionable.

## Required Checks

1. Critical paths keep clear error reporting.
2. Health-check behavior remains intact and meaningful.
3. Logs contain actionable context without leaking secrets.
4. Errors are surfaced with enough detail for debugging.
5. Silent failure paths are avoided.

## MedAssist Focus Areas

- `backend/src/index.ts`
- `backend/src/routes/health.ts`
- `backend/src/services/*`
- Scheduler and notification flows

## Anti-Patterns

- Swallowed exceptions.
- Generic logs with no context.
- Missing visibility for background failures.

## Response Format

Return:

- Observability touchpoints reviewed
- Gaps found and suggested fixes
- Operational risk level
