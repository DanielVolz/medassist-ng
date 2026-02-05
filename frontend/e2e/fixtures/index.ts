import * as fs from "node:fs";
import * as path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

// Storage state path for authenticated sessions
const authFile = path.join(import.meta.dirname, "..", ".auth", "user.json");

/**
 * Test user credentials for E2E tests
 * These are used for setting up a test user during the setup phase
 */
export const TEST_USER = {
	username: "e2e-test-user",
	password: "TestPassword123!",
} as const;

/**
 * Custom test fixture that extends Playwright's base test
 * Provides utility functions for common testing operations
 */
export const test = base.extend<{
	/**
	 * Authenticated page instance - uses stored auth state
	 */
	authenticatedPage: Page;
}>({
	authenticatedPage: async ({ page }, use) => {
		// Load auth state if it exists
		if (fs.existsSync(authFile)) {
			const storageState = JSON.parse(fs.readFileSync(authFile, "utf-8"));
			await page.context().addCookies(storageState.cookies || []);
			// Note: localStorage must be set after navigating to the page
		}

		await use(page);
	},
});

/**
 * Helper to wait for the app to be fully loaded
 */
export async function waitForAppReady(page: Page): Promise<void> {
	// Wait for the app to finish loading (no "Loading..." or "Initializing...")
	await expect(page.getByText(/Loading\.\.\.|Initializing\.\.\./i)).not.toBeVisible({
		timeout: 10000,
	});
}

/**
 * Helper to login with the test user
 */
export async function loginTestUser(page: Page): Promise<void> {
	await page.goto("/");
	await waitForAppReady(page);

	// Check if we're already logged in
	const isLoggedIn = await page
		.getByRole("navigation")
		.isVisible()
		.catch(() => false);
	if (isLoggedIn) {
		return;
	}

	// Fill login form
	await page.getByLabel(/username/i).fill(TEST_USER.username);
	await page.getByLabel(/password/i).fill(TEST_USER.password);
	await page.getByRole("button", { name: /sign in|log in|login/i }).click();

	// Wait for successful login
	await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });
}

/**
 * Helper to register a new user (for setup)
 */
export async function registerTestUser(page: Page): Promise<void> {
	await page.goto("/");
	await waitForAppReady(page);

	// Check if we're on the registration page (needs setup)
	const needsSetup = await page
		.getByText(/create.*account|register|first user/i)
		.isVisible()
		.catch(() => false);

	if (needsSetup) {
		// Fill registration form
		await page.getByLabel(/username/i).fill(TEST_USER.username);
		await page
			.getByLabel(/password/i)
			.first()
			.fill(TEST_USER.password);

		// Look for confirm password field if present
		const confirmPassword = page.getByLabel(/confirm.*password/i);
		if (await confirmPassword.isVisible().catch(() => false)) {
			await confirmPassword.fill(TEST_USER.password);
		}

		// Submit registration
		await page.getByRole("button", { name: /register|create|sign up/i }).click();

		// Wait for successful registration
		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10000 });
	}
}

/**
 * Helper to logout
 */
export async function logout(page: Page): Promise<void> {
	// Click on user profile/menu button
	const userButton = page.getByRole("button", { name: /profile|user|account|menu/i });
	if (await userButton.isVisible().catch(() => false)) {
		await userButton.click();
		await page.getByRole("button", { name: /logout|sign out|log out/i }).click();
		await expect(page.getByLabel(/username/i)).toBeVisible({ timeout: 5000 });
	}
}

// Re-export expect for convenience
export { expect };
