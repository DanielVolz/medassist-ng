import nodemailer from "nodemailer";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { medications, doseTracking } from "../db/schema.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getAllUserSettings, sendShoutrrrNotification, type UserSettings } from "../routes/settings.js";
import { getTranslations, t, getDateLocale, type Language } from "../i18n/translations.js";
import { getReminderState, updateReminderSentTime, updateUserReminderSentTime } from "./reminder-scheduler.js";

// Import shared utilities
import {
  getTimezone,
  parseBlisters,
  parseTakenByJson,
  getUpcomingIntakes,
  parseIntakeReminderState,
  createDefaultIntakeReminderState,
  cleanOldIntakeReminders,
  type Blister,
  type IntakeReminderState,
  type UpcomingIntake,
} from "../utils/scheduler-utils.js";

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

function parseBlistersFromRow(row: { usageJson: string; everyJson: string; startJson: string }): Blister[] {
  return parseBlisters(row);
}

async function sendIntakeReminderEmail(email: string, intakes: UpcomingIntake[], language: Language): Promise<{ success: boolean; error?: string }> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
  const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
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

  const alertText = intakes.length === 1 
    ? tr.intakeReminder.alertSingle 
    : t(tr.intakeReminder.alertMultiple, { count: intakes.length });

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${tr.intakeReminder.title}</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${t(tr.intakeReminder.description, { minutes: REMINDER_MINUTES_BEFORE })}</p>
        
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

${t(tr.intakeReminder.description, { minutes: REMINDER_MINUTES_BEFORE })}

${intakes.map((i) => {
    const takenByStr = i.takenBy.length > 0 ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy.join(", ") })}` : "";
    return `${i.medName}${takenByStr}: ${formatDosagePlain(i)} - ${i.intakeTimeStr}`;
  }).join("\n")}

---
${tr.intakeReminder.footer}`;

  const subject = t(tr.intakeReminder.subject, { medications: intakes.map(i => i.medName).join(", ") });

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

