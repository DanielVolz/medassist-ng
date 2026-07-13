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

type StoredCookie = {
	name: string;
	value: string;
	expires?: number;
};

function decodeJwtPayload(token: string): { exp?: number; sub?: number | string; username?: string } | null {
	try {
		return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
	} catch {
		return null;
	}
}

function isUsableJwt(token: string): boolean {
	const payload = decodeJwtPayload(token);
	return typeof payload?.exp === "number" && Date.now() / 1000 < payload.exp - 30;
}

function pickCookieValue(cookies: StoredCookie[] | undefined, name: string): string | null {
	const matchingCookies = cookies?.filter((cookie) => cookie.name === name) ?? [];
	const validCookie = [...matchingCookies].reverse().find((cookie) => isUsableJwt(cookie.value));
	if (validCookie) {
		return validCookie.value;
	}
	const fallbackCookie = matchingCookies[matchingCookies.length - 1];
	return fallbackCookie?.value ?? null;
}

function getMockAuthMeBody(): string | null {
	if (mockMeBody) return mockMeBody;
	try {
		const state = JSON.parse(fs.readFileSync(authFile, "utf-8"));
		const token = pickCookieValue(state.cookies, "access_token");
		if (!token) return null;
		const payload = decodeJwtPayload(token);
		if (!payload) return null;
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
 * Retries with a page reload when the observable app shell does not render.
 */
export async function waitForAppReady(page: Page): Promise<void> {
	const appHeader = page.getByTestId("app-header");
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await expect(appHeader).toBeVisible({ timeout: 15000 });
			return;
		} catch {
			if (attempt === 2) throw new Error("App failed to become ready after 3 attempts");
			await page.reload();
		}
	}
}

/**
 * Navigate to a page and wait for it to be ready.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
	const response = await page.goto(path);
	if (response && response.status() === 429) {
		throw new Error(`E2E server rate-limited navigation to ${path}; expected RATE_LIMIT_MAX to prevent this`);
	}
	await waitForAppReady(page);
	await page.waitForLoadState("networkidle");
}

/**
 * Click a navigation tab by its text.
 */
export async function clickNavTab(page: Page, tabName: string): Promise<void> {
	await page.getByTestId("main-nav").getByRole("button", { name: tabName }).click();
}

/**
 * Open the user dropdown menu (when auth is enabled).
 */
export async function openUserMenu(page: Page): Promise<void> {
	await page.getByTestId("user-menu-trigger").click();
	await expect(page.getByTestId("user-menu-dropdown")).toBeVisible();
}

/**
 * Sign out via the user dropdown menu.
 */
export async function signOut(page: Page): Promise<void> {
	await openUserMenu(page);
	await page.getByTestId("user-menu-signout").click();
	// Should redirect to login page
	await expect(page.locator(".auth-container")).toBeVisible({ timeout: 10000 });
}

// Re-export expect for convenience
export { expect };

const APP_BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4174";
// Seed helpers talk to the backend directly so Vite proxy readiness does not consume
// the 30s beforeAll budget for API-created test data.
const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || "http://localhost:4175";

let cachedAuthEnabled: boolean | null = null;

async function isRuntimeAuthEnabled(): Promise<boolean> {
	if (cachedAuthEnabled !== null) {
		return cachedAuthEnabled;
	}

	try {
		const response = await fetch(`${APP_BASE}/api/auth/state`);
		if (!response.ok) {
			cachedAuthEnabled = true;
			return cachedAuthEnabled;
		}

		const state = (await response.json()) as { authEnabled?: boolean };
		cachedAuthEnabled = state.authEnabled === true;
		return cachedAuthEnabled;
	} catch {
		cachedAuthEnabled = true;
		return cachedAuthEnabled;
	}
}

async function getRuntimeApiBase(): Promise<string> {
	return (await isRuntimeAuthEnabled()) ? API_BASE : `${APP_BASE}/api`;
}

