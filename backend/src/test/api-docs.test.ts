import cookie from "@fastify/cookie";
import type { Client } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jwtPlugin } from "../plugins/jwt.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return { testClient: client, testDb: db };
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

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

async function createSchema(client: Client) {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS users (
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
		)
	`);
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

async function buildDocsApp(options: { docsEnabled: boolean; docsAuthRequired: boolean }): Promise<FastifyInstance> {
	const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
	await app.register(cookie, { secret: "test-cookie-secret-12345" });
	await app.register(jwtPlugin, {
		secret: "test-jwt-secret-12345",
		cookie: { cookieName: "access_token", signed: false },
	});
	app.decorate("config", {
		accessSecret: "test-jwt-secret-12345",
		refreshSecret: "test-refresh-secret-12345",
		accessTtl: 15,
		refreshTtl: 7,
		cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 15 * 60 },
		refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/auth", maxAge: 7 * 24 * 60 * 60 },
	});
	await registerApiDocs(app, {
		enabled: options.docsEnabled,
		authRequired: options.docsAuthRequired,
	});
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
	beforeAll(async () => {
		await createSchema(testClient);
	});

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
		await clearData(testClient);
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
});
