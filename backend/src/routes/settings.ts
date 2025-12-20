import { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getReminderState } from "../services/reminder-scheduler.js";

type SettingsBody = {
  emailEnabled: boolean;
  notificationEmail: string;
  reminderDaysBefore: number;
  repeatDailyReminders: boolean;
  lowStockDays: number;
  normalStockDays: number;
  highStockDays: number;
};

type TestEmailBody = {
  email: string;
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
      };
    }
  } catch {
    // ignore
  }
  return { emailEnabled: false, notificationEmail: "", reminderDaysBefore: 7, repeatDailyReminders: false, lowStockDays: 30, normalStockDays: 90, highStockDays: 180 };
}

function saveNotificationSettings(settings: NotificationSettings): void {
  writeFileSync(notificationSettingsFile, JSON.stringify(settings, null, 2));
}

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
      // SMTP settings (admin-configured, from .env)
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: parseInt(process.env.SMTP_PORT ?? "587"),
      smtpUser: process.env.SMTP_USER ?? "",
      smtpFrom: process.env.SMTP_FROM ?? "",
      smtpSecure: process.env.SMTP_SECURE === "true",
      hasSmtpPassword: !!process.env.SMTP_PASS,
      // Reminder state
      lastAutoEmailSent: reminderState.lastAutoEmailSent,
    });
  });

  // Update settings - only notification settings are saved (SMTP comes from .env)
  app.put<{ Body: SettingsBody }>("/settings", async (request, reply) => {
    const body = request.body;
    
    // Save notification settings to JSON file
    saveNotificationSettings({
      emailEnabled: body.emailEnabled,
      notificationEmail: body.notificationEmail,
      reminderDaysBefore: body.reminderDaysBefore,
      repeatDailyReminders: body.repeatDailyReminders ?? false,
      lowStockDays: body.lowStockDays ?? 30,
      normalStockDays: body.normalStockDays ?? 90,
      highStockDays: body.highStockDays ?? 180,
    });

    return reply.send({ success: true });
  });

  // Test email - use SMTP settings from process.env
  app.post<{ Body: TestEmailBody }>("/settings/test-email", async (request, reply) => {
    const { email } = request.body;
    
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
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
        subject: "MedAssist - Test Email",
        text: "This is a test email from MedAssist. If you received this, your email configuration is working correctly!",
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">MedAssist - Test Email</h2>
            <p>This is a test email from MedAssist.</p>
            <p style="color: #10b981; font-weight: 600;">✓ If you received this, your email configuration is working correctly!</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 14px;">Sent from MedAssist Medication Planner</p>
          </div>
        `,
      });

      return reply.send({ success: true, message: "Test email sent successfully" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: `Failed to send email: ${errorMessage}` });
    }
  });
}
