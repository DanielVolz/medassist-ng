import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvSchema } from "../plugins/env-schema.js";
import {
	buildRuntimeAppOptions,
	type CreateAppOptions,
	DEFAULT_CORS_ORIGINS,
	DEFAULT_RATE_LIMIT_MAX,
	parseCorsOrigins,
} from "../utils/server-config.js";

vi.mock("../db/client.js", () => ({ db: {}, migrationsReady: Promise.resolve() }));
vi.mock("../plugins/env.js", () => ({
	env: {
		AUTH_ENABLED: false,
		FORM_LOGIN_ENABLED: true,
		REGISTRATION_ENABLED: false,
		OIDC_ENABLED: false,
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		PORT: 3000,
		CORS_ORIGINS: DEFAULT_CORS_ORIGINS,
		JWT_SECRET: undefined,
		REFRESH_SECRET: undefined,
		COOKIE_SECRET: undefined,
		ACCESS_TOKEN_TTL_MINUTES: 15,
		REFRESH_TOKEN_TTL_DAYS: 7,
		OPENAPI_DOCS_ENABLED: false,
		DOCS_AUTH_REQUIRED: false,
		RATE_LIMIT_MAX: DEFAULT_RATE_LIMIT_MAX,
	},
}));

const { createApp } = await import("../app/createApp.js");

const tempDirs: string[] = [];

function createImagesDir(): string {
	const imagesDir = mkdtempSync(join(tmpdir(), "medassist-app-factory-"));
	tempDirs.push(imagesDir);
	return imagesDir;
}

async function buildProbeApp(options?: CreateAppOptions): Promise<FastifyInstance> {
	const app = await createApp({
		...options,
		logLevel: "silent",
		imagesDir: options?.imagesDir ?? createImagesDir(),
	});
	app.get("/bootstrap-test/probe", async () => ({ ok: true }));
	await app.ready();
	return app;
}

async function expectCorsDefaultAllowsSecondaryDevOrigin(app: FastifyInstance): Promise<void> {
	const response = await app.inject({
		method: "GET",
		url: "/bootstrap-test/probe",
		headers: { origin: "http://localhost:4174" },
	});

	expect(response.statusCode).toBe(200);
	expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:4174");
	expect(response.headers["access-control-allow-credentials"]).toBe("true");
}

async function expectCorsWithholdsAllowOriginForUnconfiguredBrowserOrigin(app: FastifyInstance): Promise<void> {
	const response = await app.inject({
		method: "GET",
		url: "/bootstrap-test/probe",
		headers: { origin: "https://evil.example" },
	});

	expect(response.statusCode).toBe(200);
	expect(response.headers["access-control-allow-origin"]).toBeUndefined();
}

async function expectDefaultRateLimit(app: FastifyInstance): Promise<void> {
	for (let index = 0; index < DEFAULT_RATE_LIMIT_MAX; index += 1) {
		const response = await app.inject({ method: "GET", url: "/bootstrap-test/probe" });
		expect(response.statusCode).toBe(200);
	}

	const limitedResponse = await app.inject({ method: "GET", url: "/bootstrap-test/probe" });
	expect(limitedResponse.statusCode).toBe(429);
}

describe("createApp bootstrap defaults", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not listen when imported and constructed for tests", async () => {
		const app = await buildProbeApp();

		try {
			expect(app.server.listening).toBe(false);
		} finally {
			await app.close();
		}
	});

	it("uses the same default CORS origins as runtime env parsing", async () => {
		const parsedEnv = EnvSchema.parse({ NODE_ENV: "test" });
		const runtimeOptions = buildRuntimeAppOptions(
			{
				...parsedEnv,
				OPENAPI_DOCS_ENABLED: false,
				DOCS_AUTH_REQUIRED: false,
			},
			createImagesDir()
		);

		expect(runtimeOptions.corsOrigins).toEqual(parseCorsOrigins(DEFAULT_CORS_ORIGINS));

		const defaultApp = await buildProbeApp();
		const runtimeApp = await buildProbeApp(runtimeOptions);

		try {
			await expectCorsDefaultAllowsSecondaryDevOrigin(defaultApp);
			await expectCorsDefaultAllowsSecondaryDevOrigin(runtimeApp);
		} finally {
			await defaultApp.close();
			await runtimeApp.close();
		}
	});

	it("withholds CORS allow-origin from unconfigured browser origins", async () => {
		const app = await buildProbeApp();

		try {
			await expectCorsWithholdsAllowOriginForUnconfiguredBrowserOrigin(app);
		} finally {
			await app.close();
		}
	});

	it("keeps public notification action CORS credential-free for arbitrary browser origins", async () => {
		const app = await buildProbeApp({
			corsOrigins: ["https://medassist.example"],
		});

		try {
			const preflight = await app.inject({
				method: "OPTIONS",
				url: "/notification-actions/demo-token",
				headers: {
					origin: "https://ntfy.example",
					"access-control-request-method": "POST",
					"access-control-request-headers": "content-type",
				},
			});

			expect(preflight.statusCode).toBe(204);
			expect(preflight.headers["access-control-allow-origin"]).toBe("https://ntfy.example");
			expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
		} finally {
			await app.close();
		}
	});

	it("uses the same default rate limit as runtime env parsing", async () => {
		const parsedEnv = EnvSchema.parse({ NODE_ENV: "test" });
		const runtimeOptions = buildRuntimeAppOptions(
			{
				...parsedEnv,
				OPENAPI_DOCS_ENABLED: false,
				DOCS_AUTH_REQUIRED: false,
			},
			createImagesDir()
		);

		expect(runtimeOptions.rateLimitMax).toBe(DEFAULT_RATE_LIMIT_MAX);

		const defaultApp = await buildProbeApp();
		const runtimeApp = await buildProbeApp(runtimeOptions);

		try {
			await expectDefaultRateLimit(defaultApp);
			await expectDefaultRateLimit(runtimeApp);
		} finally {
			await defaultApp.close();
			await runtimeApp.close();
		}
	});
});
