import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { migrationsReady } from "./db/client.js";
import { getDataDir } from "./db/db-utils.js";
import { registerApiDocs } from "./plugins/api-docs.js";
import { env } from "./plugins/env.js";
import { jwtPlugin } from "./plugins/jwt.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { authRoutes } from "./routes/auth.js";
import { doseRoutes } from "./routes/doses.js";
import { exportRoutes } from "./routes/export.js";
import { healthRoutes } from "./routes/health.js";
import { intakeJournalRoutes } from "./routes/intake-journal.js";
import { medicationEnrichmentRoutes } from "./routes/medication-enrichment.js";
import { medicationRoutes } from "./routes/medications.js";
import { notificationActionRoutes } from "./routes/notification-actions.js";
import { oidcRoutes } from "./routes/oidc.js";
import { plannerRoutes } from "./routes/planner.js";
import { refillRoutes } from "./routes/refills.js";
import { reportRoutes } from "./routes/report.js";
import { settingsRoutes } from "./routes/settings.js";
import { shareRoutes } from "./routes/share.js";
import { startIntakeReminderScheduler } from "./services/intake-reminder-scheduler.js";
import { startMedicationEnrichmentCatalogRefresh } from "./services/medication-enrichment/index.js";
import { startReminderScheduler } from "./services/reminder-scheduler.js";
import { documentationSchemaAjv } from "./utils/documentation-schema-keywords.js";

// Re-export utilities from server-config for external use
export {
	buildAppConfig,
	buildBaseCookieOptions,
	buildRefreshCookieOptions,
	ensureImagesDirectory,
	getJwtConfig,
	parseCorsOrigins,
} from "./utils/server-config.js";

import {
	buildAppConfig,
	buildBaseCookieOptions,
	buildRefreshCookieOptions,
	ensureImagesDirectory,
	getJwtConfig,
	parseCorsOrigins,
} from "./utils/server-config.js";

function sanitizeCorrelationId(headers: IncomingHttpHeaders): string | null {
	const rawHeader = headers["x-correlation-id"];
	if (typeof rawHeader !== "string") return null;
	const trimmed = rawHeader.trim();
	if (!trimmed) return null;
	if (trimmed.length > 128) return null;
	if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
	return trimmed;
}

