import type { Coverage, Medication, PackageType } from "../types";
import { getMedTotal as getMedTotalFromTypes, isLiquidContainerPackageType, isTubePackageType } from "../types";
import { splitCurrentBlisterStock } from "../utils/stock";

export function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

export function getBlisterStock(
	totalPills: number,
	pillsPerBlister: number,
	looseTablets: number,
	_originalTotal: number
) {
	return splitCurrentBlisterStock(totalPills, pillsPerBlister, looseTablets);
}

export function formatFullBlisters(count: number, t: (key: string) => string): string {
	return `${count} ${count === 1 ? t("common.blister") : t("common.blisters")}`;
}

export function formatOpenBlisterAndLoose(
	openBlisterPills: number,
	loosePills: number,
	pillsPerBlister: number,
	t: (key: string) => string
): string {
	if (openBlisterPills > 0 && loosePills > 0) {
		return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")} + ${loosePills} ${t("modal.loosePills")}`;
	}
	if (openBlisterPills > 0) {
		return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")}`;
	}
	if (loosePills > 0) {
		return `${loosePills} ${t("modal.loosePills")}`;
	}
	return "-";
}

export function getMedTotal(med: {
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	stockAdjustment?: number | null;
	packageType?: PackageType;
}): number {
	return getMedTotalFromTypes({
		...med,
		stockAdjustment: med.stockAdjustment ?? undefined,
	});
}

export function getReminderStatusData(
	reminderDaysBefore: number,
	lowStockDays: number,
	_allLowCoverage: Coverage[],
	allCoverage: Coverage[],
	meds: Medication[],
	lastAutoEmailSent: string | null,
	_lastNotificationType: string | null,
	_lastNotificationChannel: string | null,
	lastReminderMedName: string | null,
	lastReminderTakenBy: string | null,
	lastStockReminderSent: string | null,
	_lastStockReminderChannel: string | null,
	lastStockReminderMedNames: string | null,
	t: (key: string, options?: Record<string, unknown>) => string,
	locale: string
): {
	status: { text: string; className: string };
	lowStockMeds: { name: string; daysLeft: number; isCritical: boolean }[];
	lastStockSent: { date: string; medNames: string | null } | null;
	lastIntakeSent: { date: string; medName: string | null; takenBy: string | null } | null;
} {
	const lowStockMap = new Map<string, { name: string; daysLeft: number; isCritical: boolean }>();
	const medByName = new Map(meds.map((med) => [med.name || med.genericName || "", med] as const));

	for (const c of allCoverage) {
		const med = medByName.get(c.name);
		if (isTubePackageType(med?.packageType)) continue;

		if (c.medsLeft <= 0) {
			lowStockMap.set(c.name, { name: c.name, daysLeft: 0, isCritical: true });
			continue;
		}

		if (c.daysLeft === null) continue;

		const roundedDaysLeft = Math.round(c.daysLeft);
		const isLiquid = isLiquidContainerPackageType(med?.packageType);
		const liquidLowDays = Math.max(1, Math.floor(reminderDaysBefore));
		const liquidCriticalDays = Math.max(1, Math.ceil(liquidLowDays / 2));
		const isCritical = isLiquid ? c.daysLeft <= liquidCriticalDays : c.daysLeft <= reminderDaysBefore;
		const isLow = isLiquid ? c.daysLeft <= liquidLowDays : c.daysLeft < lowStockDays;
		if (!isCritical && !isLow) continue;

		const existing = lowStockMap.get(c.name);
		if (!existing || roundedDaysLeft < existing.daysLeft || (isCritical && !existing.isCritical)) {
			lowStockMap.set(c.name, { name: c.name, daysLeft: roundedDaysLeft, isCritical });
		}
	}

	const lowStockMeds = Array.from(lowStockMap.values()).sort((a, b) => a.daysLeft - b.daysLeft);
	const criticalCount = lowStockMeds.filter((m) => m.isCritical).length;
	const lowCount = lowStockMeds.filter((m) => !m.isCritical).length;

	let status: { text: string; className: string };
	if (criticalCount > 0) {
		status = {
			text: t("dashboard.reminders.criticalMeds", { count: criticalCount }),
			className: "danger",
		};
	} else if (lowCount > 0) {
		status = {
			text: t("dashboard.reminders.lowMeds", { count: lowCount }),
			className: "warning",
		};
	} else {
		status = {
			text: t("dashboard.reminders.allOk"),
			className: "success",
		};
	}

	let lastStockSent: { date: string; medNames: string | null } | null = null;
	if (lastStockReminderSent) {
		const sentDate = new Date(lastStockReminderSent);
		const formattedDate = sentDate.toLocaleDateString(locale, {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
		lastStockSent = {
			date: formattedDate,
			medNames: lastStockReminderMedNames,
		};
	}

	let lastIntakeSent: { date: string; medName: string | null; takenBy: string | null } | null = null;
	if (lastAutoEmailSent) {
		const sentDate = new Date(lastAutoEmailSent);
		const formattedDate = sentDate.toLocaleDateString(locale, {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
		lastIntakeSent = {
			date: formattedDate,
			medName: lastReminderMedName,
			takenBy: lastReminderTakenBy,
		};
	}

	return { status, lowStockMeds, lastStockSent, lastIntakeSent };
}
