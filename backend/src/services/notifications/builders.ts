import { getFooterPlain, getTranslations, type Language, t } from "../../i18n/translations.js";

export type StockReminderItem = {
	name: string;
	medsLeft: number;
	daysLeft: number | null;
	depletionDate: string | null;
	isCritical?: boolean;
};

export type PrescriptionReminderItem = {
	name: string;
	remainingRefills: number;
};

function splitStockItems(items: StockReminderItem[]): {
	emptyItems: StockReminderItem[];
	criticalItems: StockReminderItem[];
	lowItems: StockReminderItem[];
} {
	const emptyItems = items.filter((item) => item.medsLeft <= 0);
	const criticalItems = items.filter((item) => item.medsLeft > 0 && item.isCritical !== false);
	const lowItems = items.filter((item) => item.medsLeft > 0 && item.isCritical === false);
	return { emptyItems, criticalItems, lowItems };
}

export function buildStockReminderPushNotification(
	items: StockReminderItem[],
	language: Language
): { title: string; message: string } {
	const tr = getTranslations(language);
	const { emptyItems, criticalItems, lowItems } = splitStockItems(items);

	const titleParts: string[] = [];
	if (emptyItems.length > 0) titleParts.push(`🚨 ${emptyItems.length} ${tr.push.empty}`);
	if (criticalItems.length > 0) titleParts.push(`🚨 ${criticalItems.length} ${tr.push.critical}`);
	if (lowItems.length > 0) titleParts.push(`⚠️ ${lowItems.length} ${tr.push.lowStock}`);
	const title = `MedAssist-ng: ${titleParts.join(", ")} - ${tr.push.reorderNow}`;

	const messageParts: string[] = [];
	if (emptyItems.length > 0) {
		messageParts.push(`🚨 ${tr.push.emptySection}:`);
		emptyItems.forEach((item) => messageParts.push(`  • ${item.name}`));
	}
	if (criticalItems.length > 0) {
		if (messageParts.length > 0) messageParts.push("");
		messageParts.push(`🚨 ${tr.push.criticalSection}:`);
		criticalItems.forEach((item) =>
			messageParts.push(
				`  • ${item.name}: ${t(tr.push.pillsLeft, { count: item.medsLeft })}, ${t(tr.push.daysLeft, { count: item.daysLeft ?? 0 })}`
			)
		);
	}
	if (lowItems.length > 0) {
		if (messageParts.length > 0) messageParts.push("");
		messageParts.push(`⚠️ ${tr.push.lowStockSection}:`);
		lowItems.forEach((item) =>
			messageParts.push(
				`  • ${item.name}: ${t(tr.push.pillsLeft, { count: item.medsLeft })}, ${t(tr.push.daysLeft, { count: item.daysLeft ?? 0 })}`
			)
		);
	}

	return {
		title,
		message: `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`,
	};
}

export function buildPrescriptionReminderPushNotification(
	items: PrescriptionReminderItem[],
	language: Language
): { title: string; message: string } {
	const tr = getTranslations(language);
	const emptyItems = items.filter((item) => item.remainingRefills <= 0);
	const lowItems = items.filter((item) => item.remainingRefills > 0);

	const titleParts: string[] = [];
	if (emptyItems.length > 0) {
		titleParts.push(
			`🚨 ${emptyItems.length} ${emptyItems.length === 1 ? tr.prescriptionReminder.pushEmptySingle : tr.prescriptionReminder.pushEmpty}`
		);
	}
	if (lowItems.length > 0) {
		titleParts.push(
			`🚨 ${lowItems.length} ${lowItems.length === 1 ? tr.prescriptionReminder.pushLowSingle : tr.prescriptionReminder.pushLow}`
		);
	}

	const messageParts: string[] = [];
	if (emptyItems.length > 0) {
		messageParts.push(`🚨 ${tr.prescriptionReminder.pushEmptySection}:`);
		emptyItems.forEach((item) => messageParts.push(`  • ${item.name}`));
	}
	if (lowItems.length > 0) {
		if (messageParts.length > 0) messageParts.push("");
		messageParts.push(`🚨 ${tr.prescriptionReminder.pushLowSection}:`);
		lowItems.forEach((item) =>
			messageParts.push(
				`  • ${item.name}: ${t(tr.prescriptionReminder.pushRefillsLeft, { count: item.remainingRefills })}`
			)
		);
	}

	return {
		title: `MedAssist-ng: ${titleParts.join(", ")} - ${tr.prescriptionReminder.pushRenewNow}`,
		message: `${messageParts.join("\n")}\n\n---\n${getFooterPlain(language)}`,
	};
}
