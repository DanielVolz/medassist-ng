import type { Locator, Page } from "@playwright/test";
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

async function createMedicationForDetailReturn(name: string) {
	await deleteAllMedicationsViaAPI();
	return createMedicationViaAPI({
		name,
		takenBy: ["Detail Return Person"],
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
	});
}

async function openMedicationDetailForEdit(page: Page, medicationId: number, medicationName: string) {
	await navigateTo(page, "/dashboard");
	const overviewTable = page.getByTestId("dashboard-overview-table");
	await expect(overviewTable).toBeVisible({ timeout: 10000 });
	const medicationRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: medicationName }).first();
	await medicationRow.getByRole("button", { name: medicationName, exact: true }).click();

	const detail = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: medicationName, exact: true }) })
		.last();
	await expect(detail).toBeVisible();
	expect(await page.evaluate(() => window.history.state)).toMatchObject({
		modal: "medDetail",
		medId: medicationId,
	});
	await detail.getByRole("button", { name: /Edit|common\.edit|Bearbeiten/i }).click();

	const editor = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: /Edit|Bearbeiten/i }) })
		.last();
	await expect(editor).toBeVisible({ timeout: 10000 });
	await expect(page).toHaveURL(/\/medications(?:\?|$)/);
	return { detail, editor };
}

