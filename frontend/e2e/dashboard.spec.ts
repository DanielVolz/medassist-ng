import { expect, type Page } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

/**
 * Dashboard E2E Tests
 *
 * Verifies the main dashboard with medication overview (coverage cards)
 * and upcoming schedules timeline.
 */
test.describe("Dashboard", () => {
	test.use({ storageState: authFile });

	async function swipeMainRoute(page: Page, fromX: number, toX: number) {
		const surface = page.getByTestId("main-route-swipe-surface");
		const y = 360;
		for (const point of [
			{ type: "touchstart", clientX: fromX, clientY: y },
			{ type: "touchmove", clientX: toX, clientY: y + 6 },
			{ type: "touchend", clientX: toX, clientY: y + 6 },
		] as const) {
			await surface.evaluate((element, eventPoint) => {
				const event = new Event(eventPoint.type, { bubbles: true, cancelable: true });
				const touch = { clientX: eventPoint.clientX, clientY: eventPoint.clientY };
				Object.defineProperty(event, "touches", { value: eventPoint.type === "touchend" ? [] : [touch] });
				Object.defineProperty(event, "changedTouches", { value: [touch] });
				element.dispatchEvent(event);
			}, point);
		}
	}

	test("should display the dashboard page with header", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// App header with navigation tabs should be visible
		await expect(page.getByTestId("app-header")).toBeVisible();
		await expect(page.getByTestId("app-header").getByRole("heading", { level: 1 })).toBeVisible();

		// Eyebrow should show "Overview"
		await expect(page.getByTestId("app-header")).toContainText(/Overview/i);
	});

	test("should show navigation tabs", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// All three nav tabs should be visible
		await expect(page.getByTestId("main-nav").getByRole("button", { name: /Dashboard/i })).toBeVisible();
		await expect(page.getByTestId("main-nav").getByRole("button", { name: /Medications/i })).toBeVisible();
		await expect(page.getByTestId("main-nav").getByRole("button", { name: /Planner/i })).toBeVisible();

		// Dashboard tab should be active
		await expect(page).toHaveURL(/\/dashboard/);
	});

	test("should navigate to medications via tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page
			.getByTestId("main-nav")
			.getByRole("button", { name: /Medications/i })
			.click();
		await expect(page).toHaveURL(/\/medications/);
	});

	test("should navigate to planner via tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page
			.getByTestId("main-nav")
			.getByRole("button", { name: /Planner/i })
			.click();
		await expect(page).toHaveURL(/\/planner/);
	});

	test.describe("mobile swipe navigation", () => {
		test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

		test("swipes between Dashboard, Medications, and Planner", async ({ page }) => {
			await page.addInitScript(() => window.localStorage.removeItem("medassist.mainRouteSwipeHintDismissed"));
			await navigateTo(page, "/dashboard");
			await expect(page).toHaveURL(/\/dashboard/);
			await expect(page.getByTestId("main-swipe-hint")).toBeVisible();
			await page.getByTestId("main-swipe-hint-dismiss").tap();
			await expect(page.getByTestId("main-swipe-hint")).toBeHidden();
			await expect
				.poll(() => page.evaluate(() => window.localStorage.getItem("medassist.mainRouteSwipeHintDismissed")))
				.toBe("true");

			await swipeMainRoute(page, 340, 80);
			await expect(page).toHaveURL(/\/medications/);
			await expect(page.getByTestId("main-nav").getByRole("button", { name: /Medications/i })).toHaveAttribute(
				"aria-current",
				"page"
			);

			await swipeMainRoute(page, 340, 80);
			await expect(page).toHaveURL(/\/planner/);
			await expect(page.getByTestId("main-nav").getByRole("button", { name: /Planner/i })).toHaveAttribute(
				"aria-current",
				"page"
			);

			await swipeMainRoute(page, 80, 340);
			await expect(page).toHaveURL(/\/medications/);
		});
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
		await expect(page.getByTestId("app-header")).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(/\/dashboard/);
	});
});
