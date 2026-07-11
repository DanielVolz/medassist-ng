import type { Locator, Page } from "@playwright/test";
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
	const medRow = page.getByTestId("medication-row").filter({ hasText: medName });
	for (let attempt = 0; attempt < 3; attempt++) {
		if (await medRow.isVisible().catch(() => false)) break;
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
	}
	await expect(medRow).toBeVisible({ timeout: 10000 });
	await medRow.getByRole("button", { name: /Edit|common\.edit/i }).click();
	await expect(
		page.getByRole("heading", { name: /(Edit(:| (entry|medication))|form\.editEntry)/i }).first()
	).toBeVisible({
		timeout: 5000,
	});
}

function getMedicationEditForm(page: Page): Locator {
	return page
		.locator("form.form-grid:visible")
		.filter({ has: page.getByRole("button", { name: /Save|common\.save/i }) })
		.first();
}

function takenByTag(form: Locator, name: string): Locator {
	return form.locator(".tag-input-container > .tag:visible").filter({ hasText: name });
}

function takenByInput(form: Locator): Locator {
	return form.locator(".tag-input-container input:visible");
}

function intakeReminderCheckbox(form: Locator): Locator {
	return form.getByRole("checkbox", {
		name: /(Remind|Receive a notification.*scheduled intake|form\.blisters\.remind)/i,
	});
}

async function openMedicationDetailFromDashboard(page: Page, medName: string) {
	const overviewTable = page.getByTestId("dashboard-overview-table");
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await expect(overviewTable).toBeVisible({ timeout: 10000 });
			const medRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: medName });
			await expect(medRow).toBeVisible({ timeout: 10000 });
			const detailButton = medRow.getByRole("button", { name: medName, exact: true });
			await expect(detailButton).toBeVisible({ timeout: 10000 });
			await detailButton.click();
			const modal = page
				.getByRole("dialog")
				.filter({ has: page.getByRole("heading", { name: medName }) })
				.last();
			await expect(modal).toBeVisible({ timeout: 5000 });
			await expect(modal.getByText(medName)).toBeVisible({ timeout: 5000 });
			return modal;
		} catch {
			if (attempt === 2) throw new Error(`Failed to open dashboard medication detail for ${medName}`);
			await page.reload();
			await page.waitForLoadState("networkidle");
		}
	}

	throw new Error(`Failed to open dashboard medication detail for ${medName}`);
}

/** Helper: save edit and verify success */
async function saveEditAndVerify(page: Page, medName: string): Promise<void> {
	const form = getMedicationEditForm(page);
	// Wait for any pending network before clicking save
	await page.waitForLoadState("networkidle");

	const submitBtn = form.getByRole("button", { name: /Save|common\.save/i });
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
	const medRow = page.getByTestId("medication-row").filter({ hasText: medName });
	await expect(medRow).toBeVisible({ timeout: 10000 });
}

async function expectStepperValueToFit(input: Locator): Promise<void> {
	await expect(input).toBeVisible();

	const metrics = await input.evaluate((element) => {
		const inputElement = element as HTMLInputElement;
		const styles = window.getComputedStyle(inputElement);
		const parsePixels = (value: string) => Number.parseFloat(value) || 0;
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		let textWidth = 0;
		if (context) {
			context.font = [styles.fontStyle, styles.fontVariant, styles.fontWeight, styles.fontSize, styles.fontFamily].join(
				" "
			);
			textWidth = context.measureText(inputElement.value).width;
		}
		const buttons = Array.from(inputElement.parentElement?.querySelectorAll("button") ?? []);
		return {
			buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
			buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
			clientWidth: inputElement.clientWidth,
			contentWidth:
				inputElement.clientWidth - parsePixels(styles.paddingInlineStart) - parsePixels(styles.paddingInlineEnd),
			scrollWidth: inputElement.scrollWidth,
			textWidth,
		};
	});

	expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
	expect(metrics.contentWidth).toBeGreaterThanOrEqual(metrics.textWidth + 1);
	expect(Math.min(...metrics.buttonHeights)).toBeGreaterThanOrEqual(44);
	expect(Math.max(...metrics.buttonWidths)).toBeLessThanOrEqual(45);
}

