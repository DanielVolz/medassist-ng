import { expect, test } from "@playwright/test";

/**
 * Authentication E2E Tests
 *
 * Tests the login/register UI when not authenticated.
 * Uses empty storage state to simulate unauthenticated access.
 *
 * NOTE: This file intentionally imports `test` from @playwright/test
 * (not from fixtures) because auth tests use empty storageState and
 * must NOT have the auth-me caching interceptor.
 */
test.describe("Authentication", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("should show login page for unauthenticated users", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Should have the app title
		await expect(page.locator(".auth-title")).toContainText("MedAssist-ng");
	});

	test("should have username and password fields", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		const usernameField = page.locator("#username");
		const passwordField = page.locator("#password");

		await expect(usernameField).toBeVisible();
		await expect(usernameField).toBeEnabled();
		await expect(passwordField).toBeVisible();
		await expect(passwordField).toBeEnabled();
	});

	test("should have a submit button", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		const submitButton = page.locator('button.auth-submit[type="submit"]');
		await expect(submitButton).toBeVisible();
		await expect(submitButton).toBeEnabled();
	});

	test("should not navigate to dashboard without credentials", async ({ page }) => {
		await page.goto("/dashboard");

		// Should NOT show the app header (redirected to login)
		await expect(page.locator("header.hero")).not.toBeVisible({ timeout: 10000 });

		// Should show auth form instead
		await expect(page.locator(".auth-container")).toBeVisible();
	});

	test("should show error for invalid credentials", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Fill in invalid credentials
		await page.locator("#username").fill("nonexistent-user");
		await page.locator("#password").fill("wrongpassword");
		await page.locator('button.auth-submit[type="submit"]').click();

		// Should show an error message
		await expect(page.locator(".auth-error")).toBeVisible({ timeout: 5000 });
	});

	test("should toggle between login and register forms", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Check current subtitle text
		const subtitle = page.locator(".auth-subtitle");
		const initialText = await subtitle.textContent();

		// Click the toggle link (Create account / Already have an account)
		await page.locator("button.auth-link-btn").click();

		// Subtitle should change
		const newText = await subtitle.textContent();
		expect(newText).not.toBe(initialText);
	});
});
