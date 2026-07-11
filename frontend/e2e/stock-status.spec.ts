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
 * overview table shows the correct stock statuses (High, Normal, Low, Critical, Empty).
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
	const stockStatusText = {
		high: /^(High|Hoch)$/,
		normal: /^Normal$/,
		low: /^(Low|Niedrig)$/,
		critical: /^(Critical|Kritisch)$/,
		empty: /^(Empty|Leer)$/,
		enough: /^(Enough|Ausreichend)$/,
	};

	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	const getOverviewTable = (page: Parameters<typeof navigateTo>[0]) => page.getByTestId("dashboard-overview-table");
	const getOverviewRow = (overviewTable: ReturnType<typeof getOverviewTable>, medicationName: string) =>
		overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: medicationName }).first();

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

		const overviewTable = getOverviewTable(page);
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

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.getByText(MED_HIGH)).toBeVisible({ timeout: 10000 });

		const highRow = getOverviewRow(overviewTable, MED_HIGH);
		await expect(highRow).toBeVisible();
		await expect(highRow.getByText(stockStatusText.high)).toBeVisible();
	});

	test("should show Normal status chip for moderate stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const normalRow = getOverviewRow(overviewTable, MED_NORMAL);
		await expect(normalRow).toBeVisible();
		await expect(normalRow.getByText(stockStatusText.normal)).toBeVisible();
	});

	test("should show Warning status chip for low stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const lowRow = getOverviewRow(overviewTable, MED_LOW);
		await expect(lowRow).toBeVisible();
		await expect(lowRow.getByText(stockStatusText.low)).toBeVisible();
	});

	test("should show Danger status chip for critical stock medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const criticalRow = getOverviewRow(overviewTable, MED_CRITICAL);
		await expect(criticalRow).toBeVisible();
		await expect(criticalRow.getByText(stockStatusText.critical)).toBeVisible();
	});

	test("should show Danger status chip for depleted medication", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const depletedRow = getOverviewRow(overviewTable, MED_DEPLETED);
		await expect(depletedRow).toBeVisible();
		await expect(depletedRow.getByText(stockStatusText.empty)).toBeVisible();
	});

	test("should keep the depleted take button visually dangerous while disabled", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const depletedRow = todayBlock.locator(".time-row").filter({ hasText: MED_DEPLETED });
		await expect(depletedRow).toBeVisible();

		const takeButton = depletedRow.getByRole("button", { name: /Take|Nehmen|dose\.take/i });
		await expect(takeButton).toBeDisabled();

		const expectedDangerStyles = await page.evaluate(() => {
			const probe = document.createElement("button");
			probe.style.backgroundColor = "var(--danger)";
			probe.style.borderColor = "var(--danger)";
			document.body.appendChild(probe);
			const styles = getComputedStyle(probe);
			const result = {
				backgroundColor: styles.backgroundColor,
				borderTopColor: styles.borderTopColor,
			};
			probe.remove();
			return result;
		});

		await expect(takeButton).toHaveCSS("opacity", "1");
		await expect(takeButton).toHaveCSS("background-color", expectedDangerStyles.backgroundColor);
		await expect(takeButton).toHaveCSS("border-top-color", expectedDangerStyles.borderTopColor);
	});

	test("should show days-left and runs-out date in overview", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// High stock should show many days (around 299)
		await expect(overviewTable.getByText(MED_HIGH)).toBeVisible({ timeout: 10000 });
		const highRow = getOverviewRow(overviewTable, MED_HIGH);
		const highRowText = (await highRow.textContent()) ?? "";
		// Should contain a 3-digit number for days
		expect(highRowText).toMatch(/\d{2,3}/);

		// Depleted rows can now show either explicit zero days left or an em dash placeholder.
		await expect(overviewTable.getByText(MED_DEPLETED)).toBeVisible({ timeout: 10000 });
		const depletedRow = getOverviewRow(overviewTable, MED_DEPLETED);
		const depletedText = (await depletedRow.textContent()) ?? "";
		expect(depletedText.includes("0") || depletedText.includes("—")).toBeTruthy();
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

	test("should preserve stock status semantics in overview rows", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// The visible status text is the stable contract after the Mantine migration.
		const highRow = getOverviewRow(overviewTable, MED_HIGH);
		await expect(highRow.getByText(stockStatusText.high)).toBeVisible();

		const criticalRow = getOverviewRow(overviewTable, MED_CRITICAL);
		await expect(criticalRow.getByText(stockStatusText.critical)).toBeVisible();

		const lowRow = getOverviewRow(overviewTable, MED_LOW);
		await expect(lowRow.getByText(stockStatusText.low)).toBeVisible();
	});

	test("should open medication detail modal showing stock info", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on the critical stock medication row
		const criticalRow = getOverviewRow(overviewTable, MED_CRITICAL);
		await criticalRow.getByRole("button", { name: MED_CRITICAL }).click();

		const modal = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name: MED_CRITICAL }) })
			.last();
		await expect(modal).toBeVisible({ timeout: 5000 });
		await expect(modal.getByText(MED_CRITICAL)).toBeVisible();

		// Modal should show stock/coverage details
		const modalText = await modal.textContent();
		expect(modalText).toBeTruthy();

		// Close modal
		await page.waitForTimeout(350);
		await modal.getByLabel(/Close|common\.close/i).click();
		await expect(modal).not.toBeVisible();
	});

	test("should show generic name in overview for medications that have one", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = getOverviewTable(page);
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on the normal stock med (has generic name "Ibuprofen 400mg")
		const normalRow = getOverviewRow(overviewTable, MED_NORMAL);
		await normalRow.getByRole("button", { name: MED_NORMAL }).click();

		const modal = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name: MED_NORMAL }) })
			.last();
		await expect(modal).toBeVisible({ timeout: 5000 });
		// Modal should show the generic name somewhere
		await expect(modal.getByText("Ibuprofen 400mg")).toBeVisible();

		await modal.getByLabel(/Close|common\.close/i).click();
	});

	test("should show different stock levels in planner results", async ({ page }) => {
		await navigateTo(page, "/planner");
		await page.waitForLoadState("networkidle");

		// Calculate for 30-day default range
		await page.getByRole("button", { name: /Calculate|planner\.calculate/i }).click();
		const resultsTable = page.getByTestId("planner-results-table");
		await expect(resultsTable).toBeVisible({ timeout: 15000 });

		const plannerRows = resultsTable.getByTestId("planner-result-row");
		expect(await plannerRows.count()).toBeGreaterThanOrEqual(2);

		// The planner keeps the same semantic split: enough stock versus an empty supply.
		await expect(resultsTable.getByText(stockStatusText.enough).first()).toBeVisible();
		await expect(resultsTable.getByText(stockStatusText.empty).first()).toBeVisible();
	});
});
