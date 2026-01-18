import { FastifyInstance } from "fastify";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Read version from package.json at startup
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const backendVersion = packageJson.version || "unknown";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    version: backendVersion,
    smtpConfigured: Boolean(process.env.SMTP_HOST),
    shoutrrrConfigured: Boolean(process.env.SHOUTRRR_URL),
  }));
}
