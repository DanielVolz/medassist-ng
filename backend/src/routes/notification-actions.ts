import formbody from "@fastify/formbody";
import { normalizeAppLanguage } from "@medassist/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { notificationActionGroups, notificationActionTokens, userSettings } from "../db/schema.js";
import { getTranslations, type Language } from "../i18n/translations.js";
import { getAsNeededAnchorDoseIds } from "../services/as-needed-intakes-service.js";
import { markDoseTakenForUser, skipDosesForUser } from "../services/dose-tracking-service.js";
import {
	getNotificationActionTokenRecord,
	isNotificationActionExpired,
} from "../services/notification-actions-service.js";
import { getNotificationActionLabels } from "../services/notifications/action-renderer.js";
import { sendPushNotification } from "../services/notifications/delivery.js";
import { sanitizeNotificationUrl, validateNotificationTargetUrl } from "../services/settings-service.js";
import { escapeHtml, toHtmlText } from "../utils/html.js";
import { applyOpenApiRouteStandards, genericErrorSchema } from "../utils/openapi-route-standards.js";

const querySchema = z.object({
	action: z.enum(["taken", "skip", "dismiss"]).optional(),
});

type NotificationMutationAction = "taken" | "skip";

function normalizeNotificationAction(action: string | null | undefined): NotificationMutationAction | null {
	if (action === "taken") {
		return "taken";
	}

	if (action === "skip" || action === "dismiss") {
		return "skip";
	}

	return null;
}

const publicNotificationActionMethods = "GET,HEAD,POST,OPTIONS";
const reminderFooterSeparator = "\n\n---\n";

function getLanguage(language: string | null): Language {
	return normalizeAppLanguage(language);
}

function wantsHtml(request: FastifyRequest): boolean {
	return request.headers.accept?.includes("text/html") ?? false;
}

function applyPublicNotificationCorsHeaders(
	request: FastifyRequest,
	reply: { header: (name: string, value: string) => unknown }
) {
	const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : "*";
	reply.header("access-control-allow-origin", requestOrigin);
	reply.header("access-control-allow-methods", publicNotificationActionMethods);
	reply.header("access-control-allow-headers", "content-type");
	if (requestOrigin !== "*") {
		reply.header("vary", "Origin");
	}
}

function getAlreadyProcessedText(language: Language, resolvedAction: NotificationMutationAction) {
	const copy = getTranslations(language).actionPage;
	if (resolvedAction === "taken") {
		return {
			bodyTitle: copy.alreadyProcessedTitle,
			bodyText: copy.alreadyTakenBody,
			jsonMessage: copy.alreadyTakenJson,
		};
	}

	return {
		bodyTitle: copy.alreadyProcessedTitle,
		bodyText: copy.alreadySkippedBody,
		jsonMessage: copy.alreadySkippedJson,
	};
}

function getActionRecordedText(language: Language, action: NotificationMutationAction) {
	const copy = getTranslations(language).actionPage;
	if (action === "taken") {
		return {
			bodyTitle: copy.actionRecordedTitle,
			bodyText: copy.doseTakenBody,
		};
	}

	return {
		bodyTitle: copy.actionRecordedTitle,
		bodyText: copy.intakeSkippedBody,
	};
}

function buildReplacementReminderMessage(
	language: Language,
	action: NotificationMutationAction,
	originalMessage: string
): string {
	const tr = getTranslations(language);
	const confirmationLine = action === "taken" ? tr.push.intakeTakenConfirmation : tr.push.intakeSkippedConfirmation;
	const separatorIndex = originalMessage.indexOf(reminderFooterSeparator);

	if (separatorIndex >= 0) {
		const beforeFooter = originalMessage.slice(0, separatorIndex).trimEnd();
		const footer = originalMessage.slice(separatorIndex);
		return `${beforeFooter}\n\n${confirmationLine}${footer}`;
	}

	return `${originalMessage.trimEnd()}\n\n${confirmationLine}`;
}

