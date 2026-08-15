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
			await medication.getByRole("button", { name: /Record now|Jetzt erfassen/i }).click();
			await page.getByRole("button", { name: /Record intake|Einnahme erfassen/i }).click();
			await expect(page.getByText(/Intake recorded|Einnahme erfasst/i)).toBeVisible();
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
			await medication.getByRole("button", { name: /Record now|Jetzt erfassen/i }).click();

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

			await page.getByRole("button", { name: /Record intake|Einnahme erfassen/i }).click();
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
				expect.arrayContaining([expect.objectContaining({ asNeededStockEffect: 0.5 })])
			);
			await expect(page.getByText(/Intake recorded|Einnahme erfasst/i)).toBeVisible();
			await expect(medication).toContainText(/9\.5\s*\/\s*10/);
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
			await detail.getByRole("button", { name: /Record now|Jetzt erfassen/i }).click();

			const create = page.waitForResponse(
				(response) => response.url().includes("/as-needed-intakes") && response.request().method() === "POST"
			);
			await page.getByRole("button", { name: /Record intake|Einnahme erfassen/i }).click();
			expect((await create).status()).toBe(201);
			await expect(page.getByText(/Intake recorded|Einnahme erfasst/i)).toBeVisible();
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
});
