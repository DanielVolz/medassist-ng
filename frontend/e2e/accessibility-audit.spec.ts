import AxeBuilder from "@axe-core/playwright";
import { authFile, expect, navigateTo, test } from "./fixtures";

/**
 * Accessibility Audit E2E Tests
 *
 * Runs axe-core scans against the primary authenticated product pages to
 * catch regressions against WCAG 2.1 A/AA automated checks. This is a
 * best-effort automated gate: it blocks only **critical** violations so a
 * threshold of accessibility is preserved without requiring a full manual
 * audit. Serious/moderate/minor findings remain visible in the axe report
 * for triage by the testing owner.
 *
 * Known follow-ups (serious, not gating):
 * - `aria-label` / `aria-labelledby` missing on custom toggle-switch checkboxes
 *   used in Settings, Medications and MobileEditModal. Tracked separately.
 */

const AUDIT_PAGES = [
	{ path: "/dashboard", name: "Dashboard" },
	{ path: "/medications", name: "Medications" },
	{ path: "/planner", name: "Planner" },
	{ path: "/settings", name: "Settings" },
] as const;

test.describe("Accessibility audit", () => {
	test.use({ storageState: authFile });

	for (const { path, name } of AUDIT_PAGES) {
		test(`${name} page has no critical accessibility violations`, async ({ page }) => {
			await navigateTo(page, path);

			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();

			const blockingViolations = results.violations.filter(
				(violation) => violation.impact === "critical"
			);

			expect(
				blockingViolations,
				"Axe found critical accessibility violations; see violation nodes for details"
			).toEqual([]);
		});
	}
});
