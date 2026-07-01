// =============================================================================
// Schedule Building and Coverage Calculations
// =============================================================================

import { parseLocalDateTime } from "@medassist/shared";
import type { Coverage, Intake, Medication, PackageType, ScheduleEvent, StockStatus, StockThresholds } from "../types";
import { getMedDisplayName, getMedTotal, isLiquidContainerPackageType, isTubePackageType } from "../types";
import { formatDisplayDate, formatDisplayDateTime } from "./formatters";
import { getIntakeDailyRate, getMedicationIntakes, iterateIntakeOccurrences } from "./intake-schedule";
import { convertLiquidUsageToMl } from "./intake-units";

export { parseLocalDateTime };

function normalizeIntakeUsageForStock(intake: Intake, med: Medication): number {
	const usage = Number(intake.usage);
	if (!Number.isFinite(usage) || usage <= 0) return 0;
	if (isTubePackageType(med.packageType)) return 0;

	const isLiquidStock = isLiquidContainerPackageType(med.packageType) || med.medicationForm === "liquid";
	if (!isLiquidStock) return usage;

	return convertLiquidUsageToMl(usage, intake.intakeUnit);
}

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
		const intakes = getMedicationIntakes(med);
		intakes.forEach((intake, idx) => {
			const start = parseLocalDateTime(intake.start);
			if (Number.isNaN(start.getTime())) return;
			iterateIntakeOccurrences(intake, start, end, (d) => {
				const isPast = d < todayStart;
				if (isPast && !includePast) return;
				const whenMs = d.getTime();
				// Use date-only timestamp for stable ID (immune to time changes)
				// This ensures changing intake times doesn't invalidate past dose tracking
				const dateOnlyMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
				events.push({
					id: `${med.id}-${idx}-${dateOnlyMs}`,
					medName: getMedDisplayName(med),
					takenBy: intake.takenBy, // Per-intake takenBy (string | null)
					usage: intake.usage,
					intakeUnit: intake.intakeUnit ?? null,
					when: whenMs,
					isPast,
					timeStr: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
					dateStr: formatDisplayDate(d, locale, { weekday: true }),
					intakeRemindersEnabled: intake.intakeRemindersEnabled,
				});
			});
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
		totalBlisters: meds.reduce((acc, med) => acc + getMedicationIntakes(med).length, 0),
	};
}

/**
 * Calculate coverage information for medications
 */
