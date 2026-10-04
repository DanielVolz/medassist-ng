import { normalizeAppLanguage } from "@medassist/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { userSettings, users } from "../db/schema.js";
import { hashPassword, performDummyCredentialWork } from "./auth-service.js";
import {
	consumePasswordResetToken,
	createPasswordResetToken,
	discardPasswordResetToken,
	sendPasswordResetEmail,
} from "./password-reset-service.js";

export async function requestLocalPasswordReset(
	emailOrUsername: string
): Promise<{ userId: number; deliveryError: string } | null> {
	const [user] = await db
		.select()
		.from(users)
		.where(
			sql`lower(${users.username}) = lower(${emailOrUsername}) OR lower(${users.email}) = lower(${emailOrUsername})`
		);
	if (!user?.isActive || !user.passwordHash || !user.email) {
		await performDummyCredentialWork();
		return null;
	}

	const [settings] = await db
		.select({ language: userSettings.language })
		.from(userSettings)
		.where(eq(userSettings.userId, user.id));
	const language = normalizeAppLanguage(settings?.language);
	const { token, tokenHash } = await createPasswordResetToken(user.id);
	const delivery = await sendPasswordResetEmail({ email: user.email, token, language });
	if (!delivery.success) {
		await discardPasswordResetToken(tokenHash);
		return { userId: user.id, deliveryError: delivery.error ?? "unknown" };
	}
	return null;
}

export async function resetLocalPassword(token: string, newPassword: string): Promise<boolean> {
	const passwordHash = await hashPassword(newPassword);
	return consumePasswordResetToken(token, passwordHash);
}
