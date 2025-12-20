import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { medications } from "../db/schema.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadNotificationSettings, sendShoutrrrNotification } from "../routes/settings.js";

type Slice = { usage: number; every: number; start: string };

type NotificationSettings = {
  emailEnabled: boolean;
  notificationEmail: string;
  reminderDaysBefore: number;
  repeatDailyReminders: boolean;
  lowStockDays: number;
  normalStockDays: number;
  highStockDays: number;
  shoutrrrEnabled: boolean;
  shoutrrrUrl: string;
};

type ReminderState = {
  lastAutoEmailSent: string | null; // ISO date string
  lastAutoEmailDate: string | null; // YYYY-MM-DD - to track if we already sent today
  notifiedMedications: string[]; // List of medication names that have been notified (cleared when restocked)
  nextScheduledCheck: string | null; // ISO date string for when the next check is scheduled
};

const REMINDER_HOUR = 6; // 6:00 AM

function getNextScheduledTime(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(REMINDER_HOUR, 0, 0, 0);
  
  // If we're past today's scheduled time, schedule for tomorrow
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

function getMsUntilNextCheck(): number {
  const next = getNextScheduledTime();
  return next.getTime() - Date.now();
}

const reminderStateFile = resolve(process.cwd(), "data", "reminder-state.json");

function loadReminderState(): ReminderState {
  try {
    if (existsSync(reminderStateFile)) {
      const saved = JSON.parse(readFileSync(reminderStateFile, "utf-8"));
      return {
        lastAutoEmailSent: saved.lastAutoEmailSent ?? null,
        lastAutoEmailDate: saved.lastAutoEmailDate ?? null,
        notifiedMedications: saved.notifiedMedications ?? [],
        nextScheduledCheck: saved.nextScheduledCheck ?? null,
      };
    }
  } catch {
    // ignore
  }
  return { lastAutoEmailSent: null, lastAutoEmailDate: null, notifiedMedications: [], nextScheduledCheck: null };
}

function saveReminderState(state: ReminderState): void {
  writeFileSync(reminderStateFile, JSON.stringify(state, null, 2));
}

export function getReminderState(): ReminderState {
  return loadReminderState();
}

export function updateReminderSentTime(): void {
  const state = loadReminderState();
  const today = new Date().toISOString().split("T")[0];
  saveReminderState({
    ...state,
    lastAutoEmailSent: new Date().toISOString(),
    lastAutoEmailDate: today,
  });
}

function parseSlices(row: { usageJson: string; everyJson: string; startJson: string }): Slice[] {
  try {
    const usage = JSON.parse(row.usageJson) as number[];
    const every = JSON.parse(row.everyJson) as number[];
    const start = JSON.parse(row.startJson) as string[];
    const len = Math.min(usage.length, every.length, start.length);
    const slices: Slice[] = [];
    for (let i = 0; i < len; i++) {
      slices.push({ usage: usage[i], every: every[i], start: start[i] });
    }
    return slices;
  } catch {
    return [];
  }
}

function calculateDailyUsage(slices: Slice[]): number {
  return slices.reduce((sum, s) => sum + s.usage / s.every, 0);
}

function calculateDepletionInfo(med: { count: number; slices: Slice[] }): { daysLeft: number | null; depletionDate: string | null } {
  const dailyUsage = calculateDailyUsage(med.slices);
  if (dailyUsage <= 0) return { daysLeft: null, depletionDate: null };
  
  const daysLeft = Math.floor(med.count / dailyUsage);
  const depletionMs = Date.now() + daysLeft * 86_400_000;
  const depletionDate = new Date(depletionMs).toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  
  return { daysLeft, depletionDate };
}

type LowStockItem = {
  name: string;
  medsLeft: number;
  daysLeft: number | null;
  depletionDate: string | null;
};

async function getMedicationsNeedingReminder(reminderDaysBefore: number): Promise<LowStockItem[]> {
  const rows = await db.select().from(medications).orderBy(medications.id);
  
  const lowStock: LowStockItem[] = [];
  
  for (const row of rows) {
    const slices = parseSlices(row);
    const { daysLeft, depletionDate } = calculateDepletionInfo({ count: row.count, slices });
    
    // Check if medication runs out within reminderDaysBefore days
    if (daysLeft !== null && daysLeft <= reminderDaysBefore) {
      lowStock.push({
        name: row.name,
        medsLeft: row.count,
        daysLeft,
        depletionDate,
      });
    }
  }
  
  return lowStock;
}

async function sendReminderEmail(email: string, lowStock: LowStockItem[]): Promise<{ success: boolean; error?: string }> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

  if (!smtpHost || !smtpUser) {
    return { success: false, error: "SMTP not configured" };
  }

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

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">⚠️ MedAssist - Automatic Reorder Reminder</h2>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">The following medications are running low and need to be reordered:</p>
        
        <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #fef2f2; border: 1px solid #fecaca;">
          <p style="margin: 0; color: #991b1b; font-weight: 500; font-size: 13px;">
            ⚠️ ${lowStock.length} medication${lowStock.length > 1 ? "s" : ""} running low!
          </p>
        </div>

        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; background: white; min-width: 400px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">Medication</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">Pills</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">Days</th>
                <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">Runs Out</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          🤖 Automatic reminder from MedAssist
        </p>
      </div>
    </div>
  `;

  const plainText = `MedAssist - Automatic Reorder Reminder

The following medications are running low:

${lowStock.map((r) => `${r.name}: ${r.medsLeft} pills left, ${r.daysLeft ?? 0} days remaining, runs out ${r.depletionDate ?? "soon"}`).join("\n")}

---
Automatic reminder from MedAssist`;

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
      subject: `⚠️ MedAssist Auto-Reminder: ${lowStock.length} Medication${lowStock.length > 1 ? "s" : ""} Running Low`,
      text: plainText,
      html,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}

async function checkAndSendReminder(logger: { info: (msg: string) => void; error: (msg: string) => void }): Promise<void> {
  const settings = loadNotificationSettings();
  
  // Check if any notifications are enabled
  const emailEnabled = settings.emailEnabled && settings.notificationEmail;
  const shoutrrrEnabled = settings.shoutrrrEnabled && settings.shoutrrrUrl;
  
  if (!emailEnabled && !shoutrrrEnabled) {
    logger.info("[Reminder] No notifications enabled");
    return;
  }

  const state = loadReminderState();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Get all medications that need a reminder
  const allLowStock = await getMedicationsNeedingReminder(settings.reminderDaysBefore);
  
  if (allLowStock.length === 0) {
    // No low stock - clear the notified list (medications have been restocked)
    if (state.notifiedMedications.length > 0) {
      saveReminderState({
        ...state,
        notifiedMedications: [],
      });
      logger.info("[Reminder] Cleared notified medications list (all restocked)");
    }
    logger.info("[Reminder] No medications need reminder");
    return;
  }

  // Get names of currently low stock medications
  const currentLowStockNames = allLowStock.map((m) => m.name);
  
  // Remove medications from notified list that are no longer low stock (restocked)
  const stillLowStock = state.notifiedMedications.filter((name) => currentLowStockNames.includes(name));
  
  // Find NEW medications that haven't been notified yet
  const newLowStock = allLowStock.filter((m) => !state.notifiedMedications.includes(m.name));

  // Determine what to send
  let medsToNotify: LowStockItem[] = [];
  
  if (settings.repeatDailyReminders) {
    // Daily reminders enabled - send for ALL low stock, but only once per day
    if (state.lastAutoEmailDate === today) {
      logger.info("[Reminder] Daily reminder already sent today, skipping");
      return;
    }
    medsToNotify = allLowStock;
  } else {
    // Only notify NEW medications (not previously notified)
    if (newLowStock.length === 0) {
      logger.info("[Reminder] No new medications to notify (already notified previously)");
      return;
    }
    medsToNotify = newLowStock;
  }

  logger.info(`[Reminder] Sending reminder for ${medsToNotify.length} medications...`);
  
  let emailSuccess = false;
  let shoutrrrSuccess = false;
  
  // Send email if enabled
  if (emailEnabled) {
    const result = await sendReminderEmail(settings.notificationEmail, medsToNotify);
    emailSuccess = result.success;
    if (result.success) {
      logger.info(`[Reminder] Email sent successfully to ${settings.notificationEmail}`);
    } else {
      logger.error(`[Reminder] Failed to send email: ${result.error}`);
    }
  }
  
  // Send Shoutrrr notification if enabled
  if (shoutrrrEnabled) {
    const title = `⚠️ MedAssist: ${medsToNotify.length} Medication${medsToNotify.length > 1 ? "s" : ""} Running Low`;
    const message = medsToNotify
      .map((m) => `• ${m.name}: ${m.medsLeft} pills, ${m.daysLeft ?? 0} days left`)
      .join("\n");
    
    const result = await sendShoutrrrNotification(settings.shoutrrrUrl, title, message);
    shoutrrrSuccess = result.success;
    if (result.success) {
      logger.info(`[Reminder] Push notification sent successfully`);
    } else {
      logger.error(`[Reminder] Failed to send push notification: ${result.error}`);
    }
  }
  
  // Update state if any notification was sent successfully
  if (emailSuccess || shoutrrrSuccess) {
    const currentState = loadReminderState();
    saveReminderState({
      lastAutoEmailSent: new Date().toISOString(),
      lastAutoEmailDate: today,
      notifiedMedications: [...new Set([...stillLowStock, ...medsToNotify.map((m) => m.name)])],
      nextScheduledCheck: currentState.nextScheduledCheck,
    });
  }
}

let schedulerTimeout: NodeJS.Timeout | null = null;

function scheduleNextCheck(logger: { info: (msg: string) => void; error: (msg: string) => void }): void {
  const msUntilNext = getMsUntilNextCheck();
  const nextTime = getNextScheduledTime();
  
  // Save next scheduled time to state
  const state = loadReminderState();
  saveReminderState({
    ...state,
    nextScheduledCheck: nextTime.toISOString(),
  });
  
  logger.info(`[Reminder] Next check scheduled for ${nextTime.toLocaleString()} (in ${Math.round(msUntilNext / 1000 / 60)} minutes)`);
  
  schedulerTimeout = setTimeout(() => {
    checkAndSendReminder(logger).catch((err) => logger.error(`[Reminder] Error: ${err}`));
    // Schedule the next check after this one completes
    scheduleNextCheck(logger);
  }, msUntilNext);
}

export function startReminderScheduler(logger: { info: (msg: string) => void; error: (msg: string) => void }): void {
  logger.info("[Reminder] Starting reminder scheduler...");
  
  // Check if we need to run immediately (missed today's check)
  const state = loadReminderState();
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const todayAt6AM = new Date(now);
  todayAt6AM.setHours(REMINDER_HOUR, 0, 0, 0);
  
  // If it's past 6 AM today and we haven't checked today, run immediately
  if (now >= todayAt6AM && state.lastAutoEmailDate !== today) {
    logger.info("[Reminder] Missed today's check, running now...");
    checkAndSendReminder(logger).catch((err) => logger.error(`[Reminder] Error: ${err}`));
  }
  
  // Schedule next check at 6 AM
  scheduleNextCheck(logger);
  
  logger.info(`[Reminder] Scheduler started - daily check at ${REMINDER_HOUR}:00`);
}

export function stopReminderScheduler(): void {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }
}
