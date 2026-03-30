import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test as setup, type APIResponse, type Cookie } from "@playwright/test";
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

function toBrowserCookie(setCookieHeader: string, baseURL: string): Cookie | null {
	const segments = setCookieHeader
		.split(";")
		.map((segment) => segment.trim())
		.filter(Boolean);
	const [nameValue, ...attributes] = segments;
	if (!nameValue) {
		return null;
	}

	const separatorIndex = nameValue.indexOf("=");
	if (separatorIndex <= 0) {
		return null;
	}

	const cookie: Cookie = {
		name: nameValue.slice(0, separatorIndex),
		value: nameValue.slice(separatorIndex + 1),
		url: baseURL,
		path: "/",
		httpOnly: false,
		secure: false,
		sameSite: "Lax",
	};

	for (const attribute of attributes) {
		const [rawKey, ...rawValueParts] = attribute.split("=");
		const key = rawKey?.toLowerCase();
		const value = rawValueParts.join("=");

		switch (key) {
			case "expires": {
				const expiresAt = Date.parse(value);
				if (!Number.isNaN(expiresAt)) {
					cookie.expires = Math.floor(expiresAt / 1000);
				}
				break;
			}
			case "httponly":
				cookie.httpOnly = true;
				break;
			case "max-age": {
				const seconds = Number.parseInt(value, 10);
				if (Number.isFinite(seconds)) {
					cookie.expires = Math.floor(Date.now() / 1000) + seconds;
				}
				break;
			}
			case "path":
				cookie.path = value || "/";
				break;
			case "samesite":
				cookie.sameSite = /^none$/i.test(value) ? "None" : /^strict$/i.test(value) ? "Strict" : "Lax";
				break;
			case "secure":
				cookie.secure = true;
				break;
		}
	}

	return cookie;
}