// ---------------------------------------------------------------------------
// API helpers — create / delete medications via backend API
// ---------------------------------------------------------------------------
let cachedAuthCookie: string | null = null;

function readAuthCookieFromFile(): string | null {
	try {
		const state = JSON.parse(fs.readFileSync(authFile, "utf-8"));
		return pickCookieValue(state.cookies, "access_token");
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
	const apiBase = await getRuntimeApiBase();
	const res = await fetch(`${apiBase}/auth/login`, {
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

async function ensureAuthCookie(): Promise<string | null> {
	if (!(await isRuntimeAuthEnabled())) {
		return null;
	}

	const existingCookie = getAuthCookie();
	if (existingCookie) {
		return existingCookie;
	}

	return refreshAuthCookieViaLogin();
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
	allowJournalNotes?: boolean;
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
	packageType?: "blister" | "bottle" | "tube" | "liquid_container" | "inhaler" | "injection";
	medicationForm?: "capsule" | "tablet" | "liquid" | "topical";
	packCount?: number;
	blistersPerPack?: number;
	pillsPerBlister?: number;
	looseTablets?: number;
	totalPills?: number;
	packageAmountValue?: number;
	pillWeightMg?: number | null;
	doseUnit?: string | null;
	intakeRemindersEnabled?: boolean;
	intakes?: {
		usage: number;
		every: number;
		start: string;
		intakeRemindersEnabled?: boolean;
		takenBy?: string | null;
	}[];
}): Promise<TestMedication> {
	let token = await ensureAuthCookie();
	const apiBase = await getRuntimeApiBase();
	const packageType = data.packageType ?? "blister";
	const isAmountBased =
		packageType === "bottle" ||
		packageType === "tube" ||
		packageType === "liquid_container" ||
		packageType === "inhaler" ||
		packageType === "injection";
	let defaultMedicationForm: "capsule" | "tablet" | "liquid" | "topical" = "tablet";
	if (packageType === "tube") {
		defaultMedicationForm = "topical";
	} else if (packageType === "liquid_container") {
		defaultMedicationForm = "liquid";
	}
	const medicationForm = data.medicationForm ?? defaultMedicationForm;
	const packageAmountValue =
		data.packageAmountValue ??
		(packageType === "tube" || packageType === "liquid_container" ? Math.max(1, data.totalPills ?? 30) : 0);
	const body = {
		packageType,
		medicationForm,
		packCount: packageType === "tube" ? 1 : (data.packCount ?? 1),
		blistersPerPack: isAmountBased ? 1 : (data.blistersPerPack ?? 1),
		pillsPerBlister: isAmountBased ? 1 : (data.pillsPerBlister ?? 10),
		// Amount-based packages use looseTablets as current stock.
		looseTablets: isAmountBased ? (data.looseTablets ?? data.totalPills ?? 0) : (data.looseTablets ?? 0),
		totalPills: isAmountBased ? (data.totalPills ?? null) : null,
		packageAmountValue,
		packageAmountUnit: packageType === "tube" ? "g" : "ml",
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
		const res = await fetch(`${apiBase}/medications`, {
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
			throw new Error("E2E server rate-limited medication creation; expected RATE_LIMIT_MAX to prevent this");
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
	let token = await ensureAuthCookie();
	const apiBase = await getRuntimeApiBase();
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${apiBase}/medications/${id}`, {
			method: "DELETE",
			headers: token ? { Cookie: `access_token=${token}` } : {},
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			throw new Error("E2E server rate-limited medication deletion; expected RATE_LIMIT_MAX to prevent this");
		}
		return;
	}
}

/**
 * Delete ALL medications for the test user via the backend API.
 * Includes retry logic for rate-limited responses.
 */
export async function deleteAllMedicationsViaAPI(): Promise<void> {
	let token = await ensureAuthCookie();
	const apiBase = await getRuntimeApiBase();
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${apiBase}/medications`, {
			headers: token ? { Cookie: `access_token=${token}` } : {},
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			throw new Error("E2E server rate-limited medication cleanup; expected RATE_LIMIT_MAX to prevent this");
		}
		if (!res.ok) return;
		const meds = (await res.json()) as TestMedication[];
		for (const med of meds) {
			for (let delAttempt = 0; delAttempt < 3; delAttempt++) {
				const delRes = await fetch(`${apiBase}/medications/${med.id}`, {
					method: "DELETE",
					headers: token ? { Cookie: `access_token=${token}` } : {},
				});
				if (delRes.status === 401) {
					token = await refreshAuthCookieViaLogin();
					if (token) continue;
				}
				if (delRes.status === 429) {
					throw new Error("E2E server rate-limited medication cleanup; expected RATE_LIMIT_MAX to prevent this");
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
export async function createShareTokenViaAPI(
	takenBy: string,
	scheduleDays = 30,
	options: { allowJournalNotes?: boolean; allowMarkTaken?: boolean; expiryDays?: number | null } = {}
): Promise<TestShareToken> {
	let token = await ensureAuthCookie();
	const apiBase = await getRuntimeApiBase();
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(`${apiBase}/share`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Cookie: `access_token=${token}` } : {}),
			},
			body: JSON.stringify({
				takenBy,
				scheduleDays,
				expiryDays: options.expiryDays ?? null,
				allowJournalNotes: options.allowJournalNotes ?? false,
				allowMarkTaken: options.allowMarkTaken ?? false,
			}),
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			throw new Error("E2E server rate-limited share token creation; expected RATE_LIMIT_MAX to prevent this");
		}
		if (res.status === 400) {
			const text = await res.text();
			if (text.includes('"code":"NO_MEDICATIONS"') && attempt < 4) {
				throw new Error("Share token creation did not observe the medication returned by the E2E seed request");
			}
			throw new Error(`Failed to create share token: ${res.status} ${text}`);
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
	let token = await ensureAuthCookie();
	const apiBase = await getRuntimeApiBase();
	const maxAttempts = 5;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const currentRes = await fetch(`${apiBase}/settings`, {
			headers: token ? { Cookie: `access_token=${token}` } : {},
		});
		if (currentRes.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (currentRes.status === 429) {
			await waitForRetryAfter(currentRes, attempt);
			continue;
		}
		const current = currentRes.ok ? ((await currentRes.json()) as Record<string, unknown>) : {};
		const payload = {
			timezone: "",
			emailEnabled: false,
			notificationEmail: "",
			reminderDaysBefore: 7,
			repeatDailyReminders: false,
			lowStockDays: 30,
			normalStockDays: 90,
			highStockDays: 180,
			shoutrrrEnabled: false,
			shoutrrrUrl: "",
			emailStockReminders: true,
			emailIntakeReminders: true,
			emailPrescriptionReminders: true,
			shoutrrrStockReminders: true,
			shoutrrrIntakeReminders: true,
			shoutrrrPrescriptionReminders: true,
			skipRemindersForTakenDoses: false,
			repeatRemindersEnabled: false,
			reminderRepeatIntervalMinutes: 30,
			maxNaggingReminders: 5,
			language: "en",
			stockCalculationMode: "automatic",
			shareMedicationOverview: false,
			upcomingTodayOnly: false,
			shareScheduleTodayOnly: false,
			swapDashboardMainSections: false,
			...current,
			...settings,
		};
		const res = await fetch(`${apiBase}/settings`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Cookie: `access_token=${token}` } : {}),
			},
			body: JSON.stringify(payload),
		});
		if (res.status === 401) {
			token = await refreshAuthCookieViaLogin();
			if (token) continue;
		}
		if (res.status === 429) {
			await waitForRetryAfter(res, attempt);
			continue;
		}
		if (res.ok) return;
		const text = await res.text();
		throw new Error(`Failed to update settings: ${res.status} ${text}`);
	}
	throw new Error(`Failed to update settings after ${maxAttempts} retries (rate limited)`);
}