function buildLoggerOptions(level: string) {
	const runtimeEnv = process.env.NODE_ENV ?? "production";
	const base = {
		level,
		timestamp: () => `,"time":"${new Date().toISOString()}"`,
	};
	// Human-readable logs in development, structured JSON in production/test
	if (runtimeEnv === "development") {
		return {
			...base,
			transport: { target: "pino-pretty", options: { translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l" } },
		};
	}
	return base;
}

function buildHelmetOptions(_isProduction: boolean) {
	return {};
}

function isPublicNotificationActionPath(url: string | undefined): boolean {
	if (!url) {
		return false;
	}

	const normalizedUrl = url.split("?")[0]?.toLowerCase() ?? "";
	return /(^|\/)(api\/)?notification-actions(\/|$)/.test(normalizedUrl);
}

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
	openApiDocsEnabled?: boolean;
	docsAuthRequired?: boolean;
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
		imagesDir: options?.imagesDir ?? resolve(getDataDir(), "images"),
		openApiDocsEnabled: options?.openApiDocsEnabled ?? false,
		docsAuthRequired: options?.docsAuthRequired ?? options?.authEnabled ?? false,
	};

	const app = Fastify({
		logger: buildLoggerOptions(opts.logLevel),
		genReqId: (request) => sanitizeCorrelationId(request.headers) ?? randomUUID(),
		ajv: documentationSchemaAjv,
	});

	app.addHook("onRequest", (request, reply, done) => {
		request.correlationId = request.id;
		reply.header("x-correlation-id", request.id);

		done();
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
	await app.register(helmet, buildHelmetOptions(opts.isProduction));
	await app.register(cors, {
		hook: "preHandler",
		delegator: (request, callback) => {
			if (isPublicNotificationActionPath(request.raw.url)) {
				callback(null, {
					origin: true,
					credentials: false,
					methods: ["GET", "HEAD", "POST", "OPTIONS"],
					preflightContinue: true,
				});
				return;
			}

			callback(null, {
				origin: opts.corsOrigins,
				credentials: true,
			});
		},
	});
	await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
	await app.register(cookie, { secret: opts.cookieSecret });

	// JWT plugin
	const jwtConfig = getJwtConfig(opts.authEnabled, opts.jwtSecret);
	await app.register(jwtPlugin, jwtConfig);

	await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
	await registerApiDocs(app, {
		enabled: opts.openApiDocsEnabled,
		authRequired: opts.docsAuthRequired,
	});

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
	await app.register(apiKeyRoutes);
	await app.register(oidcRoutes);
	await app.register(medicationRoutes);
	await app.register(medicationEnrichmentRoutes);
	await app.register(settingsRoutes);
	await app.register(plannerRoutes);
	await app.register(notificationActionRoutes);
	await app.register(shareRoutes);
	await app.register(doseRoutes);
	await app.register(intakeJournalRoutes);
	await app.register(exportRoutes);
	await app.register(refillRoutes);
	await app.register(reportRoutes);

	return app;
}

// =============================================================================
// Server initialization (runs on import)
// =============================================================================

import { log } from "./utils/logger.js";

// Wait for database migrations before anything else
await migrationsReady;
log.info("[DB] Migrations complete, starting server...");

// Ensure images directory exists
const imagesDir = ensureImagesDirectory();

const app = Fastify({
	logger: buildLoggerOptions(env.LOG_LEVEL),
	genReqId: (request) => sanitizeCorrelationId(request.headers) ?? randomUUID(),
	ajv: documentationSchemaAjv,
});

app.addHook("onRequest", (request, reply, done) => {
	request.correlationId = request.id;
	reply.header("x-correlation-id", request.id);
	done();
});

const origins = parseCorsOrigins(env.CORS_ORIGINS);

// Auth token TTLs (hardcoded - no need for user configuration)
const accessTtlMinutes = env.ACCESS_TOKEN_TTL_MINUTES; // Access token TTL
const refreshTtlDays = env.REFRESH_TOKEN_TTL_DAYS; // Refresh token TTL

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
await app.register(helmet, buildHelmetOptions(env.NODE_ENV === "production"));
await app.register(cors, {
	hook: "preHandler",
	delegator: (request, callback) => {
		if (isPublicNotificationActionPath(request.raw.url)) {
			callback(null, {
				origin: true,
				credentials: false,
				methods: ["GET", "HEAD", "POST", "OPTIONS"],
				preflightContinue: true,
			});
			return;
		}

		callback(null, {
			origin: origins,
			credentials: true,
		});
	},
});
await app.register(rateLimit, {
	max: Number(process.env.RATE_LIMIT_MAX) || 100,
	timeWindow: "1 minute",
});
await app.register(cookie, { secret: env.COOKIE_SECRET ?? "dev-cookie-secret" });

// JWT plugin - only register with valid secret if auth is enabled
const jwtConfig = getJwtConfig(env.AUTH_ENABLED, env.JWT_SECRET);
await app.register(jwtPlugin, jwtConfig);

await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
await registerApiDocs(app, {
	enabled: env.OPENAPI_DOCS_ENABLED,
	authRequired: env.DOCS_AUTH_REQUIRED,
});
await app.register(fastifyStatic, {
	root: imagesDir,
	prefix: "/images/",
	decorateReply: false,
});
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(apiKeyRoutes);
await app.register(oidcRoutes);
await app.register(medicationRoutes);
await app.register(medicationEnrichmentRoutes);
await app.register(settingsRoutes);
await app.register(plannerRoutes);
await app.register(notificationActionRoutes);
await app.register(shareRoutes);
await app.register(doseRoutes);
await app.register(intakeJournalRoutes);
await app.register(exportRoutes);
await app.register(refillRoutes);
await app.register(reportRoutes);

const start = async () => {
	try {
		await app.listen({ port: env.PORT, host: "0.0.0.0" });
		app.log.info(`Server running on ${env.PORT}`);

		// Start the automatic reminder scheduler
		startReminderScheduler({
			info: (msg) => app.log.info(msg),
			debug: (msg) => app.log.debug(msg),
			warn: (msg) => app.log.warn(msg),
			error: (msg) => app.log.error(msg),
		});

		startMedicationEnrichmentCatalogRefresh({
			info: (msg: string) => app.log.info(msg),
			debug: (msg: string) => app.log.debug(msg),
			warn: (msg: string) => app.log.warn(msg),
			error: (msg: string) => app.log.error(msg),
		});

		// Start the intake reminder scheduler (checks every minute)
		startIntakeReminderScheduler({
			info: (msg) => app.log.info(msg),
			debug: (msg) => app.log.debug(msg),
			warn: (msg) => app.log.warn(msg),
			error: (msg) => app.log.error(msg),
		});
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
};

start();
