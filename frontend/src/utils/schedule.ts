// =============================================================================
// Schedule Building and Coverage Calculations
// =============================================================================

import type { Coverage, Medication, ScheduleEvent, StockStatus, StockThresholds } from "../types";
import { getMedTotal } from "../types";

/**
 * Build schedule preview events for medications
 */
export function buildSchedulePreview(
	meds: Medication[],
	locale: string,
	includePast: boolean = false
): { events: ScheduleEvent[]; today: number; nextThree: number; totalBlisters: number } {
	const events: ScheduleEvent[] = [];
	if (!Array.isArray(meds)) return { events, today: 0, nextThree: 0, totalBlisters: 0 };

	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date();
	end.setDate(end.getDate() + 180); // 6 months horizon

	meds.forEach((med) => {
		med.blisters.forEach((blister, idx) => {
			const start = new Date(blister.start);
			if (Number.isNaN(start.getTime())) return;
			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + blister.every)) {
				const isPast = d < todayStart;
				if (isPast && !includePast) continue;
				const whenMs = d.getTime();
				// Use date-only timestamp for stable ID (immune to time changes)
				// This ensures changing intake times doesn't invalidate past dose tracking
				const dateOnlyMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
				events.push({
					id: `${med.id}-${idx}-${dateOnlyMs}`,
					medName: med.name,
					takenBy: med.takenBy || [],
					usage: blister.usage,
					when: whenMs,
					isPast,
					timeStr: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
					dateStr: d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" }),
				});
			}
		});
	});

	events.sort((a, b) => a.when - b.when);

	const todayCount = events.filter((e) => {
		const t = new Date(e.when);
		const n = new Date();
		return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
	}).length;

	return {
		events,
		today: todayCount,
		nextThree: events.length,
		totalBlisters: meds.reduce((acc, m) => acc + m.blisters.length, 0),
	};
}

/**
 * Calculate coverage information for medications
 */
export function calculateCoverage(
	meds: Medication[],
	events: Array<{ medName: string; when: number }>,
	locale: string,
	reminderDaysBefore: number,
	stockCalculationMode: "automatic" | "manual",
	takenDoses: Set<string>
): { low: Coverage[]; all: Coverage[] } {
	const MS_PER_DAY = 86_400_000;
	const now = Date.now();

	const coverage: Coverage[] = meds.map((m) => {
		const personCount = Math.max(1, m.takenBy?.length || 1);
		const dailyRate = m.blisters.reduce((sum, s) => sum + (s.every > 0 ? s.usage / s.every : 0), 0) * personCount;

		let consumed = 0;
		const stockCorrectionCutoff = m.lastStockCorrectionAt ? new Date(m.lastStockCorrectionAt).getTime() : 0;

		if (stockCalculationMode === "automatic") {
			m.blisters.forEach((s) => {
				const blisterStart = new Date(s.start).getTime();
				const effectiveStart = Math.max(blisterStart, stockCorrectionCutoff);
				if (Number.isNaN(effectiveStart) || effectiveStart > now) return;
				const period = Math.max(1, s.every) * MS_PER_DAY;
				const occurrences = Math.floor((now - effectiveStart) / period) + 1;
				consumed += occurrences * s.usage * personCount;
			});
		} else {
			takenDoses.forEach((doseId) => {
				const parts = doseId.split("-");
				if (parts.length >= 3) {
					const medId = parseInt(parts[0], 10);
					const blisterIdx = parseInt(parts[1], 10);
					const doseTimestamp = parseInt(parts[2], 10);
					if (medId === m.id && m.blisters[blisterIdx]) {
						const blisterStart = new Date(m.blisters[blisterIdx].start).getTime();
						if (!Number.isNaN(blisterStart) && doseTimestamp >= blisterStart && doseTimestamp > stockCorrectionCutoff) {
							consumed += m.blisters[blisterIdx].usage;
						}
					}
				}
			});
		}

		const totalPills = getMedTotal(m);
		const medsLeft = Math.max(0, totalPills - consumed);
		const rawDaysLeft = dailyRate > 0 ? medsLeft / dailyRate : null;
		const daysLeft = rawDaysLeft !== null ? Math.max(0, Math.floor(rawDaysLeft)) : null;
		const depletionMs = daysLeft !== null ? now + daysLeft * MS_PER_DAY : null;
		const depletionDate =
			depletionMs !== null
				? new Date(depletionMs).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" })
				: null;
		const nextEvent = events.find((e) => e.medName === m.name);

		return {
			name: m.name,
			medsLeft: Number(medsLeft.toFixed(1)),
			daysLeft,
			depletionDate,
			depletionTime: depletionMs,
			nextDose: nextEvent
				? new Date(nextEvent.when).toLocaleString(locale, {
						weekday: "short",
						day: "2-digit",
						month: "short",
						hour: "2-digit",
						minute: "2-digit",
					})
				: null,
		};
	});

	const low = coverage.filter((c) => c.medsLeft <= 0 || (c.daysLeft !== null && c.daysLeft <= reminderDaysBefore));
	return { low, all: coverage };
}

/**
 * Get stock status based on days left and thresholds
 */
export function getStockStatus(daysLeft: number | null, medsLeft: number, thresholds: StockThresholds): StockStatus {
	if (medsLeft <= 0 || daysLeft === 0) {
		return { level: "out-of-stock", className: "danger", label: "status.outOfStock" };
	}

	if (daysLeft === null) {
		return { level: "normal", className: "success", label: "status.noSchedule" };
	}

	if (daysLeft > thresholds.highStockDays) {
		return { level: "high", className: "high", label: "status.highStock" };
	}

	if (daysLeft >= thresholds.lowStockDays) {
		return { level: "normal", className: "success", label: "status.normal" };
	}

	return { level: "low", className: "warning", label: "status.lowStock" };
}

