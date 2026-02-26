import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";
import type { Language } from "../i18n/translations.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

// Exported type for use in schedulers
export type UserSettings = {
	userId: number;
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
	shareStockStatus: boolean;
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

type SettingsBody = {
	emailEnabled: boolean;
	notificationEmail: string;
	reminderDaysBefore: number;
	repeatDailyReminders: boolean;
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
	shoutrrrEnabled: boolean;
	shoutrrrUrl: string;
	emailStockReminders: boolean;
	emailIntakeReminders: boolean;
	emailPrescriptionReminders: boolean;
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
	shoutrrrPrescriptionReminders: boolean;
	skipRemindersForTakenDoses: boolean;
	repeatRemindersEnabled: boolean;
	reminderRepeatIntervalMinutes: number;
	maxNaggingReminders: number;
	language: string;
	stockCalculationMode: "automatic" | "manual";
	shareStockStatus: boolean;
	upcomingTodayOnly: boolean;
	shareScheduleTodayOnly: boolean;
	swapDashboardMainSections: boolean;
};

type TestEmailBody = {
	email: string;
};

type TestShoutrrrBody = {
	url: string;
};

function getNotificationProvider(url: string): string {
	if (url.startsWith("discord://")) return "discord";
	if (url.startsWith("telegram://")) return "telegram";
	if (url.startsWith("gotify://")) return "gotify";
	if (url.startsWith("pushover://")) return "pushover";
	if (url.startsWith("ntfy://")) return "ntfy";

	try {
		const parsed = new URL(url);
		return parsed.hostname || "https";
	} catch {
		return "unknown";
	}
}

// Helper to parse boolean env vars
function envBool(key: string, defaultVal: boolean): boolean {
	const val = process.env[key];
	if (val === undefined) return defaultVal;
	return val === "true" || val === "1";
}

// Helper to parse integer env vars
function envInt(key: string, defaultVal: number): number {
	const val = process.env[key];
	if (val === undefined) return defaultVal;
	const parsed = parseInt(val, 10);
	return Number.isNaN(parsed) ? defaultVal : parsed;
}

// Default settings for new users - read from ENV with fallbacks
function getDefaultSettings() {
	return {
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
		shareStockStatus: envBool("DEFAULT_SHARE_STOCK_STATUS", true),
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

// Helper to get or create user settings
async function getOrCreateUserSettings(userId: number) {
	let [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

	if (!settings) {
		// Create default settings for user (using ENV defaults)
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

// Export for use in reminder scheduler
export async function loadUserSettings(userId: number): Promise<UserSettings> {
	const settings = await getOrCreateUserSettings(userId);
	return {
		userId: settings.userId,
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
		shareStockStatus: settings.shareStockStatus ?? true,
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

// Get all users with settings for scheduler
export async function getAllUserSettings(): Promise<UserSettings[]> {
	const allSettings = await db.select().from(userSettings);
	return allSettings.map((settings) => ({
		userId: settings.userId,
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
		shareStockStatus: settings.shareStockStatus ?? true,
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

export async function settingsRoutes(app: FastifyInstance) {
	// All settings routes require auth
	app.addHook("preHandler", requireAuth);

	// Helper to get user ID from request
	// Returns anonymous user ID when auth is disabled
	async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
		// If auth is disabled, use the anonymous user
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

	// Get settings for current user
	// Suppress request logs — polled every 30s for reminder status refresh
	app.get("/settings", { logLevel: "warn" }, async (request, reply) => {
		const userId = await getUserId(request, reply);

		const settings = await getOrCreateUserSettings(userId);

		return reply.send({
			// User notification settings (from DB)
			emailEnabled: settings.emailEnabled,
			notificationEmail: settings.notificationEmail ?? "",
			reminderDaysBefore: settings.reminderDaysBefore,
			repeatDailyReminders: settings.repeatDailyReminders,
			lowStockDays: settings.lowStockDays,
			normalStockDays: settings.normalStockDays,
			highStockDays: settings.highStockDays,
			shoutrrrEnabled: settings.shoutrrrEnabled,
			shoutrrrUrl: settings.shoutrrrUrl ?? "",
			emailStockReminders: settings.emailStockReminders,
			emailIntakeReminders: settings.emailIntakeReminders,
			emailPrescriptionReminders: settings.emailPrescriptionReminders ?? true,
			shoutrrrStockReminders: settings.shoutrrrStockReminders,
			shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
			shoutrrrPrescriptionReminders: settings.shoutrrrPrescriptionReminders ?? true,
			skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
			repeatRemindersEnabled: settings.repeatRemindersEnabled ?? false,
			reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes ?? 30,
			maxNaggingReminders: settings.maxNaggingReminders ?? 5,
			language: settings.language,
			stockCalculationMode: settings.stockCalculationMode ?? "automatic",
			shareStockStatus: settings.shareStockStatus ?? true,
			upcomingTodayOnly: settings.upcomingTodayOnly ?? false,
			shareScheduleTodayOnly: settings.shareScheduleTodayOnly ?? false,
			swapDashboardMainSections: settings.swapDashboardMainSections ?? false,
			// SMTP settings (from .env - shared/server-configured)
			smtpHost: process.env.SMTP_HOST ?? "",
			smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
			smtpUser: process.env.SMTP_USER ?? "",
			smtpFrom: process.env.SMTP_FROM ?? "",
			smtpSecure: process.env.SMTP_SECURE === "true",
			hasSmtpPassword: !!(process.env.SMTP_TOKEN || process.env.SMTP_PASS),
			// Reminder state for this user
			lastAutoEmailSent: settings.lastAutoEmailSent,
			lastNotificationType: settings.lastNotificationType,
			lastNotificationChannel: settings.lastNotificationChannel,
			lastReminderMedName: settings.lastReminderMedName ?? null,
			lastReminderTakenBy: settings.lastReminderTakenBy ?? null,
			// Stock reminder tracking (separate from intake)
			lastStockReminderSent: settings.lastStockReminderSent ?? null,
			lastStockReminderChannel: settings.lastStockReminderChannel ?? null,
			lastStockReminderMedNames: settings.lastStockReminderMedNames ?? null,
			// Prescription reminder tracking (separate from stock/intake)
			lastPrescriptionReminderSent: settings.lastPrescriptionReminderSent ?? null,
			lastPrescriptionReminderChannel: settings.lastPrescriptionReminderChannel ?? null,
			lastPrescriptionReminderMedNames: settings.lastPrescriptionReminderMedNames ?? null,
			// Server settings (from .env, read-only)
			expiryWarningDays: parseInt(process.env.EXPIRY_WARNING_DAYS ?? "30", 10),
		});
	});

	// Update settings for current user
	app.put<{ Body: SettingsBody }>("/settings", async (request, reply) => {
		const userId = await getUserId(request, reply);

		const body = request.body;

		// Check if any stock reminders are configured
		const hasEmailStock = body.emailEnabled && body.emailStockReminders && body.notificationEmail;
		const hasShoutrrrStock = body.shoutrrrEnabled && body.shoutrrrStockReminders && body.shoutrrrUrl;
		const hasAnyStockReminder = hasEmailStock || hasShoutrrrStock;

		// Disable repeatDailyReminders if no stock reminders are configured
		const repeatDailyReminders = hasAnyStockReminder ? (body.repeatDailyReminders ?? false) : false;

		// Update or insert user settings
		const existingSettings = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

		const settingsData = {
			emailEnabled: body.emailEnabled,
			notificationEmail: body.notificationEmail || null,
			emailStockReminders: body.emailStockReminders ?? true,
			emailIntakeReminders: body.emailIntakeReminders ?? true,
			emailPrescriptionReminders: body.emailPrescriptionReminders ?? true,
			shoutrrrEnabled: body.shoutrrrEnabled ?? false,
			shoutrrrUrl: body.shoutrrrUrl || null,
			shoutrrrStockReminders: body.shoutrrrStockReminders ?? true,
			shoutrrrIntakeReminders: body.shoutrrrIntakeReminders ?? true,
			shoutrrrPrescriptionReminders: body.shoutrrrPrescriptionReminders ?? true,
			reminderDaysBefore: body.reminderDaysBefore,
			repeatDailyReminders,
			skipRemindersForTakenDoses: body.skipRemindersForTakenDoses ?? false,
			repeatRemindersEnabled: body.repeatRemindersEnabled ?? false,
			reminderRepeatIntervalMinutes: body.reminderRepeatIntervalMinutes ?? 30,
			maxNaggingReminders: body.maxNaggingReminders ?? 5,
			lowStockDays: body.lowStockDays ?? 30,
			normalStockDays: body.normalStockDays ?? 90,
			highStockDays: body.highStockDays ?? 180,
			language: body.language ?? "en",
			stockCalculationMode: body.stockCalculationMode ?? "automatic",
			shareStockStatus: body.shareStockStatus ?? true,
			upcomingTodayOnly: body.upcomingTodayOnly ?? false,
			shareScheduleTodayOnly: body.shareScheduleTodayOnly ?? false,
			swapDashboardMainSections: body.swapDashboardMainSections ?? false,
			updatedAt: new Date(),
		};

		if (existingSettings.length > 0) {
			await db.update(userSettings).set(settingsData).where(eq(userSettings.userId, userId));
		} else {
			await db.insert(userSettings).values({
				userId: userId,
				...settingsData,
			});
		}

		return reply.send({ success: true });
	});

	// Update only the language setting (lightweight, called on dropdown change)
	app.put<{ Body: { language: string } }>("/settings/language", async (request, reply) => {
		const userId = await getUserId(request, reply);
		const { language } = request.body;

		if (!language || !["en", "de"].includes(language)) {
			return reply.status(400).send({ error: "Invalid language" });
		}

		const existingSettings = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

		if (existingSettings.length > 0) {
			await db.update(userSettings).set({ language, updatedAt: new Date() }).where(eq(userSettings.userId, userId));
		} else {
			await db.insert(userSettings).values({
				userId,
				...getDefaultSettings(),
				language,
			});
		}

		return reply.send({ success: true });
	});

	// Test email - use SMTP settings from process.env
	app.post<{ Body: TestEmailBody }>("/settings/test-email", async (request, reply) => {
		const { email } = request.body;

		const smtpHost = process.env.SMTP_HOST;
		const smtpUser = process.env.SMTP_USER;
		const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS;
		const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
		const smtpSecure = process.env.SMTP_SECURE === "true";
		const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

		if (!smtpHost || !smtpUser) {
			return reply.status(400).send({ error: "SMTP not configured" });
		}

		try {
			const transporter = nodemailer.createTransport({
				host: smtpHost,
				port: smtpPort,
				secure: smtpSecure,
				auth: {
					user: smtpUser,
					pass: smtpPass ?? "",
				},
			});

			await transporter.sendMail({
				from: smtpFrom,
				to: email,
				subject: "MedAssist-ng - Test Email",
				text: "This is a test email from MedAssist-ng. If you received this, your email configuration is working correctly!",
				html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">MedAssist-ng - Test Email</h2>
            <p>This is a test email from MedAssist-ng.</p>
            <p style="color: #10b981; font-weight: 600;">✓ If you received this, your email configuration is working correctly!</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 14px;">Sent from MedAssist-ng Medication Planner</p>
          </div>
        `,
			});

			return reply.send({ success: true, message: "Test email sent successfully" });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			return reply.status(500).send({ error: `Failed to send email: ${errorMessage}` });
		}
	});

	// Test Shoutrrr/ntfy notification
	app.post<{ Body: TestShoutrrrBody }>("/settings/test-shoutrrr", async (request, reply) => {
		const { url } = request.body;

		if (!url) {
			return reply.status(400).send({ error: "Notification URL is required" });
		}

		try {
			const provider = getNotificationProvider(url);
			const result = await sendShoutrrrNotification(
				url,
				"MedAssist-ng Test",
				"This is a test notification from MedAssist-ng. If you received this, your notification configuration is working correctly!"
			);

			if (result.success) {
				request.log.info({ provider }, "[Settings] Test push notification sent");
				return reply.send({ success: true, message: "Test notification sent successfully" });
			} else {
				request.log.warn({ provider, error: result.error ?? "unknown" }, "[Settings] Test push notification failed");
				return reply.status(500).send({ error: result.error });
			}
		} catch (error) {
			request.log.error(
				{ provider: getNotificationProvider(url), error },
				"[Settings] Unexpected error while sending test push notification"
			);
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			return reply.status(500).send({ error: `Failed to send notification: ${errorMessage}` });
		}
	});
}

// Validate and sanitize URL to prevent SSRF attacks
// Returns a reconstructed URL from validated components to break taint tracking
function sanitizeNotificationUrl(
	urlStr: string
): { url: string; isNtfy: boolean; auth?: { user: string; pass: string } } | { error: string } {
	try {
		// Support Shoutrrr Discord format: discord://TOKEN@WEBHOOK_ID
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

		// Convert ntfy:// to https:// for parsing, track if it was ntfy
		const isNtfy = urlStr.startsWith("ntfy://");
		const normalizedUrl = isNtfy ? urlStr.replace("ntfy://", "https://") : urlStr;

		const parsed = new URL(normalizedUrl);

		// Only allow http and https protocols
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return { error: "Only HTTP/HTTPS protocols are allowed" };
		}

		const hostValidationError = validateNotificationHostname(parsed.hostname);
		if (hostValidationError) {
			return { error: hostValidationError };
		}

		// Reconstruct URL from validated components - this breaks taint tracking
		// because we're building a new string from validated parts, not passing through user input
		const reconstructedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;

		// Extract auth credentials separately for ntfy (they're in the URL but not in host)
		const auth =
			isNtfy && parsed.username && parsed.password ? { user: parsed.username, pass: parsed.password } : undefined;

		return { url: reconstructedUrl, isNtfy, auth };
	} catch {
		return { error: "Invalid URL format" };
	}
}

function validateNotificationHostname(hostnameRaw: string): string | null {
	const hostname = hostnameRaw.toLowerCase();

	if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
		return "Localhost URLs are not allowed";
	}

	const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ipMatch) {
		const [, a, b] = ipMatch.map(Number);
		if (
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		) {
			return "Private IP addresses are not allowed";
		}
	}

	if (
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".lan") ||
		hostname === "metadata.google.internal"
	) {
		return "Internal hostnames are not allowed";
	}

	return null;
}

// Send notification via Shoutrrr-compatible URL (supports ntfy, Discord, Telegram, etc.)
export async function sendShoutrrrNotification(
	urlStr: string,
	title: string,
	message: string
): Promise<{ success: boolean; error?: string }> {
	try {
		if (urlStr.startsWith("pushover://")) {
			const pushoverAuthority = urlStr.slice("pushover://".length).split("/")[0] ?? "";
			const atIndex = pushoverAuthority.lastIndexOf("@");
			const credentialPart = atIndex >= 0 ? pushoverAuthority.slice(0, atIndex) : "";
			const userKey = atIndex >= 0 ? pushoverAuthority.slice(atIndex + 1) : "";

			const tokenSeparatorIndex = credentialPart.indexOf(":");
			const apiToken = tokenSeparatorIndex >= 0 ? credentialPart.slice(tokenSeparatorIndex + 1) : "";

			const parsedPushover = new URL(urlStr);

			if (!apiToken || !userKey) {
				return { success: false, error: "Invalid Pushover URL format" };
			}

			const pushoverBody = new URLSearchParams({
				token: apiToken,
				user: userKey,
				title,
				message,
			});

			const devices = parsedPushover.searchParams.get("devices");
			if (devices) {
				pushoverBody.set("device", devices);
			}

			const priority = parsedPushover.searchParams.get("priority");
			if (priority && /^-?\d+$/.test(priority)) {
				pushoverBody.set("priority", priority);
			}

			const response = await fetch("https://api.pushover.net/1/messages.json", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: pushoverBody.toString(),
				redirect: "error",
			});

			if (response.ok) return { success: true };
			const errorText = await response.text();
			return { success: false, error: `HTTP ${response.status}: ${errorText}` };
		}

		if (urlStr.startsWith("telegram://")) {
			const parsedTelegram = new URL(urlStr);
			const token = parsedTelegram.username;
			if (!token || parsedTelegram.hostname !== "telegram") {
				return { success: false, error: "Invalid Telegram URL format" };
			}

			const chatsRaw = parsedTelegram.searchParams.get("chats") ?? parsedTelegram.searchParams.get("channels") ?? "";
			const chats = chatsRaw
				.split(",")
				.map((chat) => chat.trim())
				.filter(Boolean);

			if (chats.length === 0) {
				return { success: false, error: "Telegram URL requires chats parameter" };
			}

			const parseModeRaw = parsedTelegram.searchParams.get("parseMode")?.toLowerCase();
			let parseMode: "HTML" | "Markdown" | "MarkdownV2" | undefined;
			if (parseModeRaw === "html") {
				parseMode = "HTML";
			} else if (parseModeRaw === "markdown") {
				parseMode = "Markdown";
			} else if (parseModeRaw === "markdownv2") {
				parseMode = "MarkdownV2";
			}

			const notificationRaw = parsedTelegram.searchParams.get("notification")?.toLowerCase();
			const disableNotification = notificationRaw === "no" || notificationRaw === "false";

			const previewRaw = parsedTelegram.searchParams.get("preview")?.toLowerCase();
			const disablePreview = previewRaw === "no" || previewRaw === "false";

			if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
				return { success: false, error: "Invalid Telegram token format" };
			}

			const telegramSendMessageUrl = new URL("/bot/sendMessage", "https://api.telegram.org");
			telegramSendMessageUrl.pathname = `/bot${token}/sendMessage`;

			for (const chatId of chats) {
				const payload: Record<string, string | boolean> = {
					chat_id: chatId,
					text: `${title}\n\n${message}`,
					disable_notification: disableNotification,
					disable_web_page_preview: disablePreview,
				};
				if (parseMode) {
					payload.parse_mode = parseMode;
				}

				// codeql[js/request-forgery]: host is fixed to api.telegram.org and token is pattern-validated.
				const response = await fetch(telegramSendMessageUrl.toString(), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
					redirect: "error",
				});

				if (!response.ok) {
					const errorText = await response.text();
					return { success: false, error: `HTTP ${response.status}: ${errorText}` };
				}
			}

			return { success: true };
		}

		if (urlStr.startsWith("gotify://")) {
			const parsedGotify = new URL(urlStr);
			const hostValidationError = validateNotificationHostname(parsedGotify.hostname);
			if (hostValidationError) {
				return { success: false, error: hostValidationError };
			}

			const pathParts = parsedGotify.pathname
				.split("/")
				.map((part) => part.trim())
				.filter(Boolean);

			if (pathParts.length === 0) {
				return { success: false, error: "Invalid Gotify URL format" };
			}

			const token = pathParts[pathParts.length - 1];
			const basePath = pathParts.slice(0, -1).join("/");

			const disableTlsRaw = parsedGotify.searchParams.get("disabletls")?.toLowerCase();
			const protocol = disableTlsRaw === "yes" || disableTlsRaw === "true" || disableTlsRaw === "1" ? "http" : "https";

			const gotifyWebhookUrl = `${protocol}://${parsedGotify.host}${basePath ? `/${basePath}` : ""}/message?token=${encodeURIComponent(token)}`;

			const gotifyPriority = parsedGotify.searchParams.get("priority");
			const gotifyMessage = gotifyPriority ? `${message}\n\n(priority=${gotifyPriority})` : message;

			// Reuse validated https webhook path to keep a single outbound request sink.
			return sendShoutrrrNotification(gotifyWebhookUrl, title, gotifyMessage);
		}

		// Validate and sanitize URL to prevent SSRF - this reconstructs the URL
		// from validated components, breaking taint tracking
		const validation = sanitizeNotificationUrl(urlStr);
		if ("error" in validation) {
			return { success: false, error: validation.error };
		}

		// Use ONLY the reconstructed URL from validation - never the original urlStr
		const { url: sanitizedUrl, isNtfy: _isNtfy, auth } = validation;

		let targetUrl: string;
		const method = "POST";
		let headers: Record<string, string> = {};
		let body: string | undefined;

		// Remove emojis from title for header compatibility
		const cleanTitle = title
			.replace(
				/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{2000}-\u{206F}]|⚠|️/gu,
				""
			)
			.trim();

		// Determine notification type based on URL hostname
		// Use JSON format only for known webhook services that require it
		// Use proper URL parsing to prevent bypass attacks (e.g., evil.com?hooks.slack.com)
		let isJsonWebhook = false;
		let isDiscordWebhook = false;
		try {
			const parsedUrl = new URL(sanitizedUrl);
			const hostname = parsedUrl.hostname.toLowerCase();
			const pathname = parsedUrl.pathname.toLowerCase();
			isDiscordWebhook =
				(hostname === "discord.com" || hostname === "discordapp.com") && pathname.startsWith("/api/webhooks");

			isJsonWebhook =
				// Discord webhooks
				isDiscordWebhook ||
				// Slack webhooks
				hostname === "hooks.slack.com" ||
				hostname.endsWith(".hooks.slack.com") ||
				// Telegram API
				hostname === "api.telegram.org" ||
				// Gotify (can be self-hosted, so check if "gotify" is in hostname)
				hostname.includes("gotify");
		} catch {
			// If URL parsing fails, default to ntfy-style
			isJsonWebhook = false;
		}

		// Default to ntfy-style (plain text with Title header) for all other HTTP URLs
		// This works for ntfy, Apprise, and most simple push services
		if (!isJsonWebhook) {
			targetUrl = sanitizedUrl;
			// Use RFC 2047 Base64 encoding for Title header to safely pass non-ASCII
			// characters (umlauts, accents, etc.) through HTTP headers
			const encodedTitle = `=?UTF-8?B?${Buffer.from(cleanTitle, "utf-8").toString("base64")}?=`;
			headers = { Title: encodedTitle, Tags: "pill" };
			body = message;

			// Add auth if present (extracted during sanitization)
			if (auth) {
				headers.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString("base64")}`;
			}
		} else if (sanitizedUrl.startsWith("http://") || sanitizedUrl.startsWith("https://")) {
			targetUrl = sanitizedUrl;
			headers = { "Content-Type": "application/json" };
			if (isDiscordWebhook) {
				body = JSON.stringify({ content: `${title}\n\n${message}` });
			} else {
				body = JSON.stringify({ title, message, text: `${title}\n\n${message}` });
			}
		} else {
			return {
				success: false,
				error: "Unsupported URL format. Use ntfy://, discord://, pushover://, gotify://, telegram://, or https:// URL",
			};
		}

		// SSRF protection: targetUrl is reconstructed from sanitizeNotificationUrl() which validates:
		// - Only http/https protocols allowed
		// - Blocks localhost (localhost, 127.0.0.1, ::1)
		// - Blocks private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x)
		// - Blocks internal hostnames (.local, .internal, .lan, metadata.google.internal)
		// - redirect: "error" prevents redirect-based bypass attacks
		// This is an intentional feature: users configure their own external notification services
		// lgtm [js/request-forgery]
		const response = await fetch(targetUrl, {
			method,
			headers,
			body,
			redirect: "error", // Don't follow redirects that could bypass validation
		});

		if (response.ok) {
			return { success: true };
		} else {
			const errorText = await response.text();
			return { success: false, error: `HTTP ${response.status}: ${errorText}` };
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}
