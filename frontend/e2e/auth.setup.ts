import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { TEST_USER } from "./fixtures";

const authFile = path.join(import.meta.dirname, ".auth", "user.json");

/**
 * Global setup for authentication
 * This runs before all tests to ensure a test user exists and stores the authenticated state
 */
setup("authenticate", async ({ page }) => {
	// Create .auth directory if it doesn't exist
	const authDir = path.dirname(authFile);
	if (!fs.existsSync(authDir)) {
		fs.mkdirSync(authDir, { recursive: true });
	}

	await page.goto("/");

	// Wait for the app to fully load (network idle + content visible)
	await page.waitForLoadState("networkidle");
	await expect(page.locator("body")).not.toHaveText(/^$/, { timeout: 15000 });

	// Check if auth is disabled (we can access dashboard directly)
	const dashboardVisible = await page
		.getByText(/dashboard|medications|schedule/i)
		.isVisible()
		.catch(() => false);
	if (dashboardVisible) {
		// Auth is disabled - save empty state and return
		await page.context().storageState({ path: authFile });
		return;
	}

	// Check if we need to register (first user setup)
	const needsSetup = await page
		.getByText(/create.*first.*user|create.*account|register|first user setup/i)
		.isVisible()
		.catch(() => false);

	if (needsSetup) {
		// Register the test user
		const usernameField = page.getByLabel(/username/i);
		const passwordField = page.getByLabel(/password/i).first();

		await usernameField.fill(TEST_USER.username);
		await passwordField.fill(TEST_USER.password);

		// Look for register/create button
		const registerButton = page.getByRole("button", { name: /register|create|sign up/i });
		await registerButton.click();

		// Wait for successful registration and redirect
		await expect(page.getByRole("navigation")).toBeVisible({ timeout: 15000 });
	} else {
		// Need to login
		const usernameField = page.getByLabel(/username/i);
		const passwordField = page.getByLabel(/password/i);

		// Check if we're on login page
		if (await usernameField.isVisible().catch(() => false)) {
			await usernameField.fill(TEST_USER.username);
			await passwordField.fill(TEST_USER.password);

			const loginButton = page.getByRole("button", { name: /sign in|log in|login/i });
			await loginButton.click();

			// Wait for successful login
			await expect(page.getByRole("navigation")).toBeVisible({ timeout: 15000 });
		}
	}

	// Save the authenticated state
	await page.context().storageState({ path: authFile });
});
