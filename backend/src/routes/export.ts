import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getDataDir } from "../db/path-utils.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { exportUserData } from "../services/export-service.js";
import {
	collectImportValidationIssues,
	createImportImageFiles,
	ImportValidationError,
	importValidatedData,
	parseImportData,
	previewImportData,
} from "../services/import-service.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";

const IMAGES_DIR = resolve(getDataDir(), "images");
const importImageFiles = createImportImageFiles(IMAGES_DIR);

const exportQuerystringSchema = {
	type: "object",
	properties: {
		includeSensitive: { type: "string", enum: ["true", "false"] },
		includeImages: { type: "string", enum: ["true", "false"] },
	},
} as const;

const exportResponseSchema = {
	type: "object",
	properties: {
		version: { type: "string" },
		exportedAt: { type: "string", format: "date-time" },
		includeSensitiveData: { type: "boolean" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		doseHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		asNeededIntakes: { type: "array", items: { type: "object", additionalProperties: true } },
		refillHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		settings: { type: "object", additionalProperties: true },
		shareLinks: { type: "array", items: { type: "object", additionalProperties: true } },
	},
} as const;

const importBodyOpenApiSchema = {
	type: "object",
	required: ["version", "exportedAt"],
	// Preserve unknown fields for Zod to reject, rather than silently stripping them.
	additionalProperties: true,
	properties: {
		version: { type: "string" },
		exportedAt: { type: "string", format: "date-time" },
		includeSensitiveData: { type: "boolean" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		doseHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		asNeededIntakes: { type: "array", items: { type: "object", additionalProperties: true } },
		refillHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		settings: { type: "object", additionalProperties: true },
		shareLinks: { type: "array", items: { type: "object", additionalProperties: true } },
	},
	example: {
		version: "1.9",
		exportedAt: "2026-03-11T10:15:00.000Z",
		includeSensitiveData: true,
		medications: [
			{
				name: "Ibuprofen 400",
				packageType: "box",
				packCount: 1,
				looseTablets: 8,
				intakes: [
					{
						usage: 1,
						every: 8,
						start: "2026-03-11T08:00:00.000Z",
						takenBy: "Daniel",
						remind: true,
					},
				],
			},
		],
		doseHistory: [
			{
				medicationRef: "med-1",
				scheduleIndex: 0,
				scheduledTime: "2026-03-11T08:00:00.000Z",
				takenAt: "2026-03-11T08:03:00.000Z",
				markedBy: "Daniel",
				takenSource: "manual",
				dismissed: false,
				takenByPerson: "Daniel",
				journalNote: "Took after breakfast.",
				journalMood: "good",
				journalUpdatedAt: "2026-03-11T08:05:00.000Z",
			},
		],
		asNeededIntakes: [],
		refillHistory: [{ packsAdded: 1, loosePillsAdded: 4, quantityAdded: 34, refillDate: "2026-03-10T12:00:00.000Z" }],
		settings: { language: "en-US", stockCalculationMode: "automatic" },
		shareLinks: [{ takenBy: "Daniel", scheduleDays: 14 }],
	},
} as const;

const importPreviewResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
		preview: {
			type: "object",
			properties: {
				version: { type: "string" },
				exportedAt: { type: "string", format: "date-time" },
				includeSensitiveData: { type: "boolean" },
				incoming: {
					type: "object",
					properties: {
						medications: { type: "integer" },
						doseHistory: { type: "integer" },
						asNeededIntakes: { type: "integer" },
						refillHistory: { type: "integer" },
						shareLinks: { type: "integer" },
						journalEntries: { type: "integer" },
						imageCount: { type: "integer" },
						hasSettings: { type: "boolean" },
					},
				},
				current: {
					type: "object",
					properties: {
						medications: { type: "integer" },
						doseHistory: { type: "integer" },
						asNeededIntakes: { type: "integer" },
						refillHistory: { type: "integer" },
						shareLinks: { type: "integer" },
						hasSettings: { type: "boolean" },
					},
				},
				warnings: {
					type: "object",
					properties: {
						replacesExistingData: { type: "boolean" },
						regeneratesShareLinks: { type: "boolean" },
						containsImages: { type: "boolean" },
						containsSensitiveData: { type: "boolean" },
					},
				},
			},
		},
	},
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to get user ID from request
async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
	if (!env.AUTH_ENABLED) {
		return getAnonymousUserId();
	}

	const authUser = request.user as unknown as AuthUser | null;
	if (!authUser) {
		reply.status(401).send({ error: "Not authenticated" });
		throw new Error("AUTH_REQUIRED");
	}
	return authUser.id;
}

