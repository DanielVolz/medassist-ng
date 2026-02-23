---
name: medassist-ui-consistency
description: Enforce non-negotiable MedAssist UI guardrails by reusing existing components, styles, and interaction patterns, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when implementing or editing UI flows, modals, buttons, forms, schedule views, or settings screens.

## Scope

This is the **guardrail skill** for UI work.
Use it to enforce consistency and prevent design drift.

Use `medassist-frontend-polish` only after these guardrails are satisfied.

## Do Not Use This Skill For

- Creative visual redesign requests where no product consistency constraints apply.
- Marketing-style one-off pages outside MedAssist product UI conventions.

## Rules

- Reuse existing components (for example `ConfirmModal`, `MedicationAvatar`) before creating new primitives.
- Keep spacing, typography, and button styles aligned with existing patterns.
- Avoid custom inline modal/button patterns that diverge from project design.
- Prefer extending existing CSS classes/styles instead of introducing parallel styling systems.

### Modal requirements (non-negotiable)

Every modal/overlay **must** follow these rules:

1. **Escape key**: Call `useEscapeKey(active, onClose)` from `hooks/useEscapeKey`. This registers a document-level `keydown` listener that works regardless of focus. **Never** rely on `onKeyDown` on an overlay div — it only fires when the overlay has focus, which almost never happens.
2. **Scroll lock**: Call `useScrollLock(active)` from `hooks/useScrollLock` if the modal is **not** already covered by App.tsx's centralized `useScrollLock` call. Page-local modals (e.g. `ReportModal`, `ExportModal`) must call it themselves.
3. **Click-outside close**: The overlay div gets `onClick={onClose}`, and `.modal-content` gets `onClick={(e) => e.stopPropagation()}`.
4. **Key event containment**: `.modal-content` gets `onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}` — this prevents non-Escape keys from leaking out while still allowing Escape to propagate to the document-level handler.
5. **Nested sub-modals** (e.g. edit-stock inside MedDetailModal): Use `useEscapeKey` with `{ capture: true }` so the innermost modal intercepts Escape before the parent's handler fires.

## Decision Heuristics

1. If an equivalent component exists, reuse it.
2. If small variant is needed, extend existing styles minimally.
3. If a new component is unavoidable, match existing naming and structure conventions.

## Response Format

Provide:

- Reused components/styles
- Any new UI element and why reuse was not possible
- Consistency risks reviewed
- Confirmation that `medassist-frontend-polish` constraints remain compatible (if polish work is also requested)