async function closeEditorAndExpectDetail(
	page: Page,
	editor: Locator,
	closeMethod: "x" | "escape" | "browser back",
	medicationName: string
) {
	if (closeMethod === "x") {
		await editor
			.getByRole("button", { name: /Close|Schließen/i })
			.first()
			.click();
	} else if (closeMethod === "escape") {
		await page.keyboard.press("Escape");
	} else {
		await page.goBack({ waitUntil: "commit" });
	}

	await expect(page).toHaveURL(/\/dashboard$/);
	await expect(editor).toBeHidden();
	const detail = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: medicationName, exact: true }) })
		.last();
	await expect(detail).toBeVisible({ timeout: 10000 });
	return detail;
}

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

	test.describe("medication detail return from mobile edit", () => {
		test.describe.configure({ mode: "serial", timeout: 90000 });

		for (const closeMethod of ["x", "escape", "browser back"] as const) {
			test(`restores the originating detail after editor ${closeMethod}`, async ({ page }) => {
				const medicationName = `Detail Return ${closeMethod} ${Date.now().toString(36)}`;
				const medication = await createMedicationForDetailReturn(medicationName);

				try {
					const { editor } = await openMedicationDetailForEdit(page, medication.id, medicationName);
					const detail = await closeEditorAndExpectDetail(page, editor, closeMethod, medicationName);
					expect(await page.evaluate(() => window.history.state)).toMatchObject({
						modal: "medDetail",
						medId: medication.id,
					});

					// The restored detail can be dismissed normally; subsequent back must not restore it again.
					await page.goBack({ waitUntil: "commit" });
					await expect(detail).toBeHidden();
					await expect(page).toHaveURL(/\/dashboard$/);
					expect(await page.evaluate(() => window.history.state?.modal)).not.toBe("medDetail");
				} finally {
					await deleteAllMedicationsViaAPI();
				}
			});
		}

		test("shows the latest saved medication when closing the editor", async ({ page }) => {
			const medicationName = `Detail Save Return ${Date.now().toString(36)}`;
			const updatedName = `${medicationName} Updated`;
			const medication = await createMedicationForDetailReturn(medicationName);

			try {
				const { editor } = await openMedicationDetailForEdit(page, medication.id, medicationName);
				const form = editor.locator("form.form-grid");
				const nameInput = form.getByRole("textbox", { name: /^(Commercial Name|Name|form\.name)/i });
				await nameInput.fill(updatedName);

				const saveResponse = page.waitForResponse(
					(response) =>
						response.request().method() === "PUT" &&
						new URL(response.url()).pathname === `/api/medications/${medication.id}`
				);
				const medicationsReload = page.waitForResponse(
					(response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/medications"
				);
				await form.getByRole("button", { name: /Save|common\.save|Speichern/i }).click();
				expect((await saveResponse).status()).toBe(200);
				expect((await medicationsReload).status()).toBe(200);

				await editor
					.getByRole("button", { name: /Close|Schließen/i })
					.last()
					.click();
				await expect(page).toHaveURL(/\/dashboard$/);
				await expect(
					page
						.getByRole("dialog")
						.filter({ has: page.getByRole("heading", { name: updatedName, exact: true }) })
						.last()
				).toBeVisible({ timeout: 10000 });
			} finally {
				await deleteAllMedicationsViaAPI();
			}
		});

		test("keeps unsaved input on Stay and returns to detail on Leave without a history ghost", async ({ page }) => {
			const medicationName = `Detail Unsaved Return ${Date.now().toString(36)}`;
			const unsavedName = `${medicationName} Unsaved`;
			const medication = await createMedicationForDetailReturn(medicationName);

			try {
				const { editor } = await openMedicationDetailForEdit(page, medication.id, medicationName);
				const form = editor.locator("form.form-grid");
				const nameInput = form.getByRole("textbox", { name: /^(Commercial Name|Name|form\.name)/i });
				await expect(nameInput).toHaveValue(medicationName);
				await nameInput.fill(unsavedName);

				await editor
					.getByRole("button", { name: /Cancel|common\.cancel/i })
					.last()
					.click();
				let unsavedConfirm = page
					.getByRole("dialog")
					.filter({ hasText: /Unsaved Changes|You have unsaved changes|Unsaved changes/i })
					.last();
				await expect(unsavedConfirm).toBeVisible();
				await unsavedConfirm.getByRole("button", { name: /Back|Stay|common\.stay|Cancel/i }).click();

				await expect(unsavedConfirm).toBeHidden();
				await expect(editor).toBeVisible();
				await expect(nameInput).toHaveValue(unsavedName);

				await editor
					.getByRole("button", { name: /Cancel|common\.cancel/i })
					.last()
					.click();
				unsavedConfirm = page
					.getByRole("dialog")
					.filter({ hasText: /Unsaved Changes|You have unsaved changes|Unsaved changes/i })
					.last();
				await expect(unsavedConfirm).toBeVisible();
				await unsavedConfirm.getByRole("button", { name: /Leave|common\.leave/i }).click();

				const detail = page
					.getByRole("dialog")
					.filter({ has: page.getByRole("heading", { name: medicationName, exact: true }) })
					.last();
				await expect(page).toHaveURL(/\/dashboard$/);
				await expect(editor).toBeHidden();
				await expect(detail).toBeVisible({ timeout: 10000 });

				await page.goBack({ waitUntil: "commit" });
				await expect(detail).toBeHidden();
				expect(await page.evaluate(() => window.history.state?.modal)).not.toBe("medDetail");
			} finally {
				await deleteAllMedicationsViaAPI();
			}
		});

		test("asks before browser back leaves a dirty mobile editor", async ({ page }) => {
			const medicationName = `Detail Direct Back ${Date.now().toString(36)}`;
			const unsavedName = `${medicationName} Unsaved`;
			const medication = await createMedicationForDetailReturn(medicationName);

			try {
				const { editor } = await openMedicationDetailForEdit(page, medication.id, medicationName);
				const form = editor.locator("form.form-grid");
				const nameInput = form.getByRole("textbox", { name: /^(Commercial Name|Name|form\.name)/i });
				await expect(nameInput).toHaveValue(medicationName);
				await nameInput.fill(unsavedName);
				await expect(nameInput).toHaveValue(unsavedName);

				await page.goBack({ waitUntil: "commit" });

				const unsavedConfirm = page
					.getByRole("dialog")
					.filter({ hasText: /Unsaved Changes|You have unsaved changes|Unsaved changes/i })
					.last();
				await expect(unsavedConfirm).toBeVisible();
				await expect(nameInput).toHaveValue(unsavedName);

				await unsavedConfirm.getByRole("button", { name: /Back|Stay|common\.stay|Cancel/i }).click();
				await expect(unsavedConfirm).toBeHidden();
				await expect(editor).toBeVisible();
				await expect(nameInput).toHaveValue(unsavedName);

				await page.goBack({ waitUntil: "commit" });
				const secondConfirm = page
					.getByRole("dialog")
					.filter({ hasText: /Unsaved Changes|You have unsaved changes|Unsaved changes/i })
					.last();
				await expect(secondConfirm).toBeVisible();
				await secondConfirm.getByRole("button", { name: /Leave|common\.leave/i }).click();

				const detail = page
					.getByRole("dialog")
					.filter({ has: page.getByRole("heading", { name: medicationName, exact: true }) })
					.last();
				await expect(page).toHaveURL(/\/dashboard$/);
				await expect(editor).toBeHidden();
				await expect(detail).toBeVisible({ timeout: 10000 });
				await page.goBack({ waitUntil: "commit" });
				await expect(detail).toBeHidden();
				expect(await page.evaluate(() => window.history.state?.modal)).not.toBe("medDetail");
			} finally {
				await deleteAllMedicationsViaAPI();
			}
		});

		test("does not open a detail modal when closing an independent list editor", async ({ page }) => {
			const medicationName = `Independent Edit ${Date.now().toString(36)}`;
			await createMedicationForDetailReturn(medicationName);

			try {
				await navigateTo(page, "/medications");
				const medicationRow = page.getByTestId("medication-row").filter({ hasText: medicationName });
				await expect(medicationRow).toBeVisible({ timeout: 10000 });
				await medicationRow.getByRole("button", { name: /Edit|common\.edit|Bearbeiten/i }).click();

				const editor = page
					.getByRole("dialog")
					.filter({ has: page.getByRole("heading", { name: /Edit|Bearbeiten/i }) })
					.last();
				await expect(editor).toBeVisible();
				await editor
					.getByRole("button", { name: /Close|Schließen/i })
					.first()
					.click();

				await expect(editor).toBeHidden();
				await expect(page).toHaveURL(/\/medications(?:$|\?)/);
				await expect(
					page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: medicationName, exact: true }) })
				).toHaveCount(0);
				await expect(medicationRow).toBeVisible();
			} finally {
				await deleteAllMedicationsViaAPI();
			}
		});
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
