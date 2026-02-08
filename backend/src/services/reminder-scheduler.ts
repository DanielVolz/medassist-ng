import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { getDataDir } from "../db/db-utils.js";
import { medications, userSettings } from "../db/schema.js";
import { getTranslations, type Language, t } from "../i18n/translations.js";
import { getAllUserSettings, sendShoutrrrNotification, type UserSettings } from "../routes/settings.js";
import type { ServiceLogger } from "../utils/logger.js";
// Import shared utilities
import {
	type Blister,
	calculateDepletionInfo,
	createDefaultReminderState,
	formatInTimezone,
	getCurrentHourInTimezone,
	getMsUntilNextCheck,
	getNextScheduledTime,
	getTimezone,
	getTodayInTimezone,
	parseBlisters,
	parseReminderState,
	type ReminderState,
} from "../utils/scheduler-utils.js";

const REMINDER_HOUR = parseInt(process.env.REMINDER_HOUR ?? "6", 10); // Default 6:00 AM local time

const reminderStateFile = resolve(getDataDir(), "reminder-state.json");

function loadReminderState(): ReminderState {
	try {
		if (existsSync(reminderStateFile)) {
			return parseReminderState(readFileSync(reminderStateFile, "utf-8"));
		}
	} catch {
		// ignore
	}
	return createDefaultReminderState();
}

function saveReminderState(state: ReminderState): void {
	writeFileSync(reminderStateFile, JSON.stringify(state, null, 2));
}

export function getReminderState(): ReminderState {
	return loadReminderState();
}

export function updateReminderSentTime(
	type: "stock" | "intake" = "stock",
	channel: "email" | "push" | "both" = "email"
): void {
	const state = loadReminderState();
	const today = getTodayInTimezone();
	saveReminderState({
		...state,
		lastAutoEmailSent: new Date().toISOString(),
		lastAutoEmailDate: today,
		lastNotificationType: type,
		lastNotificationChannel: channel,
	});
}

// Update user settings in database when reminder is sent
export async function updateUserReminderSentTime(
	userId: number,
	type: "stock" | "intake" = "stock",
	channel: "email" | "push" | "both" = "email",
	medName?: string,
	takenBy?: string
): Promise<void> {
	const now = new Date().toISOString();
	await db
		.update(userSettings)
		.set({
			lastAutoEmailSent: now,
			lastNotificationType: type,
			lastNotificationChannel: channel,
			lastReminderMedName: medName ?? null,
			lastReminderTakenBy: takenBy ?? null,
		})
		.where(eq(userSettings.userId, userId));
}

function parseBlistersFromRow(row: { usageJson: string; everyJson: string; startJson: string }): Blister[] {
	return parseBlisters(row);
}

type LowStockItem = {
	name: string;
	medsLeft: number;
	daysLeft: number | null;
	depletionDate: string | null;
};

async function getMedicationsNeedingReminder(
	userId: number,
	reminderDaysBefore: number,
	language: Language
): Promise<LowStockItem[]> {
	const rows = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);

	const lowStock: LowStockItem[] = [];

	for (const row of rows) {
		const blisters = parseBlistersFromRow(row);
		const totalPills =
			(row.packageType ?? "blister") === "bottle"
				? row.looseTablets + (row.stockAdjustment ?? 0)
				: row.packCount * row.blistersPerPack * row.pillsPerBlister + row.looseTablets + (row.stockAdjustment ?? 0);
		const { daysLeft, depletionDate } = calculateDepletionInfo({ count: totalPills, blisters }, language);

		// Check if medication runs out within reminderDaysBefore days
		if (daysLeft !== null && daysLeft <= reminderDaysBefore) {
			lowStock.push({
				name: row.name,
				medsLeft: totalPills,
				daysLeft,
				depletionDate,
			});
		}
	}

	return lowStock;
}

