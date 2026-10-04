import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema, updateProfileSchema } from "../routes/auth-schemas.js";
import { hashPassword, performDummyCredentialWork, verifyPassword } from "../services/auth-service.js";

describe("auth password helpers", () => {
	it("preserves Argon2id parameters, random salts and password verification", async () => {
		const password = "correct-horse-battery-staple";
		const hash = await hashPassword(password);
		expect(hash).toMatch(/^\$argon2id\$v=19\$/);
		expect(hash.split("$")[3].split(",").sort()).toEqual(["m=65536", "p=4", "t=3"]);
		expect(Buffer.from(hash.split("$")[5], "base64")).toHaveLength(32);
		expect(await verifyPassword(hash, password)).toBe(true);
		expect(await verifyPassword(hash, "wrong-password")).toBe(false);
		expect(await hashPassword(password)).not.toBe(hash);
	});

	it("propagates malformed-hash failures and completes dummy credential work", async () => {
		await expect(verifyPassword("invalid-hash", "password")).rejects.toThrow();
		await expect(performDummyCredentialWork()).resolves.toBeUndefined();
	});
});

describe("extracted auth validation", () => {
	it("preserves trimming, password whitespace and remember-me defaults", () => {
		expect(loginSchema.parse({ username: " user ", password: " password " })).toEqual({
			username: "user",
			password: " password ",
			rememberMe: false,
		});
		expect(registerSchema.parse({ username: " user ", email: " user@example.com ", password: " password " })).toEqual({
			username: "user",
			email: "user@example.com",
			password: " password ",
		});
		expect(updateProfileSchema.parse({})).toEqual({});
	});

	it("retains credential length limits and reset-token validation", () => {
		expect(
			registerSchema.safeParse({ username: "bad name", email: "user@example.com", password: "password" }).success
		).toBe(false);
		expect(updateProfileSchema.safeParse({ newPassword: "short" }).success).toBe(false);
		expect(updateProfileSchema.safeParse({ newPassword: "a".repeat(129) }).success).toBe(false);
		expect(resetPasswordSchema.safeParse({ token: "A".repeat(64), newPassword: "password" }).success).toBe(true);
		expect(resetPasswordSchema.safeParse({ token: "g".repeat(64), newPassword: "password" }).success).toBe(false);
	});
});
