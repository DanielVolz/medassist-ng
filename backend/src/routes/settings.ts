import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
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
	shoutrrrEnabled: boolean;
	shoutrrrUrl: string | null;
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
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
	lastAutoEmailSent: string | null;
	lastNotificationType: string | null;
	lastNotificationChannel: string | null;
	lastReminderMedName: string | null;
	lastReminderTakenBy: string | null;
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
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
	skipRemindersForTakenDoses: boolean;
	repeatRemindersEnabled: boolean;
	reminderRepeatIntervalMinutes: number;
	maxNaggingReminders: number;
	language: string;
	stockCalculationMode: "automatic" | "manual";
};

type TestEmailBody = {
	email: string;
};

type TestShoutrrrBody = {
	url: string;
};

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
		shoutrrrEnabled: envBool("DEFAULT_SHOUTRRR_ENABLED", false),
		shoutrrrUrl: process.env.DEFAULT_SHOUTRRR_URL || null,
		shoutrrrStockReminders: envBool("DEFAULT_SHOUTRRR_STOCK_REMINDERS", true),
		shoutrrrIntakeReminders: envBool("DEFAULT_SHOUTRRR_INTAKE_REMINDERS", true),
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
		lastAutoEmailSent: null,
		lastNotificationType: null,
		lastNotificationChannel: null,
		lastReminderMedName: null,
		lastReminderTakenBy: null,
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
		shoutrrrEnabled: settings.shoutrrrEnabled,
		shoutrrrUrl: settings.shoutrrrUrl,
		shoutrrrStockReminders: settings.shoutrrrStockReminders,
		shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
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
		lastAutoEmailSent: settings.lastAutoEmailSent,
		lastNotificationType: settings.lastNotificationType,
		lastNotificationChannel: settings.lastNotificationChannel,
		lastReminderMedName: settings.lastReminderMedName ?? null,
		lastReminderTakenBy: settings.lastReminderTakenBy ?? null,
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
		shoutrrrEnabled: settings.shoutrrrEnabled,
		shoutrrrUrl: settings.shoutrrrUrl,
		shoutrrrStockReminders: settings.shoutrrrStockReminders,
		shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
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
		lastAutoEmailSent: settings.lastAutoEmailSent,
		lastNotificationType: settings.lastNotificationType,
		lastNotificationChannel: settings.lastNotificationChannel,
		lastReminderMedName: settings.lastReminderMedName ?? null,
		lastReminderTakenBy: settings.lastReminderTakenBy ?? null,
	}));
}

export async function settingsRoutes(app: FastifyInstance) {
	// All settings routes require auth
	app.addHook("preHandler", requireAuth);

	// Helper to get user ID from request
	// Returns anonymous user ID when auth is disabled
	async function getUserId(request: any, reply: any): Promise<number> {
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
	app.get("/settings", async (request, reply) => {
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
			shoutrrrStockReminders: settings.shoutrrrStockReminders,
			shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
			skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
			repeatRemindersEnabled: settings.repeatRemindersEnabled ?? false,
			reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes ?? 30,
			maxNaggingReminders: settings.maxNaggingReminders ?? 5,
			language: settings.language,
			stockCalculationMode: settings.stockCalculationMode ?? "automatic",
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
			shoutrrrEnabled: body.shoutrrrEnabled ?? false,
			shoutrrrUrl: body.shoutrrrUrl || null,
			shoutrrrStockReminders: body.shoutrrrStockReminders ?? true,
			shoutrrrIntakeReminders: body.shoutrrrIntakeReminders ?? true,
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
			const result = await sendShoutrrrNotification(
				url,
				"MedAssist-ng Test",
				"This is a test notification from MedAssist-ng. If you received this, your notification configuration is working correctly!"
			);

			if (result.success) {
				return reply.send({ success: true, message: "Test notification sent successfully" });
			} else {
				return reply.status(500).send({ error: result.error });
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			return reply.status(500).send({ error: `Failed to send notification: ${errorMessage}` });
		}
	});
}

// Validate URL to prevent SSRF attacks
function isAllowedNotificationUrl(urlStr: string): { allowed: boolean; error?: string } {
	try {
		// Convert ntfy:// to https:// for parsing
		const normalizedUrl = urlStr.startsWith("ntfy://") ? urlStr.replace("ntfy://", "https://") : urlStr;

		const parsed = new URL(normalizedUrl);

		// Only allow http and https protocols
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return { allowed: false, error: "Only HTTP/HTTPS protocols are allowed" };
		}

		// Block private/internal IP addresses
		const hostname = parsed.hostname.toLowerCase();

		// Block localhost
		if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
			return { allowed: false, error: "Localhost URLs are not allowed" };
		}

		// Block private IP ranges (basic check)
		const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
		if (ipMatch) {
			const [, a, b] = ipMatch.map(Number);
			// 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x (link-local)
			if (
				a === 10 ||
				a === 127 ||
				(a === 172 && b >= 16 && b <= 31) ||
				(a === 192 && b === 168) ||
				(a === 169 && b === 254)
			) {
				return { allowed: false, error: "Private IP addresses are not allowed" };
			}
		}

		// Block common internal hostnames
		if (
			hostname.endsWith(".local") ||
			hostname.endsWith(".internal") ||
			hostname.endsWith(".lan") ||
			hostname === "metadata.google.internal"
		) {
			return { allowed: false, error: "Internal hostnames are not allowed" };
		}

		return { allowed: true };
	} catch {
		return { allowed: false, error: "Invalid URL format" };
	}
}

// Send notification via Shoutrrr-compatible URL (supports ntfy, Discord, Telegram, etc.)
export async function sendShoutrrrNotification(
	urlStr: string,
	title: string,
	message: string
): Promise<{ success: boolean; error?: string }> {
	try {
		// Validate URL to prevent SSRF
		const validation = isAllowedNotificationUrl(urlStr);
		if (!validation.allowed) {
			return { success: false, error: validation.error };
		}

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

		if (urlStr.startsWith("ntfy://")) {
			const parsed = new URL(urlStr.replace("ntfy://", "https://"));
			targetUrl = `https://${parsed.host}${parsed.pathname}`;
			headers = { Title: cleanTitle, Tags: "pill" };
			body = message;

			if (parsed.username && parsed.password) {
				headers.Authorization = `Basic ${Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64")}`;
			}
		} else if (urlStr.startsWith("https://ntfy.") || urlStr.includes("ntfy.sh") || urlStr.includes("/ntfy/")) {
			targetUrl = urlStr;
			headers = { Title: cleanTitle, Tags: "pill" };
			body = message;
		} else if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
			targetUrl = urlStr;
			headers = { "Content-Type": "application/json" };
			body = JSON.stringify({ title, message, text: `${title}\n\n${message}` });
		} else {
			return { success: false, error: "Unsupported URL format. Use ntfy:// or https:// URL" };
		}

		// SSRF protection: targetUrl has been validated by isAllowedNotificationUrl() above
		// which blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x, 169.254.x),
		// and internal hostnames (.local, .internal, .lan, metadata.google.internal)
		const response = await fetch(targetUrl, {
			method,
			headers,
			body,
			// Additional SSRF mitigations
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
