import { describe, expect, it, vi } from "vitest";
import { EnvSchema, type ParsedEnv } from "../plugins/env-schema.js";
import { DEFAULT_CORS_ORIGINS } from "../utils/server-config.js";

// Mock process.exit to prevent tests from exiting
const mockExit = vi.fn();
vi.spyOn(process, "exit").mockImplementation(mockExit as unknown as (...args: unknown[]) => never);

// Validation functions from env.ts
function validateAuthSecrets(parsed: ParsedEnv): string[] {
	const missing: string[] = [];
	if (parsed.AUTH_ENABLED) {
		if (!parsed.JWT_SECRET) missing.push("JWT_SECRET");
		if (!parsed.REFRESH_SECRET) missing.push("REFRESH_SECRET");
		if (!parsed.COOKIE_SECRET) missing.push("COOKIE_SECRET");
	}
	return missing;
}

function validateOidcConfig(parsed: ParsedEnv): string[] {
	const missing: string[] = [];
	if (parsed.OIDC_ENABLED) {
		if (!parsed.OIDC_ISSUER_URL) missing.push("OIDC_ISSUER_URL");
		if (!parsed.OIDC_CLIENT_ID) missing.push("OIDC_CLIENT_ID");
		if (!parsed.OIDC_CLIENT_SECRET) missing.push("OIDC_CLIENT_SECRET");
		if (!parsed.OIDC_REDIRECT_URI) missing.push("OIDC_REDIRECT_URI");
	}
	return missing;
}

