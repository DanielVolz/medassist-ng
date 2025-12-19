import { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { db } from "../db/client.js";
import { users, refreshTokens } from "../db/schema.js";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

const loginBody = z.object({ email: z.string().email(), password: z.string().min(6) });

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { csrf: true } }, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid credentials");
    }
    const { email, password } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) return reply.unauthorized();
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return reply.unauthorized();

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: `${app.config.accessTtl}m` });
    const tokenId = randomUUID();
    const refreshExp = Math.floor(Date.now() / 1000) + app.config.refreshTtl * 24 * 60 * 60;
    await db.insert(refreshTokens).values({ userId: user.id, tokenId, expiresAt: new Date(refreshExp * 1000) });
    const refreshToken = app.jwt.sign({ sub: user.id, jti: tokenId }, { expiresIn: `${app.config.refreshTtl}d`, key: app.config.refreshSecret });

    reply
      .setCookie("access_token", accessToken, app.config.cookieOptions)
      .setCookie("refresh_token", refreshToken, app.config.refreshCookieOptions)
      .send({ ok: true });
  });

  app.post("/auth/logout", async (req, reply) => {
    reply
      .clearCookie("access_token", app.config.cookieOptions)
      .clearCookie("refresh_token", app.config.refreshCookieOptions)
      .send({ ok: true });
  });
}
