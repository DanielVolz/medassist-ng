import type { Locator, Page } from "@playwright/test";
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

	function getShareDialog(page: Page): Locator {
		return page.getByRole("dialog", { name: /share|freigeben/i });
	}

	function getSharedSchedule(page: Page): Locator {
		return page.getByRole("region", { name: /schedule|plan/i });
	}

	function getSharedScheduleMedicationRow(page: Page, medicationName: string): Locator {
		return getSharedSchedule(page)
			.locator(".day-block.today .time-row")
			.filter({
				has: page.getByText(medicationName, { exact: true }),
			});
	}

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

		// Alice's medication should show an underlined name link.
		const aliceRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_ALICE }).first();
		await expect(aliceRow).toBeVisible();
		const aliceName = aliceRow.getByRole("button", { name: PERSON_ALICE, exact: true });
		await expect(aliceName).toBeVisible();
		await expect(aliceName).toHaveCSS("text-decoration-line", "underline");

		// Bob's medication should show the same plain name treatment.
		const bobRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_BOB }).first();
		await expect(bobRow).toBeVisible();
		const bobName = bobRow.getByRole("button", { name: PERSON_BOB, exact: true });
		await expect(bobName).toBeVisible();
		await expect(bobName).toHaveCSS("text-decoration-line", "underline");
	});

	test("should keep mobile schedule recipient underlines unclipped", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await navigateTo(page, "/dashboard");

		const recipientName = page.getByRole("button", { exact: true, name: PERSON_ALICE }).last();
		await expect(recipientName).toBeVisible();
		await expect(recipientName).toHaveCSS("text-decoration-line", "underline");

		const isUnclipped = await recipientName.evaluate((element) => element.scrollWidth <= element.clientWidth);
		expect(isUnclipped).toBe(true);
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
		const modal = getShareDialog(page);
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Should show a person select dropdown (first select in the modal)
		const personSelect = modal.getByLabel(/person/i);
		await expect(personSelect).toBeVisible();

		// Should contain Alice and Bob options.
		// The dialog can also include an "all people" option, so assert presence instead of exact count.
		await expect(personSelect.getByRole("option", { name: PERSON_ALICE, exact: true })).toBeAttached();
		await expect(personSelect.getByRole("option", { name: PERSON_BOB, exact: true })).toBeAttached();

		// Close
		await modal.getByLabel(/close/i).click();
		await expect(modal).not.toBeVisible();
	});

	test("should generate a share link for Alice", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Open share dialog
		await page.getByRole("button", { exact: true, name: "Share" }).click();
		const modal = getShareDialog(page);
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Select Alice
		const personSelect = modal.getByLabel(/person/i);
		await personSelect.selectOption(PERSON_ALICE);

		// Click Generate Link button
		const generateBtn = modal.getByRole("button", { name: /Generate/i });
		await expect(generateBtn).toBeVisible();
		await generateBtn.click();

		// Wait for link to be generated
		const shareLinkInput = modal.getByRole("textbox");
		await expect(shareLinkInput).toBeVisible({ timeout: 10000 });

		// The share link should contain /share/
		const linkValue = await shareLinkInput.inputValue();
		expect(linkValue).toContain("/share/");

		// Copy button should be visible
		await expect(modal.getByRole("button", { name: /copy/i })).toBeVisible();

		// Close
		await modal.getByLabel(/close/i).click();
	});

	test("should navigate to shared schedule page via API-created token", async ({ page }) => {
		// Create a share token via API (faster, more reliable)
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);
		expect(shareToken.token).toBeTruthy();

		// Navigate to the shared schedule page (no auth needed)
		await page.goto(`/share/${shareToken.token}`);

		const sharedSchedule = getSharedSchedule(page);
		await expect(sharedSchedule).toBeVisible({ timeout: 15000 });
		await expect(sharedSchedule.getByText(MED_ALICE, { exact: true })).toBeVisible();
	});

	test("should show medication schedule on shared page", async ({ page }) => {
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);

		await page.goto(`/share/${shareToken.token}`);
		const sharedSchedule = getSharedSchedule(page);
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		// The page should show Alice's medication name
		await expect(sharedSchedule.getByText(MED_ALICE, { exact: true })).toBeVisible({ timeout: 10000 });
	});

	test("should show dose tracking on shared page", async ({ page }) => {
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);

		await page.goto(`/share/${shareToken.token}`);
		const sharedSchedule = getSharedSchedule(page);
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });
		await expect(sharedSchedule.getByRole("button", { name: /take/i })).toBeVisible();
	});

	test("should generate separate share links for different people", async ({ page }) => {
		// Create share tokens for both Alice and Bob
		const aliceToken = await createShareTokenViaAPI(PERSON_ALICE, 30);
		const bobToken = await createShareTokenViaAPI(PERSON_BOB, 30);

		// Tokens should be different
		expect(aliceToken.token).not.toBe(bobToken.token);

		// Visit Alice's share — should show Alice's med
		await page.goto(`/share/${aliceToken.token}`);
		const sharedSchedule = getSharedSchedule(page);
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		await expect(sharedSchedule.getByText(MED_ALICE, { exact: true })).toBeVisible({ timeout: 10000 });

		// Visit Bob's share — should show Bob's med
		await page.goto(`/share/${bobToken.token}`);
		await expect(sharedSchedule).toBeVisible({ timeout: 10000 });

		await expect(sharedSchedule.getByText(MED_BOB, { exact: true })).toBeVisible({ timeout: 10000 });
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
		const sharedSchedule = getSharedSchedule(page);
		await expect(sharedSchedule.getByText(medicationName, { exact: true })).toBeVisible({
			timeout: 15000,
		});

		const medicationRow = getSharedScheduleMedicationRow(page, medicationName);
		await expect(medicationRow).toBeVisible({ timeout: 10000 });
		const takeButton = medicationRow.getByRole("button", { name: /take/i });
		const noteButton = medicationRow.getByRole("button", { name: /note/i });
		await expect(noteButton).toBeDisabled();

		await Promise.all([
			page.waitForResponse(
				(response) =>
					response.url().includes(`/api/share/${shareToken.token}/doses`) &&
					response.request().method() === "POST" &&
					response.ok()
			),
			takeButton.click(),
		]);
		await expect(noteButton).toBeEnabled({ timeout: 10000 });
		await noteButton.click();

		const journalDialog = page.getByRole("dialog");
		const noteInput = journalDialog.getByRole("textbox");
		await expect(noteInput).toBeVisible({ timeout: 10000 });
		await expect(noteInput).toHaveValue("");

		await noteInput.fill(journalNote);
		await journalDialog.getByRole("button", { name: /Save|Speichern/i }).click();
		await expect(noteInput).toBeHidden({ timeout: 10000 });

		await noteButton.click();
		await expect(noteInput).toBeVisible({ timeout: 10000 });
		await expect(noteInput).toHaveValue(journalNote, { timeout: 10000 });
	});
});
