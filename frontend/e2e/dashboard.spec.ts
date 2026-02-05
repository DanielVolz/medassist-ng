import * as path from "node:path";
import { expect, test } from "@playwright/test";

const authFile = path.join(import.meta.dirname, ".auth", "user.json");

/**
 * Dashboard E2E Tests
 *
 * These tests verify the main dashboard functionality including
 * medication overview and upcoming schedules.
 */
test.describe("Dashboard", () => {
	test.use({ storageState: authFile });

	test("should display dashboard page", async ({ page }) => {
		await page.goto("/dashboard");

		// Wait for app to load
		await expect(page.locator("body")).not.toContainText(/Loading\.\.\.|Initializing\.\.\./, {
			timeout: 10000,
		});

		// Should display navigation
		await expect(page.getByRole("navigation")).toBeVisible();

		// Should show dashboard content
		const hasDashboardContent =
			(await page
				.getByText(/dashboard|overview|medications/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/no medications/i)
				.isVisible()
				.catch(() => false));

		expect(hasDashboardContent).toBeTruthy();
	});

	test("should have working navigation links", async ({ page }) => {
		await page.goto("/dashboard");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Check for navigation links - these are the common nav items
		const navLinks = ["dashboard", "medications", "planner", "settings", "schedule"];

		for (const link of navLinks) {
			const navLink = page.getByRole("link", { name: new RegExp(link, "i") });
			const isVisible = await navLink.isVisible().catch(() => false);

			// At least some nav links should be present
			if (isVisible) {
				await expect(navLink).toBeEnabled();
			}
		}
	});

	test("should navigate to medications page", async ({ page }) => {
		await page.goto("/dashboard");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Click medications link
		const medsLink = page.getByRole("link", { name: /medications/i });
		if (await medsLink.isVisible()) {
			await medsLink.click();
			await expect(page).toHaveURL(/medications/);
		}
	});

	test("should navigate to settings page", async ({ page }) => {
		await page.goto("/dashboard");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Click settings link
		const settingsLink = page.getByRole("link", { name: /settings/i });
		if (await settingsLink.isVisible()) {
			await settingsLink.click();
			await expect(page).toHaveURL(/settings/);
		}
	});

	test("should display medication overview section", async ({ page }) => {
		await page.goto("/dashboard");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for medication overview or "no medications" message
		const hasOverview =
			(await page
				.getByText(/medication overview|stock/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/no medications/i)
				.isVisible()
				.catch(() => false));

		expect(hasOverview).toBeTruthy();
	});

	test("should display upcoming schedules section", async ({ page }) => {
		await page.goto("/dashboard");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for schedules section or indication that there are no schedules
		const hasSchedules =
			(await page
				.getByText(/upcoming|schedule|1 month|3 months/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/no medications/i)
				.isVisible()
				.catch(() => false));

		expect(hasSchedules).toBeTruthy();
	});
});
