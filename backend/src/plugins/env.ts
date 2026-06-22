import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { EnvSchema, type ParsedEnv } from "./env-schema.js";

// Load .env: try cwd first, then parent dir (for local dev running from backend/)
const envPath = process.env.DOTENV_PATH || (existsSync(".env") ? ".env" : "../.env");
dotenv.config({ path: envPath });

export type Env = ParsedEnv & {
	OPENAPI_DOCS_ENABLED: boolean;
	DOCS_AUTH_REQUIRED: boolean;
	MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: boolean;
};

// Parse and validate
let parsed: ParsedEnv;
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

// Prevent accidental public production deployments without authentication.
if (parsed.NODE_ENV === "production" && !parsed.AUTH_ENABLED && !parsed.ALLOW_UNAUTHENTICATED) {
	console.error("=".repeat(60));
	console.error("AUTHENTICATION CONFIGURATION ERROR");
	console.error("=".repeat(60));
	console.error("Refusing to start MedAssist-ng in production with AUTH_ENABLED=false.");
	console.error(
		"MedAssist-ng handles health-related personal data, so production deployments must enable authentication."
	);
	console.error("");
	console.error("To fix this, either:");
	console.error("  1. Set AUTH_ENABLED=true and configure JWT_SECRET, REFRESH_SECRET, and COOKIE_SECRET.");
	console.error("  2. Enable OIDC with AUTH_ENABLED=true and OIDC_ENABLED=true.");
	console.error("  3. For local/private-only deployments, explicitly set ALLOW_UNAUTHENTICATED=true.");
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

function isStrongApiKeyPepperSource(value: string | undefined): boolean {
	return (value?.trim().length ?? 0) >= 32;
}

if (
	parsed.NODE_ENV === "production" &&
	parsed.AUTH_ENABLED &&
	!isStrongApiKeyPepperSource(parsed.API_KEY_PEPPER) &&
	!isStrongApiKeyPepperSource(parsed.JWT_SECRET) &&
	!isStrongApiKeyPepperSource(parsed.REFRESH_SECRET)
) {
	console.error("=".repeat(60));
	console.error("API KEY CONFIGURATION ERROR");
	console.error("=".repeat(60));
	console.error("Production API key hashing requires API_KEY_PEPPER or a strong JWT_SECRET/REFRESH_SECRET.");
	console.error("");
	console.error("To fix this, set API_KEY_PEPPER to a unique random value:");
	console.error("  openssl rand -hex 32");
	console.error("=".repeat(60));
	process.exit(1);
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

// Validate that at least one login method is available when auth is enabled
if (parsed.AUTH_ENABLED && !parsed.FORM_LOGIN_ENABLED && !parsed.OIDC_ENABLED) {
	console.error("=".repeat(60));
	console.error("AUTHENTICATION CONFIGURATION ERROR");
	console.error("=".repeat(60));
	console.error("AUTH_ENABLED=true but no login method is available.");
	console.error("FORM_LOGIN_ENABLED=false and OIDC_ENABLED=false means users cannot log in.");
	console.error("");
	console.error("To fix this, either:");
	console.error("  1. Set FORM_LOGIN_ENABLED=true to allow username/password login");
	console.error("  2. Set OIDC_ENABLED=true to allow SSO login");
	console.error("=".repeat(60));
	process.exit(1);
}

// Warn about ineffective registration when form login is disabled
if (parsed.REGISTRATION_ENABLED && !parsed.FORM_LOGIN_ENABLED) {
	console.warn(
		"[config] REGISTRATION_ENABLED=true has no effect when FORM_LOGIN_ENABLED=false (no registration form available)"
	);
}

export const env: Env = {
	...parsed,
	// Docs UI/spec are enabled in non-production by default.
	OPENAPI_DOCS_ENABLED: parsed.OPENAPI_DOCS_ENABLED ?? parsed.NODE_ENV !== "production",
	// Authenticated deployments protect docs by default when docs are enabled.
	DOCS_AUTH_REQUIRED: parsed.DOCS_AUTH_REQUIRED ?? parsed.AUTH_ENABLED,
	// Development starts should not depend on external EMA catalog availability.
	MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED:
		parsed.MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED ?? parsed.NODE_ENV === "production",
};
