import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

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

		await expect(page.locator("form.settings-form")).toBeVisible();
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

	test("should show stock settings section with threshold inputs", async ({ page }) => {
		await navigateTo(page, "/settings");

		const thresholdGroup = page.locator("div.threshold-chips-group");
		await expect(thresholdGroup).toBeVisible();

		// Should have three threshold number inputs
		const thresholdInputs = thresholdGroup.locator('input[type="number"]');
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

	test("should have save button in form footer", async ({ page }) => {
		await navigateTo(page, "/settings");

		const saveButton = page.locator('div.form-footer > button[type="submit"]');
		await expect(saveButton).toBeVisible();
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

		if (!enabledToggle) {
			// All toggles disabled (no notification channels configured) — skip
			return;
		}

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
		const inputs = thresholdGroup.locator('input[type="number"]');

		// Set an invalid value (critical > low)
		const criticalInput = inputs.first();
		await criticalInput.fill("999");

		// Should show validation error
		const validationError = page.locator("p.threshold-validation-error");
		await expect(validationError).toBeVisible();
	});

	test("should reach settings via user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Open user menu
		await page.locator("button.user-menu-btn").click();

		// Click settings option in dropdown
		const settingsOption = page.locator(".user-dropdown").getByText(/Settings/i);
		await expect(settingsOption).toBeVisible();
		await settingsOption.click();

		await expect(page).toHaveURL(/\/settings/);
		await expect(page.locator("form.settings-form")).toBeVisible();
	});
});
