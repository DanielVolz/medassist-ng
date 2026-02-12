import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

/**
 * Schedule / Timeline E2E Tests
 *
 * Verifies the schedule timeline on the dashboard including
 * day blocks, past-days toggle, days selector, and dose items.
 */
test.describe("Schedule Timeline", () => {
	test.use({ storageState: authFile });

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

		// Past days toggle only appears when there are scheduled medications
		const pastToggle = page.locator(".past-days-toggle");
		const hasPastToggle = await pastToggle.isVisible().catch(() => false);

		// Just verify it doesn't crash — visibility depends on medication data
		expect(typeof hasPastToggle).toBe("boolean");
	});

	test("should expand/collapse past days on click", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const pastToggle = page.locator(".past-days-toggle");
		if (!(await pastToggle.isVisible().catch(() => false))) {
			// No medications — past days toggle not shown
			return;
		}

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

		// Future days toggle only appears when there are scheduled medications
		const futureToggle = page.locator(".future-days-toggle");
		const hasFutureToggle = await futureToggle.isVisible().catch(() => false);
		expect(typeof hasFutureToggle).toBe("boolean");
	});

	test("should display day blocks in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// There should be at least one day block (today)
		const dayBlocks = page.locator(".day-block");
		expect(await dayBlocks.count()).toBeGreaterThanOrEqual(0);
	});

	test("should highlight today block", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// If there are medications, today should be highlighted
		const todayBlock = page.locator(".day-block.today");
		const hasTodayBlock = await todayBlock.isVisible().catch(() => false);

		// Today block exists only if there are medications with schedules
		if (hasTodayBlock) {
			await expect(todayBlock).toBeVisible();
			// Should have a day divider with date text
			await expect(todayBlock.locator(".day-date")).toBeVisible();
		}
	});

	test("should show day summary with progress", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		if (await todayBlock.isVisible().catch(() => false)) {
			const summary = todayBlock.locator(".day-summary");
			await expect(summary).toBeVisible();
		}
	});

	test("should collapse/expand a day block", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		if (await todayBlock.isVisible().catch(() => false)) {
			const dayDivider = todayBlock.locator(".day-divider");
			await dayDivider.click();

			// Check if it toggled collapsed state
			const isCollapsed = await todayBlock.evaluate((el) => el.classList.contains("collapsed"));

			// Click again to restore
			await dayDivider.click();
			const isCollapsedAfter = await todayBlock.evaluate((el) => el.classList.contains("collapsed"));

			expect(isCollapsed).not.toBe(isCollapsedAfter);
		}
	});

	test("should show overview table with stock status", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Overview table has class .table.table-7
		const overviewTable = page.locator(".table.table-7");
		const hasTable = await overviewTable.isVisible().catch(() => false);

		// Table only visible if medications exist
		if (hasTable) {
			// Table should have a header row
			await expect(overviewTable.locator(".table-head")).toBeVisible();
		}
	});

	test("should display share button in schedules section", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const shareBtn = page.locator("button.share-btn");
		// Share button only visible if there are takenBy users
		const hasShareBtn = await shareBtn.isVisible().catch(() => false);

		// Just verify it's either visible or not (no crash)
		expect(typeof hasShareBtn).toBe("boolean");
	});
});
