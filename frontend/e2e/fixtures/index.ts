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
			route.fulfill({ status: 200, contentType: "application/json", body })
		);
	}
}

/**
 * Reduce visual flashing in recorded videos by forcing a dark first paint and
 * disabling most animations/transitions in test mode.
 */
export async function applyVideoSafetyMode(page: Page): Promise<void> {
	await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
	await page.addInitScript(() => {
		const style = document.createElement("style");
		style.id = "pw-video-safety-style";
		style.textContent = `
			html, body {
				background: #111111 !important;
				color-scheme: dark !important;
			}
			*, *::before, *::after {
				animation: none !important;
				transition: none !important;
			}
		`;
		document.documentElement.appendChild(style);
	});
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
export const test = base.extend<object>({
	page: async ({ page }, use) => {
		await applyVideoSafetyMode(page);
		await setupAuthMeMock(page);
		await use(page);
	},
});

/**
 * Wait for the app to be fully loaded past any loading/initializing screens.
 * Retries up to 2 times with page reload to handle transient auth or
 * rate-limit failures.
 */
export async function waitForAppReady(page: Page): Promise<void> {
	const hero = page.locator("header.hero");
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await expect(hero).toBeVisible({ timeout: 15000 });
			return;
		} catch {
			if (attempt === 2) throw new Error("App failed to become ready after 3 attempts");
			// Check for rate-limit error displayed in UI
			const rateLimited = await page
				.locator("text=rate limit, text=429, text=too many")
				.first()
				.isVisible()
				.catch(() => false);
			if (rateLimited) {
				// Wait longer before retrying if rate-limited
				await page.waitForTimeout(5000);
			}
			await page.reload();
		}
	}
}

/**
 * Navigate to a page and wait for it to be ready.
 * Handles transient navigation failures with a single retry.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
	const response = await page.goto(path);
	if (response && response.status() === 429) {
		// Rate-limited — wait and retry once
		await page.waitForTimeout(5000);
		await page.goto(path);
	}
	await waitForAppReady(page);
	await page.waitForLoadState("networkidle");
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

// ---------------------------------------------------------------------------
// API helpers — create / delete medications via backend API
// ---------------------------------------------------------------------------
const API_BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";

let cachedAuthCookie: string | null = null;

function readAuthCookieFromFile(): string | null {
	try {
		const state = JSON.parse(fs.readFileSync(authFile, "utf-8"));
		return state.cookies?.find((c: { name: string }) => c.name === "access_token")?.value ?? null;
	} catch {
		return null;
	}
}

function extractCookieValue(setCookieHeaders: string[], name: string): string | null {
	for (const header of setCookieHeaders) {
		const [pair] = header.split(";");
		if (!pair) continue;
		const [cookieName, ...valueParts] = pair.split("=");
		if (cookieName?.trim() !== name) continue;
		const value = valueParts.join("=").trim();
		if (value) return value;
	}
	return null;
}

async function refreshAuthCookieViaLogin(): Promise<string | null> {
	const res = await fetch(`${API_BASE}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: TEST_USER.username,
			password: TEST_USER.password,
			rememberMe: false,
		}),
	});

	if (!res.ok) return null;

	const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
	const setCookieHeaders = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
	const fallback = res.headers.get("set-cookie");
	if (fallback) setCookieHeaders.push(fallback);

	const accessToken = extractCookieValue(setCookieHeaders, "access_token");
	if (accessToken) {
		cachedAuthCookie = accessToken;
	}
	return accessToken;
}

function getAuthCookie(): string | null {
	if (cachedAuthCookie) return cachedAuthCookie;
	cachedAuthCookie = readAuthCookieFromFile();
	return cachedAuthCookie;
}

/** Typed medication response (subset of fields we care about) */
export interface TestMedication {
	id: number;
	name: string;
	genericName?: string | null;
	takenBy?: string[];
	notes?: string | null;
}

/** Typed share token response */
export interface TestShareToken {
	token: string;
	takenBy: string;
	scheduleDays: number;
	expiresAt: string;
}

/**
 * Create a medication via the backend API.  Returns the created medication
 * including its `id`.  Uses the stored auth cookie from the setup project.
 * Includes automatic retry for rate-limit (429) responses.
 */
