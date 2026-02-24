import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// Read version from package.json at startup
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const backendVersion = packageJson.version || "unknown";

export async function healthRoutes(app: FastifyInstance) {
	// Exempt from rate limit - lightweight health check
	app.get("/health", { config: { rateLimit: false } }, async () => ({
		status: "ok",
		version: backendVersion,
	}));
}
