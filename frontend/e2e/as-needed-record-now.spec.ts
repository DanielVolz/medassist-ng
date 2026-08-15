import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MEDICATION_NAME = "As-needed record now";

test.describe("As-needed Record now", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test.beforeEach(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: MEDICATION_NAME,
			packageType: "blister",
			medicationForm: "tablet",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			intakes: [],
		});
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	for (const viewport of [
		{ name: "desktop", size: { width: 1280, height: 720 } },
		{ name: "mobile", size: { width: 390, height: 844 } },
	]) {
		test(`${viewport.name} includes a recorded as-needed intake in its owner report`, async ({ page }) => {
			await page.setViewportSize(viewport.size);
			await navigateTo(page, "/medications");
			const medication = page.getByTestId("medication-row").filter({ hasText: MEDICATION_NAME });
			await medication.getByRole("button", { name: /Take|Einnehmen/i }).click();
			await page
				.getByRole("dialog")
				.last()
				.getByRole("button", { name: /Take|Einnehmen/i })
				.click();
			await expect(page.getByText(/Medication taken|Medikament eingenommen/i)).toBeVisible();
			const recordModal = page.getByRole("dialog").last();
			await recordModal.getByLabel(/Close|Schließen/i).click();
			await expect(recordModal).toBeHidden();

			await page
				.getByRole("button", { name: /Report|Bericht/i })
				.first()
				.click();
			const reportModal = page.getByRole("dialog").filter({ hasText: /Medication Report|Medikamentenbericht/i });
			await expect(reportModal).toBeVisible();
			const future = new Date(Date.now() + 60_000);
			const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
			await reportModal.locator('input[type="datetime-local"]').last().fill(localFuture);
			await reportModal.locator('label:has(input[name="format"][value="txt"])').click();
			await reportModal.getByRole("button", { name: /Generate|Erstellen/i }).click();
			const preview = reportModal.getByTestId("report-preview");
			await expect(preview).toBeVisible();
			await expect(preview).toContainText(/As-needed intakes|Einnahmen bei Bedarf/i);
			await expect(preview).toContainText(/Active intake count|Aktive Einnahmen/i);
		});

		test(`${viewport.name} safely replays a lost response and reloads stock`, async ({ page }) => {
			await page.setViewportSize(viewport.size);
			await navigateTo(page, "/medications");
			const medication = page.getByTestId("medication-row").filter({ hasText: MEDICATION_NAME });
			await expect(medication).toBeVisible();
			await medication.getByRole("button", { name: /Take|Einnehmen/i }).click();

			let firstServerStatus: number | null = null;
			let firstKey: string | null = null;
			let lostResponse = true;
			await page.route("**/api/medications/*/as-needed-intakes", async (route) => {
				if (!lostResponse) return route.continue();
				lostResponse = false;
				firstKey = await route.request().headerValue("idempotency-key");
				const response = await route.fetch();
				firstServerStatus = response.status();
				await route.abort("connectionreset");
			});

			await page
				.getByRole("dialog")
				.last()
				.getByRole("button", { name: /Take|Einnehmen/i })
				.click();
			await expect(page.getByText(/result is uncertain|Ergebnis.*unklar/i)).toBeVisible();

			const replay = page.waitForResponse((response) => response.url().includes("/as-needed-intakes"));
			const reload = page.waitForResponse((response) =>
				response.url().includes("/api/medications?includeObsolete=true")
			);
			await page.getByRole("button", { name: /Retry|Erneut/i }).click();
			const replayResponse = await replay;
			const reloadResponse = await reload;
			expect(firstServerStatus).toBe(201);
			expect(replayResponse.status()).toBe(200);
			expect(await replayResponse.request().headerValue("idempotency-key")).toBe(firstKey);
			expect((await reloadResponse.json()) as Array<{ asNeededStockEffect?: number }>).toEqual(
				expect.arrayContaining([expect.objectContaining({ asNeededStockEffect: 1 })])
			);
			await expect(page.getByText(/Medication taken|Medikament eingenommen/i)).toBeVisible();
			await expect(medication).toContainText(/9\s*\/\s*10/);
		});
	}

	for (const viewport of [
		{ name: "desktop detail", size: { width: 1280, height: 720 } },
		{ name: "mobile detail", size: { width: 390, height: 844 } },
	]) {
		test(`${viewport.name} records from medication detail and refreshes its history`, async ({ page }) => {
			await page.setViewportSize(viewport.size);
			await navigateTo(page, "/dashboard");
			const overview = page.getByTestId("dashboard-overview-table");
			await expect(overview).toBeVisible();
			await overview
				.getByTestId("dashboard-overview-row")
				.filter({ hasText: MEDICATION_NAME })
				.getByRole("button", { name: MEDICATION_NAME })
				.click();

			const detail = page
				.getByRole("dialog")
				.filter({ has: page.getByRole("heading", { name: MEDICATION_NAME }) })
				.last();
			await expect(detail).toBeVisible();
			await expect(detail.getByText(/As-needed history|Bei-Bedarf-Verlauf/i)).toBeVisible();
			await detail.getByRole("button", { name: /Take|Einnehmen/i }).click();

			const create = page.waitForResponse(
				(response) => response.url().includes("/as-needed-intakes") && response.request().method() === "POST"
			);
			await page
				.getByRole("dialog")
				.last()
				.getByRole("button", { name: /Take|Einnehmen/i })
				.click();
			expect((await create).status()).toBe(201);
			await expect(page.getByText(/Medication taken|Medikament eingenommen/i)).toBeVisible();
			await page.goBack();
			await expect(detail).toBeVisible();
			await expect(detail.locator("article").first()).toContainText(/0\.5/);
			await detail
				.getByLabel(/Close|Schließen/i)
				.first()
				.click();
			await expect(detail).toBeHidden();
		});
	}

	test("records a named fractional tablet from the list, audits its correction, and locks the reversed journal", async ({
		page,
	}) => {
		const name = "As-needed correction tablet";
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name,
			takenBy: ["Alice"],
			packageType: "blister",
			medicationForm: "tablet",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			intakes: [],
		});

		await page.setViewportSize({ width: 1280, height: 720 });
		await navigateTo(page, "/medications");
		const medication = page.getByTestId("medication-row").filter({ hasText: name });
		await medication.getByRole("button", { name: /Take|Einnehmen/i }).click();
		const recordModal = page.getByRole("dialog").last();
		await recordModal.getByLabel(/Person|Person/i).selectOption("Alice");
		await recordModal.getByRole("button", { name: /Take|Einnehmen/i }).click();
		await expect(recordModal.getByText(/Current stock:\s*9|Aktueller Bestand:\s*9/i)).toBeVisible();
		await recordModal.getByLabel(/Close|Schließen/i).click();

		await navigateTo(page, "/dashboard");
		const overview = page.getByTestId("dashboard-overview-table");
		await overview
			.getByTestId("dashboard-overview-row")
			.filter({ hasText: name })
			.getByRole("button", { name })
			.click();
		const detail = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name }) })
			.last();
		const history = detail.getByRole("region", { name: /As-needed history|Bei-Bedarf-Verlauf/i });
		await expect(history.getByText("Alice", { exact: true })).toBeVisible();

		await history.getByRole("button", { name: /Add journal|Journal hinzufügen/i }).click();
		let journal = page.locator(".journal-modal");
		await journal.getByRole("textbox").fill("Initial correction journal");
		await journal.getByRole("button", { name: /Save|Speichern/i }).click();
		await expect(journal).toBeHidden();

		await history.getByRole("button", { name: /Edit journal|Journal bearbeiten/i }).click();
		journal = page.locator(".journal-modal");
		await journal.getByRole("textbox").fill("Updated correction journal");
		await journal.getByRole("button", { name: /Save|Speichern/i }).click();
		await expect(journal).toBeHidden();
		await expect(history.getByText("Updated correction journal")).toBeVisible();

		await history.getByRole("button", { name: /Edit journal|Journal bearbeiten/i }).click();
		journal = page.locator(".journal-modal");
		await journal.getByRole("button", { name: /Delete|Löschen/i }).click();
		await expect(journal).toBeHidden();

		await history.getByRole("button", { name: /Add journal|Journal hinzufügen/i }).click();
		journal = page.locator(".journal-modal");
		await journal.getByRole("textbox").fill("Retained reversed journal");
		await journal.getByRole("button", { name: /Save|Speichern/i }).click();
		await expect(journal).toBeHidden();

		await history.getByRole("button", { name: /Reverse|Stornieren/i }).click();
		const reversal = page.getByRole("dialog").last();
		await reversal.getByRole("button", { name: /Reverse intake|Einnahme stornieren/i }).click();
		await expect(history.getByText(/Reversed|Storniert/i)).toBeVisible();

		await history.getByRole("button", { name: /View journal|Journal ansehen/i }).click();
		journal = page.locator(".journal-modal");
		await expect(journal.getByRole("textbox")).toHaveValue("Retained reversed journal");
		await expect(journal.getByRole("textbox")).toHaveAttribute("readonly", "");
		await expect(journal.getByRole("button", { name: /Save|Speichern/i })).toHaveCount(0);
		await expect(journal.getByRole("button", { name: /Delete|Löschen/i })).toHaveCount(0);
		await journal.getByLabel(/Close|Schließen/i).click();

		await history.getByRole("button", { name: /Record correction|Korrektur erfassen/i }).click();
		const replacement = page.getByRole("dialog", { name: /Record corrected intake|Korrigierte Einnahme erfassen/i });
		await replacement.getByRole("button", { name: /Record correction|Korrektur erfassen/i }).click();
		await expect(replacement.getByText(/Correction recorded|Korrektur erfasst/i)).toBeVisible({ timeout: 15_000 });
		await replacement.getByLabel(/Close|Schließen/i).click();
		await expect(history.getByText(/Correction of event|Korrektur von Ereignis/i)).toBeVisible();
		await expect(history.getByText(/^(Active|Aktiv)$/i)).toBeVisible();
	});

	test("records a topical None/self application from mobile detail without reducing measured stock", async ({
		page,
	}) => {
		const name = "As-needed topical self";
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name,
			packageType: "tube",
			medicationForm: "topical",
			packageAmountValue: 30,
			looseTablets: 30,
			intakes: [],
		});

		await page.setViewportSize({ width: 390, height: 844 });
		await navigateTo(page, "/dashboard");
		const overview = page.getByTestId("dashboard-overview-table");
		await overview
			.getByTestId("dashboard-overview-row")
			.filter({ hasText: name })
			.getByRole("button", { name })
			.click();
		const detail = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name }) })
			.last();
		await detail.getByRole("button", { name: /Take|Einnehmen/i }).click();
		const recordModal = page.getByRole("dialog").last();
		await recordModal.getByLabel(/Person|Person/i).selectOption("");
		await expect(recordModal.getByText(/without changing the measured stock|ohne.*Bestand/i)).toBeVisible();
		await recordModal.getByRole("button", { name: /Take|Einnehmen/i }).click();
		await expect(recordModal.getByText(/Current stock:\s*30|Aktueller Bestand:\s*30/i)).toBeVisible();
		await recordModal.getByLabel(/Close|Schließen/i).click();
		await expect(detail.getByText(/No measurable stock effect|Kein messbarer Bestandseffekt/i)).toBeVisible();
	});
});
