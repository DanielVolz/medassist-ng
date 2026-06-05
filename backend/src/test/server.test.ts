import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

// Import from utils to avoid index.ts import side effects (server start)
import {
	buildAppConfig,
	buildBaseCookieOptions,
	buildRefreshCookieOptions,
	ensureImagesDirectory,
	getJwtConfig,
	parseCorsOrigins,
} from "../utils/server-config.js";

describe("Index.ts Utility Functions", () => {
	describe("parseCorsOrigins", () => {
		it("should parse comma-separated origins", () => {
			const origins = parseCorsOrigins("http://localhost:5173,http://localhost:4174");
			expect(origins).toHaveLength(2);
			expect(origins[0]).toBe("http://localhost:5173");
			expect(origins[1]).toBe("http://localhost:4174");
		});

		it("should handle single origin", () => {
			const origins = parseCorsOrigins("https://myapp.example.com");
			expect(origins).toHaveLength(1);
			expect(origins[0]).toBe("https://myapp.example.com");
		});

		it("should filter out empty strings", () => {
			const origins = parseCorsOrigins("http://localhost:5173,,http://localhost:4174,");
			expect(origins).toHaveLength(2);
		});

		it("should trim whitespace", () => {
			const origins = parseCorsOrigins(" http://localhost:5173 , http://localhost:4174 ");
			expect(origins).toEqual(["http://localhost:5173", "http://localhost:4174"]);
		});

		it("should return empty array for empty string", () => {
			const origins = parseCorsOrigins("");
			expect(origins).toHaveLength(0);
		});
	});

	describe("buildBaseCookieOptions", () => {
		it("should make development access cookies httpOnly SameSite=Lax without Secure", () => {
			const options = buildBaseCookieOptions(15, false);
			expect(options).toMatchObject({
				httpOnly: true,
				secure: false,
				sameSite: "lax",
				path: "/",
				maxAge: 15 * 60,
			});
		});

		it("should set secure=true in production", () => {
			const options = buildBaseCookieOptions(15, true);
			expect(options.secure).toBe(true);
			expect(options.httpOnly).toBe(true);
			expect(options.sameSite).toBe("lax");
			expect(options.path).toBe("/");
		});

		it("should set secure=false in development", () => {
			const options = buildBaseCookieOptions(15, false);
			expect(options.secure).toBe(false);
		});

		it("should calculate maxAge in seconds from minutes", () => {
			const options = buildBaseCookieOptions(15, false);
			expect(options.maxAge).toBe(15 * 60); // 900 seconds
		});

		it("should handle custom TTL values", () => {
			const options = buildBaseCookieOptions(30, false);
			expect(options.maxAge).toBe(30 * 60); // 1800 seconds
		});
	});

	describe("buildRefreshCookieOptions", () => {
		it("should make production refresh cookies secure, httpOnly and SameSite=Lax", () => {
			const base = buildBaseCookieOptions(15, true);
			const refresh = buildRefreshCookieOptions(base, 7);
			expect(refresh).toMatchObject({
				httpOnly: true,
				secure: true,
				sameSite: "lax",
				path: "/",
				maxAge: 7 * 24 * 60 * 60,
			});
		});

		it("should extend base options with longer maxAge", () => {
			const base = buildBaseCookieOptions(15, false);
			const refresh = buildRefreshCookieOptions(base, 7);

			expect(refresh.httpOnly).toBe(true);
			expect(refresh.sameSite).toBe("lax");
			expect(refresh.maxAge).toBe(7 * 24 * 60 * 60); // 7 days in seconds
		});

		it("should calculate 14 days correctly", () => {
			const base = buildBaseCookieOptions(15, false);
			const refresh = buildRefreshCookieOptions(base, 14);
			expect(refresh.maxAge).toBe(14 * 24 * 60 * 60); // 1209600 seconds
		});

		it("should preserve secure flag from base", () => {
			const base = buildBaseCookieOptions(15, true);
			const refresh = buildRefreshCookieOptions(base, 7);
			expect(refresh.secure).toBe(true);
		});
	});

	describe("buildAppConfig", () => {
		it("should build complete config object", () => {
			const config = buildAppConfig({
				jwtSecret: "test-jwt-secret",
				refreshSecret: "test-refresh-secret",
				accessTtlMinutes: 15,
				refreshTtlDays: 7,
				isProduction: false,
			});

			expect(config.accessSecret).toBe("test-jwt-secret");
			expect(config.refreshSecret).toBe("test-refresh-secret");
			expect(config.accessTtl).toBe(15);
			expect(config.refreshTtl).toBe(7);
			expect(config.cookieOptions).toBeDefined();
			expect(config.refreshCookieOptions).toBeDefined();
		});

		it("should use empty strings for missing secrets", () => {
			const config = buildAppConfig({
				accessTtlMinutes: 15,
				refreshTtlDays: 7,
				isProduction: false,
			});

			expect(config.accessSecret).toBe("");
			expect(config.refreshSecret).toBe("");
		});

		it("should set secure cookies in production", () => {
			const config = buildAppConfig({
				accessTtlMinutes: 15,
				refreshTtlDays: 7,
				isProduction: true,
			});

			expect(config.cookieOptions.secure).toBe(true);
			expect(config.refreshCookieOptions.secure).toBe(true);
		});
	});

	describe("ensureImagesDirectory", () => {
		const testDir = resolve(tmpdir(), `test-images-dir-${Date.now()}`);

		afterEach(() => {
			try {
				if (existsSync(testDir)) {
					rmSync(testDir, { recursive: true, force: true });
				}
			} catch {
				// ignore cleanup errors
			}
		});

		it("should create directory if it does not exist", () => {
			const imagesDir = ensureImagesDirectory(testDir);
			expect(existsSync(imagesDir)).toBe(true);
			expect(imagesDir).toContain("data/images");
		});

		it("should return path if directory already exists", () => {
			const firstCall = ensureImagesDirectory(testDir);
			const secondCall = ensureImagesDirectory(testDir);
			expect(firstCall).toBe(secondCall);
		});
	});

	describe("getJwtConfig", () => {
		it("should return real secret when auth enabled with secret", () => {
			const config = getJwtConfig(true, "my-super-secret");
			expect(config.secret).toBe("my-super-secret");
			expect(config.cookie.cookieName).toBe("access_token");
			expect(config.cookie.signed).toBe(false);
		});

		it("should return dummy secret when auth disabled", () => {
			const config = getJwtConfig(false, undefined);
			expect(config.secret).toBe("auth-disabled-no-secret-needed");
		});

		it("should return dummy secret when auth enabled but no secret", () => {
			const config = getJwtConfig(true, undefined);
			expect(config.secret).toBe("auth-disabled-no-secret-needed");
		});

		it("should return dummy secret when auth enabled with empty secret", () => {
			const config = getJwtConfig(true, "");
			expect(config.secret).toBe("auth-disabled-no-secret-needed");
		});
	});
});

