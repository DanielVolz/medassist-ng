import Fastify, { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { resolve } from "path";
import { existsSync } from "fs";
import { env } from "./plugins/env.js";
import { migrationsReady } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { oidcRoutes } from "./routes/oidc.js";
import { medicationRoutes } from "./routes/medications.js";
import { settingsRoutes } from "./routes/settings.js";
import { plannerRoutes } from "./routes/planner.js";
import { shareRoutes } from "./routes/share.js";
import { doseRoutes } from "./routes/doses.js";
import { startReminderScheduler } from "./services/reminder-scheduler.js";
import { startIntakeReminderScheduler } from "./services/intake-reminder-scheduler.js";

// Re-export utilities from server-config for external use
export {
  parseCorsOrigins,
  buildBaseCookieOptions,
  buildRefreshCookieOptions,
  buildAppConfig,
  ensureImagesDirectory,
  getJwtConfig,
} from "./utils/server-config.js";

import {
  parseCorsOrigins,
  buildBaseCookieOptions,
  buildRefreshCookieOptions,
  buildAppConfig,
  ensureImagesDirectory,
  getJwtConfig,
} from "./utils/server-config.js";

/** Create and configure Fastify app (without starting) */
export async function createApp(options?: {
  logLevel?: string;
  corsOrigins?: string[];
  authEnabled?: boolean;
  jwtSecret?: string;
  refreshSecret?: string;
  cookieSecret?: string;
  accessTtlMinutes?: number;
  refreshTtlDays?: number;
  isProduction?: boolean;
  imagesDir?: string;
}): Promise<FastifyInstance> {
  const opts = {
    logLevel: options?.logLevel ?? "info",
    corsOrigins: options?.corsOrigins ?? ["http://localhost:5173"],
    authEnabled: options?.authEnabled ?? false,
    jwtSecret: options?.jwtSecret,
    refreshSecret: options?.refreshSecret,
    cookieSecret: options?.cookieSecret ?? "dev-cookie-secret",
    accessTtlMinutes: options?.accessTtlMinutes ?? 15,
    refreshTtlDays: options?.refreshTtlDays ?? 7,
    isProduction: options?.isProduction ?? false,
    imagesDir: options?.imagesDir ?? resolve(process.cwd(), "data/images"),
  };

  const app = Fastify({
    logger: { level: opts.logLevel },
  });

  // Build config
  const appConfig = buildAppConfig({
    jwtSecret: opts.jwtSecret,
    refreshSecret: opts.refreshSecret,
    accessTtlMinutes: opts.accessTtlMinutes,
    refreshTtlDays: opts.refreshTtlDays,
    isProduction: opts.isProduction,
  });

  app.decorate("config", appConfig);

  // Register plugins
  await app.register(sensible);
  await app.register(helmet);
  await app.register(cors, { origin: opts.corsOrigins, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(cookie, { secret: opts.cookieSecret });

  // JWT plugin
  const jwtConfig = getJwtConfig(opts.authEnabled, opts.jwtSecret);
  await app.register(jwt, jwtConfig);

  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  
  // Only register static if directory exists
  if (existsSync(opts.imagesDir)) {
    await app.register(fastifyStatic, {
      root: opts.imagesDir,
      prefix: "/images/",
      decorateReply: false,
    });
  }

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(oidcRoutes);
  await app.register(medicationRoutes);
  await app.register(settingsRoutes);
  await app.register(plannerRoutes);
  await app.register(shareRoutes);
  await app.register(doseRoutes);

  return app;
}

// =============================================================================
// Server initialization (runs on import)
// =============================================================================

// Wait for database migrations before anything else
await migrationsReady;
console.log("[DB] Migrations complete, starting server...");

// Ensure images directory exists
const imagesDir = ensureImagesDirectory();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
});

const origins = parseCorsOrigins(env.CORS_ORIGINS);

// Auth token TTLs (hardcoded - no need for user configuration)
const accessTtlMinutes = env.ACCESS_TOKEN_TTL_MINUTES;  // Access token TTL
const refreshTtlDays = env.REFRESH_TOKEN_TTL_DAYS;      // Refresh token TTL

const baseCookieOptions = buildBaseCookieOptions(accessTtlMinutes, env.NODE_ENV === "production");
const refreshCookieOptions = buildRefreshCookieOptions(baseCookieOptions, refreshTtlDays);

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
const jwtConfig = getJwtConfig(env.AUTH_ENABLED, env.JWT_SECRET);
await app.register(jwt, jwtConfig);

await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
await app.register(fastifyStatic, {
  root: imagesDir,
  prefix: "/images/",
  decorateReply: false,
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(oidcRoutes);
await app.register(medicationRoutes);
await app.register(settingsRoutes);
await app.register(plannerRoutes);
await app.register(shareRoutes);
await app.register(doseRoutes);

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
