import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { hashApiKeyToken, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

const createApiKeySchema = z.object({
	name: z.string().trim().min(3).max(100),
	scope: z.enum(["read", "write"]).default("write"),
	expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const idParamSchema = z.object({
	id: z.string().regex(/^\d+$/),
});

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];
const genericErrorSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		code: { type: "string" },
	},
};

const apiKeyMetadataSchema = {
	type: "object",
	properties: {
		id: { type: "number" },
		name: { type: "string" },
		tokenPrefix: { type: "string" },
		scope: { type: "string", enum: ["read", "write"] },
		isActive: { type: "boolean" },
		lastUsedAt: { type: ["string", "null"], format: "date-time" },
		expiresAt: { type: ["string", "null"], format: "date-time" },
		createdAt: { type: ["string", "null"], format: "date-time" },
		updatedAt: { type: ["string", "null"], format: "date-time" },
	},
};

function normalizeDateTime(value: unknown): string | null {
	if (value == null) {
		return null;
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}

	if (typeof value === "number") {
		const timestampMs = value < 1_000_000_000_000 ? value * 1000 : value;
		const date = new Date(timestampMs);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	if (typeof value === "string") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	return null;
}

function serializeApiKeyMetadata<
	T extends {
		id: number;
		name: string;
		tokenPrefix: string;
		scope: string;
		isActive: boolean;
		lastUsedAt: unknown;
		expiresAt: unknown;
		createdAt: unknown;
		updatedAt: unknown;
	},
>(key: T) {
	return {
		id: key.id,
		name: key.name,
		tokenPrefix: key.tokenPrefix,
		scope: key.scope,
		isActive: key.isActive,
		lastUsedAt: normalizeDateTime(key.lastUsedAt),
		expiresAt: normalizeDateTime(key.expiresAt),
		createdAt: normalizeDateTime(key.createdAt),
		updatedAt: normalizeDateTime(key.updatedAt),
	};
}

export async function apiKeyRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);

	app.get(
		"/auth/api-keys",
		{
			schema: {
				tags: ["api-keys"],
				summary: "List API keys for the current user",
				description: "Returns API key metadata. Raw API key tokens are never returned.",
				security: protectedEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							keys: {
								type: "array",
								items: apiKeyMetadataSchema,
							},
						},
					},
					400: genericErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			if (!env.AUTH_ENABLED) {
				return reply.status(400).send({ error: "API keys are unavailable when auth is disabled" });
			}

			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
			}

			const keys = await db
				.select({
					id: apiKeys.id,
					name: apiKeys.name,
					tokenPrefix: apiKeys.tokenPrefix,
					scope: apiKeys.scope,
					isActive: apiKeys.isActive,
					lastUsedAt: apiKeys.lastUsedAt,
					expiresAt: apiKeys.expiresAt,
					createdAt: apiKeys.createdAt,
					updatedAt: apiKeys.updatedAt,
				})
				.from(apiKeys)
				.where(eq(apiKeys.userId, authUser.id))
				.orderBy(desc(apiKeys.createdAt));

			return { keys: keys.map(serializeApiKeyMetadata) };
		}
	);

	app.post<{ Body: z.infer<typeof createApiKeySchema> }>(
		"/auth/api-keys",
		{
			schema: {
				tags: ["api-keys"],
				summary: "Create and rotate API key",
				description:
					"Creates a new API key and deactivates previously active API keys for the current user. The new token is returned only once.",
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string", minLength: 3, maxLength: 100 },
						scope: { type: "string", enum: ["read", "write"], default: "write" },
						expiresInDays: { type: "number", minimum: 1, maximum: 3650 },
					},
				},
				response: {
					201: {
						type: "object",
						properties: {
							key: apiKeyMetadataSchema,
							token: { type: "string" },
							note: { type: "string" },
						},
					},
					400: { anyOf: [genericErrorSchema, { type: "object" }] },
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			if (!env.AUTH_ENABLED) {
				return reply.status(400).send({ error: "API keys are unavailable when auth is disabled" });
			}

			const parsed = createApiKeySchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send(parsed.error.format());
			}

			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
			}

			const { name, scope, expiresInDays } = parsed.data;
			const rawToken = `ma_${randomBytes(32).toString("hex")}`;
			const tokenPrefix = `${rawToken.slice(0, 12)}...`;
			const keyHash = hashApiKeyToken(rawToken);
			const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

			// Keep a single active key per user: creating a new key invalidates old ones.
			await db
				.update(apiKeys)
				.set({ isActive: false, updatedAt: new Date() })
				.where(and(eq(apiKeys.userId, authUser.id), eq(apiKeys.isActive, true)));

			const [created] = await db
				.insert(apiKeys)
				.values({
					userId: authUser.id,
					name,
					keyHash,
					tokenPrefix,
					scope,
					expiresAt,
				})
				.returning({
					id: apiKeys.id,
					name: apiKeys.name,
					tokenPrefix: apiKeys.tokenPrefix,
					scope: apiKeys.scope,
					isActive: apiKeys.isActive,
					lastUsedAt: apiKeys.lastUsedAt,
					expiresAt: apiKeys.expiresAt,
					createdAt: apiKeys.createdAt,
					updatedAt: apiKeys.updatedAt,
				});

			return reply.status(201).send({
				key: serializeApiKeyMetadata(created),
				token: rawToken,
				note: "Store this token now. It cannot be retrieved again.",
			});
		}
	);

	app.delete<{ Params: { id: string } }>(
		"/auth/api-keys/:id",
		{
			schema: {
				tags: ["api-keys"],
				summary: "Deactivate API key",
				description: "Deactivates one API key belonging to the current user.",
				security: protectedEndpointSecurity,
				params: {
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "string", pattern: "^\\d+$" },
					},
				},
				response: {
					204: { type: "null" },
					400: { anyOf: [genericErrorSchema, { type: "object" }] },
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			if (!env.AUTH_ENABLED) {
				return reply.status(400).send({ error: "API keys are unavailable when auth is disabled" });
			}

			const parsedParams = idParamSchema.safeParse(request.params);
			if (!parsedParams.success) {
				return reply.status(400).send(parsedParams.error.format());
			}

			const authUser = request.user as unknown as AuthUser | null;
			if (!authUser) {
				return reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
			}

			const keyId = Number(parsedParams.data.id);
			const [existing] = await db
				.select({ id: apiKeys.id, userId: apiKeys.userId })
				.from(apiKeys)
				.where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, authUser.id)));
			if (!existing) {
				return reply.status(404).send({ error: "API key not found", code: "API_KEY_NOT_FOUND" });
			}

			await db
				.update(apiKeys)
				.set({ isActive: false, updatedAt: new Date() })
				.where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, authUser.id)));

			return reply.status(204).send();
		}
	);
}