async function clearNtfyNotificationSequence(userId: number, sequenceId: string): Promise<void> {
	const [settings] = await db
		.select({ shoutrrrEnabled: userSettings.shoutrrrEnabled, shoutrrrUrl: userSettings.shoutrrrUrl })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	if (!settings?.shoutrrrEnabled || !settings.shoutrrrUrl) {
		return;
	}

	const sanitized = sanitizeNotificationUrl(settings.shoutrrrUrl);
	if ("error" in sanitized || !sanitized.isNtfy) {
		return;
	}

	const clearUrl = new URL(sanitized.url);
	clearUrl.pathname = `${clearUrl.pathname.replace(/\/+$/, "")}/${encodeURIComponent(sequenceId)}/clear`;
	const targetValidationError = await validateNotificationTargetUrl(clearUrl.toString(), {
		allowLocalNtfyTarget: sanitized.isNtfy,
	});
	if (targetValidationError) {
		throw new Error(targetValidationError);
	}

	const headers: Record<string, string> = {};
	if (sanitized.auth) {
		headers.Authorization = `Basic ${Buffer.from(`${sanitized.auth.user}:${sanitized.auth.pass}`).toString("base64")}`;
	}

	const response = await fetch(clearUrl.toString(), {
		method: "PUT",
		headers,
		redirect: "error",
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}
}

async function deleteNtfyNotificationSequence(userId: number, sequenceId: string): Promise<void> {
	const normalizedSequenceId = sequenceId.trim();
	if (normalizedSequenceId.length === 0) {
		return;
	}

	const [settings] = await db
		.select({ shoutrrrEnabled: userSettings.shoutrrrEnabled, shoutrrrUrl: userSettings.shoutrrrUrl })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	if (!settings?.shoutrrrEnabled || !settings.shoutrrrUrl) {
		return;
	}

	const sanitized = sanitizeNotificationUrl(settings.shoutrrrUrl);
	if ("error" in sanitized || !sanitized.isNtfy) {
		return;
	}

	const deleteUrl = new URL(sanitized.url);
	deleteUrl.pathname = `${deleteUrl.pathname.replace(/\/+$/, "")}/${encodeURIComponent(normalizedSequenceId)}`;
	const targetValidationError = await validateNotificationTargetUrl(deleteUrl.toString(), {
		allowLocalNtfyTarget: sanitized.isNtfy,
	});
	if (targetValidationError) {
		throw new Error(targetValidationError);
	}

	const headers: Record<string, string> = {};
	if (sanitized.auth) {
		headers.Authorization = `Basic ${Buffer.from(`${sanitized.auth.user}:${sanitized.auth.pass}`).toString("base64")}`;
	}

	const response = await fetch(deleteUrl.toString(), {
		method: "DELETE",
		headers,
		redirect: "error",
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}
}

async function replaceNtfyNotificationSequence(options: {
	userId: number;
	sequenceId: string;
	language: Language;
	title: string;
	originalMessage: string;
	action: NotificationMutationAction;
	viewUrl: string | null;
}): Promise<{ replaced: boolean; providerMessageId?: string }> {
	const normalizedSequenceId = options.sequenceId.trim();
	if (normalizedSequenceId.length === 0) {
		return { replaced: false };
	}

	const [settings] = await db
		.select({ shoutrrrEnabled: userSettings.shoutrrrEnabled, shoutrrrUrl: userSettings.shoutrrrUrl })
		.from(userSettings)
		.where(eq(userSettings.userId, options.userId));

	if (!settings?.shoutrrrEnabled || !settings.shoutrrrUrl) {
		return { replaced: false };
	}

	const sanitized = sanitizeNotificationUrl(settings.shoutrrrUrl);
	if ("error" in sanitized || !sanitized.isNtfy) {
		return { replaced: false };
	}

	const labels = getNotificationActionLabels(options.language);
	const replacementMessage = buildReplacementReminderMessage(options.language, options.action, options.originalMessage);
	const result = await sendPushNotification(settings.shoutrrrUrl, options.title, replacementMessage, {
		language: options.language,
		actions: options.viewUrl ? [{ kind: "view", label: labels.view, url: options.viewUrl, method: "GET" }] : undefined,
		viewUrl: options.viewUrl ?? undefined,
		clickUrl: options.viewUrl ?? undefined,
		sequenceId: normalizedSequenceId,
		tags: ["pill"],
	});

	if (!result.success) {
		throw new Error(result.error ?? "Failed to replace ntfy notification");
	}

	return { replaced: true, providerMessageId: result.providerMessageId };
}

function renderPage(options: {
	language: Language;
	title: string;
	message: string;
	bodyTitle: string;
	bodyText: string;
	viewUrl: string | null;
	actionButtons: Array<{ label: string; formAction?: string }>;
}): string {
	const labels = getNotificationActionLabels(options.language);
	const forms =
		options.actionButtons.length > 0
			? `<div class="actions">${options.actionButtons
					.map((button) => {
						const formAction = button.formAction ? ` action="${escapeHtml(button.formAction)}"` : "";
						return `<form method="POST"${formAction}><button type="submit">${escapeHtml(button.label)}</button></form>`;
					})
					.join("")}</div>`
			: "";
	const viewLink = options.viewUrl
		? `<p><a href="${escapeHtml(options.viewUrl)}">${escapeHtml(labels.view)}</a></p>`
		: "";

	return `<!DOCTYPE html>
<html lang="${options.language}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.bodyTitle)}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f4f5f7; color: #1f2937; }
      main { max-width: 640px; margin: 48px auto; background: white; border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.5rem; }
      .card { padding: 16px; border-radius: 12px; background: #f9fafb; margin: 16px 0 24px; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; }
      form { margin: 0; }
      button, a { display: inline-flex; align-items: center; justify-content: center; min-width: 140px; border-radius: 10px; padding: 12px 16px; font: inherit; text-decoration: none; }
      button { border: none; background: #0f766e; color: white; cursor: pointer; }
      form:last-of-type button { background: #475569; }
      a { background: #e2e8f0; color: #0f172a; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(options.bodyTitle)}</h1>
      <p>${escapeHtml(options.bodyText)}</p>
      <div class="card">
        <strong>${escapeHtml(options.title)}</strong>
        <p>${toHtmlText(options.message)}</p>
      </div>
      ${forms}
      ${viewLink}
    </main>
  </body>
</html>`;
}

function parseRequestedAction(request: FastifyRequest, tokenKind: string): NotificationMutationAction | null {
	const normalizedTokenAction = normalizeNotificationAction(tokenKind);
	if (normalizedTokenAction) {
		return normalizedTokenAction;
	}

	const parsedQuery = querySchema.safeParse(request.query);
	if (parsedQuery.success && parsedQuery.data.action) {
		return normalizeNotificationAction(parsedQuery.data.action);
	}

	const body = request.body;
	if (body && typeof body === "object" && "action" in body) {
		const actionValue = (body as { action?: unknown }).action;
		if (typeof actionValue === "string") {
			return normalizeNotificationAction(actionValue);
		}
	}

	return null;
}

function buildNotificationActionLogContext(
	record: Awaited<ReturnType<typeof getNotificationActionTokenRecord>> extends infer T ? Exclude<T, null> : never,
	extra: Record<string, unknown> = {}
) {
	return {
		groupId: record.group.id,
		userId: record.group.userId,
		tokenKind: record.token.kind,
		doseCount: record.doseIds.length,
		hasViewUrl: record.viewUrl !== null,
		...extra,
	};
}

function buildNotificationRequestLogContext(request: FastifyRequest, extra: Record<string, unknown> = {}) {
	return {
		method: request.method,
		hasOrigin: typeof request.headers.origin === "string",
		expectsHtml: wantsHtml(request),
		...extra,
	};
}

export async function notificationActionRoutes(app: FastifyInstance) {
	await app.register(formbody);

	applyOpenApiRouteStandards(app, { tag: "notification-actions", protectedByDefault: false });

	app.options<{ Params: { token: string } }>("/notification-actions/:token", async (request, reply) => {
		applyPublicNotificationCorsHeaders(request, reply);
		return reply.status(204).send();
	});

	app.get<{ Params: { token: string } }>(
		"/notification-actions/:token",
		{
			config: {
				rateLimit: { max: 30, timeWindow: "1 minute" },
			},
			schema: {
				tags: ["notification-actions"],
				params: {
					type: "object",
					required: ["token"],
					properties: { token: { type: "string", minLength: 1 } },
				},
				response: {
					404: genericErrorSchema,
					405: genericErrorSchema,
					410: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			applyPublicNotificationCorsHeaders(request, reply);

			const record = await getNotificationActionTokenRecord(request.params.token);
			if (!record) {
				request.log.warn(
					buildNotificationRequestLogContext(request),
					"[NotificationActions] Unknown notification action token requested"
				);
				return reply.status(404).send({ error: "Notification action not found" });
			}

			if (isNotificationActionExpired(record)) {
				request.log.warn(
					buildNotificationActionLogContext(record),
					"[NotificationActions] Rejected expired notification action GET request"
				);
				return reply.status(410).send({ error: "Notification action has expired" });
			}

			if (record.token.kind !== "respond" && record.group.resolvedAction === null) {
				request.log.warn(
					buildNotificationActionLogContext(record),
					"[NotificationActions] Rejected direct GET for unresolved non-respond token"
				);
				return reply.status(405).send({ error: "Direct GET is only available for respond actions" });
			}

			const language = getLanguage(record.group.language ?? null);
			const labels = getNotificationActionLabels(language);
			const copy = getTranslations(language).actionPage;
			const resolvedAction = normalizeNotificationAction(record.group.resolvedAction);
			let bodyTitle: string;
			let bodyText: string;
			let actionButtons: Array<{ label: string; formAction?: string }> = [];

			if (resolvedAction) {
				({ bodyTitle, bodyText } = getAlreadyProcessedText(language, resolvedAction));
			} else {
				if (record.token.kind === "taken") {
					bodyTitle = copy.confirmDoseTitle;
					bodyText = copy.confirmDoseText;
					actionButtons = [{ label: labels.taken }];
				} else if (record.token.kind === "skip" || record.token.kind === "dismiss") {
					bodyTitle = copy.skipIntakeTitle;
					bodyText = copy.skipIntakeText;
					actionButtons = [{ label: labels.skip }];
				} else {
					bodyTitle = copy.respondTitle;
					bodyText = copy.respondText;
					actionButtons = [
						{ label: labels.taken, formAction: "?action=taken" },
						{ label: labels.skip, formAction: "?action=skip" },
					];
				}
			}

			return reply.type("text/html; charset=utf-8").send(
				renderPage({
					language,
					title: record.group.title,
					message: record.group.message,
					bodyTitle,
					bodyText,
					viewUrl: record.viewUrl,
					actionButtons: resolvedAction ? [] : actionButtons,
				})
			);
		}
	);

	app.post<{ Params: { token: string } }>(
		"/notification-actions/:token",
		{
			config: {
				rateLimit: { max: 30, timeWindow: "1 minute" },
			},
			schema: {
				tags: ["notification-actions"],
				params: {
					type: "object",
					required: ["token"],
					properties: { token: { type: "string", minLength: 1 } },
				},
				response: {
					400: genericErrorSchema,
					404: genericErrorSchema,
					409: genericErrorSchema,
					410: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			applyPublicNotificationCorsHeaders(request, reply);

			const record = await getNotificationActionTokenRecord(request.params.token);
			if (!record) {
				request.log.warn(
					buildNotificationRequestLogContext(request),
					"[NotificationActions] Unknown notification action token requested"
				);
				return reply.status(404).send({ error: "Notification action not found" });
			}

			if (isNotificationActionExpired(record)) {
				request.log.warn(
					buildNotificationActionLogContext(record),
					"[NotificationActions] Rejected expired notification action POST request"
				);
				return reply.status(410).send({ error: "Notification action has expired" });
			}

			const action = parseRequestedAction(request, record.token.kind);
			if (!action) {
				request.log.warn(
					buildNotificationActionLogContext(record),
					"[NotificationActions] Missing or invalid action for notification action POST request"
				);
				return reply.status(400).send({ error: "Notification action is required" });
			}

			const language = getLanguage(record.group.language ?? null);
			const resolvedAction = normalizeNotificationAction(record.group.resolvedAction);
			if (resolvedAction) {
				request.log.info(
					buildNotificationActionLogContext(record, { requestedAction: action, resolvedAction }),
					"[NotificationActions] Ignored notification action because it was already resolved"
				);
				const alreadyProcessedText = getAlreadyProcessedText(language, resolvedAction);

				if (wantsHtml(request)) {
					return reply.type("text/html; charset=utf-8").send(
						renderPage({
							language,
							title: record.group.title,
							message: record.group.message,
							bodyTitle: alreadyProcessedText.bodyTitle,
							bodyText: alreadyProcessedText.bodyText,
							viewUrl: record.viewUrl,
							actionButtons: [],
						})
					);
				}

				return reply.send({
					success: true,
					action: resolvedAction,
					alreadyProcessed: true,
					message: alreadyProcessedText.jsonMessage,
				});
			}

			if ((await getAsNeededAnchorDoseIds(db, record.group.userId, record.doseIds)).size > 0) {
				request.log.warn(
					buildNotificationActionLogContext(record, { requestedAction: action, code: "INVALID_DOSE" }),
					"[NotificationActions] Rejected invalid scheduled dose action"
				);
				return reply.status(400).send({ error: "Invalid dose ID", code: "INVALID_DOSE" });
			}

			if (action === "taken") {
				for (const [doseIndex, doseId] of record.doseIds.entries()) {
					const result = await markDoseTakenForUser({
						userId: record.group.userId,
						doseId,
						source: "notification",
						markedBy: null,
					});

					if (!result.success) {
						request.log.warn(
							buildNotificationActionLogContext(record, {
								requestedAction: action,
								failedDoseIndex: doseIndex,
								code: result.code,
							}),
							"[NotificationActions] Failed to record taken notification action"
						);
						const statusCode = result.code === "INVALID_DOSE" ? 400 : 409;
						return reply.status(statusCode).send({ error: result.message, code: result.code });
					}
				}
			} else {
				const result = await skipDosesForUser({ userId: record.group.userId, doseIds: record.doseIds });
				if (!result.success) {
					return reply.status(400).send({ error: result.message, code: result.code });
				}
			}

			await db
				.update(notificationActionGroups)
				.set({ resolvedAction: action, resolvedAt: new Date(), updatedAt: new Date() })
				.where(eq(notificationActionGroups.id, record.group.id));
			await db
				.update(notificationActionTokens)
				.set({ usedAt: new Date() })
				.where(eq(notificationActionTokens.id, record.token.id));

			request.log.info(
				buildNotificationActionLogContext(record, { requestedAction: action }),
				"[NotificationActions] Recorded notification action"
			);

			const recordedText = getActionRecordedText(language, action);
			let replacedNtfyNotification = false;
			const previousNtfyMessageId = record.group.ntfyOriginalMessageId.trim();

			try {
				const replacementResult = await replaceNtfyNotificationSequence({
					userId: record.group.userId,
					sequenceId: record.group.sequenceId,
					language,
					title: record.group.title,
					originalMessage: record.group.message,
					action,
					viewUrl: record.viewUrl,
				});
				replacedNtfyNotification = replacementResult.replaced;

				if (replacementResult.providerMessageId) {
					await db
						.update(notificationActionGroups)
						.set({ ntfyOriginalMessageId: replacementResult.providerMessageId, updatedAt: new Date() })
						.where(eq(notificationActionGroups.id, record.group.id));
				}

				if (
					replacementResult.replaced &&
					previousNtfyMessageId.length > 0 &&
					previousNtfyMessageId !== replacementResult.providerMessageId
				) {
					try {
						await deleteNtfyNotificationSequence(record.group.userId, previousNtfyMessageId);
					} catch (error) {
						request.log.warn(
							buildNotificationActionLogContext(record, {
								requestedAction: action,
								originalMessageId: previousNtfyMessageId,
								error,
							}),
							"[NotificationActions] Failed to delete original ntfy notification after replacement"
						);
					}
				}
			} catch (error) {
				request.log.warn(
					buildNotificationActionLogContext(record, { requestedAction: action, error }),
					"[NotificationActions] Failed to replace ntfy notification after resolved action"
				);
			}

			if (!replacedNtfyNotification) {
				try {
					await deleteNtfyNotificationSequence(record.group.userId, record.group.sequenceId);
				} catch (error) {
					request.log.warn(
						buildNotificationActionLogContext(record, { requestedAction: action, error }),
						"[NotificationActions] Failed to delete ntfy notification after resolved action"
					);
					try {
						await clearNtfyNotificationSequence(record.group.userId, record.group.sequenceId);
					} catch (clearError) {
						request.log.warn(
							buildNotificationActionLogContext(record, { requestedAction: action, error: clearError }),
							"[NotificationActions] Failed to clear ntfy notification after delete fallback"
						);
					}
				}
			}

			if (wantsHtml(request)) {
				return reply.type("text/html; charset=utf-8").send(
					renderPage({
						language,
						title: record.group.title,
						message: record.group.message,
						bodyTitle: recordedText.bodyTitle,
						bodyText: recordedText.bodyText,
						viewUrl: record.viewUrl,
						actionButtons: [],
					})
				);
			}

			return reply.send({ success: true, action });
		}
	);
}
