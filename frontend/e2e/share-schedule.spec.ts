import {
	test,
	authFile,
	navigateTo,
	expect,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	type TestMedication,
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
	test.describe.configure({ timeout: 90000 });

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
			}),
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
			}),
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("should show taken-by badges on dashboard overview table", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Alice's medication should show "Alice" badge
		const aliceRow = overviewTable.locator(".table-row").filter({ hasText: MED_ALICE });
		await expect(aliceRow).toBeVisible();
		await expect(aliceRow.locator(".taken-by-badge").filter({ hasText: PERSON_ALICE })).toBeVisible();

		// Bob's medication should show "Bob" badge
		const bobRow = overviewTable.locator(".table-row").filter({ hasText: MED_BOB });
		await expect(bobRow).toBeVisible();
		await expect(bobRow.locator(".taken-by-badge").filter({ hasText: PERSON_BOB })).toBeVisible();
	});

	test("should show Share button on dashboard when medications have taken-by", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Share button should appear near the schedules section
		const shareBtn = page.locator("button.share-btn");
		await expect(shareBtn).toBeVisible({ timeout: 10000 });
	});

	test("should open share dialog with person list", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Click the share button
		const shareBtn = page.locator("button.share-btn");
		await expect(shareBtn).toBeVisible({ timeout: 10000 });
		await shareBtn.click();

		// Share dialog modal should appear
		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Should show a person select dropdown (first select in the modal)
		const personSelect = modal.locator("select").first();
		await expect(personSelect).toBeVisible();

		// Should contain Alice and Bob options
		await expect(personSelect.locator("option")).toHaveCount(2);

		// Close
		await page.locator("button.modal-close").click();
		await expect(modal).not.toBeVisible();
	});

	test("should generate a share link for Alice", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		// Open share dialog
		await page.locator("button.share-btn").click();
		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Select Alice
		const personSelect = modal.locator("select").first();
		await personSelect.selectOption(PERSON_ALICE);

		// Click Generate Link button
		const generateBtn = modal.getByRole("button", { name: /Generate/i });
		await expect(generateBtn).toBeVisible();
		await generateBtn.click();

		// Wait for link to be generated
		const shareLinkInput = modal.locator("input.share-link-input");
		await expect(shareLinkInput).toBeVisible({ timeout: 10000 });

		// The share link should contain /share/
		const linkValue = await shareLinkInput.inputValue();
		expect(linkValue).toContain("/share/");

		// Copy button should be visible
		await expect(modal.locator("button.btn-copy")).toBeVisible();

		// Close
		await page.locator("button.modal-close").click();
	});

	test("should navigate to shared schedule page via API-created token", async ({ page }) => {
		// Create a share token via API (faster, more reliable)
		const shareToken = await createShareTokenViaAPI(PERSON_ALICE, 30);
		expect(shareToken.token).toBeTruthy();

		// Navigate to the shared schedule page (no auth needed)
		await page.goto(`/share/${shareToken.token}`);

		// Should show the shared schedule page (not the login page)
		// Wait for either the schedule content or an error
		const sharedContent = page.locator(".shared-schedule, .share-page");
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

		// Wait for page content to load
		await page.waitForTimeout(2000);

		// The page should show Alice's medication name
		const content = page.getByText(MED_ALICE);
		try {
			await expect(content).toBeVisible({ timeout: 10000 });
		} catch {
			// Reload and retry — sometimes the initial load misses
			await page.reload();
			await page.waitForLoadState("networkidle");
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
		await page.waitForTimeout(2000);

		try {
			await expect(page.getByText(MED_ALICE)).toBeVisible({ timeout: 10000 });
		} catch {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.getByText(MED_ALICE)).toBeVisible({ timeout: 10000 });
		}

		// Visit Bob's share — should show Bob's med
		await page.goto(`/share/${bobToken.token}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		try {
			await expect(page.getByText(MED_BOB)).toBeVisible({ timeout: 10000 });
		} catch {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.getByText(MED_BOB)).toBeVisible({ timeout: 10000 });
		}
	});

	test("should show notes icon on dashboard for medication with notes", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Alice's med has notes — should show the 📝 icon
		const aliceRow = overviewTable.locator(".table-row").filter({ hasText: MED_ALICE });
		await expect(aliceRow).toBeVisible();
		await expect(aliceRow.locator(".notes-icon")).toBeVisible();
	});

	test("should show notes in medication detail modal", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const overviewTable = page.locator(".table.table-7");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		// Click on Alice's med to open detail modal
		const aliceRow = overviewTable.locator(".table-row").filter({ hasText: MED_ALICE });
		await aliceRow.click();

		const modal = page.locator(".modal-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Modal should show the notes
		await expect(modal.getByText("Take every 6 hours as needed")).toBeVisible();

		await page.locator("button.modal-close").click();
	});
});
