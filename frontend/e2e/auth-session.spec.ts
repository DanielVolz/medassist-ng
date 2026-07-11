import { expect, test } from "@playwright/test";
import { authFile } from "./fixtures";

/**
 * Authenticated session smoke coverage intentionally bypasses the shared
 * fixture because it must verify the browser's real /api/auth/me requests.
 */
test.describe("Authenticated browser session", () => {
	test.use({ storageState: authFile });

	test("loads an authenticated page and restores the session after reload", async ({ page }) => {
		const firstSessionResponse = page.waitForResponse(
			(response) => response.url().includes("/api/auth/me") && response.request().method() === "GET"
		);

		await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("app-header")).toBeVisible({ timeout: 15000 });
		expect((await firstSessionResponse).status()).toBe(200);

		const restoredSessionResponse = page.waitForResponse(
			(response) => response.url().includes("/api/auth/me") && response.request().method() === "GET"
		);

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("app-header")).toBeVisible({ timeout: 15000 });
		expect((await restoredSessionResponse).status()).toBe(200);
	});
});
