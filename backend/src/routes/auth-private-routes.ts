import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { withImmediateWriteTransaction } from "../db/client.js";
import { getDataDir } from "../db/path-utils.js";
import { refreshTokens, users } from "../db/schema.js";
import { requireAuth } from "../plugins/auth.js";
import {
	deleteAccount,
	deleteAccountAvatar,
	getAccountProfile,
	prepareProfileUpdates,
	replaceAccountAvatar,
	saveProfileUpdates,
} from "../services/auth-account-service.js";
import { revokeRefreshSession, rotateRefreshSession } from "../services/auth-session-service.js";
import type { AuthUser } from "../types/fastify.js";
import { ALLOWED_IMAGE_MIME_TYPES, streamToBuffer, writeOptimizedImageSet } from "../utils/image-upload.js";
import { sensitiveRateLimitConfig } from "./auth-rate-limit-config.js";
import {
	deleteAccountRouteSchema,
	deleteAvatarRouteSchema,
	getProfileRouteSchema,
	logoutRouteSchema,
	refreshRouteSchema,
	updateProfileRouteSchema,
	updateProfileSchema,
	uploadAvatarRouteSchema,
} from "./auth-schemas.js";

// =============================================================================
// Rate Limiting Configuration for Auth Routes
// =============================================================================
// Stricter rate limits for authentication endpoints to prevent brute-force attacks
// Note: Rate limiting is implemented via @fastify/rate-limit plugin registered in index.ts
// and route-specific limits are applied via the 'config.rateLimit' option below.
// CodeQL may not recognize this pattern - see: https://github.com/github/codeql/issues
// lgtm[js/missing-rate-limiting]
const authRateLimitConfig = {
	max: 10, // 10 requests
	timeWindow: "1 minute", // per minute
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many requests. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
};

export function createAuthPrivateRoutes(app: FastifyInstance): () => void {
	const IMAGES_DIR = resolve(getDataDir(), "images");

	// Token TTLs from centralized runtime configuration.
	const accessTtlMinutes = app.config.accessTtl;
	const refreshTtlDays = app.config.refreshTtl;

	// Preserve configuration capture before public routes run their registration hooks.
	return () => authPrivateRoutes(app, IMAGES_DIR, accessTtlMinutes, refreshTtlDays);
}

