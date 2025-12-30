import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// Mock process.exit to prevent tests from exiting
const mockExit = vi.fn();
vi.spyOn(process, "exit").mockImplementation(mockExit as any);

// Re-create the schema from env.ts for testing
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.string().transform((v) => parseInt(v, 10)).default("3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  LOG_LEVEL: z.string().default("info"),
  AUTH_ENABLED: z.string().transform((v) => v === "true").default("false"),
  REGISTRATION_ENABLED: z.string().transform((v) => v === "true").default("false"),
  JWT_SECRET: z.string().min(10).optional(),
  REFRESH_SECRET: z.string().min(10).optional(),
  COOKIE_SECRET: z.string().min(10).optional(),
  ACCESS_TOKEN_TTL_MINUTES: z.string().transform((v) => parseInt(v, 10)).default("15"),
  REFRESH_TOKEN_TTL_DAYS: z.string().transform((v) => parseInt(v, 10)).default("7"),
  OIDC_ENABLED: z.string().transform((v) => v === "true").default("false"),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().default("openid profile email"),
  OIDC_AUTO_CREATE_USERS: z.string().transform((v) => v === "true").default("true"),
  OIDC_USERNAME_CLAIM: z.string().default("preferred_username"),
  OIDC_PROVIDER_NAME: z.string().default("SSO"),
});

// Validation functions from env.ts
function validateAuthSecrets(parsed: z.infer<typeof EnvSchema>): string[] {
  const missing: string[] = [];
  if (parsed.AUTH_ENABLED) {
    if (!parsed.JWT_SECRET) missing.push("JWT_SECRET");
    if (!parsed.REFRESH_SECRET) missing.push("REFRESH_SECRET");
    if (!parsed.COOKIE_SECRET) missing.push("COOKIE_SECRET");
  }
  return missing;
}

function validateOidcConfig(parsed: z.infer<typeof EnvSchema>): string[] {
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
      expect(result.CORS_ORIGINS).toBe("http://localhost:5173,http://localhost:4173");
      expect(result.LOG_LEVEL).toBe("info");
      expect(result.AUTH_ENABLED).toBe(false);
      expect(result.REGISTRATION_ENABLED).toBe(false);
      expect(result.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
      expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(7);
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
    it("should transform AUTH_ENABLED=true to boolean true", () => {
      const result = EnvSchema.parse({ AUTH_ENABLED: "true" });
      expect(result.AUTH_ENABLED).toBe(true);
    });

    it("should transform AUTH_ENABLED=false to boolean false", () => {
      const result = EnvSchema.parse({ AUTH_ENABLED: "false" });
      expect(result.AUTH_ENABLED).toBe(false);
    });

    it("should treat non-true string as false", () => {
      const result = EnvSchema.parse({ AUTH_ENABLED: "yes" });
      expect(result.AUTH_ENABLED).toBe(false);
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

    it("should transform REFRESH_TOKEN_TTL_DAYS to number", () => {
      const result = EnvSchema.parse({ REFRESH_TOKEN_TTL_DAYS: "14" });
      expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(14);
    });
  });

  describe("OIDC URL validation", () => {
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
