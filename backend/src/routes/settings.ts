import { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

type SettingsBody = {
  emailEnabled: boolean;
  notificationEmail: string;
  reminderDaysBefore: number;
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
};

function loadNotificationSettings(): NotificationSettings {
  try {
    if (existsSync(notificationSettingsFile)) {
      return JSON.parse(readFileSync(notificationSettingsFile, "utf-8"));
    }
  } catch {
    // ignore
  }
  return { emailEnabled: false, notificationEmail: "", reminderDaysBefore: 7 };
}

function saveNotificationSettings(settings: NotificationSettings): void {
  writeFileSync(notificationSettingsFile, JSON.stringify(settings, null, 2));
}

export async function settingsRoutes(app: FastifyInstance) {
  // Get settings - notification from JSON file, SMTP from process.env
  app.get("/settings", async (_request, reply) => {
    const notification = loadNotificationSettings();
    
    return reply.send({
      // Notification settings (user-configurable, stored in JSON)
      emailEnabled: notification.emailEnabled,
      notificationEmail: notification.notificationEmail,
      reminderDaysBefore: notification.reminderDaysBefore,
      // SMTP settings (admin-configured, from .env)
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: parseInt(process.env.SMTP_PORT ?? "587"),
      smtpUser: process.env.SMTP_USER ?? "",
      smtpFrom: process.env.SMTP_FROM ?? "",
      smtpSecure: process.env.SMTP_SECURE === "true",
      hasSmtpPassword: !!process.env.SMTP_PASS,
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
