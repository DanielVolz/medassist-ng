import nodemailer from "nodemailer";
import { sendShoutrrrNotification } from "../../routes/settings.js";

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

export type EmailDeliveryRequest = {
	to: string;
	subject: string;
	text: string;
	html: string;
	from?: string;
};

export type EmailDeliveryResult = {
	success: boolean;
	error?: string;
	messageId?: string;
	smtpResponse?: string;
};

export function getSmtpConfig(): {
	host?: string;
	user?: string;
	pass?: string;
	port: number;
	secure: boolean;
	from?: string;
} {
	const host = process.env.SMTP_HOST;
	const user = process.env.SMTP_USER;
	const pass = process.env.SMTP_TOKEN || process.env.SMTP_PASS;
	const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
	const secure = process.env.SMTP_SECURE === "true";
	const from = process.env.SMTP_FROM ?? user;

	return { host, user, pass, port, secure, from };
}

export function createSmtpTransport(smtp = getSmtpConfig()) {
	if (!smtp.host || !smtp.user) {
		return null;
	}

	// The SMTP endpoint is configured by the server operator via environment variables,
	// not derived from request-controlled input.
	// lgtm [js/request-forgery]
	return nodemailer.createTransport({
		host: smtp.host,
		port: smtp.port,
		secure: smtp.secure,
		auth: {
			user: smtp.user,
			pass: smtp.pass ?? "",
		},
	});
}

export async function sendEmailNotification(input: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
	const smtp = getSmtpConfig();
	if (!smtp.host || !smtp.user) {
		return { success: false, error: "SMTP not configured" };
	}

	try {
		const transporter = createSmtpTransport(smtp);
		if (!transporter) {
			return { success: false, error: "SMTP not configured" };
		}

		const mailResult = await transporter.sendMail({
			from: input.from ?? smtp.from,
			to: input.to,
			subject: input.subject,
			text: input.text,
			html: input.html,
		});

		const deliveryError = getDeliveryError(mailResult);
		if (deliveryError) {
			return { success: false, error: deliveryError };
		}

		return {
			success: true,
			messageId: mailResult.messageId,
			smtpResponse: typeof mailResult.response === "string" ? mailResult.response : undefined,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}

export async function sendPushNotification(
	url: string,
	title: string,
	message: string
): Promise<{ success: boolean; error?: string; providerMessageId?: string }> {
	try {
		const result = await sendShoutrrrNotification(url, title, message);
		if (!result.success) {
			return { success: false, error: result.error };
		}
		return { success: true, providerMessageId: result.providerMessageId };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
}
