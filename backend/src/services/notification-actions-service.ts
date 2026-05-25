import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { notificationActionGroups, notificationActionTokens } from "../db/schema.js";
import type { Language } from "../i18n/translations.js";
import { env } from "../plugins/env.js";
import { parseStringListEnv } from "../utils/env-parsing.js";
import { getNotificationActionLabels, type PushNotificationAction } from "./notifications/action-renderer.js";

export type NotificationActionKind = "taken" | "skip" | "respond" | "view";

type TokenKind = Exclude<NotificationActionKind, "view">;
type ActiveTokenKind = "taken" | "skip" | "respond";

export type NotificationActionContext = {
	groupId?: number;
	sequenceId?: string;
	respondUrl?: string;
	viewUrl: string;
	actions: PushNotificationAction[];
};

type NotificationActionMode = "full" | "view-only";

export type NotificationActionTokenRecord = {
	token: typeof notificationActionTokens.$inferSelect;
	group: typeof notificationActionGroups.$inferSelect;
	doseIds: string[];
	viewUrl: string | null;
};

const NOTIFICATION_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizePublicAppUrl(publicAppUrl: string): string {
	return publicAppUrl.replace(/\/+$/, "");
}

function parseConfiguredUrl(value: string | null | undefined): URL | null {
	const trimmedValue = value?.trim();
	if (!trimmedValue) {
		return null;
	}

	try {
		return new URL(trimmedValue);
	} catch {
		return null;
	}
}

function isLoopbackHostname(hostname: string): boolean {
	const normalizedHostname = hostname.toLowerCase();
	return normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1" || normalizedHostname === "::1";
}

function resolveNotificationPublicAppUrl(publicAppUrl: string | null | undefined): string | null {
	const configuredUrl = parseConfiguredUrl(publicAppUrl ?? env.PUBLIC_APP_URL);
	if (configuredUrl && !isLoopbackHostname(configuredUrl.hostname)) {
		return normalizePublicAppUrl(configuredUrl.toString());
	}

	const corsOrigins = parseStringListEnv(env.CORS_ORIGINS)
		.map((origin) => parseConfiguredUrl(origin))
		.filter((origin): origin is URL => origin !== null);
	const reachableCorsOrigin =
		corsOrigins.find((origin) => !isLoopbackHostname(origin.hostname)) ?? corsOrigins[0] ?? null;
	if (reachableCorsOrigin) {
		return normalizePublicAppUrl(reachableCorsOrigin.toString());
	}

	return configuredUrl ? normalizePublicAppUrl(configuredUrl.toString()) : null;
}

function getScheduledKey(scheduledFor: Date): string {
	return String(Math.floor(scheduledFor.getTime() / 60000));
}

function formatDateParam(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function buildViewUrl(baseUrl: string, scheduledFor: Date | null, doseIds: string[]): string {
	const params = new URLSearchParams();
	const primaryDoseId = doseIds[0];

	if (scheduledFor) {
		params.set("day", formatDateParam(scheduledFor));
	}

	if (primaryDoseId) {
		params.set("dose", primaryDoseId);
	}

	const queryString = params.toString();
	return queryString.length > 0 ? `${baseUrl}/dashboard?${queryString}` : `${baseUrl}/dashboard`;
}

function parseDoseIdsJson(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	} catch {
		return [];
	}
}

function createSequenceId(groupKey: string): string {
	return `medassist-${createHash("sha256").update(groupKey, "utf8").digest("hex").slice(0, 32)}`;
}

export function createActionToken(): string {
	return randomBytes(32).toString("hex");
}

export function hashActionToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

async function createTokenRow(groupId: number, kind: TokenKind): Promise<{ kind: TokenKind; token: string }> {
	const token = createActionToken();
	await db.insert(notificationActionTokens).values({
		groupId,
		tokenHash: hashActionToken(token),
		kind,
	});

	return { kind, token };
}

