/**
 * E2E Tests for auth routes with AUTH_ENABLED=true
 */

import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import type { Client } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
		LOCAL_AUTH_ENABLED: true,
		REGISTRATION_ENABLED: true,
		OIDC_ENABLED: false,
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

async function createSchema(client: Client) {
	const tableCreations = [
		`CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      username text NOT NULL UNIQUE,
      password_hash text,
      avatar_url text,
      auth_provider text NOT NULL DEFAULT 'local',
      oidc_subject text,
      is_active integer NOT NULL DEFAULT 1,
      last_login_at integer,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
    )`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      token_id text NOT NULL UNIQUE,
      expires_at integer NOT NULL,
      revoked integer NOT NULL DEFAULT 0,
      rotated_at integer,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
	];

	for (const sql of tableCreations) {
		await client.execute(sql);
	}
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM refresh_tokens");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

// =============================================================================
// Tests
// =============================================================================

describe("Auth Routes (AUTH_ENABLED=true)", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await createSchema(testClient);

		app = Fastify({ logger: false });

		await app.register(sensible);
		await app.register(cookie, { secret: "test-cookie-secret-12345" });
		await app.register(jwt, {
			secret: "test-jwt-secret-12345",
			cookie: { cookieName: "access_token", signed: false },
		});

		// Decorate with config needed by auth routes
		app.decorate("config", {
			accessSecret: "test-jwt-secret-12345",
			refreshSecret: "test-refresh-secret-12345",
			accessTtl: 15,
			refreshTtl: 7,
			cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 15 * 60 },
			refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/auth", maxAge: 7 * 24 * 60 * 60 },
		});

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
		it("should return auth state", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/auth/state",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.authEnabled).toBe(true);
			expect(data.registrationEnabled).toBe(true);
			expect(data.localAuthEnabled).toBe(true);
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
			expect(response.json().code).toBe("VALIDATION_ERROR");
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
			expect(response.json().code).toBe("VALIDATION_ERROR");
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
			expect(cookies.find((c: any) => c.name === "access_token")).toBeDefined();
			expect(cookies.find((c: any) => c.name === "refresh_token")).toBeDefined();
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
			expect(response.json().code).toBe("INVALID_CREDENTIALS");
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
			expect(response.json().code).toBe("INVALID_CREDENTIALS");
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
			// Login first to get tokens
			const _loginResponse = await app.inject({
				method: "POST",
				url: "/auth/login",
				payload: {
					username: "loginuser",
					password: "TestPassword123",
				},
			});

			// Need to create user first
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

			const refreshToken = login.cookies.find((c: any) => c.name === "refresh_token");

			const response = await app.inject({
				method: "POST",
				url: "/auth/refresh",
				cookies: {
					refresh_token: refreshToken?.value ?? "",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().ok).toBe(true);
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

			const refreshToken = login.cookies.find((c: any) => c.name === "refresh_token");

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

			const accessToken = login.cookies.find((c: any) => c.name === "access_token");

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
			expect(response.json().code).toBe("ACCOUNT_DISABLED");
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

			const accessToken = login.cookies.find((c: any) => c.name === "access_token");

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

			const accessToken = login.cookies.find((c: any) => c.name === "access_token");

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

			const accessToken = login.cookies.find((c: any) => c.name === "access_token");

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
});