function authPrivateRoutes(app: FastifyInstance, IMAGES_DIR: string, accessTtlMinutes: number, refreshTtlDays: number) {
	// ---------------------------------------------------------------------------
	// POST /auth/refresh - Refresh access token
	// ---------------------------------------------------------------------------
	app.post(
		"/auth/refresh",
		{
			config: { rateLimit: authRateLimitConfig },
			schema: refreshRouteSchema,
		},
		async (request, reply) => {
			const refreshTokenCookie = request.cookies.refresh_token;
			if (!refreshTokenCookie) {
				return reply.status(401).send({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
			}

			try {
				const result = await rotateRefreshSession(app, refreshTokenCookie);
				if (!result.ok) {
					return reply.status(401).send({ error: result.error, code: result.code });
				}
				return reply
					.setCookie("access_token", result.accessToken, app.config.cookieOptions)
					.setCookie("refresh_token", result.refreshToken, app.config.refreshCookieOptions)
					.send({ ok: true });
			} catch {
				return reply.status(401).send({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
			}
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/logout - Logout (revoke refresh token)
	// ---------------------------------------------------------------------------
	app.post(
		"/auth/logout",
		{
			config: { rateLimit: authRateLimitConfig },
			schema: logoutRouteSchema,
		},
		async (request, reply) => {
			const refreshTokenCookie = request.cookies.refresh_token;

			if (refreshTokenCookie) {
				await revokeRefreshSession(app, refreshTokenCookie);
			}

			return reply
				.clearCookie("access_token", app.config.cookieOptions)
				.clearCookie("refresh_token", app.config.refreshCookieOptions)
				.send({ ok: true });
		}
	);

	// ---------------------------------------------------------------------------
	// GET /auth/me - Get current user profile
	// ---------------------------------------------------------------------------
	app.get(
		"/auth/me",
		{
			preHandler: requireAuth,
			schema: getProfileRouteSchema,
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			const profile = await getAccountProfile(authUser.id);
			if (!profile) {
				return reply.status(404).send({ error: "User not found" });
			}

			return profile;
		}
	);

	// ---------------------------------------------------------------------------
	// PUT /auth/me - Update current user profile
	// ---------------------------------------------------------------------------
	app.put<{ Body: z.infer<typeof updateProfileSchema> }>(
		"/auth/me",
		{
			preHandler: requireAuth,
			config: { rateLimit: authRateLimitConfig },
			schema: updateProfileRouteSchema,
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			const parsed = updateProfileSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.issues[0]?.message ?? "Invalid input",
					code: "VALIDATION_ERROR",
				});
			}

			const { newPassword } = parsed.data;
			const result = await prepareProfileUpdates(authUser.id, parsed.data);
			if (!result.ok) {
				let status = 400;
				if (!result.code) status = 404;
				else if (result.code === "INVALID_PASSWORD") status = 401;
				else if (result.code === "EMAIL_EXISTS") status = 409;
				return reply.status(status).send({ error: result.error, ...(result.code ? { code: result.code } : {}) });
			}
			const { user, updates } = result;

			if (newPassword) {
				const newTokenId = randomBytes(32).toString("hex");
				const refreshExp = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);
				const newAccessToken = await app.jwt.sign(
					{
						sub: user.id,
						username: user.username,
						credentialVersion: updates.credentialVersion ?? user.credentialVersion ?? 0,
					},
					{ expiresIn: `${accessTtlMinutes}m` }
				);
				const newRefreshToken = await app.jwt.sign(
					{
						sub: user.id,
						jti: newTokenId,
						credentialVersion: updates.credentialVersion ?? user.credentialVersion ?? 0,
					},
					{ expiresIn: `${refreshTtlDays}d`, key: app.config.refreshSecret }
				);

				// Commit the credentials and replacement session together before publishing cookies.
				await withImmediateWriteTransaction(async (tx) => {
					await tx.update(users).set(updates).where(eq(users.id, user.id));
					await tx
						.update(refreshTokens)
						.set({ revoked: true, rotatedAt: new Date() })
						.where(eq(refreshTokens.userId, user.id));
					await tx.insert(refreshTokens).values({
						userId: user.id,
						tokenId: newTokenId,
						expiresAt: refreshExp,
					});
				});

				return reply
					.setCookie("access_token", newAccessToken, app.config.cookieOptions)
					.setCookie("refresh_token", newRefreshToken, app.config.refreshCookieOptions)
					.send({ ok: true, message: "Profile updated" });
			}

			await saveProfileUpdates(user.id, updates);

			return { ok: true, message: "Profile updated" };
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/avatar - Upload user avatar
	// ---------------------------------------------------------------------------
	app.post(
		"/auth/avatar",
		{
			preHandler: requireAuth,
			config: { rateLimit: authRateLimitConfig },
			schema: uploadAvatarRouteSchema,
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			const data = await request.file();
			if (!data) {
				return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });
			}

			// Validate file type
			if (!ALLOWED_IMAGE_MIME_TYPES.includes(data.mimetype)) {
				return reply.status(400).send({ error: "Invalid file type", code: "INVALID_TYPE" });
			}

			let uploadBuffer: Buffer;
			try {
				uploadBuffer = await streamToBuffer(data.file);
			} catch (error) {
				if (error instanceof Error && error.message === "IMAGE_TOO_LARGE") {
					return reply.status(400).send({ error: "Image too large", code: "IMAGE_TOO_LARGE" });
				}
				throw error;
			}

			let filename: string;
			try {
				({ filename } = await writeOptimizedImageSet(IMAGES_DIR, `avatar_${authUser.id}`, uploadBuffer));
			} catch {
				return reply.status(400).send({ error: "Invalid image", code: "INVALID_IMAGE" });
			}

			await replaceAccountAvatar(authUser.id, IMAGES_DIR, filename);

			return { ok: true, avatarUrl: filename };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /auth/avatar - Delete user avatar
	// ---------------------------------------------------------------------------
	app.delete(
		"/auth/avatar",
		{
			preHandler: requireAuth,
			config: { rateLimit: authRateLimitConfig },
			schema: deleteAvatarRouteSchema,
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			if (!(await deleteAccountAvatar(authUser.id, IMAGES_DIR))) {
				return reply.status(404).send({ error: "No avatar to delete" });
			}

			return { ok: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /auth/me - Delete user account and all data
	// ---------------------------------------------------------------------------
	app.delete(
		"/auth/me",
		{
			preHandler: requireAuth,
			config: { rateLimit: sensitiveRateLimitConfig },
			schema: deleteAccountRouteSchema,
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			await deleteAccount(authUser.id, IMAGES_DIR);

			app.log.info(`[Auth] Account deleted: username=${authUser.username}, userId=${authUser.id}`);

			// Clear auth cookies
			return reply
				.clearCookie("access_token", app.config.cookieOptions)
				.clearCookie("refresh_token", app.config.refreshCookieOptions)
				.send({ ok: true, message: "Account deleted" });
		}
	);
}
