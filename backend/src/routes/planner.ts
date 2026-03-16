import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { medications } from "../db/schema.js";
import {
	getDateLocale,
	getFooterHtml,
	getFooterPlain,
	getTranslations,
	type Language,
	t,
} from "../i18n/translations.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { updateReminderSentTime, updateUserReminderSentTime } from "../services/reminder-scheduler.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import {
	getPlannerUnitKind,
	isAmountBasedPackageType,
	isTubePackageType,
	normalizePackageType,
} from "../utils/package-profiles.js";
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

type MailDeliveryInfo = {
	accepted?: unknown;
	rejected?: unknown;
	response?: unknown;
};

function normalizeRecipients(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getDeliveryError(info: MailDeliveryInfo): string | null {
	const accepted = normalizeRecipients(info.accepted);
	const rejected = normalizeRecipients(info.rejected);

	if (accepted.length > 0) return null;
	if (rejected.length > 0) {
		return `SMTP rejected all recipients: ${rejected.join(", ")}`;
	}

	if (typeof info.response === "string" && info.response.trim()) {
		return `SMTP did not confirm accepted recipients. Response: ${info.response}`;
	}

	return "SMTP did not confirm accepted recipients.";
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
	packageType?: string;
};

function isContainerPackage(packageType?: string): boolean {
	return isAmountBasedPackageType(packageType);
}

function getPlannerUnit(packageType: string | undefined, tr: ReturnType<typeof getTranslations>): string {
	const unitKind = getPlannerUnitKind(packageType);
	if (unitKind === "units") return tr.common.units;
	if (unitKind === "ml") return tr.common.ml;
	return tr.common.pills;
}

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
	isCritical?: boolean;
};

type ReminderEmailBody = {
	email: string;
	lowStock: LowStockItem[];
	language?: Language; // Optional: passed from frontend for unauthenticated requests
};

type PrescriptionReminderItem = {
	name: string;
	remainingRefills: number;
	threshold: number;
	expiryDate?: string | null;
};

type PrescriptionReminderBody = {
	email: string;
	prescriptionLow: PrescriptionReminderItem[];
	language?: Language;
};

const plannerRowSchema = {
	type: "object",
	required: [
		"medicationId",
		"medicationName",
		"totalPills",
		"plannerUsage",
		"blisterSize",
		"blistersNeeded",
		"fullBlisters",
		"loosePills",
		"enough",
	],
	properties: {
		medicationId: { type: "integer" },
		medicationName: { type: "string" },
		totalPills: { type: "number" },
		plannerUsage: { type: "number" },
		blisterSize: { type: "number" },
		blistersNeeded: { type: "number" },
		fullBlisters: { type: "number" },
		loosePills: { type: "number" },
		enough: { type: "boolean" },
		packageType: { type: "string" },
	},
} as const;

const lowStockItemSchema = {
	type: "object",
	required: ["name", "medsLeft"],
	properties: {
		name: { type: "string" },
		medsLeft: { type: "number" },
		daysLeft: { type: "number" },
		depletionDate: { type: "string" },
		isCritical: { type: "boolean" },
	},
} as const;

const prescriptionReminderItemSchema = {
	type: "object",
	required: ["name", "remainingRefills", "threshold"],
	properties: {
		name: { type: "string" },
		remainingRefills: { type: "integer" },
		threshold: { type: "integer" },
		expiryDate: { type: "string" },
	},
} as const;

const notificationResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
		message: { type: "string" },
	},
} as const;

