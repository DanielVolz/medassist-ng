import { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { updateReminderSentTime } from "../services/reminder-scheduler.js";
import { loadNotificationSettings, sendShoutrrrNotification } from "./settings.js";

type PlannerRow = {
  medicationId: number;
  medicationName: string;
  totalPills: number;
  plannerUsage: number;
  stripSize: number;
  stripsNeeded: number;
  stripsAvailable: number;
  enough: boolean;
};

type SendEmailBody = {
  email: string;
  from: string;
  until: string;
  rows: PlannerRow[];
};

type LowStockItem = {
  name: string;
  medsLeft: number;
  daysLeft: number | null;
  depletionDate: string | null;
};

type ReminderEmailBody = {
  email: string;
  lowStock: LowStockItem[];
};

export async function plannerRoutes(app: FastifyInstance) {
  app.post<{ Body: SendEmailBody }>("/planner/send-email", async (request, reply) => {
    const { email, from, until, rows } = request.body;

    if (!email || !rows || rows.length === 0) {
      return reply.status(400).send({ error: "Missing email or planner data" });
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
    const smtpSecure = process.env.SMTP_SECURE === "true";
    const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

    if (!smtpHost || !smtpUser) {
      return reply.status(400).send({ error: "SMTP not configured" });
    }

    // Format dates for display
    const fromDate = new Date(from).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const untilDate = new Date(until).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Build HTML table with horizontal scroll for mobile
    const tableRows = rows
      .map(
        (row) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${row.medicationName}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${row.totalPills}</strong></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${row.plannerUsage}</strong></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.stripsNeeded} × ${row.stripSize}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.stripsAvailable}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; ${
              row.enough
                ? "background: #d1fae5; color: #065f46;"
                : "background: #fee2e2; color: #991b1b;"
            }">
              ${row.enough ? "✓ OK" : "✗ Out of Stock"}
            </span>
          </td>
        </tr>
      `
      )
      .join("");

    const outOfStockCount = rows.filter((r) => !r.enough).length;
    const summaryText =
      outOfStockCount > 0
        ? `⚠️ ${outOfStockCount} medication${outOfStockCount > 1 ? "s" : ""} will be out of stock during this period.`
        : "✓ All medications have sufficient supply for this period.";

    const html = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
        <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">MedAssist - Demand Calculator</h2>
          <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">Supply overview from <strong>${fromDate}</strong> to <strong>${untilDate}</strong></p>
          
          <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; ${
            outOfStockCount > 0
              ? "background: #fef2f2; border: 1px solid #fecaca;"
              : "background: #f0fdf4; border: 1px solid #bbf7d0;"
          }">
            <p style="margin: 0; color: ${outOfStockCount > 0 ? "#991b1b" : "#166534"}; font-weight: 500; font-size: 13px;">
              ${summaryText}
            </p>
          </div>

          <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
            <table style="width: 100%; border-collapse: collapse; background: white; min-width: 550px;">
              <thead>
                <tr style="background: #f3f4f6;">
                  <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Medication</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Stock</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Usage</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Needed</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Available</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #9ca3af; font-size: 11px; margin: 0;">Sent from MedAssist Medication Planner</p>
        </div>
      </div>
    `;

    const plainText = `MedAssist - Demand Calculator
Supply overview from ${fromDate} to ${untilDate}

${summaryText}

${rows.map((r) => `${r.medicationName}: ${r.totalPills} pills in stock, ${r.plannerUsage} pills needed, ${r.stripsAvailable} blisters available (${r.stripsNeeded} needed) - ${r.enough ? "Enough" : "OUT OF STOCK"}`).join("\n")}

---
Sent from MedAssist Medication Planner`;

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
        subject: `MedAssist - Supply Overview (${fromDate} - ${untilDate})`,
        text: plainText,
        html,
      });

      return reply.send({ success: true, message: "Email sent successfully" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: `Failed to send email: ${errorMessage}` });
    }
  });

  // Reminder notification for low stock medications (supports email and push)
  app.post<{ Body: ReminderEmailBody }>("/reminder/send-email", async (request, reply) => {
    const { email, lowStock } = request.body;

    if (!lowStock || lowStock.length === 0) {
      return reply.status(400).send({ error: "Missing low stock data" });
    }

    const notificationSettings = loadNotificationSettings();
    const results: { email?: boolean; push?: boolean; errors: string[] } = { errors: [] };

    // Send email if enabled
    if (notificationSettings.emailEnabled && email) {
      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
      const smtpSecure = process.env.SMTP_SECURE === "true";
      const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

      if (smtpHost && smtpUser) {
        // Build HTML table with horizontal scroll for mobile
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
              <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">⚠️ MedAssist - Reorder Reminder</h2>
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
              <p style="color: #9ca3af; font-size: 11px; margin: 0;">Sent from MedAssist Medication Planner</p>
            </div>
          </div>
        `;

        const plainText = `MedAssist - Reorder Reminder

The following medications are running low:

${lowStock.map((r) => `${r.name}: ${r.medsLeft} pills left, ${r.daysLeft ?? 0} days remaining, runs out ${r.depletionDate ?? "soon"}`).join("\n")}

---
Sent from MedAssist Medication Planner`;

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
            subject: `⚠️ MedAssist - ${lowStock.length} Medication${lowStock.length > 1 ? "s" : ""} Running Low`,
            text: plainText,
            html,
          });

          results.email = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          results.errors.push(`Email: ${errorMessage}`);
        }
      }
    }

    // Send push notification if enabled
    if (notificationSettings.shoutrrrEnabled && notificationSettings.shoutrrrUrl) {
      const title = `${lowStock.length} Medication${lowStock.length > 1 ? "s" : ""} Running Low`;
      const message = lowStock
        .map((r) => `- ${r.name}: ${r.medsLeft} pills (${r.daysLeft ?? 0} days)`)
        .join("\n");

      try {
        const pushResult = await sendShoutrrrNotification(notificationSettings.shoutrrrUrl, title, message);
        if (pushResult.success) {
          results.push = true;
        } else {
          results.errors.push(`Push: ${pushResult.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.errors.push(`Push: ${errorMessage}`);
      }
    }

    // Update the reminder state to record this notification was sent
    if (results.email || results.push) {
      updateReminderSentTime();
    }

    // Build response message
    const sentChannels: string[] = [];
    if (results.email) sentChannels.push("email");
    if (results.push) sentChannels.push("push");

    if (sentChannels.length > 0) {
      return reply.send({ 
        success: true, 
        message: `Reminder sent via ${sentChannels.join(" and ")}` 
      });
    } else if (results.errors.length > 0) {
      return reply.status(500).send({ error: results.errors.join("; ") });
    } else {
      return reply.status(400).send({ error: "No notification channels configured" });
    }
  });
}
