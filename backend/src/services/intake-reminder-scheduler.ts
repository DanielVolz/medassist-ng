import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, gte, lte } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { doseTracking, medications } from "../db/schema.js";
import { getDateLocale, getTranslations, type Language, t } from "../i18n/translations.js";
import { getAllUserSettings, sendShoutrrrNotification, type UserSettings } from "../routes/settings.js";
// Import shared utilities
import {
	type Blister,
	cleanOldIntakeReminders,
	createDefaultIntakeReminderState,
	getTimezone,
	getTodaysIntakes,
	getUpcomingIntakes,
	type IntakeReminderState,
	parseBlisters,
	parseIntakeReminderState,
	parseTakenByJson,
	type UpcomingIntake,
} from "../utils/scheduler-utils.js";
import { updateReminderSentTime, updateUserReminderSentTime } from "./reminder-scheduler.js";

const REMINDER_MINUTES_BEFORE = parseInt(process.env.REMINDER_MINUTES_BEFORE ?? "15", 10);
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute

const intakeReminderStateFile = resolve(process.cwd(), "data", "intake-reminder-state.json");

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

async function sendIntakeReminderEmail(
	email: string,
	intakes: UpcomingIntake[],
	language: Language,
	isRepeat: boolean = false,
	repeatIntervalMinutes?: number,
	currentCount?: number,
	maxCount?: number
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

	// Helper to format medication name with takenBy (array of names)
	const formatMedName = (intake: UpcomingIntake): string => {
		if (intake.takenBy.length > 0) {
			const namesStr = intake.takenBy.join(", ");
			return `${intake.medName} <span style="color: #6b7280; font-size: 12px;">${t(tr.intakeReminder.takenBy, { name: namesStr })}</span>`;
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
          ${tr.intakeReminder.footer}
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
		const takenByStr = i.takenBy.length > 0 ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy.join(", ") })}` : "";
		return `${i.medName}${takenByStr}: ${formatDosagePlain(i)} - ${i.intakeTimeStr}`;
	})
	.join("\n")}

---
${tr.intakeReminder.footer}`;

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

		await transporter.sendMail({
			from: smtpFrom,
			to: email,
			subject: `💊 ${subject}`,
			text: plainText,
			html,
		});

		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}

async function checkAndSendIntakeReminders(logger: {
	info: (msg: string) => void;
	error: (msg: string) => void;
}): Promise<void> {
	logger.info(`[IntakeReminder] Checking for intake reminders...`);

	// Get all user settings to iterate over each user
	const allUserSettings = await getAllUserSettings();

	if (allUserSettings.length === 0) {
		logger.info(`[IntakeReminder] No users with settings found`);
		return; // No users with settings
	}

	logger.info(`[IntakeReminder] Found ${allUserSettings.length} users to check`);

	for (const userSettings of allUserSettings) {
		await checkAndSendIntakeRemindersForUser(userSettings, logger);
	}
}

