import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "./auth.js";

export interface ApiDocsOptions {
	enabled: boolean;
	authRequired: boolean;
}

function isDocsPath(url: string | undefined): boolean {
	const pathname = url?.split("?")[0] ?? "";
	return pathname === "/docs" || pathname.startsWith("/docs/");
}

async function requireDocsAuth(request: FastifyRequest, reply: FastifyReply) {
	if (!isDocsPath(request.raw.url)) return;
	await requireAuth(request, reply);
}

export async function registerApiDocs(app: FastifyInstance, options: ApiDocsOptions) {
	if (!options.enabled) return;

	if (options.authRequired) {
		app.addHook("preHandler", requireDocsAuth);
	}

	await app.register(fastifySwagger, {
		openapi: {
			openapi: "3.0.3",
			info: {
				title: "MedAssist-ng API",
				description: "MedAssist-ng backend API",
				version: process.env.npm_package_version ?? "dev",
			},
			servers: [{ url: "/", description: "Current server" }],
			tags: [
				{ name: "health", description: "Service health endpoints" },
				{ name: "auth", description: "Authentication and profile endpoints" },
				{ name: "api-keys", description: "Programmatic API key management" },
				{ name: "intake-journal", description: "Owner-only intake journal CRUD and history endpoints" },
				{ name: "medication-enrichment", description: "Medication search and enrichment endpoints" },
				{ name: "settings", description: "User settings and notification test endpoints" },
			],
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "http",
						scheme: "bearer",
						bearerFormat: "API key or JWT",
						description: "Use Authorization: Bearer ma_... (API key) or a JWT token.",
					},
					cookieAuth: {
						type: "apiKey",
						in: "cookie",
						name: "access_token",
						description: "Session cookie set by login.",
					},
				},
			},
		},
		hideUntagged: false,
	});

	await app.register(fastifySwaggerUi, {
		routePrefix: "/docs",
		staticCSP: true,
		transformSpecificationClone: true,
		uiConfig: {
			docExpansion: "list",
			deepLinking: false,
		},
	});
}
