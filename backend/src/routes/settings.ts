import { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getReminderState } from "../services/reminder-scheduler.js";
import type { Language } from "../i18n/translations.js";

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
  // Granular notification settings
  emailStockReminders: boolean;
  emailIntakeReminders: boolean;
  shoutrrrStockReminders: boolean;
  shoutrrrIntakeReminders: boolean;
  // Language setting
  language: Language;
};

type TestEmailBody = {
  email: string;
};

type TestShoutrrrBody = {
  url: string;
};

// Notification settings are stored in a JSON file (user-configurable)
// SMTP settings come from .env (admin-configured)
const notificationSettingsFile = resolve(process.cwd(), "data", "notification-settings.json");

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
  // Granular notification settings
  emailStockReminders: boolean;
  emailIntakeReminders: boolean;
  shoutrrrStockReminders: boolean;
  shoutrrrIntakeReminders: boolean;
  // Language setting
  language: Language;
};

function loadNotificationSettings(): NotificationSettings {
  try {
    if (existsSync(notificationSettingsFile)) {
      const saved = JSON.parse(readFileSync(notificationSettingsFile, "utf-8"));
      return {
        emailEnabled: saved.emailEnabled ?? false,
        notificationEmail: saved.notificationEmail ?? "",
        reminderDaysBefore: saved.reminderDaysBefore ?? 7,
        repeatDailyReminders: saved.repeatDailyReminders ?? false,
        lowStockDays: saved.lowStockDays ?? 30,
        normalStockDays: saved.normalStockDays ?? 90,
        highStockDays: saved.highStockDays ?? 180,
        shoutrrrEnabled: saved.shoutrrrEnabled ?? false,
        shoutrrrUrl: saved.shoutrrrUrl ?? "",
        // Granular notification settings (default to true for backwards compatibility)
        emailStockReminders: saved.emailStockReminders ?? true,
        emailIntakeReminders: saved.emailIntakeReminders ?? true,
        shoutrrrStockReminders: saved.shoutrrrStockReminders ?? true,
        shoutrrrIntakeReminders: saved.shoutrrrIntakeReminders ?? true,
        // Language setting (default to English)
        language: saved.language ?? "en",
      };
    }
  } catch {
    // ignore
  }
  return { 
    emailEnabled: false, 
    notificationEmail: "", 
    reminderDaysBefore: 7, 
    repeatDailyReminders: false, 
    lowStockDays: 30, 
    normalStockDays: 90, 
    highStockDays: 180, 
    shoutrrrEnabled: false, 
    shoutrrrUrl: "",
    emailStockReminders: true,
    emailIntakeReminders: true,
    shoutrrrStockReminders: true,
    shoutrrrIntakeReminders: true,
    language: "en",
  };
}

function saveNotificationSettings(settings: NotificationSettings): void {
  writeFileSync(notificationSettingsFile, JSON.stringify(settings, null, 2));
}

// Export for use in reminder scheduler
export { loadNotificationSettings };

