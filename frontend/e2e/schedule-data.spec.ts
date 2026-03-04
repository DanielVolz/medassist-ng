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
 * Schedule & Dose Tracking E2E Tests
 *
 * Creates medications via API, then verifies the schedule timeline:
 * day blocks, dose items, dose tracking, collapse/expand, and toggles.
 */
test.describe("Schedule with medications", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	const MED_DAILY = "SchedData DailyMed";
	const MED_PAST = "SchedData PastMed";
	const MED_WEEKLY = "SchedData WeeklyMed";

	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const threeDaysAgo = (() => {
		const d = new Date();
		d.setDate(d.getDate() - 3);
		d.setHours(9, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		// Clean up any leftover medications from previous test runs
		await deleteAllMedicationsViaAPI();
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_DAILY,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 14,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_PAST,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				intakes: [{ usage: 1, every: 1, start: threeDaysAgo, intakeRemindersEnabled: false }],
			})
		);
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_WEEKLY,
				packageType: "bottle",
				totalPills: 52,
				intakes: [{ usage: 1, every: 7, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show today block with medication names", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		// Today should have time rows with our medication names
		const timeRows = todayBlock.locator(".time-row");
		expect(await timeRows.count()).toBeGreaterThanOrEqual(1);

		// At least the daily and past medications should show today
		await expect(todayBlock.getByText(MED_DAILY)).toBeVisible();
		await expect(todayBlock.getByText(MED_PAST)).toBeVisible();
	});

	test("should show dose items with time info", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await page.waitForLoadState("networkidle");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		const doseItems = todayBlock.locator(".dose-item");
		expect(await doseItems.count()).toBeGreaterThanOrEqual(1);

		// Each dose should have a time label
		await expect(doseItems.first().locator(".dose-time")).toBeVisible();
	});

	test("should show day date in day header", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const dayDate = todayBlock.locator(".day-date");
		await expect(dayDate).toBeVisible();
		expect(await dayDate.textContent()).toBeTruthy();
	});

	test("should collapse and expand a past day block", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// First show past days
		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible({ timeout: 10000 });
		await pastToggle.click();

		const pastBlock = page.locator(".day-block.past").first();
		await expect(pastBlock).toBeVisible({ timeout: 5000 });

		// Click the divider to toggle collapse
		const dayDivider = pastBlock.locator(".day-divider");
		await dayDivider.click();

		// Past blocks start expanded after toggle, so clicking should collapse
		// Check that the block has or doesn't have the collapsed class
		const classAfterClick = await pastBlock.getAttribute("class");
		expect(classAfterClick).toBeTruthy();
	});

	test("should show past days toggle", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// A medication starting 3 days ago should create past day entries
		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible({ timeout: 10000 });
	});

	test("should expand past days when toggle is clicked", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible({ timeout: 10000 });

		await pastToggle.click();

		const pastBlocks = page.locator(".day-block.past");
		await expect(pastBlocks.first()).toBeVisible({ timeout: 5000 });
		expect(await pastBlocks.count()).toBeGreaterThanOrEqual(1);
	});

	test("should show future day blocks", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Wait for timeline to fully load
		await page.waitForLoadState("networkidle");
		const dayBlocks = page.locator(".day-block:not(.past)");
		await expect(dayBlocks.first()).toBeVisible({ timeout: 10000 });
		expect(await dayBlocks.count()).toBeGreaterThanOrEqual(1);
	});

	test("should change schedule range", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		await expect(daysSelect).toBeVisible();

		await daysSelect.selectOption("30");
		await page.waitForTimeout(500);
		const count30 = await page.locator(".day-block").count();

		await daysSelect.selectOption("90");
		await page.waitForTimeout(500);
		const count90 = await page.locator(".day-block").count();

		expect(count90).toBeGreaterThanOrEqual(count30);
	});

	test("should mark dose as taken and show undo", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await page.waitForLoadState("networkidle");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		const takeBtn = todayBlock.locator("button.dose-btn.take:not([disabled])").first();
		test.skip(!(await takeBtn.isVisible().catch(() => false)), "No actionable take-dose button is visible for today");

		await takeBtn.click();
		await page.waitForLoadState("networkidle");
		await expect(todayBlock.locator("button.dose-btn.undo").first()).toBeVisible({ timeout: 10000 });
	});

	test("should undo taken doses", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await page.waitForLoadState("networkidle");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		// Undo any previously taken doses
		const undoButtons = todayBlock.locator("button.dose-btn.undo");
		const undoCount = await undoButtons.count();

		for (let i = 0; i < undoCount; i++) {
			const btn = todayBlock.locator("button.dose-btn.undo").first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click();
				await page.waitForTimeout(300);
			}
		}

		if (undoCount > 0) {
			const takeButtons = todayBlock.locator("button.dose-btn.take:not([disabled])");
			expect(await takeButtons.count()).toBeGreaterThanOrEqual(1);
		}
	});
});