async function createActionTokens(groupId: number): Promise<Record<ActiveTokenKind, string>> {
	const createdTokens = await Promise.all([
		createTokenRow(groupId, "taken"),
		createTokenRow(groupId, "skip"),
		createTokenRow(groupId, "respond"),
	]);

	return createdTokens.reduce(
		(accumulator, entry) => {
			accumulator[entry.kind] = entry.token;
			return accumulator;
		},
		{ taken: "", skip: "", respond: "" } as Record<ActiveTokenKind, string>
	);
}

async function resetActionTokens(groupId: number): Promise<void> {
	await db.delete(notificationActionTokens).where(eq(notificationActionTokens.groupId, groupId));
}

export async function createNotificationActionContext(input: {
	userId: number;
	title: string;
	message: string;
	doseIds: string[];
	scheduledFor: Date;
	publicAppUrl?: string | null;
	language: Language;
	actionMode?: NotificationActionMode;
}): Promise<NotificationActionContext | null> {
	const publicAppUrl = resolveNotificationPublicAppUrl(input.publicAppUrl);
	if (!publicAppUrl) {
		return null;
	}

	const uniqueDoseIds = [...new Set(input.doseIds.filter((doseId) => doseId.trim().length > 0))].sort();
	if (uniqueDoseIds.length === 0) {
		return null;
	}

	const baseUrl = publicAppUrl;
	const actionMode = input.actionMode ?? "full";
	const labels = getNotificationActionLabels(input.language);
	const viewUrl = buildViewUrl(baseUrl, input.scheduledFor, uniqueDoseIds);

	if (actionMode === "view-only") {
		return {
			viewUrl,
			actions: [{ kind: "view", label: labels.view, url: viewUrl, method: "GET" }],
		};
	}

	const groupKey = `intake:${input.userId}:${uniqueDoseIds.join(",")}:${getScheduledKey(input.scheduledFor)}`;
	const sequenceId = createSequenceId(groupKey);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + NOTIFICATION_ACTION_TTL_MS);

	let [group] = await db
		.select()
		.from(notificationActionGroups)
		.where(
			and(
				eq(notificationActionGroups.groupKey, groupKey),
				isNull(notificationActionGroups.resolvedAction),
				gt(notificationActionGroups.expiresAt, now)
			)
		);

	if (!group) {
		const [existingGroup] = await db
			.select()
			.from(notificationActionGroups)
			.where(eq(notificationActionGroups.groupKey, groupKey));

		if (existingGroup) {
			await resetActionTokens(existingGroup.id);
			[group] = await db
				.update(notificationActionGroups)
				.set({
					sequenceId,
					ntfyOriginalMessageId: "",
					doseIdsJson: JSON.stringify(uniqueDoseIds),
					title: input.title,
					message: input.message,
					language: input.language,
					scheduledFor: input.scheduledFor,
					expiresAt,
					resolvedAction: null,
					resolvedAt: null,
					updatedAt: now,
				})
				.where(eq(notificationActionGroups.id, existingGroup.id))
				.returning();
		} else {
			[group] = await db
				.insert(notificationActionGroups)
				.values({
					userId: input.userId,
					groupKey,
					sequenceId,
					doseIdsJson: JSON.stringify(uniqueDoseIds),
					title: input.title,
					message: input.message,
					language: input.language,
					scheduledFor: input.scheduledFor,
					expiresAt,
					updatedAt: now,
				})
				.returning();
		}
	}

	const tokens = await createActionTokens(group.id);
	const groupLanguage = (group.language as Language | null) ?? input.language;
	const groupLabels = getNotificationActionLabels(groupLanguage);
	const respondUrl = `${baseUrl}/api/notification-actions/${tokens.respond}`;
	const resolvedViewUrl = buildViewUrl(baseUrl, group.scheduledFor ?? input.scheduledFor, uniqueDoseIds);

	return {
		groupId: group.id,
		sequenceId: group.sequenceId,
		respondUrl,
		viewUrl: resolvedViewUrl,
		actions: [
			{
				kind: "taken",
				label: groupLabels.taken,
				url: `${baseUrl}/api/notification-actions/${tokens.taken}`,
				method: "POST",
			},
			{
				kind: "skip",
				label: groupLabels.skip,
				url: `${baseUrl}/api/notification-actions/${tokens.skip}`,
				method: "POST",
			},
			{ kind: "view", label: groupLabels.view, url: resolvedViewUrl, method: "GET" },
		],
	};
}

