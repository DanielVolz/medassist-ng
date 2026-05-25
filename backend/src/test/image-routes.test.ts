import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import type { Client } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { imageRoutes } = await import("../routes/images.js");

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
		`CREATE TABLE IF NOT EXISTS medications (
			id integer PRIMARY KEY AUTOINCREMENT,
			user_id integer NOT NULL,
			name text NOT NULL,
			taken_by_json text NOT NULL DEFAULT '[]',
			usage_json text NOT NULL DEFAULT '[]',
			every_json text NOT NULL DEFAULT '[]',
			start_json text NOT NULL DEFAULT '[]',
			intakes_json text NOT NULL DEFAULT '[]',
			image_url text,
			intake_reminders_enabled integer NOT NULL DEFAULT 0,
			is_obsolete integer NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS share_tokens (
			id integer PRIMARY KEY AUTOINCREMENT,
			user_id integer NOT NULL,
			token text NOT NULL UNIQUE,
			taken_by text NOT NULL,
			schedule_days integer NOT NULL DEFAULT 30,
			allow_journal_notes integer NOT NULL DEFAULT 0,
			allow_mark_taken integer NOT NULL DEFAULT 1,
			created_at integer NOT NULL DEFAULT (strftime('%s','now')),
			expires_at integer,
			last_used_at integer,
			revoked_at integer
		)`,
	];

	for (const sql of tableCreations) {
		await client.execute(sql);
	}
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM share_tokens");
	await client.execute("DELETE FROM medications");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

async function seedUser(id: number, username: string, avatarUrl: string | null = null) {
	await testClient.execute({
		sql: "INSERT INTO users (id, username, avatar_url) VALUES (?, ?, ?)",
		args: [id, username, avatarUrl],
	});
}

async function seedMedication(userId: number, imageUrl: string, takenBy: string[] = ["Daniel"]) {
	await testClient.execute({
		sql: "INSERT INTO medications (user_id, name, taken_by_json, image_url) VALUES (?, ?, ?, ?)",
		args: [userId, "Private Med", JSON.stringify(takenBy), imageUrl],
	});
}

async function seedShareToken(userId: number, token: string, takenBy: string) {
	await testClient.execute({
		sql: "INSERT INTO share_tokens (user_id, token, taken_by) VALUES (?, ?, ?)",
		args: [userId, token, takenBy],
	});
}

describe("Image routes", () => {
	let app: FastifyInstance;
	let imagesDir: string;

	beforeAll(async () => {
		await createSchema(testClient);
		imagesDir = mkdtempSync(join(tmpdir(), "medassist-image-routes-"));

		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(sensible);
		await app.register(cookie, { secret: "test-cookie-secret-12345" });
		await app.register(jwtPlugin, {
			secret: "test-jwt-secret-12345",
			cookie: { cookieName: "access_token", signed: false },
		});
		await app.register(imageRoutes, { imagesDir });
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
		rmSync(imagesDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		await clearData(testClient);
		rmSync(imagesDir, { recursive: true, force: true });
		mkdirSync(imagesDir, { recursive: true });
	});

	async function authCookie(userId: number, username: string): Promise<string> {
		const token = await app.jwt.sign({ sub: userId, username }, { expiresIn: "15m" });
		return `access_token=${token}`;
	}

	function writeImage(filename: string, content = "private image") {
		writeFileSync(join(imagesDir, filename), content);
	}

	it("blocks unauthenticated direct image requests", async () => {
		await seedUser(1, "owner");
		await seedMedication(1, "med-1-123.webp");
		writeImage("med-1-123.webp");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123.webp",
		});

		expect(response.statusCode).toBe(401);
		expect(response.body).not.toBe("private image");
	});

	it("serves owned medication images to authenticated owners", async () => {
		await seedUser(1, "owner");
		await seedMedication(1, "med-1-123.webp");
		writeImage("med-1-123.webp");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123.webp",
			headers: { cookie: await authCookie(1, "owner") },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe("image/webp");
		expect(response.body).toBe("private image");
	});

	it("serves owned avatar images to authenticated owners", async () => {
		await seedUser(1, "owner", "avatar_1-123.webp");
		writeImage("avatar_1-123.webp", "private avatar");

		const response = await app.inject({
			method: "GET",
			url: "/images/avatar_1-123.webp",
			headers: { cookie: await authCookie(1, "owner") },
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("private avatar");
	});

	it("does not serve another user's medication image to an authenticated user", async () => {
		await seedUser(1, "owner");
		await seedUser(2, "other");
		await seedMedication(1, "med-1-123.webp");
		writeImage("med-1-123.webp");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123.webp",
			headers: { cookie: await authCookie(2, "other") },
		});

		expect(response.statusCode).toBe(404);
		expect(response.body).not.toBe("private image");
	});

	it("serves thumbnail files when the stored full-size image is authorized", async () => {
		await seedUser(1, "owner");
		await seedMedication(1, "med-1-123.webp");
		writeImage("med-1-123-thumb.webp", "private thumb");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123-thumb.webp",
			headers: { cookie: await authCookie(1, "owner") },
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("private thumb");
	});

	it("serves medication images through valid share tokens only for shared people", async () => {
		await seedUser(1, "owner");
		await seedMedication(1, "med-1-123.webp", ["Daniel"]);
		await seedShareToken(1, "feedfacecafebeef", "Daniel");
		writeImage("med-1-123.webp");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123.webp?shareToken=feedfacecafebeef",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("private image");
	});

	it("rejects share tokens that do not include the medication person", async () => {
		await seedUser(1, "owner");
		await seedMedication(1, "med-1-123.webp", ["Daniel"]);
		await seedShareToken(1, "feedfacecafebeef", "Anna");
		writeImage("med-1-123.webp");

		const response = await app.inject({
			method: "GET",
			url: "/images/med-1-123.webp?shareToken=feedfacecafebeef",
		});

		expect(response.statusCode).toBe(404);
		expect(response.body).not.toBe("private image");
	});

	it("rejects traversal-style image filenames", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/images/%2e%2e.webp",
		});

		expect(response.statusCode).toBe(400);
	});
});