export async function settingsRoutes(app: FastifyInstance) {
  // Get settings - notification from JSON file, SMTP from process.env
  app.get("/settings", async (_request, reply) => {
    const notification = loadNotificationSettings();
    const reminderState = getReminderState();
    
    return reply.send({
      // Notification settings (user-configurable, stored in JSON)
      emailEnabled: notification.emailEnabled,
      notificationEmail: notification.notificationEmail,
      reminderDaysBefore: notification.reminderDaysBefore,
      repeatDailyReminders: notification.repeatDailyReminders,
      lowStockDays: notification.lowStockDays,
      normalStockDays: notification.normalStockDays,
      highStockDays: notification.highStockDays,
      shoutrrrEnabled: notification.shoutrrrEnabled,
      shoutrrrUrl: notification.shoutrrrUrl,
      // Granular notification settings
      emailStockReminders: notification.emailStockReminders,
      emailIntakeReminders: notification.emailIntakeReminders,
      shoutrrrStockReminders: notification.shoutrrrStockReminders,
      shoutrrrIntakeReminders: notification.shoutrrrIntakeReminders,
      // Language setting
      language: notification.language,
      // SMTP settings (admin-configured, from .env)
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: parseInt(process.env.SMTP_PORT ?? "587"),
      smtpUser: process.env.SMTP_USER ?? "",
      smtpFrom: process.env.SMTP_FROM ?? "",
      smtpSecure: process.env.SMTP_SECURE === "true",
      hasSmtpPassword: !!(process.env.SMTP_TOKEN || process.env.SMTP_PASS),
      // Reminder state
      lastAutoEmailSent: reminderState.lastAutoEmailSent,
      nextScheduledCheck: reminderState.nextScheduledCheck,
      lastNotificationType: reminderState.lastNotificationType,
      lastNotificationChannel: reminderState.lastNotificationChannel,
      // Admin settings (from .env, read-only)
      expiryWarningDays: parseInt(process.env.EXPIRY_WARNING_DAYS ?? "30", 10),
    });
  });

  // Update settings - only notification settings are saved (SMTP comes from .env)
  app.put<{ Body: SettingsBody }>("/settings", async (request, reply) => {
    const body = request.body;
    
    // Check if any stock reminders are configured
    const hasEmailStock = body.emailEnabled && body.emailStockReminders && body.notificationEmail;
    const hasShoutrrrStock = body.shoutrrrEnabled && body.shoutrrrStockReminders && body.shoutrrrUrl;
    const hasAnyStockReminder = hasEmailStock || hasShoutrrrStock;
    
    // Disable repeatDailyReminders if no stock reminders are configured
    const repeatDailyReminders = hasAnyStockReminder ? (body.repeatDailyReminders ?? false) : false;
    
    // Save notification settings to JSON file
    saveNotificationSettings({
      emailEnabled: body.emailEnabled,
      notificationEmail: body.notificationEmail,
      reminderDaysBefore: body.reminderDaysBefore,
      repeatDailyReminders,
      lowStockDays: body.lowStockDays ?? 30,
      normalStockDays: body.normalStockDays ?? 90,
      highStockDays: body.highStockDays ?? 180,
      shoutrrrEnabled: body.shoutrrrEnabled ?? false,
      shoutrrrUrl: body.shoutrrrUrl ?? "",
      // Granular notification settings
      emailStockReminders: body.emailStockReminders ?? true,
      emailIntakeReminders: body.emailIntakeReminders ?? true,
      shoutrrrStockReminders: body.shoutrrrStockReminders ?? true,
      shoutrrrIntakeReminders: body.shoutrrrIntakeReminders ?? true,
      // Language setting
      language: body.language ?? "en",
    });

    return reply.send({ success: true });
  });

  // Test email - use SMTP settings from process.env
  app.post<{ Body: TestEmailBody }>("/settings/test-email", async (request, reply) => {
    const { email } = request.body;
    
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
    const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
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
      const result = await sendShoutrrrNotification(url, "MedAssist-ng Test", "This is a test notification from MedAssist-ng. If you received this, your notification configuration is working correctly!");
      
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

// Send notification via Shoutrrr-compatible URL (supports ntfy, Discord, Telegram, etc.)
export async function sendShoutrrrNotification(urlStr: string, title: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Parse the URL to determine the service
    let targetUrl: string;
    let method = "POST";
    let headers: Record<string, string> = {};
    let body: string | undefined;

    // Remove emojis from title for header compatibility (ntfy doesn't support unicode in headers)
    // Match common emojis, pictographs, symbols, and variation selectors
    const cleanTitle = title.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{2000}-\u{206F}]|⚠|️/gu, "").trim();

    // Handle different URL formats
    if (urlStr.startsWith("ntfy://")) {
      // ntfy://[user:pass@]host/topic -> https://host/topic
      const parsed = new URL(urlStr.replace("ntfy://", "https://"));
      targetUrl = `https://${parsed.host}${parsed.pathname}`;
      headers = { "Title": cleanTitle, "Tags": "warning" };
      body = message;
      
      // Handle basic auth if present
      if (parsed.username && parsed.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64");
      }
    } else if (urlStr.startsWith("https://ntfy.") || urlStr.includes("ntfy.sh") || urlStr.includes("/ntfy/")) {
      // Direct ntfy HTTPS URL
      targetUrl = urlStr;
      headers = { "Title": cleanTitle, "Tags": "warning" };
      body = message;
    } else if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      // Generic webhook URL - send as JSON
      targetUrl = urlStr;
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify({ title, message, text: `${title}\n\n${message}` });
    } else {
      return { success: false, error: "Unsupported URL format. Use ntfy:// or https:// URL" };
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
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
