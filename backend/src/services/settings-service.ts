import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";
import type { Language } from "../i18n/translations.js";
import { parseBoolEnv, parseIntEnv } from "../utils/env-parsing.js";
import { isNtfyNotificationUrl } from "./notifications/action-renderer.js";

export type UserSettings = {
	userId: number;
	timezone?: string | null;
	emailEnabled: boolean;
	notificationEmail: string | null;
	emailStockReminders: boolean;
	emailIntakeReminders: boolean;
	emailPrescriptionReminders: boolean;
	shoutrrrEnabled: boolean;
	shoutrrrUrl: string | null;
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
	shoutrrrPrescriptionReminders: boolean;
	reminderDaysBefore: number;
	repeatDailyReminders: boolean;
	skipRemindersForTakenDoses: boolean;
	repeatRemindersEnabled: boolean;
	reminderRepeatIntervalMinutes: number;
	maxNaggingReminders: number;
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
	language: Language;
	stockCalculationMode: "automatic" | "manual";
	shareMedicationOverview: boolean;
	upcomingTodayOnly: boolean;
	shareScheduleTodayOnly: boolean;
	swapDashboardMainSections: boolean;
	lastAutoEmailSent: string | null;
	lastNotificationType: string | null;
	lastNotificationChannel: string | null;
	lastReminderMedName: string | null;
	lastReminderTakenBy: string | null;
	lastStockReminderSent: string | null;
	lastStockReminderChannel: string | null;
	lastStockReminderMedNames: string | null;
	lastPrescriptionReminderSent: string | null;
	lastPrescriptionReminderChannel: string | null;
	lastPrescriptionReminderMedNames: string | null;
};

export function classifyTestEmailFailure(error: unknown): { status: number; code: string; message: string } {
	const errorMessage = error instanceof Error ? error.message : "Unknown error";
	const normalizedMessage = errorMessage.toLowerCase();

	if (
		normalizedMessage.includes("smtp rejected all recipients") ||
		normalizedMessage.includes("all recipients were rejected") ||
		normalizedMessage.includes("recipient address rejected") ||
		normalizedMessage.includes("nullmx")
	) {
		return {
			status: 400,
			code: "EMAIL_RECIPIENT_REJECTED",
			message: `Failed to send email: ${errorMessage}`,
		};
	}

	if (errorMessage.includes("SMTP did not confirm accepted recipients")) {
		return {
			status: 502,
			code: "SMTP_DELIVERY_UNCONFIRMED",
			message: `Failed to send email: ${errorMessage}`,
		};
	}

	return {
		status: 500,
		code: "TEST_EMAIL_FAILED",
		message: `Failed to send email: ${errorMessage}`,
	};
}

export function getNotificationProvider(url: string): string {
	if (url.startsWith("discord://")) return "discord";
	if (url.startsWith("telegram://")) return "telegram";
	if (url.startsWith("gotify://")) return "gotify";
	if (url.startsWith("pushover://")) return "pushover";
	if (isNtfyNotificationUrl(url)) return "ntfy";

	try {
		const parsed = new URL(url);
		return parsed.hostname || "https";
	} catch {
		return "unknown";
	}
}

function envBool(key: string, defaultVal: boolean): boolean {
	return parseBoolEnv(process.env[key], defaultVal);
}

function envInt(key: string, defaultVal: number): number {
	return parseIntEnv(process.env[key], { defaultValue: defaultVal, min: 0, max: 100_000 });
}