async function checkAndSendIntakeReminders(logger: { info: (msg: string) => void; error: (msg: string) => void }): Promise<void> {
  // Get all user settings to iterate over each user
  const allUserSettings = await getAllUserSettings();
  
  if (allUserSettings.length === 0) {
    return; // No users with settings
  }

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
  
  // Check if any intake reminder notifications are enabled (granular check)
  const emailEnabled = settings.emailEnabled && settings.notificationEmail && settings.emailIntakeReminders;
  const shoutrrrEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl && settings.shoutrrrIntakeReminders;
  
  if (!emailEnabled && !shoutrrrEnabled) {
    return; // No intake reminder notifications enabled for this user
  }

  // Get all medications with intake reminders enabled for this user
  const rows = await db.select().from(medications).where(eq(medications.userId, settings.userId)).orderBy(medications.id);
  const medsWithReminders = rows.filter(row => row.intakeRemindersEnabled);
  
  if (medsWithReminders.length === 0) {
    return; // No medications have reminders enabled for this user
  }

  const state = loadIntakeReminderState();
  const allUpcoming: (UpcomingIntake & { medicationId: number; blisterIndex: number })[] = [];
  const locale = getDateLocale(language);
  const tz = getTimezone();
  
  // Find all upcoming intakes across all medications for this user
  for (const med of medsWithReminders) {
    const blisters = parseBlistersFromRow(med);
    const takenByArray = parseTakenByJson(med.takenByJson);
    
    // Process each blister separately to track blisterIndex
    blisters.forEach((blister, blisterIndex) => {
      const upcoming = getUpcomingIntakes(med.name, [blister], REMINDER_MINUTES_BEFORE, takenByArray, med.pillWeightMg, locale);
      
      // Add medicationId and blisterIndex to each intake for dose ID generation
      allUpcoming.push(...upcoming.map(intake => ({
        ...intake,
        medicationId: med.id,
        blisterIndex,
      })));
    });
  }
  
  if (allUpcoming.length === 0) {
    return; // No upcoming intakes in the window
  }
  
  // Filter out already-sent reminders (keyed by user)
  let newReminders = allUpcoming.filter(intake => {
    const key = `user_${settings.userId}:${intake.medName}:${intake.intakeTime.getTime()}`;
    return !state.sentReminders.includes(key);
  });
  
  if (newReminders.length === 0) {
    return; // All reminders already sent
  }

  // If skipRemindersForTakenDoses is enabled, filter out doses that were already taken today
  if (settings.skipRemindersForTakenDoses) {
    // Get start and end of today in user's timezone
    const now = new Date();
    const todayStart = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    todayEnd.setHours(23, 59, 59, 999);
    
    // Query doses marked as taken today (takenAt is timestamp, stored as seconds since epoch)
    const takenToday = await db.select().from(doseTracking).where(
      and(
        eq(doseTracking.userId, settings.userId),
        gte(doseTracking.takenAt, todayStart),
        lte(doseTracking.takenAt, todayEnd)
      )
    );
    
    const takenDoseIds = new Set(takenToday.map(d => d.doseId));
    
    // Filter out reminders for doses that were already taken
    newReminders = newReminders.filter(intake => {
      const timestamp = intake.intakeTime.getTime();
      
      // Check both with and without person suffix
      if (intake.takenBy.length > 0) {
        // For multi-person medications, check if any person has taken it
        const anyTaken = intake.takenBy.some(person => {
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
    
    if (newReminders.length === 0) {
      logger.info(`[IntakeReminder] User ${settings.userId}: All upcoming doses already taken, skipping reminders`);
      return;
    }
  }

  logger.info(`[IntakeReminder] User ${settings.userId}: Sending reminder for ${newReminders.length} upcoming intakes...`);
  
  let emailSuccess = false;
  let shoutrrrSuccess = false;
  
  // Send email if enabled for intake reminders
  if (emailEnabled) {
    const result = await sendIntakeReminderEmail(settings.notificationEmail!, newReminders, language);
    emailSuccess = result.success;
    if (result.success) {
      logger.info(`[IntakeReminder] User ${settings.userId}: Email sent successfully`);
    } else {
      logger.error(`[IntakeReminder] User ${settings.userId}: Failed to send email: ${result.error}`);
    }
  }
  
  // Send Shoutrrr notification if enabled for intake reminders
  if (shoutrrrEnabled) {
    const title = t(tr.push.intakeTitle, { minutes: REMINDER_MINUTES_BEFORE });
    const message = newReminders
      .map((i) => {
        const takenByStr = i.takenBy.length > 0 ? ` ${t(tr.intakeReminder.takenBy, { name: i.takenBy.join(", ") })}` : "";
        let dosage = `${i.usage} ${i.usage === 1 ? tr.common.pill : tr.common.pills}`;
        if (i.pillWeightMg) {
          const totalMg = i.usage * i.pillWeightMg;
          dosage += totalMg >= 1000 ? ` (${(totalMg / 1000).toFixed(1)} g)` : ` (${totalMg} mg)`;
        }
        return `• ${i.medName}${takenByStr}: ${dosage} @ ${i.intakeTimeStr}`;
      })
      .join("\n");
    
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
    const newKeys = newReminders.map(i => `user_${settings.userId}:${i.medName}:${i.intakeTime.getTime()}`);
    
    // Clean up old entries (older than 24 hours)
    const cleanedReminders = cleanOldIntakeReminders(state.sentReminders);
    
    saveIntakeReminderState({
      sentReminders: [...cleanedReminders, ...newKeys],
    });
    
    // Update global reminder state for UI display
    const channel = emailSuccess && shoutrrrSuccess ? "both" : emailSuccess ? "email" : "push";
    updateReminderSentTime("intake", channel);
    
    // Also update user settings in database so frontend can display the info
    await updateUserReminderSentTime(settings.userId, "intake", channel);
  }
}

let intakeCheckInterval: NodeJS.Timeout | null = null;

export function startIntakeReminderScheduler(logger: { info: (msg: string) => void; error: (msg: string) => void }): void {
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
