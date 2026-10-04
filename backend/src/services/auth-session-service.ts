import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { refreshTokens, users } from "../db/schema.js";

// Only signing and runtime session settings cross this boundary; cookies remain route-owned.
type SessionRuntime = Pick<FastifyInstance, "jwt" | "config">;
type RefreshResult =
	| { ok: true; accessToken: string; refreshToken: string }
	| { ok: false; error: string; code: "INVALID_REFRESH_TOKEN" | "USER_INVALID" };

const invalidRefreshToken = {
	ok: false,
	error: "Invalid refresh token",
	code: "INVALID_REFRESH_TOKEN",
} as const;

export async function issueLoginSession(
	runtime: SessionRuntime,
	user: Pick<typeof users.$inferSelect, "id" | "username" | "credentialVersion">
): Promise<{ accessToken: string; refreshToken: string }> {
	// Login historically signs access first, persists the refresh record, then signs refresh.
	const accessToken = await runtime.jwt.sign(
		{ sub: user.id, username: user.username, credentialVersion: user.credentialVersion ?? 0 },
		{ expiresIn: `${runtime.config.accessTtl}m` }
	);
	const tokenId = randomBytes(32).toString("hex");
	const refreshExp = new Date(Date.now() + runtime.config.refreshTtl * 24 * 60 * 60 * 1000);
	await db.insert(refreshTokens).values({
		userId: user.id,
		tokenId,
		expiresAt: refreshExp,
	});
	const refreshToken = await runtime.jwt.sign(
		{ sub: user.id, jti: tokenId, credentialVersion: user.credentialVersion ?? 0 },
		{ expiresIn: `${runtime.config.refreshTtl}d`, key: runtime.config.refreshSecret }
	);
	return { accessToken, refreshToken };
}

export async function rotateRefreshSession(runtime: SessionRuntime, refreshToken: string): Promise<RefreshResult> {
	try {
		const decoded = await runtime.jwt.verify<{ sub: number; jti: string; credentialVersion?: number }>(refreshToken, {
			key: runtime.config.refreshSecret,
		});
		const [token] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenId, decoded.jti));
		if (!token || token.revoked || token.expiresAt < new Date()) {
			return invalidRefreshToken;
		}

		const [user] = await db.select().from(users).where(eq(users.id, decoded.sub));
		if (!user?.isActive) {
			return { ok: false, error: "User not found or disabled", code: "USER_INVALID" };
		}
		if ((decoded.credentialVersion ?? 0) !== (user.credentialVersion ?? 0)) {
			return invalidRefreshToken;
		}

		// Preserve the existing rotation order and error contract; this extraction adds no transaction.
		await db.update(refreshTokens).set({ revoked: true, rotatedAt: new Date() }).where(eq(refreshTokens.id, token.id));
		const newTokenId = randomBytes(32).toString("hex");
		const refreshExp = new Date(Date.now() + runtime.config.refreshTtl * 24 * 60 * 60 * 1000);
		await db.insert(refreshTokens).values({
			userId: user.id,
			tokenId: newTokenId,
			expiresAt: refreshExp,
		});

		const accessToken = await runtime.jwt.sign(
			{ sub: user.id, username: user.username, credentialVersion: user.credentialVersion ?? 0 },
			{ expiresIn: `${runtime.config.accessTtl}m` }
		);
		const replacementRefreshToken = await runtime.jwt.sign(
			{ sub: user.id, jti: newTokenId, credentialVersion: user.credentialVersion ?? 0 },
			{ expiresIn: `${runtime.config.refreshTtl}d`, key: runtime.config.refreshSecret }
		);
		return { ok: true, accessToken, refreshToken: replacementRefreshToken };
	} catch {
		return invalidRefreshToken;
	}
}

export async function revokeRefreshSession(runtime: SessionRuntime, refreshToken: string): Promise<void> {
	try {
		const decoded = await runtime.jwt.verify<{ jti: string }>(refreshToken, {
			key: runtime.config.refreshSecret,
		});
		await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.tokenId, decoded.jti));
	} catch {
		// Preserve best-effort logout: invalid tokens and persistence errors do not prevent cookie clearing.
	}
}
