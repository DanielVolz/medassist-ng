/**
 * E2E Tests for auth routes with AUTH_ENABLED=true
 */

import type { Client } from "@libsql/client";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./setup.js";

// Use vi.hoisted to create the db BEFORE mocks are set up
const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return { testClient: client, testDb: db };
});

// Mock modules using the hoisted db
vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

// Enable auth for these tests
vi.mock("../plugins/env.js", () => ({
	env: {
		AUTH_ENABLED: true,
		FORM_LOGIN_ENABLED: true,
		REGISTRATION_ENABLED: true,
		OIDC_ENABLED: false,
		OIDC_PROVIDER_NAME: "SSO",
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		PORT: 3000,
		CORS_ORIGINS: "*",
		JWT_SECRET: "test-jwt-secret-12345",
		REFRESH_SECRET: "test-refresh-secret-12345",
		COOKIE_SECRET: "test-cookie-secret-12345",
		ACCESS_TOKEN_TTL_MINUTES: 15,
		REFRESH_TOKEN_TTL_DAYS: 7,
	},
}));

// Import real auth plugin and routes
const { authRoutes } = await import("../routes/auth.js");

// =============================================================================
// Test Setup
// =============================================================================

async function clearData(client: Client) {
	await client.execute("DELETE FROM refresh_tokens");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

const invalidCredentialsResponse = { error: "Invalid username or password", code: "INVALID_CREDENTIALS" } as const;
const tokenExpiryToleranceSeconds = 5;

type JwtPayloadWithExp = Record<string, unknown> & { exp?: number };

function getResponseCookieValue(response: { cookies: Array<{ name: string; value: string }> }, name: string): string {
	const cookieValue = response.cookies.find((c) => c.name === name)?.value;
	expect(cookieValue).toBeDefined();
	return cookieValue ?? "";
}

function expectTokenExpiryNear(exp: number | undefined, issuedAtMs: number, ttlSeconds: number) {
	expect(exp).toBeDefined();
	const expectedMin = Math.floor(issuedAtMs / 1000) + ttlSeconds - tokenExpiryToleranceSeconds;
	const expectedMax = Math.ceil(Date.now() / 1000) + ttlSeconds + tokenExpiryToleranceSeconds;
	expect(exp).toBeGreaterThanOrEqual(expectedMin);
	expect(exp).toBeLessThanOrEqual(expectedMax);
}

// =============================================================================
// Tests
// =============================================================================

describe("Auth Routes (AUTH_ENABLED=true)", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		app = (
			await buildTestApp({
				client: testClient,
				config: {
					accessSecret: "test-jwt-secret-12345",
					refreshSecret: "test-refresh-secret-12345",
					accessTtl: 2,
					refreshTtl: 3,
					cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 2 * 60 },
					refreshCookieOptions: {
						httpOnly: true,
						sameSite: "lax",
						secure: false,
						path: "/auth",
						maxAge: 3 * 24 * 60 * 60,
					},
				},
			})
		).app;

		await app.register(authRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		await clearData(testClient);
	});

	// ---------------------------------------------------------------------------
	// Auth State Tests
	// ---------------------------------------------------------------------------

	describe("GET /auth/state", () => {
		it("should return only the unauthenticated public auth state", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/auth/state",
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.json()).toEqual({
				authEnabled: true,
				registrationEnabled: true,
				formLoginEnabled: true,
				oidcEnabled: false,
				oidcProviderName: "SSO",
				needsSetup: true,
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Registration Tests
	// ---------------------------------------------------------------------------

	describe("POST /auth/register", () => {
		it("should register a new user", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "testuser",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(201);
			const data = response.json();
			expect(data.ok).toBe(true);
			expect(data.user.username).toBe("testuser");
		});

		it("should reject duplicate username", async () => {
			// First registration
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "duplicate",
					password: "TestPassword123",
				},
			});

			// Second registration with same username
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "duplicate",
					password: "AnotherPassword123",
				},
			});

			expect(response.statusCode).toBe(409);
			expect(response.json().code).toBe("USERNAME_EXISTS");
		});

		it("should reject duplicate username regardless of case", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "CaseUser",
					password: "TestPassword123",
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "caseuser",
					password: "AnotherPassword123",
				},
			});

			expect(response.statusCode).toBe(409);
			expect(response.json().code).toBe("USERNAME_EXISTS");
		});

		it("should reject short password", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "testuser",
					password: "short",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("FST_ERR_VALIDATION");
		});

		it("should reject short username", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "ab",
					password: "ValidPassword123",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("FST_ERR_VALIDATION");
		});

		it("should register with trimmed username when input has whitespace", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "  trimuser  ",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(201);
			expect(response.json().user.username).toBe("trimuser");
		});

		it("should reject whitespace-only username on registration", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "   ",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("VALIDATION_ERROR");
		});

		it("should reject duplicate username even with surrounding whitespace", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "spacedupe",
					password: "TestPassword123",
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "  spacedupe  ",
					password: "AnotherPassword123",
				},
			});

			expect(response.statusCode).toBe(409);
			expect(response.json().code).toBe("USERNAME_EXISTS");
		});

		it("should reject invalid username characters", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "test@user",
					password: "ValidPassword123",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("VALIDATION_ERROR");
		});
	});

	// ---------------------------------------------------------------------------
	// Login Tests
	// ---------------------------------------------------------------------------

	describe("POST /auth/login", () => {
		beforeEach(async () => {
			// Create a test user
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "loginuser",
					password: "TestPassword123",
				},
			});
		});

		it("should login with valid credentials", async () => {
			const issuedAtMs = Date.now();
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "loginuser",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.ok).toBe(true);
			expect(data.user.username).toBe("loginuser");

			// Should set cookies
			const cookies = response.cookies;
			expect(cookies.find((c: { name: string }) => c.name === "access_token")).toBeDefined();
			expect(cookies.find((c: { name: string }) => c.name === "refresh_token")).toBeDefined();

			const accessToken = getResponseCookieValue(response, "access_token");
			const refreshToken = getResponseCookieValue(response, "refresh_token");
			const accessPayload = await app.jwt.verify<JwtPayloadWithExp>(accessToken);
			const refreshPayload = await app.jwt.verify<JwtPayloadWithExp>(refreshToken, { key: app.config.refreshSecret });
			expectTokenExpiryNear(accessPayload.exp, issuedAtMs, app.config.accessTtl * 60);
			expectTokenExpiryNear(refreshPayload.exp, issuedAtMs, app.config.refreshTtl * 24 * 60 * 60);
		});

		it("should login case-insensitively with different username casing", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "LOGINUSER",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
			expect(response.json().user.username).toBe("loginuser");
		});

		it("should reject invalid password", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "loginuser",
					password: "WrongPassword",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json()).toEqual(invalidCredentialsResponse);
		});

		it("should reject non-existent user", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "nonexistent",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json()).toEqual(invalidCredentialsResponse);
		});

		it("should perform dummy hash work for non-existent users", async () => {
			const hashSpy = vi.spyOn(argon2, "hash");

			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "nonexistent",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json()).toEqual(invalidCredentialsResponse);
			expect(hashSpy).toHaveBeenCalledWith(
				"dummy",
				expect.objectContaining({
					memoryCost: 65536,
					timeCost: 3,
					parallelism: 4,
				})
			);

			hashSpy.mockRestore();
		});

		it("should return identical login failure responses for missing, wrong-password, inactive, and SSO-only users", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "inactiveuser",
					password: "TestPassword123",
				},
			});

			await testClient.execute({
				sql: "UPDATE users SET is_active = 0 WHERE username = ?",
				args: ["inactiveuser"],
			});

			await testClient.execute({
				sql: `
					INSERT INTO users (username, password_hash, auth_provider, oidc_subject, is_active)
					VALUES (?, ?, ?, ?, ?)
				`,
				args: ["ssouser", null, "oidc", "oidc-subject-1", 1],
			});

			const loginAttempts = [
				{ username: "nonexistent", password: "TestPassword123" },
				{ username: "loginuser", password: "WrongPassword" },
				{ username: "inactiveuser", password: "TestPassword123" },
				{ username: "ssouser", password: "TestPassword123" },
			];

			for (const payload of loginAttempts) {
				const response = await app.inject({
					method: "POST",
					url: "/auth/login",
					payload,
				});

				expect(response.statusCode).toBe(401);
				expect(response.json()).toEqual(invalidCredentialsResponse);
			}
		});

		it("should login successfully when username has leading/trailing whitespace", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "  loginuser  ",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
			expect(response.json().user.username).toBe("loginuser");
		});

		it("should reject whitespace-only username on login", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "   ",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("VALIDATION_ERROR");
		});

		it("should support rememberMe option", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "loginuser",
					password: "TestPassword123",
					rememberMe: true,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.ok).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Token Refresh Tests
	// ---------------------------------------------------------------------------

	describe("POST /auth/refresh", () => {
		it("should refresh access token with valid refresh token", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "refreshuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "refreshuser",
					password: "TestPassword123",
				},
			});

			const refreshToken = login.cookies.find((c: { name: string }) => c.name === "refresh_token");

			const issuedAtMs = Date.now();
			const response = await app.inject({
				method: "POST",
				url: "/auth/refresh",
				cookies: {
					refresh_token: refreshToken?.value ?? "",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);

			const accessToken = getResponseCookieValue(response, "access_token");
			const rotatedRefreshToken = getResponseCookieValue(response, "refresh_token");
			const accessPayload = await app.jwt.verify<JwtPayloadWithExp>(accessToken);
			const refreshPayload = await app.jwt.verify<JwtPayloadWithExp>(rotatedRefreshToken, {
				key: app.config.refreshSecret,
			});
			expectTokenExpiryNear(accessPayload.exp, issuedAtMs, app.config.accessTtl * 60);
			expectTokenExpiryNear(refreshPayload.exp, issuedAtMs, app.config.refreshTtl * 24 * 60 * 60);
		});

		it("should reject without refresh token", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/refresh",
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().code).toBe("NO_REFRESH_TOKEN");
		});

		it("should reject invalid refresh token", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/refresh",
				cookies: {
					refresh_token: "invalid-token",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().code).toBe("INVALID_REFRESH_TOKEN");
		});
	});

	// ---------------------------------------------------------------------------
	// Logout Tests
	// ---------------------------------------------------------------------------

	describe("POST /auth/logout", () => {
		it("should logout and clear cookies", async () => {
			// Register and login first
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "logoutuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "logoutuser",
					password: "TestPassword123",
				},
			});

			const refreshToken = login.cookies.find((c: { name: string }) => c.name === "refresh_token");

			const response = await app.inject({
				method: "POST",
				url: "/auth/logout",
				cookies: {
					refresh_token: refreshToken?.value ?? "",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
		});

		it("should succeed even without refresh token", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/logout",
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Me Endpoint Tests
	// ---------------------------------------------------------------------------

	describe("GET /auth/me", () => {
		it("should return user info with valid access token", async () => {
			// Register and login
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "meuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "meuser",
					password: "TestPassword123",
				},
			});

			const accessToken = login.cookies.find((c: { name: string }) => c.name === "access_token");

			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: {
					access_token: accessToken?.value ?? "",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.username).toBe("meuser");
		});

		it("should return user info with a bearer JWT access token", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "bearerjwtuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "bearerjwtuser",
					password: "TestPassword123",
				},
			});

			const accessToken = getResponseCookieValue(login, "access_token");
			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				headers: { authorization: `Bearer ${accessToken}` },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().username).toBe("bearerjwtuser");
		});

		it("should prefer a valid session cookie over a non-api-key bearer header", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "cookiepreferred",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "cookiepreferred",
					password: "TestPassword123",
				},
			});

			const accessToken = getResponseCookieValue(login, "access_token");
			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: { access_token: accessToken },
				headers: { authorization: "Bearer not-a-jwt" },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().username).toBe("cookiepreferred");
		});

		it("should reject without access token", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
			});

			expect(response.statusCode).toBe(401);
		});

		it("should reject with invalid access token", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: {
					access_token: "invalid.jwt.token",
				},
			});

			expect(response.statusCode).toBe(401);
		});
	});

	// ---------------------------------------------------------------------------
	// Inactive User Tests
	// ---------------------------------------------------------------------------

	describe("Inactive user handling", () => {
		it("should reject login for inactive user", async () => {
			// Create user
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "inactiveuser",
					password: "TestPassword123",
				},
			});

			// Manually deactivate user in DB
			await testClient.execute({
				sql: "UPDATE users SET is_active = 0 WHERE username = ?",
				args: ["inactiveuser"],
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "inactiveuser",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json()).toEqual(invalidCredentialsResponse);
		});
	});

	// ---------------------------------------------------------------------------
	// Profile Update Tests
	// ---------------------------------------------------------------------------

	describe("PUT /auth/me (profile update)", () => {
		it("should update password with valid current password", async () => {
			// Register and login
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "profileuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "profileuser",
					password: "TestPassword123",
				},
			});

			const accessToken = login.cookies.find((c: { name: string }) => c.name === "access_token");

			const response = await app.inject({
				method: "PUT",
				url: "/auth/me",
				cookies: {
					access_token: accessToken?.value ?? "",
				},
				payload: {
					currentPassword: "TestPassword123",
					newPassword: "NewPassword456",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);

			// Verify can login with new password
			const newLogin = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "profileuser",
					password: "NewPassword456",
				},
			});

			expect(newLogin.statusCode).toBe(200);
		});

		it("should revoke existing refresh tokens and keep the current session usable after password change", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "rotateprofileuser",
					password: "TestPassword123",
				},
			});

			const currentSession = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "rotateprofileuser",
					password: "TestPassword123",
				},
			});
			const otherSession = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "rotateprofileuser",
					password: "TestPassword123",
				},
			});
			const oldCurrentRefreshToken = getResponseCookieValue(currentSession, "refresh_token");
			const oldOtherRefreshToken = getResponseCookieValue(otherSession, "refresh_token");
			const accessToken = getResponseCookieValue(currentSession, "access_token");

			const response = await app.inject({
				method: "PUT",
				url: "/auth/me",
				cookies: {
					access_token: accessToken,
				},
				payload: {
					currentPassword: "TestPassword123",
					newPassword: "NewPassword456",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
			const newRefreshToken = getResponseCookieValue(response, "refresh_token");
			expect(newRefreshToken).not.toBe(oldCurrentRefreshToken);
			expect(newRefreshToken).not.toBe(oldOtherRefreshToken);

			for (const revokedRefreshToken of [oldCurrentRefreshToken, oldOtherRefreshToken]) {
				const revokedResponse = await app.inject({
					method: "POST",
					url: "/auth/refresh",
					cookies: {
						refresh_token: revokedRefreshToken,
					},
				});
				expect(revokedResponse.statusCode).toBe(401);
				expect(revokedResponse.json().code).toBe("INVALID_REFRESH_TOKEN");
			}

			const usableCurrentSession = await app.inject({
				method: "POST",
				url: "/auth/refresh",
				cookies: {
					refresh_token: newRefreshToken,
				},
			});
			expect(usableCurrentSession.statusCode).toBe(200);
			expect(usableCurrentSession.json().ok).toBe(true);
		});

		it("should reject password change without current password", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "profileuser2",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "profileuser2",
					password: "TestPassword123",
				},
			});

			const accessToken = login.cookies.find((c: { name: string }) => c.name === "access_token");

			const response = await app.inject({
				method: "PUT",
				url: "/auth/me",
				cookies: {
					access_token: accessToken?.value ?? "",
				},
				payload: {
					newPassword: "NewPassword456",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("CURRENT_PASSWORD_REQUIRED");
		});

		it("should reject password change with wrong current password", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "profileuser3",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "profileuser3",
					password: "TestPassword123",
				},
			});

			const accessToken = login.cookies.find((c: { name: string }) => c.name === "access_token");

			const response = await app.inject({
				method: "PUT",
				url: "/auth/me",
				cookies: {
					access_token: accessToken?.value ?? "",
				},
				payload: {
					currentPassword: "WrongPassword",
					newPassword: "NewPassword456",
				},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().code).toBe("INVALID_PASSWORD");
		});

		it("should reject profile update without auth", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/auth/me",
				payload: {
					currentPassword: "Test123",
					newPassword: "NewPassword456",
				},
			});

			expect(response.statusCode).toBe(401);
		});
	});

	describe("DELETE /auth/me - Delete Account", () => {
		it("should delete user account and all data", async () => {
			// Register and login
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "deleteuser",
					password: "TestPassword123",
				},
			});

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "deleteuser",
					password: "TestPassword123",
				},
			});

			const accessToken = login.cookies.find((c: { name: string }) => c.name === "access_token");

			// Delete account
			const response = await app.inject({
				method: "DELETE",
				url: "/auth/me",
				cookies: {
					access_token: accessToken?.value ?? "",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);

			// Verify can't login anymore
			const loginAgain = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "deleteuser",
					password: "TestPassword123",
				},
			});

			expect(loginAgain.statusCode).toBe(401);
		});

		it("should reject delete without auth", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/auth/me",
			});

			expect(response.statusCode).toBe(401);
		});
	});
});
