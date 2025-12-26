import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import cookie, { CookieSerializeOptions } from "@fastify/cookie";
import jwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { env } from "./plugins/env.js";
import { migrationsReady } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { medicationRoutes } from "./routes/medications.js";
import { settingsRoutes } from "./routes/settings.js";
import { plannerRoutes } from "./routes/planner.js";
import { startReminderScheduler } from "./services/reminder-scheduler.js";
import { startIntakeReminderScheduler } from "./services/intake-reminder-scheduler.js";

// Wait for database migrations before anything else
await migrationsReady;
console.log("[DB] Migrations complete, starting server...");

// Ensure images directory exists
const imagesDir = resolve(process.cwd(), "data/images");
if (!existsSync(imagesDir)) {
  mkdirSync(imagesDir, { recursive: true });
}

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
});

const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

// Auth token TTLs (hardcoded - no need for user configuration)
const accessTtlMinutes = 15;      // Access token: 15 minutes
const refreshTtlDays = 14;        // Refresh token: 14 days

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

// Config decorator - only include secrets if auth is enabled
app.decorate("config", {
  accessSecret: env.JWT_SECRET ?? "",
  refreshSecret: env.REFRESH_SECRET ?? "",
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
await app.register(cookie, { secret: env.COOKIE_SECRET ?? "dev-cookie-secret" });

// JWT plugin - only register with valid secret if auth is enabled
if (env.AUTH_ENABLED && env.JWT_SECRET) {
  await app.register(jwt, { 
    secret: env.JWT_SECRET, 
    cookie: { cookieName: "access_token", signed: false } 
  });
} else {
  // Dummy JWT for when auth is disabled - prevents errors
  await app.register(jwt, { 
    secret: "auth-disabled-no-secret-needed", 
    cookie: { cookieName: "access_token", signed: false } 
  });
}

await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
await app.register(fastifyStatic, {
  root: imagesDir,
  prefix: "/images/",
  decorateReply: false,
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(medicationRoutes);
await app.register(settingsRoutes);
await app.register(plannerRoutes);

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on ${env.PORT}`);
    
    // Start the automatic reminder scheduler
    startReminderScheduler({
      info: (msg) => app.log.info(msg),
      error: (msg) => app.log.error(msg),
    });
    
    // Start the intake reminder scheduler (checks every minute)
    startIntakeReminderScheduler({
      info: (msg) => app.log.info(msg),
      error: (msg) => app.log.error(msg),
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
