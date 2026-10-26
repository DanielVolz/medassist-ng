# Accessibility Testing

Manual validation checklist for keyboard-only and screen-reader use. The
automated side runs through Playwright + axe (`frontend/e2e/accessibility-audit.spec.ts`
for page-level scans and `medication-ui-regression.spec.ts` for the editor).
This document covers the cases automated tooling cannot fully verify.

## Screen Reader Tools

- **Windows:** NVDA (free) or JAWS
- **macOS:** VoiceOver (`Cmd+F5` to toggle)
- **Linux:** Orca

## Keyboard-Only Testing

Place the mouse out of reach and complete these flows using only `Tab`,
`Shift+Tab`, `Enter`, `Space`, `Escape`, and arrow keys.

- [ ] Medication editor tabs switch with Left/Right arrows and support Home/End.
- [ ] Modal close buttons are reachable and Escape closes each modal.
- [ ] The image lightbox traps focus (Tab cycles inside, does not reach the page).
- [ ] The refill-history toggle is focusable and pressing Enter/Space expands it.
- [ ] The medication avatar opens the lightbox with Enter/Space.
- [ ] A save validation error moves focus to the first visible error message.
- [ ] Focus indicators are visible on every interactive element.
- [ ] No keyboard trap: focus can always leave any open surface.

## Screen Reader Testing

### Medications Page

- [ ] Active and obsolete medication cards are announced as named list items.
- [ ] Row actions identify both the action and medication; image buttons identify that they open the medication image.
- [ ] The obsolete-medication disclosure announces its expanded state and controls the named obsolete list.
- [ ] The desktop editor is announced as a complementary landmark named by its heading.
- [ ] Only the selected editor tab is in the Tab order; arrow keys, Home, and End move selection and focus together.
- [ ] Closing the editor returns focus to its invoking action; after create, delete, obsolete, or reactivate, focus lands on a visible, relevant medication-page control or row.

### Dashboard

- [ ] Medication cards and stock status are announced as lists/headings.
- [ ] Dose "Take"/"Undo" buttons have clear accessible names.
- [ ] Marking a dose announces "Dose marked as taken"/"Dose marked as not taken".

### Medication Editor

- [ ] Form labels are associated with their inputs.
- [ ] Tabs announce their selected state and switch under keyboard.
- [ ] Validation errors are announced when focus moves to them.
- [ ] The image upload input has an accessible label.

### Modals

- [ ] The dialog title and role are announced on open.
- [ ] Focus stays inside the modal and returns on close.
- [ ] Close buttons have an accessible name.

### Navigation

- [ ] Main navigation is exposed as a navigation landmark.
- [ ] The active page is announced (e.g. `aria-current="page"`).
- [ ] The user menu is recognized as a menu with keyboard support.

## Focus Areas Introduced by the Accessibility Work

The following behaviors were added and should be verified against a real
screen reader, since automated axe checks do not exercise announcement timing
or focus restoration:

1. WAI-ARIA tab wiring (`role="tablist"`/`role="tab"`/`role="tabpanel"`,
   `aria-controls`, `aria-labelledby`) in the desktop and mobile editors.
2. Visually-hidden labels on medication image upload inputs.
3. Lightbox `role="dialog"` + focus trap.
4. Refill-history disclosure button (`aria-expanded`/`aria-controls`).
5. Medication avatar converted from a clickable `div` to a native `button`.
6. Dashboard dose-action live region (`aria-live="polite"`).