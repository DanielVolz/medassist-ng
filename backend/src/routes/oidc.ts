import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "openid-client";
import { db } from "../db/client.js";
import { refreshTokens, users } from "../db/schema.js";
import { env } from "../plugins/env.js";

// =============================================================================
// OIDC Configuration Cache
// =============================================================================
let oidcConfig: client.Configuration | null = null;

async function getOIDCConfig(): Promise<client.Configuration> {
	if (oidcConfig) return oidcConfig;

	if (!env.OIDC_ISSUER_URL || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
		throw new Error("OIDC not configured");
	}

	oidcConfig = await client.discovery(new URL(env.OIDC_ISSUER_URL), env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET);

	return oidcConfig;
}

// =============================================================================
// PKCE Helpers
// =============================================================================
function generateCodeVerifier(): string {
	return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
	return randomBytes(16).toString("hex");
}

// =============================================================================
// Helpers
// =============================================================================
function getFrontendUrl(): string {
	return env.CORS_ORIGINS.split(",")[0] || "http://localhost:5173";
}

// =============================================================================
// OIDC Routes
// =============================================================================
export async function oidcRoutes(app: FastifyInstance) {
	if (!env.OIDC_ENABLED) {
		// Register a disabled route that returns an error
		app.get("/auth/oidc/login", async (_request, reply) => {
			return reply.status(400).send({ error: "OIDC authentication is not enabled" });
		});
		app.get("/auth/oidc/callback", async (_request, reply) => {
			return reply.status(400).send({ error: "OIDC authentication is not enabled" });
		});
		return;
	}

	// ---------------------------------------------------------------------------
	// GET /auth/oidc/login - Initiates OIDC flow
	// ---------------------------------------------------------------------------
	app.get("/auth/oidc/login", async (_request, reply) => {
		try {
			const config = await getOIDCConfig();

			// Generate PKCE values
			const codeVerifier = generateCodeVerifier();
			const codeChallenge = generateCodeChallenge(codeVerifier);
			const state = generateState();

			// Store PKCE verifier and state in signed cookies (short-lived)
			reply.setCookie("oidc_code_verifier", codeVerifier, {
				httpOnly: true,
				secure: env.NODE_ENV === "production",
				sameSite: "lax",
				path: "/",
				maxAge: 600, // 10 minutes
				signed: true,
			});

			reply.setCookie("oidc_state", state, {
				httpOnly: true,
				secure: env.NODE_ENV === "production",
				sameSite: "lax",
				path: "/",
				maxAge: 600,
				signed: true,
			});

			// Build authorization URL
			const redirectUri = env.OIDC_REDIRECT_URI!;
			const scope = env.OIDC_SCOPES;

			const authUrl = client.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				scope,
				state,
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
			});

			return reply.redirect(authUrl.href);
		} catch (err: any) {
			console.error("[OIDC] Login error:", err);
			return reply.redirect(`${getFrontendUrl()}/?error=oidc_init_failed`);
		}
	});

	// ---------------------------------------------------------------------------
	// GET /auth/oidc/callback - Handles callback from OIDC provider
	// ---------------------------------------------------------------------------
	app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
		"/auth/oidc/callback",
		async (request, reply) => {
			const { code, state, error, error_description } = request.query;

			// Handle OIDC provider errors
			if (error) {
				console.error(`[OIDC] Provider error: ${error} - ${error_description}`);
				return reply.redirect(`${getFrontendUrl()}/?error=oidc_${error}`);
			}

			if (!code || !state) {
				return reply.redirect(`${getFrontendUrl()}/?error=oidc_missing_params`);
			}

			// Verify state
			const storedState = request.unsignCookie(request.cookies.oidc_state || "");
			if (!storedState.valid || storedState.value !== state) {
				console.error("[OIDC] State mismatch");
				return reply.redirect(`${getFrontendUrl()}/?error=oidc_state_mismatch`);
			}

			// Get code verifier
			const storedVerifier = request.unsignCookie(request.cookies.oidc_code_verifier || "");
			if (!storedVerifier.valid || !storedVerifier.value) {
				console.error("[OIDC] Missing code verifier");
				return reply.redirect(`${getFrontendUrl()}/?error=oidc_missing_verifier`);
			}

			try {
				const config = await getOIDCConfig();
				const _redirectUri = env.OIDC_REDIRECT_URI!;

				// Exchange code for tokens
				const tokens = await client.authorizationCodeGrant(
					config,
					new URL(request.url, `http://${request.headers.host}`),
					{
						pkceCodeVerifier: storedVerifier.value,
						expectedState: state,
					}
				);

				// Get user info
				const sub = tokens.claims()?.sub;
				if (!sub) {
					console.error("[OIDC] Missing sub claim in token");
					return reply.redirect(`${getFrontendUrl()}/?error=oidc_missing_sub`);
				}
				const userInfo = await client.fetchUserInfo(config, tokens.access_token, sub);

				// Extract username from configured claim
				const usernameClaim = env.OIDC_USERNAME_CLAIM;
				const username =
					(userInfo as any)[usernameClaim] || userInfo.preferred_username || userInfo.email || userInfo.sub;
				const oidcSubject = userInfo.sub;

				if (!username || !oidcSubject) {
					console.error("[OIDC] Missing required user info:", { username, oidcSubject });
					return reply.redirect(`${getFrontendUrl()}/?error=oidc_missing_user_info`);
				}

				// Clean cookies
				reply.clearCookie("oidc_code_verifier", { path: "/" });
				reply.clearCookie("oidc_state", { path: "/" });

				// Find or create user
				const user = await findOrCreateOIDCUser(username, oidcSubject, reply);

				if (!user) {
					return reply.redirect(`${getFrontendUrl()}/?error=oidc_user_creation_failed`);
				}

				// Update last login
				await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

				// Issue JWT tokens (same as local auth)
				const accessToken = await generateAccessToken(app, user.id, user.username);
				const { refreshToken, tokenId, expiresAt } = await generateRefreshToken(app, user.id);

				// Store refresh token
				await db.insert(refreshTokens).values({
					userId: user.id,
					tokenId,
					expiresAt,
				});

				// Set cookies (use app's centralized cookie options)
				request.log.debug(
					`[OIDC] Setting cookies for user ${user.username}, NODE_ENV=${env.NODE_ENV}, secure=${app.config.cookieOptions.secure}`
				);
				setAuthCookies(app, reply, accessToken, refreshToken);

				// Redirect to frontend dashboard
				// In dev: CORS_ORIGINS contains the frontend URL
				const frontendUrl = env.CORS_ORIGINS.split(",")[0] || "http://localhost:5173";
				return reply.redirect(`${frontendUrl}/dashboard`);
			} catch (err: any) {
				console.error("[OIDC] Callback error:", err);
				return reply.redirect(`${getFrontendUrl()}/?error=oidc_callback_failed`);
			}
		}
	);
}