async function syncResponseCookiesToBrowserContext(
	page: Parameters<Parameters<typeof setup>[0]>[0]["page"],
	baseURL: string,
	response: APIResponse
): Promise<void> {
	const cookies = response
		.headersArray()
		.filter((header) => header.name.toLowerCase() === "set-cookie")
		.map((header) => toBrowserCookie(header.value, baseURL))
		.filter((cookie): cookie is Cookie => cookie !== null);

	if (cookies.length > 0) {
		await page.context().addCookies(cookies);
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
	setup.setTimeout(120000);
	await applyVideoSafetyMode(page);

	// Create .auth directory if it doesn't exist
	const authDir = path.dirname(authFile);
	if (!fs.existsSync(authDir)) {
		fs.mkdirSync(authDir, { recursive: true });
	}

	// ---- 1. Try to reuse an existing auth file (offline check only) ----
	if (fs.existsSync(authFile)) {
		try {
			const saved = JSON.parse(fs.readFileSync(authFile, "utf-8"));
			const accessCookie = saved.cookies?.find((c: { name: string }) => c.name === "access_token");
			if (accessCookie?.value && isTokenValid(accessCookie.value)) {
				// Keep going and verify the session online. A JWT can be time-valid but
				// still rejected by backend token rotation/restart.
			}
		} catch {
			// Invalid file — fall through to regular login
		}
	}

	// ---- 2. Fast path: already authenticated session ----
	await page.goto("/");
	const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";
	let authEnabled = true;
	let formLoginEnabled = true;
	let oidcEnabled = false;
	let registrationEnabled = true;
	try {
		const stateRes = await page.request.get(`${baseURL}/api/auth/state`);
		if (stateRes.ok()) {
			const state = await stateRes.json();
			authEnabled = state.authEnabled === true;
			formLoginEnabled = state.formLoginEnabled !== false;
			oidcEnabled = state.oidcEnabled === true;
			registrationEnabled = state.registrationEnabled !== false;
		}
	} catch {
		// Fallback: assume auth is enabled and form login is available.
	}

	// ---- 3. Check if auth is disabled ----
	if (!authEnabled) {
		await page.context().storageState({ path: authFile });
		return;
	}

	const hasUserMenu = await page
		.locator(".user-menu-btn")
		.isVisible({ timeout: 5000 })
		.catch(() => false);
	if (hasUserMenu) {
		await page.context().storageState({ path: authFile });
		return;
	}

	const hasAuthenticatedSession = await page.request
		.get(`${baseURL}/api/auth/me`)
		.then((response) => response.ok())
		.catch(() => false);
	if (hasAuthenticatedSession) {
		await page.goto("/");
		await expect(page.locator(".user-menu-btn")).toBeVisible({ timeout: 15000 });
		await page.context().storageState({ path: authFile });
		return;
	}

	const hasAuthContainer = await page
		.locator(".auth-container")
		.isVisible({ timeout: 5000 })
		.catch(() => false);
	if (!hasAuthContainer) {
		const hasLoginFields = await page
			.locator("#username")
			.isVisible({ timeout: 5000 })
			.catch(() => false);
		if (!hasLoginFields) {
			const becameAuthenticated = await page
				.locator("header.hero")
				.isVisible({ timeout: 5000 })
				.catch(() => false);
			if (becameAuthenticated) {
				await page.context().storageState({ path: authFile });
				return;
			}
		}
	}

	const loginWithApi = async () => {
		const res = await page.request.post(`${baseURL}/api/auth/login`, {
			data: { username: TEST_USER.username, password: TEST_USER.password, rememberMe: false },
		});

		if (res.ok()) {
			await syncResponseCookiesToBrowserContext(page, baseURL, res);
		}

		const bodyText = await res.text().catch(() => "");

		return {
			bodyText,
			ok: res.ok(),
			status: res.status(),
		};
	};

	const loginWithApiRetry = async (maxAttempts = 5) => {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const result = await loginWithApi();
			if (result.ok) {
				return true;
			}

			const isRateLimited = result.status === 429 || /too many attempts/i.test(result.bodyText);
			if (!isRateLimited || attempt === maxAttempts) {
				return false;
			}

			await page.waitForTimeout(1000 * attempt);
		}

		return false;
	};

	const registerWithApi = async () => {
		await page.request
			.post(`${baseURL}/api/auth/register`, {
				data: { username: TEST_USER.username, password: TEST_USER.password },
			})
			.catch(() => {});
	};

	const ensureAuthenticated = async () => {
		const hasHeader = await page
			.locator("header.hero")
			.isVisible({ timeout: 8000 })
			.catch(() => false);
		if (hasHeader) return true;

		const meRes = await page.request.get(`${baseURL}/api/auth/me`).catch(() => null);
		return Boolean(meRes?.ok());
	};

	const hasBrowserAccessCookie = async () => {
		const cookies = await page.context().cookies(baseURL);
		return cookies.some((cookie) => cookie.name === "access_token");
	};

	// ---- 5. Log in via the appropriate method ----
	if (formLoginEnabled) {
		let loggedIn = await loginWithApiRetry();

		if (!loggedIn && registrationEnabled) {
			await registerWithApi();
			loggedIn = await loginWithApiRetry();
		}

		if (loggedIn && (await hasBrowserAccessCookie())) {
			await page.goto("/");
			const isAuthenticated = await ensureAuthenticated();
			if (!isAuthenticated) {
				throw new Error("Authentication succeeded but app shell did not become ready");
			}
			await page.context().storageState({ path: authFile });
			return;
		}

		// Fallback path for environments where API login flow is unavailable.
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
			const submitButton = page.locator('button.auth-submit[type="submit"]');
			await expect(submitButton).toBeEnabled({ timeout: 15000 });
			await submitButton.click();
		};

		await loginWithForm();
		const hasHeroAfterFirstLogin = await page
			.locator("header.hero")
			.isVisible({ timeout: 5000 })
			.catch(() => false);

		if (!hasHeroAfterFirstLogin && registrationEnabled) {
			await registerWithApi();

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

	// Wait for successful auth. Prefer app header visibility, but allow verified
	// authenticated API state for environments where shell render is delayed.
	const isAuthenticated = await ensureAuthenticated();
	if (!isAuthenticated) {
		throw new Error("Authentication completed but no authenticated app state was detected");
	}

	// Persist authenticated state for all test projects
	await page.context().storageState({ path: authFile });
});
