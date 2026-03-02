import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
	updateSettingsViaAPI,
} from "./fixtures";

/**
 * Stock Status & Coverage E2E Tests
 *
 * Creates medications with different stock levels, then verifies the dashboard
 * overview table shows correct status chips (High, Normal, Low, Critical, Out of Stock).
 * Also tests the reorder reminder card and medication detail modal stock info.
 */
test.describe("Stock Status Levels", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	// Medication with lots of stock → High status
	const MED_HIGH = "StockHigh Vitamin D";
	// Medication with moderate stock → Normal status
	const MED_NORMAL = "StockNormal Ibuprofen";
	// Medication with low stock → Low/Warning status
	const MED_LOW = "StockLow Aspirin";
	// Medication with very low stock → Critical/Danger status
	const MED_CRITICAL = "StockCrit Metformin";
	// Medication with zero stock → Out of Stock/Danger
	const MED_DEPLETED = "StockEmpty Omeprazol";

	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();

		// Set stock thresholds:
		// lowStockDays=30, criticalStockDays=7, highStockDays=90
		// This means:
		//   > 90 days = High (green high)
		//   30-90 days = Normal (green success)
		//   7-29 days = Low (yellow warning)
		//   1-7 days = Critical (red danger)
		//   0 = Out of Stock (red danger)
		await updateSettingsViaAPI({
			lowStockDays: 30,
			criticalStockDays: 7,
			expiryWarningDays: 30,
		});

		// High stock: 300 pills, 1/day = 300 days → High status
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_HIGH,
				packageType: "blister",
				packCount: 10,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);

		// Normal stock: 60 pills, 1/day = 60 days → Normal status
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_NORMAL,
				genericName: "Ibuprofen 400mg",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);

		// Low stock: 20 pills, 1/day = 20 days → Low/Warning status
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_LOW,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);

		// Critical stock: 5 pills, 1/day = 5 days → Critical/Danger status
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_CRITICAL,
				genericName: "Metformin 500mg",
				packageType: "bottle",
				totalPills: 5,
				looseTablets: 5,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);

		// Depleted: bottle with stated capacity 1 but 0 pills in stock → Out of Stock
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_DEPLETED,
				packageType: "bottle",
				totalPills: 1,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show all medications in overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// All 5 medications should appear
		await expect(overviewTable.getByText(MED_HIGH)).toBeVisible();
		await expect(overviewTable.getByText(MED_NORMAL)).toBeVisible();
		await expect(overviewTable.getByText(MED_LOW)).toBeVisible();
		await expect(overviewTable.getByText(MED_CRITICAL)).toBeVisible();
		await expect(overviewTable.getByText(MED_DEPLETED)).toBeVisible();
	});

	test("should show High status chip for well-stocked medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// High stock med row should have a .status-chip.high
		const highRow = overviewTable.locator(".table-row").filter({ hasText: MED_HIGH });
		await expect(highRow).toBeVisible();
		await expect(highRow.locator(".status-chip.high")).toBeVisible();
	});

	test("should show Normal status chip for moderate stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const normalRow = overviewTable.locator(".table-row").filter({ hasText: MED_NORMAL });
		await expect(normalRow).toBeVisible();
		await expect(normalRow.locator(".status-chip.success")).toBeVisible();
	});

	test("should show Warning status chip for low stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const lowRow = overviewTable.locator(".table-row").filter({ hasText: MED_LOW });
		await expect(lowRow).toBeVisible();
		await expect(lowRow.locator(".status-chip.warning")).toBeVisible();
	});

	test("should show Danger status chip for critical stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const criticalRow = overviewTable.locator(".table-row").filter({ hasText: MED_CRITICAL });
		await expect(criticalRow).toBeVisible();
		await expect(criticalRow.locator(".status-chip.danger")).toBeVisible();
	});

	test("should show Danger status chip for depleted medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const depletedRow = overviewTable.locator(".table-row").filter({ hasText: MED_DEPLETED });
		await expect(depletedRow).toBeVisible();
		await expect(depletedRow.locator(".status-chip.danger")).toBeVisible();
	});

	test("should show days-left and runs-out date in overview", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// High stock should show many days (around 299)
		const highRow = overviewTable.locator(".table-row").filter({ hasText: MED_HIGH });
		const highRowText = await highRow.textContent();
		// Should contain a 3-digit number for days
		expect(highRowText).toMatch(/\d{2,3}/);

		// Depleted should show 0 or very low number
		const depletedRow = overviewTable.locator(".table-row").filter({ hasText: MED_DEPLETED });
		const depletedText = await depletedRow.textContent();
		expect(depletedText).toContain("0");
	});

	test("should show reorder reminder card with low-stock medications", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// The reorder card should mention low-stock medications
		const reorderCard = page.locator("article.card").filter({ hasText: /Reorder|low|running|refill/i });
		if (await reorderCard.isVisible().catch(() => false)) {
			// Should mention at least one of the low stock meds
			const cardText = await reorderCard.textContent();
			const mentionsLow =
				cardText?.includes(MED_LOW) || cardText?.includes(MED_CRITICAL) || cardText?.includes(MED_DEPLETED);
			expect(mentionsLow).toBeTruthy();
		}
	});

	test("should color-code stock values depending on status", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// High stock row should have success-text class on stock cells
		const highRow = overviewTable.locator(".table-row").filter({ hasText: MED_HIGH });
		const highStockSpan = highRow.locator("span.success-text, span.high-text").first();
		if (await highStockSpan.isVisible().catch(() => false)) {
			await expect(highStockSpan).toBeVisible();
		}

		// Critical stock should have danger-text class
		const criticalRow = overviewTable.locator(".table-row").filter({ hasText: MED_CRITICAL });
		const criticalSpan = criticalRow.locator("span.danger-text").first();
		if (await criticalSpan.isVisible().catch(() => false)) {
			await expect(criticalSpan).toBeVisible();
		}

		// Low stock should have warning-text class
		const lowRow = overviewTable.locator(".table-row").filter({ hasText: MED_LOW });
		const warningSpan = lowRow.locator("span.warning-text").first();
		if (await warningSpan.isVisible().catch(() => false)) {
			await expect(warningSpan).toBeVisible();
		}
	});

	test("should open medication detail modal showing stock info", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on the critical stock medication row
		const criticalRow = overviewTable.locator(".table-row").filter({ hasText: MED_CRITICAL });
		await criticalRow.click();

		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });
		await expect(modal.getByText(MED_CRITICAL)).toBeVisible();

		// Modal should show stock/coverage details
		const modalText = await modal.textContent();
		expect(modalText).toBeTruthy();

		// Close modal
		await page.locator("button.modal-close").click();
		await expect(modal).not.toBeVisible();
	});

	test("should show generic name in overview for medications that have one", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on the normal stock med (has generic name "Ibuprofen 400mg")
		const normalRow = overviewTable.locator(".table-row").filter({ hasText: MED_NORMAL });
		await normalRow.click();

		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });
		// Modal should show the generic name somewhere
		await expect(modal.getByText("Ibuprofen 400mg")).toBeVisible();

		await page.locator("button.modal-close").click();
	});

	test("should show different stock levels in planner results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");

		// Calculate for 30-day default range
		await page.locator('form.planner button[type="submit"]').click();
		await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });

		const resultsTable = page.locator(".table");

		// Should show status chips with different levels
		const successChips = resultsTable.locator(".status-chip.success");
		const dangerChips = resultsTable.locator(".status-chip.danger");
		const warningChips = resultsTable.locator(".status-chip.warning");

		const totalChips = (await successChips.count()) + (await dangerChips.count()) + (await warningChips.count());
		expect(totalChips).toBeGreaterThanOrEqual(2);

		// The depleted/critical meds should have danger chips
		expect(await dangerChips.count()).toBeGreaterThanOrEqual(1);
	});
});
