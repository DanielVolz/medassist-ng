import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, gte, lte } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { getDataDir } from "../db/db-utils.js";
import { doseTracking, medications, users } from "../db/schema.js";
import {
	getDateLocale,
	getFooterHtml,
	getFooterPlain,
	getTranslations,
	type Language,
	t,
} from "../i18n/translations.js";
import { getAllUserSettings, sendShoutrrrNotification, type UserSettings } from "../routes/settings.js";
import type { ServiceLogger } from "../utils/logger.js";
// Import shared utilities
import {
	cleanOldIntakeReminders,
	createDefaultIntakeReminderState,
	getTimezone,
	getTodaysIntakes,
	getUpcomingIntakes,
	type IntakeReminderState,
	normalizeIntakeUsageForStock,
	parseIntakeReminderState,
	parseIntakesJson,
	parseTakenByJson,
	type UpcomingIntake,
} from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStock } from "./current-stock.js";
import { updateReminderSentTime, updateUserReminderSentTime } from "./reminder-scheduler.js";

const REMINDER_MINUTES_BEFORE = parseInt(process.env.REMINDER_MINUTES_BEFORE ?? "15", 10);
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute

const intakeReminderStateFile = resolve(getDataDir(), "intake-reminder-state.json");

function loadIntakeReminderState(): IntakeReminderState {
	try {
		if (existsSync(intakeReminderStateFile)) {
			return parseIntakeReminderState(readFileSync(intakeReminderStateFile, "utf-8"));
		}
	} catch {
		// ignore
	}
	return createDefaultIntakeReminderState();
}

function saveIntakeReminderState(state: IntakeReminderState): void {
	writeFileSync(intakeReminderStateFile, JSON.stringify(state, null, 2));
}

type MailDeliveryInfo = {
	accepted?: unknown;
	rejected?: unknown;
	response?: unknown;
};

