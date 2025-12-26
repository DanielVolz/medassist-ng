import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.string().transform((v) => parseInt(v, 10)).default("3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  LOG_LEVEL: z.string().default("info"),
  
  // ==========================================================================
  // Auth Configuration
  // ==========================================================================
  // Master switch: Enable/disable authentication (default: disabled for easy setup)
  AUTH_ENABLED: z.string().transform((v) => v === "true").default("false"),
  // Allow new user registrations (auto-enabled if no users exist)
  REGISTRATION_ENABLED: z.string().transform((v) => v === "true").default("false"),
  // Disable local auth when using SSO only (Phase 2)
  DISABLE_LOCAL_AUTH: z.string().transform((v) => v === "true").default("false"),
  
  // JWT Secrets - only required when AUTH_ENABLED=true
  JWT_SECRET: z.string().min(10).optional(),
  REFRESH_SECRET: z.string().min(10).optional(),
  COOKIE_SECRET: z.string().min(10).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// Parse and validate
const parsed = EnvSchema.parse(process.env);

// Validate that secrets are provided when auth is enabled
if (parsed.AUTH_ENABLED) {
  if (!parsed.JWT_SECRET || !parsed.REFRESH_SECRET || !parsed.COOKIE_SECRET) {
    throw new Error(
      "AUTH_ENABLED=true requires JWT_SECRET, REFRESH_SECRET, and COOKIE_SECRET to be set. " +
      "Generate them with: openssl rand -hex 32"
    );
  }
}

export const env = parsed;
