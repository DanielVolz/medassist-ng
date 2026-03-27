import {
	authFile,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	test,
} from "./fixtures";

test.describe("App Shell", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test("opens and closes profile modal from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator(".user-menu-btn").click();
		await page.locator('.dropdown-item:has-text("Profile")').click();

		await expect(page.locator(".modal-content.profile-modal")).toBeVisible();
		await page.locator(".modal-content.profile-modal .modal-close").click();
		await expect(page.locator(".modal-content.profile-modal")).not.toBeVisible();
	});

	test("opens and closes about modal from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator(".user-menu-btn").click();
		await page.locator('.dropdown-item:has-text("About")').click();

		await expect(page.locator(".modal-content.about-modal")).toBeVisible();
		await expect(page.locator(".about-header h2")).toContainText("MedAssist-ng");
		await page.locator(".modal-content.about-modal .modal-close").click();
		await expect(page.locator(".modal-content.about-modal")).not.toBeVisible();
	});

	test("signs out from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator(".user-menu-btn").click();
		await page.locator('.dropdown-item.danger:has-text("Sign Out")').click();

		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });
	});
});

test.describe("Public Share Routes", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: "Share Overview Redirect Med",
			genericName: "Paracetamol",
			takenBy: ["Alice"],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			intakes: [
				{
					usage: 1,
					every: 1,
					start: new Date().toISOString().slice(0, 16),
					intakeRemindersEnabled: false,
					takenBy: "Alice",
				},
			],
		});
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("redirects /share/:token/overview to /share/:token", async ({ page }) => {
		const shareToken = await createShareTokenViaAPI("Alice", 30);

		await page.goto(`/share/${shareToken.token}/overview`);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveURL(new RegExp(`/share/${shareToken.token}$`));
		await expect(page.locator(".shared-schedule-container")).toBeVisible({ timeout: 15000 });
	});
});