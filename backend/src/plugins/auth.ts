import { pbkdf2Sync } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import { apiKeys, users } from "../db/schema.js";
import { env } from "./env.js";

// =============================================================================
// Anonymous User - Used when AUTH_ENABLED=false
// Uses a fixed high ID (999999999) to never collide with regular users
// =============================================================================
const ANONYMOUS_USER_ID = 999999999;
const ANONYMOUS_USERNAME = "__anonymous__";
let anonymousUserVerified = false;

/**
 * Get or create the anonymous user for no-auth mode.
 * Uses a fixed ID (999999999) that will never collide with auto-increment IDs.
 */
export async function getAnonymousUserId(): Promise<number> {
	// Return cached if already verified
	if (anonymousUserVerified) {
		return ANONYMOUS_USER_ID;
	}

	// Check if anonymous user exists
	const [existing] = await db.select().from(users).where(eq(users.id, ANONYMOUS_USER_ID));

	if (existing) {
		anonymousUserVerified = true;
		return ANONYMOUS_USER_ID;
	}

	// Create anonymous user with fixed ID (SQLite allows explicit ID)
	await db.run(sql`
    INSERT INTO users (id, username, password_hash, auth_provider, is_active, created_at, updated_at)
    VALUES (${ANONYMOUS_USER_ID}, ${ANONYMOUS_USERNAME}, NULL, 'anonymous', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

	anonymousUserVerified = true;

	return ANONYMOUS_USER_ID;
}

// =============================================================================
// Auth State - Computed at runtime
// =============================================================================
export interface AuthState {
	authEnabled: boolean;
	registrationEnabled: boolean;
	formLoginEnabled: boolean;
	oidcEnabled: boolean;
	oidcProviderName: string;
	hasUsers: boolean;
	needsSetup: boolean;
}

export async function getAuthState(): Promise<AuthState> {
	// Count only real users (not the anonymous user with fixed ID)
	const [result] = await db.select({ count: count() }).from(users).where(sql`${users.id} != ${ANONYMOUS_USER_ID}`);
	const hasUsers = result.count > 0;

	const needsSetup = env.AUTH_ENABLED && !hasUsers;

	return {
		authEnabled: env.AUTH_ENABLED,
		// Registration: enabled via ENV OR no users exist (first-time setup)
		registrationEnabled: env.REGISTRATION_ENABLED || !hasUsers,
		// Form login: enabled when auth + form login are both on, or forced on for first-user setup
		formLoginEnabled: needsSetup || (env.AUTH_ENABLED && env.FORM_LOGIN_ENABLED),
		oidcEnabled: env.OIDC_ENABLED,
		oidcProviderName: env.OIDC_PROVIDER_NAME,
		hasUsers,
		needsSetup,
	};
}

// =============================================================================
// Request User Type (no roles - all users are equal)
// =============================================================================
export interface RequestUser {
	id: number;
	username: string;
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isMutationMethod(method: string): boolean {
	return !READ_ONLY_METHODS.has(method.toUpperCase());
}

function getApiKeyPepper(): string {
	return env.JWT_SECRET || env.REFRESH_SECRET || "medassist-api-key-pepper";
}

export function hashApiKeyToken(token: string): string {
	return pbkdf2Sync(token, getApiKeyPepper(), 120_000, 64, "sha512").toString("hex");
}

function getBearerToken(request: FastifyRequest): string | null {
	const authHeader = request.headers.authorization;
	if (!authHeader) return null;

	const [scheme, value] = authHeader.split(" ");
	if (!scheme || !value) return null;
	if (scheme.toLowerCase() !== "bearer") return null;

	const token = value.trim();
	return token.length > 0 ? token : null;
}

async function tryApiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
	const bearerToken = getBearerToken(request);
	if (!bearerToken) return false;

	if (!bearerToken.startsWith("ma_")) {
		reply.status(401).send({ error: "Invalid API key", code: "INVALID_API_KEY" });
		throw new Error("INVALID_API_KEY");
	}

	const keyHash = hashApiKeyToken(bearerToken);
	const [keyRow] = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));

	if (!keyRow) {
		reply.status(401).send({ error: "Invalid API key", code: "INVALID_API_KEY" });
		throw new Error("INVALID_API_KEY");
	}

	if (keyRow.expiresAt && keyRow.expiresAt.getTime() <= Date.now()) {
		reply.status(401).send({ error: "API key expired", code: "API_KEY_EXPIRED" });
		throw new Error("API_KEY_EXPIRED");
	}

	const [user] = await db.select().from(users).where(eq(users.id, keyRow.userId));
	if (!user || !user.isActive) {
		reply.status(401).send({ error: "User not found", code: "USER_NOT_FOUND" });
		throw new Error("USER_NOT_FOUND");
	}

	const scope = keyRow.scope === "read" ? "read" : "write";
	if (scope === "read" && isMutationMethod(request.method)) {
		reply.status(403).send({ error: "API key scope does not allow this operation", code: "API_KEY_SCOPE_FORBIDDEN" });
		throw new Error("API_KEY_SCOPE_FORBIDDEN");
	}

	request.user = { id: user.id, username: user.username };
	request.authContext = {
		method: "api_key",
		scope,
		apiKeyId: keyRow.id,
	};

	await db
		.update(apiKeys)
		.set({ lastUsedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(apiKeys.id, keyRow.id), eq(apiKeys.userId, user.id)));

	return true;
}

// =============================================================================
// Auth Middleware Functions
// =============================================================================

/**
 * Optional auth - verifies JWT if present, but doesn't require it
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
	if (!env.AUTH_ENABLED) {
		return;
	}

	const bearerToken = getBearerToken(request);
	if (bearerToken?.startsWith("ma_")) {
		const keyHash = hashApiKeyToken(bearerToken);
		const [keyRow] = await db
			.select()
			.from(apiKeys)
			.where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
		if (!keyRow) return;
		if (keyRow.expiresAt && keyRow.expiresAt.getTime() <= Date.now()) return;

		const [userByKey] = await db.select().from(users).where(eq(users.id, keyRow.userId));
		if (userByKey?.isActive) {
			request.user = { id: userByKey.id, username: userByKey.username };
			request.authContext = {
				method: "api_key",
				scope: keyRow.scope === "read" ? "read" : "write",
				apiKeyId: keyRow.id,
			};
		}
		return;
	}

	const token = request.cookies.access_token;
	if (!token) {
		return;
	}

	try {
		const decoded = await request.jwtVerify<{ sub: number; username: string }>();
		const [user] = await db.select().from(users).where(sql`${users.id} = ${decoded.sub}`);
		if (user?.isActive) {
			request.user = {
				id: user.id,
				username: user.username,
			};
			request.authContext = {
				method: "session",
				scope: "write",
			};
		}
	} catch {
		// Invalid token, continue as anonymous
	}
}

/**
 * Required auth - requires valid JWT when auth is enabled
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
	if (!env.AUTH_ENABLED) {
		return;
	}

	if (await tryApiKeyAuth(request, reply)) {
		return;
	}

	const token = request.cookies.access_token;
	if (!token) {
		reply.status(401).send({ error: "Authentication required", code: "AUTH_REQUIRED" });
		throw new Error("AUTH_REQUIRED");
	}

	try {
		const decoded = await request.jwtVerify<{ sub: number; username: string }>();
		const [user] = await db.select().from(users).where(sql`${users.id} = ${decoded.sub}`);

		if (!user) {
			reply.status(401).send({ error: "User not found", code: "USER_NOT_FOUND" });
			throw new Error("USER_NOT_FOUND");
		}

		if (!user.isActive) {
			reply.status(401).send({ error: "Account disabled", code: "ACCOUNT_DISABLED" });
			throw new Error("ACCOUNT_DISABLED");
		}

		request.user = {
			id: user.id,
			username: user.username,
		};
		request.authContext = {
			method: "session",
			scope: "write",
		};
	} catch (err: unknown) {
		// Re-throw our own errors
		if (
			err instanceof Error &&
			(err.message === "AUTH_REQUIRED" ||
				err.message === "USER_NOT_FOUND" ||
				err.message === "ACCOUNT_DISABLED" ||
				err.message === "INVALID_API_KEY" ||
				err.message === "API_KEY_EXPIRED" ||
				err.message === "API_KEY_SCOPE_FORBIDDEN")
		) {
			throw err;
		}
		// JWT verification failed
		reply.status(401).send({ error: "Invalid or expired token", code: "INVALID_TOKEN" });
		throw new Error("INVALID_TOKEN");
	}
}

/**
 * Auth state endpoint plugin
 */
export async function authPlugin(app: FastifyInstance) {
	app.get("/auth/state", async () => {
		return getAuthState();
	});
}
