import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

/**
 * Medication Lifecycle Integration Tests
 *
 * End-to-end workflows that verify changes propagate across pages:
 * create → verify on medications → check in planner → check in schedule → edit → delete
 */
test.describe("Medication lifecycle", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	const MED_NAME = "Lifecycle TestMed";
	const MED_EDITED = "Lifecycle Edited";

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("create medication via API and verify it appears on all pages", async ({ page }) => {
		const todayMorning = (() => {
			const d = new Date();
			d.setHours(8, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		// Step 1: Create medication
		const created = await createMedicationViaAPI({
			name: MED_NAME,
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 0,
			intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
		});
		expect(created.id).toBeTruthy();

		// Step 2: Verify on medications page
		await navigateTo(page, "/medications");
		await expect(page.getByText(MED_NAME).first()).toBeVisible({ timeout: 10000 });

		// Step 3: Verify in planner
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");
		await page.locator('form.planner button[type="submit"]').click();
		await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });
		await expect(page.locator(".table").getByText(MED_NAME)).toBeVisible();

		// Step 4: Verify in schedule
		await navigateTo(page, "/schedule");
		await expect(page.getByText(MED_NAME).first()).toBeVisible({ timeout: 10000 });
	});

	test("edit medication name via UI and verify update propagates", async ({ page }) => {
		await deleteAllMedicationsViaAPI();

		const todayMorning = (() => {
			const d = new Date();
			d.setHours(8, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		// Create a fresh medication for this test
		await createMedicationViaAPI({
			name: MED_NAME,
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 0,
			intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
		});

		// Navigate to medications page
		await navigateTo(page, "/medications");
		await expect(page.getByText(MED_NAME).first()).toBeVisible({ timeout: 10000 });

		// Open edit view from medication row actions
		const medRow = page.locator(".med-row").filter({ hasText: MED_NAME });
		await expect(medRow.first()).toBeVisible({ timeout: 10000 });
		await medRow.first().locator("button.info").click();
		await expect(page.locator("h2").filter({ hasText: /(Edit(:| (entry|medication))|form\.editEntry)/i })).toBeVisible({
			timeout: 5000,
		});

		// Update the name
		const form = page.locator("form.form-grid:visible").first();
		const nameInput = form.getByLabel(/(Commercial Name|Name|form\.name)/i).first();
		await nameInput.fill(MED_EDITED);

		// Save
		const submitButton = form.locator('button[type="submit"]').first();
		await expect(submitButton).toBeEnabled({ timeout: 5000 });
		await submitButton.click();

		// Wait for modal to close or save to complete
		await page.waitForLoadState("networkidle");

		// Verify edited name appears on medications page
		await navigateTo(page, "/medications");
		await expect(page.getByText(MED_EDITED).first()).toBeVisible({ timeout: 10000 });
		// Old name should no longer appear
		await expect(page.locator(".med-row").filter({ hasText: MED_NAME })).toHaveCount(0, { timeout: 5000 });
	});

	test("delete medication via API and verify it disappears from all pages", async ({ page }) => {
		const todayMorning = (() => {
			const d = new Date();
			d.setHours(8, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		// Create and then delete
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: MED_NAME,
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 5,
			looseTablets: 0,
			intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
		});

		// Verify it exists first
		await navigateTo(page, "/medications");
		await expect(page.getByText(MED_NAME)).toBeVisible({ timeout: 10000 });

		// Delete via API
		await deleteAllMedicationsViaAPI();

		// Verify gone from medications page
		await navigateTo(page, "/medications");
		await expect(page.getByText(MED_NAME)).not.toBeVisible({ timeout: 5000 });

		// Verify planner shows no results for this med
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");
		await page.locator('form.planner button[type="submit"]').click();
		// Either no table or table without the medication name
		const table = page.locator(".table");
		const tableVisible = await table.isVisible().catch(() => false);
		if (tableVisible) {
			await expect(table.getByText(MED_NAME)).not.toBeVisible({ timeout: 3000 });
		}
	});

	test("medication with multiple intakes shows all schedule entries", async ({ page }) => {
		const todayMorning = (() => {
			const d = new Date();
			d.setHours(8, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		const todayEvening = (() => {
			const d = new Date();
			d.setHours(20, 0, 0, 0);
			const pad = (n: number) => n.toString().padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		})();

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: "MultiIntake Med",
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 0,
			intakes: [
				{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false },
				{ usage: 2, every: 1, start: todayEvening, intakeRemindersEnabled: false },
			],
		});

		// Verify schedule shows this medication
		await navigateTo(page, "/schedule");
		await expect(page.getByText("MultiIntake Med").first()).toBeVisible({ timeout: 10000 });

		// The medication should appear at least twice (morning + evening)
		const medEntries = page.getByText("MultiIntake Med");
		expect(await medEntries.count()).toBeGreaterThanOrEqual(2);
	});
});