describe("EnvSchema", () => {
	describe("default values", () => {
		it("should use default values when env vars are empty", () => {
			const result = EnvSchema.parse({});

			expect(result.NODE_ENV).toBe("production");
			expect(result.PORT).toBe(3000);
			expect(result.CORS_ORIGINS).toBe(DEFAULT_CORS_ORIGINS);
			expect(result.LOG_LEVEL).toBe("info");
			expect(result.SENSITIVE_LOGGING_ENABLED).toBe(false);
			expect(result.PUBLIC_APP_URL).toBeUndefined();
			expect(result.OPENAPI_DOCS_ENABLED).toBeUndefined();
			expect(result.DOCS_AUTH_REQUIRED).toBeUndefined();
			expect(result.MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED).toBeUndefined();
			expect(result.AUTH_ENABLED).toBe(false);
			expect(result.ALLOW_UNAUTHENTICATED).toBe(false);
			expect(result.REGISTRATION_ENABLED).toBe(false);
			expect(result.RATE_LIMIT_MAX).toBe(100);
			expect(result.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
			expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(7);
			expect(result.API_KEY_PEPPER).toBeUndefined();
			expect(result.API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES).toBe(15);
			expect(result.SHARE_TOKEN_TTL_DAYS).toBe(90);
			expect(result.OIDC_ENABLED).toBe(false);
			expect(result.OIDC_SCOPES).toBe("openid profile email");
			expect(result.OIDC_AUTO_CREATE_USERS).toBe(true);
			expect(result.OIDC_USERNAME_CLAIM).toBe("preferred_username");
			expect(result.OIDC_PROVIDER_NAME).toBe("SSO");
		});
	});

	describe("NODE_ENV validation", () => {
		it("should accept development", () => {
			const result = EnvSchema.parse({ NODE_ENV: "development" });
			expect(result.NODE_ENV).toBe("development");
		});

		it("should accept production", () => {
			const result = EnvSchema.parse({ NODE_ENV: "production" });
			expect(result.NODE_ENV).toBe("production");
		});

		it("should accept test", () => {
			const result = EnvSchema.parse({ NODE_ENV: "test" });
			expect(result.NODE_ENV).toBe("test");
		});

		it("should reject invalid NODE_ENV values", () => {
			expect(() => EnvSchema.parse({ NODE_ENV: "staging" })).toThrow();
			expect(() => EnvSchema.parse({ NODE_ENV: "invalid" })).toThrow();
		});
	});

	describe("PORT transformation", () => {
		it("should transform string PORT to number", () => {
			const result = EnvSchema.parse({ PORT: "8080" });
			expect(result.PORT).toBe(8080);
		});

		it("should use default port when not provided", () => {
			const result = EnvSchema.parse({});
			expect(result.PORT).toBe(3000);
		});
	});

	describe("boolean transformations", () => {
		it("should transform truthy boolean variants to true", () => {
			for (const value of ["true", "TRUE", "1", "yes", "YeS"]) {
				expect(EnvSchema.parse({ AUTH_ENABLED: value }).AUTH_ENABLED).toBe(true);
			}
		});

		it("should transform falsy boolean variants to false", () => {
			for (const value of ["false", "FALSE", "0", "no", "No"]) {
				expect(EnvSchema.parse({ AUTH_ENABLED: value }).AUTH_ENABLED).toBe(false);
			}
		});

		it("should transform ALLOW_UNAUTHENTICATED=true to boolean true", () => {
			const result = EnvSchema.parse({ ALLOW_UNAUTHENTICATED: "true" });
			expect(result.ALLOW_UNAUTHENTICATED).toBe(true);
		});

		it("should transform ALLOW_UNAUTHENTICATED=false to boolean false", () => {
			const result = EnvSchema.parse({ ALLOW_UNAUTHENTICATED: "false" });
			expect(result.ALLOW_UNAUTHENTICATED).toBe(false);
		});

		it("should reject invalid boolean strings", () => {
			expect(() => EnvSchema.parse({ AUTH_ENABLED: "maybe" })).toThrow();
		});

		it("should transform REGISTRATION_ENABLED correctly", () => {
			expect(EnvSchema.parse({ REGISTRATION_ENABLED: "true" }).REGISTRATION_ENABLED).toBe(true);
			expect(EnvSchema.parse({ REGISTRATION_ENABLED: "false" }).REGISTRATION_ENABLED).toBe(false);
		});

		it("should transform OIDC_ENABLED correctly", () => {
			expect(EnvSchema.parse({ OIDC_ENABLED: "true" }).OIDC_ENABLED).toBe(true);
			expect(EnvSchema.parse({ OIDC_ENABLED: "false" }).OIDC_ENABLED).toBe(false);
		});

		it("should transform OIDC_AUTO_CREATE_USERS correctly", () => {
			expect(EnvSchema.parse({ OIDC_AUTO_CREATE_USERS: "true" }).OIDC_AUTO_CREATE_USERS).toBe(true);
			expect(EnvSchema.parse({ OIDC_AUTO_CREATE_USERS: "false" }).OIDC_AUTO_CREATE_USERS).toBe(false);
		});

		it("should transform API docs booleans correctly", () => {
			expect(EnvSchema.parse({ OPENAPI_DOCS_ENABLED: "yes" }).OPENAPI_DOCS_ENABLED).toBe(true);
			expect(EnvSchema.parse({ OPENAPI_DOCS_ENABLED: "0" }).OPENAPI_DOCS_ENABLED).toBe(false);
			expect(EnvSchema.parse({ DOCS_AUTH_REQUIRED: "1" }).DOCS_AUTH_REQUIRED).toBe(true);
			expect(EnvSchema.parse({ DOCS_AUTH_REQUIRED: "no" }).DOCS_AUTH_REQUIRED).toBe(false);
		});

		it("should transform medication enrichment startup refresh boolean correctly", () => {
			expect(
				EnvSchema.parse({ MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: "yes" })
					.MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED
			).toBe(true);
			expect(
				EnvSchema.parse({ MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: "0" })
					.MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED
			).toBe(false);
		});
	});

	describe("JWT secret validation", () => {
		it("should accept JWT_SECRET with 10+ characters", () => {
			const result = EnvSchema.parse({ JWT_SECRET: "1234567890" });
			expect(result.JWT_SECRET).toBe("1234567890");
		});

		it("should reject JWT_SECRET with less than 10 characters", () => {
			expect(() => EnvSchema.parse({ JWT_SECRET: "123456789" })).toThrow();
		});

		it("should allow optional JWT_SECRET", () => {
			const result = EnvSchema.parse({});
			expect(result.JWT_SECRET).toBeUndefined();
		});
	});

	describe("TTL transformations", () => {
		it("should transform ACCESS_TOKEN_TTL_MINUTES to number", () => {
			const result = EnvSchema.parse({ ACCESS_TOKEN_TTL_MINUTES: "30" });
			expect(result.ACCESS_TOKEN_TTL_MINUTES).toBe(30);
		});

		it("should reject invalid ACCESS_TOKEN_TTL_MINUTES", () => {
			expect(() => EnvSchema.parse({ ACCESS_TOKEN_TTL_MINUTES: "abc" })).toThrow();
			expect(() => EnvSchema.parse({ ACCESS_TOKEN_TTL_MINUTES: "0" })).toThrow();
		});

		it("should transform REFRESH_TOKEN_TTL_DAYS to number", () => {
			const result = EnvSchema.parse({ REFRESH_TOKEN_TTL_DAYS: "14" });
			expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(14);
		});

		it("should transform SHARE_TOKEN_TTL_DAYS to number", () => {
			const result = EnvSchema.parse({ SHARE_TOKEN_TTL_DAYS: "120" });
			expect(result.SHARE_TOKEN_TTL_DAYS).toBe(120);
		});

		it("should transform API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES to number", () => {
			const result = EnvSchema.parse({ API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES: "30" });
			expect(result.API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES).toBe(30);
		});

		it("should reject invalid API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES", () => {
			expect(() => EnvSchema.parse({ API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES: "abc" })).toThrow();
			expect(() => EnvSchema.parse({ API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES: "0" })).toThrow();
		});
	});

	describe("API key pepper validation", () => {
		it("should accept strong API_KEY_PEPPER values", () => {
			const pepper = "a".repeat(32);
			const result = EnvSchema.parse({ API_KEY_PEPPER: pepper });
			expect(result.API_KEY_PEPPER).toBe(pepper);
		});

		it("should reject short API_KEY_PEPPER values", () => {
			expect(() => EnvSchema.parse({ API_KEY_PEPPER: "short-api-key-pepper" })).toThrow();
		});
	});

	describe("RATE_LIMIT_MAX validation", () => {
		it("should transform valid values to positive bounded numbers", () => {
			expect(EnvSchema.parse({ RATE_LIMIT_MAX: "1" }).RATE_LIMIT_MAX).toBe(1);
			expect(EnvSchema.parse({ RATE_LIMIT_MAX: "1000" }).RATE_LIMIT_MAX).toBe(1000);
			expect(EnvSchema.parse({ RATE_LIMIT_MAX: "100000" }).RATE_LIMIT_MAX).toBe(100_000);
		});

		it("should reject invalid, zero, negative, and unbounded values", () => {
			expect(() => EnvSchema.parse({ RATE_LIMIT_MAX: "abc" })).toThrow();
			expect(() => EnvSchema.parse({ RATE_LIMIT_MAX: "0" })).toThrow();
			expect(() => EnvSchema.parse({ RATE_LIMIT_MAX: "-1" })).toThrow();
			expect(() => EnvSchema.parse({ RATE_LIMIT_MAX: "100001" })).toThrow();
		});
	});

	describe("OIDC URL validation", () => {
		it("should accept valid PUBLIC_APP_URL", () => {
			const result = EnvSchema.parse({ PUBLIC_APP_URL: "https://medassist.example.com" });
			expect(result.PUBLIC_APP_URL).toBe("https://medassist.example.com");
		});

		it("should reject invalid PUBLIC_APP_URL", () => {
			expect(() => EnvSchema.parse({ PUBLIC_APP_URL: "not-a-url" })).toThrow();
		});

		it("should accept valid OIDC_ISSUER_URL", () => {
			const result = EnvSchema.parse({ OIDC_ISSUER_URL: "https://auth.example.com" });
			expect(result.OIDC_ISSUER_URL).toBe("https://auth.example.com");
		});

		it("should reject invalid OIDC_ISSUER_URL", () => {
			expect(() => EnvSchema.parse({ OIDC_ISSUER_URL: "not-a-url" })).toThrow();
		});

		it("should accept valid OIDC_REDIRECT_URI", () => {
			const result = EnvSchema.parse({ OIDC_REDIRECT_URI: "https://app.example.com/callback" });
			expect(result.OIDC_REDIRECT_URI).toBe("https://app.example.com/callback");
		});

		it("should reject invalid OIDC_REDIRECT_URI", () => {
			expect(() => EnvSchema.parse({ OIDC_REDIRECT_URI: "invalid" })).toThrow();
		});
	});

	describe("CORS_ORIGINS parsing", () => {
		it("should accept comma-separated origins", () => {
			const result = EnvSchema.parse({ CORS_ORIGINS: "http://a.com,http://b.com" });
			expect(result.CORS_ORIGINS).toBe("http://a.com,http://b.com");
		});

		it("should accept single origin", () => {
			const result = EnvSchema.parse({ CORS_ORIGINS: "http://localhost:3000" });
			expect(result.CORS_ORIGINS).toBe("http://localhost:3000");
		});

		it("should trim origins and filter empty entries", () => {
			const result = EnvSchema.parse({ CORS_ORIGINS: " http://a.com, , http://b.com, " });
			expect(result.CORS_ORIGINS).toBe("http://a.com,http://b.com");
		});
	});

	describe("TRUSTED_PRIVATE_NOTIFICATION_HOSTS", () => {
		it("normalizes exact trusted notification hostnames", () => {
			expect(
				EnvSchema.parse({
					TRUSTED_PRIVATE_NOTIFICATION_HOSTS: " NTFY.LOCAL.DANIELVOLZ.ORG., ntfy.example.com ",
				}).TRUSTED_PRIVATE_NOTIFICATION_HOSTS
			).toEqual(["ntfy.local.danielvolz.org", "ntfy.example.com"]);
		});

		it("rejects IP literals, local names, and wildcard values", () => {
			for (const value of ["192.168.23.123", "localhost", "ntfy.local", "*.example.com"]) {
				expect(() => EnvSchema.parse({ TRUSTED_PRIVATE_NOTIFICATION_HOSTS: value })).toThrow();
			}
		});
	});
});

describe("Auth validation", () => {
	it("should require secrets when AUTH_ENABLED=true", () => {
		const parsed = EnvSchema.parse({ AUTH_ENABLED: "true" });
		const missing = validateAuthSecrets(parsed);
		expect(missing).toContain("JWT_SECRET");
		expect(missing).toContain("REFRESH_SECRET");
		expect(missing).toContain("COOKIE_SECRET");
	});

	it("should not require secrets when AUTH_ENABLED=false", () => {
		const parsed = EnvSchema.parse({ AUTH_ENABLED: "false" });
		const missing = validateAuthSecrets(parsed);
		expect(missing).toHaveLength(0);
	});

	it("should pass validation with all secrets provided", () => {
		const parsed = EnvSchema.parse({
			AUTH_ENABLED: "true",
			JWT_SECRET: "super-secret-jwt-key-12345",
			REFRESH_SECRET: "super-secret-refresh-key-12345",
			COOKIE_SECRET: "super-secret-cookie-key-12345",
		});
		const missing = validateAuthSecrets(parsed);
		expect(missing).toHaveLength(0);
	});

	it("should identify which specific secrets are missing", () => {
		const parsed = EnvSchema.parse({
			AUTH_ENABLED: "true",
			JWT_SECRET: "super-secret-jwt-key-12345",
			// REFRESH_SECRET missing
			COOKIE_SECRET: "super-secret-cookie-key-12345",
		});
		const missing = validateAuthSecrets(parsed);
		expect(missing).toHaveLength(1);
		expect(missing).toContain("REFRESH_SECRET");
	});
});

describe("OIDC validation", () => {
	it("should require all OIDC settings when OIDC_ENABLED=true", () => {
		const parsed = EnvSchema.parse({ OIDC_ENABLED: "true" });
		const missing = validateOidcConfig(parsed);
		expect(missing).toContain("OIDC_ISSUER_URL");
		expect(missing).toContain("OIDC_CLIENT_ID");
		expect(missing).toContain("OIDC_CLIENT_SECRET");
		expect(missing).toContain("OIDC_REDIRECT_URI");
	});

	it("should not require OIDC settings when OIDC_ENABLED=false", () => {
		const parsed = EnvSchema.parse({ OIDC_ENABLED: "false" });
		const missing = validateOidcConfig(parsed);
		expect(missing).toHaveLength(0);
	});

	it("should pass validation with all OIDC settings provided", () => {
		const parsed = EnvSchema.parse({
			OIDC_ENABLED: "true",
			OIDC_ISSUER_URL: "https://auth.example.com",
			OIDC_CLIENT_ID: "my-client-id",
			OIDC_CLIENT_SECRET: "my-client-secret",
			OIDC_REDIRECT_URI: "https://app.example.com/callback",
		});
		const missing = validateOidcConfig(parsed);
		expect(missing).toHaveLength(0);
	});

	it("should identify which specific OIDC settings are missing", () => {
		const parsed = EnvSchema.parse({
			OIDC_ENABLED: "true",
			OIDC_ISSUER_URL: "https://auth.example.com",
			OIDC_CLIENT_ID: "my-client-id",
			// OIDC_CLIENT_SECRET missing
			// OIDC_REDIRECT_URI missing
		});
		const missing = validateOidcConfig(parsed);
		expect(missing).toHaveLength(2);
		expect(missing).toContain("OIDC_CLIENT_SECRET");
		expect(missing).toContain("OIDC_REDIRECT_URI");
	});
});

describe("Full configuration scenarios", () => {
	it("should parse minimal config (auth disabled)", () => {
		const result = EnvSchema.parse({});
		expect(result.AUTH_ENABLED).toBe(false);
		expect(result.OIDC_ENABLED).toBe(false);
	});

	it("should parse full production config with auth enabled", () => {
		const env = {
			NODE_ENV: "production",
			PORT: "8080",
			CORS_ORIGINS: "https://myapp.com",
			LOG_LEVEL: "warn",
			AUTH_ENABLED: "true",
			REGISTRATION_ENABLED: "false",
			JWT_SECRET: "production-jwt-secret-key-12345",
			REFRESH_SECRET: "production-refresh-secret-key-12345",
			COOKIE_SECRET: "production-cookie-secret-key-12345",
			ACCESS_TOKEN_TTL_MINUTES: "30",
			REFRESH_TOKEN_TTL_DAYS: "14",
		};

		const result = EnvSchema.parse(env);

		expect(result.NODE_ENV).toBe("production");
		expect(result.PORT).toBe(8080);
		expect(result.CORS_ORIGINS).toBe("https://myapp.com");
		expect(result.LOG_LEVEL).toBe("warn");
		expect(result.AUTH_ENABLED).toBe(true);
		expect(result.REGISTRATION_ENABLED).toBe(false);
		expect(result.ACCESS_TOKEN_TTL_MINUTES).toBe(30);
		expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(14);

		// Should pass auth validation
		const missing = validateAuthSecrets(result);
		expect(missing).toHaveLength(0);
	});

	it("should parse config with OIDC SSO enabled", () => {
		const env = {
			AUTH_ENABLED: "true",
			JWT_SECRET: "production-jwt-secret-key-12345",
			REFRESH_SECRET: "production-refresh-secret-key-12345",
			COOKIE_SECRET: "production-cookie-secret-key-12345",
			OIDC_ENABLED: "true",
			OIDC_ISSUER_URL: "https://authelia.example.com",
			OIDC_CLIENT_ID: "medassist",
			OIDC_CLIENT_SECRET: "super-secret-oidc-secret",
			OIDC_REDIRECT_URI: "https://medassist.example.com/api/auth/oidc/callback",
			OIDC_SCOPES: "openid profile email groups",
			OIDC_USERNAME_CLAIM: "email",
			OIDC_PROVIDER_NAME: "Authelia",
		};

		const result = EnvSchema.parse(env);

		expect(result.OIDC_ENABLED).toBe(true);
		expect(result.OIDC_ISSUER_URL).toBe("https://authelia.example.com");
		expect(result.OIDC_SCOPES).toBe("openid profile email groups");
		expect(result.OIDC_USERNAME_CLAIM).toBe("email");
		expect(result.OIDC_PROVIDER_NAME).toBe("Authelia");

		// Should pass both validations
		expect(validateAuthSecrets(result)).toHaveLength(0);
		expect(validateOidcConfig(result)).toHaveLength(0);
	});

	it("should parse development config", () => {
		const env = {
			NODE_ENV: "development",
			PORT: "3000",
			LOG_LEVEL: "debug",
			AUTH_ENABLED: "false",
		};

		const result = EnvSchema.parse(env);

		expect(result.NODE_ENV).toBe("development");
		expect(result.LOG_LEVEL).toBe("debug");
		expect(result.AUTH_ENABLED).toBe(false);
	});
});