export function calculateCoverage(
	meds: Medication[],
	events: Array<{ medName: string; when: number; id: string }>,
	locale: string,
	reminderDaysBefore: number,
	stockCalculationMode: "automatic" | "manual",
	takenDoses: Set<string>,
	takenDoseTimestamps?: Map<string, number>
): { low: Coverage[]; all: Coverage[] } {
	const MS_PER_DAY = 86_400_000;
	const now = Date.now();
	const nowDate = new Date(now);

	const coverage: Coverage[] = meds.map((m) => {
		const intakes = getMedicationIntakes(m);
		// Count unique people from all intakes (for per-intake takenBy)
		const uniquePeople = new Set<string>();
		intakes.forEach((intake) => {
			if (intake.takenBy) uniquePeople.add(intake.takenBy);
		});
		// Also add medication-level takenBy for backward compatibility
		m.takenBy?.forEach((person) => uniquePeople.add(person));
		const personCount = Math.max(1, uniquePeople.size || m.takenBy?.length || 1);

		// Calculate daily consumption rate per intake, accounting for per-intake takenBy.
		// When an intake has a per-intake takenBy (new format), it represents exactly
		// one person's dose — do NOT multiply by personCount again.
		// For legacy intakes (no takenBy), the intake applies to ALL people.
		let dailyRate = 0;
		intakes.forEach((intake) => {
			const usageForStock = normalizeIntakeUsageForStock(intake, m);
			const baseRate = usageForStock * getIntakeDailyRate(intake);
			if (intake?.takenBy) {
				// Per-intake takenBy: this intake is for exactly 1 person
				dailyRate += baseRate;
			} else {
				// Legacy: this intake applies to all people
				dailyRate += baseRate * personCount;
			}
		});

		let consumed = 0;
		const stockCorrectionCutoff = m.lastStockCorrectionAt ? new Date(m.lastStockCorrectionAt).getTime() : 0;

		if (stockCalculationMode === "automatic") {
			// In automatic mode, stock is reduced automatically based on the schedule.
			// Every scheduled dose counts as consumed once its time has passed.
			// Additionally, if a user marks a future dose as taken BEFORE the scheduled
			// time (early intake), that dose is also counted as consumed immediately.
			// This prevents double-counting: once the scheduled time arrives, the dose
			// was already counted via the early-taken path, not again via time.
			intakes.forEach((intake, blisterIdx) => {
				const intakeStart = parseLocalDateTime(intake.start);
				if (Number.isNaN(intakeStart.getTime())) return;
				const usageForStock = normalizeIntakeUsageForStock(intake, m);

				const intakePerson = intake?.takenBy;

				// For per-intake takenBy, only count for that person
				// For legacy (no takenBy), count for all people in medication takenBy
				const fallbackPeople = m.takenBy?.length > 0 ? m.takenBy : [null];
				const peopleForThisIntake = intakePerson ? [intakePerson] : fallbackPeople;

				// Time-based: count doses where the scheduled time has already passed
				let timeBasedConsumed = 0;
				let lastAutoConsumedDateMs = 0;

				iterateIntakeOccurrences(intake, intakeStart, nowDate, (occurrence) => {
					if (occurrence.getTime() <= stockCorrectionCutoff) return;
					timeBasedConsumed += usageForStock * peopleForThisIntake.length;
					lastAutoConsumedDateMs = new Date(
						occurrence.getFullYear(),
						occurrence.getMonth(),
						occurrence.getDate()
					).getTime();
				});

				// Early intakes: count future doses already marked as taken.
				// The cutoff is the later of: last auto-consumed date or stock correction date.
				// This prevents double-counting (time-based + early-taken) and respects corrections.
				const stockCorrectionDateOnly =
					stockCorrectionCutoff > 0
						? new Date(
								new Date(stockCorrectionCutoff).getFullYear(),
								new Date(stockCorrectionCutoff).getMonth(),
								new Date(stockCorrectionCutoff).getDate()
							).getTime()
						: 0;
				const earlyCutoff = Math.max(lastAutoConsumedDateMs, stockCorrectionDateOnly);

				let earlyTakenConsumed = 0;
				for (const doseId of takenDoses) {
					const parts = doseId.split("-");
					if (parts.length >= 3) {
						const medId = parseInt(parts[0], 10);
						const bIdx = parseInt(parts[1], 10);
						const timestamp = parseInt(parts[2], 10);
						if (medId === m.id && bIdx === blisterIdx && timestamp > earlyCutoff) {
							earlyTakenConsumed += usageForStock;
						}
					}
				}

				consumed += timeBasedConsumed + earlyTakenConsumed;
			});
		} else {
			// In manual mode, only count doses that are explicitly marked as taken.
			// For stock correction filtering, we use the actual time the dose was marked
			// as taken (takenAt), not the scheduled date. This correctly handles same-day
			// scenarios: if a user corrects stock at 3pm, then takes a dose at 4pm,
			// the dose counts because takenAt (4pm) > correctionTime (3pm).
			takenDoses.forEach((doseId) => {
				const parts = doseId.split("-");
				if (parts.length >= 3) {
					const medId = parseInt(parts[0], 10);
					const blisterIdx = parseInt(parts[1], 10);
					const doseTimestamp = parseInt(parts[2], 10);
					const intake = intakes[blisterIdx];
					if (medId === m.id && intake) {
						const usageForStock = normalizeIntakeUsageForStock(intake, m);
						// Convert blister start to date-only for comparison (dose timestamps are date-only)
						const intakeStartDate = new Date(intake.start);
						const intakeStartDateOnly = new Date(
							intakeStartDate.getFullYear(),
							intakeStartDate.getMonth(),
							intakeStartDate.getDate()
						).getTime();

						// Use actual takenAt timestamp for stock correction comparison.
						// A dose counts only if it was MARKED after the stock correction,
						// regardless of what day it was scheduled for.
						const takenAt = takenDoseTimestamps?.get(doseId) ?? 0;
						const afterCorrectionOrNoCorrectionMs = stockCorrectionCutoff === 0 || takenAt > stockCorrectionCutoff;

						if (
							!Number.isNaN(intakeStartDateOnly) &&
							doseTimestamp >= intakeStartDateOnly &&
							afterCorrectionOrNoCorrectionMs
						) {
							consumed += usageForStock;
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
		const depletionDate = depletionMs !== null ? formatDisplayDate(depletionMs, locale, { weekday: true }) : null;
		const displayName = getMedDisplayName(m);
		const nextEvent = events.find((e) => e.medName === displayName);

		return {
			name: displayName,
			medsLeft: Number(medsLeft.toFixed(1)),
			daysLeft,
			depletionDate,
			depletionTime: depletionMs,
			nextDose: nextEvent ? formatDisplayDateTime(nextEvent.when, locale, { weekday: true }) : null,
		};
	});

	const low = coverage.filter((c) => c.medsLeft <= 0 || (c.daysLeft !== null && c.daysLeft <= reminderDaysBefore));
	return { low, all: coverage };
}

function getLiquidDerivedThresholds(baselineDays: number): { lowDays: number; criticalDays: number } {
	const lowDays = Math.max(1, Math.floor(baselineDays));
	const criticalDays = Math.max(1, Math.ceil(lowDays / 2));
	return { lowDays, criticalDays };
}

/**
 * Get stock status based on days left and thresholds
 */
export function getStockStatus(
	daysLeft: number | null,
	medsLeft: number,
	thresholds: StockThresholds,
	packageType?: PackageType
): StockStatus {
	// Only a real zero-or-below stock count is out of stock.
	if (medsLeft <= 0) {
		return { level: "out-of-stock", className: "danger", label: "status.outOfStock" };
	}

	// Tube has no stock reminder semantics.
	if (isTubePackageType(packageType)) {
		return { level: "normal", className: "success", label: "status.noSchedule" };
	}

	// No schedule, but has stock = normal
	if (daysLeft === null) {
		return { level: "normal", className: "success", label: "status.noSchedule" };
	}

	if (isLiquidContainerPackageType(packageType)) {
		const liquidThresholds = getLiquidDerivedThresholds(thresholds.criticalStockDays);
		if (daysLeft <= liquidThresholds.criticalDays) {
			return { level: "critical", className: "danger", label: "status.criticalStock" };
		}
		if (daysLeft <= liquidThresholds.lowDays) {
			return { level: "low", className: "warning", label: "status.lowStock" };
		}
		return { level: "normal", className: "success", label: "status.normal" };
	}

	// High stock
	if (daysLeft > thresholds.highStockDays) {
		return { level: "high", className: "high", label: "status.highStock" };
	}

	// Normal stock
	if (daysLeft >= thresholds.lowStockDays) {
		return { level: "normal", className: "success", label: "status.normal" };
	}

	// Critical: at or below critical threshold = danger (red)
	if (daysLeft <= thresholds.criticalStockDays) {
		return { level: "critical", className: "danger", label: "status.criticalStock" };
	}

	// Low stock: below lowStockDays but above critical = warning (yellow)
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

	return formatDisplayDate(reminderTime, locale, { weekday: true });
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
		return formatDisplayDateTime(iso, locale);
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
				text: `⚠ ${t("dashboard.reminders.needRefill", { count: medsNeedingReminder.length })}`,
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
			text: `⚠ ${t("dashboard.reminders.needRefill", { count: medsNeedingReminder.length })}`,
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

// =============================================================================
// Dose Dismissal & Missed Dose Computation
// =============================================================================

/**
 * Check if a dose is dismissed based on its ID and a dismissedUntil date string.
 * Extracts the date-only timestamp from the dose ID and compares it with the dismissedUntil date.
 *
 * @param doseId - Dose ID in format "medId-intakeIdx-dateOnlyMs" or "medId-intakeIdx-dateOnlyMs-person"
 * @param dismissedUntilDate - YYYY-MM-DD formatted date string, or undefined if not dismissed
 * @returns true if the dose date is on or before the dismissedUntil date
 */
export function isDoseDismissed(doseId: string, dismissedUntilDate: string | undefined): boolean {
	if (!dismissedUntilDate) return false;
	const parts = doseId.split("-");
	if (parts.length < 3) return false;
	const timestamp = parseInt(parts[2], 10);
	if (Number.isNaN(timestamp)) return false;
	const doseDate = new Date(timestamp);
	const doseDateStr = `${doseDate.getFullYear()}-${String(doseDate.getMonth() + 1).padStart(2, "0")}-${String(doseDate.getDate()).padStart(2, "0")}`;
	return doseDateStr <= dismissedUntilDate;
}

/**
 * Compute the list of missed past dose IDs.
 * A dose is "missed" if it is in the past, not taken, not individually dismissed,
 * and not covered by the medication's dismissedUntil date.
 *
 * @param pastDays - Grouped schedule days that are in the past
 * @param medications - Full medication list (used to look up dismissedUntil)
 * @param takenDoses - Set of dose IDs marked as taken
 * @param dismissedDoses - Set of dose IDs individually dismissed
 * @returns Array of dose IDs that are missed
 */
/**
 * Compute the full set of dose IDs for a list of doses, correctly handling
 * per-intake takenBy arrays. Empty arrays produce base IDs (no suffix),
 * non-empty arrays produce one ID per person with a `-person` suffix.
 */
export function expandDoseIds(doses: ReadonlyArray<{ id: string; takenBy: string[] }>): string[] {
	return doses.flatMap((d) => {
		const takenByArray = Array.isArray(d.takenBy) ? d.takenBy : [];
		return takenByArray.length > 0 ? takenByArray.map((p) => `${d.id}-${p}`) : [d.id];
	});
}

export function computeMissedPastDoseIds(
	pastDays: ReadonlyArray<{
		meds: ReadonlyArray<{
			medName: string;
			doses: ReadonlyArray<{ id: string; takenBy: string[] }>;
		}>;
	}>,
	medications: ReadonlyArray<{ name: string; genericName?: string | null; dismissedUntil?: string | null }>,
	takenDoses: Set<string>,
	dismissedDoses: Set<string>
): string[] {
	const totalPastDoses = pastDays.flatMap((d) =>
		d.meds.flatMap((m) => {
			const med = medications.find((medication) => getMedDisplayName(medication as Medication) === m.medName);
			const dismissedUntilDate = med?.dismissedUntil ?? undefined;

			return m.doses.flatMap((dose) => {
				if (isDoseDismissed(dose.id, dismissedUntilDate)) {
					return [];
				}

				const takenByArray = Array.isArray(dose.takenBy) ? dose.takenBy : [];
				return takenByArray.length > 0 ? takenByArray.map((p: string) => `${dose.id}-${p}`) : [dose.id];
			});
		})
	);
	return totalPastDoses.filter((id) => !takenDoses.has(id) && !dismissedDoses.has(id));
}

export function buildClearMissedPayload(
	pastDays: ReadonlyArray<{
		date: Date;
		meds: ReadonlyArray<{
			medName: string;
			doses: ReadonlyArray<{ id: string; takenBy: string[] }>;
		}>;
	}>,
	medications: ReadonlyArray<{ id: number; name: string; genericName?: string | null; dismissedUntil?: string | null }>,
	takenDoses: Set<string>,
	dismissedDoses: Set<string>
): { medicationIds: number[]; until: string | null } {
	const medicationIds = new Set<number>();
	let latestMissedDate: string | null = null;

	for (const day of pastDays) {
		for (const item of day.meds) {
			const med = medications.find((candidate) => getMedDisplayName(candidate as Medication) === item.medName);
			if (!med) continue;

			const dismissedUntilDate = med.dismissedUntil ?? undefined;
			const hasMissedDose = item.doses.some((dose) => {
				if (isDoseDismissed(dose.id, dismissedUntilDate)) {
					return false;
				}

				return expandDoseIds([dose]).some((doseId) => !takenDoses.has(doseId) && !dismissedDoses.has(doseId));
			});

			if (!hasMissedDose) continue;

			medicationIds.add(med.id);
			const dayDate = day.date.toISOString().slice(0, 10);
			if (!latestMissedDate || dayDate > latestMissedDate) {
				latestMissedDate = dayDate;
			}
		}
	}

	return {
		medicationIds: [...medicationIds],
		until: latestMissedDate,
	};
}
