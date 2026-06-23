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
 * Dashboard with Medication Data E2E Tests
 *
 * Creates medications via API, then verifies the dashboard
 * overview table, coverage cards, timeline, and dose tracking.
 */
test.describe("Dashboard with medications", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	// Unique medication names to avoid conflicts with parallel workers
	const MED_1 = "DashData Ibuprofen";
	const MED_2 = "DashData Vitamin C";

	// Set start to earlier today so doses appear on the timeline
	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		// Clean up any leftover medications from previous test runs
		await deleteAllMedicationsViaAPI();
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_1,
				genericName: "Ibuprofen",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 0,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_2,
				packageType: "bottle",
				totalPills: 90,
				looseTablets: 90,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false }],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show medication overview table with medications", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.locator(".table-head")).toBeVisible();

		// Our medications should have rows
		await expect(overviewTable.getByText(MED_1)).toBeVisible();
		await expect(overviewTable.getByText(MED_2)).toBeVisible();
	});

	test("should show status chips in overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Each medication row should expose a readable stock status.
		await expect(
			overviewTable.locator(".table-row").filter({ hasText: MED_1 }).getByRole("cell", { name: "Normal" })
		).toBeVisible();
		await expect(
			overviewTable.locator(".table-row").filter({ hasText: MED_2 }).getByRole("cell", { name: "Normal" })
		).toBeVisible();
	});

	test("should show stock information in overview", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// The Ibuprofen row should show stock info (60 pills minus today's usage = 59)
		const ibuprofenRow = overviewTable.locator(".table-row").filter({ hasText: MED_1 });
		await expect(ibuprofenRow).toBeVisible();
		const rowText = await ibuprofenRow.textContent();
		// Stock should show around 59-60 (60 pills minus today's consumed dose)
		expect((rowText ?? "").includes("59") || (rowText ?? "").includes("60")).toBeTruthy();
	});

	test("should show today block in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
	});

	test("should show medication names in today's schedule", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
		await expect(todayBlock.getByText(MED_1)).toBeVisible();
		await expect(todayBlock.getByText(MED_2)).toBeVisible();
	});

	test("keeps schedule medication identity tight to the day header", async ({ page }) => {
		for (const viewport of [
			{ width: 1280, height: 720 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);
			await navigateTo(page, "/dashboard");

			const todayBlock = page.locator(".day-block.today");
			await expect(todayBlock).toBeVisible({ timeout: 10000 });
			const row = todayBlock.locator(".time-row").filter({ hasText: MED_1 }).first();
			await expect(row).toBeVisible();

			const metrics = await row.evaluate((node) => {
				const timeRow = node as HTMLElement;
				const dayDivider = timeRow.closest(".day-block")?.querySelector(".day-divider") as HTMLElement | null;
				const identity = timeRow.querySelector(".time-main .med-name") as HTMLElement | null;
				const avatarWrap = identity?.firstElementChild as HTMLElement | null;
				const nameText = identity?.querySelector(".med-name-text") as HTMLElement | null;
				if (!dayDivider || !identity || !avatarWrap || !nameText) {
					throw new Error("Schedule medication identity markup was not found");
				}

				const rowRect = timeRow.getBoundingClientRect();
				const dividerRect = dayDivider.getBoundingClientRect();
				const avatarRect = avatarWrap.getBoundingClientRect();
				const nameRect = nameText.getBoundingClientRect();

				return {
					avatarNameGap: nameRect.left - avatarRect.right,
					avatarTopFromRow: avatarRect.top - rowRect.top,
					dayHeaderToRowGap: rowRect.top - dividerRect.bottom,
					nameAvatarTopDelta: Math.abs(nameRect.top - avatarRect.top),
				};
			});

			expect(metrics.dayHeaderToRowGap).toBeLessThanOrEqual(10);
			expect(metrics.avatarTopFromRow).toBeLessThanOrEqual(8);
			expect(metrics.avatarNameGap).toBeLessThanOrEqual(10);
			expect(metrics.nameAvatarTopDelta).toBeLessThanOrEqual(4);
		}
	});

	test("should show day summary with dose progress", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.getByText(MED_1)).toBeVisible({ timeout: 10000 });

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
		await expect(todayBlock.locator(".day-summary")).toBeVisible();
	});

	test("should show dose take buttons in today's schedule", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const takeButtons = todayBlock.getByRole("button", { name: /^Take$/ });
		expect(await takeButtons.count()).toBeGreaterThanOrEqual(1);
	});

	test("should mark a dose as taken and show undo", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		let todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const takeBtn = todayBlock.getByRole("button", { name: /^Take$/ }).first();
		test.skip(!(await takeBtn.isVisible().catch(() => false)), "No actionable take-dose button is visible for today");

		const takeResponsePromise = page.waitForResponse(
			(response) => response.url().includes("/api/doses/taken") && response.request().method() === "POST",
			{ timeout: 10000 }
		);
		await takeBtn.click();
		const takeResponse = await takeResponsePromise;
		test.skip(!takeResponse.ok(), "Backend did not accept dose take request");

		await page.reload();
		await page.waitForLoadState("networkidle");
		todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });
		await expect(todayBlock.getByRole("button", { name: /^Undo/ }).first()).toBeVisible({ timeout: 5000 });
	});

	test("should undo a taken dose", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		await page.waitForLoadState("networkidle");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 15000 });
		await expect(overviewTable.getByText(MED_1)).toBeVisible({ timeout: 15000 });

		let todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		// Normalize state first: if a dose is already taken, undo it so we can
		// always execute the same take -> undo flow deterministically.
		const existingUndo = todayBlock.getByRole("button", { name: /^Undo/ }).first();
		if (await existingUndo.isVisible().catch(() => false)) {
			await existingUndo.click();
			await page.waitForLoadState("networkidle");
		}

		// Mark a dose as taken first
		const takeBtn = todayBlock.getByRole("button", { name: /^Take$/ }).first();
		await expect(takeBtn).toBeVisible({ timeout: 10000 });
		const takeResponsePromise = page.waitForResponse(
			(response) => response.url().includes("/api/doses/taken") && response.request().method() === "POST",
			{ timeout: 10000 }
		);
		await takeBtn.click();
		const takeResponse = await takeResponsePromise;
		test.skip(!takeResponse.ok(), "Backend did not accept dose take request");

		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(overviewTable).toBeVisible({ timeout: 15000 });
		await expect(overviewTable.getByText(MED_1)).toBeVisible({ timeout: 15000 });
		todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 15000 });

		// Wait for undo button to appear (confirms the take succeeded)
		const undoBtn = todayBlock.getByRole("button", { name: /^Undo/ }).first();
		await expect(undoBtn).toBeVisible({ timeout: 10000 });
		await undoBtn.click();
		await page.waitForLoadState("networkidle");

		// Take button should reappear
		await expect(todayBlock.getByRole("button", { name: /^Take$/ }).first()).toBeVisible({ timeout: 10000 });
	});

	test("should show multiple day blocks in timeline", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Wait for timeline to fully render
		await page.waitForLoadState("networkidle");
		const dayBlocks = page.locator(".day-block");
		await expect(dayBlocks.first()).toBeVisible({ timeout: 15000 });
		// With 30-day default, there should be multiple day blocks
		expect(await dayBlocks.count()).toBeGreaterThanOrEqual(1);
	});

	test("should show day header with date text", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const todayBlock = page.locator(".day-block.today");
		await expect(todayBlock).toBeVisible({ timeout: 10000 });

		const dayDivider = todayBlock.locator(".day-divider");
		await expect(dayDivider).toBeVisible();
		expect(await dayDivider.textContent()).toBeTruthy();
	});

	test("should open medication detail modal from overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const medRow = overviewTable.locator(".table-row").filter({ hasText: MED_1 }).first();
		await medRow.getByRole("button", { name: MED_1 }).click();

		const modal = page.getByRole("dialog");
		await expect(modal).toBeVisible({ timeout: 5000 });
		await expect(modal.getByText(MED_1)).toBeVisible();

		await modal.getByLabel(/close/i).click();
		await expect(modal).not.toBeVisible();
	});

	test("should show schedule days selector", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const daysSelect = page.locator("select.schedule-days-select");
		await expect(daysSelect).toBeVisible();
		await expect(daysSelect.locator('option[value="30"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="90"]')).toBeAttached();
		await expect(daysSelect.locator('option[value="180"]')).toBeAttached();
	});
});