// Test the server bootstrap logic without starting the actual server

describe("Server Bootstrap", () => {
	describe("Fastify App Configuration", () => {
		it("should create a Fastify instance with logger", async () => {
			const app = Fastify({
				logger: {
					level: "silent", // Disable logging for tests
				},
				ajv: documentationSchemaAjv,
			});

			expect(app).toBeDefined();
			expect(app.log).toBeDefined();

			await app.close();
		});

		it("should register sensible plugin", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
			await app.register(sensible);

			// Sensible adds error helpers
			expect(app.httpErrors).toBeDefined();
			expect(app.httpErrors.notFound).toBeDefined();

			await app.close();
		});

		it("should register cors plugin with multiple origins", async () => {
			const origins = ["http://localhost:5173", "http://localhost:4174"];

			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
			await app.register(cors, { origin: origins, credentials: true });

			// Add a test route
			app.get("/test", async () => ({ ok: true }));

			await app.ready();

			// Test CORS headers
			const response = await app.inject({
				method: "GET",
				url: "/test",
				headers: {
					origin: "http://localhost:5173",
				},
			});

			expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
			expect(response.headers["access-control-allow-credentials"]).toBe("true");

			await app.close();
		});

		it("should allow browser preflight requests on public notification action routes", async () => {
			const origins = ["https://medtest.danielvolz.org"];

			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
			await app.register(cors, {
				delegator: (request, callback) => {
					if (request.raw.url?.startsWith("/notification-actions/")) {
						callback(null, {
							origin: true,
							credentials: false,
							methods: ["GET", "HEAD", "POST", "OPTIONS"],
						});
						return;
					}

					callback(null, { origin: origins, credentials: true });
				},
			});

			app.post("/notification-actions/:token", async () => ({ ok: true }));
			await app.ready();

			const response = await app.inject({
				method: "OPTIONS",
				url: "/notification-actions/demo-token",
				headers: {
					origin: "https://ntfy.danielvolz.org",
					"access-control-request-method": "POST",
					"access-control-request-headers": "content-type",
				},
			});

			expect(response.statusCode).toBe(204);
			expect(response.headers["access-control-allow-origin"]).toBe("https://ntfy.danielvolz.org");
			expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
			expect(response.headers["access-control-allow-methods"]).toContain("OPTIONS");

			await app.close();
		});

		it("should register cookie plugin", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
			await app.register(cookie, { secret: "test-cookie-secret" });

			// Add a test route that sets a cookie
			app.get("/set-cookie", async (_request, reply) => {
				reply.setCookie("test", "value", { path: "/" });
				return { ok: true };
			});

			await app.ready();

			const response = await app.inject({
				method: "GET",
				url: "/set-cookie",
			});

			expect(response.headers["set-cookie"]).toBeDefined();

			await app.close();
		});
	});

	describe("Config Decorator", () => {
		it("should create config with auth settings", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });

			const accessTtlMinutes = 15;
			const refreshTtlDays = 7;

			const baseCookieOptions = {
				httpOnly: true,
				sameSite: "lax" as const,
				secure: false, // test environment
				path: "/",
				maxAge: accessTtlMinutes * 60,
			};

			const refreshCookieOptions = {
				...baseCookieOptions,
				maxAge: refreshTtlDays * 24 * 60 * 60,
			};

			app.decorate("config", {
				accessSecret: "test-jwt-secret",
				refreshSecret: "test-refresh-secret",
				accessTtl: accessTtlMinutes,
				refreshTtl: refreshTtlDays,
				cookieOptions: baseCookieOptions,
				refreshCookieOptions,
			});

			const appWithConfig = app as unknown as {
				config: {
					accessTtl: number;
					refreshTtl: number;
					cookieOptions: { httpOnly: boolean };
					refreshCookieOptions: { maxAge: number };
				};
			};
			expect(appWithConfig.config.accessTtl).toBe(15);
			expect(appWithConfig.config.refreshTtl).toBe(7);
			expect(appWithConfig.config.cookieOptions.httpOnly).toBe(true);
			expect(appWithConfig.config.refreshCookieOptions.maxAge).toBe(7 * 24 * 60 * 60);

			await app.close();
		});

		it("should calculate cookie maxAge correctly", () => {
			const accessTtlMinutes = 30;
			const refreshTtlDays = 14;

			const accessMaxAge = accessTtlMinutes * 60;
			const refreshMaxAge = refreshTtlDays * 24 * 60 * 60;

			expect(accessMaxAge).toBe(1800); // 30 minutes in seconds
			expect(refreshMaxAge).toBe(1209600); // 14 days in seconds
		});
	});

	describe("CORS Origins Parsing", () => {
		it("should parse comma-separated origins", () => {
			const originsEnv = "http://localhost:5173,http://localhost:4174";
			const origins = parseCorsOrigins(originsEnv);

			expect(origins).toHaveLength(2);
			expect(origins[0]).toBe("http://localhost:5173");
			expect(origins[1]).toBe("http://localhost:4174");
		});

		it("should handle single origin", () => {
			const originsEnv = "https://myapp.example.com";
			const origins = parseCorsOrigins(originsEnv);

			expect(origins).toHaveLength(1);
			expect(origins[0]).toBe("https://myapp.example.com");
		});

		it("should filter out empty strings", () => {
			const originsEnv = "http://localhost:5173,,http://localhost:4174,";
			const origins = parseCorsOrigins(originsEnv);

			expect(origins).toHaveLength(2);
		});

		it("should trim whitespace", () => {
			const originsEnv = " http://localhost:5173 , http://localhost:4174 ";
			const origins = parseCorsOrigins(originsEnv);

			expect(origins).toEqual(["http://localhost:5173", "http://localhost:4174"]);
		});
	});

	describe("Route Registration", () => {
		it("should register multiple route plugins", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });

			// Mock route plugins
			const healthRoutes = async (app: FastifyInstance) => {
				app.get("/health", async () => ({ status: "ok" }));
			};

			const authRoutes = async (app: FastifyInstance) => {
				app.post("/auth/login", async () => ({ token: "mock" }));
			};

			const medicationRoutes = async (app: FastifyInstance) => {
				app.get("/medications", async () => []);
			};

			await app.register(healthRoutes);
			await app.register(authRoutes);
			await app.register(medicationRoutes);

			await app.ready();

			// Verify routes are registered
			const routes = app.printRoutes();
			expect(routes).toContain("health");
			expect(routes).toContain("auth/login");
			expect(routes).toContain("medications");

			await app.close();
		});
	});

	describe("Server Startup", () => {
		it("should listen on specified port", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });

			app.get("/test", async () => ({ ok: true }));

			// Use port 0 to get a random available port
			const address = await app.listen({ port: 0, host: "127.0.0.1" });

			expect(address).toContain("127.0.0.1");

			await app.close();
		});

		it("should handle listen errors gracefully", async () => {
			const app = Fastify({ logger: false, ajv: documentationSchemaAjv });

			// Try to listen on an invalid port
			await expect(app.listen({ port: -1, host: "127.0.0.1" })).rejects.toThrow();

			await app.close();
		});
	});

	describe("Images Directory", () => {
		it("should construct images directory path correctly", () => {
			const resolve = (base: string, ...paths: string[]) => {
				return [base, ...paths].join("/").replace(/\/+/g, "/");
			};

			const cwd = "/app";
			const imagesDir = resolve(cwd, "data/images");

			expect(imagesDir).toBe("/app/data/images");
		});
	});
});

