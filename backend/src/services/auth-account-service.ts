import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { normalizeDateTime } from "../utils/date-time.js";
import { removeImageFiles } from "../utils/image-upload.js";
import { hashPassword, performDummyCredentialWork, verifyPassword } from "./auth-service.js";

type LoginFailureReason = "missing_user" | "wrong_password" | "inactive_account" | "sso_only_account";
type LoginIdentity = Pick<typeof users.$inferSelect, "id" | "username" | "avatarUrl" | "credentialVersion">;
type CredentialResult = { ok: true; user: LoginIdentity } | { ok: false; reason: LoginFailureReason; userId?: number };
type RegistrationResult =
	| { ok: true; user: Pick<typeof users.$inferSelect, "id" | "username"> }
	| { ok: false; error: string; code: "USERNAME_EXISTS" | "EMAIL_EXISTS" };

// Callers enforce login mode and parse input at the HTTP boundary before invoking these functions.
export async function registerLocalAccount(input: {
	username: string;
	email: string;
	password: string;
}): Promise<RegistrationResult> {
	const { username, email, password } = input;
	const [existingUser] = await db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
	if (existingUser) {
		return { ok: false, error: "Username already taken", code: "USERNAME_EXISTS" };
	}
	const [existingEmail] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
	if (existingEmail) {
		return { ok: false, error: "Email already in use", code: "EMAIL_EXISTS" };
	}

	const passwordHash = await hashPassword(password);
	const [newUser] = await db.insert(users).values({ username, email, passwordHash, authProvider: "local" }).returning();
	return { ok: true, user: { id: newUser.id, username: newUser.username } };
}

export async function authenticateLocalCredentials(username: string, password: string): Promise<CredentialResult> {
	const [user] = await db
		.select()
		.from(users)
		.where(sql`lower(${users.username}) = lower(${username}) OR lower(${users.email}) = lower(${username})`);

	// Ineligible accounts perform the same dummy hash work as the existing login handler.
	if (!user) {
		await performDummyCredentialWork();
		return { ok: false, reason: "missing_user" };
	}
	if (!user.isActive) {
		await performDummyCredentialWork();
		return { ok: false, reason: "inactive_account", userId: user.id };
	}
	if (!user.passwordHash) {
		await performDummyCredentialWork();
		return { ok: false, reason: "sso_only_account", userId: user.id };
	}
	if (!(await verifyPassword(user.passwordHash, password))) {
		return { ok: false, reason: "wrong_password", userId: user.id };
	}

	await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
	return {
		ok: true,
		user: {
			id: user.id,
			username: user.username,
			avatarUrl: user.avatarUrl,
			credentialVersion: user.credentialVersion,
		},
	};
}

export async function getAccountProfile(userId: number) {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) return null;
	const createdAt = normalizeDateTime(user.createdAt) ?? normalizeDateTime(user.updatedAt) ?? new Date(0).toISOString();
	const lastLoginAt = normalizeDateTime(user.lastLoginAt);
	return {
		id: user.id,
		username: user.username,
		avatarUrl: user.avatarUrl,
		authProvider: user.authProvider ?? "local",
		...(user.passwordHash ? { email: user.email } : {}),
		createdAt,
		lastLoginAt,
	};
}

type ProfilePreparationResult =
	| { ok: true; user: typeof users.$inferSelect; updates: Partial<typeof users.$inferInsert> }
	| {
			ok: false;
			error: string;
			code?: "CURRENT_PASSWORD_REQUIRED" | "SSO_ACCOUNT" | "INVALID_PASSWORD" | "EMAIL_EXISTS";
	  };

export async function prepareProfileUpdates(
	userId: number,
	input: { currentPassword?: string; email?: string; newPassword?: string }
): Promise<ProfilePreparationResult> {
	const { currentPassword, email, newPassword } = input;
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) return { ok: false, error: "User not found" };
	const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
	const emailChanged = email !== undefined && email !== user.email;
	if (newPassword || emailChanged) {
		if (!currentPassword) {
			return { ok: false, error: "Current password required", code: "CURRENT_PASSWORD_REQUIRED" };
		}
		if (!user.passwordHash) {
			return { ok: false, error: "Cannot change password for SSO account", code: "SSO_ACCOUNT" };
		}
		if (!(await verifyPassword(user.passwordHash, currentPassword))) {
			return { ok: false, error: "Current password is incorrect", code: "INVALID_PASSWORD" };
		}
		if (emailChanged) {
			const [existingEmail] = await db
				.select({ id: users.id })
				.from(users)
				.where(sql`lower(${users.email}) = lower(${email})`);
			if (existingEmail && existingEmail.id !== user.id) {
				return { ok: false, error: "Email already in use", code: "EMAIL_EXISTS" };
			}
			updates.email = email;
		}
		if (newPassword) {
			updates.passwordHash = await hashPassword(newPassword);
			updates.credentialVersion = (user.credentialVersion ?? 0) + 1;
		}
	}
	return { ok: true, user, updates };
}

export async function saveProfileUpdates(userId: number, updates: Partial<typeof users.$inferInsert>): Promise<void> {
	await db.update(users).set(updates).where(eq(users.id, userId));
}

export async function replaceAccountAvatar(userId: number, imagesDir: string, filename: string): Promise<void> {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (user?.avatarUrl) removeImageFiles(imagesDir, user.avatarUrl);
	await db.update(users).set({ avatarUrl: filename, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function deleteAccountAvatar(userId: number, imagesDir: string): Promise<boolean> {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user?.avatarUrl) return false;
	removeImageFiles(imagesDir, user.avatarUrl);
	await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, userId));
	return true;
}

export async function deleteAccount(userId: number, imagesDir: string): Promise<void> {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (user?.avatarUrl) removeImageFiles(imagesDir, user.avatarUrl);
	await db.delete(users).where(eq(users.id, userId));
}