export function getDefaultSettings() {
	return {
		timezone: "",
		emailEnabled: envBool("DEFAULT_EMAIL_ENABLED", false),
		notificationEmail: process.env.DEFAULT_NOTIFICATION_EMAIL || null,
		emailStockReminders: envBool("DEFAULT_EMAIL_STOCK_REMINDERS", true),
		emailIntakeReminders: envBool("DEFAULT_EMAIL_INTAKE_REMINDERS", true),
		emailPrescriptionReminders: envBool("DEFAULT_EMAIL_PRESCRIPTION_REMINDERS", true),
		shoutrrrEnabled: envBool("DEFAULT_SHOUTRRR_ENABLED", false),
		shoutrrrUrl: process.env.DEFAULT_SHOUTRRR_URL || null,
		shoutrrrStockReminders: envBool("DEFAULT_SHOUTRRR_STOCK_REMINDERS", true),
		shoutrrrIntakeReminders: envBool("DEFAULT_SHOUTRRR_INTAKE_REMINDERS", true),
		shoutrrrPrescriptionReminders: envBool("DEFAULT_SHOUTRRR_PRESCRIPTION_REMINDERS", true),
		reminderDaysBefore: envInt("REMINDER_DAYS_BEFORE", 7),
		repeatDailyReminders: envBool("DEFAULT_REPEAT_DAILY_REMINDERS", false),
		skipRemindersForTakenDoses: envBool("DEFAULT_SKIP_REMINDERS_FOR_TAKEN_DOSES", false),
		repeatRemindersEnabled: envBool("DEFAULT_REPEAT_REMINDERS_ENABLED", false),
		reminderRepeatIntervalMinutes: envInt("DEFAULT_REMINDER_REPEAT_INTERVAL_MINUTES", 30),
		maxNaggingReminders: envInt("DEFAULT_MAX_NAGGING_REMINDERS", 5),
		lowStockDays: envInt("DEFAULT_LOW_STOCK_DAYS", 30),
		normalStockDays: envInt("DEFAULT_NORMAL_STOCK_DAYS", 90),
		highStockDays: envInt("DEFAULT_HIGH_STOCK_DAYS", 180),
		language: (process.env.DEFAULT_LANGUAGE as "en" | "de") || "en",
		stockCalculationMode: (process.env.DEFAULT_STOCK_CALCULATION_MODE as "automatic" | "manual") || "automatic",
		shareMedicationOverview: envBool("DEFAULT_SHARE_MEDICATION_OVERVIEW", false),
		upcomingTodayOnly: envBool("DEFAULT_UPCOMING_TODAY_ONLY", false),
		shareScheduleTodayOnly: envBool("DEFAULT_SHARE_SCHEDULE_TODAY_ONLY", false),
		swapDashboardMainSections: false,
		lastAutoEmailSent: null,
		lastNotificationType: null,
		lastNotificationChannel: null,
		lastReminderMedName: null,
		lastReminderTakenBy: null,
		lastStockReminderSent: null,
		lastStockReminderChannel: null,
		lastStockReminderMedNames: null,
		lastPrescriptionReminderSent: null,
		lastPrescriptionReminderChannel: null,
		lastPrescriptionReminderMedNames: null,
	};
}

type IntlWithSupportedValuesOf = typeof Intl & {
	supportedValuesOf?: (key: string) => string[];
};

let cachedTimezones: Set<string> | null = null;

function getTimezoneSet(): Set<string> {
	if (cachedTimezones) return cachedTimezones;
	const intlWithSupportedValues = Intl as IntlWithSupportedValuesOf;
	if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
		cachedTimezones = new Set(intlWithSupportedValues.supportedValuesOf("timeZone"));
		return cachedTimezones;
	}
	cachedTimezones = new Set([process.env.TZ || "UTC", "UTC"]);
	return cachedTimezones;
}

export function getAvailableTimezones(): string[] {
	return [...getTimezoneSet()].sort((left, right) => left.localeCompare(right));
}

export function normalizeSettingsTimezone(value: string | null | undefined): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";
	return getTimezoneSet().has(trimmed) ? trimmed : "";
}

const localhostNotificationUrlError = "Localhost URLs are not allowed";
const privateNotificationIpError = "Private IP addresses are not allowed";
const internalNotificationHostnameError = "Internal hostnames are not allowed";
const resolvedPrivateNotificationTargetError = "Notification target resolves to a private IP address";

function normalizeNotificationHostname(hostnameRaw: string): string {
	const trimmed = hostnameRaw.trim().toLowerCase().replace(/\.$/, "");
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseIpv4Address(hostname: string): [number, number, number, number] | null {
	const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!match) return null;

	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return null;
	}

	return octets as [number, number, number, number];
}

function getRestrictedIpv4AddressError(address: [number, number, number, number]): string | null {
	const [a, b] = address;

	if (a === 127) {
		return localhostNotificationUrlError;
	}

	if (
		a === 0 ||
		a === 10 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	) {
		return privateNotificationIpError;
	}

	return null;
}

