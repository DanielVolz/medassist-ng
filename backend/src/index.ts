import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import cookie, { CookieSerializeOptions } from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { env } from "./plugins/env.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { medicationRoutes } from "./routes/medications.js";
import { settingsRoutes } from "./routes/settings.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
});

const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

const accessTtlMinutes = parseInt(env.ACCESS_TOKEN_TTL_MIN, 10);
const refreshTtlDays = parseInt(env.REFRESH_TOKEN_TTL_DAYS, 10);

const baseCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
  maxAge: accessTtlMinutes * 60,
};

const refreshCookieOptions: CookieSerializeOptions = {
  ...baseCookieOptions,
  maxAge: refreshTtlDays * 24 * 60 * 60,
};

app.decorate("config", {
  accessSecret: env.JWT_SECRET,
  refreshSecret: env.REFRESH_SECRET,
  accessTtl: accessTtlMinutes,
  refreshTtl: refreshTtlDays,
  cookieOptions: baseCookieOptions,
  refreshCookieOptions,
});

await app.register(sensible);
await app.register(helmet);
await app.register(cors, { origin: origins, credentials: true });
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});
await app.register(cookie, { secret: env.COOKIE_SECRET });
await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: "access_token", signed: false } });

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(medicationRoutes);
await app.register(settingsRoutes);

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
