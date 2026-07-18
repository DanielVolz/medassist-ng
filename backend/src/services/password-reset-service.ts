import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, passwordResetTokens, refreshTokens, users } from "../db/schema.js";
import { getFooterHtml, getFooterPlain, type Language } from "../i18n/translations.js";
import { env } from "../plugins/env.js";
import { escapeHtml } from "../utils/html.js";
import { type EmailDeliveryResult, sendEmailNotification } from "./notifications/delivery.js";

const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export function hashPasswordResetToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function buildPasswordResetLink(token: string): string {
	if (!env.PUBLIC_APP_URL) {
		throw new Error("PASSWORD_RESET_PUBLIC_URL_REQUIRED");
	}

	const resetUrl = new URL(env.PUBLIC_APP_URL);
	resetUrl.hash = `reset-password?token=${encodeURIComponent(token)}`;
	return resetUrl.toString();
}

export async function createPasswordResetToken(userId: number): Promise<{ token: string; tokenHash: string }> {
	const token = randomBytes(32).toString("hex");
	const tokenHash = hashPasswordResetToken(token);
	const now = new Date();
	const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

	await db.transaction(async (tx) => {
		await tx
			.delete(passwordResetTokens)
			.where(or(isNotNull(passwordResetTokens.usedAt), lt(passwordResetTokens.expiresAt, now)));
		await tx.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
	});

	return { token, tokenHash };
}

export async function discardPasswordResetToken(tokenHash: string): Promise<void> {
	await db.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
}

export async function consumePasswordResetToken(token: string, passwordHash: string): Promise<boolean> {
	const tokenHash = hashPasswordResetToken(token);
	const now = new Date();

	return db.transaction(async (tx) => {
		const [consumedToken] = await tx
			.update(passwordResetTokens)
			.set({ usedAt: now })
			.where(
				and(
					eq(passwordResetTokens.tokenHash, tokenHash),
					gt(passwordResetTokens.expiresAt, now),
					isNull(passwordResetTokens.usedAt)
				)
			)
			.returning({ userId: passwordResetTokens.userId });

		if (!consumedToken) {
			return false;
		}

		// Multiple emails can be requested before delivery completes. Once any valid
		// link succeeds, invalidate every remaining reset link for this account.
		await tx
			.update(passwordResetTokens)
			.set({ usedAt: now })
			.where(and(eq(passwordResetTokens.userId, consumedToken.userId), isNull(passwordResetTokens.usedAt)));

		await tx
			.update(users)
			.set({
				passwordHash,
				credentialVersion: sql`${users.credentialVersion} + 1`,
				updatedAt: now,
			})
			.where(and(eq(users.id, consumedToken.userId), isNotNull(users.passwordHash)));
		await tx
			.update(refreshTokens)
			.set({ revoked: true, rotatedAt: now })
			.where(eq(refreshTokens.userId, consumedToken.userId));
		await tx.update(apiKeys).set({ isActive: false, updatedAt: now }).where(eq(apiKeys.userId, consumedToken.userId));

		return true;
	});
}

export async function sendPasswordResetEmail(input: {
	email: string;
	token: string;
	language: Language;
}): Promise<EmailDeliveryResult> {
	const resetLink = buildPasswordResetLink(input.token);
	const isGerman = input.language === "de";
	const subject = isGerman ? "MedAssist-ng Passwort zuruecksetzen" : "Reset your MedAssist-ng password";
	const content = isGerman
		? {
				title: "MedAssist-ng - Passwort zuruecksetzen",
				description: "Du hast eine Anfrage zum Zuruecksetzen deines MedAssist-ng Passworts erhalten.",
				action: "Lege ueber diesen Link ein neues Passwort fest:",
				cta: "Neues Passwort festlegen",
				expiry: "Der Link ist 15 Minuten gueltig.",
				securityNote: "Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail.",
			}
		: {
				title: "MedAssist-ng - Password reset",
				description: "You requested a MedAssist-ng password reset.",
				action: "Set a new password using this link:",
				cta: "Set new password",
				expiry: "This link is valid for 15 minutes.",
				securityNote: "If you did not request this, ignore this email.",
			};
	const text = `${content.title}\n\n${content.description}\n\n${content.action}\n${resetLink}\n\n${content.expiry} ${content.securityNote}\n\n---\n${getFooterPlain(input.language)}`;
	const escapedResetLink = escapeHtml(resetLink);
	const html = `
		<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
			<div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
				<h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${escapeHtml(content.title)}</h2>
				<p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${escapeHtml(content.description)}</p>

				<div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #eff6ff; border: 1px solid #bfdbfe;">
					<p style="margin: 0 0 8px; color: #1e40af; font-weight: 500; font-size: 13px;">${escapeHtml(content.action)}</p>
					<a href="${escapedResetLink}" style="color: #1d4ed8; font-size: 13px;">${escapeHtml(content.cta)}</a>
				</div>

				<p style="color: #6b7280; margin: 0 0 8px; font-size: 13px;">${escapeHtml(content.expiry)}</p>
				<p style="color: #6b7280; margin: 0; font-size: 13px;">${escapeHtml(content.securityNote)}</p>

				<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
				<p style="color: #9ca3af; font-size: 11px; margin: 0;">
					${getFooterHtml(input.language)}
				</p>
			</div>
		</div>
	`;

	return sendEmailNotification({
		to: input.email,
		subject,
		text,
		html,
	});
}