function parseIpv4MappedIpv6(hostname: string): [number, number, number, number] | null {
	if (!hostname.startsWith("::ffff:")) return null;

	const mapped = hostname.slice("::ffff:".length);
	const dotted = parseIpv4Address(mapped);
	if (dotted) return dotted;

	const groups = mapped.split(":");
	if (groups.length !== 2) return null;

	const [high, low] = groups.map((group) => Number.parseInt(group, 16));
	if ([high, low].some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) {
		return null;
	}

	return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

function getRestrictedIpv6AddressError(hostname: string): string | null {
	if (hostname === "::" || hostname === "::1") {
		return localhostNotificationUrlError;
	}

	const mappedIpv4 = parseIpv4MappedIpv6(hostname);
	if (mappedIpv4) {
		return getRestrictedIpv4AddressError(mappedIpv4);
	}

	if (
		hostname.startsWith("fc") ||
		hostname.startsWith("fd") ||
		hostname.startsWith("fe8") ||
		hostname.startsWith("fe9") ||
		hostname.startsWith("fea") ||
		hostname.startsWith("feb") ||
		hostname.startsWith("ff")
	) {
		return privateNotificationIpError;
	}

	return null;
}

export function validateNotificationHostname(hostnameRaw: string): string | null {
	const hostname = normalizeNotificationHostname(hostnameRaw);

	if (!hostname) {
		return "Invalid notification hostname";
	}

	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return localhostNotificationUrlError;
	}

	const ipv4Address = parseIpv4Address(hostname);
	if (ipv4Address) {
		return getRestrictedIpv4AddressError(ipv4Address);
	}

	if (isIP(hostname) === 6) {
		return getRestrictedIpv6AddressError(hostname);
	}

	if (
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".lan") ||
		hostname === "metadata.google.internal"
	) {
		return internalNotificationHostnameError;
	}

	return null;
}

export async function validateNotificationTargetUrl(urlStr: string): Promise<string | null> {
	try {
		const parsed = new URL(urlStr);
		const hostnameError = validateNotificationHostname(parsed.hostname);
		if (hostnameError) {
			return hostnameError;
		}

		const hostname = normalizeNotificationHostname(parsed.hostname);
		if (isIP(hostname)) {
			return null;
		}

		const addresses = await lookup(hostname, { all: true, verbatim: true });
		for (const { address } of addresses) {
			if (validateNotificationHostname(address)) {
				return resolvedPrivateNotificationTargetError;
			}
		}

		return null;
	} catch {
		return null;
	}
}

export function sanitizeNotificationUrl(
	urlStr: string
): { url: string; isNtfy: boolean; auth?: { user: string; pass: string } } | { error: string } {
	try {
		if (urlStr.startsWith("discord://")) {
			const parsedDiscord = new URL(urlStr);
			const webhookId = parsedDiscord.hostname;
			const webhookToken = parsedDiscord.username;

			if (!webhookId || !webhookToken) {
				return { error: "Invalid Discord URL format" };
			}

			if (!/^\d+$/.test(webhookId)) {
				return { error: "Invalid Discord webhook ID" };
			}

			if (!/^[A-Za-z0-9._-]+$/.test(webhookToken)) {
				return { error: "Invalid Discord webhook token" };
			}

			const discordWebhookUrl = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
			return { url: discordWebhookUrl, isNtfy: false };
		}

		const isNtfy = isNtfyNotificationUrl(urlStr);
		const normalizedUrl = isNtfy ? urlStr.replace("ntfy://", "https://") : urlStr;
		const parsed = new URL(normalizedUrl);

		if (!["http:", "https:"].includes(parsed.protocol)) {
			return { error: "Only HTTP/HTTPS protocols are allowed" };
		}

		const hostValidationError = validateNotificationHostname(parsed.hostname);
		if (hostValidationError) {
			return { error: hostValidationError };
		}

		const reconstructedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
		const auth =
			isNtfy && parsed.username && parsed.password ? { user: parsed.username, pass: parsed.password } : undefined;

		return { url: reconstructedUrl, isNtfy, auth };
	} catch {
		return { error: "Invalid URL format" };
	}
}

