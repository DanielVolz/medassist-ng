import type { Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

/**
 * Medication Edit E2E Tests
 *
 * Tests editing medications: changing fields, adding notes, taken-by persons,
 * generic name, refill stock, intake reminders, and intake schedule changes.
 * Each test creates a medication via API, edits it via the UI, and verifies the change.
 */

/** Helper: click Edit button on a medication row */
async function clickEditMed(page: Page, medName: string): Promise<void> {
	const medRow = page.locator(".med-row").filter({ hasText: medName });
	for (let attempt = 0; attempt < 3; attempt++) {
		if (await medRow.isVisible().catch(() => false)) break;
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
	}
	await expect(medRow).toBeVisible({ timeout: 10000 });
	await medRow.locator("button.info").click();
	await expect(page.locator("h2").filter({ hasText: /(Edit(:| (entry|medication))|form\.editEntry)/i })).toBeVisible({
		timeout: 5000,
	});
}

/** Helper: save edit and verify success */
async function saveEditAndVerify(page: Page, medName: string): Promise<void> {
	const form = page.locator("form.form-grid:visible").first();
	// Wait for any pending network before clicking save
	await page.waitForLoadState("networkidle");

	const submitBtn = form.locator("button[type='submit']");
	if (
		(await submitBtn.count()) > 0 &&
		(await submitBtn
			.first()
			.isVisible()
			.catch(() => false))
	) {
		await submitBtn.first().click();
	} else {
		const closeBtn = form.getByRole("button", { name: /Close|Cancel/i }).first();
		if (await closeBtn.isVisible().catch(() => false)) {
			await closeBtn.click();
		}
	}

	// Wait for save request + re-fetch to complete
	await page.waitForLoadState("networkidle");

	// Reload page to get fresh data from the backend
	// This ensures the meds array passed to startEdit has the saved changes
	await page.reload();
	await page.waitForLoadState("networkidle");

	// Verify the med row is visible in the list
	const medRow = page.locator(".med-row").filter({ hasText: medName });
	await expect(medRow).toBeVisible({ timeout: 10000 });
}

test.describe("Medication Editing", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should edit generic name on an existing medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Edit GenName Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Edit GenName Med");

		// Generic name should be empty initially
		const genericField = page.getByLabel(/(Generic Name|form\.genericName)/i);
		await expect(genericField).toHaveValue("");

		// Add a generic name
		await genericField.fill("Acetylsalicylic acid");
		await expect(genericField).toHaveValue("Acetylsalicylic acid");

		await saveEditAndVerify(page, "Edit GenName Med");

		// Click edit again and verify the generic name was saved
		await clickEditMed(page, "Edit GenName Med");
		await expect(page.getByLabel(/(Generic Name|form\.genericName)/i)).toHaveValue("Acetylsalicylic acid");
	});

	test("should add notes to an existing medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Edit Notes Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Edit Notes Med");
		await page.getByRole("tab", { name: /Package/i }).click();

		// Notes should be empty initially
		const notesField = page.getByLabel(/(Notes|form\.notes)/i);
		await expect(notesField).toHaveValue("");

		// Add notes text
		await notesField.fill("Take with food after breakfast. Do not exceed 3 per day. Store below 25°C.");
		await expect(notesField).toContainText("Take with food after breakfast");

		await saveEditAndVerify(page, "Edit Notes Med");

		// Verify notes were saved by clicking edit again
		await clickEditMed(page, "Edit Notes Med");
		await expect(page.getByLabel(/(Notes|form\.notes)/i)).toContainText("Take with food after breakfast");
	});

	test("should add taken-by person to a medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "TakenBy Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "TakenBy Med");

		// Find the taken-by input field inside the tag-input-container
		const takenByContainer = page.locator(".tag-input-container");
		await expect(takenByContainer).toBeVisible();
		const takenByInput = takenByContainer.locator("input");

		// Add a person name
		await takenByInput.fill("Alice");
		await takenByInput.press("Enter");

		// Tag should appear
		await expect(takenByContainer.locator(".tag").filter({ hasText: "Alice" })).toBeVisible();

		// Add another person
		await takenByInput.fill("Bob");
		await takenByInput.press("Enter");
		await expect(takenByContainer.locator(".tag").filter({ hasText: "Bob" })).toBeVisible();

		await saveEditAndVerify(page, "TakenBy Med");

		// Verify tags are persisted
		await clickEditMed(page, "TakenBy Med");
		await expect(page.locator(".tag-input-container .tag").filter({ hasText: "Alice" })).toBeVisible();
		await expect(page.locator(".tag-input-container .tag").filter({ hasText: "Bob" })).toBeVisible();
	});

	test("should remove a taken-by person from a medication", async ({ page }) => {
		createdMeds.push(
			await createMedicationViaAPI({
				name: "Remove TakenBy Med",
				takenBy: ["Alice", "Bob"],
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Remove TakenBy Med");

		// Both persons should appear as tags
		const container = page.locator(".tag-input-container");
		await expect(container.locator(".tag")).toHaveCount(2, { timeout: 5000 });

		// Use Backspace in the empty input to remove the last tag (Bob)
		// The app handles this: if input empty + backspace → remove last takenBy person
		const takenByInput = container.locator("input");
		await takenByInput.click();
		await takenByInput.press("Backspace");

		// After backspace, Bob (the last tag) should be removed, leaving Alice
		await expect(container.locator(".tag")).toHaveCount(1, { timeout: 5000 });
		await expect(container.locator(".tag").filter({ hasText: "Alice" })).toBeVisible();

		await saveEditAndVerify(page, "Remove TakenBy Med");

		// Verify only Alice remains after save
		await clickEditMed(page, "Remove TakenBy Med");
		await expect(container.locator(".tag")).toHaveCount(1, { timeout: 5000 });
		await expect(container.locator(".tag").filter({ hasText: "Alice" })).toBeVisible();
	});

	test("should add an expiry date to a medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Expiry Date Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Expiry Date Med");
		await page.getByRole("tab", { name: /Package/i }).click();

		// Set expiry date to 6 months from now
		const expiryDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
		const expiryField = page.getByLabel(/(Expiry Date|form\.expiryDate)/i);
		await expiryField.fill(expiryDate);
		await expect(expiryField).toHaveValue(expiryDate);

		// Also touch the name field to ensure form is dirty
		// Expiry change itself is enough to persist in the current edit flow.

		await saveEditAndVerify(page, "Expiry Date Med");

		// Verify expiry date was saved
		await clickEditMed(page, "Expiry Date Med");
		await expect(page.getByLabel(/(Expiry Date|form\.expiryDate)/i)).toHaveValue(expiryDate);
	});

	test("should edit intake schedule usage and interval", async ({ page }) => {
		createdMeds.push(
			await createMedicationViaAPI({
				name: "Edit Intake Med",
				intakes: [
					{
						usage: 1,
						every: 1,
						start: new Date().toISOString().slice(0, 16),
						intakeRemindersEnabled: false,
					},
				],
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Edit Intake Med");
		await page.getByRole("tab", { name: /Schedule/i }).click();

		// Change intake from 1 pill daily to 2 pills every 7 days
		const intakeRow = page.locator(".blister-row").first();
		const usageField = intakeRow.getByLabel(/(Usage \(pills\)|form\.blisters\.usage)/i);
		const everyField = intakeRow.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i);

		await usageField.fill("2");
		await everyField.fill("7");

		await expect(usageField).toHaveValue("2");
		await expect(everyField).toHaveValue("7");

		await saveEditAndVerify(page, "Edit Intake Med");

		// Verify the changes persisted
		await clickEditMed(page, "Edit Intake Med");
		const savedRow = page.locator(".blister-row").first();
		await expect(savedRow.getByLabel(/(Usage \(pills\)|form\.blisters\.usage)/i)).toHaveValue("2");
		await expect(savedRow.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i)).toHaveValue("7");
	});

	test("should add a second intake schedule row", async ({ page }) => {
		createdMeds.push(
			await createMedicationViaAPI({
				name: "Add Intake Med",
				intakes: [
					{
						usage: 1,
						every: 1,
						start: new Date().toISOString().slice(0, 16),
						intakeRemindersEnabled: false,
					},
				],
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Add Intake Med");
		await page.getByRole("tab", { name: /Schedule/i }).click();

		// Should have 1 intake row initially
		await expect(page.locator(".blister-row")).toHaveCount(1);

		// Add a second intake
		await page.getByRole("button", { name: /(Intake|form\.blisters\.addIntake)/i }).click();
		await expect(page.locator(".blister-row")).toHaveCount(2);

		// Fill the new intake row
		const secondRow = page.locator(".blister-row").nth(1);
		await secondRow.getByLabel(/(Usage \(pills\)|form\.blisters\.usage)/i).fill("0.5");
		await secondRow.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i).fill("7");

		await saveEditAndVerify(page, "Add Intake Med");

		// Verify 2 intakes persisted
		await clickEditMed(page, "Add Intake Med");
		await expect(page.locator(".blister-row")).toHaveCount(2, { timeout: 10000 });
	});

	test("should toggle intake reminder on a medication", async ({ page }) => {
		createdMeds.push(
			await createMedicationViaAPI({
				name: "Reminder Toggle Med",
				intakes: [
					{
						usage: 1,
						every: 1,
						start: new Date().toISOString().slice(0, 16),
						intakeRemindersEnabled: false,
					},
				],
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Reminder Toggle Med");
		await page.getByRole("tab", { name: /Schedule/i }).click();

		// Find the remind checkbox in the intake row
		const intakeRow = page.locator(".blister-row").first();
		const remindCheckbox = intakeRow.locator('input[type="checkbox"]');

		if (await remindCheckbox.isVisible().catch(() => false)) {
			// Should be unchecked initially
			await expect(remindCheckbox).not.toBeChecked();

			// Enable it
			await remindCheckbox.check();
			await expect(remindCheckbox).toBeChecked();

			await saveEditAndVerify(page, "Reminder Toggle Med");

			// Verify reminder was saved
			await clickEditMed(page, "Reminder Toggle Med");
			const savedCheckbox = page.locator(".blister-row").first().locator('input[type="checkbox"]');
			await expect(savedCheckbox).toBeChecked();
		}
	});

	test("should change package type between blister and bottle", async ({ page }) => {
		createdMeds.push(
			await createMedicationViaAPI({
				name: "PackType Change Med",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, "PackType Change Med");
		const form = page.locator("form.form-grid:visible").first();

		// Should be blister type initially
		const packageSelect = form.locator("select.package-type-select");
		await expect(packageSelect).toHaveValue("blister");

		// Blister-specific fields are shown in the Package tab.
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Blisters per pack|form\.blistersPerPack)/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to bottle
		await packageSelect.selectOption("bottle");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(pills\))/i)).toBeVisible();

		// Fill bottle-specific fields
		await form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(pills\))/i).fill("120");

		await saveEditAndVerify(page, "PackType Change Med");

		// Verify it's still a bottle after reload
		await clickEditMed(page, "PackType Change Med");
		await expect(page.locator("select.package-type-select")).toHaveValue("bottle");
	});

	test("should edit multiple fields at once (name, notes, generic, taken-by)", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Multi Edit Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Multi Edit Med");

		// Change the name
		await page.getByLabel(/(Commercial Name|form\.commercialName)/i).fill("Fully Edited Med");

		// Add generic name
		await page.getByLabel(/(Generic Name|form\.genericName)/i).fill("Ibuprofen Lysinate");

		// Add notes
		await page.getByRole("tab", { name: /Package/i }).click();
		await page.getByLabel(/(Notes|form\.notes)/i).fill("Morning dose only. Take with plenty of water.");
		await page.getByRole("tab", { name: /General/i }).click();

		// Add a taken-by person
		const takenByInput = page.locator(".tag-input-container input");
		await takenByInput.fill("Charlie");
		await takenByInput.press("Enter");
		await expect(page.locator(".tag-input-container .tag").filter({ hasText: "Charlie" })).toBeVisible();

		await saveEditAndVerify(page, "Fully Edited Med");

		// Verify all changes persisted
		await clickEditMed(page, "Fully Edited Med");
		await expect(page.getByLabel(/(Commercial Name|form\.commercialName)/i)).toHaveValue("Fully Edited Med");
		await expect(page.getByLabel(/(Generic Name|form\.genericName)/i)).toHaveValue("Ibuprofen Lysinate");
		await expect(page.getByLabel(/(Notes|form\.notes)/i)).toContainText("Morning dose only");
		await expect(page.locator(".tag-input-container .tag").filter({ hasText: "Charlie" })).toBeVisible();
	});
});
