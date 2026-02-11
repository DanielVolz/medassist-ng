import * as fs from "node:fs";
import * as path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/** Storage state path for authenticated sessions */
export const authFile = path.join(import.meta.dirname, "..", ".auth", "user.json");

/**
 * Test user credentials for E2E tests.
 * Override with PLAYWRIGHT_USERNAME / PLAYWRIGHT_PASSWORD env vars.
 * The setup script registers this user if it doesn't exist and registration is enabled.
 */
export const TEST_USER = {
	username: process.env.PLAYWRIGHT_USERNAME || "e2e-test-user",
	password: process.env.PLAYWRIGHT_PASSWORD || "TestPassword123!",
} as const;

// ---------------------------------------------------------------------------
// Auth-me response mocking
// ---------------------------------------------------------------------------
// The backend rate-limits /auth/me to 10 req/min.  Because every page
// navigation triggers the React app's auth-state check (which calls
// /auth/me), running 50+ E2E tests in a single suite easily exceeds the
// limit.
//
// Solution: build a synthetic /auth/me response from the JWT payload
// stored in the auth file.  This avoids all /auth/me network requests
// from test pages, completely eliminating rate-limit issues while still
// testing the real backend for all other API calls.
// ---------------------------------------------------------------------------
let mockMeBody: string | null = null;

function getMockAuthMeBody(): string | null {
	if (mockMeBody) return mockMeBody;
	try {
		const state = JSON.parse(fs.readFileSync(authFile, "utf-8"));
		const token = state.cookies?.find((c: { name: string }) => c.name === "access_token")?.value;
		if (!token) return null;
		const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
		mockMeBody = JSON.stringify({
			id: payload.sub,
			username: payload.username,
			avatarUrl: null,
			authProvider: "local",
			createdAt: new Date().toISOString(),
			lastLoginAt: new Date().toISOString(),
		});
		return mockMeBody;
	} catch {
		return null;
	}
}

async function setupAuthMeMock(page: Page): Promise<void> {
	const body = getMockAuthMeBody();
	if (body) {
		await page.route("**/api/auth/me", (route) =>
			route.fulfill({ status: 200, contentType: "application/json", body }),
		);
	}
}

/**
 * Extended test fixture that automatically mocks /auth/me on every page
 * using user data from the JWT in the stored auth file.
 *
 * Import this `test` (instead of `@playwright/test`) in every spec file
 * that logs in via `storageState: authFile`.
 *
 * auth.spec.ts should keep importing from `@playwright/test` directly
 * since it tests the unauthenticated flow.
 */
export const test = base.extend<{}>({
	page: async ({ page }, use) => {
		await setupAuthMeMock(page);
		await use(page);
	},
});

/**
 * Wait for the app to be fully loaded past any loading/initializing screens.
 * Includes a single retry with page reload to handle transient auth failures
 * (e.g. brief race between context setup and cookie application).
 */
export async function waitForAppReady(page: Page): Promise<void> {
	const hero = page.locator("header.hero");
	try {
		await expect(hero).toBeVisible({ timeout: 5000 });
	} catch {
		// Auth might have failed transiently — reload and retry once
		await page.reload();
		await expect(hero).toBeVisible({ timeout: 15000 });
	}
}

/**
 * Navigate to a page and wait for it to be ready.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await waitForAppReady(page);
}

/**
 * Click a navigation tab by its text.
 */
export async function clickNavTab(page: Page, tabName: string): Promise<void> {
	await page.locator(`button.pill:has-text("${tabName}")`).click();
}

/**
 * Open the user dropdown menu (when auth is enabled).
 */
export async function openUserMenu(page: Page): Promise<void> {
	await page.locator(".user-menu-btn").click();
	await expect(page.locator(".user-dropdown")).toBeVisible();
}

/**
 * Sign out via the user dropdown menu.
 */
export async function signOut(page: Page): Promise<void> {
	await openUserMenu(page);
	await page.locator('.dropdown-item:has-text("Sign Out")').click();
	// Should redirect to login page
	await expect(page.locator(".auth-container")).toBeVisible({ timeout: 10000 });
}

// Re-export expect for convenience
export { expect };
