import {
	authFile,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

function expectHeightsToAlign(actual: number, expected: number) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
}

/**
 * Share Schedule E2E Tests
 *
 * Tests the share workflow: creating medications with taken-by persons,
 * generating share links via the Share Dialog, visiting shared schedule pages,
 * and verifying calendar data on the shared view.
 */
test.describe("Share Schedule", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	const MED_ALICE = "ShareTest AliceMed";
	const MED_BOB = "ShareTest BobMed";
	const PERSON_ALICE = "Alice";
	const PERSON_BOB = "Bob";

	const todayMorning = (() => {
		const d = new Date();
		d.setHours(8, 0, 0, 0);
		const pad = (n: number) => n.toString().padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	})();

	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();

		// Create medication for Alice
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_ALICE,
				genericName: "Paracetamol",
				takenBy: [PERSON_ALICE],
				notes: "Take every 6 hours as needed",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false, takenBy: PERSON_ALICE }],
			})
		);

		// Create medication for Bob
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_BOB,
				takenBy: [PERSON_BOB],
				packageType: "bottle",
				totalPills: 60,
				looseTablets: 60,
				intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false, takenBy: PERSON_BOB }],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show underlined taken-by names on dashboard overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.getByTestId("dashboard-overview-table");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Alice's medication should show an underlined name link without the old pill background.
		const aliceRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_ALICE }).first();
		await expect(aliceRow).toBeVisible();
		const aliceName = aliceRow.getByRole("button", { name: PERSON_ALICE, exact: true });
		await expect(aliceName).toBeVisible();
		await aliceName.hover();
		await expect(aliceName).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(aliceName).toHaveCSS("border-top-width", "0px");
		await expect(aliceName).toHaveCSS("box-shadow", "none");
		await expect(aliceName).toHaveCSS("text-decoration-line", "underline");
		const aliceOverviewMetrics = await aliceRow.evaluate(
			(row, labels) => {
				const avatar = row.querySelector<HTMLElement>(".med-avatar-sm");
				const buttons = Array.from(row.querySelectorAll<HTMLElement>("button"));
				const stackItems = labels
					.map((label) => buttons.find((button) => button.textContent?.trim() === label))
					.filter((item): item is HTMLElement => Boolean(item));
				const avatarRect = avatar?.getBoundingClientRect();
				const stackRects = stackItems.map((item) => item.getBoundingClientRect());
				return {
					avatarHeight: avatarRect?.height ?? 0,
					stackHeight:
						stackRects.length > 0
							? Math.max(...stackRects.map((rect) => rect.bottom)) - Math.min(...stackRects.map((rect) => rect.top))
							: 0,
				};
			},
			[MED_ALICE, PERSON_ALICE]
		);
		expectHeightsToAlign(aliceOverviewMetrics.avatarHeight, aliceOverviewMetrics.stackHeight);

		// Bob's medication should show the same plain name treatment.
		const bobRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_BOB }).first();
		await expect(bobRow).toBeVisible();
		const bobName = bobRow.getByRole("button", { name: PERSON_BOB, exact: true });
		await expect(bobName).toBeVisible();
		await expect(bobName).toHaveCSS("text-decoration-line", "underline");

		const aliceScheduleRow = page
			.locator(".dashboard-schedules-section .time-row")
			.filter({ hasText: MED_ALICE })
			.first();
		await expect(aliceScheduleRow).toBeVisible();
		const aliceScheduleMetrics = await aliceScheduleRow.evaluate((row) => {
			const avatar = row.querySelector<HTMLElement>(".time-main .med-avatar-sm");
			const stack = row.querySelector<HTMLElement>(".time-main .med-name-stack");
			return {
				avatarHeight: avatar?.getBoundingClientRect().height ?? 0,
				stackHeight: stack?.getBoundingClientRect().height ?? 0,
			};
		});
		expectHeightsToAlign(aliceScheduleMetrics.avatarHeight, aliceScheduleMetrics.stackHeight);
	});

	test("should keep mobile schedule recipient underlines unclipped", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await navigateTo(page, "/dashboard");

		const aliceScheduleRow = page
			.locator(".dashboard-schedules-section .time-row")
			.filter({ hasText: MED_ALICE })
			.first();
		await expect(aliceScheduleRow).toBeVisible({ timeout: 10000 });

		const recipientName = aliceScheduleRow.getByRole("button", { exact: true, name: PERSON_ALICE });
		await expect(recipientName).toBeVisible();
		await expect(recipientName).toHaveCSS("text-decoration-line", "underline");

		const metrics = await recipientName.evaluate((element) => {
			const styles = window.getComputedStyle(element);
			return {
				fontSize: Number.parseFloat(styles.fontSize),
				lineHeight: Number.parseFloat(styles.lineHeight),
				paddingBlockEnd: Number.parseFloat(styles.paddingBlockEnd),
			};
		});
		expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.25);
		expect(metrics.paddingBlockEnd).toBeGreaterThan(0);
	});

	test("should show Share button on dashboard when medications have taken-by", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Share button should appear near the schedules section
		const shareBtn = page.getByRole("button", { exact: true, name: "Share" });
		await expect(shareBtn).toBeVisible({ timeout: 10000 });
	});

	test("should open share dialog with person list", async ({ page }) => {
		await navigateTo(page, "/dashboard");
		const overviewTable = page.getByTestId("dashboard-overview-table");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.getByText(MED_ALICE)).toBeVisible({ timeout: 10000 });
		await expect(overviewTable.getByText(MED_BOB)).toBeVisible({ timeout: 10000 });

		// Click the share button
		const shareBtn = page.getByRole("button", { exact: true, name: "Share" });
		await expect(shareBtn).toBeVisible({ timeout: 10000 });
		await shareBtn.click();

		// Share dialog modal should appear
		const modal = page.getByRole("dialog");
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Should show a person select dropdown (first select in the modal)
		const personSelect = modal.locator("select").first();
		await expect(personSelect).toBeVisible();

		// Should contain Alice and Bob options.
		// The dialog can also include an "all people" option, so assert presence instead of exact count.
		await expect(personSelect.locator('option[value="Alice"]')).toBeAttached();
		await expect(personSelect.locator('option[value="Bob"]')).toBeAttached();

		// Close
		await modal.getByLabel(/close/i).click();
		await expect(modal).not.toBeVisible();
	});

	test("should generate a share link for Alice", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Open share dialog
		await page.getByRole("button", { exact: true, name: "Share" }).click();
		const modal = page.getByRole("dialog");
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Select Alice
		const personSelect = modal.locator("select").first();
		await personSelect.selectOption(PERSON_ALICE);

		// Click Generate Link button
		const generateBtn = modal.getByRole("button", { name: /Generate/i });
		await expect(generateBtn).toBeVisible();
		await generateBtn.click();

		// Wait for link to be generated
		const shareLinkInput = modal.locator("input.share-link-input").first();
		await expect(shareLinkInput).toBeVisible({ timeout: 10000 });

		// The share link should contain /share/
		const linkValue = await shareLinkInput.inputValue();
		expect(linkValue).toContain("/share/");

		// Copy button should be visible
		await expect(modal.locator("button.btn-copy").first()).toBeVisible();

		// Close
		await modal.getByLabel(/close/i).click();
	});

	test("should navigate to shared schedule page via API-created token", async ({ page }) => {
		// Create a share token via API (faster, more reliable)
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);
		expect(shareToken.token).toBeTruthy();

		// Navigate to the shared schedule page (no auth needed)
		await page.goto(`/share/${shareToken.token}`);

		// Should show the shared schedule page (not the login page)
		// Wait for either the schedule content or an error
		const _sharedContent = page.locator(".shared-schedule, .share-page");
		const dayBlock = page.locator(".day-block");
		const medName = page.getByText(MED_ALICE);

		// At least one of these should be visible — indicating the share page loaded
		try {
			await expect(medName).toBeVisible({ timeout: 15000 });
		} catch {
			// The page might use a different layout — check if any schedule content loaded
			await expect(dayBlock.first()).toBeVisible({ timeout: 5000 });
		}
	});

	test("should show medication schedule on shared page", async ({ page }) => {
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);

		await page.goto(`/share/${shareToken.token}`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
		const sharedSchedule = page.locator(".shared-schedule-container");
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		// The page should show Alice's medication name
		const content = sharedSchedule.locator(".med-name-text", { hasText: MED_ALICE }).first();
		try {
			await expect(content).toBeVisible({ timeout: 10000 });
		} catch {
			// Reload and retry — sometimes the initial load misses
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
			await expect(content).toBeVisible({ timeout: 10000 });
		}
	});

	test("should show dose tracking on shared page", async ({ page }) => {
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);

		await page.goto(`/share/${shareToken.token}`);
		await page.waitForLoadState("networkidle");

		// Wait for the schedule to render
		const dayBlock = page.locator(".day-block").first();
		try {
			await expect(dayBlock).toBeVisible({ timeout: 10000 });
		} catch {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(dayBlock).toBeVisible({ timeout: 10000 });
		}

		// Dose items should be visible
		const doseItems = page.locator(".dose-item");
		expect(await doseItems.count()).toBeGreaterThanOrEqual(1);
	});

	test("should generate separate share links for different people", async ({ page }) => {
		// Create share tokens for both Alice and Bob
		const aliceToken = await createShareTokenViaAPI(PERSON_ALICE, 30);
		const bobToken = await createShareTokenViaAPI(PERSON_BOB, 30);

		// Tokens should be different
		expect(aliceToken.token).not.toBe(bobToken.token);

		// Visit Alice's share — should show Alice's med
		await page.goto(`/share/${aliceToken.token}`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
		const sharedSchedule = page.locator(".shared-schedule-container");
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		try {
			await expect(sharedSchedule.locator(".med-name-text", { hasText: MED_ALICE }).first()).toBeVisible({
				timeout: 10000,
			});
		} catch {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
			await expect(sharedSchedule.locator(".med-name-text", { hasText: MED_ALICE }).first()).toBeVisible({
				timeout: 10000,
			});
		}

		// Visit Bob's share — should show Bob's med
		await page.goto(`/share/${bobToken.token}`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		try {
			await expect(sharedSchedule.locator(".med-name-text", { hasText: MED_BOB }).first()).toBeVisible({
				timeout: 10000,
			});
		} catch {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
			await expect(sharedSchedule.locator(".med-name-text", { hasText: MED_BOB }).first()).toBeVisible({
				timeout: 10000,
			});
		}
	});

	test("should show notes icon on dashboard for medication with notes", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.getByTestId("dashboard-overview-table");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Alice's med has notes — should show the 📝 icon
		const aliceRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_ALICE }).first();
		await expect(aliceRow).toBeVisible();
		await expect(aliceRow.getByRole("button", { name: "Has notes" })).toBeVisible();
	});

	test("should show notes in medication detail modal", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.getByTestId("dashboard-overview-table");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on Alice's med to open detail modal
		const aliceRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_ALICE }).first();
		await aliceRow.getByRole("button", { name: MED_ALICE }).click();

		const modal = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name: MED_ALICE }) })
			.last();
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Modal should show the notes
		await expect(modal.getByText("Take every 6 hours as needed")).toBeVisible();

		await modal.getByLabel(/close/i).click();
	});

	test("should let a shared recipient add and reopen a journal note", async ({ page }) => {
		const uniqueSuffix = Date.now().toString(36);
		const person = `Journal E2E ${uniqueSuffix}`;
		const medicationName = `Share Journal E2E ${uniqueSuffix}`;
		const journalNote = `Shared E2E note ${uniqueSuffix}`;

		await createMedicationViaAPI({
			name: medicationName,
			takenBy: [person],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: todayMorning, intakeRemindersEnabled: false, takenBy: person }],
		});

		const shareToken = await createShareTokenViaAPI(person, 30, {
			allowJournalNotes: true,
			allowMarkTaken: true,
		});

		await page.goto(`/share/${shareToken.token}`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });

		await expect(page.locator(".med-name-text").filter({ hasText: medicationName }).first()).toBeVisible({
			timeout: 15000,
		});

		const doseItem = page.locator(".dose-item").first();
		await expect(doseItem).toBeVisible({ timeout: 15000 });
		await expect(doseItem.locator(".dose-btn.journal")).toBeDisabled();

		await doseItem.locator(".dose-btn.take").click();

		const collapsedTodayDivider = page.locator(".day-block.today.collapsed .day-divider.clickable").first();
		if (await collapsedTodayDivider.isVisible().catch(() => false)) {
			await collapsedTodayDivider.click();
		}

		const updatedDoseItem = page.locator(".dose-item").first();
		const noteButton = updatedDoseItem.locator(".dose-btn.journal");
		await expect(noteButton).toBeEnabled({ timeout: 10000 });
		await noteButton.click();

		const noteInput = page.locator("#journal-note-input");
		await expect(noteInput).toBeVisible({ timeout: 10000 });
		await expect(noteInput).toHaveValue("");

		await noteInput.fill(journalNote);
		await page.getByRole("button", { name: /Save|Speichern/i }).click();
		await expect(page.locator(".journal-modal")).toBeHidden({ timeout: 10000 });

		await noteButton.click();
		await expect(noteInput).toBeVisible({ timeout: 10000 });
		await expect(noteInput).toHaveValue(journalNote, { timeout: 10000 });
	});
});
