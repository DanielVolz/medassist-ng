import {
	authFile,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	expandDayBlock,
	expect,
	navigateTo,
	relativeLocalDateTime,
	test,
	updateSettingsViaAPI,
} from "./fixtures";

test.describe("Mobile modal browser back", () => {
	test.use({
		storageState: authFile,
		viewport: { width: 412, height: 915 },
		isMobile: true,
		hasTouch: true,
	});

	test("closes owner-side modals with browser back on a Pixel-width viewport", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		const journalHistoryButton = page.locator(".journal-history-button").first();
		await expect(journalHistoryButton).toBeVisible({ timeout: 10000 });
		await journalHistoryButton.click();

		const journalHistoryModal = page.locator(".journal-history-modal");
		await expect(journalHistoryModal).toBeVisible({ timeout: 10000 });
		await page.goBack();
		await expect(journalHistoryModal).toBeHidden({ timeout: 10000 });

		await navigateTo(page, "/settings");

		const exportButton = page
			.locator("button.secondary")
			.filter({ hasText: /Export|Exportieren/i })
			.first();
		await expect(exportButton).toBeVisible({ timeout: 10000 });
		await exportButton.click();

		const exportModal = page.getByRole("dialog").filter({ hasText: /Export Options|Export-Optionen/i });
		await expect(exportModal).toBeVisible({ timeout: 10000 });
		await page.goBack();
		await expect(exportModal).toBeHidden({ timeout: 10000 });
	});

	test("closes the medication report modal with browser back on mobile", async ({ page }) => {
		const medicationName = `Mobile Report Back ${Date.now().toString(36)}`;

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
			takenBy: ["Mobile Report"],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
		});

		await page.goto("/medications", { waitUntil: "domcontentloaded" });
		await expect(page.getByText(medicationName)).toBeVisible({ timeout: 15000 });

		await page
			.getByRole("button", { name: /Report|Bericht/i })
			.first()
			.click();
		const reportModal = page.getByRole("dialog").filter({ hasText: /Medication Report|Medikamentenbericht/i });
		await expect(reportModal).toBeVisible({ timeout: 10000 });

		const medicationsUrl = page.url();
		await page.goBack({ waitUntil: "commit", timeout: 10000 }).catch(() => undefined);

		await expect(reportModal).toBeHidden({ timeout: 10000 });
		await expect(page).toHaveURL(medicationsUrl);
		await expect(page.getByText(medicationName)).toBeVisible();

		await deleteAllMedicationsViaAPI();
	});

	test("closes the shared intake journal modal with browser back on mobile", async ({ page }) => {
		const uniqueSuffix = Date.now().toString(36);
		const person = `Mobile Journal ${uniqueSuffix}`;
		const medicationName = `Mobile Shared Journal ${uniqueSuffix}`;
		const startTime = relativeLocalDateTime(0, 0);

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
			takenBy: [person],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: startTime, intakeRemindersEnabled: false, takenBy: person }],
		});

		await updateSettingsViaAPI({ stockCalculationMode: "manual" });
		try {
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

			const todayBlock = page.locator(".day-block.today");
			await expandDayBlock(todayBlock);
			const doseItem = todayBlock.locator(".dose-item").first();
			await expect(doseItem).toBeVisible({ timeout: 15000 });
			await doseItem.getByRole("button", { name: /Take|Nehmen/i }).click();

			const noteButton = doseItem.getByRole("button", { name: /Note|Notiz/i });
			await expect(noteButton).toBeEnabled({ timeout: 10000 });
			await noteButton.click();

			const journalModal = page.locator(".journal-modal");
			await expect(journalModal).toBeVisible({ timeout: 10000 });
			await page.goBack();
			await expect(journalModal).toBeHidden({ timeout: 10000 });
			await expect(page.locator(".shared-schedule-container")).toBeVisible();
		} finally {
			await updateSettingsViaAPI({ stockCalculationMode: "automatic" });
		}
	});
});
