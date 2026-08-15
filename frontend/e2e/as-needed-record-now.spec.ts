import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const medicationName = "As-needed Take and Undo";

test.describe("As-needed Take and Undo history", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test.beforeEach(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
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
		test(`${viewport.name} takes and undoes a bounded active-only intake history without a global reload`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport.size);
			await navigateTo(page, "/dashboard");
			const overview = page.getByTestId("dashboard-overview-table");
			await overview
				.getByTestId("dashboard-overview-row")
				.filter({ hasText: medicationName })
				.getByRole("button", { name: medicationName })
				.click();

			const detail = page
				.getByRole("dialog")
				.filter({ has: page.getByRole("heading", { name: medicationName }) })
				.last();
			const history = detail.getByRole("button", { name: "As-needed intake history" });
			await expect(history).toHaveAttribute("aria-expanded", "false");

			await detail.getByRole("button", { name: "Take", exact: true }).click();
			const takeModal = page.getByRole("dialog", { name: "Take as-needed medication" });
			const takeResponse = page.waitForResponse(
				(response) => response.url().includes("/as-needed-intakes") && response.request().method() === "POST"
			);
			await takeModal.getByRole("button", { name: "Take", exact: true }).click();
			expect((await takeResponse).status()).toBe(201);
			await expect(takeModal.getByText("Medication taken")).toBeVisible();
			await takeModal.getByLabel("Close").click();

			const historyResponse = page.waitForResponse(
				(response) => response.url().includes("/as-needed-intakes") && response.request().method() === "GET"
			);
			await history.click();
			const requestUrl = new URL((await historyResponse).url());
			expect(requestUrl.searchParams.get("includeReversed")).toBe("false");
			expect(requestUrl.searchParams.get("limit")).toBe("10");
			await expect(detail.getByText("1 pill")).toBeVisible();
			await expect(detail.getByText(/Reverse|Correct|Correction|Reversed/)).toHaveCount(0);

			let releaseRefresh: (() => void) | undefined;
			let refreshStarted = false;
			await page.route("**/api/medications?includeObsolete=true", async (route) => {
				refreshStarted = true;
				await new Promise<void>((resolve) => {
					releaseRefresh = resolve;
				});
				await route.continue();
			});
			const undoResponse = page.waitForResponse(
				(response) => response.url().includes("/api/as-needed-intakes/") && response.request().method() === "DELETE"
			);
			await detail.getByRole("button", { name: "Undo" }).click();
			expect((await undoResponse).status()).toBe(204);
			await expect.poll(() => refreshStarted).toBe(true);
			await expect(page.locator(".dashboard-card-skeleton")).toHaveCount(0);
			await expect(detail.getByText("1 pill")).toHaveCount(0);

			releaseRefresh?.();
			await expect(detail).toContainText("10 / 10");
		});
	}
});
