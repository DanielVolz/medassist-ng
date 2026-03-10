import { expect } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, navigateTo, test } from "./fixtures";

/**
 * Schedule / Timeline E2E Tests
 *
 * Verifies the schedule timeline on the dashboard including
 * day blocks, past-days toggle, days selector, and dose items.
 */
test.describe("Schedule Timeline", () => {
	test.use({ storageState: authFile });

	const seededName = "Schedule Smoke Seed";
	const startThreeDaysAgo = (() => {
		const d = new Date();
		d.setDate(d.getDate() - 3);
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: seededName,
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			takenBy: ["Daniel"],
			intakes: [{ usage: 1, every: 1, start: startThreeDaysAgo, intakeRemindersEnabled: false, takenBy: "Daniel" }],
		});
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should have timeline container in DOM", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Timeline exists in the DOM (may be empty/hidden if no medications)
		await expect(page.locator(".timeline")).toBeAttached();
	});

	test("should show schedule days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		await expect(daysSelect).toBeVisible();

		// Should offer 30, 90, 180 days
		await expect(daysSelect.locator('option[value="30"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="90"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="180"]')).toBeAttached();
	});

	test("should change schedule range via days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		const currentValue = await daysSelect.inputValue();

		// Switch to a different range
		const newValue = currentValue === "30" ? "90" : "30";
		await daysSelect.selectOption(newValue);
		await expect(daysSelect).toHaveValue(newValue);
	});

	test("should show past days toggle when medications exist", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Past days toggle appears when there are scheduled medications
		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible();
	});

	test("should expand/collapse past days on click", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible();

		const wasExpanded = await pastToggle.evaluate((el) => el.classList.contains("expanded"));

		await pastToggle.click();

		if (wasExpanded) {
			await expect(pastToggle).not.toHaveClass(/expanded/);
		} else {
			await expect(pastToggle).toHaveClass(/expanded/);
		}
	});

	test("should show future days toggle when medications exist", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Future days toggle appears when there are scheduled medications
		const futureToggle = page.locator(".future-days-toggle");
		await expect(futureToggle).toBeVisible();
	});

	test("should display day blocks in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// With medications there should be day blocks; otherwise empty-state is expected.
		const dayBlocks = page.locator(".day-block");
		const dayBlockCount = await dayBlocks.count();
		if (dayBlockCount === 0) {
			await expect(page.getByText(/No medications/i)).toBeVisible();
			return;
		}
		expect(dayBlockCount).toBeGreaterThanOrEqual(1);
	});

	test("should highlight today block", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// With medications, today should be highlighted
		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible();
		await expect(todayBlock.locator(".day-date")).toBeVisible();
	});

	test("should show day summary with progress", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible();
		const summary = todayBlock.locator(".day-summary");
		await expect(summary).toBeVisible();
	});

	test("should collapse/expand a day block", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible();
		const dayDivider = todayBlock.locator(".day-divider");
		await dayDivider.click();

		const isCollapsed = await todayBlock.evaluate((el) => el.classList.contains("collapsed"));

		await dayDivider.click();
		const isCollapsedAfter = await todayBlock.evaluate((el) => el.classList.contains("collapsed"));

		expect(isCollapsed).not.toBe(isCollapsedAfter);
	});

	test("should show overview table with stock status", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible();
		await expect(overviewTable.locator(".table-head")).toBeVisible();
	});

	test("should display share button in schedules section", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.locator(".table-row").first()).toBeVisible({ timeout: 10000 });

		const shareBtn = page.locator("button.share-btn");
		await expect(shareBtn).toBeVisible();
	});
});
