import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { getDataDir } from "../db/db-utils.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { getFooterHtml, getFooterPlain, getTranslations, type Language, t } from "../i18n/translations.js";
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
	normalizeIntakeUsageForStock,
	parseIntakesJson,
	parseLocalDateTime,
	parseReminderState,
	parseTakenByJson,
	type ReminderState,
} from "../utils/scheduler-utils.js";

function escapeHtml(text: string): string {
	const htmlEscapes: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

const REMINDER_HOUR = parseInt(process.env.REMINDER_HOUR ?? "6", 10); // Default 6:00 AM local time

const reminderStateFile = resolve(getDataDir(), "reminder-state.json");
const reminderLocksDir = resolve(getDataDir(), "scheduler-locks");
const LOCK_STALE_MS = 15 * 60 * 1000;

function ensureReminderLocksDir(): void {
	if (!existsSync(reminderLocksDir)) {
		mkdirSync(reminderLocksDir, { recursive: true });
	}
}

function acquireReminderSendLock(lockKey: string): string | null {
	ensureReminderLocksDir();
	const lockFilePath = resolve(reminderLocksDir, `${lockKey}.lock`);

	const tryCreateLock = (): boolean => {
		try {
			const fd = openSync(lockFilePath, "wx");
			closeSync(fd);
			return true;
		} catch {
			return false;
		}
	};

	if (tryCreateLock()) {
		return lockFilePath;
	}

	try {
		const stats = statSync(lockFilePath);
		if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
			unlinkSync(lockFilePath);
			if (tryCreateLock()) {
				return lockFilePath;
			}
		}
	} catch {
		// ignore; lock acquisition fails safely
	}

	return null;
}