// =============================================================================
// Export Routes
// =============================================================================
export async function exportRoutes(app: FastifyInstance) {
	// All export routes require auth
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "export", protectedByDefault: true });

	// ---------------------------------------------------------------------------
	// GET /export - Export all user data
	// ---------------------------------------------------------------------------
	app.get<{ Querystring: { includeSensitive?: string; includeImages?: string } }>(
		"/export",
		{
			schema: {
				querystring: exportQuerystringSchema,
				response: {
					200: exportResponseSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const includeSensitive = request.query.includeSensitive === "true";
			const includeImages = request.query.includeImages !== "false"; // Default to true

			const exportData = await exportUserData(userId, { includeSensitive, includeImages }, IMAGES_DIR);

			// Set download headers
			const now = new Date();
			const dateStr = now.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 13);
			const authUser = env.AUTH_ENABLED ? (request.user as unknown as AuthUser | null) : null;
			const userPart = authUser?.username ? `-${authUser.username}` : "";
			const filename = `medassist-export${userPart}-${dateStr}.json`;
			reply.header("Content-Type", "application/json");
			reply.header("Content-Disposition", `attachment; filename="${filename}"`);

			return exportData;
		}
	);

	// ---------------------------------------------------------------------------
	// POST /import/preview - Validate and summarize import data without writing
	// ---------------------------------------------------------------------------
	app.post(
		"/import/preview",
		{
			config: {
				rawBody: true,
			},
			bodyLimit: 50 * 1024 * 1024,
			schema: {
				body: importBodyOpenApiSchema,
				response: {
					200: importPreviewResponseSchema,
					400: validationErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = parseImportData(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: parsed.issues },
				});
			}

			const validationIssues = await collectImportValidationIssues(parsed.data);
			if (validationIssues.length > 0) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: validationIssues },
				});
			}

			return {
				success: true,
				preview: await previewImportData(userId, parsed.data),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// POST /import - Import user data (replaces all existing data!)
	// ---------------------------------------------------------------------------
	app.post(
		"/import",
		{
			config: {
				// Increase body limit to 50MB to handle exports with base64 images
				rawBody: true,
			},
			bodyLimit: 50 * 1024 * 1024, // 50 MB
			schema: {
				body: importBodyOpenApiSchema,
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							imported: {
								type: "object",
								properties: {
									medications: { type: "integer" },
									doseHistory: { type: "integer" },
									asNeededIntakes: { type: "integer" },
									refillHistory: { type: "integer" },
									settings: { type: "integer" },
									shareLinks: { type: "integer" },
								},
							},
						},
					},
					400: validationErrorSchema,
					401: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// 1. Parse and validate import data
			const parsed = parseImportData(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: parsed.issues },
				});
			}

			const importData = parsed.data;
			const validationIssues = await collectImportValidationIssues(importData);
			if (validationIssues.length > 0) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: validationIssues },
				});
			}
			try {
				const imported = await importValidatedData(userId, importData, importImageFiles, request.log);
				return { success: true, imported };
			} catch (error) {
				if (error instanceof ImportValidationError) {
					return reply.status(400).send({
						error: "Invalid import data format",
						code: "INVALID_IMPORT_DATA",
						details: { _errors: [error.message] },
					});
				}

				request.log.error({ err: error }, "[Import] Failed to import data");
				return reply.status(500).send({ error: "Import failed" });
			}
		}
	);
}
