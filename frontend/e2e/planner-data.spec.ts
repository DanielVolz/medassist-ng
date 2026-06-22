import type { Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

/**
 * Helper: navigate to planner, wait for page to be ready, click Calculate,
 * and wait for results to appear.
 */
async function calculatePlanner(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle");
	await page.getByTestId("planner-form").locator('button[type="submit"]').click();
	// Wait for the results table to appear (more reliable than waitForResponse
	// since 429 responses would satisfy waitForResponse but not populate results)
	await expect(page.getByTestId("planner-results-table")).toBeVisible({ timeout: 15000 });
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
			})
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
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show results table after calculating", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });
	});

	test("should show medication names in results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		await expect(resultsTable.getByText(MED_HIGH)).toBeVisible();
		await expect(resultsTable.getByText(MED_LOW)).toBeVisible();
	});

	test("should show status chips in results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const statusChips = resultsTable.getByText(/Enough|Ausreichend|Empty|Leer/i);
		expect(await statusChips.count()).toBeGreaterThanOrEqual(2);
	});

	test("should show correct usage values in results rows", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const rows = resultsTable.getByTestId("planner-result-row");
		expect(await rows.count()).toBeGreaterThanOrEqual(2);

		// Each medication has usage=1, every=1 → plannerUsage should reflect the period
		// Verify the usage column starts with a positive numeric value and a unit.
		for (const row of await rows.all()) {
			const usageText = await row.locator("td").nth(1).textContent();
			expect(Number(usageText?.match(/\d+/)?.[0] ?? "0")).toBeGreaterThan(0);
		}
	});

	test("should show danger status for low-stock medication over 90 days", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Set the "until" date to 90 days from now
		const dateInputs = page.getByTestId("planner-form").locator('input[type="datetime-local"]');
		const untilInput = dateInputs.last();
		const fromValue = await dateInputs.first().inputValue();
		const fromDate = new Date(fromValue);
		const untilDate = new Date(fromDate.getTime() + 90 * 24 * 60 * 60 * 1000);
		const pad = (n: number) => n.toString().padStart(2, "0");
		const untilValue = `${untilDate.getFullYear()}-${pad(untilDate.getMonth() + 1)}-${pad(untilDate.getDate())}T${pad(untilDate.getHours())}:${pad(untilDate.getMinutes())}`;
		await untilInput.fill(untilValue);
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// Find the low-stock med row and verify its usage value ~90 pills
		const lowStockRow = resultsTable.getByTestId("planner-result-row").filter({ hasText: MED_LOW });
		await expect(lowStockRow).toBeVisible();
		await expect(lowStockRow.getByText(/Empty|Leer/i)).toBeVisible();
		const lowUsageText = await lowStockRow.locator("td").nth(1).textContent();
		const lowUsage = lowUsageText?.match(/\d+/)?.[0] ?? "0";
		expect(Number(lowUsage)).toBeGreaterThanOrEqual(85); // ~90 pills needed
		expect(Number(lowUsage)).toBeLessThanOrEqual(95);
	});

	test("should show Enough status for well-stocked medication over 7 days", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Set a short date range: 7 days
		const dateInputs = page.getByTestId("planner-form").locator('input[type="datetime-local"]');
		const untilInput = dateInputs.last();
		const fromValue = await dateInputs.first().inputValue();
		const fromDate = new Date(fromValue);
		const untilDate = new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
		const pad = (n: number) => n.toString().padStart(2, "0");
		const untilValue = `${untilDate.getFullYear()}-${pad(untilDate.getMonth() + 1)}-${pad(untilDate.getDate())}T${pad(untilDate.getHours())}:${pad(untilDate.getMinutes())}`;
		await untilInput.fill(untilValue);
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// High-stock med (60 pills, usage 1/day, 7 days → needs ~7, has 60) should be "Enough"
		const highStockRow = resultsTable.getByTestId("planner-result-row").filter({ hasText: MED_HIGH });
		await expect(highStockRow).toBeVisible();
		await expect(highStockRow.getByText(/Enough|Ausreichend/i)).toBeVisible();

		// Verify usage is ~7 pills for the 7-day range
		const highUsageText = await highStockRow.locator("td").nth(1).textContent();
		const highUsage = highUsageText?.match(/\d+/)?.[0] ?? "0";
		expect(Number(highUsage)).toBeGreaterThanOrEqual(5);
		expect(Number(highUsage)).toBeLessThanOrEqual(10);
	});

	test("should show table header with correct columns", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		await expect(resultsTable.getByRole("columnheader", { name: /Medication|Medikament/i })).toBeVisible();
		await expect(resultsTable.getByRole("columnheader", { name: /Usage|Verbrauch/i })).toBeVisible();
		await expect(resultsTable.getByRole("columnheader", { name: /Status/i })).toBeVisible();
	});

	test("should display available stock for each medication", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// High-stock med should show a blister + loose-pill stock breakdown
		const highStockRow = resultsTable.getByTestId("planner-result-row").filter({ hasText: MED_HIGH });
		await expect(highStockRow).toBeVisible();
		const highStockText = await highStockRow.textContent();
		expect(highStockText).toMatch(/\d+\s*(blisters|Blister)/i);
		expect(highStockText).toMatch(/\d+\s*(pill|pills|Tablette|Tabletten)/i);

		// Low-stock med: 1 pack × 1 blister × 3 pills = 3 pills = 0 full blisters + 3 loose
		const lowStockRow = resultsTable.getByTestId("planner-result-row").filter({ hasText: MED_LOW });
		await expect(lowStockRow).toBeVisible();
		const lowStockText = await lowStockRow.textContent();
		// The exact loose-pill amount can vary due already-taken doses; ensure stock details are still rendered.
		expect(lowStockText).toMatch(/\d+\s*×\s*\d+/i);
		expect(lowStockText).toMatch(/\d+\s*(pill|pills|Tablette|Tabletten)/i);
	});

	test("should reset form and clear results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		// Click Reset
		await page
			.getByTestId("planner-form")
			.getByRole("button", { name: /Reset|Zurücksetzen/i })
			.click();

		// Results should be cleared
		await expect(resultsTable).not.toBeVisible({ timeout: 5000 });
	});

	test("should open medication detail from the medication name link", async ({ page }) => {
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => {
			pageErrors.push(error.message);
		});

		await navigateTo(page, "/planner");
		await calculatePlanner(page);

		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 10000 });

		const firstRow = resultsTable.getByTestId("planner-result-row").first();
		await expect(firstRow).not.toHaveAttribute("role", "button");
		const medicationName = (await firstRow.getByRole("button").first().innerText()).trim();
		await firstRow.getByRole("button").first().click();

		const modal = page.getByRole("dialog").filter({ hasText: medicationName });
		await expect(modal).toBeVisible({ timeout: 5000 });
		await expect(modal.getByRole("heading", { name: medicationName })).toBeVisible();
		await expect(modal).toContainText("Current Stock");
		await expect(modal).toContainText("Package Details");
		await expect(page.locator("#root")).toContainText(medicationName);
		expect(
			pageErrors.filter(
				(message) => message.includes("Element type is invalid") || message.includes("aria-describedby")
			)
		).toEqual([]);
	});
});
