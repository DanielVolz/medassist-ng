import { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";

type PlannerRow = {
  medicationId: number;
  medicationName: string;
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

    // Build HTML table
    const tableRows = rows
      .map(
        (row) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${row.medicationName}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;"><strong>${row.plannerUsage}</strong> pills</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.stripsNeeded} × ${row.stripSize}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.stripsAvailable} blisters</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            <span style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${
              row.enough
                ? "background: #d1fae5; color: #065f46;"
                : "background: #fee2e2; color: #991b1b;"
            }">
              ${row.enough ? "✓ Enough" : "⚠ Out of Stock"}
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
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; margin: 0 0 8px;">MedAssist - Demand Calculator</h2>
          <p style="color: #6b7280; margin: 0 0 24px;">Supply overview from <strong>${fromDate}</strong> to <strong>${untilDate}</strong></p>
          
          <div style="padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; ${
            outOfStockCount > 0
              ? "background: #fef2f2; border: 1px solid #fecaca;"
              : "background: #f0fdf4; border: 1px solid #bbf7d0;"
          }">
            <p style="margin: 0; color: ${outOfStockCount > 0 ? "#991b1b" : "#166534"}; font-weight: 500;">
              ${summaryText}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; background: white;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Medication</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Usage</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Blisters Needed</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Available</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent from MedAssist Medication Planner</p>
        </div>
      </div>
    `;

    const plainText = `MedAssist - Demand Calculator
Supply overview from ${fromDate} to ${untilDate}

${summaryText}

${rows.map((r) => `${r.medicationName}: ${r.plannerUsage} pills needed, ${r.stripsAvailable} blisters available (${r.stripsNeeded} needed) - ${r.enough ? "Enough" : "OUT OF STOCK"}`).join("\n")}

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

  // Reminder email for low stock medications
  app.post<{ Body: ReminderEmailBody }>("/reminder/send-email", async (request, reply) => {
    const { email, lowStock } = request.body;

    if (!email || !lowStock || lowStock.length === 0) {
      return reply.status(400).send({ error: "Missing email or low stock data" });
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

    const tableRows = lowStock
      .map(
        (row) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${row.name}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;"><strong>${row.medsLeft}</strong> pills</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.daysLeft ?? 0} days</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.depletionDate ?? "-"}</td>
        </tr>
      `
      )
      .join("");

    const html = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; margin: 0 0 8px;">⚠️ MedAssist - Reorder Reminder</h2>
          <p style="color: #6b7280; margin: 0 0 24px;">The following medications are running low and need to be reordered:</p>
          
          <div style="padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; background: #fef2f2; border: 1px solid #fecaca;">
            <p style="margin: 0; color: #991b1b; font-weight: 500;">
              ⚠️ ${lowStock.length} medication${lowStock.length > 1 ? "s" : ""} running low!
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; background: white;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6b7280;">Medication</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280;">Current Pills</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280;">Days Left</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; text-transform: uppercase; color: #6b7280;">Runs Out</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent from MedAssist Medication Planner</p>
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

      return reply.send({ success: true, message: "Reminder email sent" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: `Failed to send email: ${errorMessage}` });
    }
  });
}
