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
});