async function sendReminderEmail(
	email: string,
	lowStock: LowStockItem[],
	language: Language,
	isRepeatDaily: boolean = false
): Promise<{ success: boolean; error?: string }> {
	const smtpHost = process.env.SMTP_HOST;
	const smtpUser = process.env.SMTP_USER;
	const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
	const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
	const smtpSecure = process.env.SMTP_SECURE === "true";
	const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

	if (!smtpHost || !smtpUser) {
		return { success: false, error: "SMTP not configured" };
	}

	const tr = getTranslations(language);
	const tableRows = lowStock
		.map(
			(row) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${row.name}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${row.medsLeft}</strong></td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.daysLeft ?? 0}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.depletionDate ?? "-"}</td>
      </tr>
    `
		)
		.join("");

	const alertText =
		lowStock.length === 1
			? tr.stockReminder.alertSingle
			: t(tr.stockReminder.alertMultiple, { count: lowStock.length });

	const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${tr.stockReminder.title}</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${tr.stockReminder.description}</p>
        
        <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #fef2f2; border: 1px solid #fecaca;">
          <p style="margin: 0; color: #991b1b; font-weight: 500; font-size: 13px;">
            ${alertText}
          </p>
        </div>

        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; background: white; min-width: 400px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.medication}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.pills}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.days}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.runsOut}</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          ${tr.stockReminder.footer}
        </p>
        ${isRepeatDaily ? `<p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0 0; font-style: italic;">${tr.stockReminder.repeatDailyNote}</p>` : ""}
      </div>
    </div>
  `;

	const plainText = `${tr.stockReminder.title}

${tr.stockReminder.description}

${lowStock.map((r) => `${r.name}: ${r.medsLeft} ${tr.common.pills}, ${r.daysLeft ?? 0} ${tr.common.days}, ${tr.stockReminder.tableHeaders.runsOut}: ${r.depletionDate ?? tr.common.soon}`).join("\n")}

