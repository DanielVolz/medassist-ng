import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import argon2, { type HashOptions } from "argon2";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { getDataDir } from "../db/path-utils.js";
import { refreshTokens, userSettings, users } from "../db/schema.js";
import type { Language } from "../i18n/translations.js";
import { getAuthState, requireAuth } from "../plugins/auth.js";
import {
	consumePasswordResetToken,
	createPasswordResetToken,
	discardPasswordResetToken,
	sendPasswordResetEmail,
} from "../services/password-reset-service.js";
import type { AuthUser } from "../types/fastify.js";
import { normalizeDateTime } from "../utils/date-time.js";
import {
	ALLOWED_IMAGE_MIME_TYPES,
	removeImageFiles,
	streamToBuffer,
	writeOptimizedImageSet,
} from "../utils/image-upload.js";

// =============================================================================
// Argon2id Configuration - State of the Art Password Hashing
// =============================================================================
const ARGON2_OPTIONS: HashOptions = {
	type: argon2.argon2id, // Argon2id - best for password hashing
	memoryCost: 65536, // 64 MB memory
	timeCost: 3, // 3 iterations
	parallelism: 4, // 4 parallel threads
	hashLength: 32, // 256-bit hash
};

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

// lgtm[js/missing-rate-limiting]
const sensitiveRateLimitConfig = {
	max: 5, // 5 requests
	timeWindow: "15 minutes", // per 15 minutes (for login/register)
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many attempts. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
};

const forgotPasswordRateLimitConfig = {
	max: 3,
	timeWindow: "15 minutes",
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many attempts. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
};

// =============================================================================
// Validation Schemas
// =============================================================================
const registerSchema = z.object({
	username: z
		.string()
		.trim()
		.min(3, "Username must be at least 3 characters")
		.max(50, "Username must be at most 50 characters")
		.regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens"),
	email: z.string().trim().email("Email must be valid").max(255, "Email must be at most 255 characters"),
	password: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters"),
});

const loginSchema = z.object({
	username: z.string().trim().min(1, "Username is required"),
	password: z.string().min(1, "Password is required"),
	rememberMe: z.boolean().optional().default(false),
});

const updateProfileSchema = z.object({
	currentPassword: z.string().optional(),
	email: z.string().trim().email("Email must be valid").max(255, "Email must be at most 255 characters").optional(),
	newPassword: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters")
		.optional(),
});

const forgotPasswordSchema = z.object({
	emailOrUsername: z.string().trim().min(1).max(255),
});

const resetPasswordSchema = z.object({
	token: z.string().regex(/^[a-f0-9]{64}$/i, "Invalid reset token"),
	newPassword: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters"),
});

const authEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }];
const authErrorSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		code: { type: "string" },
	},
};

const invalidCredentialsResponse = { error: "Invalid username or password", code: "INVALID_CREDENTIALS" } as const;
const genericForgotPasswordResponse = {
	ok: true,
	message: "If an eligible account exists, a reset link has been sent.",
};
const publicAuthStateRateLimitConfig = {
	max: 60,
	timeWindow: "1 minute",
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many requests. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
};

type LoginFailureReason = "missing_user" | "wrong_password" | "inactive_account" | "sso_only_account";

function toPublicAuthState(state: Awaited<ReturnType<typeof getAuthState>>) {
	return {
		authEnabled: state.authEnabled,
		registrationEnabled: state.registrationEnabled,
		formLoginEnabled: state.formLoginEnabled,
		passwordResetEnabled: state.passwordResetEnabled,
		oidcEnabled: state.oidcEnabled,
		oidcProviderName: state.oidcProviderName,
		needsSetup: state.needsSetup,
	};
}

async function performDummyCredentialWork() {
	await argon2.hash("dummy", ARGON2_OPTIONS);
}

