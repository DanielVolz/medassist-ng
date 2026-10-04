import type { Client } from "@libsql/client";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userSettings, users } from "../db/schema.js";
import { requestLocalPasswordReset, resetLocalPassword } from "../services/auth-recovery-service.js";
import * as passwords from "../services/auth-service.js";
import { buildTestApp, type TestDb } from "./setup.js";

const { client, testDb, create, send, discard, consume } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return {
		client: client as Client,
		testDb: drizzle(client) as TestDb,
		create: vi.fn(),
		send: vi.fn(),
		discard: vi.fn(),
		consume: vi.fn(),
	};
});
vi.mock("../db/client.js", () => ({ db: testDb }));
vi.mock("../services/password-reset-service.js", () => ({
	createPasswordResetToken: create,
	sendPasswordResetEmail: send,
	discardPasswordResetToken: discard,
	consumePasswordResetToken: consume,
}));

describe("auth recovery orchestration", () => {
	let app: FastifyInstance;
	beforeAll(async () => {
		({ app } = await buildTestApp({ client }));
	});
	beforeEach(async () => {
		await testDb.delete(userSettings);
		await testDb.delete(users);
		create.mockReset().mockResolvedValue({ token: "reset-token", tokenHash: "reset-hash" });
		send.mockReset().mockResolvedValue({ success: true });
		discard.mockReset().mockResolvedValue(undefined);
		consume.mockReset().mockResolvedValue(true);
	});
	afterEach(() => vi.restoreAllMocks());
	afterAll(async () => {
		await app.close();
		client.close();
	});

	async function createUser(overrides: Partial<typeof users.$inferInsert> = {}) {
		const [user] = await testDb
			.insert(users)
			.values({
				username: "RecoveryUser",
				email: "recovery@example.com",
				passwordHash: "present",
				...overrides,
			})
			.returning();
		return user;
	}

	it.each([
		undefined,
		"de",
		"pt-PT",
	])("looks up case-insensitive accounts and normalizes recovery language: %s", async (language) => {
		const user = await createUser();
		if (language) await testDb.insert(userSettings).values({ userId: user.id, language });
		expect(await requestLocalPasswordReset("RECOVERY@EXAMPLE.COM")).toBeNull();
		expect(create).toHaveBeenCalledWith(user.id);
		expect(send).toHaveBeenCalledWith({
			email: user.email,
			token: "reset-token",
			language: language === "de" ? "de-DE" : (language ?? "en-US"),
		});
		expect(discard).not.toHaveBeenCalled();
	});

	it.each([
		"missing",
		"inactive",
		"sso",
		"no-email",
	])("performs dummy work without recovery side effects for %s", async (kind) => {
		if (kind !== "missing")
			await createUser({
				isActive: kind !== "inactive",
				passwordHash: kind === "sso" ? null : "present",
				email: kind === "no-email" ? null : "recovery@example.com",
			});
		const dummy = vi.spyOn(passwords, "performDummyCredentialWork").mockResolvedValue(undefined);
		expect(await requestLocalPasswordReset("recoveryuser")).toBeNull();
		expect(dummy).toHaveBeenCalledOnce();
		expect(create).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("discards failed deliveries before returning route-safe logging details", async () => {
		const user = await createUser();
		send.mockResolvedValue({ success: false });
		expect(await requestLocalPasswordReset(user.username)).toEqual({ userId: user.id, deliveryError: "unknown" });
		expect(discard).toHaveBeenCalledWith("reset-hash");
		discard.mockRejectedValue(new Error("discard failed"));
		await expect(requestLocalPasswordReset(user.username)).rejects.toThrow("discard failed");
	});

	it.each([
		true,
		false,
	])("hashes before consuming a reset token and preserves consumption result %s", async (result) => {
		const hash = vi.spyOn(passwords, "hashPassword").mockResolvedValue("password-hash");
		consume.mockResolvedValue(result);
		expect(await resetLocalPassword("reset-token", "new-password")).toBe(result);
		expect(hash).toHaveBeenCalledWith("new-password");
		expect(consume).toHaveBeenCalledWith("reset-token", "password-hash");
	});
});
