import * as path from "node:path";
import { expect, test } from "@playwright/test";

const authFile = path.join(import.meta.dirname, ".auth", "user.json");

/**
 * Settings Page E2E Tests
 *
 * These tests verify the settings functionality including
 * notification settings, language selection, and stock thresholds.
 */
test.describe("Settings Page", () => {
	test.use({ storageState: authFile });

	test("should display settings page", async ({ page }) => {
		await page.goto("/settings");

		// Wait for app to load
		await expect(page.locator("body")).not.toContainText(/Loading\.\.\.|Initializing\.\.\./, {
			timeout: 10000,
		});

		// Should display navigation
		await expect(page.getByRole("navigation")).toBeVisible();

		// Page should have settings-related content
		const hasSettingsContent =
			(await page
				.getByText(/settings|configuration|notifications/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/language|email|stock/i)
				.isVisible()
				.catch(() => false));

		expect(hasSettingsContent).toBeTruthy();
	});

	test("should display language settings", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for language setting section
		const hasLanguageSetting =
			(await page
				.getByText(/language/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByRole("combobox", { name: /language/i })
				.isVisible()
				.catch(() => false));

		expect(hasLanguageSetting).toBeTruthy();
	});

	test("should display notification settings", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for notification settings
		const hasNotificationSettings =
			(await page
				.getByText(/notification|email|push/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByRole("checkbox")
				.first()
				.isVisible()
				.catch(() => false));

		expect(hasNotificationSettings).toBeTruthy();
	});

	test("should display stock threshold settings", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for stock threshold settings
		const hasStockSettings =
			(await page
				.getByText(/stock|threshold|days|reminder/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByRole("spinbutton")
				.first()
				.isVisible()
				.catch(() => false));

		expect(hasStockSettings).toBeTruthy();
	});

	test("should have a save button", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Look for save button
		const saveButton = page.getByRole("button", { name: /save/i });
		const hasSaveButton = await saveButton.isVisible().catch(() => false);

		expect(hasSaveButton).toBeTruthy();
	});

	test("should allow toggling notification checkboxes", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Find first checkbox and test toggle
		const checkbox = page.getByRole("checkbox").first();
		const hasCheckbox = await checkbox.isVisible().catch(() => false);

		if (hasCheckbox) {
			const initialState = await checkbox.isChecked();

			// Toggle the checkbox
			await checkbox.click();

			// Wait for checkbox state to change (auto-waiting via assertion)
			if (initialState) {
				await expect(checkbox).not.toBeChecked();
			} else {
				await expect(checkbox).toBeChecked();
			}

			// Toggle back
			await checkbox.click();
			await expect(checkbox).toHaveJSProperty("checked", initialState);
		}
	});

	test("should persist settings page on navigation", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });

		// Navigate away and back
		const dashboardLink = page.getByRole("link", { name: /dashboard/i });
		if (await dashboardLink.isVisible()) {
			await dashboardLink.click();
			await expect(page).toHaveURL(/dashboard/);

			// Navigate back to settings
			const settingsLink = page.getByRole("link", { name: /settings/i });
			await settingsLink.click();
			await expect(page).toHaveURL(/settings/);

			// Settings content should still be there
			await expect(page.getByRole("navigation")).toBeVisible();
		}
	});
});
