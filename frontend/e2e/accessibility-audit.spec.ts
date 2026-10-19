import AxeBuilder from "@axe-core/playwright";
import { authFile, createMedicationViaAPI, expect, navigateTo, test } from "./fixtures";

/**
 * Accessibility audit E2E tests.
 *
 * Runs axe-core against the primary authenticated pages and the medication
 * editor, in light and dark themes, with WCAG 2.0, 2.1 and 2.2 A/AA rule tags.
 * A scan fails on any critical or serious violation. Moderate and minor
 * findings stay in the axe report for triage. Automated scans cannot replace
 * the manual screen-reader checks in docs/ACCESSIBILITY_TESTING.md.
 */

const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AUDIT_PAGES = [
	{ path: "/dashboard", name: "Dashboard" },
	{ path: "/medications", name: "Medications" },
	{ path: "/planner", name: "Planner" },
	{ path: "/settings", name: "Settings" },
] as const;
const THEMES = ["light", "dark"] as const;

function blockingViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
	return violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
}

test.describe("Accessibility audit", () => {
	test.use({ storageState: authFile });

	for (const theme of THEMES) {
		for (const { path, name } of AUDIT_PAGES) {
			test(`${name} page (${theme} theme) has no critical or serious accessibility violations`, async ({ page }) => {
				await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
				await navigateTo(page, path);

				const results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();

				expect(
					blockingViolations(results.violations),
					"Axe found critical/serious accessibility violations; see violation nodes for details"
				).toEqual([]);
			});
		}

		test(`Medication editor (${theme} theme) has no critical or serious accessibility violations`, async ({ page }) => {
			const medName = `A11y Audit Med ${theme}`;
			await createMedicationViaAPI({ name: medName });
			await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
			await navigateTo(page, "/medications");

			const medRow = page.getByTestId("medication-row").filter({ hasText: medName });
			await medRow.getByRole("button", { name: /Edit|common\.edit/i }).click();
			await expect(
				page.getByRole("heading", { name: /(Edit(:| (entry|medication))|form\.editEntry)/i }).first()
			).toBeVisible({ timeout: 5000 });

			const results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();

			expect(
				blockingViolations(results.violations),
				"Axe found critical/serious accessibility violations in the medication editor"
			).toEqual([]);
		});
	}
});
