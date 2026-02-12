---
name: medassist-i18n-enforcer
description: Enforce MedAssist i18n rules so UI copy is always translation-key based for English and German, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when changing frontend UI text, form labels, alerts, dialogs, or page content.

## Rules

- Do not hardcode new user-facing strings in React components.
- Use translation keys via `t("...")`.
- Add or update matching keys in:
  - `frontend/src/i18n/en.json`
  - `frontend/src/i18n/de.json`
- Keep semantic key naming consistent with existing namespaces.

## Validation

1. Every new UI string has a key.
2. English and German entries are both present.
3. No fallback-to-English hardcoded text remains in JSX.

## Response Format

List:

- New keys added
- Files where keys were used
- Any intentionally unchanged text and reason
