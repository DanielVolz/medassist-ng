import type { Locator, Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

function getMedicationRow(page: Page, medicationName: string): Locator {
	return page.getByTestId("medication-row").filter({ hasText: medicationName });
}

function getMedicationEditForm(page: Page): Locator {
	return page
		.locator("form")
		.filter({ has: page.getByRole("button", { name: /Save|common\.save/i }) })
		.first();
}

async function calculatePlanner(page: Page): Promise<Locator> {
	const plannerForm = page.getByTestId("planner-form");
	await plannerForm.getByRole("button", { name: /Calculate|Berechnen|planner\.calculate/i }).click();
	return page.getByTestId("planner-results-table");
}

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
		await expect(getMedicationRow(page, MED_NAME)).toBeVisible({ timeout: 10000 });

		// Step 3: Verify in planner
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");
		const plannerResults = await calculatePlanner(page);
		await expect(plannerResults).toBeVisible({ timeout: 15000 });
		await expect(plannerResults.getByTestId("planner-result-row").filter({ hasText: MED_NAME })).toBeVisible();

		// Step 4: Verify in schedule
		await navigateTo(page, "/schedule");
		await expect(
			page.locator(".schedule-full").getByRole("heading", { name: /Schedule|dashboard\.schedules\.title/i })
		).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByText(MED_NAME, { exact: true }).first()).toBeVisible({ timeout: 10000 });
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
		await expect(getMedicationRow(page, MED_NAME)).toBeVisible({ timeout: 10000 });

		// Open edit view from medication row actions
		const medRow = getMedicationRow(page, MED_NAME);
		await expect(medRow).toBeVisible({ timeout: 10000 });
		await medRow.getByRole("button", { name: /Edit|common\.edit/i }).click();
		await expect(page.getByRole("heading", { name: /(Edit(:| (entry|medication))|form\.editEntry)/i })).toBeVisible({
			timeout: 5000,
		});

		// Update the name
		const form = getMedicationEditForm(page);
		const nameInput = form.getByLabel(/(Commercial Name|Name|form\.name)/i).first();
		await nameInput.fill(MED_EDITED);

		// Save
		const submitButton = form.getByRole("button", { name: /Save|common\.save/i });
		await expect(submitButton).toBeEnabled({ timeout: 5000 });
		await submitButton.click();

		// Wait for modal to close or save to complete
		await page.waitForLoadState("networkidle");

		// Verify edited name appears on medications page
		await navigateTo(page, "/medications");
		await expect(getMedicationRow(page, MED_EDITED)).toBeVisible({ timeout: 10000 });
		// Old name should no longer appear
		await expect(getMedicationRow(page, MED_NAME)).toHaveCount(0, { timeout: 5000 });
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
		await expect(getMedicationRow(page, MED_NAME)).toBeVisible({ timeout: 10000 });

		// Delete via API
		await deleteAllMedicationsViaAPI();

		// Verify gone from medications page
		await navigateTo(page, "/medications");
		await expect(getMedicationRow(page, MED_NAME)).toHaveCount(0, { timeout: 5000 });

		// Verify planner shows no results for this med
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");
		const plannerResults = await calculatePlanner(page);
		// Either no table or table without the medication name
		if (await plannerResults.isVisible().catch(() => false)) {
			await expect(plannerResults.getByTestId("planner-result-row").filter({ hasText: MED_NAME })).toHaveCount(0);
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
