import { z } from "zod";
import { parseBoolEnv, parseIntEnv, parseStringListEnv } from "../utils/env-parsing.js";
import { DEFAULT_CORS_ORIGINS, DEFAULT_RATE_LIMIT_MAX } from "../utils/server-config.js";

function boolEnv(defaultValue: boolean) {
	return z
		.string()
		.optional()
		.transform((value) => parseBoolEnv(value, defaultValue));
}

function optionalBoolEnv() {
	return z
		.string()
		.optional()
		.transform((value) => (value === undefined ? undefined : parseBoolEnv(value, false)));
}

function intEnv(options: { defaultValue: number; min?: number; max?: number }) {
	return z
		.string()
		.optional()
		.transform((value) => parseIntEnv(value, options));
}

export const EnvSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	PORT: intEnv({ defaultValue: 3000, min: 1, max: 65535 }),
	CORS_ORIGINS: z
		.string()
		.optional()
		.transform((value) => parseStringListEnv(value ?? DEFAULT_CORS_ORIGINS).join(",")),
	LOG_LEVEL: z.string().default("info"),
	SENSITIVE_LOGGING_ENABLED: boolEnv(false),
	PUBLIC_APP_URL: z.string().url().optional(),
	OPENAPI_DOCS_ENABLED: optionalBoolEnv(),
	DOCS_AUTH_REQUIRED: optionalBoolEnv(),
	RATE_LIMIT_MAX: intEnv({ defaultValue: DEFAULT_RATE_LIMIT_MAX, min: 1, max: 100_000 }),
	AUTH_ENABLED: boolEnv(false),
	ALLOW_UNAUTHENTICATED: boolEnv(false),
	REGISTRATION_ENABLED: boolEnv(false),
	FORM_LOGIN_ENABLED: boolEnv(true),
	JWT_SECRET: z.string().min(10).optional(),
	REFRESH_SECRET: z.string().min(10).optional(),
	COOKIE_SECRET: z.string().min(10).optional(),
	ACCESS_TOKEN_TTL_MINUTES: intEnv({ defaultValue: 15, min: 1, max: 525_600 }),
	REFRESH_TOKEN_TTL_DAYS: intEnv({ defaultValue: 7, min: 1, max: 3650 }),
	API_KEY_PEPPER: z.string().min(32).optional(),
	API_KEY_LAST_USED_WRITE_INTERVAL_MINUTES: intEnv({ defaultValue: 15, min: 1, max: 1440 }),
	SHARE_TOKEN_TTL_DAYS: intEnv({ defaultValue: 90, min: 1, max: 3650 }),
	OIDC_ENABLED: boolEnv(false),
	OIDC_ISSUER_URL: z.string().url().optional(),
	OIDC_CLIENT_ID: z.string().optional(),
	OIDC_CLIENT_SECRET: z.string().optional(),
	OIDC_REDIRECT_URI: z.string().url().optional(),
	OIDC_SCOPES: z.string().default("openid profile email"),
	OIDC_AUTO_CREATE_USERS: boolEnv(true),
	OIDC_USERNAME_CLAIM: z.string().default("preferred_username"),
	OIDC_PROVIDER_NAME: z.string().default("SSO"),
});

export type ParsedEnv = z.infer<typeof EnvSchema>;