async function getOrCreateUserSettings(userId: number) {
	let [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

	if (!settings) {
		[settings] = await db
			.insert(userSettings)
			.values({
				userId,
				...getDefaultSettings(),
			})
			.returning();
	}

	return settings;
}

export async function loadUserSettingsFromDb(userId: number): Promise<UserSettings> {
	const settings = await getOrCreateUserSettings(userId);
	return {
		userId: settings.userId,
		timezone: settings.timezone?.trim() ? settings.timezone : null,
		emailEnabled: settings.emailEnabled,
		notificationEmail: settings.notificationEmail,
		emailStockReminders: settings.emailStockReminders,
		emailIntakeReminders: settings.emailIntakeReminders,
		emailPrescriptionReminders: settings.emailPrescriptionReminders ?? true,
		shoutrrrEnabled: settings.shoutrrrEnabled,
		shoutrrrUrl: settings.shoutrrrUrl,
		shoutrrrStockReminders: settings.shoutrrrStockReminders,
		shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
		shoutrrrPrescriptionReminders: settings.shoutrrrPrescriptionReminders ?? true,
		reminderDaysBefore: settings.reminderDaysBefore,
		repeatDailyReminders: settings.repeatDailyReminders,
		skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses ?? false,
		repeatRemindersEnabled: settings.repeatRemindersEnabled ?? false,
		reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes ?? 30,
		maxNaggingReminders: settings.maxNaggingReminders ?? 5,
		lowStockDays: settings.lowStockDays,
		normalStockDays: settings.normalStockDays,
		highStockDays: settings.highStockDays,
		language: settings.language as Language,
		stockCalculationMode: (settings.stockCalculationMode as "automatic" | "manual") ?? "automatic",
		shareMedicationOverview: settings.shareMedicationOverview ?? false,
		upcomingTodayOnly: settings.upcomingTodayOnly ?? false,
		shareScheduleTodayOnly: settings.shareScheduleTodayOnly ?? false,
		swapDashboardMainSections: settings.swapDashboardMainSections ?? false,
		lastAutoEmailSent: settings.lastAutoEmailSent,
		lastNotificationType: settings.lastNotificationType,
		lastNotificationChannel: settings.lastNotificationChannel,
		lastReminderMedName: settings.lastReminderMedName ?? null,
		lastReminderTakenBy: settings.lastReminderTakenBy ?? null,
		lastStockReminderSent: settings.lastStockReminderSent ?? null,
		lastStockReminderChannel: settings.lastStockReminderChannel ?? null,
		lastStockReminderMedNames: settings.lastStockReminderMedNames ?? null,
		lastPrescriptionReminderSent: settings.lastPrescriptionReminderSent ?? null,
		lastPrescriptionReminderChannel: settings.lastPrescriptionReminderChannel ?? null,
		lastPrescriptionReminderMedNames: settings.lastPrescriptionReminderMedNames ?? null,
	};
}

export async function getAllUserSettingsFromDb(): Promise<UserSettings[]> {
	const allSettings = await db.select().from(userSettings);
	return allSettings.map((settings) => ({
		userId: settings.userId,
		timezone: settings.timezone?.trim() ? settings.timezone : null,
		emailEnabled: settings.emailEnabled,
		notificationEmail: settings.notificationEmail,
		emailStockReminders: settings.emailStockReminders,
		emailIntakeReminders: settings.emailIntakeReminders,
		emailPrescriptionReminders: settings.emailPrescriptionReminders ?? true,
		shoutrrrEnabled: settings.shoutrrrEnabled,
		shoutrrrUrl: settings.shoutrrrUrl,
		shoutrrrStockReminders: settings.shoutrrrStockReminders,
		shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
		shoutrrrPrescriptionReminders: settings.shoutrrrPrescriptionReminders ?? true,
		reminderDaysBefore: settings.reminderDaysBefore,
		repeatDailyReminders: settings.repeatDailyReminders,
		skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses ?? false,
		repeatRemindersEnabled: settings.repeatRemindersEnabled ?? false,
		reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes ?? 30,
		maxNaggingReminders: settings.maxNaggingReminders ?? 5,
		lowStockDays: settings.lowStockDays,
		normalStockDays: settings.normalStockDays,
		highStockDays: settings.highStockDays,
		language: settings.language as Language,
		stockCalculationMode: (settings.stockCalculationMode as "automatic" | "manual") ?? "automatic",
		shareMedicationOverview: settings.shareMedicationOverview ?? false,
		upcomingTodayOnly: settings.upcomingTodayOnly ?? false,
		shareScheduleTodayOnly: settings.shareScheduleTodayOnly ?? false,
		swapDashboardMainSections: settings.swapDashboardMainSections ?? false,
		lastAutoEmailSent: settings.lastAutoEmailSent,
		lastNotificationType: settings.lastNotificationType,
		lastNotificationChannel: settings.lastNotificationChannel,
		lastReminderMedName: settings.lastReminderMedName ?? null,
		lastReminderTakenBy: settings.lastReminderTakenBy ?? null,
		lastStockReminderSent: settings.lastStockReminderSent ?? null,
		lastStockReminderChannel: settings.lastStockReminderChannel ?? null,
		lastStockReminderMedNames: settings.lastStockReminderMedNames ?? null,
		lastPrescriptionReminderSent: settings.lastPrescriptionReminderSent ?? null,
		lastPrescriptionReminderChannel: settings.lastPrescriptionReminderChannel ?? null,
		lastPrescriptionReminderMedNames: settings.lastPrescriptionReminderMedNames ?? null,
	}));
}
