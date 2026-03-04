import type { Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	deleteMedicationViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

/**
 * Medication CRUD E2E Tests
 *
 * Tests creating, editing, and deleting medications via the UI form.
 * Each test cleans up after itself to avoid side effects.
 */

/**
 * Helper: fill the medication form and save.  Waits for the successful
 * API response and verifies the medication appears in the list.
 */
async function fillAndSaveMedication(
	page: Page,
	opts: {
		name: string;
		genericName?: string;
		packageType?: "blister" | "bottle" | "tube" | "liquid_container";
		packs?: string;
		blistersPerPack?: string;
		pillsPerBlister?: string;
		loosePills?: string;
		totalCapacity?: string;
		currentPills?: string;
		expiryDate?: string;
		notes?: string;
		intakes?: { usage: string; every: string }[];
	}
): Promise<void> {
	const openCreateBtn = page.getByRole("button", { name: /New medication|New entry|form\.newEntry/i }).first();
	if (await openCreateBtn.isVisible().catch(() => false)) {
		await openCreateBtn.click();
	}
	const form = page.locator("form.form-grid:visible").first();
	await expect(form.getByLabel(/(Commercial Name|form\.commercialName)/i)).toBeVisible({ timeout: 10000 });
	await form.getByLabel(/(Commercial Name|form\.commercialName)/i).fill(opts.name);
	if (opts.genericName) {
		await form.getByLabel(/(Generic Name|form\.genericName)/i).fill(opts.genericName);
	}

	const packageTypeSelect = form.locator("select.package-type-select");
	if (opts.packageType === "bottle") {
		await packageTypeSelect.selectOption("bottle");
		await page.getByRole("tab", { name: /Package/i }).click();
		if (opts.totalCapacity)
			await form.getByLabel(/(Total Capacity|form\.totalCapacity|Total \(pills\))/i).fill(opts.totalCapacity);
		if (opts.currentPills) await form.getByLabel(/(Current Pills|form\.currentPills)/i).fill(opts.currentPills);
	} else if (opts.packageType === "tube") {
		await packageTypeSelect.selectOption("tube");
		await page.getByRole("tab", { name: /Package/i }).click();
		if (opts.totalCapacity) {
			await form.getByLabel(/(Amount per tube|form\.packageAmountPerTube)/i).fill(opts.totalCapacity);
		}
	} else if (opts.packageType === "liquid_container") {
		await packageTypeSelect.selectOption("liquid_container");
		await page.getByRole("tab", { name: /Package/i }).click();
		if (opts.totalCapacity) {
			await form.getByLabel(/(Package amount|form\.packageAmount)/i).fill(opts.totalCapacity);
		}
	} else {
		await packageTypeSelect.selectOption("blister");
		await page.getByRole("tab", { name: /Package/i }).click();
		if (opts.packs) await form.getByLabel(/(^Packs$|form\.packs)/i).fill(opts.packs);
		if (opts.blistersPerPack)
			await form.getByLabel(/(Blisters per pack|form\.blistersPerPack)/i).fill(opts.blistersPerPack);
		if (opts.pillsPerBlister)
			await form.getByLabel(/(Pills per blister|form\.pillsPerBlister)/i).fill(opts.pillsPerBlister);
		if (opts.loosePills) {
			const looseField = form.getByLabel(/(Loose pills|form\.loosePills)/i);
			if (await looseField.isVisible().catch(() => false)) {
				await looseField.fill(opts.loosePills);
			}
		}
	}

	if (opts.expiryDate) await form.getByLabel(/(Expiry Date|form\.expiryDate)/i).fill(opts.expiryDate);
	if (opts.notes) await form.getByLabel(/(Notes|form\.notes)/i).fill(opts.notes);

	// Fill intake schedules
	const intakes = opts.intakes ?? [{ usage: "1", every: "1" }];
	await page.getByRole("tab", { name: /Schedule/i }).click();
	for (let i = 0; i < intakes.length; i++) {
		if (i > 0) {
			await form.getByRole("button", { name: /(Intake|form\.blisters\.addIntake)/i }).click();
		}
		const row = form.locator(".blister-row").nth(i);
		await row
			.getByLabel(/(Usage \((pills|tablets|capsules|ml|applications)\)|form\.blisters\.(usage|usageTablets|usageCapsules|usageMl|usageApplication))/i)
			.fill(intakes[i].usage);
		await row.getByLabel(/(Every \(days\)|form\.blisters\.everyDays)/i).fill(intakes[i].every);
	}

	await page.waitForLoadState("networkidle");
	await form.locator("button[type='submit']").click();

	// Verify the medication appears in the list (may need reload if GET was rate-limited)
	const medRow = page.locator(".med-row").filter({ hasText: opts.name });
	try {
		await expect(medRow).toBeVisible({ timeout: 5000 });
	} catch {
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(medRow).toBeVisible({ timeout: 10000 });
	}
}

/**
 * Helper: save after editing (PUT) and wait for success.
 */
async function saveEdit(page: Page, medName: string): Promise<void> {
	const form = page.locator("form.form-grid:visible").first();
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
	// Wait for the list to update with the new name — retry with reload if rate-limited
	const medRow = page.locator(".med-row").filter({ hasText: medName });
	try {
		await expect(medRow).toBeVisible({ timeout: 15000 });
	} catch {
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(medRow).toBeVisible({ timeout: 10000 });
	}
}

test.describe("Medication CRUD", () => {
	test.use({ storageState: authFile });

	// Clean up any leftover medications before and after all tests
	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
	});
	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test.describe("Create medication", () => {
		// Clean up after each create test to avoid state leakage to later test blocks
		test.afterEach(async () => {
			await deleteAllMedicationsViaAPI();
		});

		test("should create a blister-pack medication via the form", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Ibuprofen",
				genericName: "Ibuprofen",
				packageType: "blister",
				packs: "2",
				blistersPerPack: "3",
				pillsPerBlister: "10",
				loosePills: "5",
			});

			// Verify medication details in the list
			const medRow = page.locator(".med-row").filter({ hasText: "Test Ibuprofen" });
			await expect(medRow.locator(".med-name")).toContainText("Test Ibuprofen");
		});

		test("should create a bottle medication via the form", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Vitamin D Drops",
				packageType: "bottle",
				totalCapacity: "60",
				currentPills: "45",
			});
		});

		test("should create medication with multiple intake schedules", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Multi-Intake Med",
				packs: "1",
				blistersPerPack: "2",
				pillsPerBlister: "14",
				intakes: [
					{ usage: "1", every: "1" },
					{ usage: "0.5", every: "7" },
				],
			});
		});

		test("should create a tube medication via the form", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Tube Cream",
				packageType: "tube",
				totalCapacity: "50",
			});
		});

		test("should create a liquid-container medication via the form", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Liquid Syrup",
				packageType: "liquid_container",
				totalCapacity: "120",
			});
		});

		test("should create medication with notes and expiry date", async ({ page }) => {
			await navigateTo(page, "/medications");

			const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
			await fillAndSaveMedication(page, {
				name: "Test Aspirin",
				packs: "1",
				blistersPerPack: "1",
				pillsPerBlister: "20",
				expiryDate,
				notes: "Take with food. Do not exceed 3 per day.",
			});
		});

		test("should not save with empty commercial name", async ({ page }) => {
			await navigateTo(page, "/medications");
			await page
				.getByRole("button", { name: /New medication|New entry|form\.newEntry/i })
				.first()
				.click();

			// Saving without name should not create a medication row.
			const saveBtn = page.locator("form.form-grid button[type='submit']");
			await expect(saveBtn).toBeVisible();
			await saveBtn.click();
			await expect(page.locator(".med-row")).toHaveCount(0);
		});

		test("should reset form after saving a medication", async ({ page }) => {
			await navigateTo(page, "/medications");

			await fillAndSaveMedication(page, {
				name: "Test Reset Check",
				packs: "1",
				blistersPerPack: "1",
				pillsPerBlister: "10",
			});

			// Opening a fresh form after save should start with an empty commercial name.
			await page
				.getByRole("button", { name: /New medication|New entry|form\.newEntry/i })
				.first()
				.click();
			await expect(page.getByLabel(/(Commercial Name|form\.commercialName)/i)).toHaveValue("");
		});
	});

	test.describe("Edit medication", () => {
		test.describe.configure({ timeout: 60000 });
		const createdMeds: TestMedication[] = [];

		test.afterEach(async () => {
			for (const med of createdMeds) {
				await deleteMedicationViaAPI(med.id);
			}
			createdMeds.length = 0;
		});

		test("should edit an existing medication", async ({ page }) => {
			// Create prerequisite via API (faster, no rate-limit issues)
			createdMeds.push(await createMedicationViaAPI({ name: "Before Edit" }));
			await navigateTo(page, "/medications");

			// Click Edit
			const medRow = page.locator(".med-row").filter({ hasText: "Before Edit" });
			await expect(medRow).toBeVisible({ timeout: 10000 });
			await medRow.locator("button.info").click();

			// Form title should say "Edit entry" (or legacy "Edit medication").
			await expect(
				page.locator("h2").filter({ hasText: /(Edit(:| (entry|medication))|form\.editEntry)/i })
			).toBeVisible();

			// The name field should have the current value
			await expect(page.getByLabel(/(Commercial Name|form\.commercialName)/i)).toHaveValue("Before Edit");

			// Change the name
			await page.getByLabel(/(Commercial Name|form\.commercialName)/i).fill("After Edit");

			// Save the edit
			await saveEdit(page, "After Edit");

			// Old name should no longer appear
			await expect(page.locator(".med-row").filter({ hasText: "Before Edit" })).not.toBeVisible();

			// Update tracked ID for cleanup
			createdMeds[0].name = "After Edit";
		});

		test("should cancel editing and discard changes", async ({ page }) => {
			createdMeds.push(await createMedicationViaAPI({ name: "Cancel Test Med" }));
			await navigateTo(page, "/medications");

			// Click Edit
			const medRow = page.locator(".med-row").filter({ hasText: "Cancel Test Med" });
			await expect(medRow).toBeVisible({ timeout: 10000 });
			await medRow.locator("button.info").click();

			// Change the name
			await page.getByLabel(/(Commercial Name|form\.commercialName)/i).fill("Modified Name");

			// Click Cancel
			await page
				.getByRole("button", { name: /Close|Cancel/i })
				.first()
				.click();

			// Original name should still be in the list
			await expect(page.locator(".med-row").filter({ hasText: "Cancel Test Med" })).toBeVisible();
		});
	});

	test.describe("Delete medication", () => {
		test.describe.configure({ timeout: 60000 });
		const createdMeds: TestMedication[] = [];

		test.afterEach(async () => {
			for (const med of createdMeds) {
				await deleteMedicationViaAPI(med.id);
			}
			createdMeds.length = 0;
		});

		test("should delete a medication after confirming", async ({ page }) => {
			createdMeds.push(await createMedicationViaAPI({ name: "Delete Me Med" }));
			await navigateTo(page, "/medications");

			const medRow = page.locator(".med-row").filter({ hasText: "Delete Me Med" });
			await expect(medRow).toBeVisible({ timeout: 10000 });

			await medRow.locator("button.danger").click();
			await page
				.locator(".confirm-modal-overlay, .modal-overlay")
				.getByRole("button", { name: /Delete/i })
				.click();

			// Medication should be removed
			await expect(medRow).toHaveCount(0, { timeout: 10000 });

			// Already deleted via UI — clear tracked list
			createdMeds.length = 0;
		});

		test("should not delete when confirm dialog is dismissed", async ({ page }) => {
			createdMeds.push(await createMedicationViaAPI({ name: "Keep Me Med" }));
			await navigateTo(page, "/medications");

			const medRow = page.locator(".med-row").filter({ hasText: "Keep Me Med" });
			await expect(medRow).toBeVisible({ timeout: 10000 });

			// Dismiss the native confirm()
			page.on("dialog", (dialog) => dialog.dismiss());
			await medRow.locator("button.danger").click();

			// Medication should still be there
			await expect(medRow).toBeVisible();
		});
	});

	test.describe("Medication list", () => {
		test.describe.configure({ timeout: 60000 });
		const createdMeds: TestMedication[] = [];

		test.afterEach(async () => {
			for (const med of createdMeds) {
				await deleteMedicationViaAPI(med.id);
			}
			createdMeds.length = 0;
		});

		test("should display multiple medications in the list", async ({ page }) => {
			createdMeds.push(await createMedicationViaAPI({ name: "Med Alpha" }));
			createdMeds.push(
				await createMedicationViaAPI({
					name: "Med Beta",
					packCount: 2,
					blistersPerPack: 2,
					pillsPerBlister: 14,
					intakes: [
						{ usage: 2, every: 1, start: new Date().toISOString().slice(0, 16), intakeRemindersEnabled: false },
					],
				})
			);
			await navigateTo(page, "/medications");

			// Both medications should be in the list
			await expect(page.locator(".med-row").filter({ hasText: "Med Alpha" })).toBeVisible({ timeout: 10000 });
			await expect(page.locator(".med-row").filter({ hasText: "Med Beta" })).toBeVisible();
			expect(await page.locator(".med-row").count()).toBeGreaterThanOrEqual(2);
		});

		test("should show stock details on medication row", async ({ page }) => {
			createdMeds.push(
				await createMedicationViaAPI({
					name: "Stock Detail Med",
					packCount: 3,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					looseTablets: 3,
				})
			);
			await navigateTo(page, "/medications");

			const medRow = page.locator(".med-row").filter({ hasText: "Stock Detail Med" });
			try {
				await expect(medRow).toBeVisible({ timeout: 10000 });
			} catch {
				// Reload in case the list didn't include the newly created med
				await page.reload();
				await page.waitForLoadState("networkidle");
				await expect(medRow).toBeVisible({ timeout: 10000 });
			}

			// Should display stock details
			const medDetails = medRow.locator(".med-details, .med-total");
			expect(await medDetails.count()).toBeGreaterThan(0);
		});
	});

	test.describe("Intake schedule management", () => {
		test("should add and remove intake schedule rows", async ({ page }) => {
			await navigateTo(page, "/medications");
			await page
				.getByRole("button", { name: /New medication|New entry|form\.newEntry/i })
				.first()
				.click();
			await page.getByRole("tab", { name: /Schedule/i }).click();
			const form = page.locator("form.form-grid:visible").first();

			expect(await form.locator(".blister-row").count()).toBe(1);

			await form.getByRole("button", { name: /(Intake|form\.blisters\.addIntake)/i }).click();
			expect(await form.locator(".blister-row").count()).toBe(2);

			await form.getByRole("button", { name: /(Intake|form\.blisters\.addIntake)/i }).click();
			expect(await form.locator(".blister-row").count()).toBe(3);

			const removeBtn = page
				.locator("form.form-grid:visible .blister-row")
				.last()
				.getByRole("button", { name: /Remove/i });
			await removeBtn.click();
			expect(await form.locator(".blister-row").count()).toBe(2);
		});
	});
});
