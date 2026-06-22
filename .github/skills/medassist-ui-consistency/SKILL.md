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

1. Use `AppModal` for app-owned dialogs. Do not create new raw overlay/modal DOM for product UI.
2. Use `AppModalFooter` for modal action bars. Do not add `className` to `AppModalFooter`; use its props (`left`, `layout`, `stackOnMobile`) for approved variants.
3. Do not add local modal footer layout CSS such as shadows, `justify-content: space-between`, zero horizontal padding, or custom sticky/footer scroll behavior.
4. Keep exactly one modal scroll owner: the shared `AppModal` body. Do not add a second `overflow-y: auto` on modal content unless a nested scroll region is the explicit product requirement.
5. For nested sub-modals, keep them on `AppModal`/`useModalHistory` patterns so only the top modal handles close/back behavior.
6. For any modal/footer work, run or explicitly hand off the guard tests:
   - `npm --prefix frontend run test:run -- src/test/ui/modal-footer-contract.test.ts`
   - `npx playwright test --config=playwright.stable.config.ts e2e/modal-layout-contract.spec.ts`

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
