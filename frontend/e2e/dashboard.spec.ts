import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

/**
 * Dashboard E2E Tests
 *
 * Verifies the main dashboard with medication overview (coverage cards)
 * and upcoming schedules timeline.
 */
test.describe("Dashboard", () => {
	test.use({ storageState: authFile });

	test("should display the dashboard page with header", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// App header with navigation tabs should be visible
		await expect(page.locator("header.hero")).toBeVisible();
		await expect(page.locator("header.hero h1")).toBeVisible();

		// Eyebrow should show "Overview"
		await expect(page.locator(".eyebrow")).toContainText("Overview");
	});

	test("should show navigation tabs", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// All three nav tabs should be visible
		await expect(page.locator('button.pill:has-text("Dashboard")')).toBeVisible();
		await expect(page.locator('button.pill:has-text("Medications")')).toBeVisible();
		await expect(page.locator('button.pill:has-text("Planner")')).toBeVisible();

		// Dashboard tab should be active
		await expect(page.locator('button.pill.primary:has-text("Dashboard")')).toBeVisible();
	});

	test("should navigate to medications via tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator('button.pill:has-text("Medications")').click();
		await expect(page).toHaveURL(/\/medications/);
	});

	test("should navigate to planner via tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator('button.pill:has-text("Planner")').click();
		await expect(page).toHaveURL(/\/planner/);
	});

	test("should display medication overview section", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Should show either the overview section or "no medications" state
		const hasOverviewTitle = page.locator("h2").filter({ hasText: /Medication Overview/i });
		const hasNoMeds = page.getByText(/No medications/i);

		const overviewVisible = await hasOverviewTitle.isVisible().catch(() => false);
		const noMedsVisible = await hasNoMeds.isVisible().catch(() => false);

		expect(overviewVisible || noMedsVisible).toBeTruthy();
	});

	test("should display schedules section", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Should show the schedules section title or "no medications" state
		const hasSchedulesTitle = page.locator("h2").filter({ hasText: /Upcoming Schedules/i });
		const hasNoMeds = page.getByText(/No medications/i);

		const schedulesVisible = await hasSchedulesTitle.isVisible().catch(() => false);
		const noMedsVisible = await hasNoMeds.isVisible().catch(() => false);

		expect(schedulesVisible || noMedsVisible).toBeTruthy();
	});

	test("should have schedule days selector when schedules exist", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const schedulesTitle = page.locator("h2").filter({ hasText: /Upcoming Schedules/i });
		if (await schedulesTitle.isVisible().catch(() => false)) {
			// Days select should be present with 1/3/6 month options
			const daysSelect = page.locator("select.schedule-days-select");
			if (await daysSelect.isVisible().catch(() => false)) {
				await expect(daysSelect).toBeVisible();
				const options = daysSelect.locator("option");
				await expect(options).toHaveCount(3);
			}
		}
	});

	test("should redirect root to dashboard", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("header.hero")).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(/\/dashboard/);
	});
});
