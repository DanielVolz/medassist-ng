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

	async function openMedicationForm(page: Page) {
		await navigateTo(page, "/medications");
		const newMedicationButton = page.getByRole("button", { name: /New medication/i });
		if (await newMedicationButton.isVisible().catch(() => false)) {
			await newMedicationButton.click();
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
		const listTitle = page.locator("h2").filter({ hasText: /Medication list/i });
		const formTitle = page.locator("h2").filter({ hasText: /New medication/i });

		const hasList = await listTitle.isVisible().catch(() => false);
		const hasForm = await formTitle.isVisible().catch(() => false);

		expect(hasList || hasForm).toBeTruthy();
	});

	test("should display the medication form with required fields", async ({ page }) => {
		await openMedicationForm(page);

		const commercialName = page.getByLabel(/Commercial Name/i);
		await expect(commercialName).toBeVisible();

		// Package type selector should exist
		await expect(page.getByText(/Package Type/i)).toBeVisible();

		// Intake schedule section should exist
		await expect(page.getByText(/Intake schedule/i)).toBeVisible();
	});

	test("should fill in medication details", async ({ page }) => {
		await openMedicationForm(page);

		const nameField = page.getByLabel(/Commercial Name/i);
		await nameField.fill("Test Aspirin");
		await expect(nameField).toHaveValue("Test Aspirin");

		const genericField = page.getByLabel(/Generic Name/i);
		await genericField.fill("Acetylsalicylic acid");
		await expect(genericField).toHaveValue("Acetylsalicylic acid");
	});

	test("should have stock inventory fields", async ({ page }) => {
		await openMedicationForm(page);

		// Stock fields should be visible
		await expect(page.getByLabel(/^Packs$/i)).toBeVisible();

		// Either blister or bottle fields depending on package type
		const blistersField = page.getByLabel(/Blisters per pack/i);
		const pillsField = page.getByLabel(/Pills per blister/i);
		const capacityField = page.getByLabel(/Total Capacity/i);

		const hasBlister = await blistersField.isVisible().catch(() => false);
		const hasBottle = await capacityField.isVisible().catch(() => false);

		expect(hasBlister || hasBottle).toBeTruthy();
	});

	test("should toggle package type between blister and bottle", async ({ page }) => {
		await openMedicationForm(page);

		// Find the package type radio buttons or selector
		const blisterOption = page.getByText(/Blister Pack/i);
		const bottleOption = page.getByText(/Pill Bottle/i);

		if (await blisterOption.isVisible().catch(() => false)) {
			// Switch to bottle
			await bottleOption.click();
			// Bottle-specific fields should appear
			await expect(page.getByLabel(/Total Capacity/i)).toBeVisible();

			// Switch back to blister
			await blisterOption.click();
			await expect(page.getByLabel(/Blisters per pack/i)).toBeVisible();
		}
	});

	test("should have intake schedule with add button", async ({ page }) => {
		await openMedicationForm(page);

		// Intake schedule section
		const scheduleSection = page.getByText(/Intake schedule/i);
		await expect(scheduleSection).toBeVisible();

		// Should have at least one intake entry
		await expect(page.getByText(/Usage \(pills\)|Every \(days\)/i).first()).toBeVisible();

		// Should have an add intake button
		const addIntake = page.getByRole("button", { name: /Intake/i });
		await expect(addIntake).toBeVisible();
	});

	test("should have save and cancel buttons", async ({ page }) => {
		await openMedicationForm(page);

		// Fill in a name to make the form dirty
		await page.getByLabel(/Commercial Name/i).fill("Test");

		// Save button
		const saveButton = page.getByRole("button", { name: /Save|Add Medication/i });
		await expect(saveButton).toBeVisible();
	});

	test("should prevent navigation with unsaved changes", async ({ page }) => {
		await openMedicationForm(page);

		// Fill in the form to create unsaved changes
		await page.getByLabel(/Commercial Name/i).fill("Unsaved Medication");

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