// =============================================================================
// User Management
// =============================================================================
async function findOrCreateOIDCUser(
	username: string,
	oidcSubject: string,
	_reply: FastifyReply
): Promise<{ id: number; username: string } | null> {
	// First, try to find user by OIDC subject (most reliable)
	const [existingBySubject] = await db.select().from(users).where(eq(users.oidcSubject, oidcSubject));

	if (existingBySubject) {
		return { id: existingBySubject.id, username: existingBySubject.username };
	}

	// Check if username already exists (potential collision)
	const [existingByUsername] = await db.select().from(users).where(eq(users.username, username));

	if (existingByUsername) {
		// Username collision! Check if it's a local user without OIDC linked
		if (existingByUsername.authProvider === "local" && !existingByUsername.oidcSubject) {
			// Local user exists without SSO - link this OIDC account to existing user
			await db.update(users).set({ oidcSubject: oidcSubject }).where(eq(users.id, existingByUsername.id));
			// Linked OIDC to existing local user
			return { id: existingByUsername.id, username: existingByUsername.username };
		} else if (existingByUsername.oidcSubject && existingByUsername.oidcSubject !== oidcSubject) {
			// User already has a DIFFERENT OIDC subject - create new user with suffix
			username = `${username}_sso`;
			// Username collision (different OIDC subject), use suffixed name
		}
	}

	// Check if auto-create is enabled
	if (!env.OIDC_AUTO_CREATE_USERS) {
		console.error(`[OIDC] User creation disabled and user not found: ${username}`);
		return null;
	}

	// Create new OIDC user
	const [newUser] = await db
		.insert(users)
		.values({
			username,
			passwordHash: null,
			authProvider: "oidc",
			oidcSubject: oidcSubject,
			isActive: true,
		})
		.returning({ id: users.id, username: users.username });

	// New OIDC user created
	return newUser;
}

// =============================================================================
// JWT Token Generation (reused from auth.ts logic)
// =============================================================================
async function generateAccessToken(app: FastifyInstance, userId: number, username: string): Promise<string> {
	return app.jwt.sign({ sub: userId, username }, { expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` });
}

async function generateRefreshToken(
	app: FastifyInstance,
	userId: number
): Promise<{ refreshToken: string; tokenId: string; expiresAt: Date }> {
	const tokenId = randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

	const refreshToken = app.jwt.sign(
		{ sub: userId, jti: tokenId, type: "refresh" },
		{ expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` }
	);

	return { refreshToken, tokenId, expiresAt };
}

function setAuthCookies(app: FastifyInstance, reply: FastifyReply, accessToken: string, refreshToken: string) {
	// Use the same cookie options as regular auth for consistency
	reply.setCookie("access_token", accessToken, app.config.cookieOptions);
	reply.setCookie("refresh_token", refreshToken, app.config.refreshCookieOptions);
}
