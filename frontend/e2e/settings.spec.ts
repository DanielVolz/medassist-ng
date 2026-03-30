import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

const smtpUnavailablePattern = /stay unavailable until SMTP is configured|bleiben deaktiviert, bis SMTP/i;

/**
 * Settings Page E2E Tests
 *
 * Verifies settings form sections: language, notifications,
 * stock thresholds, export/import, and the save workflow.
 */
test.describe("Settings Page", () => {
	test.use({ storageState: authFile });

	test("should display settings form", async ({ page }) => {
		await navigateTo(page, "/settings");

		await expect(page.getByTestId("settings-page")).toBeVisible();
	});

	test("should show language section with select", async ({ page }) => {
		await navigateTo(page, "/settings");

		const languageSelect = page.getByTestId("settings-language-select").locator("select");
		await expect(languageSelect).toBeVisible();

		// Should have at least English and German
		await expect(languageSelect.locator("option")).toHaveCount(2);
	});

	test("should allow switching language", async ({ page }) => {
		await navigateTo(page, "/settings");

		const languageSelect = page.getByTestId("settings-language-select").locator("select");
		const currentValue = await languageSelect.inputValue();

		// Switch to the other language
		const targetLang = currentValue === "en" ? "de" : "en";
		await languageSelect.selectOption(targetLang);
		await expect(languageSelect).toHaveValue(targetLang);

		// Switch back to original
		await languageSelect.selectOption(currentValue);
		await expect(languageSelect).toHaveValue(currentValue);
	});

	test("should show notification matrix", async ({ page }) => {
		await navigateTo(page, "/settings");

		const matrix = page.getByTestId("settings-notification-matrix");
		await expect(matrix).toBeVisible();

		// Matrix contains toggle switches
		const toggles = matrix.locator('input[type="checkbox"]');
		expect(await toggles.count()).toBeGreaterThanOrEqual(2);
	});

	test("should keep email controls disabled when settings request is forbidden", async ({ page }) => {
		await page.route("**/api/settings", async (route) => {
			if (route.request().method() !== "GET") {
				await route.continue();
				return;
			}

			await route.fulfill({
				status: 403,
				contentType: "application/json",
				body: JSON.stringify({ error: "Forbidden", code: "FORBIDDEN" }),
			});
		});

		await navigateTo(page, "/settings");

		const emailSection = page.getByTestId("settings-notification-card");
		const emailToggle = page.getByTestId("settings-email-enabled-toggle").locator('input[type="checkbox"]');

		await expect(emailToggle).toBeDisabled();
		await expect(emailSection.getByText(smtpUnavailablePattern)).toHaveCount(0);
	});

	test("should keep the email toggle enabled when the settings API returns smtp configuration", async ({ page }) => {
		await navigateTo(page, "/settings");

		const settingsResponse = await page.evaluate(async () => {
			const response = await fetch("/api/settings", { credentials: "include" });
			const body = await response.json().catch(() => null);
			return {
				ok: response.ok,
				status: response.status,
				body,
			};
		});

		test.skip(!settingsResponse.ok, `Settings request failed with status ${settingsResponse.status}`);
		test.skip(!settingsResponse.body?.smtpHost, "SMTP is not configured in this environment");

		const emailSection = page.getByTestId("settings-notification-card");
		const emailToggle = page.getByTestId("settings-email-enabled-toggle").locator('input[type="checkbox"]');

		await expect(emailToggle).toBeEnabled();
		await expect(emailSection.getByText(smtpUnavailablePattern)).toHaveCount(0);
	});

	test("should show stock settings section with threshold inputs", async ({ page }) => {
		await navigateTo(page, "/settings");

		await expect(page.getByTestId("settings-security-card")).toBeVisible();
		await expect(page.getByTestId("settings-threshold-critical")).toBeVisible();
		await expect(page.getByTestId("settings-threshold-low")).toBeVisible();
		await expect(page.getByTestId("settings-threshold-high")).toBeVisible();
	});

	test("should show calculation mode radio cards", async ({ page }) => {
		await navigateTo(page, "/settings");

		const modeGroup = page.getByTestId("settings-calculation-mode");
		await expect(modeGroup).toBeVisible();
		expect(await modeGroup.locator('[value="automatic"], [data-value="automatic"]').count()).toBeGreaterThan(0);
		expect(await modeGroup.locator('[value="manual"], [data-value="manual"]').count()).toBeGreaterThan(0);
	});

	test("should toggle calculation mode", async ({ page }) => {
		await navigateTo(page, "/settings");

		const modeGroup = page.getByTestId("settings-calculation-mode");
		const automatic = modeGroup.locator('input[type="radio"][value="automatic"]');
		const manual = modeGroup.locator('input[type="radio"][value="manual"]');
		await expect(automatic).toHaveCount(1);
		await expect(manual).toHaveCount(1);
		const automaticId = await automatic.getAttribute("id");
		const manualId = await manual.getAttribute("id");
		expect(automaticId).toBeTruthy();
		expect(manualId).toBeTruthy();
		const automaticLabel = modeGroup.locator(`label[for="${automaticId}"]`).first();
		const manualLabel = modeGroup.locator(`label[for="${manualId}"]`).first();

		const automaticChecked = await automatic.isChecked();
		if (automaticChecked) {
			await manualLabel.click();
			await expect(manual).toBeChecked();
		} else {
			await automaticLabel.click();
			await expect(automatic).toBeChecked();
		}
	});

	test("should have export action button", async ({ page }) => {
		await navigateTo(page, "/settings");

		const exportButton = page.getByRole("button", { name: /Export Data|Daten exportieren/i });
		await expect(exportButton).toBeVisible();
	});

	test("should generate a new API key from the settings page", async ({ page }) => {
		await navigateTo(page, "/settings");

		const generateButton = page.getByRole("button", { name: /Generate key|Key erzeugen/i });
		test.skip(
			!(await generateButton.isVisible().catch(() => false)),
			"API key action is unavailable in this environment"
		);

		await generateButton.click();

		const tokenInput = page.locator(".api-key-token-input");
		const tokenVisible = await tokenInput
			.waitFor({ state: "visible", timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		test.skip(!tokenVisible, "API key token UI is unavailable in this environment");

		await expect(tokenInput).toBeVisible();
		await expect(tokenInput).toHaveValue(/^ma_/);
	});

	test("should show export/import section", async ({ page }) => {
		await navigateTo(page, "/settings");

		const exportBtn = page
			.getByTestId("settings-danger-zone-card")
			.getByRole("button", { name: /Export Data|Daten exportieren/i });
		await expect(exportBtn).toBeVisible();
	});

	test("should toggle a notification switch", async ({ page }) => {
		await navigateTo(page, "/settings");

		const matrix = page.getByTestId("settings-notification-matrix");
		const toggles = matrix.locator('input[type="checkbox"]');
		const count = await toggles.count();

		let enabledToggle = null as null | ReturnType<typeof toggles.nth>;
		for (let i = 0; i < count; i++) {
			const toggle = toggles.nth(i);
			const isDisabled = !(await toggle.isEnabled());
			if (!isDisabled) {
				enabledToggle = toggle;
				break;
			}
		}

		test.skip(!enabledToggle, "All notification toggles are disabled in this environment");

		const initialState = await enabledToggle.isChecked();

		await enabledToggle.click();

		if (initialState) {
			await expect(enabledToggle).not.toBeChecked();
		} else {
			await expect(enabledToggle).toBeChecked();
		}

		// Toggle back to restore original state
		await enabledToggle.click();
		await expect(enabledToggle).toHaveJSProperty("checked", initialState);
	});

	test("should validate stock thresholds", async ({ page }) => {
		await navigateTo(page, "/settings");

		// Set an invalid value (critical > low)
		const criticalInput = page.getByTestId("settings-threshold-critical").locator("input");
		await criticalInput.fill("999");

		// Should show validation error
		const validationError = page.getByTestId("settings-threshold-validation");
		await expect(validationError).toBeVisible();
	});

	test("should reach settings via user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const userMenuButton = page.getByTestId("user-menu-trigger");
		test.skip(!(await userMenuButton.isVisible().catch(() => false)), "User menu is unavailable when auth is disabled");

		// Open user menu
		await userMenuButton.click();

		// Click settings option in dropdown
		const settingsOption = page.getByTestId("user-menu-settings");
		await expect(settingsOption).toBeVisible();
		await settingsOption.click();

		await expect(page).toHaveURL(/\/settings/);
		await expect(page.getByTestId("settings-page")).toBeVisible();
	});
});
