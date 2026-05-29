export type MailDeliveryInfo = {
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

export function getDeliveryError(info: MailDeliveryInfo): string | null {
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
