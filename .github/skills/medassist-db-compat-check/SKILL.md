---
name: medassist-db-compat-check
description: Enforce backward-compatible database changes for MedAssist SQLite and Drizzle migrations, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill for any feature or fix that adds or reads persisted data.

## Mandatory Sequence

For every new persisted field/column:

1. Add the column in `backend/src/db/schema.ts` with `NOT NULL DEFAULT <value>`.
2. Generate migration with Drizzle Kit.
3. Add matching `ALTER TABLE` logic in `backend/src/db/client.ts` inside `runAlterMigrations()`.
4. Read values null-safe in routes/services (`?? defaultValue`).

## Hard Rules

- Never remove or rename existing columns.
- Never add non-null columns without defaults.
- Never read newly added fields without fallback.
- Never manually edit generated Drizzle SQL migrations.

## Verification Checklist

- Schema update exists.
- Generated migration exists.
- Alter migration for existing DBs exists.
- Runtime reads are fallback-safe.

## Response Format

Report these items explicitly:

- New/changed columns
- Added alter-migration statements
- Null-safe read locations
- Remaining migration risk (if any)
