import {
	test,
	authFile,
	navigateTo,
	expect,
	createMedicationViaAPI,
	deleteMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	type TestMedication,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Helper: navigate to planner, wait for page to be ready, click Calculate,
 * and wait for results to appear.
 */
async function calculatePlanner(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle");
	await page.locator('form.planner button[type="submit"]').click();
	// Wait for the results table to appear (more reliable than waitForResponse
	// since 429 responses would satisfy waitForResponse but not populate results)
	await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });
}

/**
 * Planner with Medication Data E2E Tests
 *
 * Creates medications via API, then verifies the demand calculator
 * produces correct results with status chips and usage data.
 */
test.describe("Planner with medications", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	const MED_HIGH = "PlanData HighStock";
	const MED_LOW = "PlanData LowStock";

	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		// Clean up any leftover medications from previous test runs
		await deleteAllMedicationsViaAPI();
		// Medication with plenty of stock (60 pills)
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_HIGH,
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			}),
		);
		// Medication with very low stock (3 pills)
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_LOW,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 3,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			}),
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show results table after calculating", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });
	});

	test("should show medication names in results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		await expect(resultsTable.getByText(MED_HIGH)).toBeVisible();
		await expect(resultsTable.getByText(MED_LOW)).toBeVisible();
	});

	test("should show status chips in results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const statusChips = resultsTable.locator(".status-chip");
		expect(await statusChips.count()).toBeGreaterThanOrEqual(2);
	});

	test("should show usage data in results rows", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const rows = resultsTable.locator(".table-row");
		expect(await rows.count()).toBeGreaterThanOrEqual(2);

		const firstRowText = await rows.first().textContent();
		expect(firstRowText).toBeTruthy();
		// Check for "pill" (matches both "pill" and "pills")
		expect(firstRowText!.toLowerCase()).toContain("pill");
	});

	test("should show danger status for low-stock medication over 90 days", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Set the "until" date to 90 days from now
		const dateInputs = page.locator('form.planner input[type="datetime-local"]');
		const untilInput = dateInputs.last();
		const fromValue = await dateInputs.first().inputValue();
		const fromDate = new Date(fromValue);
		const untilDate = new Date(fromDate.getTime() + 90 * 24 * 60 * 60 * 1000);
		const pad = (n: number) => n.toString().padStart(2, "0");
		const untilValue = `${untilDate.getFullYear()}-${pad(untilDate.getMonth() + 1)}-${pad(untilDate.getDate())}T${pad(untilDate.getHours())}:${pad(untilDate.getMinutes())}`;
		await untilInput.fill(untilValue);
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// Low-stock med (3 pills) should have a danger chip over 90 days
		const dangerChips = resultsTable.locator(".status-chip.danger");
		expect(await dangerChips.count()).toBeGreaterThanOrEqual(1);
	});

	test("should show Enough status for well-stocked medication over 7 days", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Set a short date range: 7 days
		const dateInputs = page.locator('form.planner input[type="datetime-local"]');
		const untilInput = dateInputs.last();
		const fromValue = await dateInputs.first().inputValue();
		const fromDate = new Date(fromValue);
		const untilDate = new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
		const pad = (n: number) => n.toString().padStart(2, "0");
		const untilValue = `${untilDate.getFullYear()}-${pad(untilDate.getMonth() + 1)}-${pad(untilDate.getDate())}T${pad(untilDate.getHours())}:${pad(untilDate.getMinutes())}`;
		await untilInput.fill(untilValue);
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// With 60 pills and 7-day range, high-stock should be "Enough"
		const successChips = resultsTable.locator(".status-chip.success");
		expect(await successChips.count()).toBeGreaterThanOrEqual(1);
	});

	test("should show table header with correct columns", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const tableHead = resultsTable.locator(".table-head");
		await expect(tableHead).toBeVisible();
		await expect(tableHead.getByText(/Medication/i)).toBeVisible();
		await expect(tableHead.getByText(/Usage/i)).toBeVisible();
		await expect(tableHead.getByText(/Status/i)).toBeVisible();
	});

	test("should reset form and clear results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// Click Reset
		await page.locator("form.planner button.ghost").click();

		// Results should be cleared
		await expect(resultsTable).not.toBeVisible({ timeout: 5000 });
	});

	test("should make results rows clickable for medication detail", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.locator(".table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// Click on a results row
		await resultsTable.locator(".table-row").first().click();

		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });

		await page.locator("button.modal-close").click();
		await expect(modal).not.toBeVisible();
	});
});