---
${tr.stockReminder.footer}${isRepeatDaily ? `\n\n${tr.stockReminder.repeatDailyNote}` : ""}`;

	const subjectPlural = lowStock.length === 1 ? "" : language === "de" ? "e" : "s";
	const subject = t(tr.stockReminder.subject, { count: lowStock.length, s: subjectPlural, e: subjectPlural });

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
			subject: `⚠️ ${subject}`,
			text: plainText,
			html,
		});

		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}

async function checkAndSendReminder(logger: ServiceLogger): Promise<void> {
	// Get all user settings to iterate over each user
	const allUserSettings = await getAllUserSettings();

	if (allUserSettings.length === 0) {
		logger.debug("[Reminder] No users with settings found");
		return;
	}

	for (const userSettings of allUserSettings) {
		await checkAndSendReminderForUser(userSettings, logger);
	}
}

async function checkAndSendReminderForUser(
	settings: UserSettings & { userId: number },
	logger: ServiceLogger
): Promise<void> {
	const language = settings.language;
	const tr = getTranslations(language);

	// Check if any stock reminder notifications are enabled (granular check)
	const emailEnabled = settings.emailEnabled && settings.notificationEmail && settings.emailStockReminders;
	const shoutrrrEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrStockReminders;

	if (!emailEnabled && !shoutrrrEnabled) {
		return; // No stock reminder notifications enabled for this user
	}

	const state = loadReminderState();
	const today = getTodayInTimezone(); // YYYY-MM-DD in configured timezone
	const userStateKey = `user_${settings.userId}`;

	// Get all medications that need a reminder for this user
	const allLowStock = await getMedicationsNeedingReminder(settings.userId, settings.reminderDaysBefore, language);

	if (allLowStock.length === 0) {
		return; // No low stock for this user
	}

	// Simple per-user tracking - check if we already sent today
	const userNotifiedKey = `${userStateKey}_${today}`;
	if (state.notifiedMedications.includes(userNotifiedKey) && !settings.repeatDailyReminders) {
		return; // Already notified this user today
	}

	logger.info(`[Reminder] User ${settings.userId}: Sending reminder for ${allLowStock.length} medications...`);

	let emailSuccess = false;
	let shoutrrrSuccess = false;

	// Send email if enabled
	if (emailEnabled) {
		const result = await sendReminderEmail(
			settings.notificationEmail!,
			allLowStock,
			language,
			settings.repeatDailyReminders
		);
		emailSuccess = result.success;
		if (result.success) {
			logger.info(`[Reminder] User ${settings.userId}: Email sent successfully to ${settings.notificationEmail}`);
		} else {
			logger.error(`[Reminder] User ${settings.userId}: Failed to send email: ${result.error}`);
		}
	}

	// Send Shoutrrr notification if enabled
	if (shoutrrrEnabled) {
		// Separate empty from low stock medications
		const emptyMeds = allLowStock.filter((m) => m.medsLeft <= 0);
		const lowMeds = allLowStock.filter((m) => m.medsLeft > 0);

		// Build clear title
		const titleParts: string[] = [];
		if (emptyMeds.length > 0) {
			titleParts.push(`🚨 ${emptyMeds.length} ${tr.push.empty || "Empty"}`);
		}
		if (lowMeds.length > 0) {
			titleParts.push(`⚠️ ${lowMeds.length} ${tr.push.low || "Low"}`);
		}
		const title = `MedAssist: ${titleParts.join(", ")} - ${tr.push.reorderNow || "Reorder Now!"}`;

		// Build clear message with sections
		const messageParts: string[] = [];
		if (emptyMeds.length > 0) {
			messageParts.push(`🚨 ${tr.push.emptySection || "EMPTY (reorder immediately)"}:`);
			emptyMeds.forEach((m) => messageParts.push(`  • ${m.name}`));
		}
		if (lowMeds.length > 0) {
			if (emptyMeds.length > 0) messageParts.push("");
			messageParts.push(`⚠️ ${tr.push.lowSection || "RUNNING LOW (reorder soon)"}:`);
			lowMeds.forEach((m) =>
				messageParts.push(
					`  • ${m.name}: ${t(tr.push.pillsLeft, { count: m.medsLeft })}, ${t(tr.push.daysLeft, { count: m.daysLeft ?? 0 })}`
				)
			);
		}

		if (settings.repeatDailyReminders) {
			messageParts.push("");
			messageParts.push(tr.push.repeatDailyNote);
		}

		const message = messageParts.join("\n");

		const result = await sendShoutrrrNotification(settings.shoutrrrUrl!, title, message);
		shoutrrrSuccess = result.success;
		if (result.success) {
			logger.info(`[Reminder] User ${settings.userId}: Push notification sent successfully`);
		} else {
			logger.error(`[Reminder] User ${settings.userId}: Failed to send push notification: ${result.error}`);
		}
	}

	// Update state if any notification was sent successfully
	if (emailSuccess || shoutrrrSuccess) {
		const currentState = loadReminderState();
		const channel = emailSuccess && shoutrrrSuccess ? "both" : emailSuccess ? "email" : "push";
		saveReminderState({
			lastAutoEmailSent: new Date().toISOString(),
			lastAutoEmailDate: today,
			notifiedMedications: [...new Set([...currentState.notifiedMedications, userNotifiedKey])],
			nextScheduledCheck: currentState.nextScheduledCheck,
			lastNotificationType: "stock",
			lastNotificationChannel: channel,
		});

		// Also update user settings in database so frontend can display the info
		// For stock reminders, show the first medication name
		const firstMed = allLowStock[0];
		const medNames = allLowStock.length > 1 ? `${firstMed.name} (+${allLowStock.length - 1})` : firstMed?.name;
		await updateUserReminderSentTime(settings.userId, "stock", channel, medNames);
	}
}

let schedulerTimeout: NodeJS.Timeout | null = null;

function scheduleNextCheck(logger: ServiceLogger): void {
	const msUntilNext = getMsUntilNextCheck(REMINDER_HOUR);
	const nextTime = getNextScheduledTime(REMINDER_HOUR);

	// Save next scheduled time to state
	const state = loadReminderState();
	saveReminderState({
		...state,
		nextScheduledCheck: nextTime.toISOString(),
	});

	logger.debug(
		`[Reminder] Next check scheduled for ${formatInTimezone(nextTime)} (${getTimezone()}) (in ${Math.round(msUntilNext / 1000 / 60)} minutes)`
	);

	schedulerTimeout = setTimeout(() => {
		checkAndSendReminder(logger).catch((err) => logger.error(`[Reminder] Error: ${err}`));
		// Schedule the next check after this one completes
		scheduleNextCheck(logger);
	}, msUntilNext);
}

export function startReminderScheduler(logger: ServiceLogger): void {
	logger.info(`[Reminder] Starting reminder scheduler (timezone: ${getTimezone()})...`);

	// Check if we need to run immediately (missed today's check)
	const state = loadReminderState();
	const today = getTodayInTimezone();
	const currentHour = getCurrentHourInTimezone();

	// If it's past REMINDER_HOUR today in the configured timezone and we haven't checked today, run immediately
	if (currentHour >= REMINDER_HOUR && state.lastAutoEmailDate !== today) {
		logger.info("[Reminder] Missed today's check, running now...");
		checkAndSendReminder(logger).catch((err) => logger.error(`[Reminder] Error: ${err}`));
	}

	// Schedule next check at REMINDER_HOUR
	scheduleNextCheck(logger);

	logger.info(`[Reminder] Scheduler started - daily check at ${REMINDER_HOUR}:00 ${getTimezone()}`);
}

export function stopReminderScheduler(): void {
	if (schedulerTimeout) {
		clearTimeout(schedulerTimeout);
		schedulerTimeout = null;
	}
}
