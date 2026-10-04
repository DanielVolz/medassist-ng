import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { getAuthState } from "../plugins/auth.js";
import { authenticateLocalCredentials, registerLocalAccount } from "../services/auth-account-service.js";
import { requestLocalPasswordReset, resetLocalPassword } from "../services/auth-recovery-service.js";
import { performDummyCredentialWork } from "../services/auth-service.js";
import { issueLoginSession } from "../services/auth-session-service.js";
import { sensitiveRateLimitConfig } from "./auth-rate-limit-config.js";
import {
	authErrorSchema,
	forgotPasswordSchema,
	loginRouteSchema,
	loginSchema,
	registerRouteSchema,
	registerSchema,
	resetPasswordSchema,
} from "./auth-schemas.js";

const forgotPasswordRateLimitConfig = {
	max: 3,
	timeWindow: "15 minutes",
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many attempts. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
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

export function authPublicRoutes(app: FastifyInstance) {
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
			schema: registerRouteSchema,
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

			const result = await registerLocalAccount(parsed.data);
			if (!result.ok) {
				return reply.status(409).send({ error: result.error, code: result.code });
			}
			const newUser = result.user;

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
			schema: loginRouteSchema,
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

			const result = await authenticateLocalCredentials(username, password);
			if (!result.ok) {
				app.log.warn(
					{ reason: result.reason, username, userId: result.userId },
					"[Auth] Login rejected with invalid credentials response"
				);
				return reply.status(401).send(invalidCredentialsResponse);
			}
			const user = result.user;
			const { accessToken, refreshToken } = await issueLoginSession(app, user);

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

			const deliveryFailure = await requestLocalPasswordReset(parsed.data.emailOrUsername);
			if (deliveryFailure) {
				request.log.error(deliveryFailure, "[Auth] Password reset email delivery failed");
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

			const consumed = await resetLocalPassword(parsed.data.token, parsed.data.newPassword);
			if (!consumed) {
				return reply.status(400).send({ error: "Invalid or expired reset link", code: "INVALID_RESET_TOKEN" });
			}

			return { ok: true };
		}
	);
}
