import type { Client } from "@libsql/client";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./setup.js";

const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return { testClient: client, testDb: drizzle(client) };
});

vi.mock("../db/client.js", () => ({ db: testDb, migrationsReady: Promise.resolve() }));

vi.mock("../plugins/env.js", () => ({
	env: {
		AUTH_ENABLED: true,
		FORM_LOGIN_ENABLED: true,
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
		OPENAPI_DOCS_ENABLED: true,
		DOCS_AUTH_REQUIRED: true,
	},
}));

const { registerApiDocs } = await import("../plugins/api-docs.js");
const { requireAuth } = await import("../plugins/auth.js");

async function buildDocsApp(options: { docsEnabled: boolean; docsAuthRequired: boolean }): Promise<FastifyInstance> {
	const { app } = await buildTestApp({
		client: testClient,
		config: {
			accessSecret: "test-jwt-secret-12345",
			refreshSecret: "test-refresh-secret-12345",
			cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 15 * 60 },
			refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/auth", maxAge: 7 * 24 * 60 * 60 },
		},
	});
	await registerApiDocs(app, {
		enabled: options.docsEnabled,
		authRequired: options.docsAuthRequired,
	});
	app.get("/protected", { preHandler: requireAuth }, async () => ({ ok: true }));
	await app.ready();
	return app;
}

async function createActiveUser(client: Client): Promise<{ id: number; username: string }> {
	const username = "docsuser";
	await client.execute({
		sql: "INSERT INTO users (username, password_hash, auth_provider, is_active) VALUES (?, ?, ?, ?)",
		args: [username, "unused", "local", 1],
	});

	const result = await client.execute({
		sql: "SELECT id, username FROM users WHERE username = ?",
		args: [username],
	});
	const row = result.rows[0];
	return { id: Number(row.id), username: String(row.username) };
}

describe("OpenAPI docs protection", () => {
	afterAll(() => {
		testClient.close();
	});

	it("returns 404 when docs are disabled", async () => {
		const app = await buildDocsApp({ docsEnabled: false, docsAuthRequired: false });

		try {
			const response = await app.inject({ method: "GET", url: "/docs/json" });

			expect(response.statusCode).toBe(404);
		} finally {
			await app.close();
		}
	});

	it("rejects anonymous docs access when docs auth is required", async () => {
		const app = await buildDocsApp({ docsEnabled: true, docsAuthRequired: true });

		try {
			const docsResponse = await app.inject({ method: "GET", url: "/docs" });
			const jsonResponse = await app.inject({ method: "GET", url: "/docs/json" });

			expect(docsResponse.statusCode).toBe(401);
			expect(docsResponse.json()).toEqual({ error: "Authentication required", code: "AUTH_REQUIRED" });
			expect(jsonResponse.statusCode).toBe(401);
			expect(jsonResponse.json()).toEqual({ error: "Authentication required", code: "AUTH_REQUIRED" });
		} finally {
			await app.close();
		}
	});

	it("allows authenticated docs access when docs auth is required", async () => {
		await testClient.execute("DELETE FROM users");
		await testClient.execute("DELETE FROM sqlite_sequence");
		const app = await buildDocsApp({ docsEnabled: true, docsAuthRequired: true });

		try {
			const user = await createActiveUser(testClient);
			const token = await app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: "15m" });

			const response = await app.inject({
				method: "GET",
				url: "/docs/json",
				cookies: { access_token: token },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				openapi: "3.0.3",
				info: { title: "MedAssist-ng API" },
			});
		} finally {
			await app.close();
		}
	});

	it("allows anonymous docs access when docs auth is explicitly disabled", async () => {
		const app = await buildDocsApp({ docsEnabled: true, docsAuthRequired: false });

		try {
			const response = await app.inject({ method: "GET", url: "/docs/json" });

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				openapi: "3.0.3",
				info: { title: "MedAssist-ng API" },
			});
		} finally {
			await app.close();
		}
	});

	it("does not bypass protected API route auth when anonymous docs are enabled", async () => {
		const app = await buildDocsApp({ docsEnabled: true, docsAuthRequired: false });

		try {
			const docsResponse = await app.inject({ method: "GET", url: "/docs/json" });
			const protectedResponse = await app.inject({ method: "GET", url: "/protected" });

			expect(docsResponse.statusCode).toBe(200);
			expect(protectedResponse.statusCode).toBe(401);
			expect(protectedResponse.json()).toEqual({ error: "Authentication required", code: "AUTH_REQUIRED" });
		} finally {
			await app.close();
		}
	});
});
