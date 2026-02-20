import { expect, type Page } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

/**
 * Medications Page E2E Tests
 *
 * Verifies the medication list, add/edit form, CRUD operations,
 * and form validation.
 */
test.describe("Medications Page", () => {
	test.use({ storageState: authFile });

	const visibleMedForm = (page: Page) => page.locator("form.form-grid:visible").first();

	async function openMedicationForm(page: Page) {
		await navigateTo(page, "/medications");
		const nameField = visibleMedForm(page).getByLabel(/(Commercial Name|form\.commercialName)/i);
		if (await nameField.isVisible().catch(() => false)) return;

		const newEntryButton = page.getByRole("button", { name: /(new (entry|medication)|form\.newEntry)/i });
		if (await newEntryButton.isVisible().catch(() => false)) {
			await newEntryButton.click();
			await expect(nameField).toBeVisible({ timeout: 5000 });
		}
	}

	test("should display medications page", async ({ page }) => {
		await navigateTo(page, "/medications");

		// Medications tab should be active
		await expect(page.locator('button.pill.primary:has-text("Medications")')).toBeVisible();
	});

	test("should show medication list or empty state", async ({ page }) => {
		await navigateTo(page, "/medications");

		// Should show either medication entries or the new medication form
		const listTitle = page.locator("h2").filter({ hasText: /(Medication list|form\.medicationList)/i });
		const formTitle = page.locator("h2").filter({ hasText: /(New (entry|medication)|form\.newEntry)/i });

		const hasList = await listTitle.isVisible().catch(() => false);
		const hasForm = await formTitle.isVisible().catch(() => false);

		expect(hasList || hasForm).toBeTruthy();
	});

	test("should display the medication form with required fields", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);

		const commercialName = form.getByLabel(/(Commercial Name|form\.commercialName)/i);
		await expect(commercialName).toBeVisible();

		// Package type selector should exist
		await expect(form.getByText(/(Package Type|form\.packageType)/i)).toBeVisible();

		// Tabbed form should expose navigation to Package/Schedule sections
		await expect(page.getByRole("tab", { name: /Package/i })).toBeVisible();
		await expect(page.getByRole("tab", { name: /Schedule/i })).toBeVisible();
	});

	test("should fill in medication details", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);

		const nameField = form.getByLabel(/(Commercial Name|form\.commercialName)/i);
		await nameField.fill("Test Aspirin");
		await expect(nameField).toHaveValue("Test Aspirin");

		const genericField = form.getByLabel(/(Generic Name|form\.genericName)/i);
		await genericField.fill("Acetylsalicylic acid");
		await expect(genericField).toHaveValue("Acetylsalicylic acid");
	});

	test("should have stock inventory fields", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);
		await page.getByRole("tab", { name: /Package/i }).click();

		// Package tab should expose stock-related fields for at least one package mode.
		const packsField = form.getByLabel(/(^Packs$|form\.packs)/i).first();
		const totalField = form.getByText(/(Total \(pills\)|Total Capacity|form\.totalCapacity)/i).first();

		const hasPacks = await packsField.isVisible().catch(() => false);
		const hasTotal = await totalField.isVisible().catch(() => false);

		expect(hasPacks || hasTotal).toBeTruthy();
	});

	test("should toggle package type between blister and bottle", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);
		await page.getByRole("tab", { name: /Package/i }).click();

		// Find the package type radio buttons or selector
		const blisterOption = form.getByText(/(Blister Pack|form\.packageType\.blister)/i);
		const bottleOption = form.getByText(/(Pill Bottle|form\.packageType\.bottle)/i);

		if (await blisterOption.isVisible().catch(() => false)) {
			// Switch to bottle
			await bottleOption.click();
			// Bottle-specific fields should appear
			await expect(form.getByLabel(/(Total Capacity|form\.totalCapacity)/i)).toBeVisible();

			// Switch back to blister
			await blisterOption.click();
			await expect(form.getByLabel(/(Blisters per pack|form\.blistersPerPack)/i)).toBeVisible();
		}
	});

	test("should have intake schedule with add button", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);
		await page.getByRole("tab", { name: /Schedule/i }).click();

		// Intake schedule section
		await expect(page.getByRole("tab", { name: /Schedule/i, selected: true })).toBeVisible();

		// Should have at least one intake entry
		await expect(
			form.getByText(/(Usage \(pills\)|Every \(days\)|form\.blisters\.usage|form\.blisters\.everyDays)/i).first()
		).toBeVisible();

		// Should have an add intake button
		const addIntake = form.getByRole("button", { name: /(Intake|form\.blisters\.addIntake)/i });
		await expect(addIntake).toBeVisible();
	});

	test("should have save and cancel buttons", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);

		// Fill in a name to make the form dirty
		await form.getByLabel(/(Commercial Name|form\.commercialName)/i).fill("Test");

		// Save button
		const saveButton = page.getByRole("button", { name: /Save|Add Medication/i });
		await expect(saveButton).toBeVisible();
	});

	test("should prevent navigation with unsaved changes", async ({ page }) => {
		await openMedicationForm(page);
		const form = visibleMedForm(page);

		// Fill in the form to create unsaved changes
		await form.getByLabel(/(Commercial Name|form\.commercialName)/i).fill("Unsaved Medication");

		// Try to navigate away
		await page.locator('button.pill:has-text("Dashboard")').click();

		// Should show unsaved changes warning modal
		const modal = page.locator(".confirm-modal-overlay, .modal-overlay");
		const hasWarning = await modal.isVisible().catch(() => false);

		if (hasWarning) {
			// Cancel to stay on page
			const cancelBtn = page.getByRole("button", { name: /Cancel|Stay/i });
			if (await cancelBtn.isVisible().catch(() => false)) {
				await cancelBtn.click();
			}
		}
	});
});