async function checkAndSendIntakeRemindersForUser(
	settings: UserSettings & { userId: number },
	logger: { info: (msg: string) => void; error: (msg: string) => void }
): Promise<void> {
	const language = settings.language;
	const tr = getTranslations(language);

	logger.info(
		`[IntakeReminder] Checking user ${settings.userId} - repeat:${settings.repeatRemindersEnabled} skip:${settings.skipRemindersForTakenDoses}`
	);

	// Check if any intake reminder notifications are enabled (granular check)
	const emailEnabled = settings.emailEnabled && settings.notificationEmail && settings.emailIntakeReminders;
	const shoutrrrEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrIntakeReminders;

	if (!emailEnabled && !shoutrrrEnabled) {
		logger.info(
			`[IntakeReminder] User ${settings.userId}: No intake notifications enabled (email:${emailEnabled}, shoutrrr:${shoutrrrEnabled})`
		);
		return; // No intake reminder notifications enabled for this user
	}

	logger.info(
		`[IntakeReminder] User ${settings.userId}: Notifications enabled (email:${emailEnabled}, shoutrrr:${shoutrrrEnabled})`
	);

	// Get all medications with intake reminders enabled for this user
	const rows = await db
		.select()
		.from(medications)
		.where(eq(medications.userId, settings.userId))
		.orderBy(medications.id);
	const medsWithReminders = rows.filter((row) => row.intakeRemindersEnabled);

	if (medsWithReminders.length === 0) {
		logger.info(`[IntakeReminder] User ${settings.userId}: No medications have reminders enabled`);
		return; // No medications have reminders enabled for this user
	}

	logger.info(`[IntakeReminder] User ${settings.userId}: Found ${medsWithReminders.length} medications with reminders`);

	const state = loadIntakeReminderState();
	const allUpcoming: (UpcomingIntake & { medicationId: number; blisterIndex: number })[] = [];
	const locale = getDateLocale(language);
	const tz = getTimezone();

	// Get start and end of today in user's timezone (for filtering today's doses only)
	const now = new Date();
	const todayStart = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayStart.setHours(0, 0, 0, 0);

	const todayEnd = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayEnd.setHours(23, 59, 59, 999);

	logger.info(
		`[IntakeReminder] User ${settings.userId}: Today range: ${todayStart.toISOString()} to ${todayEnd.toISOString()}`
	);

	// Find intakes: upcoming ones in reminder window + past ones for repeat reminders
	for (const med of medsWithReminders) {
		const blisters = parseBlisters(med);
		const takenByArray = parseTakenByJson(med.takenByJson);

		logger.info(
			`[IntakeReminder] User ${settings.userId}: Processing medication "${med.name}" with ${blisters.length} blisters`
		);

		// Process each blister separately to track blisterIndex
		blisters.forEach((blister, blisterIndex) => {
			logger.info(
				`[IntakeReminder] User ${settings.userId}: Blister ${blisterIndex} - start: ${blister.start}, every: ${blister.every} days, usage: ${blister.usage}`
			);

			// Always get upcoming intakes (15 min before) for first reminders
			const upcomingIntakes = getUpcomingIntakes(
				med.name,
				[blister],
				REMINDER_MINUTES_BEFORE,
				takenByArray,
				med.pillWeightMg,
				locale,
				tz
			);
			logger.info(
				`[IntakeReminder] User ${settings.userId}: Blister ${blisterIndex} found ${upcomingIntakes.length} upcoming intakes (reminder window)`
			);

			// Add upcoming intakes for first reminders
			allUpcoming.push(
				...upcomingIntakes.map((intake) => ({
					...intake,
					medicationId: med.id,
					blisterIndex,
				}))
			);

			// If repeat reminders enabled, also check for missed intakes (past the intake time)
			if (settings.repeatRemindersEnabled) {
				const allTodaysIntakes = getTodaysIntakes(med.name, [blister], takenByArray, med.pillWeightMg, locale, tz);
				logger.info(
					`[IntakeReminder] User ${settings.userId}: Blister ${blisterIndex} - all today's intakes: ${allTodaysIntakes.length}, times: ${allTodaysIntakes.map((i) => i.intakeTime.toISOString()).join(", ")}`
				);
				const missedIntakes = allTodaysIntakes.filter((intake) => intake.intakeTime.getTime() < now.getTime());
				logger.info(
					`[IntakeReminder] User ${settings.userId}: Blister ${blisterIndex} found ${missedIntakes.length} missed intakes (past intake time)`
				);

				// Add missed intakes for repeat reminders (only if not already in upcoming list)
				const upcomingTimes = new Set(upcomingIntakes.map((i) => i.intakeTime.getTime()));
				allUpcoming.push(
					...missedIntakes
						.filter((intake) => !upcomingTimes.has(intake.intakeTime.getTime()))
						.map((intake) => ({
							...intake,
							medicationId: med.id,
							blisterIndex,
						}))
				);
			}
		});
	}

	logger.info(`[IntakeReminder] User ${settings.userId}: Total ${allUpcoming.length} intakes for today`);

	if (allUpcoming.length === 0) {
		logger.info(`[IntakeReminder] User ${settings.userId}: No intakes for today`);
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
				// Already missed - this is first nagging reminder (count=1)
				remindersToSend.push({ ...intake, currentSendCount: 1, maxReminders, isAdvanceReminder: false });
				logger.info(
					`[IntakeReminder] User ${settings.userId}: First nagging for missed "${intake.medName}" at ${intake.intakeTimeStr} (1/${maxReminders})`
				);
			} else {
				// Upcoming - this is advance reminder (no counter)
				remindersToSend.push({ ...intake, currentSendCount: 0, maxReminders, isAdvanceReminder: true });
				logger.info(
					`[IntakeReminder] User ${settings.userId}: Advance reminder for "${intake.medName}" at ${intake.intakeTimeStr}`
				);
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
				logger.info(
					`[IntakeReminder] User ${settings.userId}: Max nagging (${maxReminders}) reached for "${intake.medName}" at ${intake.intakeTimeStr}`
				);
			} else if (timeSinceLastReminder >= intervalMs) {
				const nextSendCount = currentNaggingCount + 1;
				remindersToSend.push({ ...intake, currentSendCount: nextSendCount, maxReminders, isAdvanceReminder: false });
				logger.info(
					`[IntakeReminder] User ${settings.userId}: Nagging reminder for "${intake.medName}" at ${intake.intakeTimeStr} (${nextSendCount}/${maxReminders})`
				);
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
			const timestamp = intake.intakeTime.getTime();

			// Check both with and without person suffix
			if (intake.takenBy.length > 0) {
				// For multi-person medications, check if any person has taken it
				const anyTaken = intake.takenBy.some((person) => {
					const doseId = `${intake.medicationId}-${intake.blisterIndex}-${timestamp}-${person}`;
					return takenDoseIds.has(doseId);
				});
				return !anyTaken; // Skip if any person has taken it
			} else {
				// For non-person-specific medications
				const doseId = `${intake.medicationId}-${intake.blisterIndex}-${timestamp}`;
				return !takenDoseIds.has(doseId);
			}
		});

		if (remindersToSend.length === 0) {
			logger.info(`[IntakeReminder] User ${settings.userId}: All doses taken, skipping reminders`);
			return;
		}
	}

	logger.info(`[IntakeReminder] User ${settings.userId}: Sending reminder for ${remindersToSend.length} intakes...`);

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
			logger.info(`[IntakeReminder] User ${settings.userId}: Email sent successfully`);
		} else {
			logger.error(`[IntakeReminder] User ${settings.userId}: Failed to send email: ${result.error}`);
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
			title = language === "de" ? `⚠️ Medikamenten-Erinnerung ${counterStr}` : `⚠️ Medication Reminder ${counterStr}`;
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
					const takenByStr =
						i.takenBy.length > 0 ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy.join(", ") })}` : "";
					let dosage = `${i.usage} ${i.usage === 1 ? tr.common.pill : tr.common.pills}`;
					if (i.pillWeightMg) {
						const totalMg = i.usage * i.pillWeightMg;
						dosage += totalMg >= 1000 ? ` (${(totalMg / 1000).toFixed(1)} g)` : ` (${totalMg} mg)`;
					}
					return `• ${i.medName}${takenByStr}: ${dosage} @ ${i.intakeTimeStr}`;
				})
				.join("\n") + repeatNote;

		const result = await sendShoutrrrNotification(settings.shoutrrrUrl!, title, message);
		shoutrrrSuccess = result.success;
		if (result.success) {
			logger.info(`[IntakeReminder] User ${settings.userId}: Push notification sent successfully`);
		} else {
			logger.error(`[IntakeReminder] User ${settings.userId}: Failed to send push: ${result.error}`);
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
		const channel = emailSuccess && shoutrrrSuccess ? "both" : emailSuccess ? "email" : "push";
		updateReminderSentTime("intake", channel);

		// Also update user settings in database so frontend can display the info
		// Get the first reminder's medication name and taken by for display
		const firstReminder = remindersToSend[0];
		const medName = firstReminder?.medName;
		const takenBy = firstReminder?.takenBy?.length > 0 ? firstReminder.takenBy.join(", ") : undefined;
		await updateUserReminderSentTime(settings.userId, "intake", channel, medName, takenBy);
	}
}

let intakeCheckInterval: NodeJS.Timeout | null = null;

export function startIntakeReminderScheduler(logger: {
	info: (msg: string) => void;
	error: (msg: string) => void;
}): void {
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