export async function createMedicationViaAPI(data: {
	name: string;
	genericName?: string;
	takenBy?: string[];
	notes?: string;
	expiryDate?: string;
	packageType?: "blister" | "bottle";
	packCount?: number;
	blistersPerPack?: number;
	pillsPerBlister?: number;
	looseTablets?: number;
	totalPills?: number;
	intakeRemindersEnabled?: boolean;
	intakes?: {
		usage: number;
		every: number;
		start: string;
		intakeRemindersEnabled?: boolean;
		takenBy?: string | null;
	}[];
}): Promise<TestMedication> {
	let token = getAuthCookie();
	const isBottle = data.packageType === "bottle";
	const body = {
		packageType: isBottle ? "bottle" : "blister",
		packCount: isBottle ? 1 : (data.packCount ?? 1),
		blistersPerPack: isBottle ? 1 : (data.blistersPerPack ?? 1),
		pillsPerBlister: isBottle ? 1 : (data.pillsPerBlister ?? 10),
		// For bottles: looseTablets IS the current stock. Default to totalPills if not specified.
		looseTablets: isBottle ? (data.looseTablets ?? data.totalPills ?? 0) : (data.looseTablets ?? 0),
		totalPills: isBottle ? (data.totalPills ?? null) : null,
		intakes: [
			{
				usage: 1,
				every: 1,
				start: new Date().toISOString().slice(0, 16),
				intakeRemindersEnabled: false,
			},
		],
		...data,
		// Ensure takenBy is always an array (medication-level)
		takenBy: data.takenBy ?? [],
	};

	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(`${API_BASE}/api/medications`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Cookie: `access_token=${token}` } : {}),
			},
			body: JSON.stringify(body),
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			// Rate limited — exponential backoff: 3s, 6s, 9s, 12s, 15s
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Failed to create medication: ${res.status} ${text}`);
		}
		return res.json() as Promise<TestMedication>;
	}
	throw new Error("Failed to create medication after 5 retries (rate limited)");
}

/**
 * Delete a medication via the backend API.
 * Includes retry for rate-limited responses.
 */
export async function deleteMedicationViaAPI(id: number): Promise<void> {
	let token = getAuthCookie();
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${API_BASE}/api/medications/${id}`, {
			method: "DELETE",
			headers: token ? { Cookie: `access_token=${token}` } : {},
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		return;
	}
}

/**
 * Delete ALL medications for the test user via the backend API.
 * Includes retry logic for rate-limited responses.
 */
export async function deleteAllMedicationsViaAPI(): Promise<void> {
	let token = getAuthCookie();
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${API_BASE}/api/medications`, {
			headers: token ? { Cookie: `access_token=${token}` } : {},
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		if (!res.ok) return;
		const meds = (await res.json()) as TestMedication[];
		for (const med of meds) {
			for (let delAttempt = 0; delAttempt < 3; delAttempt++) {
				const delRes = await fetch(`${API_BASE}/api/medications/${med.id}`, {
					method: "DELETE",
					headers: token ? { Cookie: `access_token=${token}` } : {},
				});
				if (delRes.status === 401) {
					token = await refreshAuthCookieViaLogin();
					if (token) continue;
				}
				if (delRes.status === 429) {
					await new Promise((r) => setTimeout(r, 3000));
					continue;
				}
				break;
			}
		}
		return;
	}
}

/**
 * Create a share token via the backend API.
 * Requires a medication with takenBy to exist first.
 */
export async function createShareTokenViaAPI(takenBy: string, scheduleDays = 30): Promise<TestShareToken> {
	let token = getAuthCookie();
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(`${API_BASE}/api/share`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Cookie: `access_token=${token}` } : {}),
			},
			body: JSON.stringify({ takenBy, scheduleDays }),
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Failed to create share token: ${res.status} ${text}`);
		}
		return res.json() as Promise<TestShareToken>;
	}
	throw new Error("Failed to create share token after 5 retries (rate limited)");
}

/**
 * Update user settings via the backend API.
 */
export async function updateSettingsViaAPI(settings: Record<string, unknown>): Promise<void> {
	const token = getAuthCookie();
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${API_BASE}/api/settings`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Cookie: `access_token=${token}` } : {}),
			},
			body: JSON.stringify(settings),
		});
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		if (res.ok) return;
	}
}