// =============================================================================
// Auth Routes
// =============================================================================
export async function authRoutes(app: FastifyInstance) {
	const IMAGES_DIR = resolve(getDataDir(), "images");

	// Token TTLs from centralized runtime configuration.
	const accessTtlMinutes = app.config.accessTtl;
	const refreshTtlDays = app.config.refreshTtl;

	// ---------------------------------------------------------------------------
	// GET /auth/state - Public auth state (needed before login)
	// ---------------------------------------------------------------------------
	app.get(
		"/auth/state",
		{
			config: { rateLimit: publicAuthStateRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Get authentication state",
				description: "Returns the public auth and login mode state required before user login.",
				response: {
					200: {
						type: "object",
						additionalProperties: false,
						required: [
							"authEnabled",
							"registrationEnabled",
							"formLoginEnabled",
							"passwordResetEnabled",
							"oidcEnabled",
							"oidcProviderName",
							"needsSetup",
						],
						properties: {
							authEnabled: { type: "boolean" },
							registrationEnabled: { type: "boolean" },
							formLoginEnabled: { type: "boolean" },
							passwordResetEnabled: { type: "boolean" },
							oidcEnabled: { type: "boolean" },
							oidcProviderName: { type: "string" },
							needsSetup: { type: "boolean" },
						},
					},
				},
			},
		},
		async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
			return toPublicAuthState(await getAuthState());
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/register - User registration
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof registerSchema> }>(
		"/auth/register",
		{
			config: { rateLimit: sensitiveRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Register local user",
				body: {
					type: "object",
					required: ["username", "email", "password"],
					properties: {
						username: { type: "string", minLength: 3, maxLength: 50 },
						email: { type: "string", format: "email", maxLength: 255 },
						password: { type: "string", minLength: 8, maxLength: 128 },
					},
					example: {
						username: "daniel",
						email: "daniel@example.com",
						password: "correct-horse-battery-staple",
					},
				},
				response: {
					201: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							user: {
								type: "object",
								properties: {
									id: { type: "number" },
									username: { type: "string" },
								},
							},
							message: { type: "string" },
						},
					},
					400: authErrorSchema,
					409: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			// Check auth state
			const state = await getAuthState();

			if (!state.authEnabled) {
				return reply.status(400).send({ error: "Authentication is disabled", code: "AUTH_DISABLED" });
			}

			if (!state.registrationEnabled) {
				return reply.status(400).send({ error: "Registration is disabled", code: "REGISTRATION_DISABLED" });
			}

			if (!state.formLoginEnabled) {
				return reply.status(400).send({ error: "Form login is disabled", code: "FORM_LOGIN_DISABLED" });
			}

			// Validate input
			const parsed = registerSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.issues[0]?.message ?? "Invalid input",
					code: "VALIDATION_ERROR",
				});
			}

			const { username, email, password } = parsed.data;

			// Check if username already exists
			const [existingUser] = await db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
			if (existingUser) {
				return reply.status(409).send({ error: "Username already taken", code: "USERNAME_EXISTS" });
			}
			const [existingEmail] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
			if (existingEmail) {
				return reply.status(409).send({ error: "Email already in use", code: "EMAIL_EXISTS" });
			}

			// Hash password with Argon2id
			const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

			// Create user
			const [newUser] = await db
				.insert(users)
				.values({
					username,
					email,
					passwordHash,
					authProvider: "local",
				})
				.returning();

			app.log.info(`[Auth] Account registered: username=${newUser.username}, userId=${newUser.id}`);

			return reply.status(201).send({
				ok: true,
				user: {
					id: newUser.id,
					username: newUser.username,
				},
				message: "Account created",
			});
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/login - User login
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof loginSchema> }>(
		"/auth/login",
		{
			config: { rateLimit: sensitiveRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Login with username and password",
				body: {
					type: "object",
					required: ["username", "password"],
					properties: {
						username: { type: "string" },
						password: { type: "string" },
						rememberMe: { type: "boolean" },
					},
					example: {
						username: "daniel",
						password: "correct-horse-battery-staple",
						rememberMe: true,
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							user: {
								type: "object",
								properties: {
									id: { type: "number" },
									username: { type: "string" },
									avatarUrl: { type: ["string", "null"] },
								},
							},
						},
					},
					400: authErrorSchema,
					401: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const state = await getAuthState();

			if (!state.authEnabled) {
				return reply.status(400).send({ error: "Authentication is disabled", code: "AUTH_DISABLED" });
			}

			if (!state.formLoginEnabled) {
				return reply.status(400).send({ error: "Form login is disabled", code: "FORM_LOGIN_DISABLED" });
			}

			const parsed = loginSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid credentials",
					code: "VALIDATION_ERROR",
				});
			}

			const { username, password, rememberMe } = parsed.data;

			const [user] = await db
				.select()
				.from(users)
				.where(sql`lower(${users.username}) = lower(${username}) OR lower(${users.email}) = lower(${username})`);

			// Generic error to prevent user enumeration
			const invalidCredentialsError = (reason: LoginFailureReason, rejectedUser?: typeof users.$inferSelect) => {
				app.log.warn(
					{ reason, username, userId: rejectedUser?.id },
					"[Auth] Login rejected with invalid credentials response"
				);
				return reply.status(401).send(invalidCredentialsResponse);
			};

			if (!user) {
				// Perform dummy hash to prevent timing attacks
				await performDummyCredentialWork();
				return invalidCredentialsError("missing_user");
			}

			if (!user.isActive) {
				await performDummyCredentialWork();
				return invalidCredentialsError("inactive_account", user);
			}

			if (!user.passwordHash) {
				// SSO-only user trying local login
				await performDummyCredentialWork();
				return invalidCredentialsError("sso_only_account", user);
			}

			// Verify password
			const valid = await argon2.verify(user.passwordHash, password, ARGON2_OPTIONS);
			if (!valid) {
				return invalidCredentialsError("wrong_password", user);
			}

			// Update last login
			await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));

			// Generate tokens
			const accessToken = await app.jwt.sign(
				{ sub: user.id, username: user.username, credentialVersion: user.credentialVersion ?? 0 },
				{ expiresIn: `${accessTtlMinutes}m` }
			);

			const tokenId = randomBytes(32).toString("hex");
			const refreshExp = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

			await db.insert(refreshTokens).values({
				userId: user.id,
				tokenId,
				expiresAt: refreshExp,
			});

			const refreshToken = await app.jwt.sign(
				{ sub: user.id, jti: tokenId, credentialVersion: user.credentialVersion ?? 0 },
				{ expiresIn: `${refreshTtlDays}d`, key: app.config.refreshSecret }
			);

			app.log.info(`[Auth] Login succeeded: username=${user.username}, userId=${user.id}, rememberMe=${rememberMe}`);

			// Cookie options: with maxAge for "remember me", without for session cookie
			const accessCookieOptions = rememberMe
				? app.config.cookieOptions
				: { ...app.config.cookieOptions, maxAge: undefined };
			const refreshCookieOptions = rememberMe
				? app.config.refreshCookieOptions
				: { ...app.config.refreshCookieOptions, maxAge: undefined };

			return reply
				.setCookie("access_token", accessToken, accessCookieOptions)
				.setCookie("refresh_token", refreshToken, refreshCookieOptions)
				.send({
					ok: true,
					user: {
						id: user.id,
						username: user.username,
						avatarUrl: user.avatarUrl,
					},
				});
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/forgot-password - Generic local account recovery request
	// ---------------------------------------------------------------------------
	app.post<{ Body: unknown }>(
		"/auth/forgot-password",
		{
			config: { rateLimit: forgotPasswordRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Request a password reset link",
				response: {
					200: {
						type: "object",
						properties: { ok: { type: "boolean" }, message: { type: "string" } },
					},
				},
			},
		},
		async (request, reply) => {
			const parsed = forgotPasswordSchema.safeParse(request.body);
			const state = await getAuthState();

			if (!parsed.success || !state.passwordResetEnabled) {
				await performDummyCredentialWork();
				return reply.send(genericForgotPasswordResponse);
			}

			const { emailOrUsername } = parsed.data;
			const [user] = await db
				.select()
				.from(users)
				.where(
					sql`lower(${users.username}) = lower(${emailOrUsername}) OR lower(${users.email}) = lower(${emailOrUsername})`
				);

			if (!user?.isActive || !user.passwordHash || !user.email) {
				await performDummyCredentialWork();
				return reply.send(genericForgotPasswordResponse);
			}

			const [settings] = await db
				.select({ language: userSettings.language })
				.from(userSettings)
				.where(eq(userSettings.userId, user.id));
			const language: Language = settings?.language === "de" ? "de" : "en";
			const { token, tokenHash } = await createPasswordResetToken(user.id);
			const delivery = await sendPasswordResetEmail({ email: user.email, token, language });

			if (!delivery.success) {
				await discardPasswordResetToken(tokenHash);
				request.log.error(
					{ userId: user.id, deliveryError: delivery.error ?? "unknown" },
					"[Auth] Password reset email delivery failed"
				);
			}

			return reply.send(genericForgotPasswordResponse);
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/reset-password - Atomically consume a local reset token
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof resetPasswordSchema> }>(
		"/auth/reset-password",
		{
			config: { rateLimit: sensitiveRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Reset a local account password",
				body: {
					type: "object",
					required: ["token", "newPassword"],
					properties: {
						token: { type: "string", minLength: 64, maxLength: 64 },
						newPassword: { type: "string", minLength: 8, maxLength: 128 },
					},
				},
				response: {
					200: { type: "object", properties: { ok: { type: "boolean" } } },
					400: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const parsed = resetPasswordSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: "Invalid or expired reset link", code: "INVALID_RESET_TOKEN" });
			}

			const passwordHash = await argon2.hash(parsed.data.newPassword, ARGON2_OPTIONS);
			const consumed = await consumePasswordResetToken(parsed.data.token, passwordHash);
			if (!consumed) {
				return reply.status(400).send({ error: "Invalid or expired reset link", code: "INVALID_RESET_TOKEN" });
			}

			return { ok: true };
		}
	);

	// ---------------------------------------------------------------------------
	// POST /auth/refresh - Refresh access token
	// ---------------------------------------------------------------------------
	app.post(
		"/auth/refresh",
		{
			config: { rateLimit: authRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Refresh access token",
				description: "Requires refresh token cookie context.",
				response: {
					200: { type: "object", properties: { ok: { type: "boolean" } } },
					401: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const refreshTokenCookie = request.cookies.refresh_token;
			if (!refreshTokenCookie) {
				return reply.status(401).send({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
			}

			try {
				// Verify refresh token
				const decoded = await app.jwt.verify<{ sub: number; jti: string; credentialVersion?: number }>(
					refreshTokenCookie,
					{
						key: app.config.refreshSecret,
					}
				);

				// Check if token exists and is valid
				const [token] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenId, decoded.jti));

				if (!token || token.revoked || token.expiresAt < new Date()) {
					return reply.status(401).send({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
				}

				// Get user
				const [user] = await db.select().from(users).where(eq(users.id, decoded.sub));
				if (!user?.isActive) {
					return reply.status(401).send({ error: "User not found or disabled", code: "USER_INVALID" });
				}

				if ((decoded.credentialVersion ?? 0) !== (user.credentialVersion ?? 0)) {
					return reply.status(401).send({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
				}

				// Rotate refresh token (revoke old, create new)
				await db
					.update(refreshTokens)
					.set({ revoked: true, rotatedAt: new Date() })
					.where(eq(refreshTokens.id, token.id));

				const newTokenId = randomBytes(32).toString("hex");
				const refreshExp = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

				await db.insert(refreshTokens).values({
					userId: user.id,
					tokenId: newTokenId,
					expiresAt: refreshExp,
				});

				// Generate new tokens
				const newAccessToken = await app.jwt.sign(
					{ sub: user.id, username: user.username, credentialVersion: user.credentialVersion ?? 0 },
					{ expiresIn: `${accessTtlMinutes}m` }
				);

				const newRefreshToken = await app.jwt.sign(
					{ sub: user.id, jti: newTokenId, credentialVersion: user.credentialVersion ?? 0 },
					{ expiresIn: `${refreshTtlDays}d`, key: app.config.refreshSecret }
				);

				return reply
					.setCookie("access_token", newAccessToken, app.config.cookieOptions)
					.setCookie("refresh_token", newRefreshToken, app.config.refreshCookieOptions)
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
			schema: {
				tags: ["auth"],
				summary: "Logout and clear auth cookies",
				response: {
					200: { type: "object", properties: { ok: { type: "boolean" } } },
				},
			},
		},
		async (request, reply) => {
			const refreshTokenCookie = request.cookies.refresh_token;

			if (refreshTokenCookie) {
				try {
					const decoded = await app.jwt.verify<{ jti: string }>(refreshTokenCookie, {
						key: app.config.refreshSecret,
					});

					// Revoke the refresh token
					await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.tokenId, decoded.jti));
				} catch {
					// Invalid token, ignore
				}
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
			schema: {
				tags: ["auth"],
				summary: "Get current user profile",
				security: authEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							id: { type: "number" },
							username: { type: "string" },
							email: { type: ["string", "null"], format: "email" },
							avatarUrl: { type: ["string", "null"] },
							authProvider: { type: "string" },
							createdAt: { type: "string", format: "date-time" },
							lastLoginAt: { type: ["string", "null"], format: "date-time" },
						},
					},
					401: authErrorSchema,
					404: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			const [user] = await db.select().from(users).where(eq(users.id, authUser.id));
			if (!user) {
				return reply.status(404).send({ error: "User not found" });
			}

			const createdAt =
				normalizeDateTime(user.createdAt) ?? normalizeDateTime(user.updatedAt) ?? new Date(0).toISOString();
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
	);

	// ---------------------------------------------------------------------------
	// PUT /auth/me - Update current user profile
	// ---------------------------------------------------------------------------
	app.put<{ Body: z.infer<typeof updateProfileSchema> }>(
		"/auth/me",
		{
			preHandler: requireAuth,
			config: { rateLimit: authRateLimitConfig },
			schema: {
				tags: ["auth"],
				summary: "Update current user profile",
				security: authEndpointSecurity,
				body: {
					type: "object",
					properties: {
						currentPassword: { type: "string" },
						email: { type: "string", format: "email", maxLength: 255 },
						newPassword: { type: "string", minLength: 8, maxLength: 128 },
					},
					example: {
						currentPassword: "current-password",
						newPassword: "new-strong-password",
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							message: { type: "string" },
						},
					},
					400: authErrorSchema,
					401: authErrorSchema,
					404: authErrorSchema,
				},
			},
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

			const { currentPassword, email, newPassword } = parsed.data;
			const [user] = await db.select().from(users).where(eq(users.id, authUser.id));

			if (!user) {
				return reply.status(404).send({ error: "User not found" });
			}

			const updates: Partial<typeof users.$inferInsert> = {
				updatedAt: new Date(),
			};

			const emailChanged = email !== undefined && email !== user.email;
			if (newPassword || emailChanged) {
				if (!currentPassword) {
					return reply.status(400).send({ error: "Current password required", code: "CURRENT_PASSWORD_REQUIRED" });
				}

				if (!user.passwordHash) {
					return reply.status(400).send({ error: "Cannot change password for SSO account", code: "SSO_ACCOUNT" });
				}

				const valid = await argon2.verify(user.passwordHash, currentPassword, ARGON2_OPTIONS);
				if (!valid) {
					return reply.status(401).send({ error: "Current password is incorrect", code: "INVALID_PASSWORD" });
				}

				if (emailChanged) {
					const [existingEmail] = await db
						.select({ id: users.id })
						.from(users)
						.where(sql`lower(${users.email}) = lower(${email})`);
					if (existingEmail && existingEmail.id !== user.id) {
						return reply.status(409).send({ error: "Email already in use", code: "EMAIL_EXISTS" });
					}
					updates.email = email;
				}

				if (newPassword) {
					updates.passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
					updates.credentialVersion = (user.credentialVersion ?? 0) + 1;
				}
			}

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

				await db.update(users).set(updates).where(eq(users.id, user.id));
				await db
					.update(refreshTokens)
					.set({ revoked: true, rotatedAt: new Date() })
					.where(eq(refreshTokens.userId, user.id));
				await db.insert(refreshTokens).values({
					userId: user.id,
					tokenId: newTokenId,
					expiresAt: refreshExp,
				});

				return reply
					.setCookie("access_token", newAccessToken, app.config.cookieOptions)
					.setCookie("refresh_token", newRefreshToken, app.config.refreshCookieOptions)
					.send({ ok: true, message: "Profile updated" });
			}

			await db.update(users).set(updates).where(eq(users.id, user.id));

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
			schema: {
				tags: ["auth"],
				summary: "Upload user avatar",
				description: "Uploads and optimizes a profile image using multipart/form-data.",
				security: authEndpointSecurity,
				consumes: ["multipart/form-data"],
				response: {
					200: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							avatarUrl: { type: "string" },
						},
					},
					400: authErrorSchema,
					401: authErrorSchema,
				},
			},
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

			// Delete old avatar if exists
			const [user] = await db.select().from(users).where(eq(users.id, authUser.id));
			if (user?.avatarUrl) {
				removeImageFiles(IMAGES_DIR, user.avatarUrl);
			}

			// Update user
			await db.update(users).set({ avatarUrl: filename, updatedAt: new Date() }).where(eq(users.id, authUser.id));

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
			schema: {
				tags: ["auth"],
				summary: "Delete user avatar",
				security: authEndpointSecurity,
				response: {
					200: { type: "object", properties: { ok: { type: "boolean" } } },
					401: authErrorSchema,
					404: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			const [user] = await db.select().from(users).where(eq(users.id, authUser.id));
			if (!user?.avatarUrl) {
				return reply.status(404).send({ error: "No avatar to delete" });
			}

			// Delete file
			removeImageFiles(IMAGES_DIR, user.avatarUrl);

			// Update user
			await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, authUser.id));

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
			schema: {
				tags: ["auth"],
				summary: "Delete current user account",
				description: "Deletes the current account and related data (cascade delete).",
				security: authEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							message: { type: "string" },
						},
					},
					401: authErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "Not authenticated" });
			}

			// Delete avatar file if exists
			const [user] = await db.select().from(users).where(eq(users.id, authUser.id));
			if (user?.avatarUrl) {
				removeImageFiles(IMAGES_DIR, user.avatarUrl);
			}

			// Delete user - cascade delete handles all related data
			await db.delete(users).where(eq(users.id, authUser.id));

			app.log.info(`[Auth] Account deleted: username=${authUser.username}, userId=${authUser.id}`);

			// Clear auth cookies
			return reply
				.clearCookie("access_token", app.config.cookieOptions)
				.clearCookie("refresh_token", app.config.refreshCookieOptions)
				.send({ ok: true, message: "Account deleted" });
		}
	);
}
