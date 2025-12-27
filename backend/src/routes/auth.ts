import { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { db } from "../db/client.js";
import { users, refreshTokens } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { env } from "../plugins/env.js";
import { getAuthState, requireAuth } from "../plugins/auth.js";
import type { AuthUser } from "../types/fastify.js";

// =============================================================================
// Argon2id Configuration - State of the Art Password Hashing
// =============================================================================
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,       // Argon2id - best for password hashing
  memoryCost: 65536,           // 64 MB memory
  timeCost: 3,                 // 3 iterations
  parallelism: 4,              // 4 parallel threads
  hashLength: 32,              // 256-bit hash
};

// =============================================================================
// Validation Schemas
// =============================================================================
const registerSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

const updateProfileSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .optional(),
});

// =============================================================================
// Auth Routes
// =============================================================================
export async function authRoutes(app: FastifyInstance) {
  // Token TTLs
  const accessTtlMinutes = 15;
  const refreshTtlDays = 14;

  // ---------------------------------------------------------------------------
  // GET /auth/state - Public auth state (needed before login)
  // ---------------------------------------------------------------------------
  app.get("/auth/state", async () => {
    return getAuthState();
  });

  // ---------------------------------------------------------------------------
  // POST /auth/register - User registration
  // ---------------------------------------------------------------------------
  app.post<{ Body: z.infer<typeof registerSchema> }>("/auth/register", async (request, reply) => {
    // Check auth state
    const state = await getAuthState();
    
    if (!state.authEnabled) {
      return reply.status(400).send({ error: "Authentication is disabled", code: "AUTH_DISABLED" });
    }
    
    if (!state.registrationEnabled) {
      return reply.status(400).send({ error: "Registration is disabled", code: "REGISTRATION_DISABLED" });
    }
    
    if (!state.localAuthEnabled) {
      return reply.status(400).send({ error: "Local authentication is disabled", code: "LOCAL_AUTH_DISABLED" });
    }

    // Validate input
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ 
        error: parsed.error.errors[0]?.message ?? "Invalid input",
        code: "VALIDATION_ERROR" 
      });
    }

    const { username, password } = parsed.data;

    // Check if username already exists
    const [existingUser] = await db.select().from(users).where(eq(users.username, username));
    if (existingUser) {
      return reply.status(409).send({ error: "Username already taken", code: "USERNAME_EXISTS" });
    }

    // Hash password with Argon2id
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    // Create user
    const [newUser] = await db.insert(users).values({
      username,
      passwordHash,
      authProvider: "local",
    }).returning();

    app.log.info(`User registered: ${username}`);

    return reply.status(201).send({
      ok: true,
      user: {
        id: newUser.id,
        username: newUser.username,
      },
      message: "Account created",
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/login - User login
  // ---------------------------------------------------------------------------
  app.post<{ Body: z.infer<typeof loginSchema> }>("/auth/login", async (request, reply) => {
    const state = await getAuthState();
    
    if (!state.authEnabled) {
      return reply.status(400).send({ error: "Authentication is disabled", code: "AUTH_DISABLED" });
    }
    
    if (!state.localAuthEnabled) {
      return reply.status(400).send({ error: "Local authentication is disabled", code: "LOCAL_AUTH_DISABLED" });
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ 
        error: "Invalid credentials",
        code: "VALIDATION_ERROR" 
      });
    }

    const { username, password, rememberMe } = parsed.data;

    // Find user by username
    const [user] = await db.select().from(users).where(eq(users.username, username));
    
    // Generic error to prevent user enumeration
    const invalidCredentialsError = () => 
      reply.status(401).send({ error: "Invalid username or password", code: "INVALID_CREDENTIALS" });

    if (!user) {
      // Perform dummy hash to prevent timing attacks
      await argon2.hash("dummy", ARGON2_OPTIONS);
      return invalidCredentialsError();
    }

    if (!user.isActive) {
      return reply.status(401).send({ error: "Account disabled", code: "ACCOUNT_DISABLED" });
    }

    if (!user.passwordHash) {
      // SSO-only user trying local login
      return reply.status(401).send({ error: "Please use SSO to login", code: "SSO_ONLY" });
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, password, ARGON2_OPTIONS);
    if (!valid) {
      return invalidCredentialsError();
    }

    // Update last login
    await db.update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Generate tokens
    const accessToken = app.jwt.sign(
      { sub: user.id, username: user.username },
      { expiresIn: `${accessTtlMinutes}m` }
    );

    const tokenId = randomBytes(32).toString("hex");
    const refreshExp = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);
    
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenId,
      expiresAt: refreshExp,
    });

    const refreshToken = app.jwt.sign(
      { sub: user.id, jti: tokenId },
      { expiresIn: `${refreshTtlDays}d`, key: app.config.refreshSecret }
    );

    app.log.info(`User logged in: ${username} (rememberMe: ${rememberMe})`);

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
        },
      });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/refresh - Refresh access token
  // ---------------------------------------------------------------------------
  app.post("/auth/refresh", async (request, reply) => {
    const refreshTokenCookie = request.cookies.refresh_token;
    if (!refreshTokenCookie) {
      return reply.status(401).send({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
    }

    try {
      // Verify refresh token
      const decoded = app.jwt.verify<{ sub: number; jti: string }>(
        refreshTokenCookie,
        { key: app.config.refreshSecret }
      );

      // Check if token exists and is valid
      const [token] = await db.select().from(refreshTokens)
        .where(eq(refreshTokens.tokenId, decoded.jti));

      if (!token || token.revoked || token.expiresAt < new Date()) {
        return reply.status(401).send({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
      }

      // Get user
      const [user] = await db.select().from(users).where(eq(users.id, decoded.sub));
      if (!user || !user.isActive) {
        return reply.status(401).send({ error: "User not found or disabled", code: "USER_INVALID" });
      }

      // Rotate refresh token (revoke old, create new)
      await db.update(refreshTokens)
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
      const newAccessToken = app.jwt.sign(
        { sub: user.id, username: user.username },
        { expiresIn: `${accessTtlMinutes}m` }
      );

      const newRefreshToken = app.jwt.sign(
        { sub: user.id, jti: newTokenId },
        { expiresIn: `${refreshTtlDays}d`, key: app.config.refreshSecret }
      );

      return reply
        .setCookie("access_token", newAccessToken, app.config.cookieOptions)
        .setCookie("refresh_token", newRefreshToken, app.config.refreshCookieOptions)
        .send({ ok: true });

    } catch {
      return reply.status(401).send({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/logout - Logout (revoke refresh token)
  // ---------------------------------------------------------------------------
  app.post("/auth/logout", async (request, reply) => {
    const refreshTokenCookie = request.cookies.refresh_token;
    
    if (refreshTokenCookie) {
      try {
        const decoded = app.jwt.verify<{ jti: string }>(
          refreshTokenCookie,
          { key: app.config.refreshSecret }
        );
        
        // Revoke the refresh token
        await db.update(refreshTokens)
          .set({ revoked: true })
          .where(eq(refreshTokens.tokenId, decoded.jti));
      } catch {
        // Invalid token, ignore
      }
    }

    return reply
      .clearCookie("access_token", app.config.cookieOptions)
      .clearCookie("refresh_token", app.config.refreshCookieOptions)
      .send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // GET /auth/me - Get current user profile
  // ---------------------------------------------------------------------------
  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user as unknown as AuthUser | null;
    if (!authUser) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, authUser.id));
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return {
      id: user.id,
      username: user.username,
      authProvider: user.authProvider,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  });

  // ---------------------------------------------------------------------------
  // PUT /auth/me - Update current user profile
  // ---------------------------------------------------------------------------
  app.put<{ Body: z.infer<typeof updateProfileSchema> }>("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user as unknown as AuthUser | null;
    if (!authUser) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ 
        error: parsed.error.errors[0]?.message ?? "Invalid input",
        code: "VALIDATION_ERROR" 
      });
    }

    const { currentPassword, newPassword } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.id, authUser.id));

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const updates: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Update password if provided
    if (newPassword) {
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

      updates.passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));

    return { ok: true, message: "Profile updated" };
  });
}
