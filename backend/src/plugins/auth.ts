import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { env } from "./env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { sql, count, eq } from "drizzle-orm";

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
  console.log(`Created anonymous user with fixed ID ${ANONYMOUS_USER_ID} for no-auth mode`);
  
  return ANONYMOUS_USER_ID;
}

// =============================================================================
// Auth State - Computed at runtime
// =============================================================================
export interface AuthState {
  authEnabled: boolean;
  registrationEnabled: boolean;
  localAuthEnabled: boolean;
  hasUsers: boolean;
  needsSetup: boolean;
}

export async function getAuthState(): Promise<AuthState> {
  // Count only real users (not the anonymous user with fixed ID)
  const [result] = await db.select({ count: count() }).from(users).where(sql`${users.id} != ${ANONYMOUS_USER_ID}`);
  const hasUsers = result.count > 0;
  
  return {
    authEnabled: env.AUTH_ENABLED,
    // Registration: enabled via ENV OR no users exist (first-time setup)
    registrationEnabled: env.REGISTRATION_ENABLED || !hasUsers,
    localAuthEnabled: !env.DISABLE_LOCAL_AUTH,
    hasUsers,
    needsSetup: env.AUTH_ENABLED && !hasUsers,
  };
}

// =============================================================================
// Request User Type (no roles - all users are equal)
// =============================================================================
export interface RequestUser {
  id: number;
  username: string;
}

// =============================================================================
// Auth Middleware Functions
// =============================================================================

/**
 * Optional auth - verifies JWT if present, but doesn't require it
 */
export async function optionalAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const token = request.cookies.access_token;
  if (!token) {
    return;
  }

  try {
    const decoded = await request.jwtVerify<{ sub: number; username: string }>();
    const [user] = await db.select().from(users).where(sql`${users.id} = ${decoded.sub}`);
    if (user && user.isActive) {
      request.user = {
        id: user.id,
        username: user.username,
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
  } catch (err: any) {
    // Re-throw our own errors
    if (err?.message === "AUTH_REQUIRED" || err?.message === "USER_NOT_FOUND" || err?.message === "ACCOUNT_DISABLED") {
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