export async function createTestNotificationActionContext(input: {
	userId: number;
	title: string;
	message: string;
	publicAppUrl?: string | null;
	language: Language;
}): Promise<NotificationActionContext | null> {
	const publicAppUrl = resolveNotificationPublicAppUrl(input.publicAppUrl);
	if (!publicAppUrl) {
		return null;
	}

	const baseUrl = publicAppUrl;
	const now = new Date();
	const groupKey = `test:${input.userId}:${now.getTime()}:${randomBytes(8).toString("hex")}`;
	const sequenceId = createSequenceId(groupKey);
	const expiresAt = new Date(now.getTime() + NOTIFICATION_ACTION_TTL_MS);
	const viewUrl = buildViewUrl(baseUrl, null, []);

	const [group] = await db
		.insert(notificationActionGroups)
		.values({
			userId: input.userId,
			groupKey,
			sequenceId,
			doseIdsJson: "[]",
			title: input.title,
			message: input.message,
			language: input.language,
			scheduledFor: now,
			expiresAt,
			updatedAt: now,
		})
		.returning();

	const tokens = await createActionTokens(group.id);
	const groupLanguage = (group.language as Language | null) ?? input.language;
	const groupLabels = getNotificationActionLabels(groupLanguage);
	const respondUrl = `${baseUrl}/api/notification-actions/${tokens.respond}`;

	return {
		groupId: group.id,
		sequenceId: group.sequenceId,
		respondUrl,
		viewUrl,
		actions: [
			{
				kind: "taken",
				label: groupLabels.taken,
				url: `${baseUrl}/api/notification-actions/${tokens.taken}`,
				method: "POST",
			},
			{
				kind: "skip",
				label: groupLabels.skip,
				url: `${baseUrl}/api/notification-actions/${tokens.skip}`,
				method: "POST",
			},
			{ kind: "view", label: groupLabels.view, url: viewUrl, method: "GET" },
		],
	};
}

export async function getNotificationActionTokenRecord(
	rawToken: string
): Promise<NotificationActionTokenRecord | null> {
	const tokenHash = hashActionToken(rawToken);
	const rows = await db
		.select({ token: notificationActionTokens, group: notificationActionGroups })
		.from(notificationActionTokens)
		.innerJoin(notificationActionGroups, eq(notificationActionTokens.groupId, notificationActionGroups.id))
		.where(eq(notificationActionTokens.tokenHash, tokenHash));

	const record = rows[0];
	if (!record) {
		return null;
	}

	const baseUrl = resolveNotificationPublicAppUrl(env.PUBLIC_APP_URL);
	return {
		token: record.token,
		group: record.group,
		doseIds: parseDoseIdsJson(record.group.doseIdsJson),
		viewUrl: baseUrl
			? buildViewUrl(baseUrl, record.group.scheduledFor, parseDoseIdsJson(record.group.doseIdsJson))
			: null,
	};
}

export function isNotificationActionExpired(record: NotificationActionTokenRecord): boolean {
	return record.group.expiresAt.getTime() <= Date.now();
}

export async function storeNotificationActionGroupNtfyMessageId(groupId: number, ntfyMessageId: string): Promise<void> {
	const normalizedMessageId = ntfyMessageId.trim();
	if (normalizedMessageId.length === 0) {
		return;
	}

	await db
		.update(notificationActionGroups)
		.set({ ntfyOriginalMessageId: normalizedMessageId, updatedAt: new Date() })
		.where(eq(notificationActionGroups.id, groupId));
}
