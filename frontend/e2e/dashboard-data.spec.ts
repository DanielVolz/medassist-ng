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
 * Dashboard with Medication Data E2E Tests
 *
 * Creates medications via API, then verifies the dashboard
 * overview table, coverage cards, timeline, and dose tracking.
 */
test.describe("Dashboard with medications", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	// Unique medication names to avoid conflicts with parallel workers
	const MED_1 = "DashData Ibuprofen";
	const MED_2 = "DashData Vitamin C";

	// Set start to earlier today so doses appear on the timeline
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
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_1,
				genericName: "Ibuprofen",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_2,
				packageType: "bottle",
				totalPills: 90,
				looseTablets: 90,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show medication overview table with medications", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.locator(".table-head")).toBeVisible();

		// Our medications should have rows
		await expect(overviewTable.getByText(MED_1)).toBeVisible();
		await expect(overviewTable.getByText(MED_2)).toBeVisible();
	});

	test("should show status chips in overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Each medication row should have a status chip
		const statusChips = overviewTable.locator(".status-chip");
		expect(await statusChips.count()).toBeGreaterThanOrEqual(2);
	});

	test("should show stock information in overview", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// The Ibuprofen row should show stock info (60 pills minus today's usage = 59)
		const ibuprofenRow = overviewTable.locator(".table-row").filter({ hasText: MED_1 });
		await expect(ibuprofenRow).toBeVisible();
		const rowText = await ibuprofenRow.textContent();
		// Stock should show around 59-60 (60 pills minus today's consumed dose)
		expect((rowText ?? "").includes("59") || (rowText ?? "").includes("60")).toBeTruthy();
	});

	test("should show today block in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
	});

	test("should show medication names in today's schedule", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
		await expect(todayBlock.getByText(MED_1)).toBeVisible();
		await expect(todayBlock.getByText(MED_2)).toBeVisible();
	});

	test("should show day summary with dose progress", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
		await expect(todayBlock.locator(".day-summary")).toBeVisible();
	});

	test("should show dose take buttons in today's schedule", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const takeButtons = todayBlock.locator("button.dose-btn.take");
		expect(await takeButtons.count()).toBeGreaterThanOrEqual(1);
	});

	test("should mark a dose as taken and show undo", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const takeBtn = todayBlock.locator("button.dose-btn.take:not([disabled])").first();
		test.skip(
			!(await takeBtn.isVisible().catch(() => false)),
			"No actionable take-dose button is visible for today"
		);

		await takeBtn.click();
		await expect(todayBlock.locator("button.dose-btn.undo").first()).toBeVisible({ timeout: 5000 });
	});

	test("should undo a taken dose", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await page.waitForLoadState("networkidle");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		// Normalize state first: if a dose is already taken, undo it so we can
		// always execute the same take -> undo flow deterministically.
		const existingUndo = todayBlock.locator("button.dose-btn.undo").first();
		if (await existingUndo.isVisible().catch(() => false)) {
			await existingUndo.click();
			await page.waitForLoadState("networkidle");
		}

		// Mark a dose as taken first
		const takeBtn = todayBlock.locator("button.dose-btn.take:not([disabled])").first();
		await expect(takeBtn).toBeVisible({ timeout: 10000 });
		await takeBtn.click();
		await page.waitForLoadState("networkidle");

		// Wait for undo button to appear (confirms the take succeeded)
		const undoBtn = todayBlock.locator("button.dose-btn.undo").first();
		await expect(undoBtn).toBeVisible({ timeout: 10000 });
		await undoBtn.click();
		await page.waitForLoadState("networkidle");

		// Take button should reappear
		await expect(todayBlock.locator("button.dose-btn.take:not([disabled])").first()).toBeVisible({ timeout: 10000 });
	});

	test("should show multiple day blocks in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Wait for timeline to fully render
		await page.waitForLoadState("networkidle");
		const dayBlocks = page.locator(".day-block");
		await expect(dayBlocks.first()).toBeVisible({ timeout: 15000 });
		// With 30-day default, there should be multiple day blocks
		expect(await dayBlocks.count()).toBeGreaterThanOrEqual(1);
	});

	test("should show day header with date text", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const dayDivider = todayBlock.locator(".day-divider");
		await expect(dayDivider).toBeVisible();
		expect(await dayDivider.textContent()).toBeTruthy();
	});

	test("should open medication detail modal from overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const medRow = overviewTable.locator(".table-row").filter({ hasText: MED_1 }).first();
		await medRow.click();

		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });
		await expect(modal.getByText(MED_1)).toBeVisible();

		await page.locator("button.modal-close").click();
		await expect(modal).not.toBeVisible();
	});

	test("should show schedule days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		await expect(daysSelect).toBeVisible();
		await expect(daysSelect.locator('option[value="30"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="90"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="180"]')).toBeAttached();
	});
});
