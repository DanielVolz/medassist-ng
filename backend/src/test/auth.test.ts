/**
 * E2E Tests for auth routes with AUTH_ENABLED=true
 */

import rateLimit from "@fastify/rate-limit";
import type { Client } from "@libsql/client";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./setup.js";

// Use vi.hoisted to create the db BEFORE mocks are set up
const { getSmtpConfig, sendEmailNotification, testClient, testDb, testDbDirectory } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const { mkdtempSync } = require("node:fs");
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const testDbDirectory = mkdtempSync(join(tmpdir(), "medassist-auth-"));
	const client = createClient({ url: `file:${join(testDbDirectory, "auth.db")}` });
	const db = drizzle(client);
	return { getSmtpConfig: vi.fn(), sendEmailNotification: vi.fn(), testClient: client, testDb: db, testDbDirectory };
});

// Mock modules using the hoisted db
vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../services/notifications/delivery.js", () => ({
	getSmtpConfig,
	sendEmailNotification,
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
		PUBLIC_APP_URL: "https://app.example.com",
	},
}));

// Import real auth plugin and routes
const { authRoutes } = await import("../routes/auth.js");

// =============================================================================
// Test Setup
// =============================================================================

async function clearData(client: Client) {
	await client.execute("DELETE FROM password_reset_tokens");
	await client.execute("DELETE FROM refresh_tokens");
	await client.execute("DELETE FROM api_keys");
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
		require("node:fs").rmSync(testDbDirectory, { recursive: true, force: true });
	});

	beforeEach(async () => {
		await clearData(testClient);
		getSmtpConfig.mockClear();
		sendEmailNotification.mockClear();
		getSmtpConfig.mockReturnValue({ host: "smtp.example.com", user: "mailer", from: "mailer@example.com" });
		sendEmailNotification.mockResolvedValue({ success: true });
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

			expect(response.statusCode, response.body).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.json()).toEqual({
				authEnabled: true,
				registrationEnabled: true,
				formLoginEnabled: true,
				passwordResetEnabled: true,
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
					email: "test@example.com",
					password: "TestPassword123",
				},
			});

			expect(response.statusCode).toBe(201);
			const data = response.json();
			expect(data.ok).toBe(true);
			expect(data.user.username).toBe("testuser");
		});

		it("should require an email address for local registration", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: { username: "missingemail", password: "TestPassword123" },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should reject case-insensitive duplicate emails and allow email login", async () => {
			const firstRegistration = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: { username: "emailuser", email: "email@example.com", password: "TestPassword123" },
			});
			expect(firstRegistration.statusCode).toBe(201);

			const duplicateRegistration = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: { username: "anotheruser", email: "EMAIL@example.com", password: "TestPassword123" },
			});
			expect(duplicateRegistration.statusCode).toBe(409);
			expect(duplicateRegistration.json().code).toBe("EMAIL_EXISTS");

			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "EMAIL@EXAMPLE.COM", password: "TestPassword123" },
			});
			expect(login.statusCode).toBe(200);
		});

		it("should reject duplicate username", async () => {
			// First registration
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "duplicate",
					email: "test@example.com",
					password: "TestPassword123",
				},
			});

			// Second registration with same username
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "duplicate",
					email: "test@example.com",
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
					email: "test@example.com",
					password: "TestPassword123",
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "caseuser",
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
					password: "TestPassword123",
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "  spacedupe  ",
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "inactive@example.com",
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
	// Password Recovery Tests
	// ---------------------------------------------------------------------------

	describe("password recovery", () => {
		function getResetTokenFromEmail(index = 0): string {
			const message = sendEmailNotification.mock.calls[index]?.[0] as { text?: string } | undefined;
			const token = message?.text?.match(/#reset-password\?token=([a-f0-9]{64})/i)?.[1];
			expect(token).toBeDefined();
			return token ?? "";
		}

		async function registerRecoveryUser(username: string, email: string) {
			const response = await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: { username, email, password: "TestPassword123" },
			});
			expect(response.statusCode).toBe(201);
		}

		it("sends a branded reset email with HTML and plaintext content", async () => {
			await registerRecoveryUser("resetemail", "reset@example.com");

			const response = await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "reset@example.com" },
			});

			expect(response.statusCode).toBe(200);
			const message = sendEmailNotification.mock.calls[0]?.[0] as
				| { to?: string; subject?: string; text?: string; html?: string }
				| undefined;
			const token = getResetTokenFromEmail();
			const resetLink = `https://app.example.com/#reset-password?token=${token}`;

			expect(message).toMatchObject({
				to: "reset@example.com",
				subject: "Reset your MedAssist-ng password",
			});
			expect(message?.html).toContain("background: #f9fafb");
			expect(message?.html).toContain("MedAssist-ng - Password reset");
			expect(message?.html).toContain(`href="${resetLink}"`);
			expect(message?.html).toContain("Set new password");
			expect(message?.html).not.toContain(`>${resetLink}</a>`);
			expect(message?.html).toContain("Sent from MedAssist-ng");
			expect(message?.text).toContain("Set a new password using this link:");
			expect(message?.text).toContain(resetLink);
			expect(message?.text).toContain("This link is valid for 15 minutes.");
			expect(message?.text).toContain("---\n🤖 Sent from MedAssist-ng");
		});

		it("returns the generic response and removes the new token when SMTP delivery fails", async () => {
			await registerRecoveryUser("smtpuser", "smtp@example.com");
			sendEmailNotification.mockResolvedValueOnce({ success: false, error: "SMTP unavailable" });

			const response = await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "smtp@example.com" },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				ok: true,
				message: "If an eligible account exists, a reset link has been sent.",
			});
			expect(sendEmailNotification).toHaveBeenCalledTimes(1);
			const tokens = await testClient.execute("SELECT token_hash FROM password_reset_tokens");
			expect(tokens.rows).toHaveLength(0);
		});

		it("does not issue a recovery email for an OIDC-only account while preserving the generic response", async () => {
			await testClient.execute({
				sql: `
					INSERT INTO users (username, email, password_hash, auth_provider, oidc_subject, is_active)
					VALUES (?, ?, ?, ?, ?, ?)
				`,
				args: ["oidcrecovery", "oidc@example.com", null, "oidc", "oidc-subject", 1],
			});

			const response = await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "oidc@example.com" },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				ok: true,
				message: "If an eligible account exists, a reset link has been sent.",
			});
			expect(sendEmailNotification).not.toHaveBeenCalled();
		});

		it("limits recovery requests to three attempts per IP in fifteen minutes", async () => {
			const rateLimitedApp = (await buildTestApp({ client: testClient })).app;
			await rateLimitedApp.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
			await rateLimitedApp.register(authRoutes);
			await rateLimitedApp.ready();

			try {
				const responses = [];
				for (let attempt = 0; attempt < 4; attempt += 1) {
					responses.push(
						await rateLimitedApp.inject({
							method: "POST",
							url: "/auth/forgot-password",
							payload: { emailOrUsername: "missing-user" },
							remoteAddress: "198.51.100.42",
						})
					);
				}

				expect(responses.slice(0, 3).every((response) => response.statusCode === 200)).toBe(true);
				expect(responses[3]?.statusCode).toBe(429);
				expect(responses[3]?.json().code).toBe("RATE_LIMIT_EXCEEDED");
			} finally {
				await rateLimitedApp.close();
			}
		});

		it("rejects an expired reset token without changing the password", async () => {
			await registerRecoveryUser("expiredreset", "expired@example.com");
			await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "expiredreset" },
			});
			const token = getResetTokenFromEmail();
			await testClient.execute("UPDATE password_reset_tokens SET expires_at = 0");

			const reset = await app.inject({
				method: "POST",
				url: "/auth/reset-password",
				payload: { token, newPassword: "NewPassword456" },
			});

			expect(reset.statusCode).toBe(400);
			expect(reset.json().code).toBe("INVALID_RESET_TOKEN");
			const oldPasswordLogin = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "expiredreset", password: "TestPassword123" },
			});
			expect(oldPasswordLogin.statusCode).toBe(200);
		});

		it("prunes expired and consumed reset tokens when issuing another link", async () => {
			await registerRecoveryUser("tokenpruning", "tokenpruning@example.com");
			await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "tokenpruning" },
			});
			await testClient.execute("UPDATE password_reset_tokens SET expires_at = 0");

			await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "tokenpruning" },
			});
			const activeToken = getResetTokenFromEmail(1);
			const afterExpiredTokenPrune = await testClient.execute("SELECT id FROM password_reset_tokens");
			expect(afterExpiredTokenPrune.rows).toHaveLength(1);

			const reset = await app.inject({
				method: "POST",
				url: "/auth/reset-password",
				payload: { token: activeToken, newPassword: "NewPassword456" },
			});
			expect(reset.statusCode).toBe(200);

			await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "tokenpruning" },
			});
			const afterUsedTokenPrune = await testClient.execute("SELECT used_at FROM password_reset_tokens");
			expect(afterUsedTokenPrune.rows).toEqual([{ used_at: null }]);
		});

		it("keeps concurrently requested links valid until one reset succeeds", async () => {
			await registerRecoveryUser("multiplelinks", "multiple@example.com");
			for (let request = 0; request < 2; request += 1) {
				const response = await app.inject({
					method: "POST",
					url: "/auth/forgot-password",
					payload: { emailOrUsername: "multiple@example.com" },
				});
				expect(response.statusCode).toBe(200);
			}

			const firstToken = getResetTokenFromEmail(0);
			const secondToken = getResetTokenFromEmail(1);
			expect(firstToken).not.toBe(secondToken);
			const issuedTokens = await testClient.execute("SELECT id FROM password_reset_tokens");
			expect(issuedTokens.rows).toHaveLength(2);

			const reset = await app.inject({
				method: "POST",
				url: "/auth/reset-password",
				payload: { token: firstToken, newPassword: "NewPassword456" },
			});
			expect(reset.statusCode).toBe(200);

			const remainingLink = await app.inject({
				method: "POST",
				url: "/auth/reset-password",
				payload: { token: secondToken, newPassword: "DifferentPassword789" },
			});
			expect(remainingLink.statusCode).toBe(400);
			const consumedTokens = await testClient.execute("SELECT used_at FROM password_reset_tokens");
			expect(consumedTokens.rows.every((token: { used_at: unknown }) => token.used_at)).toBe(true);
		});

		it("consumes a token once and invalidates existing sessions and API keys", async () => {
			await registerRecoveryUser("atomicreset", "atomic@example.com");
			const currentSession = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "atomicreset", password: "TestPassword123" },
			});
			const otherSession = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "atomicreset", password: "TestPassword123" },
			});
			const currentAccessToken = getResponseCookieValue(currentSession, "access_token");
			const currentRefreshToken = getResponseCookieValue(currentSession, "refresh_token");
			const otherRefreshToken = getResponseCookieValue(otherSession, "refresh_token");
			const user = await testClient.execute({
				sql: "SELECT id FROM users WHERE username = ?",
				args: ["atomicreset"],
			});
			const userId = Number(user.rows[0]?.id);
			const apiKey = "ma_password_reset_api_key";
			const { hashApiKeyToken } = await import("../plugins/auth.js");
			await testClient.execute({
				sql: "INSERT INTO api_keys (user_id, name, key_hash, token_prefix) VALUES (?, ?, ?, ?)",
				args: [userId, "reset test key", hashApiKeyToken(apiKey), apiKey.slice(0, 24)],
			});

			const apiKeyBeforeReset = await app.inject({
				method: "GET",
				url: "/auth/me",
				headers: { authorization: `Bearer ${apiKey}` },
			});
			expect(apiKeyBeforeReset.statusCode).toBe(200);

			await app.inject({
				method: "POST",
				url: "/auth/forgot-password",
				payload: { emailOrUsername: "atomicreset" },
			});
			const token = getResetTokenFromEmail();
			const storedToken = await testClient.execute("SELECT token_hash FROM password_reset_tokens");
			expect(storedToken.rows[0]?.token_hash).not.toBe(token);

			const resetAttempts = await Promise.all(
				["NewPassword456", "DifferentPassword789"].map((newPassword) =>
					app.inject({
						method: "POST",
						url: "/auth/reset-password",
						payload: { token, newPassword },
					})
				)
			);
			expect(resetAttempts.filter((response) => response.statusCode === 200)).toHaveLength(1);
			expect(resetAttempts.filter((response) => response.statusCode === 400)).toHaveLength(1);

			const consumedToken = await testClient.execute("SELECT used_at FROM password_reset_tokens");
			expect(consumedToken.rows[0]?.used_at).toBeTruthy();
			for (const refreshToken of [currentRefreshToken, otherRefreshToken]) {
				const refresh = await app.inject({
					method: "POST",
					url: "/auth/refresh",
					cookies: { refresh_token: refreshToken },
				});
				expect(refresh.statusCode).toBe(401);
			}
			const oldAccess = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: { access_token: currentAccessToken },
			});
			expect(oldAccess.statusCode).toBe(401);
			const apiKeyAfterReset = await app.inject({
				method: "GET",
				url: "/auth/me",
				headers: { authorization: `Bearer ${apiKey}` },
			});
			expect(apiKeyAfterReset.statusCode).toBe(401);
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
			expect(data.email).toBe("test@example.com");
		});

		it("returns null for a local account without a recovery email", async () => {
			const user = await testClient.execute({
				sql: `
					INSERT INTO users (username, email, password_hash, auth_provider, is_active)
					VALUES (?, ?, ?, ?, ?)
					RETURNING id
				`,
				args: ["localwithoutemail", null, "password-hash", "local", 1],
			});
			const userId = Number(user.rows[0]?.id);
			const accessToken = await app.jwt.sign({ sub: userId, username: "localwithoutemail", credentialVersion: 0 });

			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: { access_token: accessToken },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().email).toBeNull();
		});

		it("does not expose an OIDC-only account email as a recovery email", async () => {
			const user = await testClient.execute({
				sql: `
					INSERT INTO users (username, email, password_hash, auth_provider, oidc_subject, is_active)
					VALUES (?, ?, ?, ?, ?, ?)
					RETURNING id
				`,
				args: ["oidcprofileuser", "oidc@example.com", null, "oidc", "oidc-profile-subject", 1],
			});
			const userId = Number(user.rows[0]?.id);
			const accessToken = await app.jwt.sign({ sub: userId, username: "oidcprofileuser", credentialVersion: 0 });

			const response = await app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: { access_token: accessToken },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).not.toHaveProperty("email");
		});

		it("should return user info with a bearer JWT access token", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "bearerjwtuser",
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
		it("updates a local account email only after reauthentication and allows login with the new email", async () => {
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "emailprofileuser",
					email: "before@example.com",
					password: "TestPassword123",
				},
			});
			const login = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "emailprofileuser", password: "TestPassword123" },
			});

			const update = await app.inject({
				method: "PUT",
				url: "/auth/me",
				cookies: { access_token: getResponseCookieValue(login, "access_token") },
				payload: { currentPassword: "TestPassword123", email: "after@example.com" },
			});
			expect(update.statusCode).toBe(200);

			const newEmailLogin = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: { username: "AFTER@EXAMPLE.COM", password: "TestPassword123" },
			});
			expect(newEmailLogin.statusCode).toBe(200);
		});

		it("should update password with valid current password", async () => {
			// Register and login
			await app.inject({
				method: "POST",
				url: "/auth/register",
				payload: {
					username: "profileuser",
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
					email: "test@example.com",
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
