import { expect, type Page, test } from "@playwright/test";

interface AuthStateResponse {
	authEnabled: boolean;
	formLoginEnabled: boolean;
	oidcEnabled: boolean;
	oidcProviderName: string;
	registrationEnabled: boolean;
}

async function getAuthState(page: Page): Promise<AuthStateResponse | null> {
	try {
		const response = await page.request.get("/api/auth/state");
		if (!response.ok()) return null;
		return (await response.json()) as AuthStateResponse;
	} catch {
		return null;
	}
}

async function isAuthEnabled(page: Page): Promise<boolean> {
	const state = await getAuthState(page);
	return state?.authEnabled !== false;
}

async function expectVisibleButtonTextNotClipped(page: Page, scopeSelector: string): Promise<void> {
	const violations = await page.locator(scopeSelector).evaluate((scope) => {
		function isVisible(element: HTMLElement) {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
		}

		function textRect(element: HTMLElement) {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let rect: DOMRect | null = null;
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const text = node.textContent?.trim();
				if (!text) continue;

				const range = document.createRange();
				range.selectNodeContents(node);
				const nextRect = range.getBoundingClientRect();
				range.detach();
				if (nextRect.width <= 0 || nextRect.height <= 0) continue;

				rect = rect
					? DOMRect.fromRect({
							x: Math.min(rect.left, nextRect.left),
							y: Math.min(rect.top, nextRect.top),
							width: Math.max(rect.right, nextRect.right) - Math.min(rect.left, nextRect.left),
							height: Math.max(rect.bottom, nextRect.bottom) - Math.min(rect.top, nextRect.top),
						})
					: nextRect;
			}
			return rect;
		}

		return Array.from(scope.querySelectorAll<HTMLElement>("button"))
			.filter(isVisible)
			.flatMap((button) => {
				const text = button.textContent?.trim().replace(/\s+/g, " ");
				if (!text) return [];

				const label = button.querySelector<HTMLElement>(".mantine-Button-label") ?? button;
				const rect = button.getBoundingClientRect();
				const labelRect = textRect(label) ?? label.getBoundingClientRect();
				const buttonStyle = window.getComputedStyle(button);
				const labelStyle = window.getComputedStyle(label);
				const tolerance = 1.5;
				const boundsClip = labelRect.top < rect.top - tolerance || labelRect.bottom > rect.bottom + tolerance;
				const buttonOverflow =
					button.scrollHeight > button.clientHeight + tolerance && buttonStyle.overflowY !== "visible";
				const labelOverflow = label.scrollHeight > label.clientHeight + tolerance && labelStyle.overflowY !== "visible";

				if (!boundsClip && !buttonOverflow && !labelOverflow) return [];

				return [
					{
						boundsClip,
						buttonHeight: Math.round(rect.height * 10) / 10,
						buttonOverflow,
						labelBottom: Math.round(labelRect.bottom * 10) / 10,
						labelOverflow,
						labelTop: Math.round(labelRect.top * 10) / 10,
						text,
					},
				];
			});
	});

	expect(violations).toEqual([]);
}

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
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Should have the app title
		await expect(page.getByRole("heading", { name: /MedAssist-ng/i })).toBeVisible();
	});

	test("should have username and password fields", async ({ page }) => {
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

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
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		const submitButton = page.getByRole("button", { name: /^Login$/i });
		await expect(submitButton).toBeVisible();
		await expect(submitButton).toBeEnabled();
	});

	test("should keep auth button text fully visible on mobile", async ({ page }) => {
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		await expectVisibleButtonTextNotClipped(page, ".auth-container");

		const toggleButton = page.getByRole("button", { name: /Create account|Already have an account/i });
		if (await toggleButton.isVisible().catch(() => false)) {
			await toggleButton.click();
			await expect(page.locator(".auth-container")).toBeVisible();
			await expectVisibleButtonTextNotClipped(page, ".auth-container");
		}
	});

	test("should not navigate to dashboard without credentials", async ({ page }) => {
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.goto("/dashboard");

		// Should NOT show the app header (redirected to login)
		await expect(page.getByTestId("app-header")).not.toBeVisible({ timeout: 10000 });

		// Should show auth form instead
		await expect(page.locator(".auth-container")).toBeVisible();
	});

	test("should show error for invalid credentials", async ({ page }) => {
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Fill in invalid credentials
		await page.locator("#username").fill("nonexistent-user");
		await page.locator("#password").fill("wrongpassword");
		await page.getByRole("button", { name: /^Login$/i }).click();

		// Should show an error message
		await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible({ timeout: 5000 });
	});

	test("should toggle between login and register forms", async ({ page }) => {
		test.skip(!(await isAuthEnabled(page)), "Auth is disabled in this environment");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		const toggleButton = page.getByRole("button", { name: /Create account|Already have an account/i });
		test.skip(
			!(await toggleButton.isVisible().catch(() => false)),
			"Registration toggle is unavailable in this environment"
		);

		// Check current subtitle text
		const subtitle = page.getByRole("heading", { level: 2 });
		const initialText = await subtitle.textContent();

		// Click the toggle link (Create account / Already have an account)
		await toggleButton.click();

		// Subtitle should change
		const newText = await subtitle.textContent();
		expect(newText).not.toBe(initialText);
	});

	test("should show SSO button when OIDC is enabled", async ({ page }) => {
		const state = await getAuthState(page);
		test.skip(!state?.authEnabled, "Auth is disabled in this environment");
		test.skip(!state?.oidcEnabled, "OIDC is not enabled in this environment");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		const ssoButton = page.getByRole("button", { name: /Login with/i });
		await expect(ssoButton).toBeVisible();
		await expect(ssoButton).toContainText(state.oidcProviderName || "SSO");
	});

	test("should hide form login when formLoginEnabled is false", async ({ page }) => {
		const state = await getAuthState(page);
		test.skip(!state?.authEnabled, "Auth is disabled in this environment");
		test.skip(state?.formLoginEnabled !== false, "Form login is enabled — cannot test hidden state");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Username/password fields should not be visible
		await expect(page.locator("#username")).not.toBeVisible();
		await expect(page.locator("#password")).not.toBeVisible();

		// SSO button should be the only login method
		await expect(page.getByRole("button", { name: /Login with/i })).toBeVisible();
	});

	test("should show both login methods when OIDC and form login are enabled", async ({ page }) => {
		const state = await getAuthState(page);
		test.skip(!state?.authEnabled, "Auth is disabled in this environment");
		test.skip(!state?.oidcEnabled, "OIDC is not enabled");
		test.skip(!state?.formLoginEnabled, "Form login is not enabled");

		await page.goto("/");
		await expect(page.locator(".auth-container")).toBeVisible({ timeout: 15000 });

		// Both login methods visible
		await expect(page.locator("#username")).toBeVisible();
		await expect(page.locator("#password")).toBeVisible();
		await expect(page.getByRole("button", { name: /Login with/i })).toBeVisible();
	});
});
