import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/migration-utils.js";
import {
	getPublicShareContext,
	getPublicShareLanguage,
	getPublicShareOwnerName,
	getPublicSharePermissions,
} from "../services/public-share-service.js";

const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return { testClient: client, testDb: drizzle(client) };
});

vi.mock("../db/client.js", () => ({ db: testDb }));

const { generateShareToken, getActiveShareToken, isShareTokenFormat } = await import(
	"../services/share-token-service.js"
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

const activeToken = "a".repeat(64);
const legacyToken = "abcdef0123456789";

async function insertShare(options: { token: string; expiresAt?: number | null; revokedAt?: number | null }) {
	await testClient.execute({
		sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at, revoked_at)
			VALUES (1, ?, 'Ava', 14, ?, ?)`,
		args: [options.token, options.expiresAt ?? null, options.revokedAt ?? null],
	});
}

describe("share token service", () => {
	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
	});

	afterAll(() => testClient.close());
	afterEach(() => vi.useRealTimers());

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
		await testClient.execute("DELETE FROM share_tokens");
		await testClient.execute("DELETE FROM users");
		await testClient.execute(
			"INSERT INTO users (id, username, auth_provider, is_active) VALUES (1, 'owner', 'local', 1)"
		);
	});

	it("accepts current and legacy token formats and generates 64-hex tokens", () => {
		expect(isShareTokenFormat(activeToken)).toBe(true);
		expect(isShareTokenFormat(legacyToken)).toBe(true);
		expect(isShareTokenFormat("share_public_link")).toBe(false);
		expect(generateShareToken()).toMatch(/^[a-f0-9]{64}$/);
	});

	it("rejects invalid and missing public tokens without a database touch", async () => {
		await expect(getActiveShareToken("not-a-token")).resolves.toEqual({ share: null, reason: "invalid_format" });
		await expect(getActiveShareToken(activeToken)).resolves.toEqual({ share: null, reason: "not_found" });
	});

	it("keeps expired and revoked tokens unavailable without updating last use", async () => {
		await insertShare({ token: activeToken, expiresAt: Math.floor(Date.now() / 1000) - 1 });
		await insertShare({ token: legacyToken, revokedAt: Math.floor(Date.now() / 1000) - 1 });

		await expect(getActiveShareToken(activeToken)).resolves.toMatchObject({
			reason: "expired",
			share: { lastUsedAt: null },
		});
		await expect(getActiveShareToken(legacyToken)).resolves.toMatchObject({
			reason: "revoked",
			share: { lastUsedAt: null },
		});
	});

	it("returns an active public token and touches it only when requested", async () => {
		await insertShare({ token: activeToken, expiresAt: Math.floor(Date.now() / 1000) + 60 });

		const untouched = await getActiveShareToken(activeToken, { touchLastUsed: false });
		expect(untouched).toMatchObject({ reason: "ok", share: { token: activeToken, lastUsedAt: null } });

		const touched = await getActiveShareToken(activeToken);
		expect(touched).toMatchObject({
			reason: "ok",
			share: { token: activeToken, lastUsedAt: new Date("2026-07-11T10:00:00.000Z") },
		});
	});
});

describe("public share policy", () => {
	it("propagates the owner-selected language and explicit share permissions to the public response", () => {
		expect(
			getPublicShareContext({
				share: { takenBy: "Ava", scheduleDays: 14, allowJournalNotes: true, allowMarkTaken: false },
				ownerUsername: "owner",
				language: "de",
			})
		).toEqual({
			takenBy: "Ava",
			sharedBy: "owner",
			language: "de",
			scheduleDays: 14,
			allowJournalNotes: true,
			allowMarkTaken: false,
		});
	});

	it("keeps public owner visibility nullable and applies legacy fallbacks", () => {
		expect(getPublicShareOwnerName(undefined)).toBeNull();
		expect(getPublicShareOwnerName(undefined, "the owner")).toBe("the owner");
		expect(getPublicShareLanguage("fr")).toBe("en");
		expect(getPublicSharePermissions({ allowJournalNotes: null, allowMarkTaken: null })).toEqual({
			allowJournalNotes: false,
			allowMarkTaken: true,
		});
	});
});
