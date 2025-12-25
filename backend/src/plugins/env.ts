import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.string().transform((v) => parseInt(v, 10)).default("3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  LOG_LEVEL: z.string().default("info"),
  JWT_SECRET: z.string().min(10),
  REFRESH_SECRET: z.string().min(10),
  COOKIE_SECRET: z.string().min(10),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
