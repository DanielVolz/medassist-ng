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

export const env = parsed;
