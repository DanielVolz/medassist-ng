import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { applyOpenApiRouteStandards } from "../utils/openapi-route-standards.js";

// Read version from package.json at startup
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const backendVersion = packageJson.version || "unknown";

export async function healthRoutes(app: FastifyInstance) {
	applyOpenApiRouteStandards(app, { tag: "health", protectedByDefault: false });

	// Exempt from rate limit + suppress request logs (called every 30s by Docker healthcheck)
	app.get(
		"/health",
		{
			config: { rateLimit: false },
			logLevel: "warn",
			schema: {
				response: {
					200: {
						type: "object",
						properties: {
							status: { type: "string", enum: ["ok"] },
							version: { type: "string" },
							smtpConfigured: { type: "boolean" },
						},
					},
				},
			},
		},
		async () => ({
			status: "ok",
			version: backendVersion,
			smtpConfigured: Boolean(process.env.SMTP_HOST),
		})
	);
}
