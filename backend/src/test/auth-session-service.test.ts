import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshTokens, users } from "../db/schema.js";
import { issueLoginSession, revokeRefreshSession, rotateRefreshSession } from "../services/auth-session-service.js";
import { buildTestApp, type TestDb } from "./setup.js";

const { client, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return { client: client as Client, testDb: drizzle(client) as TestDb };
});
vi.mock("../db/client.js", () => ({ db: testDb }));

describe("auth session service", () => {
	let app: FastifyInstance;
	let userId: number;
	const invalid = { ok: false, error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" };

	beforeAll(async () => {
		({ app } = await buildTestApp({ client, config: { accessTtl: 3, refreshTtl: 2 } }));
	});
	beforeEach(async () => {
		await testDb.delete(refreshTokens);
		await testDb.delete(users);
		const [user] = await testDb.insert(users).values({ username: "session-user", credentialVersion: 4 }).returning();
		userId = user.id;
	});
	afterEach(() => vi.restoreAllMocks());
	afterAll(async () => {
		await app.close();
		client.close();
	});

	async function createSession(options: { revoked?: boolean; expired?: boolean; version?: number } = {}) {
		await testDb.insert(refreshTokens).values({
			userId,
			tokenId: "old-session",
			revoked: options.revoked ?? false,
			expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 60_000)),
		});
		return app.jwt.sign(
			{ sub: userId, jti: "old-session", credentialVersion: options.version ?? 4 },
			{ expiresIn: "2d", key: app.config.refreshSecret }
		);
	}

	it("issues a login session with persisted refresh identity and configured token TTLs", async () => {
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		const result = await issueLoginSession(app, user);
		const access = await app.jwt.verify(result.accessToken);
		const refresh = await app.jwt.verify(result.refreshToken, { key: app.config.refreshSecret });
		expect(access).toMatchObject({ sub: userId, username: user.username, credentialVersion: 4 });
		expect(Number(access.exp) - Number(access.iat)).toBe(180);
		expect(refresh).toMatchObject({ sub: userId, credentialVersion: 4, jti: expect.stringMatching(/^[a-f0-9]{64}$/) });
		expect(Number(refresh.exp) - Number(refresh.iat)).toBe(2 * 24 * 60 * 60);
		const [session] = await testDb.select().from(refreshTokens);
		expect(session).toMatchObject({ userId, tokenId: refresh.jti, revoked: false, rotatedAt: null });
		expect(Math.abs(session.expiresAt.getTime() - (Date.now() + 2 * 24 * 60 * 60 * 1000))).toBeLessThan(5000);
	});

	it.each([1, 2])("preserves signing failure propagation and write order at signing call %i", async (failureCall) => {
		const [user] = await testDb.select().from(users);
		const originalSign = app.jwt.sign.bind(app.jwt);
		let calls = 0;
		vi.spyOn(app.jwt, "sign").mockImplementation(async (payload, options) => {
			if (++calls === failureCall) throw new Error("signing unavailable");
			return originalSign(payload, options);
		});
		await expect(issueLoginSession(app, user)).rejects.toThrow("signing unavailable");
		expect(await testDb.select().from(refreshTokens)).toHaveLength(failureCall === 1 ? 0 : 1);
	});

	it("rotates persisted sessions and signs credentials with configured TTLs", async () => {
		const original = await createSession();
		const result = await rotateRefreshSession(app, original);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected successful refresh");
		const access = await app.jwt.verify(result.accessToken);
		const refresh = await app.jwt.verify(result.refreshToken, { key: app.config.refreshSecret });
		expect(access).toMatchObject({ sub: userId, username: "session-user", credentialVersion: 4 });
		expect(Number(access.exp) - Number(access.iat)).toBe(180);
		expect(refresh).toMatchObject({ sub: userId, credentialVersion: 4 });
		expect(Number(refresh.exp) - Number(refresh.iat)).toBe(2 * 24 * 60 * 60);
		expect(refresh.jti).toMatch(/^[a-f0-9]{64}$/);
		const sessions = await testDb.select().from(refreshTokens);
		expect(sessions).toHaveLength(2);
		expect(sessions.find((session) => session.tokenId === "old-session")).toMatchObject({
			revoked: true,
			rotatedAt: expect.any(Date),
		});
		expect(sessions.find((session) => session.tokenId === refresh.jti)).toMatchObject({ userId, revoked: false });
		expect(await rotateRefreshSession(app, original)).toEqual(invalid);
		expect(await testDb.select().from(refreshTokens)).toHaveLength(2);
	});

	it.each([
		{ revoked: true },
		{ expired: true },
		{ version: 3 },
	])("rejects unusable refresh sessions without creating a replacement: %j", async (options) => {
		const token = await createSession(options);
		expect(await rotateRefreshSession(app, token)).toEqual(invalid);
		expect(await testDb.select().from(refreshTokens)).toHaveLength(1);
	});

	it("rejects invalid signatures and absent token records", async () => {
		expect(await rotateRefreshSession(app, "not-a-token")).toEqual(invalid);
		const token = await app.jwt.sign(
			{ sub: userId, jti: "absent", credentialVersion: 4 },
			{ key: app.config.refreshSecret }
		);
		expect(await rotateRefreshSession(app, token)).toEqual(invalid);
		expect(await testDb.select().from(refreshTokens)).toEqual([]);
	});

	it("preserves the disabled-user error and leaves the session unchanged", async () => {
		const token = await createSession();
		await testDb.update(users).set({ isActive: false }).where(eq(users.id, userId));
		expect(await rotateRefreshSession(app, token)).toEqual({
			ok: false,
			error: "User not found or disabled",
			code: "USER_INVALID",
		});
		const [session] = await testDb.select().from(refreshTokens);
		expect(session.revoked).toBe(false);
	});

	it("retains legacy zero credential-version behavior", async () => {
		await testDb.update(users).set({ credentialVersion: 0 }).where(eq(users.id, userId));
		await createSession();
		const token = await app.jwt.sign({ sub: userId, jti: "old-session" }, { key: app.config.refreshSecret });
		expect(await rotateRefreshSession(app, token)).toMatchObject({ ok: true });
	});

	it("preserves the generic failure response when signing fails after rotation", async () => {
		const token = await createSession();
		vi.spyOn(app.jwt, "sign").mockRejectedValueOnce(new Error("signing unavailable"));
		expect(await rotateRefreshSession(app, token)).toEqual(invalid);
		const sessions = await testDb.select().from(refreshTokens);
		expect(sessions).toHaveLength(2);
		expect(sessions.find((session) => session.tokenId === "old-session")?.revoked).toBe(true);
	});

	it("revokes only the presented session and tolerates repeated or invalid logout", async () => {
		const token = await createSession();
		await testDb.insert(refreshTokens).values({
			userId,
			tokenId: "other-session",
			expiresAt: new Date(Date.now() + 60_000),
		});
		await revokeRefreshSession(app, token);
		await expect(revokeRefreshSession(app, token)).resolves.toBeUndefined();
		await expect(revokeRefreshSession(app, "invalid")).resolves.toBeUndefined();
		const sessions = await testDb.select().from(refreshTokens);
		expect(sessions.find((session) => session.tokenId === "old-session")).toMatchObject({
			revoked: true,
			rotatedAt: null,
		});
		expect(sessions.find((session) => session.tokenId === "other-session")?.revoked).toBe(false);
	});
});