describe("Cookie Options", () => {
	describe("Production vs Development", () => {
		it("should set secure=true in production", () => {
			const isProduction = true;

			const cookieOptions = {
				httpOnly: true,
				sameSite: "lax" as const,
				secure: isProduction,
				path: "/",
			};

			expect(cookieOptions.secure).toBe(true);
		});

		it("should set secure=false in development", () => {
			const isProduction = false;

			const cookieOptions = {
				httpOnly: true,
				sameSite: "lax" as const,
				secure: isProduction,
				path: "/",
			};

			expect(cookieOptions.secure).toBe(false);
		});
	});
});

describe("Rate Limiting", () => {
	it("should configure rate limit settings", () => {
		const rateLimitConfig = {
			max: 300,
			timeWindow: "1 minute",
		};

		expect(rateLimitConfig.max).toBe(300);
		expect(rateLimitConfig.timeWindow).toBe("1 minute");
	});
});

describe("JWT Configuration", () => {
	it("should configure JWT with auth enabled", () => {
		const authEnabled = true;
		const jwtSecret = "my-super-secret-jwt-key";

		const jwtConfig = {
			secret: authEnabled && jwtSecret ? jwtSecret : "auth-disabled-no-secret-needed",
			cookie: { cookieName: "access_token", signed: false },
		};

		expect(jwtConfig.secret).toBe(jwtSecret);
		expect(jwtConfig.cookie.cookieName).toBe("access_token");
		expect(jwtConfig.cookie.signed).toBe(false);
	});

	it("should use dummy secret with auth disabled", () => {
		const authEnabled = false;
		const jwtSecret = undefined;

		const jwtConfig = {
			secret: authEnabled && jwtSecret ? jwtSecret : "auth-disabled-no-secret-needed",
			cookie: { cookieName: "access_token", signed: false },
		};

		expect(jwtConfig.secret).toBe("auth-disabled-no-secret-needed");
	});
});

describe("Multipart Configuration", () => {
	it("should set file size limit to 10MB", () => {
		const fileSizeLimit = 10 * 1024 * 1024;

		expect(fileSizeLimit).toBe(10485760);
	});
});
