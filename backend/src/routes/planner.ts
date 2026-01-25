import type { FastifyInstance, FastifyRequest } from "fastify";
import nodemailer from "nodemailer";
import { getDateLocale, getTranslations, type Language, t } from "../i18n/translations.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { updateReminderSentTime, updateUserReminderSentTime } from "../services/reminder-scheduler.js";
import type { AuthUser } from "../types/fastify.js";
import { loadUserSettings, sendShoutrrrNotification } from "./settings.js";

// Escape HTML to prevent XSS in email templates
function escapeHtml(text: string): string {
	const htmlEscapes: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

type PlannerRow = {
	medicationId: number;
	medicationName: string;
	totalPills: number;
	plannerUsage: number;
	blisterSize: number;
	blistersNeeded: number;
	fullBlisters: number;
	loosePills: number;
	enough: boolean;
};

type SendEmailBody = {
	email: string;
	from: string;
	until: string;
	rows: PlannerRow[];
	language?: Language; // Optional: passed from frontend for unauthenticated requests
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
	language?: Language; // Optional: passed from frontend for unauthenticated requests
};

export async function plannerRoutes(app: FastifyInstance) {
	// Add auth hook for all planner routes
	app.addHook("preHandler", requireAuth);

	// Helper to get user ID from request
	async function getUserId(request: FastifyRequest): Promise<number> {
		if (!env.AUTH_ENABLED) {
			return getAnonymousUserId();
		}
		const authUser = request.user as unknown as AuthUser | null;
		if (!authUser?.id) {
			throw new Error("User not authenticated");
		}
		return authUser.id;
	}

	app.post<{ Body: SendEmailBody }>("/planner/send-email", async (request, reply) => {
		const { email, from, until, rows, language: bodyLanguage } = request.body;

		if (!email || !rows || rows.length === 0) {
			return reply.status(400).send({ error: "Missing email or planner data" });
		}

		const smtpHost = process.env.SMTP_HOST;
		const smtpUser = process.env.SMTP_USER;
		const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
		const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
		const smtpSecure = process.env.SMTP_SECURE === "true";
		const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

		if (!smtpHost || !smtpUser) {
			return reply.status(400).send({ error: "SMTP not configured" });
		}

		// Get locale from user settings or use the language passed in the body
		let language: Language = bodyLanguage || "en";
		const authUser = request.user as unknown as AuthUser | null;
		if (authUser?.id) {
			const userSettings = await loadUserSettings(authUser.id);
			language = userSettings.language;
		}
		const locale = getDateLocale(language);

		// Format dates for display
		const fromDate = new Date(from).toLocaleDateString(locale, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
		const untilDate = new Date(until).toLocaleDateString(locale, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});

		// Build HTML table with horizontal scroll for mobile
		const tableRows = rows
			.map(
				(row) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${escapeHtml(row.medicationName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${row.totalPills}</strong></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${row.plannerUsage}</strong></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.blistersNeeded} × ${row.blisterSize}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.fullBlisters}${row.loosePills > 0 ? ` (+${row.loosePills})` : ""}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; ${
							row.enough ? "background: #d1fae5; color: #065f46;" : "background: #fee2e2; color: #991b1b;"
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
          <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">MedAssist-ng - Demand Calculator</h2>
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
          <p style="color: #9ca3af; font-size: 11px; margin: 0;">Sent from MedAssist-ng Medication Planner</p>
        </div>
      </div>
    `;

		const plainText = `MedAssist-ng - Demand Calculator
Supply overview from ${fromDate} to ${untilDate}

${summaryText}

${rows.map((r) => `${r.medicationName}: ${r.totalPills} pills in stock, ${r.plannerUsage} pills needed, ${r.fullBlisters} blisters available${r.loosePills > 0 ? ` (+${r.loosePills} loose)` : ""} (${r.blistersNeeded} needed) - ${r.enough ? "Enough" : "OUT OF STOCK"}`).join("\n")}

---
Sent from MedAssist-ng Medication Planner`;

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
				subject: `MedAssist-ng - Supply Overview (${fromDate} - ${untilDate})`,
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

		// Load user settings
		const userId = await getUserId(request);
		const userSettings = await loadUserSettings(userId);
		const notificationSettings = {
			emailEnabled: userSettings.emailEnabled,
			shoutrrrEnabled: userSettings.shoutrrrEnabled,
			shoutrrrUrl: userSettings.shoutrrrUrl || "",
		};

		const results: { email?: boolean; push?: boolean; errors: string[] } = { errors: [] };

		// Separate empty from low stock medications
		const emptyMeds = lowStock.filter((r) => r.medsLeft <= 0);
		const lowMeds = lowStock.filter((r) => r.medsLeft > 0);

		// Send email if enabled
		if (notificationSettings.emailEnabled && email) {
			const smtpHost = process.env.SMTP_HOST;
			const smtpUser = process.env.SMTP_USER;
			const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
			const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
			const smtpSecure = process.env.SMTP_SECURE === "true";
			const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

			if (smtpHost && smtpUser) {
				// Build subject line based on what we have
				let subjectText: string;
				if (emptyMeds.length > 0 && lowMeds.length > 0) {
					subjectText = `🚨 ${emptyMeds.length} Empty, ⚠️ ${lowMeds.length} Running Low`;
				} else if (emptyMeds.length > 0) {
					subjectText = `🚨 ${emptyMeds.length} Medication${emptyMeds.length > 1 ? "s" : ""} Empty`;
				} else {
					subjectText = `⚠️ ${lowMeds.length} Medication${lowMeds.length > 1 ? "s" : ""} Running Low`;
				}

				// Build alert box based on what we have
				let alertHtml: string;
				if (emptyMeds.length > 0 && lowMeds.length > 0) {
					alertHtml = `
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fef2f2; border: 1px solid #dc2626;">
              <p style="margin: 0; color: #dc2626; font-weight: 600; font-size: 13px;">
                🚨 ${emptyMeds.length} medication${emptyMeds.length > 1 ? "s" : ""} EMPTY - reorder immediately!
              </p>
            </div>
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #fffbeb; border: 1px solid #f59e0b;">
              <p style="margin: 0; color: #b45309; font-weight: 500; font-size: 13px;">
                ⚠️ ${lowMeds.length} medication${lowMeds.length > 1 ? "s" : ""} running low - reorder soon
              </p>
            </div>`;
				} else if (emptyMeds.length > 0) {
					alertHtml = `
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #fef2f2; border: 1px solid #dc2626;">
              <p style="margin: 0; color: #dc2626; font-weight: 600; font-size: 13px;">
                🚨 ${emptyMeds.length} medication${emptyMeds.length > 1 ? "s" : ""} EMPTY - reorder immediately!
              </p>
            </div>`;
				} else {
					alertHtml = `
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; background: #fffbeb; border: 1px solid #f59e0b;">
              <p style="margin: 0; color: #b45309; font-weight: 500; font-size: 13px;">
                ⚠️ ${lowMeds.length} medication${lowMeds.length > 1 ? "s" : ""} running low - reorder soon
              </p>
            </div>`;
				}

				// Build table rows with status indicator
				const buildTableRow = (row: LowStockItem) => {
					const isEmpty = row.medsLeft <= 0;
					const statusIcon = isEmpty ? "🚨" : "⚠️";
					const rowBg = isEmpty ? "#fef2f2" : "white";
					return `
          <tr style="background: ${rowBg};">
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${statusIcon} ${escapeHtml(row.name)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; ${isEmpty ? "color: #dc2626; font-weight: 600;" : ""}"><strong>${row.medsLeft}</strong></td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${row.daysLeft ?? 0}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${isEmpty ? "<strong>NOW</strong>" : (row.depletionDate ?? "-")}</td>
          </tr>`;
				};

				const tableRows = lowStock.map(buildTableRow).join("");

				// Build description text
				let descriptionText: string;
				if (emptyMeds.length > 0 && lowMeds.length > 0) {
					descriptionText = "The following medications need to be reordered:";
				} else if (emptyMeds.length > 0) {
					descriptionText = "The following medications are EMPTY and need to be reordered immediately:";
				} else {
					descriptionText = "The following medications are running low and need to be reordered:";
				}

				const html = `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
            <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${emptyMeds.length > 0 ? "🚨" : "⚠️"} MedAssist-ng - Reorder Reminder</h2>
              <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${descriptionText}</p>
              
              ${alertHtml}

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
              <p style="color: #9ca3af; font-size: 11px; margin: 0;">Sent from MedAssist-ng Medication Planner</p>
            </div>
          </div>
        `;

				// Build plain text with sections
				let plainTextContent: string;
				if (emptyMeds.length > 0 && lowMeds.length > 0) {
					plainTextContent = `🚨 EMPTY (reorder immediately):
${emptyMeds.map((r) => `  • ${r.name}`).join("\n")}

⚠️ RUNNING LOW (reorder soon):
${lowMeds.map((r) => `  • ${r.name}: ${r.medsLeft} pills left, ${r.daysLeft ?? 0} days remaining`).join("\n")}`;
				} else if (emptyMeds.length > 0) {
					plainTextContent = `🚨 EMPTY (reorder immediately):
${emptyMeds.map((r) => `  • ${r.name}`).join("\n")}`;
				} else {
					plainTextContent = `⚠️ Running low:
${lowMeds.map((r) => `  • ${r.name}: ${r.medsLeft} pills left, ${r.daysLeft ?? 0} days remaining, runs out ${r.depletionDate ?? "soon"}`).join("\n")}`;
				}

				const plainText = `MedAssist-ng - Reorder Reminder

${plainTextContent}

---
Sent from MedAssist-ng Medication Planner`;

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
						subject: `MedAssist-ng - ${subjectText}`,
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
			// Get translations based on user language (default to 'en')
			const tr = getTranslations((userSettings.language as Language) || "en");

			// Build clear title
			const titleParts: string[] = [];
			if (emptyMeds.length > 0) {
				titleParts.push(`🚨 ${emptyMeds.length} ${tr.push.empty}`);
			}
			if (lowMeds.length > 0) {
				titleParts.push(`⚠️ ${lowMeds.length} ${tr.push.low}`);
			}
			const title = `MedAssist: ${titleParts.join(", ")} - ${tr.push.reorderNow}`;

			// Build clear message with sections
			const messageParts: string[] = [];
			if (emptyMeds.length > 0) {
				messageParts.push(`🚨 ${tr.push.emptySection}:`);
				emptyMeds.forEach((r) => messageParts.push(`  • ${r.name}`));
			}
			if (lowMeds.length > 0) {
				if (emptyMeds.length > 0) messageParts.push("");
				messageParts.push(`⚠️ ${tr.push.lowSection}:`);
				lowMeds.forEach((r) =>
					messageParts.push(
						`  • ${r.name}: ${t(tr.push.pillsLeft, { count: r.medsLeft })}, ${t(tr.push.daysLeft, { count: r.daysLeft ?? 0 })}`
					)
				);
			}
			const message = messageParts.join("\n");

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
			const channel = results.email && results.push ? "both" : results.email ? "email" : "push";
			updateReminderSentTime("stock", channel);

			// Also update user settings in database so frontend can display the info
			await updateUserReminderSentTime(userId, "stock", channel);
		}

		// Build response message
		const sentChannels: string[] = [];
		if (results.email) sentChannels.push("email");
		if (results.push) sentChannels.push("push");

		if (sentChannels.length > 0) {
			return reply.send({
				success: true,
				message: `Reminder sent via ${sentChannels.join(" and ")}`,
			});
		} else if (results.errors.length > 0) {
			return reply.status(500).send({ error: results.errors.join("; ") });
		} else {
			return reply.status(400).send({ error: "No notification channels configured" });
		}
	});
}
