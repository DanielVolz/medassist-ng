import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { shareTokens } from "../db/schema.js";

export const SHARE_TOKEN_PATTERN = /^(?:[a-f0-9]{16}|[a-f0-9]{64})$/;

export type ShareTokenLookupReason = "invalid_format" | "not_found" | "expired" | "revoked" | "ok";

export function generateShareToken(): string {
	return randomBytes(32).toString("hex");
}

export function isShareTokenFormat(token: string): boolean {
	return SHARE_TOKEN_PATTERN.test(token);
}

export function shareTokenRateLimitKey(request: { ip: string; params?: unknown }): string {
	return request.ip;
}

export async function getActiveShareToken(
	token: string,
	options: { touchLastUsed?: boolean } = {}
): Promise<{
	share: typeof shareTokens.$inferSelect | null;
	reason: ShareTokenLookupReason;
}> {
	if (!isShareTokenFormat(token)) {
		return { share: null, reason: "invalid_format" };
	}

	const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
	if (!share) return { share: null, reason: "not_found" };

	if (share.revokedAt) {
		return { share, reason: "revoked" };
	}

	if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
		return { share, reason: "expired" };
	}

	if (options.touchLastUsed ?? true) {
		const lastUsedAt = new Date();
		await db.update(shareTokens).set({ lastUsedAt }).where(eq(shareTokens.id, share.id));
		return { share: { ...share, lastUsedAt }, reason: "ok" };
	}

	return { share, reason: "ok" };
}