function normalizeRecipients(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getDeliveryError(info: MailDeliveryInfo): string | null {
	const accepted = normalizeRecipients(info.accepted);
	const rejected = normalizeRecipients(info.rejected);

	if (accepted.length > 0) return null;
	if (rejected.length > 0) {
		return `SMTP rejected all recipients: ${rejected.join(", ")}`;
	}

	if (typeof info.response === "string" && info.response.trim()) {
		return `SMTP did not confirm accepted recipients. Response: ${info.response}`;
	}

	return "SMTP did not confirm accepted recipients.";
}

function buildDoseIdForIntake(intake: UpcomingIntake & { medicationId: number; blisterIndex: number }): string {
	const intakeDate = intake.intakeTime;
	const dateOnlyMs = new Date(intakeDate.getFullYear(), intakeDate.getMonth(), intakeDate.getDate()).getTime();
	if (intake.takenBy) {
		return `${intake.medicationId}-${intake.blisterIndex}-${dateOnlyMs}-${intake.takenBy}`;
	}
	return `${intake.medicationId}-${intake.blisterIndex}-${dateOnlyMs}`;
}

async function resolveSchedulerUserDisplayName(userId: number): Promise<string> {
	const [userRow] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
	return userRow?.username?.trim() || `unknown-user-${userId}`;
}

function formatIntakeDescriptor(
	definitionIndex: number,
	medicationName: string,
	medicationId: number,
	intake: { every: number; usage: number; start: string; intakeRemindersEnabled: boolean; takenBy: string | null }
): string {
	const takenByPart = intake.takenBy ? `, takenBy=${intake.takenBy}` : "";
	return `Intake #${definitionIndex + 1} (index=${definitionIndex}, medication=${medicationName}, medicationId=${medicationId}, start=${intake.start}, every=${intake.every}d, usage=${intake.usage}, reminderEnabled=${intake.intakeRemindersEnabled}${takenByPart})`;
}

async function autoMarkDueIntakesAsTaken(
	settings: UserSettings & { userId: number },
	rows: (typeof medications.$inferSelect)[],
	locale: string,
	tz: string,
	logger: ServiceLogger
): Promise<number> {
	if (settings.stockCalculationMode !== "automatic") {
		return 0;
	}

	const now = new Date();
	const nowInTimezone = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	const todayStart = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayStart.setHours(0, 0, 0, 0);
	const todayEnd = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayEnd.setHours(23, 59, 59, 999);

	const existingToday = await db
		.select({ doseId: doseTracking.doseId })
		.from(doseTracking)
		.where(
			and(
				eq(doseTracking.userId, settings.userId),
				gte(doseTracking.takenAt, todayStart),
				lte(doseTracking.takenAt, todayEnd)
			)
		);
	const existingDoseIds = new Set(existingToday.map((d) => d.doseId));
	const trackedDoses = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, settings.userId), eq(doseTracking.dismissed, false)));

	let inserted = 0;

	for (const med of rows) {
		if (med.isObsolete) {
			continue;
		}

		const intakes = parseIntakesJson(
			med.intakesJson,
			{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
			med.intakeRemindersEnabled ?? false
		);
		if (intakes.length === 0) {
			continue;
		}

		const medicationTakenBy = parseTakenByJson(med.takenByJson);
		const medDisplayName = med.name || med.genericName || "";
		let remainingStock = computeMedicationCurrentStock({
			medication: med,
			doses: trackedDoses,
			stockCalculationMode: settings.stockCalculationMode,
			nowMs: now.getTime(),
		});
		if (remainingStock <= 0) {
			continue;
		}
		const todaysIntakes = getTodaysIntakes(
			medDisplayName,
			intakes,
			medicationTakenBy,
			med.pillWeightMg,
			locale,
			tz,
			med.id,
			med.doseUnit ?? "mg"
		);

		for (const intake of todaysIntakes) {
			const intakeTimeInTimezone = new Date(intake.intakeTime.toLocaleString("en-US", { timeZone: tz }));
			if (intakeTimeInTimezone.getTime() > nowInTimezone.getTime()) {
				continue;
			}
			if (intake.medicationId === undefined || intake.blisterIndex === undefined) {
				continue;
			}

			const doseId = buildDoseIdForIntake({
				...intake,
				medicationId: intake.medicationId,
				blisterIndex: intake.blisterIndex,
			});

			if (existingDoseIds.has(doseId)) {
				continue;
			}

			const intakeDefinition = intakes[intake.blisterIndex];
			const usage = intakeDefinition
				? normalizeIntakeUsageForStock(intakeDefinition, med.medicationForm, med.packageType)
				: 0;
			if (remainingStock <= 0) {
				break;
			}

			await db.insert(doseTracking).values({
				userId: settings.userId,
				doseId,
				takenAt: intake.intakeTime,
				markedBy: null,
				takenSource: "automatic",
				dismissed: false,
			});

			existingDoseIds.add(doseId);
			trackedDoses.push({
				id: 0,
				userId: settings.userId,
				doseId,
				takenAt: intake.intakeTime,
				markedBy: null,
				takenSource: "automatic",
				dismissed: false,
			});
			remainingStock = Math.max(0, remainingStock - usage);
			inserted++;
		}
	}

	if (inserted > 0) {
		logger.info(`[IntakeReminder] Auto-marked ${inserted} due intake dose(s) as taken`);
	}

	return inserted;
}

