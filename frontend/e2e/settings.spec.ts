import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

const emailHeadingPattern = /Email|E-Mail/i;
const settingsLoadErrorPattern = /could not be loaded|konnten nicht geladen werden/i;
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

		await expect(page.locator("div.settings-form")).toBeVisible();
	});

	test("should show language section with select", async ({ page }) => {
		await navigateTo(page, "/settings");

		const languageSelect = page.locator("select.language-select");
		await expect(languageSelect).toBeVisible();

		// Should have at least English and German
		await expect(languageSelect.locator("option")).toHaveCount(2);
	});

	test("should allow switching language", async ({ page }) => {
		await navigateTo(page, "/settings");

		const languageSelect = page.locator("select.language-select");
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

		const matrix = page.locator("div.notification-matrix");
		await expect(matrix).toBeVisible();

		// Matrix contains toggle switches
		const toggles = matrix.locator("label.toggle-switch");
		expect(await toggles.count()).toBeGreaterThanOrEqual(2);
	});

	test("should show an explicit email settings load error when settings request is forbidden", async ({ page }) => {
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

		const emailSection = page
			.locator(".setting-section")
			.filter({ has: page.locator(".section-header h3").filter({ hasText: emailHeadingPattern }) })
			.first();
		const emailToggle = emailSection.locator('input[type="checkbox"]').first();

		await expect(emailToggle).toBeDisabled();
		await expect(emailSection.locator(".danger-text")).toContainText(settingsLoadErrorPattern);
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

		const emailSection = page
			.locator(".setting-section")
			.filter({ has: page.locator(".section-header h3").filter({ hasText: emailHeadingPattern }) })
			.first();
		const emailToggle = emailSection.locator('input[type="checkbox"]').first();

		await expect(emailToggle).toBeEnabled();
		await expect(emailSection.getByText(smtpUnavailablePattern)).toHaveCount(0);
	});

	test("should show stock settings section with threshold inputs", async ({ page }) => {
		await navigateTo(page, "/settings");

		const thresholdGroup = page.locator("div.threshold-chips-group");
		await expect(thresholdGroup).toBeVisible();

		// Should have three threshold number inputs
		const thresholdInputs = thresholdGroup.locator('input[type="text"]');
		await expect(thresholdInputs).toHaveCount(3);
	});

	test("should show calculation mode radio cards", async ({ page }) => {
		await navigateTo(page, "/settings");

		const modeGroup = page.locator("div.calculation-mode-group");
		await expect(modeGroup).toBeVisible();

		// Two radio cards: automatic and manual
		const radioCards = modeGroup.locator("label.radio-card");
		await expect(radioCards).toHaveCount(2);

		// One should be selected
		await expect(modeGroup.locator("label.radio-card.selected")).toHaveCount(1);
	});

	test("should toggle calculation mode", async ({ page }) => {
		await navigateTo(page, "/settings");

		const modeGroup = page.locator("div.calculation-mode-group");
		const radioCards = modeGroup.locator("label.radio-card");

		// Find the non-selected card and click it
		const firstSelected = await radioCards.first().evaluate((el) => el.classList.contains("selected"));
		const targetCard = firstSelected ? radioCards.nth(1) : radioCards.first();

		await targetCard.click();
		await expect(targetCard).toHaveClass(/selected/);

		// Click the other one back
		const otherCard = firstSelected ? radioCards.first() : radioCards.nth(1);
		await otherCard.click();
		await expect(otherCard).toHaveClass(/selected/);
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
		await expect(tokenInput).toBeVisible();
		await expect(tokenInput).toHaveValue(/^ma_/);
	});

	test("should show export/import section", async ({ page }) => {
		await navigateTo(page, "/settings");

		// Export button
		const exportBtn = page.locator("div.action-card button.secondary").first();
		await expect(exportBtn).toBeVisible();
	});

	test("should toggle a notification switch", async ({ page }) => {
		await navigateTo(page, "/settings");

		// Find all toggle-switch labels on the entire settings page
		const allToggleLabels = page.locator("label.toggle-switch");
		const count = await allToggleLabels.count();

		// Find the first toggle that is NOT disabled
		let enabledToggle = null;
		for (let i = 0; i < count; i++) {
			const label = allToggleLabels.nth(i);
			const isDisabled = await label.evaluate((el) => el.classList.contains("disabled"));
			if (!isDisabled) {
				enabledToggle = label;
				break;
			}
		}

		test.skip(!enabledToggle, "All notification toggles are disabled in this environment");

		const checkbox = enabledToggle.locator('input[type="checkbox"]');
		const initialState = await checkbox.isChecked();

		// Click the label to toggle
		await enabledToggle.click();

		if (initialState) {
			await expect(checkbox).not.toBeChecked();
		} else {
			await expect(checkbox).toBeChecked();
		}

		// Toggle back to restore original state
		await enabledToggle.click();
		await expect(checkbox).toHaveJSProperty("checked", initialState);
	});

	test("should validate stock thresholds", async ({ page }) => {
		await navigateTo(page, "/settings");

		const thresholdGroup = page.locator("div.threshold-chips-group");
		const inputs = thresholdGroup.locator('input[type="text"]');

		// Set an invalid value (critical > low)
		const criticalInput = inputs.first();
		await criticalInput.fill("999");

		// Should show validation error
		const validationError = page.locator("p.threshold-validation-error");
		await expect(validationError).toBeVisible();
	});

	test("should reach settings via user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const userMenuButton = page.locator("button.user-menu-btn");
		test.skip(!(await userMenuButton.isVisible().catch(() => false)), "User menu is unavailable when auth is disabled");

		// Open user menu
		await userMenuButton.click();

		// Click settings option in dropdown
		const settingsOption = page.locator(".user-dropdown").getByText(/Settings/i);
		await expect(settingsOption).toBeVisible();
		await settingsOption.click();

		await expect(page).toHaveURL(/\/settings/);
		await expect(page.locator("div.settings-form")).toBeVisible();
	});
});
