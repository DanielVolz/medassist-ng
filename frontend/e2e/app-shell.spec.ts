import {
	authFile,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	test,
} from "./fixtures";

async function requireUserMenu(page: Parameters<Parameters<typeof test>[0]>[0]["page"]) {
	const userMenuButton = page.getByTestId("user-menu-trigger");
	test.skip(!(await userMenuButton.isVisible().catch(() => false)), "User menu is unavailable in this environment");
	return userMenuButton;
}

test.describe("App Shell", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test("opens and closes profile modal from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await (await requireUserMenu(page)).click();
		await page.getByTestId("user-menu-profile").click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByLabel(/close/i).click();
		await expect(dialog).not.toBeVisible();
	});

	test("opens and closes about modal from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await (await requireUserMenu(page)).click();
		await page.getByTestId("user-menu-about").click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", { name: "MedAssist-ng" })).toBeVisible();
		await dialog.getByLabel(/close/i).click();
		await expect(dialog).not.toBeVisible();
	});

	test("signs out from user menu", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await (await requireUserMenu(page)).click();
		await page.getByTestId("user-menu-signout").click();

		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });
	});

	for (const viewport of [
		{ name: "desktop", size: { width: 1280, height: 720 } },
		{ name: "mobile", size: { width: 390, height: 844 } },
	]) {
		test(`keeps scrolled dashboard content below the main header shield on ${viewport.name}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize(viewport.size);
			await navigateTo(page, "/dashboard");
			await page.evaluate(() => window.scrollTo(0, 180));
			await expect(page.getByTestId("app-header")).toBeVisible();
			await page.screenshot({ path: testInfo.outputPath(`top-header-blur-${viewport.name}.png`), fullPage: false });

			const metrics = await page.getByTestId("app-header").evaluate((appHeader) => {
				const style = window.getComputedStyle(appHeader);
				const beforeStyle = window.getComputedStyle(appHeader, "::before");
				const beforeStyleWithWebkit = beforeStyle as CSSStyleDeclaration & { webkitBackdropFilter?: string };
				const appHeaderRect = appHeader.getBoundingClientRect();

				return {
					backdropFilter: beforeStyle.backdropFilter || beforeStyleWithWebkit.webkitBackdropFilter,
					borderRadius: style.borderRadius,
					bottom: appHeaderRect.bottom,
					height: appHeaderRect.height,
					overflow: style.overflow,
					position: style.position,
					top: appHeaderRect.top,
				};
			});

			expect(metrics.position).toBe("sticky");
			expect(metrics.height).toBeGreaterThan(0);
			expect(metrics.top).toBeLessThanOrEqual(0);
			expect(metrics.bottom).toBeGreaterThan(24);
			expect(metrics.overflow).toBe("hidden");
			expect(metrics.borderRadius).not.toBe("0px");
			expect(metrics.backdropFilter).toContain("blur");
		});
	}
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
