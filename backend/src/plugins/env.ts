import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

// Load .env: try cwd first, then parent dir (for local dev running from backend/)
const envPath = process.env.DOTENV_PATH || (existsSync(".env") ? ".env" : "../.env");
dotenv.config({ path: envPath });

const EnvSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	PORT: z
		.string()
		.transform((v) => parseInt(v, 10))
		.default("3000"),
	CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
	LOG_LEVEL: z.string().default("info"),

	// ==========================================================================
	// Auth Configuration
	// ==========================================================================
	// Master switch: Enable/disable authentication (default: disabled for easy setup)
	AUTH_ENABLED: z
		.string()
		.transform((v) => v === "true")
		.default("false"),
	// Allow new user registrations (auto-enabled if no users exist)
	REGISTRATION_ENABLED: z
		.string()
		.transform((v) => v === "true")
		.default("false"),
	// Disable local auth when using SSO only

	// JWT Secrets - only required when AUTH_ENABLED=true
	JWT_SECRET: z.string().min(10).optional(),
	REFRESH_SECRET: z.string().min(10).optional(),
	COOKIE_SECRET: z.string().min(10).optional(),

	// Token TTL settings
	ACCESS_TOKEN_TTL_MINUTES: z
		.string()
		.transform((v) => parseInt(v, 10))
		.default("15"),
	REFRESH_TOKEN_TTL_DAYS: z
		.string()
		.transform((v) => parseInt(v, 10))
		.default("7"),

	// ==========================================================================
	// OIDC SSO Configuration (Pocket ID, Authelia, etc.)
	// ==========================================================================
	OIDC_ENABLED: z
		.string()
		.transform((v) => v === "true")
		.default("false"),
	OIDC_ISSUER_URL: z.string().url().optional(), // e.g., https://auth.example.com
	OIDC_CLIENT_ID: z.string().optional(),
	OIDC_CLIENT_SECRET: z.string().optional(),
	OIDC_REDIRECT_URI: z.string().url().optional(), // e.g., https://medassist.example.com/api/auth/oidc/callback
	OIDC_SCOPES: z.string().default("openid profile email"),
	OIDC_AUTO_CREATE_USERS: z
		.string()
		.transform((v) => v === "true")
		.default("true"),
	OIDC_USERNAME_CLAIM: z.string().default("preferred_username"), // or 'email', 'sub'
	OIDC_PROVIDER_NAME: z.string().default("SSO"), // Display name for UI button
});

export type Env = z.infer<typeof EnvSchema>;

// Parse and validate
let parsed: z.infer<typeof EnvSchema>;
try {
	parsed = EnvSchema.parse(process.env);
} catch (err) {
	console.error("=".repeat(60));
	console.error("ENVIRONMENT CONFIGURATION ERROR");
	console.error("=".repeat(60));
	console.error(err);
	console.error("\nPlease check your .env file or environment variables.");
	console.error("=".repeat(60));
	process.exit(1);
}

// Validate that secrets are provided when auth is enabled
if (parsed.AUTH_ENABLED) {
	const missing: string[] = [];
	if (!parsed.JWT_SECRET) missing.push("JWT_SECRET");
	if (!parsed.REFRESH_SECRET) missing.push("REFRESH_SECRET");
	if (!parsed.COOKIE_SECRET) missing.push("COOKIE_SECRET");

	if (missing.length > 0) {
		console.error("=".repeat(60));
		console.error("AUTHENTICATION CONFIGURATION ERROR");
		console.error("=".repeat(60));
		console.error(`AUTH_ENABLED=true but missing required secrets: ${missing.join(", ")}`);
		console.error("");
		console.error("To fix this, either:");
		console.error("  1. Set these environment variables with secure random values:");
		console.error("     Generate with: openssl rand -hex 32");
		console.error("");
		console.error("  2. Or disable authentication by removing AUTH_ENABLED=true");
		console.error("=".repeat(60));
		process.exit(1);
	}
}

// Validate OIDC configuration when enabled
if (parsed.OIDC_ENABLED) {
	const missing: string[] = [];
	if (!parsed.OIDC_ISSUER_URL) missing.push("OIDC_ISSUER_URL");
	if (!parsed.OIDC_CLIENT_ID) missing.push("OIDC_CLIENT_ID");
	if (!parsed.OIDC_CLIENT_SECRET) missing.push("OIDC_CLIENT_SECRET");
	if (!parsed.OIDC_REDIRECT_URI) missing.push("OIDC_REDIRECT_URI");

	if (missing.length > 0) {
		console.error("=".repeat(60));
		console.error("OIDC CONFIGURATION ERROR");
		console.error("=".repeat(60));
		console.error(`OIDC_ENABLED=true but missing required settings: ${missing.join(", ")}`);
		console.error("");
		console.error("Required OIDC settings:");
		console.error("  OIDC_ISSUER_URL=https://your-oidc-provider.com");
		console.error("  OIDC_CLIENT_ID=your-client-id");
		console.error("  OIDC_CLIENT_SECRET=your-client-secret");
		console.error("  OIDC_REDIRECT_URI=https://your-app.com/api/auth/oidc/callback");
		console.error("=".repeat(60));
		process.exit(1);
	}
}

export const env = parsed;
