---
name: medassist-frontend-polish
description: Improve frontend visual quality within the existing MedAssist design system, without introducing new themes, font stacks, or disruptive UI patterns, including equivalent requests phrased in German.
---

# Skill Instructions

Use this skill when the user wants UI improvements, better styling, or a more polished frontend, but the feature must stay consistent with MedAssist product UX.

## Scope

This is the **visual enhancement skill**.
It refines quality *within* existing product conventions.

Apply `medassist-ui-consistency` rules first, then use this skill for tasteful polish.

## Do Not Use This Skill For

- Replacing base UI patterns/components with new ones.
- New design-system direction, visual identity, or broad layout language changes.
- Marketing/brand-experiment pages that intentionally break product conventions.

## Objective

Deliver production-grade visual refinement that feels intentionally designed while remaining fully consistent with existing MedAssist components, spacing, typography, and interaction patterns.

## Strict Constraints

- Reuse existing components and patterns first (`ConfirmModal`, `MedicationAvatar`, existing form/button/layout patterns).
- Do not introduce new global theme systems, font families, or visual identity changes.
- Do not invent new UX flows, pages, or interaction models unless explicitly requested.
- Keep frontend text i18n-safe: use `t("...")` and EN/DE keys.
- Respect accessibility and readability over decorative effects.

## Allowed Enhancements

- Better spacing rhythm and visual hierarchy.
- Cleaner grouping, alignment, and density adjustments.
- Improved states (hover, focus, disabled, loading) using existing style language.
- Subtle transitions/micro-interactions that do not distract and do not change behavior.
- Consistent empty/error/success presentation using existing UI conventions.

## Not Allowed

- Random aesthetic overhauls.
- New color systems or hardcoded ad-hoc colors that break current theme tokens.
- Heavy animation, parallax, or attention-stealing motion.
- Typography experiments that diverge from current product style.
- "Creative" layout changes that reduce usability or consistency.

## Implementation Workflow

1. Confirm `medassist-ui-consistency` guardrails are satisfied.
2. Identify existing components and CSS patterns to reuse.
3. Define the smallest visual changes that improve clarity and quality.
4. Apply refinements in-place without changing core behavior.
5. Validate consistency across neighboring views/components.
6. Ensure i18n and accessibility are preserved.

## Response Format

When using this skill, report:

- Reused components and style primitives
- Specific polish improvements applied
- Any trade-offs/constraints respected
- Confirmation that no new design system or disruptive UX pattern was introduced