async function sendIntakeReminderEmail(
	email: string,
	intakes: UpcomingIntake[],
	language: Language,
	isRepeat: boolean = false,
	repeatIntervalMinutes?: number,
	currentCount?: number,
	maxCount?: number
): Promise<{ success: boolean; error?: string; messageId?: string; smtpResponse?: string }> {
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

	// Helper to format dosage with weight
	const formatDosage = (intake: UpcomingIntake): string => {
		const pillText = `<strong>${intake.usage}</strong> ${intake.usage === 1 ? tr.common.pill : tr.intakeReminder.pills}`;
		if (intake.pillWeightMg) {
			const totalMg = intake.usage * intake.pillWeightMg;
			const weightStr = totalMg >= 1000 ? `${(totalMg / 1000).toFixed(1)} g` : `${totalMg} mg`;
			return `${pillText} (${weightStr})`;
		}
		return pillText;
	};

	// Helper to format medication name with takenBy (single person or null)
	const formatMedName = (intake: UpcomingIntake): string => {
		if (intake.takenBy) {
			return `${intake.medName} <span style="color: #6b7280; font-size: 12px;">${t(tr.intakeReminder.takenBy, { name: intake.takenBy })}</span>`;
		}
		return intake.medName;
	};

	const tableRows = intakes
		.map(
			(intake) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${formatMedName(intake)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${formatDosage(intake)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${intake.intakeTimeStr}</td>
      </tr>
    `
		)
		.join("");

	const alertText =
		intakes.length === 1
			? tr.intakeReminder.alertSingle
			: t(tr.intakeReminder.alertMultiple, { count: intakes.length });

	// Different description for repeat reminders
	let description: string;
	if (isRepeat && repeatIntervalMinutes && currentCount !== undefined && maxCount !== undefined) {
		const remainingReminders = maxCount - currentCount;
		if (remainingReminders <= 0) {
			description = language === "de" ? "⚠️ Dies ist die letzte Erinnerung." : "⚠️ This is the last reminder.";
		} else if (remainingReminders === 1) {
			description =
				language === "de"
					? `ℹ️ Eine weitere Erinnerung wird in ${repeatIntervalMinutes} Minuten gesendet.`
					: `ℹ️ One more reminder will be sent in ${repeatIntervalMinutes} minutes.`;
		} else {
			description =
				language === "de"
					? `ℹ️ ${remainingReminders} weitere Erinnerungen werden alle ${repeatIntervalMinutes} Minuten gesendet.`
					: `ℹ️ ${remainingReminders} more reminders will be sent every ${repeatIntervalMinutes} minutes.`;
		}
	} else {
		description = t(tr.intakeReminder.description, { minutes: REMINDER_MINUTES_BEFORE });
	}

	const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${tr.intakeReminder.title}</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${description}</p>
        
        <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #eff6ff; border: 1px solid #bfdbfe;">
          <p style="margin: 0; color: #1e40af; font-weight: 500; font-size: 13px;">
            ${alertText}
          </p>
        </div>

        <table style="width: 100%; border-collapse: collapse; background: white;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280;">${tr.intakeReminder.tableHeaders.medication}</th>
              <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280;">${tr.intakeReminder.tableHeaders.dosage}</th>
              <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280;">${tr.intakeReminder.tableHeaders.time}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          ${getFooterHtml(language)}
        </p>
      </div>
    </div>
  `;

	// Helper for plain text dosage
	const formatDosagePlain = (intake: UpcomingIntake): string => {
		const pillText = `${intake.usage} ${intake.usage === 1 ? tr.common.pill : tr.intakeReminder.pills}`;
		if (intake.pillWeightMg) {
			const totalMg = intake.usage * intake.pillWeightMg;
			const weightStr = totalMg >= 1000 ? `${(totalMg / 1000).toFixed(1)} g` : `${totalMg} mg`;
			return `${pillText} (${weightStr})`;
		}
		return pillText;
	};

	const plainText = `${tr.intakeReminder.title}

${description}

${intakes
	.map((i) => {
		const takenByStr = i.takenBy ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy })}` : "";
		return `${i.medName}${takenByStr}: ${formatDosagePlain(i)} - ${i.intakeTimeStr}`;
	})
	.join("\n")}

---
${getFooterPlain(language)}`;

	const subject = isRepeat
		? `[Reminder] ${t(tr.intakeReminder.subject, { medications: intakes.map((i) => i.medName).join(", ") })}`
		: t(tr.intakeReminder.subject, { medications: intakes.map((i) => i.medName).join(", ") });

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

		const mailResult = await transporter.sendMail({
			from: smtpFrom,
			to: email,
			subject: `💊 ${subject}`,
			text: plainText,
			html,
		});

		const deliveryError = getDeliveryError(mailResult);
		if (deliveryError) {
			return { success: false, error: deliveryError };
		}

		return {
			success: true,
			messageId: mailResult.messageId,
			smtpResponse: typeof mailResult.response === "string" ? mailResult.response : undefined,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}

async function checkAndSendIntakeReminders(logger: ServiceLogger): Promise<void> {
	logger.debug(`[IntakeReminder] Checking for intake reminders...`);

	// Get all user settings to iterate over each user
	const allUserSettings = await getAllUserSettings();

	if (allUserSettings.length === 0) {
		logger.debug(`[IntakeReminder] No users with settings found`);
		return; // No users with settings
	}

	logger.debug(`[IntakeReminder] Evaluating ${allUserSettings.length} intake profile(s) for auto-marking`);

	for (const userSettings of allUserSettings) {
		await checkAndSendIntakeRemindersForUser(userSettings, logger);
	}
}

export async function checkAndSendIntakeRemindersForUser(
	settings: UserSettings & { userId: number },
	logger: ServiceLogger
): Promise<void> {
	const language = settings.language;
	const tr = getTranslations(language);
	const schedulerUserName = await resolveSchedulerUserDisplayName(settings.userId);

	logger.debug(`[IntakeReminder] Evaluating intake reminder profile for user '${schedulerUserName}'`);

	const rows = await db
		.select()
		.from(medications)
		.where(eq(medications.userId, settings.userId))
		.orderBy(medications.id);

	const locale = getDateLocale(language);
	const tz = getTimezone();

	await autoMarkDueIntakesAsTaken(settings, rows, locale, tz, logger);

	// Check if any intake reminder notifications are enabled (granular check)
	const emailEnabled = settings.emailEnabled && settings.notificationEmail && settings.emailIntakeReminders;
	const shoutrrrEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrIntakeReminders;

	if (!emailEnabled && !shoutrrrEnabled) {
		return; // No intake reminder notifications enabled for this user
	}

	logger.debug(
		`[IntakeReminder] Notifications enabled for current scheduler context (email:${emailEnabled}, shoutrrr:${shoutrrrEnabled})`
	);

	// Build medication entries that have at least one reminder-enabled intake.
	// Intake-level reminders are the single source of truth.
	const reminderEntries = rows
		.map((med) => {
			const intakes = parseIntakesJson(
				med.intakesJson,
				{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
				false
			);
			const intakesWithReminders = intakes.filter((intake) => intake.intakeRemindersEnabled === true);
			return { med, intakes, intakesWithReminders };
		})
		.filter((entry) => entry.intakesWithReminders.length > 0);

	if (reminderEntries.length === 0) {
		logger.debug("[IntakeReminder] No medications have reminders enabled for current scheduler context");
		return; // No medications have reminders enabled for this user
	}

	logger.debug(`[IntakeReminder] Found ${reminderEntries.length} medications with reminders`);

	const state = loadIntakeReminderState();
	const allUpcoming: (UpcomingIntake & { medicationId: number; blisterIndex: number })[] = [];
	let scheduledIntakesTodayCount = 0;
	// Get start and end of today in user's timezone (for filtering today's doses only)
	const now = new Date();
	const checkMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
	const checkMinuteEnd = new Date(checkMinuteStart.getTime() + 60000);
	const todayStart = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayStart.setHours(0, 0, 0, 0);

	const todayEnd = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayEnd.setHours(23, 59, 59, 999);

	logger.debug(`[IntakeReminder] Today range: ${todayStart.toISOString()} to ${todayEnd.toISOString()}`);

	// Find intakes: upcoming ones in reminder window + past ones for repeat reminders
	for (const { med, intakes, intakesWithReminders } of reminderEntries) {
		// Medication-level takenBy (for fallback/display purposes)
		const medicationTakenBy = parseTakenByJson(med.takenByJson);
		const medDisplayName = med.name || med.genericName || "";

		logger.debug(
			`[IntakeReminder] Processing medication '${medDisplayName}' (id=${med.id}) with ${intakes.length} intake definition(s)`
		);

		// Process each intake separately to track blisterIndex
		intakesWithReminders.forEach((intake, _blisterIndex) => {
			const actualIndex = intakes.indexOf(intake); // Get the actual index in original array
			const intakeDescriptor = formatIntakeDescriptor(actualIndex, medDisplayName, med.id, intake);
			logger.debug(`[IntakeReminder] ${intakeDescriptor}`);

			const todaysIntakesForThisDefinition = getTodaysIntakes(
				medDisplayName,
				[intake],
				medicationTakenBy,
				med.pillWeightMg,
				locale,
				tz,
				med.id,
				med.doseUnit ?? "mg"
			);
			scheduledIntakesTodayCount += todaysIntakesForThisDefinition.length;

			// Always get upcoming intakes (15 min before) for first reminders
			const upcomingIntakes = getUpcomingIntakes(
				medDisplayName,
				[intake],
				REMINDER_MINUTES_BEFORE,
				medicationTakenBy,
				med.pillWeightMg,
				locale,
				tz,
				undefined, // nowOverride
				med.id,
				med.doseUnit ?? "mg"
			);
			logger.debug(
				`[IntakeReminder] ${intakeDescriptor} -> ${upcomingIntakes.length} intake(s) currently due for advance reminder (default ${REMINDER_MINUTES_BEFORE} min before intake, with catch-up while intake is still in the future)`
			);
			logger.debug(
				`[IntakeReminder] ${intakeDescriptor} -> ${todaysIntakesForThisDefinition.length} scheduled intake(s) today (independent of reminder window)`
			);

			// Add upcoming intakes for first reminders
			allUpcoming.push(
				...upcomingIntakes.map((upcomingIntake) => ({
					...upcomingIntake,
					medicationId: med.id,
					blisterIndex: actualIndex,
				}))
			);

			// If repeat reminders enabled, also check for missed intakes (past the intake time)
			if (settings.repeatRemindersEnabled) {
				logger.debug(
					`[IntakeReminder] ${intakeDescriptor} -> ${todaysIntakesForThisDefinition.length} candidate intake(s) for repeat reminders`
				);
				const missedIntakes = todaysIntakesForThisDefinition.filter(
					(todayIntake) => todayIntake.intakeTime.getTime() < now.getTime()
				);
				logger.debug(
					`[IntakeReminder] ${intakeDescriptor} -> ${missedIntakes.length} missed intake(s) (past intake time)`
				);

				// Add missed intakes for repeat reminders (only if not already in upcoming list)
				const upcomingTimes = new Set(upcomingIntakes.map((i) => i.intakeTime.getTime()));
				allUpcoming.push(
					...missedIntakes
						.filter((missed) => !upcomingTimes.has(missed.intakeTime.getTime()))
						.map((missed) => ({
							...missed,
							medicationId: med.id,
							blisterIndex: actualIndex,
						}))
				);
			}
		});
	}

	logger.debug(`[IntakeReminder] Total scheduled intakes for today: ${scheduledIntakesTodayCount}`);
	logger.debug(`[IntakeReminder] Total reminder candidates in current check: ${allUpcoming.length}`);

	if (allUpcoming.length === 0) {
		logger.debug(
			`[IntakeReminder] No reminder due in this check window (minute=${checkMinuteStart.toISOString()}..${checkMinuteEnd.toISOString()}, advanceLead=${REMINDER_MINUTES_BEFORE}m, plus catch-up while intake is still future)`
		);
		return; // No upcoming intakes for today
	}

	// Determine which doses need reminders (new or repeated)
	const nowMs = Date.now();
	const maxReminders = settings.maxNaggingReminders ?? 5;
	type ReminderWithCount = (typeof allUpcoming)[number] & {
		currentSendCount: number; // 0 = advance reminder (no counter), 1+ = nagging count
		maxReminders: number;
		isAdvanceReminder: boolean; // true if this is the 15-min-before reminder
	};
	let remindersToSend: ReminderWithCount[] = [];

	for (const intake of allUpcoming) {
		const key = `user_${settings.userId}:${intake.medName}:${intake.intakeTime.getTime()}`;
		const existingEntry = state.reminders[key];
		const intakeTimeMs = intake.intakeTime.getTime();
		const isIntakePast = intakeTimeMs < nowMs;

		if (!existingEntry) {
			// New dose - send first reminder
			if (isIntakePast) {
				// Intake time already passed and we have no state entry. Check how recently it was missed.
				const minutesSinceIntake = (nowMs - intakeTimeMs) / 60000;
				const gracePeriodMinutes = (settings.reminderRepeatIntervalMinutes ?? 30) + REMINDER_MINUTES_BEFORE;

				if (minutesSinceIntake <= gracePeriodMinutes) {
					// Recently missed — scheduler likely recovered from sleep/restart.
					// Send a catch-up reminder (counts as first nagging reminder).
					remindersToSend.push({ ...intake, currentSendCount: 1, maxReminders, isAdvanceReminder: false });
					logger.info(
						`[IntakeReminder] Catch-up reminder for recently missed intake (${Math.round(minutesSinceIntake)} min ago)`
					);
				} else {
					// Long ago — seed state without notification (user likely already noticed)
					state.reminders[key] = {
						firstSentAt: nowMs,
						lastSentAt: nowMs,
						sendCount: 0,
						advanceSent: false,
					};
					logger.debug(
						`[IntakeReminder] Seeding state for old past intake (no notification — ${Math.round(minutesSinceIntake)} min ago)`
					);
				}
			} else {
				// Upcoming - this is advance reminder (no counter)
				remindersToSend.push({ ...intake, currentSendCount: 0, maxReminders, isAdvanceReminder: true });
				logger.debug("[IntakeReminder] Advance reminder candidate added");
			}
		} else if (settings.repeatRemindersEnabled && isIntakePast) {
			// Intake time passed - check if we need to send nagging reminder
			const intervalMs = settings.reminderRepeatIntervalMinutes * 60 * 1000;
			const timeSinceLastReminder = nowMs - existingEntry.lastSentAt;

			// If only advance reminder was sent (sendCount=0), first nagging has count=1
			// Otherwise increment from current sendCount
			const currentNaggingCount = existingEntry.sendCount;

			if (currentNaggingCount >= maxReminders) {
				// Max nagging reminders reached - stop
				logger.debug(`[IntakeReminder] Max nagging (${maxReminders}) reached for intake reminder key`);
			} else if (timeSinceLastReminder >= intervalMs) {
				const nextSendCount = currentNaggingCount + 1;
				remindersToSend.push({ ...intake, currentSendCount: nextSendCount, maxReminders, isAdvanceReminder: false });
				logger.debug(`[IntakeReminder] Nagging reminder candidate added (${nextSendCount}/${maxReminders})`);
			}
		}
		// Else: Already sent and either repeats disabled or intake not yet past - skip
	}

	if (remindersToSend.length === 0) {
		return; // All reminders already sent and no repeats needed
	}

	// If skipRemindersForTakenDoses is enabled, filter out doses that were already taken today
	if (settings.skipRemindersForTakenDoses) {
		// Query doses marked as taken today (takenAt is timestamp, stored as seconds since epoch)
		const takenToday = await db
			.select()
			.from(doseTracking)
			.where(
				and(
					eq(doseTracking.userId, settings.userId),
					gte(doseTracking.takenAt, todayStart),
					lte(doseTracking.takenAt, todayEnd)
				)
			);

		const takenDoseIds = new Set(takenToday.map((d) => d.doseId));

		// Filter out reminders for doses that were already taken
		remindersToSend = remindersToSend.filter((intake) => {
			// Convert to date-only timestamp (midnight) to match frontend dose ID format
			const intakeDate = intake.intakeTime;
			const dateOnlyMs = new Date(intakeDate.getFullYear(), intakeDate.getMonth(), intakeDate.getDate()).getTime();

			// Check both with and without person suffix
			if (intake.takenBy) {
				// For person-specific intake, check if that person has taken it
				const doseId = `${intake.medicationId}-${intake.blisterIndex}-${dateOnlyMs}-${intake.takenBy}`;
				const isTaken = takenDoseIds.has(doseId);
				if (isTaken) {
					logger.debug("[IntakeReminder] Skipping reminder candidate - dose already taken");
				}
				return !isTaken;
			} else {
				// For non-person-specific intakes
				const doseId = `${intake.medicationId}-${intake.blisterIndex}-${dateOnlyMs}`;
				const isTaken = takenDoseIds.has(doseId);
				if (isTaken) {
					logger.debug("[IntakeReminder] Skipping reminder candidate - dose already taken");
				}
				return !isTaken;
			}
		});

		if (remindersToSend.length === 0) {
			logger.debug("[IntakeReminder] All doses taken, skipping reminders");
			return;
		}
	}

	logger.info(`[IntakeReminder] Sending reminder for ${remindersToSend.length} intakes...`);

	// Determine if this is a repeat reminder:
	// - Any intake already has a state entry AND is past (repeat after first reminder)
	// - OR intake is past even without state entry (missed the 15-min window)
	const isRepeatReminder = remindersToSend.some((intake) => {
		const intakeTimeMs = intake.intakeTime.getTime();
		const isIntakePast = intakeTimeMs < nowMs;
		return isIntakePast; // Use repeat message for ANY missed intake
	});

	let emailSuccess = false;
	let shoutrrrSuccess = false;

	// Send email if enabled for intake reminders
	if (emailEnabled) {
		// Calculate counts for repeat reminder text
		const hasNaggingReminder = remindersToSend.some((r) => !r.isAdvanceReminder);
		const highestSendCount = Math.max(...remindersToSend.map((r) => r.currentSendCount));
		const maxReminderCount = remindersToSend[0]?.maxReminders ?? 5;

		const result = await sendIntakeReminderEmail(
			settings.notificationEmail!,
			remindersToSend,
			language,
			isRepeatReminder,
			settings.reminderRepeatIntervalMinutes,
			hasNaggingReminder ? highestSendCount : undefined,
			hasNaggingReminder ? maxReminderCount : undefined
		);
		emailSuccess = result.success;
		if (result.success) {
			logger.info("[IntakeReminder] Email sent successfully");
		} else {
			logger.error(`[IntakeReminder] Failed to send email: ${result.error}`);
		}
	}

	// Send Shoutrrr notification if enabled for intake reminders
	if (shoutrrrEnabled) {
		// Check if any reminder is a nagging reminder (not advance)
		const hasNaggingReminder = remindersToSend.some((r) => !r.isAdvanceReminder);
		const highestSendCount = Math.max(...remindersToSend.map((r) => r.currentSendCount));
		const maxReminderCount = remindersToSend[0]?.maxReminders ?? 5;

		let title: string;
		if (hasNaggingReminder && highestSendCount > 0) {
			// Nagging reminder - show counter
			const counterStr = `(${highestSendCount}/${maxReminderCount})`;
			title =
				language === "de"
					? `⚠️ Erinnerung: Medikamenteneinnahme ${counterStr}`
					: `⚠️ Reminder: Medication intake ${counterStr}`;
		} else {
			// Advance reminder - no counter
			title = t(tr.push.intakeTitle, { minutes: REMINDER_MINUTES_BEFORE });
		}

		// Only show repeat note for nagging reminders, not for advance reminders
		let repeatNote = "";
		if (hasNaggingReminder && settings.reminderRepeatIntervalMinutes) {
			const remainingReminders = maxReminderCount - highestSendCount;
			if (remainingReminders <= 0) {
				// Last reminder
				repeatNote = language === "de" ? "\n\n⚠️ Dies ist die letzte Erinnerung." : "\n\n⚠️ This is the last reminder.";
			} else if (remainingReminders === 1) {
				// One more reminder
				repeatNote =
					language === "de"
						? `\n\nℹ️ Eine weitere Erinnerung wird in ${settings.reminderRepeatIntervalMinutes} Minuten gesendet.`
						: `\n\nℹ️ One more reminder will be sent in ${settings.reminderRepeatIntervalMinutes} minutes.`;
			} else {
				// Multiple reminders remaining
				repeatNote =
					language === "de"
						? `\n\nℹ️ ${remainingReminders} weitere Erinnerungen werden alle ${settings.reminderRepeatIntervalMinutes} Minuten gesendet.`
						: `\n\nℹ️ ${remainingReminders} more reminders will be sent every ${settings.reminderRepeatIntervalMinutes} minutes.`;
			}
		}

		const message =
			remindersToSend
				.map((i) => {
					const takenByStr = i.takenBy ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy })}` : "";
					let dosage = `${i.usage} ${i.usage === 1 ? tr.common.pill : tr.common.pills}`;
					if (i.pillWeightMg) {
						const totalMg = i.usage * i.pillWeightMg;
						dosage += totalMg >= 1000 ? ` (${(totalMg / 1000).toFixed(1)} g)` : ` (${totalMg} mg)`;
					}
					return `• ${i.medName}${takenByStr}: ${dosage} @ ${i.intakeTimeStr}`;
				})
				.join("\n") +
			repeatNote +
			`\n\n---\n${getFooterPlain(language)}`;

		const result = await sendShoutrrrNotification(settings.shoutrrrUrl!, title, message);
		shoutrrrSuccess = result.success;
		if (result.success) {
			logger.info("[IntakeReminder] Push notification sent successfully");
		} else {
			logger.error(`[IntakeReminder] Failed to send push: ${result.error}`);
		}
	}

	// Update state if any notification was sent successfully
	if (emailSuccess || shoutrrrSuccess) {
		// Update or create entries for sent reminders
		for (const intake of remindersToSend) {
			const key = `user_${settings.userId}:${intake.medName}:${intake.intakeTime.getTime()}`;
			const existing = state.reminders[key];

			if (existing) {
				// Update existing entry
				if (intake.isAdvanceReminder) {
					// Advance reminder - don't increment nagging count
					state.reminders[key] = {
						...existing,
						lastSentAt: nowMs,
						advanceSent: true,
					};
				} else {
					// Nagging reminder - increment count
					state.reminders[key] = {
						firstSentAt: existing.firstSentAt,
						lastSentAt: nowMs,
						sendCount: existing.sendCount + 1,
						advanceSent: existing.advanceSent,
					};
				}
			} else {
				// Create new entry
				if (intake.isAdvanceReminder) {
					// Advance reminder - sendCount stays 0
					state.reminders[key] = {
						firstSentAt: nowMs,
						lastSentAt: nowMs,
						sendCount: 0,
						advanceSent: true,
					};
				} else {
					// First nagging reminder - sendCount starts at 1
					state.reminders[key] = {
						firstSentAt: nowMs,
						lastSentAt: nowMs,
						sendCount: 1,
						advanceSent: false,
					};
				}
			}
		}

		// Clean up old entries (remove doses from past days)
		state.reminders = cleanOldIntakeReminders(state.reminders, tz);

		saveIntakeReminderState(state);

		// Update global reminder state for UI display
		const singleChannel = emailSuccess ? "email" : "push";
		const channel = emailSuccess && shoutrrrSuccess ? "both" : singleChannel;
		updateReminderSentTime("intake", channel);

		// Also update user settings in database so frontend can display the info
		// Get the first reminder's medication name and taken by for display
		const firstReminder = remindersToSend[0];
		const medName = firstReminder?.medName;
		const takenBy = firstReminder?.takenBy || undefined;
		await updateUserReminderSentTime(settings.userId, "intake", channel, medName, takenBy);
	}
}

let intakeCheckInterval: NodeJS.Timeout | null = null;

export function startIntakeReminderScheduler(logger: ServiceLogger): void {
	logger.info(`[IntakeReminder] Starting intake reminder scheduler (checks every minute)...`);

	// Run immediately on start
	checkAndSendIntakeReminders(logger).catch((err) => logger.error(`[IntakeReminder] Error: ${err}`));

	// Then run every minute
	intakeCheckInterval = setInterval(() => {
		checkAndSendIntakeReminders(logger).catch((err) => logger.error(`[IntakeReminder] Error: ${err}`));
	}, CHECK_INTERVAL_MS);

	logger.info(`[IntakeReminder] Scheduler started - checking every minute for upcoming intakes`);
}

export function stopIntakeReminderScheduler(): void {
	if (intakeCheckInterval) {
		clearInterval(intakeCheckInterval);
		intakeCheckInterval = null;
	}
}
