import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshTokens, users } from "../db/schema.js";
import {
	authenticateLocalCredentials,
	deleteAccount,
	deleteAccountAvatar,
	getAccountProfile,
	prepareProfileUpdates,
	registerLocalAccount,
	replaceAccountAvatar,
	saveProfileUpdates,
} from "../services/auth-account-service.js";
import * as passwords from "../services/auth-service.js";
import * as imageUpload from "../utils/image-upload.js";
import { buildTestApp, type TestDb } from "./setup.js";

const { client, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return { client: client as Client, testDb: drizzle(client) as TestDb };
});
vi.mock("../db/client.js", () => ({ db: testDb }));

describe("local auth account service", () => {
	let app: FastifyInstance;
	let passwordHash: string;
	const password = "CorrectPassword123";
	const registration = { username: "LocalUser", email: "Local@example.com", password };

	beforeAll(async () => {
		({ app } = await buildTestApp({ client }));
		passwordHash = await passwords.hashPassword(password);
	});
	beforeEach(async () => {
		await testDb.delete(refreshTokens);
		await testDb.delete(users);
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
				username: registration.username,
				email: registration.email,
				passwordHash,
				credentialVersion: 7,
				avatarUrl: "avatar.webp",
				...overrides,
			})
			.returning();
		return user;
	}

	it("registers a local account without creating a session or exposing credentials", async () => {
		const result = await registerLocalAccount(registration);
		expect(result).toEqual({ ok: true, user: { id: expect.any(Number), username: "LocalUser" } });
		const [user] = await testDb.select().from(users);
		expect(user).toMatchObject({ email: "Local@example.com", authProvider: "local", lastLoginAt: null });
		expect(await passwords.verifyPassword(user.passwordHash ?? "", password)).toBe(true);
		expect(await testDb.select().from(refreshTokens)).toEqual([]);
	});

	it("does not link or reserve a local recovery identity by matching verified OIDC email", async () => {
		const external = await createUser({
			username: "external",
			authProvider: "oidc",
			email: null,
			verifiedOidcEmail: registration.email,
			passwordHash: null,
		});
		const result = await registerLocalAccount(registration);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected independent local account");
		expect(result.user.id).not.toBe(external.id);
		expect(await testDb.select().from(users)).toHaveLength(2);
		expect(await getAccountProfile(external.id)).toMatchObject({ authProvider: "oidc", email: registration.email });
	});

	it.each([
		[
			{ ...registration, username: "localuser", email: "different@example.com" },
			"USERNAME_EXISTS",
			"Username already taken",
		],
		[
			{ ...registration, username: "DifferentUser", email: "LOCAL@example.com" },
			"EMAIL_EXISTS",
			"Email already in use",
		],
		[
			{ ...registration, username: "LOCALUSER", email: "LOCAL@example.com" },
			"USERNAME_EXISTS",
			"Username already taken",
		],
	])("preserves case-insensitive conflicts and username-first precedence: %j", async (input, code, error) => {
		await createUser();
		const hash = vi.spyOn(passwords, "hashPassword");
		expect(await registerLocalAccount(input)).toEqual({ ok: false, error, code });
		expect(hash).not.toHaveBeenCalled();
		expect(await testDb.select().from(users)).toHaveLength(1);
	});

	it.each([
		"localuser",
		"LOCAL@EXAMPLE.COM",
	])("authenticates by case-insensitive username or email: %s", async (login) => {
		const user = await createUser();
		expect(await authenticateLocalCredentials(login, password)).toEqual({
			ok: true,
			user: { id: user.id, username: user.username, avatarUrl: "avatar.webp", credentialVersion: 7 },
		});
		const [updated] = await testDb.select().from(users);
		expect(updated.lastLoginAt).toBeInstanceOf(Date);
		expect(updated.updatedAt).toBeInstanceOf(Date);
		expect(await testDb.select().from(refreshTokens)).toEqual([]);
	});

	it.each([
		"missing_user",
		"inactive_account",
		"sso_only_account",
		"wrong_password",
	] as const)("preserves rejection reason, dummy work and unchanged login timestamps: %s", async (reason) => {
		const user =
			reason === "missing_user"
				? undefined
				: await createUser({
						isActive: reason !== "inactive_account",
						passwordHash: reason === "sso_only_account" ? null : passwordHash,
					});
		const dummy = vi.spyOn(passwords, "performDummyCredentialWork").mockResolvedValue(undefined);
		const verify = vi.spyOn(passwords, "verifyPassword");
		expect(await authenticateLocalCredentials("LocalUser", "WrongPassword")).toEqual(
			user ? { ok: false, reason, userId: user.id } : { ok: false, reason }
		);
		expect(dummy).toHaveBeenCalledTimes(reason === "wrong_password" ? 0 : 1);
		expect(verify).toHaveBeenCalledTimes(reason === "wrong_password" ? 1 : 0);
		const [unchanged] = await testDb.select().from(users);
		if (user) {
			expect(unchanged.lastLoginAt).toBeNull();
			expect(unchanged.updatedAt).toEqual(user.updatedAt);
		}
	});

	it("checks account activity before SSO-only credentials", async () => {
		const user = await createUser({ isActive: false, passwordHash: null, authProvider: "oidc" });
		expect(await authenticateLocalCredentials(user.username, password)).toEqual({
			ok: false,
			reason: "inactive_account",
			userId: user.id,
		});
	});

	it("propagates malformed stored hashes without updating the login timestamp", async () => {
		const user = await createUser({ passwordHash: "invalid-hash" });
		await expect(authenticateLocalCredentials(user.username, password)).rejects.toThrow();
		const [unchanged] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(unchanged.lastLoginAt).toBeNull();
	});

	it("rejects local password login for OIDC accounts even with a legacy password hash", async () => {
		const user = await createUser({ authProvider: "oidc" });
		expect(await authenticateLocalCredentials(user.username, password)).toMatchObject({
			ok: false,
			reason: "sso_only_account",
		});
	});

	it("propagates registration persistence failures without creating an account", async () => {
		await client.execute(
			"CREATE TRIGGER reject_registration BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
		);
		try {
			await expect(registerLocalAccount(registration)).rejects.toThrow();
			expect(await testDb.select().from(users)).toEqual([]);
		} finally {
			await client.execute("DROP TRIGGER reject_registration");
		}
	});

	it("returns public profile dates and only verified provider email for OIDC accounts", async () => {
		const user = await createUser({ createdAt: new Date("2026-01-01T12:00:00Z") });
		expect(await getAccountProfile(user.id)).toEqual({
			id: user.id,
			username: user.username,
			avatarUrl: "avatar.webp",
			email: user.email,
			oidcPictureUrl: "",
			authProvider: "local",
			createdAt: user.createdAt.toISOString(),
			lastLoginAt: null,
		});
		await testDb.update(users).set({ authProvider: "oidc" }).where(eq(users.id, user.id));
		expect(await getAccountProfile(user.id)).not.toHaveProperty("email");
		await testDb.update(users).set({ verifiedOidcEmail: "verified@example.com" }).where(eq(users.id, user.id));
		expect(await getAccountProfile(user.id)).toMatchObject({ authProvider: "oidc", email: "verified@example.com" });
		expect(await getAccountProfile(-1)).toBeNull();
	});

	it("keeps local avatar storage separate and reveals the provider fallback after local deletion", async () => {
		const picture = "https://images.example.test/avatar.png";
		const user = await createUser({ authProvider: "oidc", oidcPictureUrl: picture });
		const cleanup = vi.spyOn(imageUpload, "removeImageFiles").mockImplementation(() => {});
		expect(await getAccountProfile(user.id)).toMatchObject({ avatarUrl: "avatar.webp", oidcPictureUrl: picture });
		await replaceAccountAvatar(user.id, "/test/images", "replacement.webp");
		expect(await getAccountProfile(user.id)).toMatchObject({ avatarUrl: "replacement.webp", oidcPictureUrl: picture });
		await deleteAccountAvatar(user.id, "/test/images");
		expect(await getAccountProfile(user.id)).toMatchObject({ avatarUrl: null, oidcPictureUrl: picture });
		expect(await deleteAccountAvatar(user.id, "/test/images")).toBe(false);
		expect(cleanup.mock.calls.map((call) => call[1])).toEqual(["avatar.webp", "replacement.webp"]);
	});

	it("does not expose unsafe persisted provider URLs", async () => {
		const user = await createUser({ oidcPictureUrl: "javascript:alert(1)" });
		expect(await getAccountProfile(user.id)).toMatchObject({ oidcPictureUrl: "" });
	});

	it.each([
		{ email: "Local@example.com" },
		{ email: "new@example.com", currentPassword: password },
		{ newPassword: "NewPassword123", currentPassword: password },
		{ currentPassword: password },
	])("rejects provider-managed credential requests without relying on hash absence: %j", async (input) => {
		const user = await createUser({ authProvider: "oidc", verifiedOidcEmail: "verified@example.com" });
		expect(await prepareProfileUpdates(user.id, input)).toMatchObject({ ok: false, code: "SSO_ACCOUNT" });
		const [unchanged] = await testDb.select().from(users);
		expect(unchanged).toMatchObject({
			email: user.email,
			verifiedOidcEmail: "verified@example.com",
			passwordHash,
			credentialVersion: 7,
		});
	});

	it("prepares password changes without writing credentials or revoking sessions", async () => {
		const user = await createUser();
		const result = await prepareProfileUpdates(user.id, { currentPassword: password, newPassword: "NewPassword123" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected prepared profile update");
		expect(result.updates.credentialVersion).toBe(8);
		expect(await passwords.verifyPassword(result.updates.passwordHash ?? "", "NewPassword123")).toBe(true);
		const [unchanged] = await testDb.select().from(users);
		expect(unchanged.passwordHash).toBe(passwordHash);
		expect(unchanged.credentialVersion).toBe(7);
	});

	it.each([
		[{ newPassword: "NewPassword123" }, "CURRENT_PASSWORD_REQUIRED"],
		[{ currentPassword: "wrong", newPassword: "NewPassword123" }, "INVALID_PASSWORD"],
	])("preserves profile credential errors: %j", async (input, code) => {
		const user = await createUser();
		expect(await prepareProfileUpdates(user.id, input)).toMatchObject({ ok: false, code });
	});

	it("preserves SSO restrictions, email conflicts and no-op profile behavior", async () => {
		const user = await createUser();
		await testDb.insert(users).values({ username: "other", email: "taken@example.com" });
		expect(
			await prepareProfileUpdates(user.id, { currentPassword: password, email: "TAKEN@example.com" })
		).toMatchObject({
			ok: false,
			code: "EMAIL_EXISTS",
		});
		const unchanged = await prepareProfileUpdates(user.id, { email: user.email ?? undefined });
		expect(unchanged).toMatchObject({ ok: true, updates: { updatedAt: expect.any(Date) } });
		if (!unchanged.ok) throw new Error("Expected no-op profile update");
		expect(unchanged.updates).not.toHaveProperty("email");
		await testDb.update(users).set({ passwordHash: null }).where(eq(users.id, user.id));
		expect(await prepareProfileUpdates(user.id, { currentPassword: password, email: "new@example.com" })).toMatchObject(
			{
				ok: false,
				code: "SSO_ACCOUNT",
			}
		);
		expect(await prepareProfileUpdates(-1, {})).toEqual({ ok: false, error: "User not found" });
	});

	it("saves email-only changes without changing the credential version", async () => {
		const user = await createUser();
		const result = await prepareProfileUpdates(user.id, { currentPassword: password, email: "new@example.com" });
		if (!result.ok) throw new Error("Expected email update");
		await saveProfileUpdates(user.id, result.updates);
		const [updated] = await testDb.select().from(users);
		expect(updated).toMatchObject({ email: "new@example.com", credentialVersion: 7, passwordHash });
	});

	it("cleans up the prior avatar on replacement/deletion and treats absent avatars as missing", async () => {
		const user = await createUser();
		const cleanup = vi.spyOn(imageUpload, "removeImageFiles").mockImplementation(() => undefined);
		await replaceAccountAvatar(user.id, "/test/images", "new.webp");
		expect(cleanup).toHaveBeenLastCalledWith("/test/images", "avatar.webp");
		expect(await deleteAccountAvatar(user.id, "/test/images")).toBe(true);
		expect(cleanup).toHaveBeenLastCalledWith("/test/images", "new.webp");
		expect(await deleteAccountAvatar(user.id, "/test/images")).toBe(false);
		expect(await deleteAccountAvatar(-1, "/test/images")).toBe(false);
		expect(cleanup).toHaveBeenCalledTimes(2);
	});

	it("preserves cleanup-before-write ordering and does not restore files on a failed avatar update", async () => {
		const user = await createUser();
		const cleanup = vi.spyOn(imageUpload, "removeImageFiles").mockImplementation(() => undefined);
		await client.execute(
			"CREATE TRIGGER reject_avatar BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'failure'); END"
		);
		try {
			await expect(replaceAccountAvatar(user.id, "/test/images", "new.webp")).rejects.toThrow();
			expect(cleanup).toHaveBeenCalledWith("/test/images", "avatar.webp");
			const [unchanged] = await testDb.select().from(users);
			expect(unchanged.avatarUrl).toBe("avatar.webp");
		} finally {
			await client.execute("DROP TRIGGER reject_avatar");
		}
	});

	it("deletes account data after avatar cleanup and tolerates an already absent account", async () => {
		const user = await createUser();
		await testDb.insert(refreshTokens).values({ userId: user.id, tokenId: "session", expiresAt: new Date() });
		const cleanup = vi.spyOn(imageUpload, "removeImageFiles").mockImplementation(() => undefined);
		await deleteAccount(user.id, "/test/images");
		expect(cleanup).toHaveBeenCalledWith("/test/images", "avatar.webp");
		expect(await testDb.select().from(users)).toEqual([]);
		expect(await testDb.select().from(refreshTokens)).toEqual([]);
		await expect(deleteAccount(user.id, "/test/images")).resolves.toBeUndefined();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