function releaseReminderSendLock(lockFilePath: string | null): void {
	if (!lockFilePath) return;
	try {
		unlinkSync(lockFilePath);
	} catch {
		// ignore release errors
	}
}

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
	type: "stock" | "intake" | "prescription" = "stock",
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
// Stock and intake reminders are tracked separately so neither overwrites the other
export async function updateUserReminderSentTime(
	userId: number,
	type: "stock" | "intake" | "prescription" = "stock",
	channel: "email" | "push" | "both" = "email",
	medName?: string,
	takenBy?: string
): Promise<void> {
	const now = new Date().toISOString();
	if (type === "stock") {
		// Write to dedicated stock reminder columns only — do NOT touch the shared
		// lastNotificationType column, as that would block intake reminder display
		await db
			.update(userSettings)
			.set({
				lastStockReminderSent: now,
				lastStockReminderChannel: channel,
				lastStockReminderMedNames: medName ?? null,
			})
			.where(eq(userSettings.userId, userId));
	} else if (type === "prescription") {
		// Write to dedicated prescription reminder columns only
		await db
			.update(userSettings)
			.set({
				lastPrescriptionReminderSent: now,
				lastPrescriptionReminderChannel: channel,
				lastPrescriptionReminderMedNames: medName ?? null,
			})
			.where(eq(userSettings.userId, userId));
	} else {
		// Write to intake reminder columns
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
}

type LowStockItem = {
	name: string;
	medsLeft: number;
	daysLeft: number | null;
	depletionDate: string | null;
	isCritical: boolean;
	packageType?: string | null;
	medicationForm?: string | null;
};

type PrescriptionReminderItem = {
	name: string;
	remainingRefills: number;
	lowThreshold: number;
	expiryDate: string | null;
};

function getMedicationUnitLabel(
	packageType: string | null | undefined,
	medicationForm: string | null | undefined,
	tr: ReturnType<typeof getTranslations>
): string {
	if (packageType === "liquid_container" || medicationForm === "liquid") return tr.common.ml;
	if (packageType === "tube") return tr.common.applications;
	return tr.common.pills;
}

async function getMedicationsNeedingReminder(
	userId: number,
	reminderDaysBefore: number,
	lowStockDays: number,
	language: Language,
	stockCalculationMode: "automatic" | "manual"
): Promise<LowStockItem[]> {
	const rows = await db
		.select()
		.from(medications)
		.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)))
		.orderBy(medications.id);

	const takenDoseRows = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, false)));

	const takenDoseIdsByMed = new Map<number, Set<string>>();
	const takenDoseTimestamps = new Map<string, number>();
	for (const dose of takenDoseRows) {
		const parts = dose.doseId.split("-");
		if (parts.length < 3) continue;
		const medId = parseInt(parts[0], 10);
		if (Number.isNaN(medId)) continue;

		if (!takenDoseIdsByMed.has(medId)) {
			takenDoseIdsByMed.set(medId, new Set());
		}
		takenDoseIdsByMed.get(medId)!.add(dose.doseId);
		const rawTakenAt = Number(dose.takenAt);
		let takenAtMs: number;
		if (Number.isFinite(rawTakenAt)) {
			takenAtMs = rawTakenAt < 1_000_000_000_000 ? rawTakenAt * 1000 : rawTakenAt;
		} else {
			takenAtMs = new Date(dose.takenAt).getTime();
		}
		takenDoseTimestamps.set(dose.doseId, takenAtMs);
	}

	const lowStock: LowStockItem[] = [];
	const now = Date.now();
	const msPerDay = 86_400_000;

	for (const row of rows) {
		const intakes = parseIntakesJson(
			row.intakesJson,
			{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
			row.intakeRemindersEnabled ?? false
		);
		const medForm = row.medicationForm ?? "tablet";
		const blisters: Blister[] = intakes.map((i) => ({
			usage: normalizeIntakeUsageForStock(i, medForm, row.packageType),
			every: i.every,
			start: i.start,
		}));
		const isTopical = medForm === "topical" || (row.packageType ?? "blister") === "tube";

		const originalTotalPills =
			(row.packageType ?? "blister") === "bottle" || (row.packageType ?? "blister") === "liquid_container"
				? row.looseTablets + (row.stockAdjustment ?? 0)
				: row.packCount * row.blistersPerPack * row.pillsPerBlister + row.looseTablets + (row.stockAdjustment ?? 0);

		const stockCorrectionCutoff = row.lastStockCorrectionAt ? new Date(row.lastStockCorrectionAt).getTime() : 0;
		const takenDoseIds = takenDoseIdsByMed.get(row.id) ?? new Set<string>();

		let consumed = 0;

		if (isTopical) {
			consumed = 0;
		} else if (stockCalculationMode === "automatic") {
			blisters.forEach((blister, blisterIdx) => {
				const blisterStart = parseLocalDateTime(blister.start).getTime();
				if (Number.isNaN(blisterStart)) return;

				const period = Math.max(1, blister.every) * msPerDay;

				let effectiveStart: number;
				if (stockCorrectionCutoff > 0 && stockCorrectionCutoff >= blisterStart) {
					const elapsedSinceStart = stockCorrectionCutoff - blisterStart;
					const periodsElapsed = Math.floor(elapsedSinceStart / period);
					effectiveStart = blisterStart + (periodsElapsed + 1) * period;
				} else {
					effectiveStart = blisterStart;
				}

				const intake = intakes[blisterIdx];
				const intakePerson = intake?.takenBy;
				const fallbackPeople = parseTakenByJson(row.takenByJson);
				let peopleForThisIntake: Array<string | null>;
				if (intakePerson) {
					peopleForThisIntake = [intakePerson];
				} else if (fallbackPeople.length > 0) {
					peopleForThisIntake = fallbackPeople;
				} else {
					peopleForThisIntake = [null];
				}

				let timeBasedConsumed = 0;
				let lastAutoConsumedDateMs = 0;

				if (effectiveStart <= now) {
					const occurrences = Math.floor((now - effectiveStart) / period) + 1;
					timeBasedConsumed = occurrences * blister.usage * peopleForThisIntake.length;

					const lastDoseTime = new Date(effectiveStart + (occurrences - 1) * period);
					lastAutoConsumedDateMs = new Date(
						lastDoseTime.getFullYear(),
						lastDoseTime.getMonth(),
						lastDoseTime.getDate()
					).getTime();
				}

				const stockCorrectionDateOnly =
					stockCorrectionCutoff > 0
						? new Date(
								new Date(stockCorrectionCutoff).getFullYear(),
								new Date(stockCorrectionCutoff).getMonth(),
								new Date(stockCorrectionCutoff).getDate()
							).getTime()
						: 0;
				const earlyCutoff = Math.max(lastAutoConsumedDateMs, stockCorrectionDateOnly);

				let earlyTakenConsumed = 0;
				for (const doseId of takenDoseIds) {
					const parts = doseId.split("-");
					if (parts.length < 3) continue;
					const bIdx = parseInt(parts[1], 10);
					const timestamp = parseInt(parts[2], 10);
					if (!Number.isNaN(bIdx) && !Number.isNaN(timestamp) && bIdx === blisterIdx && timestamp > earlyCutoff) {
						earlyTakenConsumed += blister.usage;
					}
				}

				consumed += timeBasedConsumed + earlyTakenConsumed;
			});
		} else {
			blisters.forEach((blister, blisterIdx) => {
				const blisterStart = parseLocalDateTime(blister.start);
				const blisterStartDateOnly = new Date(
					blisterStart.getFullYear(),
					blisterStart.getMonth(),
					blisterStart.getDate()
				).getTime();
				if (Number.isNaN(blisterStartDateOnly)) return;

				for (const doseId of takenDoseIds) {
					const parts = doseId.split("-");
					if (parts.length < 3) continue;

					const parsedBlisterIdx = parseInt(parts[1], 10);
					const doseTimestamp = parseInt(parts[2], 10);
					if (Number.isNaN(parsedBlisterIdx) || Number.isNaN(doseTimestamp) || parsedBlisterIdx !== blisterIdx) {
						continue;
					}

					const takenAt = takenDoseTimestamps.get(doseId) ?? 0;
					const afterCorrectionOrNoCorrection = stockCorrectionCutoff === 0 || takenAt > stockCorrectionCutoff;
					if (doseTimestamp >= blisterStartDateOnly && afterCorrectionOrNoCorrection) {
						consumed += blister.usage;
					}
				}
			});
		}

		const currentPills = isTopical ? originalTotalPills : Math.max(0, originalTotalPills - consumed);
		const { daysLeft, depletionDate } = calculateDepletionInfo({ count: currentPills, blisters }, language);

		if (daysLeft === null) continue;

		const isCritical = daysLeft <= reminderDaysBefore;
		const isLow = daysLeft < lowStockDays;

		if (isCritical || isLow) {
			lowStock.push({
				name: row.name,
				medsLeft: currentPills,
				daysLeft,
				depletionDate,
				isCritical,
				packageType: row.packageType,
				medicationForm: row.medicationForm,
			});
		}
	}

	return lowStock;
}