/**
 * Get next reminder date for a medication
 */
export function getNextReminderForMed(med: Coverage, reminderDaysBefore: number, locale: string): string {
	if (!med.depletionTime) return "—";

	const reminderTime = med.depletionTime - reminderDaysBefore * 86_400_000;
	const now = Date.now();

	if (reminderTime <= now) {
		return "Due now";
	}

	return new Date(reminderTime).toLocaleDateString(locale, {
		day: "2-digit",
		month: "short",
	});
}

/**
 * Get reminder status text for dashboard display
 */
export function getReminderStatusText(
	reminderDaysBefore: number,
	lowStockDays: number,
	_lowStock: Coverage[],
	allCoverage: Coverage[],
	lastSent: string | null,
	lastType: "stock" | "intake" | null,
	lastChannel: "email" | "push" | "both" | null,
	t: (key: string, options?: Record<string, unknown>) => string,
	locale: string
): { lines: Array<{ text: string; className?: string; strong?: boolean }> } {
	const emptyMeds = allCoverage.filter((c) => c.medsLeft <= 0);
	const medsNeedingReminder = allCoverage
		.filter((c) => c.medsLeft > 0 && c.daysLeft !== null && c.daysLeft <= reminderDaysBefore)
		.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
	const lowStockNotYetCritical = allCoverage.filter(
		(c) => c.medsLeft > 0 && c.daysLeft !== null && c.daysLeft > reminderDaysBefore && c.daysLeft < lowStockDays
	);

	const formatLastSent = (iso: string) => {
		const date = new Date(iso);
		return date.toLocaleDateString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
	};

	const getTypeLabel = () =>
		lastType === "intake" ? t("dashboard.reminders.typeIntake") : t("dashboard.reminders.typeStock");
	const getChannelLabel = () => {
		if (lastChannel === "both") return t("dashboard.reminders.channelBoth");
		if (lastChannel === "push") return t("dashboard.reminders.channelPush");
		return t("dashboard.reminders.channelEmail");
	};

	const formatLastInfo = (iso: string) => {
		const dateStr = formatLastSent(iso);
		if (lastType && lastChannel) {
			return `${dateStr} (${getTypeLabel()}, ${getChannelLabel()})`;
		}
		return dateStr;
	};

	const lines: Array<{ text: string; className?: string; strong?: boolean }> = [];

	if (emptyMeds.length > 0) {
		lines.push({
			text: `🚨 ${t("dashboard.reminders.emptyStock", { count: emptyMeds.length })}`,
			className: "danger-text",
			strong: true,
		});
		if (medsNeedingReminder.length > 0) {
			lines.push({
				text: `⚠ ${t("dashboard.reminders.needReorder", { count: medsNeedingReminder.length })}`,
				className: "danger-text",
			});
		}
		if (lowStockNotYetCritical.length > 0) {
			lines.push({
				text: t("dashboard.reminders.lowWarning", { count: lowStockNotYetCritical.length }),
				className: "warning-text",
			});
		}
		if (lastSent) {
			lines.push({ text: `${t("dashboard.reminders.lastReminder")}: ${formatLastInfo(lastSent)}` });
		}
		return { lines };
	}

	if (medsNeedingReminder.length > 0) {
		lines.push({
			text: `⚠ ${t("dashboard.reminders.needReorder", { count: medsNeedingReminder.length })}`,
			className: "danger-text",
			strong: true,
		});
		if (lowStockNotYetCritical.length > 0) {
			lines.push({
				text: t("dashboard.reminders.lowWarning", { count: lowStockNotYetCritical.length }),
				className: "warning-text",
			});
		}
		if (lastSent) {
			lines.push({ text: `${t("dashboard.reminders.lastReminder")}: ${formatLastInfo(lastSent)}` });
		}
		return { lines };
	}

	if (lowStockNotYetCritical.length > 0) {
		const nextMed = lowStockNotYetCritical.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
		const daysUntilReminder = Math.max(0, (nextMed.daysLeft ?? 0) - reminderDaysBefore);
		lines.push({
			text: t("dashboard.reminders.lowWarning", { count: lowStockNotYetCritical.length }),
			className: "warning-text",
		});
		lines.push({
			text: `${t("dashboard.reminders.nextIn")}: ${nextMed.name} ${t("dashboard.reminders.inDays", { days: daysUntilReminder })}`,
		});
		return { lines };
	}

	const allWithDepletion = allCoverage
		.filter((c) => c.depletionTime !== null && c.daysLeft !== null && c.medsLeft > 0)
		.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

	if (allWithDepletion.length > 0) {
		const nextMed = allWithDepletion[0];
		const daysUntilReminder = (nextMed.daysLeft ?? 0) - reminderDaysBefore;
		if (daysUntilReminder > 0) {
			lines.push({ text: `✓ ${t("dashboard.reminders.allOk")}`, className: "success-text" });
			lines.push({
				text: `${t("dashboard.reminders.nextIn")}: ${nextMed.name} ${t("dashboard.reminders.inDays", { days: daysUntilReminder })}`,
			});
			return { lines };
		}
	}

	lines.push({ text: `✓ ${t("dashboard.reminders.allStockOk")}`, className: "success-text" });
	if (lastSent) {
		lines.push({ text: `${t("dashboard.reminders.lastReminder")}: ${formatLastInfo(lastSent)}` });
	} else {
		lines.push({ text: t("dashboard.reminders.noRemindersNeeded") });
	}
	return { lines };
}
