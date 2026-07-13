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
	test.describe.configure({ timeout: 60000 });

	const seededName = "Schedule Smoke Seed";
	const startThreeDaysAgo = (() => {
		const d = new Date();
		d.setDate(d.getDate() - 3);
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	async function waitForSeededScheduleData(page: Parameters<Parameters<typeof test>[0]>[0]["page"]) {
		await expect
			.poll(
				async () => {
					const response = await page.request.get("/api/medications").catch(() => null);
					const medications = response?.ok() ? ((await response.json()) as Array<{ name?: string }>) : [];
					return medications.some((medication) => medication.name === seededName);
				},
				{ message: `Seeded medication ${seededName} should be available via /api/medications` }
			)
			.toBeTruthy();
		await page.reload();
		await page.waitForLoadState("networkidle");
	}

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

		await expect(page.locator(".timeline")).toBeAttached();
	});

	test("should show schedule days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		await expect(daysSelect).toBeVisible();
		await expect(daysSelect.locator('option[value="30"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="90"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="180"]')).toBeAttached();
	});

	test("should change schedule range via days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		const currentValue = await daysSelect.inputValue();
		const newValue = currentValue === "30" ? "90" : "30";
		await daysSelect.selectOption(newValue);
		await expect(daysSelect).toHaveValue(newValue);
	});

	test("should show past days toggle when medications exist", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await waitForSeededScheduleData(page);

		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible({ timeout: 20000 });
	});

	test("should expand/collapse past days on click", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await waitForSeededScheduleData(page);

		const pastToggle = page.locator(".past-days-toggle");
		await expect(pastToggle).toBeVisible({ timeout: 20000 });

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
		await waitForSeededScheduleData(page);

		const futureToggle = page.locator(".future-days-toggle");
		await expect(futureToggle).toBeVisible({ timeout: 20000 });
	});

	test("should display day blocks in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

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
		await waitForSeededScheduleData(page);

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });
		await expect(todayBlock.locator(".day-date")).toBeVisible();
	});

	test("should show day summary with progress", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await waitForSeededScheduleData(page);

		const summary = page.locator(".dashboard-schedules-section .timeline .day-summary").first();
		await expect(summary).toBeVisible({ timeout: 20000 });
	});

	test("should collapse/expand a day block", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await waitForSeededScheduleData(page);

		await expect(page.locator(".dashboard-schedules-section .timeline")).toBeVisible();
		const dayBlock = page.locator(".dashboard-schedules-section .day-block.today");
		await expect(dayBlock).toBeVisible({ timeout: 20000 });
		const dayDivider = dayBlock.locator(".day-divider");
		await dayDivider.click();

		const isCollapsed = await dayBlock.evaluate((el) => el.classList.contains("collapsed"));
		await dayDivider.click();
		const isCollapsedAfter = await dayBlock.evaluate((el) => el.classList.contains("collapsed"));

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
		await waitForSeededScheduleData(page);
		const shareBtn = page.locator("button.share-btn");
		await expect(shareBtn).toBeVisible();
	});
});