async function readNumericFontWeight(input: Locator): Promise<number> {
	const fontWeight = await input.evaluate((element) => window.getComputedStyle(element).fontWeight);
	if (fontWeight === "bold") return 700;
	if (fontWeight === "normal") return 400;
	return Number.parseInt(fontWeight, 10);
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

		// Find the accessible taken-by input field.
		const form = getMedicationEditForm(page);
		const personInput = takenByInput(form);
		await expect(personInput).toBeVisible();

		// Add a person name
		await personInput.fill("Alice");
		await personInput.press("Enter");

		// Tag should appear
		await expect(takenByTag(form, "Alice")).toBeVisible();

		// Add another person
		await personInput.fill("Bob");
		await personInput.press("Enter");
		await expect(takenByTag(form, "Bob")).toBeVisible();

		await saveEditAndVerify(page, "TakenBy Med");

		// Verify tags are persisted
		await clickEditMed(page, "TakenBy Med");
		await expect(takenByTag(getMedicationEditForm(page), "Alice")).toBeVisible();
		await expect(takenByTag(getMedicationEditForm(page), "Bob")).toBeVisible();
	});

	test("should remove a taken-by person from a medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Remove TakenBy Med", takenBy: ["Bob"] }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Remove TakenBy Med");

		// Both persons should appear as tags
		const form = getMedicationEditForm(page);
		const personInput = takenByInput(form);
		await expect(takenByTag(form, "Bob")).toBeVisible({ timeout: 5000 });
		await personInput.fill("Alice");
		await personInput.press("Enter");
		await expect(takenByTag(form, "Alice")).toBeVisible({ timeout: 5000 });

		// Remove the existing Bob tag through its visible tag control.
		await takenByTag(form, "Bob").getByRole("button").click();

		// Alice remains selected after Bob is removed.
		await expect(takenByTag(form, "Alice")).toBeVisible({ timeout: 5000 });
		await expect(takenByTag(form, "Bob")).not.toBeVisible();

		await saveEditAndVerify(page, "Remove TakenBy Med");

		// Verify only Alice remains after save.
		await clickEditMed(page, "Remove TakenBy Med");
		await expect(takenByTag(getMedicationEditForm(page), "Alice")).toBeVisible({ timeout: 5000 });
		await expect(takenByTag(getMedicationEditForm(page), "Bob")).not.toBeVisible();
	});

	test("should add an expiry date to a medication", async ({ page }) => {
		createdMeds.push(await createMedicationViaAPI({ name: "Expiry Date Med" }));
		await navigateTo(page, "/medications");

		await clickEditMed(page, "Expiry Date Med");
		await page.getByRole("tab", { name: /Package/i }).click();

		// Set expiry month with the picker, not by typing into a free-text field.
		const expiryTarget = new Date();
		const expiryDisplayPattern = new RegExp(
			`${String(expiryTarget.getMonth() + 1).padStart(2, "0")}\\D${expiryTarget.getFullYear()}`
		);
		const expiryField = page.getByLabel(/(Expiry Date|form\.expiryDate)/i);
		await expect(expiryField).toHaveAttribute("type", "button");
		await expect(expiryField).toHaveAttribute("data-dates-input", "true");
		await expiryField.click();
		const expiryPicker = page.locator("[data-dates-dropdown]");
		await expect(expiryPicker).toBeVisible();
		await expiryPicker.locator("[data-picker-control]").nth(expiryTarget.getMonth()).click();
		await expect(expiryField).toContainText(expiryDisplayPattern);

		// Also touch the name field to ensure form is dirty
		// Expiry change itself is enough to persist in the current edit flow.

		await saveEditAndVerify(page, "Expiry Date Med");

		// Verify expiry date was saved
		await clickEditMed(page, "Expiry Date Med");
		await expect(page.getByLabel(/(Expiry Date|form\.expiryDate)/i)).toContainText(expiryDisplayPattern);
	});

	test("should keep mobile package stepper values unclipped and consistently weighted", async ({ page }) => {
		const medName = `Mobile Stepper ${Date.now().toString(36)}`;
		await page.setViewportSize({ width: 390, height: 844 });
		createdMeds.push(
			await createMedicationViaAPI({
				name: medName,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 10,
				pillsPerBlister: 10,
			})
		);
		await navigateTo(page, "/medications");

		await clickEditMed(page, medName);
		const modal = page.getByRole("dialog").filter({ hasText: medName }).last();
		await expect(modal).toBeVisible();
		await modal.getByRole("tab", { name: /Package/i }).click();

		const packCount = modal.getByLabel(/(Packs|form\.packCount)/i);
		const blistersPerPack = modal.getByLabel(/(Blisters per pack|form\.blistersPerPack)/i);
		const pillsPerBlister = modal.getByLabel(/(Pills per blister|form\.pillsPerBlister)/i);
		await expect(packCount).toHaveValue("1");
		await expect(blistersPerPack).toHaveValue("10");
		await expect(pillsPerBlister).toHaveValue("10");
		await expectStepperValueToFit(blistersPerPack);
		await expectStepperValueToFit(pillsPerBlister);

		await modal.getByRole("tab", { name: /Schedule/i }).click();
		const usage = modal.getByLabel(/(Usage|form\.blisters\.usage)/i);
		const every = modal.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i);
		await expect(usage).toHaveValue("1");
		await expect(every).toHaveValue("1");

		const stepperWeights = await Promise.all(
			[packCount, blistersPerPack, pillsPerBlister, usage, every].map(readNumericFontWeight)
		);
		expect(new Set(stepperWeights)).toEqual(new Set([600]));
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
		const usageField = page.getByLabel(/(Usage|form\.blisters\.usage)/i);
		const everyField = page.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i);

		await usageField.fill("2");
		await everyField.fill("7");

		await expect(usageField).toHaveValue("2");
		await expect(everyField).toHaveValue("7");

		await saveEditAndVerify(page, "Edit Intake Med");

		// Verify the changes persisted
		await clickEditMed(page, "Edit Intake Med");
		await expect(page.getByLabel(/(Usage|form\.blisters\.usage)/i)).toHaveValue("2");
		await expect(page.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i)).toHaveValue("7");
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
		await expect(page.getByLabel(/(Usage|form\.blisters\.usage)/i)).toHaveCount(1);

		// Add a second intake
		await page.getByTestId("add-intake-button").click();
		await expect(page.getByLabel(/(Usage|form\.blisters\.usage)/i)).toHaveCount(2);

		// Fill the new intake row
		await page
			.getByLabel(/(Usage|form\.blisters\.usage)/i)
			.nth(1)
			.fill("0.5");
		await page
			.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i)
			.nth(1)
			.fill("7");

		await saveEditAndVerify(page, "Add Intake Med");

		// Verify 2 intakes persisted
		await clickEditMed(page, "Add Intake Med");
		await expect(page.getByLabel(/(Usage|form\.blisters\.usage)/i)).toHaveCount(2, { timeout: 10000 });
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
		const remindCheckbox = intakeReminderCheckbox(getMedicationEditForm(page));

		await expect(remindCheckbox).not.toBeChecked();
		await remindCheckbox.check();
		await expect(remindCheckbox).toBeChecked();

		await saveEditAndVerify(page, "Reminder Toggle Med");

		// Verify reminder was saved
		await clickEditMed(page, "Reminder Toggle Med");
		await page.getByRole("tab", { name: /Schedule/i }).click();
		const savedCheckbox = intakeReminderCheckbox(getMedicationEditForm(page));
		await expect(savedCheckbox).toBeChecked();
	});

	for (const scenario of [
		{
			name: "Inhaler Reminder Refill Med",
			packageType: "inhaler" as const,
			totalCapacity: 200,
			currentStock: 120,
			refillAmount: 30,
			expectedStock: 150,
			unitLabel: /puffs?|common\.puffs?/i,
		},
		{
			name: "Injection Reminder Refill Med",
			packageType: "injection" as const,
			totalCapacity: 12,
			currentStock: 4,
			refillAmount: 3,
			expectedStock: 7,
			unitLabel: /injections?|common\.injections?/i,
		},
	]) {
		test(`should persist reminders and refill ${scenario.packageType} stock without drift`, async ({ page }) => {
			createdMeds.push(
				await createMedicationViaAPI({
					name: scenario.name,
					packageType: scenario.packageType,
					totalPills: scenario.totalCapacity,
					looseTablets: scenario.currentStock,
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
			await clickEditMed(page, scenario.name);
			await page.getByRole("tab", { name: /Schedule/i }).click();

			const remindCheckbox = intakeReminderCheckbox(getMedicationEditForm(page));
			await expect(remindCheckbox).not.toBeChecked();
			await remindCheckbox.check();
			await expect(remindCheckbox).toBeChecked();

			await saveEditAndVerify(page, scenario.name);

			await clickEditMed(page, scenario.name);
			await page.getByRole("tab", { name: /Schedule/i }).click();
			await expect(intakeReminderCheckbox(getMedicationEditForm(page))).toBeChecked();

			await navigateTo(page, "/dashboard");
			const modal = await openMedicationDetailFromDashboard(page, scenario.name);

			await modal.getByRole("button", { name: /Refill|refill\.button/i }).click();
			const refillModal = page
				.getByRole("dialog")
				.filter({ has: page.getByRole("heading", { name: /^(Refill|refill\.title)$/i }) })
				.last();
			await expect(refillModal).toBeVisible({ timeout: 5000 });
			const refillInput = refillModal.locator('input[type="number"]').first();
			await refillInput.fill(String(scenario.refillAmount));
			const refillPreview = refillModal
				.getByText(new RegExp(`\\+${scenario.refillAmount}`))
				.filter({ hasText: scenario.unitLabel })
				.first();
			await expect(refillPreview).toBeVisible();

			await refillModal.getByRole("button", { name: /Refill|refill\.button/i }).click();
			await expect(refillModal).not.toBeVisible({ timeout: 10000 });
			await expect(modal).toContainText(`${scenario.expectedStock} / ${scenario.totalCapacity}`, { timeout: 10000 });

			const refillHistoryHeader = modal.getByRole("heading", { name: /Refill History|refill\.history/i });
			await expect(refillHistoryHeader).toBeVisible({ timeout: 10000 });
			await refillHistoryHeader.click();
			const refillAmount = modal
				.getByText(new RegExp(`\\+${scenario.refillAmount}`))
				.filter({ hasText: scenario.unitLabel })
				.first();
			await expect(refillAmount).toBeVisible();

			await modal.getByLabel(/Close|common\.close/i).click();
			await expect(modal).not.toBeVisible({ timeout: 5000 });

			await navigateTo(page, "/medications");
			const medRow = page.getByTestId("medication-row").filter({ hasText: scenario.name });
			await expect(medRow).toContainText(`${scenario.expectedStock} / ${scenario.totalCapacity}`);
		});
	}

	test("should change package type across all supported profiles", async ({ page }) => {
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
		const form = getMedicationEditForm(page);

		// Should be blister type initially
		const packageSelect = form.getByLabel(/(Package Type|form\.packageType)/i);
		await expect(packageSelect).toHaveValue("blister");

		// Blister-specific fields are shown in the Package tab.
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Blisters per pack|form\.blistersPerPack)/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to bottle
		await packageSelect.selectOption("bottle");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(pills\))/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to tube
		await packageSelect.selectOption("tube");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Amount per tube|form\.packageAmountPerTube)/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to liquid container and persist this final state
		await packageSelect.selectOption("liquid_container");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(form.getByLabel(/(Package amount|form\.packageAmount)/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to inhaler
		await packageSelect.selectOption("inhaler");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(
			form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(count\)|form\.totalCount)/i)
		).toBeVisible();
		await expect(form.getByLabel(/(Current Stock|form\.currentStockCount)/i)).toBeVisible();
		await page.getByRole("tab", { name: /General/i }).click();

		// Switch to injection and persist this final state
		await packageSelect.selectOption("injection");
		await page.getByRole("tab", { name: /Package/i }).click();
		await expect(
			form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(count\)|form\.totalCount)/i)
		).toBeVisible();
		await expect(form.getByLabel(/(Current Stock|form\.currentStockCount)/i)).toBeVisible();

		await saveEditAndVerify(page, "PackType Change Med");

		// Verify final package type persisted
		await clickEditMed(page, "PackType Change Med");
		const editedForm = getMedicationEditForm(page);
		await expect(editedForm.getByLabel(/(Package Type|form\.packageType)/i)).toHaveValue("injection");
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
		const form = getMedicationEditForm(page);
		const personInput = takenByInput(form);
		await personInput.fill("Charlie");
		await personInput.press("Enter");
		await expect(takenByTag(form, "Charlie")).toBeVisible();

		await saveEditAndVerify(page, "Fully Edited Med");

		// Verify all changes persisted
		await clickEditMed(page, "Fully Edited Med");
		await expect(page.getByLabel(/(Commercial Name|form\.commercialName)/i)).toHaveValue("Fully Edited Med");
		await expect(page.getByLabel(/(Generic Name|form\.genericName)/i)).toHaveValue("Ibuprofen Lysinate");
		await expect(page.getByLabel(/(Notes|form\.notes)/i)).toContainText("Morning dose only");
		await expect(takenByTag(getMedicationEditForm(page), "Charlie")).toBeVisible();
	});
});
