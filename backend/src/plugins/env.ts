import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform((v) => parseInt(v, 10)).default("3000"),
  DATABASE_URL: z.string().default("file:./data/medassist-ng.db"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  LOG_LEVEL: z.string().default("info"),
  JWT_SECRET: z.string().min(10),
  REFRESH_SECRET: z.string().min(10),
  COOKIE_SECRET: z.string().min(10),
  ACCESS_TOKEN_TTL_MIN: z.string().default("15"),
  REFRESH_TOKEN_TTL_DAYS: z.string().default("14"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
