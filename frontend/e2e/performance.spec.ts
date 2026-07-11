import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

/**
 * Performance Tests
 *
 * Verify the schedule timeline and planner render within acceptable
 * time limits when many medications exist.
 */
test.describe("Performance with many medications", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 120000 });

	const MED_COUNT = 20;
	const MED_PREFIX = "PerfTest Med";

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();

		const todayMorning = (() => {
			const d = new Date();
			d.setHours(8, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		// Create medications sequentially (API rate limits prevent parallel)
		for (let i = 1; i <= MED_COUNT; i++) {
			await createMedicationViaAPI({
				name: `${MED_PREFIX} ${i}`,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			});
		}
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("schedule page renders within 10 seconds with 20 medications", async ({ page }) => {
		const start = Date.now();
		await navigateTo(page, "/schedule");

		// Each daily medication is rendered once per day in the default 30-day schedule.
		await expect(page.getByText(`${MED_PREFIX} 1`, { exact: true })).toHaveCount(30, { timeout: 15000 });

		const renderTime = Date.now() - start;

		// Verify all medications appear
		for (let i = 1; i <= MED_COUNT; i++) {
			await expect(page.getByText(`${MED_PREFIX} ${i}`, { exact: true })).toHaveCount(30, { timeout: 5000 });
		}

		// Goal: render under 10 seconds
		expect(renderTime).toBeLessThan(10000);
	});

	test("medications page renders within 10 seconds with 20 medications", async ({ page }) => {
		const start = Date.now();
		await navigateTo(page, "/medications");

		// Medication rows have a stable test id across the Mantine layout.
		const medicationRows = page.getByTestId("medication-row");
		await expect(medicationRows.first()).toBeVisible({ timeout: 15000 });

		const renderTime = Date.now() - start;

		// Verify count — all 20 should be visible
		for (let i = 1; i <= MED_COUNT; i++) {
			await expect(page.getByText(`${MED_PREFIX} ${i}`).first()).toBeVisible({ timeout: 5000 });
		}

		expect(renderTime).toBeLessThan(10000);
	});

	test("planner calculates within 15 seconds with 20 medications", async ({ page }) => {
		await navigateTo(page, "/planner");

		const start = Date.now();
		await page
			.getByTestId("planner-form")
			.getByRole("button", { name: /Calculate|Berechnen/i })
			.click();
		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 20000 });

		const calcTime = Date.now() - start;

		// All medications should appear in the results
		const rows = resultsTable.getByTestId("planner-result-row");
		expect(await rows.count()).toBeGreaterThanOrEqual(MED_COUNT);

		// Goal: calculate and render under 15 seconds
		expect(calcTime).toBeLessThan(15000);
	});
});
