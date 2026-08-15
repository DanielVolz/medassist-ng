import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MEDICATION_NAME = "As-needed take polish";

test.describe("As-needed Take polish", () => {
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
		await createMedicationViaAPI({
			name: "Existing person source",
			takenBy: ["Ava"],
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
		test(`${viewport.name} keeps the dashboard stable while Take refreshes silently`, async ({ page }) => {
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
			await detail.getByRole("button", { name: "Take", exact: true }).click();
			const modal = page.getByRole("dialog", { name: "Take as-needed medication" });
			await expect(modal).toBeVisible();
			await expect(modal.locator("#record-now-quantity")).toHaveValue("1");
			await expect(modal.getByLabel("Person")).toHaveText(/Ava/);

			let releaseRefresh: (() => void) | undefined;
			let refreshStarted = false;
			await page.route("**/api/medications?includeObsolete=true", async (route) => {
				refreshStarted = true;
				await new Promise<void>((resolve) => {
					releaseRefresh = resolve;
				});
				await route.continue();
			});

			await modal.getByRole("button", { name: "Take", exact: true }).click();
			await expect(modal.getByText("Medication taken")).toBeVisible();
			await expect.poll(() => refreshStarted).toBe(true);
			await expect(page.locator(".dashboard-card-skeleton")).toHaveCount(0);

			const gap = await modal.evaluate((dialog) => {
				const alert = dialog.querySelector<HTMLElement>("[role='alert']");
				const footer = dialog.querySelector<HTMLElement>("[data-testid='app-modal-footer']");
				if (!alert || !footer) throw new Error("Take modal success alert or footer is missing");
				return footer.getBoundingClientRect().top - alert.getBoundingClientRect().bottom;
			});
			expect(gap).toBeGreaterThanOrEqual(12);

			releaseRefresh?.();
			await expect.poll(() => refreshStarted).toBe(true);
			await expect(detail).toContainText("9 / 10");
		});
	}
});