async function getMedicationsNeedingPrescriptionReminder(userId: number): Promise<PrescriptionReminderItem[]> {
	const rows = await db
		.select()
		.from(medications)
		.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)))
		.orderBy(medications.id);

	return rows
		.filter(
			(row) =>
				(row.prescriptionEnabled ?? false) &&
				(row.prescriptionRemainingRefills ?? 0) <= (row.prescriptionLowRefillThreshold ?? 1)
		)
		.map((row) => ({
			name: row.name,
			remainingRefills: row.prescriptionRemainingRefills ?? 0,
			lowThreshold: row.prescriptionLowRefillThreshold ?? 1,
			expiryDate: row.prescriptionExpiryDate ?? null,
		}));
}

// Test-only hook to validate scheduler stock semantics against planner/coverage behavior.
export async function getMedicationsNeedingReminderForTests(
	userId: number,
	reminderDaysBefore: number,
	lowStockDays: number,
	language: Language,
	stockCalculationMode: "automatic" | "manual"
): Promise<
	Array<{
		name: string;
		medsLeft: number;
		daysLeft: number | null;
		depletionDate: string | null;
		isCritical: boolean;
	}>
> {
	return getMedicationsNeedingReminder(userId, reminderDaysBefore, lowStockDays, language, stockCalculationMode);
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

	// Separate into 3 categories: empty, critical, and low stock
	const emptyMeds = lowStock.filter((item) => item.medsLeft <= 0);
	const criticalMeds = lowStock.filter((item) => item.medsLeft > 0 && item.isCritical);
	const lowStockMeds = lowStock.filter((item) => item.medsLeft > 0 && !item.isCritical);

	// Build per-category alert boxes
	const alertParts: string[] = [];
	if (emptyMeds.length > 0) {
		const emptyAlert =
			emptyMeds.length === 1
				? tr.stockReminder.alertEmptySingle
				: t(tr.stockReminder.alertEmptyMultiple, { count: emptyMeds.length });
		alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fef2f2; border: 1px solid #dc2626;">
              <p style="margin: 0; color: #dc2626; font-weight: 600; font-size: 13px;">${emptyAlert}</p>
            </div>`);
	}
	if (criticalMeds.length > 0) {
		const criticalAlert =
			criticalMeds.length === 1
				? tr.stockReminder.alertLowSingle
				: t(tr.stockReminder.alertLowMultiple, { count: criticalMeds.length });
		alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fff7ed; border: 1px solid #ea580c;">
              <p style="margin: 0; color: #c2410c; font-weight: 600; font-size: 13px;">${criticalAlert}</p>
            </div>`);
	}
	if (lowStockMeds.length > 0) {
		const lowAlert =
			lowStockMeds.length === 1
				? tr.stockReminder.alertLowStockSingle
				: t(tr.stockReminder.alertLowStockMultiple, { count: lowStockMeds.length });
		alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fffbeb; border: 1px solid #f59e0b;">
              <p style="margin: 0; color: #b45309; font-weight: 500; font-size: 13px;">${lowAlert}</p>
            </div>`);
	}
	const alertHtml = alertParts.join("");

	// Build description text
	let descriptionText: string;
	if (emptyMeds.length > 0 && (criticalMeds.length > 0 || lowStockMeds.length > 0)) {
		descriptionText = tr.stockReminder.descriptionMixed;
	} else if (emptyMeds.length > 0) {
		descriptionText = tr.stockReminder.descriptionEmpty;
	} else if (criticalMeds.length > 0) {
		descriptionText = tr.stockReminder.description;
	} else {
		descriptionText = tr.stockReminder.descriptionLow;
	}

	// Build table rows with status indicator
	const tableRows = lowStock
		.map((row) => {
			const isEmpty = row.medsLeft <= 0;
			const isCritical = row.isCritical;
			const nonEmptyIcon = isCritical ? "🚨" : "⚠️";
			const statusIcon = isEmpty ? "🚨" : nonEmptyIcon;
			const nonEmptyBg = isCritical ? "#fff7ed" : "white";
			const rowBg = isEmpty ? "#fef2f2" : nonEmptyBg;
			const unit = getMedicationUnitLabel(row.packageType, row.medicationForm, tr);
			return `
      <tr style="background: ${rowBg};">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${statusIcon} ${row.name}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; ${isEmpty ? "color: #dc2626; font-weight: 600;" : ""}"><strong>${row.medsLeft}</strong> ${unit}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.daysLeft ?? 0}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${isEmpty ? `<strong>${tr.stockReminder.now ?? "-"}</strong>` : (row.depletionDate ?? "-")}</td>
      </tr>`;
		})
		.join("");

	const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${emptyMeds.length > 0 ? "🚨" : "⚠️"} MedAssist-ng - ${tr.push.reorderNow}</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${descriptionText}</p>
        
        ${alertHtml}

        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; background: white; min-width: 400px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.medication}</th>
				<th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.pills}/${tr.common.units}</th>
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
          ${getFooterHtml(language)}
        </p>
        ${isRepeatDaily ? `<p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0 0; font-style: italic;">${tr.stockReminder.repeatDailyNote}</p>` : ""}
      </div>
    </div>
  `;

	const plainText = `${tr.stockReminder.title}

${tr.stockReminder.description}

${lowStock.map((r) => `${r.name}: ${r.medsLeft} ${getMedicationUnitLabel(r.packageType, r.medicationForm, tr)}, ${r.daysLeft ?? 0} ${tr.common.days}, ${tr.stockReminder.tableHeaders.runsOut}: ${r.depletionDate ?? tr.common.soon}`).join("\n")}

---
${getFooterPlain(language)}${isRepeatDaily ? `\n\n${tr.stockReminder.repeatDailyNote}` : ""}`;

	const pluralSuffix = language === "de" ? "e" : "s";
	const subjectPlural = lowStock.length === 1 ? "" : pluralSuffix;
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
			subject,
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
	// Track stock-scheduler daily execution separately from intake updates.
	// This prevents intake reminders from suppressing stock catch-up after restarts.
	const state = loadReminderState();
	const today = getTodayInTimezone();
	saveReminderState({
		...state,
		lastStockSchedulerCheckDate: today,
	});

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

	const stockEmailEnabled = settings.emailEnabled && settings.notificationEmail && settings.emailStockReminders;
	const stockPushEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrStockReminders;
	const prescriptionEmailEnabled =
		settings.emailEnabled && settings.notificationEmail && settings.emailPrescriptionReminders;
	const prescriptionPushEnabled =
		settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrPrescriptionReminders;

	if (!stockEmailEnabled && !stockPushEnabled && !prescriptionEmailEnabled && !prescriptionPushEnabled) {
		return;
	}

	const state = loadReminderState();
	const today = getTodayInTimezone(); // YYYY-MM-DD in configured timezone
	const userStateKey = `user_${settings.userId}`;
	const userStockNotifiedKey = `${userStateKey}_${today}_stock`;
	const userPrescriptionNotifiedKey = `${userStateKey}_${today}_prescription`;

	const allLowStock = await getMedicationsNeedingReminder(
		settings.userId,
		settings.reminderDaysBefore,
		settings.lowStockDays,
		language,
		settings.stockCalculationMode
	);
	const allPrescriptionLow = await getMedicationsNeedingPrescriptionReminder(settings.userId);

	if (allLowStock.length > 0 && (stockEmailEnabled || stockPushEnabled)) {
		if (!state.notifiedMedications.includes(userStockNotifiedKey) || settings.repeatDailyReminders) {
			const stockSendLock = acquireReminderSendLock(userStockNotifiedKey);
			if (!stockSendLock) {
				logger.debug(`[Reminder] User ${settings.userId}: stock reminder lock already held, skipping duplicate send`);
			} else {
				try {
					logger.info(
						`[Reminder] User ${settings.userId}: Sending stock reminder for ${allLowStock.length} medications...`
					);

					let emailSuccess = false;
					let shoutrrrSuccess = false;

					if (stockEmailEnabled) {
						const result = await sendReminderEmail(
							settings.notificationEmail!,
							allLowStock,
							language,
							settings.repeatDailyReminders
						);
						emailSuccess = result.success;
						if (!result.success) {
							logger.error(`[Reminder] User ${settings.userId}: Failed to send stock email: ${result.error}`);
						}
					}

					if (stockPushEnabled) {
						const emptyMeds = allLowStock.filter((m) => m.medsLeft <= 0);
						const criticalMeds = allLowStock.filter((m) => m.medsLeft > 0 && m.isCritical);
						const lowStockMeds = allLowStock.filter((m) => m.medsLeft > 0 && !m.isCritical);

						const titleParts: string[] = [];
						if (emptyMeds.length > 0) titleParts.push(`🚨 ${emptyMeds.length} ${tr.push.empty}`);
						if (criticalMeds.length > 0) titleParts.push(`🚨 ${criticalMeds.length} ${tr.push.critical}`);
						if (lowStockMeds.length > 0) titleParts.push(`⚠️ ${lowStockMeds.length} ${tr.push.lowStock}`);
						const title = `MedAssist-ng: ${titleParts.join(", ")} - ${tr.push.reorderNow}`;

						const messageParts: string[] = [];
						if (emptyMeds.length > 0) {
							messageParts.push(`🚨 ${tr.push.emptySection}:`);
							emptyMeds.forEach((m) => messageParts.push(`  • ${m.name}`));
						}
						if (criticalMeds.length > 0) {
							if (messageParts.length > 0) messageParts.push("");
							messageParts.push(`🚨 ${tr.push.criticalSection}:`);
							criticalMeds.forEach((m) =>
								messageParts.push(
									`  • ${m.name}: ${m.medsLeft} ${getMedicationUnitLabel(m.packageType, m.medicationForm, tr)}, ${t(tr.push.daysLeft, { count: m.daysLeft ?? 0 })}`
								)
							);
						}
						if (lowStockMeds.length > 0) {
							if (messageParts.length > 0) messageParts.push("");
							messageParts.push(`⚠️ ${tr.push.lowStockSection}:`);
							lowStockMeds.forEach((m) =>
								messageParts.push(
									`  • ${m.name}: ${m.medsLeft} ${getMedicationUnitLabel(m.packageType, m.medicationForm, tr)}, ${t(tr.push.daysLeft, { count: m.daysLeft ?? 0 })}`
								)
							);
						}
						const message = `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`;
						const result = await sendShoutrrrNotification(settings.shoutrrrUrl!, title, message);
						shoutrrrSuccess = result.success;
						if (!result.success) {
							logger.error(`[Reminder] User ${settings.userId}: Failed to send stock push: ${result.error}`);
						}
					}

					if (emailSuccess || shoutrrrSuccess) {
						const currentState = loadReminderState();
						const singleChannel = emailSuccess ? "email" : "push";
						const channel = emailSuccess && shoutrrrSuccess ? "both" : singleChannel;
						saveReminderState({
							lastAutoEmailSent: new Date().toISOString(),
							lastAutoEmailDate: today,
							lastStockSchedulerCheckDate: currentState.lastStockSchedulerCheckDate,
							notifiedMedications: [...new Set([...currentState.notifiedMedications, userStockNotifiedKey])],
							nextScheduledCheck: currentState.nextScheduledCheck,
							lastNotificationType: "stock",
							lastNotificationChannel: channel,
						});

						const medNames = allLowStock.map((m) => m.name).join(", ");
						await updateUserReminderSentTime(settings.userId, "stock", channel, medNames);
					}
				} finally {
					releaseReminderSendLock(stockSendLock);
				}
			}
		}
	}

	if (allPrescriptionLow.length > 0 && (prescriptionEmailEnabled || prescriptionPushEnabled)) {
		if (!state.notifiedMedications.includes(userPrescriptionNotifiedKey) || settings.repeatDailyReminders) {
			const prescriptionSendLock = acquireReminderSendLock(userPrescriptionNotifiedKey);
			if (!prescriptionSendLock) {
				logger.debug(
					`[Reminder] User ${settings.userId}: prescription reminder lock already held, skipping duplicate send`
				);
			} else {
				try {
					// Re-check using fresh state after acquiring lock and pre-mark today as notified.
					// This blocks duplicate sends when two reminder checks overlap in time.
					const lockedState = loadReminderState();
					const alreadyNotified = lockedState.notifiedMedications.includes(userPrescriptionNotifiedKey);
					const shouldSend = !alreadyNotified || settings.repeatDailyReminders;
					if (!shouldSend) {
						logger.debug(
							`[Reminder] User ${settings.userId}: prescription reminder already marked as sent today, skipping`
						);
					}

					const preMarkedNotified =
						!shouldSend || alreadyNotified
							? lockedState.notifiedMedications
							: [...new Set([...lockedState.notifiedMedications, userPrescriptionNotifiedKey])];
					if (shouldSend && !alreadyNotified) {
						saveReminderState({
							lastAutoEmailSent: lockedState.lastAutoEmailSent,
							lastAutoEmailDate: lockedState.lastAutoEmailDate,
							lastStockSchedulerCheckDate: lockedState.lastStockSchedulerCheckDate,
							notifiedMedications: preMarkedNotified,
							nextScheduledCheck: lockedState.nextScheduledCheck,
							lastNotificationType: lockedState.lastNotificationType,
							lastNotificationChannel: lockedState.lastNotificationChannel,
						});
					}

					if (shouldSend) {
						logger.info(
							`[Reminder] User ${settings.userId}: Sending prescription reminder for ${allPrescriptionLow.length} medications...`
						);

						const emptyRx = allPrescriptionLow.filter((m) => m.remainingRefills <= 0);
						const lowRx = allPrescriptionLow.filter((m) => m.remainingRefills > 0);
						const lines = allPrescriptionLow.map((m) => {
							const expirySuffix = m.expiryDate ? t(tr.prescriptionReminder.expiresSuffix, { date: m.expiryDate }) : "";
							if (m.remainingRefills <= 0) {
								return `- ${t(tr.prescriptionReminder.lineEmpty, {
									name: m.name,
									expirySuffix,
								})}`;
							}
							return `- ${t(tr.prescriptionReminder.line, {
								name: m.name,
								refills: m.remainingRefills,
								expirySuffix,
							})}`;
						});

						let emailSuccess = false;
						let shoutrrrSuccess = false;

						if (prescriptionEmailEnabled) {
							const smtpHost = process.env.SMTP_HOST;
							const smtpUser = process.env.SMTP_USER;
							const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS;
							const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
							const smtpSecure = process.env.SMTP_SECURE === "true";
							const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

							if (smtpHost && smtpUser) {
								try {
									const transporter = nodemailer.createTransport({
										host: smtpHost,
										port: smtpPort,
										secure: smtpSecure,
										auth: { user: smtpUser, pass: smtpPass ?? "" },
									});

									const subject =
										allPrescriptionLow.length === 1
											? tr.prescriptionReminder.subjectSingle
											: t(tr.prescriptionReminder.subjectMultiple, { count: allPrescriptionLow.length });

									const bodyText =
										emptyRx.length > 0
											? tr.prescriptionReminder.descriptionEmpty
											: tr.prescriptionReminder.descriptionLow;
									const emptyAlert =
										emptyRx.length === 1
											? tr.prescriptionReminder.alertEmptySingle
											: t(tr.prescriptionReminder.alertEmptyMultiple, { count: emptyRx.length });
									const lowAlert =
										lowRx.length === 1
											? tr.prescriptionReminder.alertLowSingle
											: t(tr.prescriptionReminder.alertLowMultiple, { count: lowRx.length });
									const alertText = emptyRx.length > 0 ? emptyAlert : lowAlert;

									const tableRows = allPrescriptionLow
										.map((item) => {
											const isEmpty = item.remainingRefills <= 0;
											const safeName = escapeHtml(item.name);
											const safeRefills = Number(item.remainingRefills) || 0;
											const safeThreshold = Number(item.lowThreshold) || 0;
											const safeExpiry = item.expiryDate ? escapeHtml(String(item.expiryDate)) : "-";
											const rowBg = isEmpty ? "#fef2f2" : "white";
											return `
      <tr style="background: ${rowBg};">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${isEmpty ? "🚨" : "⚠️"} ${safeName}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; ${isEmpty ? "color: #dc2626; font-weight: 600;" : ""}"><strong>${safeRefills}</strong></td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${safeThreshold}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${safeExpiry}</td>
      </tr>`;
										})
										.join("");

									const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${emptyRx.length > 0 ? tr.prescriptionReminder.titleEmpty : tr.prescriptionReminder.title}</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${bodyText}</p>

        <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; ${
					emptyRx.length > 0
						? "background: #fef2f2; border: 1px solid #dc2626;"
						: "background: #fffbeb; border: 1px solid #f59e0b;"
				}">
          <p style="margin: 0; ${emptyRx.length > 0 ? "color: #dc2626; font-weight: 600;" : "color: #b45309; font-weight: 500;"} font-size: 13px;">
            ${alertText}
          </p>
        </div>

        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; background: white; min-width: 460px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.medication}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.refillsLeft}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.reminderThreshold}</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.prescriptionExpires}</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          ${getFooterHtml(language)}
        </p>
        ${settings.repeatDailyReminders ? `<p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0 0; font-style: italic;">${tr.prescriptionReminder.repeatDailyNote}</p>` : ""}
      </div>
    </div>
  `;
									const text = `${emptyRx.length > 0 ? tr.prescriptionReminder.titleEmpty : tr.prescriptionReminder.title}\n\n${bodyText}\n\n${lines.join("\n")}\n\n---\n${getFooterPlain(language)}${settings.repeatDailyReminders ? `\n\n${tr.prescriptionReminder.repeatDailyNote}` : ""}`;

									await transporter.sendMail({
										from: smtpFrom,
										to: settings.notificationEmail!,
										subject,
										text,
										html,
									});
									emailSuccess = true;
								} catch (error) {
									const errorMessage = error instanceof Error ? error.message : "Unknown error";
									logger.error(
										`[Reminder] User ${settings.userId}: Failed to send prescription email: ${errorMessage}`
									);
								}
							}
						}

						if (prescriptionPushEnabled) {
							const titleParts: string[] = [];
							if (emptyRx.length > 0)
								titleParts.push(
									`🚨 ${emptyRx.length} ${emptyRx.length === 1 ? tr.prescriptionReminder.pushEmptySingle : tr.prescriptionReminder.pushEmpty}`
								);
							if (lowRx.length > 0)
								titleParts.push(
									`🚨 ${lowRx.length} ${lowRx.length === 1 ? tr.prescriptionReminder.pushLowSingle : tr.prescriptionReminder.pushLow}`
								);
							const title = `MedAssist-ng: ${titleParts.join(", ")} - ${tr.prescriptionReminder.pushRenewNow}`;

							const messageParts: string[] = [];
							if (emptyRx.length > 0) {
								messageParts.push(`🚨 ${tr.prescriptionReminder.pushEmptySection}:`);
								for (const m of emptyRx) {
									messageParts.push(`  • ${m.name}`);
								}
							}
							if (lowRx.length > 0) {
								if (emptyRx.length > 0) messageParts.push("");
								messageParts.push(`🚨 ${tr.prescriptionReminder.pushLowSection}:`);
								for (const m of lowRx) {
									messageParts.push(
										`  • ${m.name}: ${t(tr.prescriptionReminder.pushRefillsLeft, { count: m.remainingRefills })}`
									);
								}
							}
							const message = `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`;
							const result = await sendShoutrrrNotification(settings.shoutrrrUrl!, title, message);
							shoutrrrSuccess = result.success;
							if (!result.success) {
								logger.error(`[Reminder] User ${settings.userId}: Failed to send prescription push: ${result.error}`);
							}
						}

						if (emailSuccess || shoutrrrSuccess) {
							const currentState = loadReminderState();
							const singleChannel = emailSuccess ? "email" : "push";
							const channel = emailSuccess && shoutrrrSuccess ? "both" : singleChannel;
							saveReminderState({
								lastAutoEmailSent: new Date().toISOString(),
								lastAutoEmailDate: today,
								lastStockSchedulerCheckDate: currentState.lastStockSchedulerCheckDate,
								notifiedMedications: [...new Set([...currentState.notifiedMedications, userPrescriptionNotifiedKey])],
								nextScheduledCheck: currentState.nextScheduledCheck,
								lastNotificationType: "prescription",
								lastNotificationChannel: channel,
							});

							const medNames = allPrescriptionLow.map((m) => m.name).join(", ");
							await updateUserReminderSentTime(settings.userId, "prescription", channel, medNames);
						} else if (!alreadyNotified) {
							// Roll back pre-mark when both channels failed so retries remain possible.
							const currentState = loadReminderState();
							saveReminderState({
								lastAutoEmailSent: currentState.lastAutoEmailSent,
								lastAutoEmailDate: currentState.lastAutoEmailDate,
								lastStockSchedulerCheckDate: currentState.lastStockSchedulerCheckDate,
								notifiedMedications: currentState.notifiedMedications.filter(
									(key) => key !== userPrescriptionNotifiedKey
								),
								nextScheduledCheck: currentState.nextScheduledCheck,
								lastNotificationType: currentState.lastNotificationType,
								lastNotificationChannel: currentState.lastNotificationChannel,
							});
						}
					}
				} finally {
					releaseReminderSendLock(prescriptionSendLock);
				}
			}
		}
	}
}

let schedulerTimeout: NodeJS.Timeout | null = null;
let schedulerStarted = false;

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
	if (schedulerStarted) {
		logger.info(`[Reminder] Scheduler already started, skipping duplicate start call`);
		return;
	}
	schedulerStarted = true;
	logger.info(`[Reminder] Starting reminder scheduler (timezone: ${getTimezone()})...`);

	// Check if we need to run immediately (missed today's check)
	const state = loadReminderState();
	const today = getTodayInTimezone();
	const currentHour = getCurrentHourInTimezone();

	// If it's past REMINDER_HOUR today in the configured timezone and we haven't checked today, run one catch-up.
	// This is intentionally a single current-state snapshot (no replay of missed days).
	if (currentHour >= REMINDER_HOUR && state.lastStockSchedulerCheckDate !== today) {
		logger.info("[Reminder] Missed today's check, running one catch-up snapshot (no historical replay)...");
		checkAndSendReminder(logger).catch((err) => logger.error(`[Reminder] Error: ${err}`));
	}

	// Schedule next check at REMINDER_HOUR
	scheduleNextCheck(logger);

	logger.info(`[Reminder] Scheduler started - daily check at ${REMINDER_HOUR}:00 ${getTimezone()}`);
}

export async function runReminderSchedulerNow(logger: ServiceLogger): Promise<void> {
	logger.info(`[Reminder] Manual trigger: running reminder check now (${getTimezone()})`);
	await checkAndSendReminder(logger);
}

export function stopReminderScheduler(): void {
	if (schedulerTimeout) {
		clearTimeout(schedulerTimeout);
		schedulerTimeout = null;
	}
	schedulerStarted = false;
}
