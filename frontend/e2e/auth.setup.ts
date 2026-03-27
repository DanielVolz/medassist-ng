import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { applyVideoSafetyMode, TEST_USER } from "./fixtures";

const authFile = path.join(import.meta.dirname, ".auth", "user.json");

/**
 * Check if a JWT token is still valid (not expired) without making a
 * network request.  Returns `true` when the token has at least 2 minutes
 * of remaining validity.
 */
function isTokenValid(token: string): boolean {
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
		// Require at least 10 minutes of remaining validity to ensure the token
		// lasts through the entire test run (which can take 7+ minutes)
		return typeof payload.exp === "number" && Date.now() / 1000 < payload.exp - 600;
	} catch {
		return false;
	}
}

/**
 * Global setup: ensure a test user exists and persist authenticated state.
 * Runs once before all test projects.
 *
 * Strategy:
 * 1. If a valid auth file exists whose access_token JWT has not expired,
 *    reuse it without any network call (saves rate-limit budget).
 * 2. If auth is disabled (no login page), save state immediately.
 * 3. Try to register via API (idempotent — fails silently if user exists).
 * 4. Log in via the UI.
 */
setup("authenticate", async ({ page }) => {
	await applyVideoSafetyMode(page);

	// Create .auth directory if it doesn't exist
	const authDir = path.dirname(authFile);
	if (!fs.existsSync(authDir)) {
		fs.mkdirSync(authDir, { recursive: true });
	}

	// ---- 1. Try to reuse an existing auth file (offline check) ----
	if (fs.existsSync(authFile)) {
		try {
			const saved = JSON.parse(fs.readFileSync(authFile, "utf-8"));
			const accessCookie = saved.cookies?.find((c: { name: string }) => c.name === "access_token");
			if (accessCookie?.value && isTokenValid(accessCookie.value)) {
				// Token still has enough validity — skip login entirely
				return;
			}
		} catch {
			// Invalid file — fall through to regular login
		}
	}

	// ---- 2. Check if auth is disabled ----
	await page.goto("/");

	const authDisabled = await page
		.locator("header.hero")
		.isVisible()
		.catch(() => false);
	if (authDisabled) {
		await page.context().storageState({ path: authFile });
		return;
	}

	// Wait for auth container
	await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

	// ---- 3. Query auth state to determine login method ----
	const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";
	let formLoginEnabled = true;
	let oidcEnabled = false;
	let registrationEnabled = true;
	try {
		const stateRes = await page.request.get(`${baseURL}/api/auth/state`);
		if (stateRes.ok()) {
			const state = await stateRes.json();
			formLoginEnabled = state.formLoginEnabled !== false;
			oidcEnabled = state.oidcEnabled === true;
			registrationEnabled = state.registrationEnabled !== false;
		}
	} catch {
		// Fallback: assume form login is available
	}

	// ---- 5. Log in via the appropriate method ----
	if (formLoginEnabled) {
		const loginWithForm = async () => {
			const usernameField = page.locator("#username");
			const passwordField = page.locator("#password");

			// Make sure we're on the login form (not register)
			const isOnRegister = await page
				.locator(".auth-subtitle")
				.filter({ hasText: /Create Account/i })
				.isVisible()
				.catch(() => false);

			if (isOnRegister) {
				const switchBtn = page.locator("button.auth-link-btn");
				if (await switchBtn.isVisible().catch(() => false)) {
					await switchBtn.click();
					await page.waitForTimeout(500);
				}
			}

			await usernameField.clear();
			await usernameField.fill(TEST_USER.username);
			await passwordField.clear();
			await passwordField.fill(TEST_USER.password);

			// Click the submit button (not the SSO button)
			await page.locator('button.auth-submit[type="submit"]').click();
		};

		await loginWithForm();
		const hasHeroAfterFirstLogin = await page
			.locator("header.hero")
			.isVisible({ timeout: 5000 })
			.catch(() => false);

		if (!hasHeroAfterFirstLogin && registrationEnabled) {
			await page.request
				.post(`${baseURL}/api/auth/register`, {
					data: { username: TEST_USER.username, password: TEST_USER.password },
				})
				.catch(() => {});

			await loginWithForm();
		}
	} else if (oidcEnabled) {
		// SSO-only path: click the SSO button and let the OIDC provider handle login.
		// This requires the OIDC provider to be configured with test credentials
		// (e.g. via PLAYWRIGHT_OIDC_USERNAME / PLAYWRIGHT_OIDC_PASSWORD env vars)
		// or to auto-approve the test user.
		await page.locator("button.sso-btn").click();

		// Wait for OIDC redirect and callback — the provider may show its own login form
		const oidcUsername = process.env.PLAYWRIGHT_OIDC_USERNAME;
		const oidcPassword = process.env.PLAYWRIGHT_OIDC_PASSWORD;
		if (oidcUsername && oidcPassword) {
			// Fill OIDC provider login form (generic selectors — override if needed)
			await page.waitForURL(/.*/, { timeout: 15000 });
			const oidcUserField = page.locator('input[name="username"], input[name="login"], input[type="email"]').first();
			const oidcPassField = page.locator('input[name="password"], input[type="password"]').first();
			if (await oidcUserField.isVisible({ timeout: 10000 }).catch(() => false)) {
				await oidcUserField.fill(oidcUsername);
				await oidcPassField.fill(oidcPassword);
				await page.locator('button[type="submit"]').first().click();
			}
		}
	} else {
		throw new Error("No login method available: form login and OIDC are both disabled");
	}

	// Wait for successful auth — app header should appear
	await expect(page.locator("header.hero")).toBeVisible({ timeout: 15000 });

	// Persist authenticated state for all test projects
	await page.context().storageState({ path: authFile });
});