export async function plannerRoutes(app: FastifyInstance) {
	// Add auth hook for all planner routes
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "planner", protectedByDefault: true });

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

	// Demand calculator notification (supports email and push)
	app.post<{ Body: SendEmailBody }>(
		"/planner/send-email",
		{
			schema: {
				body: {
					type: "object",
					properties: {
						email: { type: "string" },
						from: { type: "string" },
						until: { type: "string" },
						language: { type: "string" },
						rows: { type: "array", items: plannerRowSchema },
					},
					example: {
						email: "daniel@example.com",
						from: "2026-03-11",
						until: "2026-04-11",
						language: "en",
						rows: [
							{
								medicationId: 1,
								medicationName: "Ibuprofen 400",
								totalPills: 20,
								plannerUsage: 12,
								blisterSize: 10,
								blistersNeeded: 2,
								fullBlisters: 1,
								loosePills: 8,
								enough: true,
								packageType: "box",
							},
						],
					},
				},
				response: {
					200: notificationResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, from, until, rows, language: bodyLanguage } = request.body;
			request.log.info({ email, rowCount: rows?.length ?? 0 }, "[Planner] Demand notification request received");

			if (!rows || rows.length === 0) {
				return reply.status(400).send({ error: "Missing planner data" });
			}

			// Load user settings for notification channels
			const userId = await getUserId(request);
			const activeMeds = await db
				.select({ id: medications.id })
				.from(medications)
				.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));
			const activeMedIds = new Set(activeMeds.map((med) => med.id));
			const activeRows = rows.filter((row) => activeMedIds.has(row.medicationId));
			if (activeRows.length === 0) {
				request.log.warn("[Planner] Demand notification skipped: no active medications in request");
				return reply.status(400).send({ error: "No active medications to notify" });
			}
			const activeMedicationNames = activeRows.map((row) => row.medicationName);

			const userSettings = await loadUserSettings(userId);
			const notificationSettings = {
				emailEnabled: userSettings.emailEnabled,
				shoutrrrEnabled: userSettings.shoutrrrEnabled,
				shoutrrrUrl: userSettings.shoutrrrUrl || "",
			};
			request.log.info(
				{
					userId,
					emailEnabled: notificationSettings.emailEnabled,
					pushEnabled: notificationSettings.shoutrrrEnabled,
					hasPushUrl: Boolean(notificationSettings.shoutrrrUrl),
					activeRowCount: activeRows.length,
					recipientEmail: email,
					medications: activeMedicationNames,
				},
				"[Planner] Demand notification channel state"
			);

			// Get locale from user settings or use the language passed in the body
			const language: Language = (userSettings.language as Language) || bodyLanguage || "en";
			const locale = getDateLocale(language);
			const tr = getTranslations(language);
			const dc = tr.demandCalculator;

			// Format dates for display - escape to prevent XSS even though toLocaleDateString should be safe
			const fromDate = escapeHtml(
				new Date(from).toLocaleDateString(locale, {
					year: "numeric",
					month: "long",
					day: "numeric",
				})
			);
			const untilDate = escapeHtml(
				new Date(until).toLocaleDateString(locale, {
					year: "numeric",
					month: "long",
					day: "numeric",
				})
			);

			const outOfStockCount = activeRows.filter((r) => !r.enough).length;
			const summaryText = outOfStockCount > 0 ? t(dc.summaryOutOfStock, { count: outOfStockCount }) : dc.summaryAllOk;

			// Load prescription data for medications referenced in planner rows
			const medIds = activeRows.map((r) => r.medicationId).filter(Boolean);
			const allMeds =
				medIds.length > 0
					? await db
							.select({
								id: medications.id,
								prescriptionEnabled: medications.prescriptionEnabled,
								prescriptionRemainingRefills: medications.prescriptionRemainingRefills,
							})
							.from(medications)
							.where(eq(medications.userId, userId))
					: [];
			const prescriptionMap = new Map(allMeds.map((m) => [m.id, m]));

			// Build plain text (shared between email and push)
			const plainText = `${dc.title}
${t(dc.description, { from: fromDate, until: untilDate })}

${summaryText}

${activeRows
	.map((r) => {
		const isBottle = isContainerPackage(r.packageType);
		const usageUnit = getPlannerUnit(r.packageType, tr);
		const usage = `${r.plannerUsage} ${usageUnit}`;
		const needed = isBottle ? "–" : `${r.blistersNeeded} × ${r.blisterSize}`;
		const medPrescription = prescriptionMap.get(r.medicationId);
		const rxRefills = medPrescription?.prescriptionEnabled
			? String(medPrescription.prescriptionRemainingRefills ?? 0)
			: dc.prescriptionNotApplicable;
		const loosePills = Math.round((Number(r.loosePills) || 0) * 10) / 10;
		const availableUnit = getPlannerUnit(r.packageType, tr);
		const available = isBottle
			? `${loosePills} ${availableUnit}`
			: `${r.fullBlisters} ${tr.common.blisters}${loosePills > 0 ? ` + ${loosePills} ${tr.common.pills}` : ""}`;
		const status = r.enough ? dc.statusEnough : dc.statusEmpty;
		return `${r.medicationName}: ${usage}, ${needed}, ${dc.tableHeaders.prescriptionRefills}: ${rxRefills}, ${available} - ${status}`;
	})
	.join("\n")}

---
${getFooterPlain(language)}`;

			const results: { email?: boolean; push?: boolean; errors: string[] } = { errors: [] };

			// Send email if enabled
			if (notificationSettings.emailEnabled && email) {
				const smtpHost = process.env.SMTP_HOST;
				const smtpUser = process.env.SMTP_USER;
				const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
				const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
				const smtpSecure = process.env.SMTP_SECURE === "true";
				const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

				request.log.info(
					{
						userId,
						hasSmtpHost: Boolean(smtpHost),
						hasSmtpUser: Boolean(smtpUser),
						hasSmtpPass: Boolean(smtpPass),
						smtpPort,
						smtpSecure,
						hasSmtpFrom: Boolean(smtpFrom),
						recipientEmail: email,
					},
					"[Planner] Demand email path selected"
				);

				if (smtpHost && smtpUser) {
					// Build HTML table with horizontal scroll for mobile
					// Escape/coerce all user-provided values to prevent XSS
					const tableRows = activeRows
						.map((row) => {
							const safeName = escapeHtml(row.medicationName);
							const safePlannerUsage = Number(row.plannerUsage) || 0;
							const safeBlistersNeeded = Number(row.blistersNeeded) || 0;
							const safeBlisterSize = Number(row.blisterSize) || 0;
							const safeFullBlisters = Number(row.fullBlisters) || 0;
							const safeLoosePills = Math.round((Number(row.loosePills) || 0) * 10) / 10;
							const isBottle = isContainerPackage(row.packageType);

							// "Blisters needed" column: dash for bottles
							const neededCell = isBottle ? "–" : `${safeBlistersNeeded} × ${safeBlisterSize}`;

							// "Prescription refills" column
							const medPrescription = prescriptionMap.get(row.medicationId);
							const rxCell = medPrescription?.prescriptionEnabled
								? String(medPrescription.prescriptionRemainingRefills ?? 0)
								: dc.prescriptionNotApplicable;

							// "Available" column: match frontend format
							let availableCell: string;
							if (isBottle) {
								const availableUnit = getPlannerUnit(row.packageType, tr);
								availableCell = `${safeLoosePills} ${availableUnit}`;
							} else {
								availableCell = `${safeFullBlisters} ${tr.common.blisters}`;
								if (safeLoosePills > 0) {
									availableCell += ` + ${safeLoosePills} ${tr.common.pills}`;
								}
							}

							const rowBg = row.enough ? "" : " background: #fef2f2;";

							return `
        <tr style="${rowBg}">
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${safeName}</td>
					<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;"><strong>${safePlannerUsage}</strong> ${getPlannerUnit(row.packageType, tr)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${neededCell}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${rxCell}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${availableCell}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; ${
							row.enough ? "background: #d1fae5; color: #065f46;" : "background: #fee2e2; color: #991b1b;"
						}">
              ${row.enough ? dc.statusEnough : dc.statusEmpty}
            </span>
          </td>
        </tr>
      `;
						})
						.join("");

					const html = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
        <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${dc.title}</h2>
          <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${t(dc.description, { from: `<strong>${fromDate}</strong>`, until: `<strong>${untilDate}</strong>` })}</p>
          
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
                  <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.medication}</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.usage}</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.needed}</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.prescriptionRefills}</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.available}</th>
                  <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; white-space: nowrap;">${dc.tableHeaders.status}</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #9ca3af; font-size: 11px; margin: 0;">${getFooterHtml(language)}</p>
        </div>
      </div>
    `;

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

						request.log.info({ userId, recipientEmail: email }, "[Planner] Sending demand email");

						const mailResult = await transporter.sendMail({
							from: smtpFrom,
							to: email,
							subject: t(dc.subject, { from: fromDate, until: untilDate }),
							text: plainText,
							html,
						});

						const deliveryError = getDeliveryError(mailResult);
						if (deliveryError) {
							throw new Error(deliveryError);
						}

						request.log.info(
							{ userId, recipientEmail: email, messageId: mailResult.messageId },
							"[Planner] Demand email sent"
						);
						results.email = true;
					} catch (error) {
						request.log.error({ userId, recipientEmail: email, error }, "[Planner] Demand email failed");
						const errorMessage = error instanceof Error ? error.message : "Unknown error";
						results.errors.push(`Email: ${errorMessage}`);
					}
				} else {
					request.log.warn(
						{
							userId,
							hasSmtpHost: Boolean(smtpHost),
							hasSmtpUser: Boolean(smtpUser),
							recipientEmail: email,
						},
						"[Planner] Demand email skipped: SMTP not configured"
					);
				}
			} else {
				request.log.info(
					{ emailEnabled: notificationSettings.emailEnabled, hasRecipient: Boolean(email) },
					"[Planner] Demand email channel not active"
				);
			}

			// Send push notification if enabled
			if (notificationSettings.shoutrrrEnabled && notificationSettings.shoutrrrUrl) {
				const pushTitle = t(dc.subject, { from: fromDate, until: untilDate });
				const pushMessage = `${summaryText}\n\n${activeRows
					.map((r) => {
						const usage = `${r.plannerUsage} ${getPlannerUnit(r.packageType, tr)}`;
						const status = r.enough ? dc.statusEnough : dc.statusEmpty;
						return `${r.enough ? "✓" : "✗"} ${r.medicationName}: ${usage} - ${status}`;
					})
					.join("\n")}\n\n---\n${getFooterPlain(language)}`;

				try {
					const pushResult = await sendShoutrrrNotification(notificationSettings.shoutrrrUrl, pushTitle, pushMessage);
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

			// Build response message
			const sentChannels: string[] = [];
			if (results.email) sentChannels.push("email");
			if (results.push) sentChannels.push("push");

			if (sentChannels.length > 0) {
				return reply.send({
					success: true,
					message: `Notification sent via ${sentChannels.join(" and ")}`,
				});
			} else if (results.errors.length > 0) {
				return reply.status(500).send({ error: results.errors.join("; ") });
			} else {
				return reply.status(400).send({ error: "No notification channels configured" });
			}
		}
	);

	// Reminder notification for low stock medications (supports email and push)
	app.post<{ Body: ReminderEmailBody }>(
		"/reminder/send-email",
		{
			schema: {
				body: {
					type: "object",
					properties: {
						email: { type: "string" },
						language: { type: "string" },
						lowStock: { type: "array", items: lowStockItemSchema },
					},
					example: {
						email: "daniel@example.com",
						language: "en",
						lowStock: [
							{
								name: "Ibuprofen 400",
								medsLeft: 4,
								daysLeft: 2,
								depletionDate: "2026-03-13",
								isCritical: true,
							},
						],
					},
				},
				response: {
					200: notificationResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, lowStock } = request.body;
			request.log.info(
				{ email, lowStockCount: lowStock?.length ?? 0 },
				"[ReminderManual] Stock reminder request received"
			);

			if (!lowStock || lowStock.length === 0) {
				return reply.status(400).send({ error: "Missing low stock data" });
			}

			// Load user settings
			const userId = await getUserId(request);
			const activeMeds = await db
				.select({ name: medications.name, genericName: medications.genericName, packageType: medications.packageType })
				.from(medications)
				.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));
			const activeMedicationByName = new Map(
				activeMeds
					.map((med) => [med.name || med.genericName || "", normalizePackageType(med.packageType)] as const)
					.filter(([name]) => name.length > 0)
			);
			const filteredLowStock = lowStock.filter((item) => {
				const packageType = activeMedicationByName.get(item.name);
				if (!packageType) return false;
				if (isTubePackageType(packageType)) return false;
				return true;
			});
			if (filteredLowStock.length === 0) {
				request.log.warn("[ReminderManual] Stock reminder skipped: no active medications after filtering");
				return reply.status(400).send({ error: "No active medications to notify" });
			}
			const filteredMedicationNames = filteredLowStock.map((item) => item.name);

			const userSettings = await loadUserSettings(userId);
			const notificationSettings = {
				emailEnabled: userSettings.emailEnabled,
				shoutrrrEnabled: userSettings.shoutrrrEnabled,
				shoutrrrUrl: userSettings.shoutrrrUrl || "",
			};
			request.log.info(
				{
					userId,
					emailEnabled: notificationSettings.emailEnabled,
					pushEnabled: notificationSettings.shoutrrrEnabled,
					hasPushUrl: Boolean(notificationSettings.shoutrrrUrl),
					filteredLowStockCount: filteredLowStock.length,
					recipientEmail: email,
					medications: filteredMedicationNames,
				},
				"[ReminderManual] Stock reminder channel state"
			);

			// Get translations based on user language
			const language = (userSettings.language as Language) || "en";
			const tr = getTranslations(language);

			const results: { email?: boolean; push?: boolean; errors: string[] } = { errors: [] };

			// Separate into 3 categories: empty, critical, and low stock
			const emptyMeds = filteredLowStock.filter((r) => r.medsLeft <= 0);
			const criticalMeds = filteredLowStock.filter((r) => r.medsLeft > 0 && r.isCritical !== false);
			const lowStockMeds = filteredLowStock.filter((r) => r.medsLeft > 0 && r.isCritical === false);

			// Build shared notification content (method-agnostic)
			const titleParts: string[] = [];
			if (emptyMeds.length > 0) {
				titleParts.push(`🚨 ${emptyMeds.length} ${tr.push.empty}`);
			}
			if (criticalMeds.length > 0) {
				titleParts.push(`🚨 ${criticalMeds.length} ${tr.push.critical}`);
			}
			if (lowStockMeds.length > 0) {
				titleParts.push(`⚠️ ${lowStockMeds.length} ${tr.push.lowStock}`);
			}
			const notificationTitle = `MedAssist-ng: ${titleParts.join(", ")} - ${tr.push.reorderNow}`;

			// Build description text
			let descriptionText: string;
			if (emptyMeds.length > 0 && (criticalMeds.length > 0 || lowStockMeds.length > 0)) {
				descriptionText = tr.stockReminder.descriptionMixed;
			} else if (emptyMeds.length > 0) {
				descriptionText = tr.stockReminder.descriptionEmpty;
			} else if (criticalMeds.length > 0) {
				descriptionText = tr.stockReminder.description;
			} else {
				descriptionText = tr.stockReminder.descriptionLow;
			}

			// Build section-based message (shared between email plain text and push)
			const messageParts: string[] = [];
			if (emptyMeds.length > 0) {
				messageParts.push(`🚨 ${tr.push.emptySection}:`);
				emptyMeds.forEach((r) => messageParts.push(`  • ${r.name}`));
			}
			if (criticalMeds.length > 0) {
				if (messageParts.length > 0) messageParts.push("");
				messageParts.push(`🚨 ${tr.push.criticalSection}:`);
				criticalMeds.forEach((r) =>
					messageParts.push(
						`  • ${r.name}: ${t(tr.push.pillsLeft, { count: r.medsLeft })}, ${t(tr.push.daysLeft, { count: r.daysLeft ?? 0 })}`
					)
				);
			}
			if (lowStockMeds.length > 0) {
				if (messageParts.length > 0) messageParts.push("");
				messageParts.push(`⚠️ ${tr.push.lowStockSection}:`);
				lowStockMeds.forEach((r) =>
					messageParts.push(
						`  • ${r.name}: ${t(tr.push.pillsLeft, { count: r.medsLeft })}, ${t(tr.push.daysLeft, { count: r.daysLeft ?? 0 })}`
					)
				);
			}

			// Send email if enabled
			if (notificationSettings.emailEnabled && email) {
				const smtpHost = process.env.SMTP_HOST;
				const smtpUser = process.env.SMTP_USER;
				const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS; // Token takes precedence
				const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
				const smtpSecure = process.env.SMTP_SECURE === "true";
				const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

				request.log.info(
					{
						userId,
						hasSmtpHost: Boolean(smtpHost),
						hasSmtpUser: Boolean(smtpUser),
						hasSmtpPass: Boolean(smtpPass),
						smtpPort,
						smtpSecure,
						hasSmtpFrom: Boolean(smtpFrom),
						recipientEmail: email,
					},
					"[ReminderManual] Stock email path selected"
				);

				if (smtpHost && smtpUser) {
					// Build subject line from shared title parts
					const subjectText = titleParts.join(", ");

					// Build alert boxes for each category
					const alertParts: string[] = [];

					if (emptyMeds.length > 0) {
						const emptyAlert =
							emptyMeds.length === 1
								? tr.stockReminder.alertEmptySingle
								: t(tr.stockReminder.alertEmptyMultiple, { count: emptyMeds.length });
						alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fef2f2; border: 1px solid #dc2626;">
              <p style="margin: 0; color: #dc2626; font-weight: 600; font-size: 13px;">
                ${emptyAlert}
              </p>
            </div>`);
					}

					if (criticalMeds.length > 0) {
						const criticalAlert =
							criticalMeds.length === 1
								? tr.stockReminder.alertLowSingle
								: t(tr.stockReminder.alertLowMultiple, { count: criticalMeds.length });
						alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fff7ed; border: 1px solid #ea580c;">
              <p style="margin: 0; color: #c2410c; font-weight: 600; font-size: 13px;">
                ${criticalAlert}
              </p>
            </div>`);
					}

					if (lowStockMeds.length > 0) {
						const lowAlert =
							lowStockMeds.length === 1
								? tr.stockReminder.alertLowStockSingle
								: t(tr.stockReminder.alertLowStockMultiple, { count: lowStockMeds.length });
						alertParts.push(`
            <div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; background: #fffbeb; border: 1px solid #f59e0b;">
              <p style="margin: 0; color: #b45309; font-weight: 500; font-size: 13px;">
                ${lowAlert}
              </p>
            </div>`);
					}

					const alertHtml = alertParts.join("");

					// Build table rows with status indicator
					const buildTableRow = (row: LowStockItem) => {
						const isEmpty = row.medsLeft <= 0;
						const isCritical = row.isCritical !== false;
						const nonEmptyIcon = isCritical ? "🚨" : "⚠️";
						const statusIcon = isEmpty ? "🚨" : nonEmptyIcon;
						const nonEmptyBg = isCritical ? "#fff7ed" : "white";
						const rowBg = isEmpty ? "#fef2f2" : nonEmptyBg;
						const safeName = escapeHtml(row.name);
						const safeMedsLeft = Number(row.medsLeft) || 0;
						const safeDaysLeft = Number(row.daysLeft) || 0;
						const safeDepletionDate = row.depletionDate ? escapeHtml(String(row.depletionDate)) : "-";
						return `
          <tr style="background: ${rowBg};">
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${statusIcon} ${safeName}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; ${isEmpty ? "color: #dc2626; font-weight: 600;" : ""}"><strong>${safeMedsLeft}</strong></td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${safeDaysLeft}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${isEmpty ? `<strong>${tr.stockReminder.now}</strong>` : safeDepletionDate}</td>
          </tr>`;
					};

					const tableRows = filteredLowStock.map(buildTableRow).join("");

					const html = `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
            <div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${emptyMeds.length > 0 ? "🚨" : "⚠️"} MedAssist-ng - ${tr.push.reorderNow}</h2>
              <p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${descriptionText}</p>
              
              ${alertHtml}

              <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                <table style="width: 100%; border-collapse: collapse; background: white; min-width: 400px;">
                  <thead>
                    <tr style="background: #f3f4f6;">
                      <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.medication}</th>
                      <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.pills}</th>
                      <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.days}</th>
                      <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.stockReminder.tableHeaders.runsOut}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRows}
                  </tbody>
                </table>
              </div>

							<p style="color: #9ca3af; font-size: 11px; margin: 16px 0 0 0;">${getFooterHtml(language)}</p>
            </div>
          </div>
        `;

					const plainText = `MedAssist-ng - ${tr.push.reorderNow}\n\n${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`;

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

						request.log.info({ userId, recipientEmail: email }, "[ReminderManual] Sending stock reminder email");

						const mailResult = await transporter.sendMail({
							from: smtpFrom,
							to: email,
							subject: `MedAssist-ng: ${subjectText}`,
							text: plainText,
							html,
						});

						const deliveryError = getDeliveryError(mailResult);
						if (deliveryError) {
							throw new Error(deliveryError);
						}

						request.log.info(
							{ userId, recipientEmail: email, messageId: mailResult.messageId },
							"[ReminderManual] Stock reminder email sent"
						);
						results.email = true;
					} catch (error) {
						request.log.error({ userId, recipientEmail: email, error }, "[ReminderManual] Stock reminder email failed");
						const errorMessage = error instanceof Error ? error.message : "Unknown error";
						results.errors.push(`Email: ${errorMessage}`);
					}
				} else {
					request.log.warn(
						{
							userId,
							hasSmtpHost: Boolean(smtpHost),
							hasSmtpUser: Boolean(smtpUser),
							recipientEmail: email,
						},
						"[ReminderManual] Stock reminder email skipped: SMTP not configured"
					);
				}
			} else {
				request.log.info(
					{ emailEnabled: notificationSettings.emailEnabled, hasRecipient: Boolean(email) },
					"[ReminderManual] Stock email channel not active"
				);
			}

			// Send push notification if enabled
			if (notificationSettings.shoutrrrEnabled && notificationSettings.shoutrrrUrl) {
				const message = `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`;

				try {
					const pushResult = await sendShoutrrrNotification(
						notificationSettings.shoutrrrUrl,
						notificationTitle,
						message
					);
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
				const singleChannel = results.email ? "email" : "push";
				const channel = results.email && results.push ? "both" : singleChannel;
				updateReminderSentTime("stock", channel);

				// Also update user settings in database so frontend can display the info
				const medNames = filteredLowStock.map((m: { name: string }) => m.name).join(", ");
				await updateUserReminderSentTime(userId, "stock", channel, medNames);
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
		}
	);

	// Manual prescription reminder (supports email and push)
	app.post<{ Body: PrescriptionReminderBody }>(
		"/reminder/send-prescription",
		{
			schema: {
				body: {
					type: "object",
					properties: {
						email: { type: "string" },
						language: { type: "string" },
						prescriptionLow: { type: "array", items: prescriptionReminderItemSchema },
					},
					example: {
						email: "daniel@example.com",
						language: "en",
						prescriptionLow: [
							{
								name: "Ibuprofen 400",
								remainingRefills: 1,
								threshold: 1,
								expiryDate: "2026-06-30",
							},
						],
					},
				},
				response: {
					200: notificationResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, prescriptionLow } = request.body;
			request.log.info(
				{ email, prescriptionCount: prescriptionLow?.length ?? 0 },
				"[ReminderManual] Prescription reminder request received"
			);

			if (!prescriptionLow || prescriptionLow.length === 0) {
				return reply.status(400).send({ error: "Missing prescription reminder data" });
			}

			const userId = await getUserId(request);
			const activeMeds = await db
				.select({ name: medications.name, genericName: medications.genericName })
				.from(medications)
				.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));
			const activeMedNames = new Set(activeMeds.map((med) => med.name || med.genericName || ""));
			const filteredPrescriptionLow = prescriptionLow.filter((item) => activeMedNames.has(item.name));
			if (filteredPrescriptionLow.length === 0) {
				request.log.warn("[ReminderManual] Prescription reminder skipped: no active medications after filtering");
				return reply.status(400).send({ error: "No active medications to notify" });
			}
			const filteredMedicationNames = filteredPrescriptionLow.map((item) => item.name);

			const userSettings = await loadUserSettings(userId);
			const language = (userSettings.language as Language) || "en";
			const tr = getTranslations(language);
			request.log.info(
				{
					userId,
					emailEnabled: userSettings.emailEnabled,
					pushEnabled: userSettings.shoutrrrEnabled,
					hasPushUrl: Boolean(userSettings.shoutrrrUrl),
					prescriptionCount: filteredPrescriptionLow.length,
					recipientEmail: email,
					medications: filteredMedicationNames,
				},
				"[ReminderManual] Prescription reminder channel state"
			);

			const emptyRx = filteredPrescriptionLow.filter((item) => item.remainingRefills <= 0);
			const lowRx = filteredPrescriptionLow.filter((item) => item.remainingRefills > 0);

			const lines = filteredPrescriptionLow.map((item) => {
				const expirySuffix = item.expiryDate ? t(tr.prescriptionReminder.expiresSuffix, { date: item.expiryDate }) : "";
				if (item.remainingRefills <= 0) {
					return `- ${t(tr.prescriptionReminder.lineEmpty, {
						name: item.name,
						expirySuffix,
					})}`;
				}
				return `- ${t(tr.prescriptionReminder.line, {
					name: item.name,
					refills: item.remainingRefills,
					expirySuffix,
				})}`;
			});

			const medNames = filteredPrescriptionLow.map((m: { name: string }) => m.name).join(", ");

			const results: { email?: boolean; push?: boolean; errors: string[] } = { errors: [] };

			if (userSettings.emailEnabled && userSettings.emailPrescriptionReminders && email) {
				const smtpHost = process.env.SMTP_HOST;
				const smtpUser = process.env.SMTP_USER;
				const smtpPass = process.env.SMTP_TOKEN || process.env.SMTP_PASS;
				const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
				const smtpSecure = process.env.SMTP_SECURE === "true";
				const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

				request.log.info(
					{
						userId,
						hasSmtpHost: Boolean(smtpHost),
						hasSmtpUser: Boolean(smtpUser),
						hasSmtpPass: Boolean(smtpPass),
						smtpPort,
						smtpSecure,
						hasSmtpFrom: Boolean(smtpFrom),
						recipientEmail: email,
					},
					"[ReminderManual] Prescription email path selected"
				);

				if (smtpHost && smtpUser) {
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

						const subject =
							filteredPrescriptionLow.length === 1
								? tr.prescriptionReminder.subjectSingle
								: t(tr.prescriptionReminder.subjectMultiple, { count: filteredPrescriptionLow.length });

						const bodyText =
							emptyRx.length > 0 ? tr.prescriptionReminder.descriptionEmpty : tr.prescriptionReminder.descriptionLow;
						const emptyAlert =
							emptyRx.length === 1
								? tr.prescriptionReminder.alertEmptySingle
								: t(tr.prescriptionReminder.alertEmptyMultiple, { count: emptyRx.length });
						const lowAlert =
							lowRx.length === 1
								? tr.prescriptionReminder.alertLowSingle
								: t(tr.prescriptionReminder.alertLowMultiple, { count: lowRx.length });
						const alertText = emptyRx.length > 0 ? emptyAlert : lowAlert;

						const tableRows = filteredPrescriptionLow
							.map((item) => {
								const isEmpty = item.remainingRefills <= 0;
								const safeName = escapeHtml(item.name);
								const safeRefills = Number(item.remainingRefills) || 0;
								const safeThreshold = Number(item.threshold) || 0;
								const safeExpiry = item.expiryDate ? escapeHtml(String(item.expiryDate)) : "-";
								const rowBg = isEmpty ? "#fef2f2" : "white";
								return `
					<tr style="background: ${rowBg};">
						<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${isEmpty ? "🚨" : "⚠️"} ${safeName}</td>
						<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; ${isEmpty ? "color: #dc2626; font-weight: 600;" : ""}"><strong>${safeRefills}</strong></td>
						<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${safeThreshold}</td>
						<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${safeExpiry}</td>
					</tr>`;
							})
							.join("");

						const emailTitle = emptyRx.length > 0 ? tr.prescriptionReminder.titleEmpty : tr.prescriptionReminder.title;
						const text = `${emailTitle}\n\n${bodyText}\n\n${lines.join("\n")}\n\n---\n${getFooterPlain(language)}`;
						const html = `
					<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 100%; margin: 0 auto; padding: 12px; background: #f9fafb;">
						<div style="background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
							<h2 style="color: #1f2937; margin: 0 0 8px; font-size: 18px;">${emailTitle}</h2>
							<p style="color: #6b7280; margin: 0 0 16px; font-size: 13px;">${bodyText}</p>

							<div style="padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; ${emptyRx.length > 0 ? "background: #fef2f2; border: 1px solid #dc2626;" : "background: #fffbeb; border: 1px solid #f59e0b;"}">
								<p style="margin: 0; ${emptyRx.length > 0 ? "color: #dc2626; font-weight: 600;" : "color: #b45309; font-weight: 500;"} font-size: 13px;">
									${alertText}
								</p>
							</div>

							<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
								<table style="width: 100%; border-collapse: collapse; background: white; min-width: 460px;">
									<thead>
										<tr style="background: #f3f4f6;">
											<th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.medication}</th>
											<th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.refillsLeft}</th>
											<th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.reminderThreshold}</th>
											<th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; white-space: nowrap;">${tr.prescriptionReminder.tableHeaders.prescriptionExpires}</th>
										</tr>
									</thead>
									<tbody>
										${tableRows}
									</tbody>
								</table>
							</div>

							<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
							<p style="color: #9ca3af; font-size: 11px; margin: 0;">${getFooterHtml(language)}</p>
						</div>
					</div>
				`;

						request.log.info({ userId, recipientEmail: email }, "[ReminderManual] Sending prescription reminder email");

						const mailResult = await transporter.sendMail({
							from: smtpFrom,
							to: email,
							subject,
							text,
							html,
						});

						const deliveryError = getDeliveryError(mailResult);
						if (deliveryError) {
							throw new Error(deliveryError);
						}

						request.log.info(
							{ userId, recipientEmail: email, messageId: mailResult.messageId },
							"[ReminderManual] Prescription reminder email sent"
						);
						results.email = true;
					} catch (error) {
						request.log.error(
							{ userId, recipientEmail: email, error },
							"[ReminderManual] Prescription reminder email failed"
						);
						const errorMessage = error instanceof Error ? error.message : "Unknown error";
						results.errors.push(`Email: ${errorMessage}`);
					}
				} else {
					request.log.warn(
						{
							userId,
							hasSmtpHost: Boolean(smtpHost),
							hasSmtpUser: Boolean(smtpUser),
							recipientEmail: email,
						},
						"[ReminderManual] Prescription reminder email skipped: SMTP not configured"
					);
				}
			} else {
				request.log.info(
					{
						emailEnabled: userSettings.emailEnabled,
						emailPrescriptionReminders: userSettings.emailPrescriptionReminders,
						hasRecipient: Boolean(email),
					},
					"[ReminderManual] Prescription email channel not active"
				);
			}

			if (userSettings.shoutrrrEnabled && userSettings.shoutrrrPrescriptionReminders && userSettings.shoutrrrUrl) {
				const titleParts: string[] = [];
				if (emptyRx.length > 0)
					titleParts.push(
						`🚨 ${emptyRx.length} ${emptyRx.length === 1 ? tr.prescriptionReminder.pushEmptySingle : tr.prescriptionReminder.pushEmpty}`
					);
				if (lowRx.length > 0)
					titleParts.push(
						`🚨 ${lowRx.length} ${lowRx.length === 1 ? tr.prescriptionReminder.pushLowSingle : tr.prescriptionReminder.pushLow}`
					);
				const title = `MedAssist-ng: ${titleParts.join(", ")} - ${tr.prescriptionReminder.pushRenewNow}`;

				const messageParts: string[] = [];
				if (emptyRx.length > 0) {
					messageParts.push(`🚨 ${tr.prescriptionReminder.pushEmptySection}:`);
					for (const m of emptyRx) {
						messageParts.push(`  • ${m.name}`);
					}
				}
				if (lowRx.length > 0) {
					if (emptyRx.length > 0) messageParts.push("");
					messageParts.push(`🚨 ${tr.prescriptionReminder.pushLowSection}:`);
					for (const m of lowRx) {
						messageParts.push(
							`  • ${m.name}: ${t(tr.prescriptionReminder.pushRefillsLeft, { count: m.remainingRefills })}`
						);
					}
				}
				const message = `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`;

				try {
					const pushResult = await sendShoutrrrNotification(userSettings.shoutrrrUrl, title, message);
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

			if (results.email || results.push) {
				const singleChannel = results.email ? "email" : "push";
				const channel = results.email && results.push ? "both" : singleChannel;
				updateReminderSentTime("prescription", channel);
				await updateUserReminderSentTime(userId, "prescription", channel, medNames);
			}

			const sentChannels: string[] = [];
			if (results.email) sentChannels.push("email");
			if (results.push) sentChannels.push("push");

			if (sentChannels.length > 0) {
				return reply.send({
					success: true,
					message: `Prescription reminder sent via ${sentChannels.join(" and ")}`,
				});
			}

			if (results.errors.length > 0) {
				return reply.status(500).send({ error: results.errors.join("; ") });
			}

			return reply.status(400).send({ error: "No notification channels configured" });
		}
	);
}
