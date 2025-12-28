import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { medications } from "../db/schema.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getAllUserSettings, sendShoutrrrNotification, type UserSettings } from "../routes/settings.js";
import { getTranslations, t, getDateLocale, type Language } from "../i18n/translations.js";
import { getReminderState, updateReminderSentTime, updateUserReminderSentTime } from "./reminder-scheduler.js";

type Blister = { usage: number; every: number; start: string };

type IntakeReminderState = {
  sentReminders: string[]; // Array of "medName:timestamp" to track sent reminders
};

const REMINDER_MINUTES_BEFORE = parseInt(process.env.REMINDER_MINUTES_BEFORE ?? "15", 10);
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute

// Get current timezone from TZ env variable or default to UTC
function getTimezone(): string {
  return process.env.TZ || "UTC";
}

// Parse takenByJson to array of strings
function parseTakenByJson(takenByJson: string | null | undefined): string[] {
  if (!takenByJson) return [];
  try {
    const parsed = JSON.parse(takenByJson);
    return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

const intakeReminderStateFile = resolve(process.cwd(), "data", "intake-reminder-state.json");

function loadIntakeReminderState(): IntakeReminderState {
  try {
    if (existsSync(intakeReminderStateFile)) {
      const saved = JSON.parse(readFileSync(intakeReminderStateFile, "utf-8"));
      return {
        sentReminders: saved.sentReminders ?? [],
      };
    }
  } catch {
    // ignore
  }
  return { sentReminders: [] };
}

function saveIntakeReminderState(state: IntakeReminderState): void {
  writeFileSync(intakeReminderStateFile, JSON.stringify(state, null, 2));
}

function parseBlisters(row: { usageJson: string; everyJson: string; startJson: string }): Blister[] {
  try {
    const usage = JSON.parse(row.usageJson) as number[];
    const every = JSON.parse(row.everyJson) as number[];
    const start = JSON.parse(row.startJson) as string[];
    const len = Math.min(usage.length, every.length, start.length);
    const blisters: Blister[] = [];
    for (let i = 0; i < len; i++) {
      blisters.push({ usage: usage[i], every: every[i], start: start[i] });
    }
    return blisters;
  } catch {
    return [];
  }
}

type UpcomingIntake = {
  medName: string;
  usage: number;
  intakeTime: Date;
  intakeTimeStr: string;
  takenBy: string[]; // Changed to array
  pillWeightMg: number | null;
};

function getUpcomingIntakes(medName: string, blisters: Blister[], minutesBefore: number, takenBy: string[], pillWeightMg: number | null, locale: string): UpcomingIntake[] {
  const now = Date.now();
  // Window to detect if "now" is the right time to send reminder
  // We check if the notify time (intake - 15min) falls within current minute ±1
  const windowStart = now - 2 * 60 * 1000; // 2 minutes ago (catch slightly late checks)
  const windowEnd = now + 1 * 60 * 1000; // 1 minute from now
  
  const upcoming: UpcomingIntake[] = [];
  
  for (const blister of blisters) {
    const startTime = new Date(blister.start).getTime();
    const intervalMs = blister.every * 24 * 60 * 60 * 1000;
    
    if (intervalMs <= 0) continue;
    
    // Find the next scheduled intake time (could be today or in the future)
    let nextTime = startTime;
    
    // If start is in the past, calculate occurrences
    if (nextTime < now) {
      const elapsed = now - startTime;
      const intervals = Math.floor(elapsed / intervalMs);
      
      // Check the current occurrence (today's scheduled time, even if past)
      const currentOccurrence = startTime + intervals * intervalMs;
      // And the next occurrence
      const nextOccurrence = startTime + (intervals + 1) * intervalMs;
      
      // If today's occurrence is within the reminder window, use it
      // (intake hasn't happened yet, we should remind)
      const currentNotifyTime = currentOccurrence - minutesBefore * 60 * 1000;
      if (currentNotifyTime >= windowStart && currentOccurrence > now) {
        nextTime = currentOccurrence;
      } else {
        nextTime = nextOccurrence;
      }
    }
    
    // Calculate when we should notify for this intake
    const notifyTime = nextTime - minutesBefore * 60 * 1000;
    
    if (notifyTime >= windowStart && notifyTime <= windowEnd) {
      const intakeDate = new Date(nextTime);
      upcoming.push({
        medName,
        usage: blister.usage,
        intakeTime: intakeDate,
        intakeTimeStr: intakeDate.toLocaleTimeString(locale, { 
          hour: "2-digit", 
          minute: "2-digit",
          timeZone: getTimezone()
        }),
        takenBy,
        pillWeightMg,
      });
    }
  }
  
  return upcoming;
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
  const allUpcoming: UpcomingIntake[] = [];
  const locale = getDateLocale(language);
  
  // Find all upcoming intakes across all medications for this user
  for (const med of medsWithReminders) {
    const blisters = parseBlisters(med);
    const takenByArray = parseTakenByJson(med.takenByJson);
    const upcoming = getUpcomingIntakes(med.name, blisters, REMINDER_MINUTES_BEFORE, takenByArray, med.pillWeightMg, locale);
    allUpcoming.push(...upcoming);
  }
  
  if (allUpcoming.length === 0) {
    return; // No upcoming intakes in the window
  }
  
  // Filter out already-sent reminders (keyed by user)
  const newReminders = allUpcoming.filter(intake => {
    const key = `user_${settings.userId}:${intake.medName}:${intake.intakeTime.getTime()}`;
    return !state.sentReminders.includes(key);
  });
  
  if (newReminders.length === 0) {
    return; // All reminders already sent
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
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const cleanedReminders = state.sentReminders.filter(key => {
      const timestamp = parseInt(key.split(":").pop() || "0", 10);
      return timestamp > oneDayAgo;
    });
    
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
