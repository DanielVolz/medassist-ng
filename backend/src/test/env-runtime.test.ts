import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("plugins/env runtime validation", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		process.env = {
			...ORIGINAL_ENV,
			DOTENV_PATH: "/tmp/medassist-nonexistent.env",
		};
	});

	afterAll(() => {
		process.env = ORIGINAL_ENV;
	});

	it("loads with defaults when auth and oidc are disabled", async () => {
		process.env.NODE_ENV = "test";
		delete process.env.AUTH_ENABLED;
		delete process.env.ALLOW_UNAUTHENTICATED;
		delete process.env.OIDC_ENABLED;
		delete process.env.JWT_SECRET;
		delete process.env.REFRESH_SECRET;
		delete process.env.COOKIE_SECRET;
		delete process.env.CORS_ORIGINS;
		delete process.env.RATE_LIMIT_MAX;

		const mod = await import("../plugins/env.js");
		expect(mod.env.AUTH_ENABLED).toBe(false);
		expect(mod.env.ALLOW_UNAUTHENTICATED).toBe(false);
		expect(mod.env.OIDC_ENABLED).toBe(false);
		expect(mod.env.PORT).toBe(3000);
		expect(mod.env.CORS_ORIGINS).toBe("http://localhost:5173,http://localhost:4174");
		expect(mod.env.RATE_LIMIT_MAX).toBe(100);
		expect(mod.env.SHARE_TOKEN_TTL_DAYS).toBe(90);
		expect(mod.env.SENSITIVE_LOGGING_ENABLED).toBe(false);
		expect(mod.env.OPENAPI_DOCS_ENABLED).toBe(true);
		expect(mod.env.DOCS_AUTH_REQUIRED).toBe(false);
	});

	it("exits when production auth is disabled without explicit unauthenticated override", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "false";
		delete process.env.ALLOW_UNAUTHENTICATED;
		delete process.env.OIDC_ENABLED;

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("loads when production auth is disabled with explicit unauthenticated override", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "false";
		process.env.ALLOW_UNAUTHENTICATED = "true";
		delete process.env.OIDC_ENABLED;

		const mod = await import("../plugins/env.js");
		expect(mod.env.NODE_ENV).toBe("production");
		expect(mod.env.AUTH_ENABLED).toBe(false);
		expect(mod.env.ALLOW_UNAUTHENTICATED).toBe(true);
		expect(mod.env.OPENAPI_DOCS_ENABLED).toBe(false);
		expect(mod.env.DOCS_AUTH_REQUIRED).toBe(false);
	});

	it("requires docs auth by default when auth is enabled", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.API_KEY_PEPPER = "a".repeat(64);
		process.env.OPENAPI_DOCS_ENABLED = "true";
		delete process.env.DOCS_AUTH_REQUIRED;

		const mod = await import("../plugins/env.js");
		expect(mod.env.OPENAPI_DOCS_ENABLED).toBe(true);
		expect(mod.env.DOCS_AUTH_REQUIRED).toBe(true);
	});

	it("allows docs auth to be explicitly disabled", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.API_KEY_PEPPER = "a".repeat(64);
		process.env.OPENAPI_DOCS_ENABLED = "true";
		process.env.DOCS_AUTH_REQUIRED = "false";

		const mod = await import("../plugins/env.js");
		expect(mod.env.OPENAPI_DOCS_ENABLED).toBe(true);
		expect(mod.env.DOCS_AUTH_REQUIRED).toBe(false);
	});

	it("accepts common boolean variants", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "yes";
		process.env.ALLOW_UNAUTHENTICATED = "0";
		process.env.REGISTRATION_ENABLED = "1";
		process.env.FORM_LOGIN_ENABLED = "TRUE";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.API_KEY_PEPPER = "a".repeat(64);
		process.env.OPENAPI_DOCS_ENABLED = "no";
		process.env.DOCS_AUTH_REQUIRED = "yes";

		const mod = await import("../plugins/env.js");
		expect(mod.env.AUTH_ENABLED).toBe(true);
		expect(mod.env.ALLOW_UNAUTHENTICATED).toBe(false);
		expect(mod.env.REGISTRATION_ENABLED).toBe(true);
		expect(mod.env.FORM_LOGIN_ENABLED).toBe(true);
		expect(mod.env.OPENAPI_DOCS_ENABLED).toBe(false);
		expect(mod.env.DOCS_AUTH_REQUIRED).toBe(true);
	});

	it("exits when a boolean env value is invalid", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "maybe";

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("exits when ACCESS_TOKEN_TTL_MINUTES is invalid", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.ACCESS_TOKEN_TTL_MINUTES = "abc";

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("exits when RATE_LIMIT_MAX is not positive and bounded", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.RATE_LIMIT_MAX = "100001";

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("trims CORS_ORIGINS and filters empty entries", async () => {
		process.env.NODE_ENV = "test";
		process.env.AUTH_ENABLED = "false";
		process.env.CORS_ORIGINS = " http://localhost:5173, , http://localhost:4174, ";

		const mod = await import("../plugins/env.js");
		expect(mod.env.CORS_ORIGINS).toBe("http://localhost:5173,http://localhost:4174");
	});

	it("loads when development auth is disabled", async () => {
		process.env.NODE_ENV = "development";
		process.env.AUTH_ENABLED = "false";
		delete process.env.ALLOW_UNAUTHENTICATED;
		delete process.env.OIDC_ENABLED;

		const mod = await import("../plugins/env.js");
		expect(mod.env.NODE_ENV).toBe("development");
		expect(mod.env.AUTH_ENABLED).toBe(false);
		expect(mod.env.ALLOW_UNAUTHENTICATED).toBe(false);
	});

	it("exits when auth is enabled but secrets are missing", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		delete process.env.JWT_SECRET;
		delete process.env.REFRESH_SECRET;
		delete process.env.COOKIE_SECRET;

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("exits in production auth when API key pepper and auth secrets are too weak for API key hashing", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		delete process.env.API_KEY_PEPPER;

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("loads in production auth when API_KEY_PEPPER is strong", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.API_KEY_PEPPER = "b".repeat(64);

		const mod = await import("../plugins/env.js");
		expect(mod.env.API_KEY_PEPPER).toBe("b".repeat(64));
	});

	it("loads in production auth without API_KEY_PEPPER when an auth secret is strong", async () => {
		process.env.NODE_ENV = "production";
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "c".repeat(64);
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		delete process.env.API_KEY_PEPPER;

		const mod = await import("../plugins/env.js");
		expect(mod.env.JWT_SECRET).toBe("c".repeat(64));
	});

	it("exits when oidc is enabled but required settings are missing", async () => {
		process.env.AUTH_ENABLED = "false";
		process.env.OIDC_ENABLED = "true";
		delete process.env.OIDC_ISSUER_URL;
		delete process.env.OIDC_CLIENT_ID;
		delete process.env.OIDC_CLIENT_SECRET;
		delete process.env.OIDC_REDIRECT_URI;

		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit:${code ?? 0}`);
		}) as never);

		await expect(import("../plugins/env.js")).rejects.toThrow("process.exit:1");
	});

	it("loads when auth and oidc settings are complete", async () => {
		process.env.AUTH_ENABLED = "true";
		process.env.JWT_SECRET = "jwt-secret-for-runtime-test";
		process.env.REFRESH_SECRET = "refresh-secret-runtime-test";
		process.env.COOKIE_SECRET = "cookie-secret-runtime-test";
		process.env.API_KEY_PEPPER = "a".repeat(64);
		process.env.OIDC_ENABLED = "true";
		process.env.OIDC_ISSUER_URL = "https://auth.example.com";
		process.env.OIDC_CLIENT_ID = "medassist";
		process.env.OIDC_CLIENT_SECRET = "super-secret-client";
		process.env.OIDC_REDIRECT_URI = "https://app.example.com/api/auth/oidc/callback";

		const mod = await import("../plugins/env.js");
		expect(mod.env.AUTH_ENABLED).toBe(true);
		expect(mod.env.OIDC_ENABLED).toBe(true);
		expect(mod.env.OIDC_CLIENT_ID).toBe("medassist");
	});
});
