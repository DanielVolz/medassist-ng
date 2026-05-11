import { getPlannerUnitKind, isAmountBasedPackageType } from "../utils/package-profiles.js";

// Escape HTML to prevent XSS in email templates.
export function escapeHtml(text: string): string {
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

export function isContainerPackage(packageType?: string): boolean {
	return isAmountBasedPackageType(packageType);
}

export function getPlannerUnit(
	packageType: string | undefined,
	tr: { common: { units: string; ml: string; pills: string; puffs?: string; injections?: string } }
): string {
	const unitKind = getPlannerUnitKind(packageType);
	if (unitKind === "units") return tr.common.units;
	if (unitKind === "ml") return tr.common.ml;
	if (unitKind === "puffs") return tr.common.puffs ?? tr.common.pills;
	if (unitKind === "injections") return tr.common.injections ?? tr.common.pills;
	return tr.common.pills;
}

export function formatPlannerQuantity(
	packageType: string | undefined,
	count: number,
	tr: { common: { units: string; ml: string; pills: string; puffs?: string; injections?: string } }
): string {
	return `${count} ${getPlannerUnit(packageType, tr)}`;
}
