import { expect, test } from "@playwright/test";

const emptyStorageState = { cookies: [], origins: [] };

function authResponse(path: string) {
	return (response: { url(): string; request(): { method(): string } }) =>
		response.url().includes(path) && response.request().method() !== "OPTIONS";
}

/**
 * This spec deliberately bypasses the shared fixture to verify real browser
 * requests to /api/auth/me and the full cookie-backed session lifecycle.
 */
test.describe("Auth browser session", () => {
	test.describe.configure({ mode: "serial", retries: 0 });
	test.use({ storageState: emptyStorageState });

	test("enforces an empty-session lifecycle through login, rotation, logout, and expiry", async ({
		baseURL,
		browser,
		context,
		page,
	}) => {
		const username = `auth-session-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
		const email = `${username}@medassist.test`;
		const password = `E2e-${crypto.randomUUID()}-Pass1`;

		await expect(context.cookies()).resolves.toEqual([]);
		expect((await page.request.get("/api/auth/me")).status()).toBe(401);
		expect((await page.request.get("/api/medications")).status()).toBe(401);

		await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("app-header")).not.toBeVisible();
		await expect(page.locator(".auth-container")).toBeVisible();

		await page.getByRole("button", { name: /create account/i }).click();
		await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
		await page.locator("#username").fill(username);
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(password);
		await page.locator("#confirmPassword").fill(password);
		await page.getByRole("button", { name: /create account/i }).click();
		await expect(page.getByTestId("app-header")).toBeVisible();

		await page.getByTestId("user-menu-trigger").click();
		const registrationLogout = page.waitForResponse(authResponse("/api/auth/logout"));
		await page.getByTestId("user-menu-signout").click();
		expect((await registrationLogout).status()).toBe(200);
		await expect(page.locator(".auth-container")).toBeVisible();

		await page.locator("#username").fill(username);
		await page.locator("#password").fill(password);
		await page.getByRole("checkbox", { name: /remember me/i }).check();
		const loginResponse = page.waitForResponse(authResponse("/api/auth/login"));
		await page.getByRole("button", { name: /^login$/i }).click();
		expect((await loginResponse).status()).toBe(200);
		await expect(page.getByTestId("app-header")).toBeVisible();

		const rememberedCookies = await context.cookies(baseURL);
		expect(rememberedCookies.find((cookie) => cookie.name === "access_token")?.expires).toBeGreaterThan(
			Date.now() / 1000
		);
		const originalRefreshToken = rememberedCookies.find((cookie) => cookie.name === "refresh_token");
		expect(originalRefreshToken?.expires).toBeGreaterThan(Date.now() / 1000);
		expect(originalRefreshToken).toBeDefined();

		const persistedState = await context.storageState();
		const restoredContext = await browser.newContext({ storageState: persistedState });
		const restoredPage = await restoredContext.newPage();
		const restoredMe = restoredPage.waitForResponse(authResponse("/api/auth/me"));
		await restoredPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await expect(restoredPage.getByTestId("app-header")).toBeVisible();
		expect((await restoredMe).status()).toBe(200);

		await restoredContext.clearCookies({ name: "access_token" });
		const withoutAccessCookie = await restoredContext.cookies(baseURL);
		expect(withoutAccessCookie.some((cookie) => cookie.name === "access_token")).toBe(false);
		expect(withoutAccessCookie.some((cookie) => cookie.name === "refresh_token")).toBe(true);

		const refreshed = restoredPage.waitForResponse(authResponse("/api/auth/refresh"));
		await restoredPage.reload({ waitUntil: "domcontentloaded" });
		expect((await refreshed).status()).toBe(200);
		await expect(restoredPage.getByTestId("app-header")).toBeVisible();

		const rotatedRefreshToken = (await restoredContext.cookies(baseURL)).find(
			(cookie) => cookie.name === "refresh_token"
		);
		expect(rotatedRefreshToken?.value).not.toBe(originalRefreshToken?.value);
		expect(rotatedRefreshToken).toBeDefined();

		const replayContext = await browser.newContext({ storageState: emptyStorageState });
		await replayContext.addCookies([originalRefreshToken!]);
		expect((await replayContext.request.post(`${baseURL}/api/auth/refresh`)).status()).toBe(401);
		await replayContext.close();

		await restoredPage.getByTestId("user-menu-trigger").click();
		const logoutResponse = restoredPage.waitForResponse(authResponse("/api/auth/logout"));
		await restoredPage.getByTestId("user-menu-signout").click();
		expect((await logoutResponse).status()).toBe(200);
		await expect(restoredPage.locator(".auth-container")).toBeVisible();
		expect(await restoredContext.cookies(baseURL)).toEqual([]);

		const expiredContext = await browser.newContext({ storageState: emptyStorageState });
		await expiredContext.addCookies([rotatedRefreshToken!]);
		expect((await expiredContext.request.get(`${baseURL}/api/auth/me`)).status()).toBe(401);
		expect((await expiredContext.request.get(`${baseURL}/api/medications`)).status()).toBe(401);
		const expiredPage = await expiredContext.newPage();
		await expiredPage.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
		await expect(expiredPage.getByText(/session expired/i)).not.toBeVisible();
		await expect(expiredPage.getByTestId("app-header")).not.toBeVisible();
		await expiredContext.close();
		await restoredContext.close();
	});
});
