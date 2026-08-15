import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { getDataDir } from "../db/db-utils.js";
import { registerApiDocs } from "../plugins/api-docs.js";
import { jwtPlugin } from "../plugins/jwt.js";
import { apiKeyRoutes } from "../routes/api-keys.js";
import { asNeededIntakeRoutes } from "../routes/as-needed-intakes.js";
import { authRoutes } from "../routes/auth.js";
import { doseRoutes } from "../routes/doses.js";
import { exportRoutes } from "../routes/export.js";
import { healthRoutes } from "../routes/health.js";
import { imageRoutes } from "../routes/images.js";
import { intakeJournalRoutes } from "../routes/intake-journal.js";
import { medicationEnrichmentRoutes } from "../routes/medication-enrichment.js";
import { medicationRoutes } from "../routes/medications.js";
import { notificationActionRoutes } from "../routes/notification-actions.js";
import { oidcRoutes } from "../routes/oidc.js";
import { plannerRoutes } from "../routes/planner.js";
import { refillRoutes } from "../routes/refills.js";
import { reportRoutes } from "../routes/report.js";
import { settingsRoutes } from "../routes/settings.js";
import { shareRoutes } from "../routes/share.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";
import {
	buildAppConfig,
	type CreateAppOptions,
	DEFAULT_ACCESS_TOKEN_TTL_MINUTES,
	DEFAULT_COOKIE_SECRET,
	DEFAULT_CORS_ORIGINS,
	DEFAULT_LOG_LEVEL,
	DEFAULT_MULTIPART_FILE_SIZE_LIMIT_BYTES,
	DEFAULT_RATE_LIMIT_MAX,
	DEFAULT_RATE_LIMIT_TIME_WINDOW,
	DEFAULT_REFRESH_TOKEN_TTL_DAYS,
	getJwtConfig,
	parseCorsOrigins,
} from "../utils/server-config.js";

function sanitizeCorrelationId(headers: IncomingHttpHeaders): string | null {
	const rawHeader = headers["x-correlation-id"];
	if (typeof rawHeader !== "string") return null;
	const trimmed = rawHeader.trim();
	if (!trimmed) return null;
	if (trimmed.length > 128) return null;
	if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
	return trimmed;
}

function redactShareTokensInUrl(url: string | undefined): string | undefined {
	return url?.replace(/(\/(?:api\/)?share\/)(?:[a-f0-9]{16}|[a-f0-9]{64})(?=\/|$|\?)/gi, "$1[share-token]");
}

function buildLoggerOptions(level: string) {
	const runtimeEnv = process.env.NODE_ENV ?? "production";
	const base = {
		level,
		timestamp: () => `,"time":"${new Date().toISOString()}"`,
		serializers: {
			req(request: {
				method?: string;
				url?: string;
				hostname?: string;
				ip?: string;
				socket?: { remoteAddress?: string; remotePort?: number };
			}) {
				return {
					method: request.method,
					url: redactShareTokensInUrl(request.url),
					hostname: request.hostname,
					remoteAddress: request.ip ?? request.socket?.remoteAddress,
					remotePort: request.socket?.remotePort,
				};
			},
		},
	};

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

async function registerAppRoutes(app: FastifyInstance, imagesDir: string): Promise<void> {
	await app.register(imageRoutes, { imagesDir });
	await app.register(healthRoutes);
	await app.register(authRoutes);
	await app.register(apiKeyRoutes);
	await app.register(asNeededIntakeRoutes);
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
}

/** Create and configure a Fastify app without starting listeners or schedulers. */
export async function createApp(options?: CreateAppOptions): Promise<FastifyInstance> {
	const opts = {
		logLevel: options?.logLevel ?? DEFAULT_LOG_LEVEL,
		corsOrigins: options?.corsOrigins ?? parseCorsOrigins(DEFAULT_CORS_ORIGINS),
		authEnabled: options?.authEnabled ?? false,
		jwtSecret: options?.jwtSecret,
		refreshSecret: options?.refreshSecret,
		cookieSecret: options?.cookieSecret ?? DEFAULT_COOKIE_SECRET,
		accessTtlMinutes: options?.accessTtlMinutes ?? DEFAULT_ACCESS_TOKEN_TTL_MINUTES,
		refreshTtlDays: options?.refreshTtlDays ?? DEFAULT_REFRESH_TOKEN_TTL_DAYS,
		isProduction: options?.isProduction ?? false,
		imagesDir: options?.imagesDir ?? resolve(getDataDir(), "images"),
		openApiDocsEnabled: options?.openApiDocsEnabled ?? false,
		docsAuthRequired: options?.docsAuthRequired ?? options?.authEnabled ?? false,
		rateLimitMax: options?.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX,
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

	app.decorate(
		"config",
		buildAppConfig({
			jwtSecret: opts.jwtSecret,
			refreshSecret: opts.refreshSecret,
			accessTtlMinutes: opts.accessTtlMinutes,
			refreshTtlDays: opts.refreshTtlDays,
			isProduction: opts.isProduction,
		})
	);

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
	await app.register(rateLimit, { max: opts.rateLimitMax, timeWindow: DEFAULT_RATE_LIMIT_TIME_WINDOW });
	await app.register(cookie, { secret: opts.cookieSecret });
	await app.register(jwtPlugin, getJwtConfig(opts.authEnabled, opts.jwtSecret));
	await app.register(fastifyMultipart, { limits: { fileSize: DEFAULT_MULTIPART_FILE_SIZE_LIMIT_BYTES } });
	await registerApiDocs(app, {
		enabled: opts.openApiDocsEnabled,
		authRequired: opts.docsAuthRequired,
	});
	await registerAppRoutes(app, opts.imagesDir);

	return app;
}
