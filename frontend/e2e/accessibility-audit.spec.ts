import AxeBuilder from "@axe-core/playwright";
import {
	authFile,
	createMedicationViaAPI,
	deleteMedicationViaAPI,
	expect,
	navigateTo,
	relativeLocalDateTime,
	type TestMedication,
	test,
} from "./fixtures";

/**
 * Accessibility audit E2E tests.
 *
 * Runs axe-core against the primary authenticated pages and the medication
 * editor, in light and dark themes, with WCAG 2.0, 2.1 and 2.2 A/AA rule tags.
 * Every scan fails on WCAG-tagged violations at any impact level. Automated
 * scans cannot replace the manual screen-reader checks in
 * docs/ACCESSIBILITY_TESTING.md.
 */

const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const AUDIT_PAGES = [
	{ path: "/dashboard", name: "Dashboard" },
	{ path: "/medications", name: "Medications" },
	{ path: "/planner", name: "Planner" },
	{ path: "/settings", name: "Settings" },
] as const;
const THEMES = ["light", "dark"] as const;

function collectDashboardFindings(state: string, violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
	return violations.map((violation) => ({ state, ...violation }));
}

test.describe("Accessibility audit", () => {
	test.use({ storageState: authFile });

	for (const theme of THEMES) {
		for (const { path, name } of AUDIT_PAGES) {
			test(`${name} page (${theme} theme) has no WCAG A/AA axe violations`, async ({ page }) => {
				await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
				await navigateTo(page, path);

				const results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();

				expect(
					results.violations,
					`WCAG A/AA axe violations on ${name} (${theme} theme):\n${JSON.stringify(results.violations, null, 2)}`
				).toEqual([]);
			});
		}

		test(`Dashboard warning, overdue, completed, skipped, and Undo states (${theme} theme) have no WCAG A/AA axe violations`, async ({
			page,
		}) => {
			const suffix = theme.replaceAll(/[^a-z0-9]/gi, "");
			const dueAt = relativeLocalDateTime(0, 0, 0);
			const createdMedications: TestMedication[] = [];
			const findings: ReturnType<typeof collectDashboardFindings> = [];

			try {
				const warningMedication = await createMedicationViaAPI({
					name: `Contrast Audit Warning ${suffix}`,
					packageType: "blister",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					intakes: [{ usage: 1, every: 1, start: dueAt, intakeRemindersEnabled: false }],
				});
				createdMedications.push(warningMedication);

				const completedMedication = await createMedicationViaAPI({
					name: `Contrast Audit Completed ${suffix}`,
					packageType: "blister",
					packCount: 2,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					intakes: [{ usage: 1, every: 1, start: dueAt, intakeRemindersEnabled: false }],
				});
				createdMedications.push(completedMedication);

				const skippedMedication = await createMedicationViaAPI({
					name: `Contrast Audit Skipped ${suffix}`,
					packageType: "blister",
					packCount: 2,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					intakes: [{ usage: 1, every: 1, start: dueAt, intakeRemindersEnabled: false }],
				});
				createdMedications.push(skippedMedication);

				await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
				await navigateTo(page, "/dashboard");

				const today = page.locator(".day-block.today");
				const warningRow = page.locator(`tr[aria-label="${warningMedication.name}"]`);
				const warningDose = today.locator(`.time-row[data-med-id="${warningMedication.id}"] .dose-item`);
				const completedDose = today.locator(`.time-row[data-med-id="${completedMedication.id}"] .dose-item`);
				const skippedDose = today.locator(`.time-row[data-med-id="${skippedMedication.id}"] .dose-item`);

				await expect(warningRow.locator(".warning-text").first()).toBeVisible();
				await expect(warningDose).toHaveClass(/overdue/);
				let results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("warning + overdue", results.violations));

				await completedDose.getByRole("button", { name: "Take", exact: true }).click();
				await expect(completedDose).toHaveClass(/all-taken/);
				const takeUndo = completedDose.getByRole("button", { name: "Undo", exact: true });
				await expect(takeUndo).toBeVisible();
				await page.mouse.move(0, 0);
				await takeUndo.evaluate((button: HTMLButtonElement) => button.blur());
				await expect(takeUndo).not.toBeFocused();
				await expect(takeUndo).toHaveCSS("filter", "none");
				const defaultUndoAppearance = await takeUndo.evaluate((button) => {
					const styles = window.getComputedStyle(button);
					return {
						color: styles.color,
						backgroundColor: styles.backgroundColor,
						borderColor: styles.borderColor,
						filter: styles.filter,
						outlineColor: styles.outlineColor,
						outlineStyle: styles.outlineStyle,
					};
				});
				results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("completed + take Undo (default)", results.violations));

				await takeUndo.hover();
				await expect(takeUndo).toHaveCSS("filter", "brightness(0.9)");
				results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("completed + take Undo (hovered)", results.violations));

				await page.mouse.move(0, 0);
				await expect(takeUndo).toHaveCSS("filter", "none");
				await takeUndo.focus();
				await expect(takeUndo).toBeFocused();
				results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("completed + take Undo (focused)", results.violations));
				await takeUndo.evaluate((button: HTMLButtonElement) => button.blur());
				await page.mouse.move(0, 0);
				const restoredUndoAppearance = await takeUndo.evaluate((button) => {
					const styles = window.getComputedStyle(button);
					return {
						color: styles.color,
						backgroundColor: styles.backgroundColor,
						borderColor: styles.borderColor,
						filter: styles.filter,
						outlineColor: styles.outlineColor,
						outlineStyle: styles.outlineStyle,
					};
				});
				expect(restoredUndoAppearance).toEqual(defaultUndoAppearance);

				await skippedDose.getByRole("button", { name: "Skip", exact: true }).click();
				await expect(skippedDose.locator(".dose-person.skipped")).toBeVisible();
				await expect(skippedDose.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
				results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("skipped + skip Undo", results.violations));

				await skippedDose.getByRole("button", { name: "Undo", exact: true }).click();
				await skippedDose.getByRole("button", { name: "Take", exact: true }).click();
				await warningDose.getByRole("button", { name: "Take", exact: true }).click();
				await expect(today).toHaveClass(/stock-warning/);
				await expect(today).toHaveClass(/all-taken/);
				await today.locator(".day-divider").click();
				await expect(warningDose.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
				results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
				findings.push(...collectDashboardFindings("low-stock warning + all-taken", results.violations));
			} finally {
				for (const { id } of createdMedications) {
					await deleteMedicationViaAPI(id);
				}
			}

			expect(
				findings,
				`WCAG A/AA axe violations by Dashboard state (all impacts):\n${JSON.stringify(findings, null, 2)}`
			).toEqual([]);
		});

		test(`Medication editor (${theme} theme) has no WCAG A/AA axe violations`, async ({ page }) => {
			const medName = `A11y Audit Med ${theme}`;
			const medication = await createMedicationViaAPI({ name: medName });
			try {
				await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
				await navigateTo(page, "/medications");

				const medRow = page.getByTestId("medication-row").filter({ hasText: medName });
				await medRow.getByRole("button", { name: /Edit|common\.edit/i }).click();
				await expect(
					page.getByRole("heading", { name: /(Edit(:| (entry|medication))|form\.editEntry)/i }).first()
				).toBeVisible({ timeout: 5000 });

				const results = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();

				expect(
					results.violations,
					`WCAG A/AA axe violations in medication editor (${theme} theme):\n${JSON.stringify(results.violations, null, 2)}`
				).toEqual([]);
			} finally {
				await deleteMedicationViaAPI(medication.id);
			}
		});
	}
});
