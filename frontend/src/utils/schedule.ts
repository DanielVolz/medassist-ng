// =============================================================================
// Schedule Building and Coverage Calculations
// =============================================================================

import type { Blister, Coverage, Intake, Medication, ScheduleEvent, StockStatus, StockThresholds } from "../types";
import { getMedTotal } from "../types";

/**
 * Get intakes for a medication, preferring new intakes format over legacy blisters
 */
function getIntakesForMed(med: Medication): Intake[] {
	// Use new intakes array if available and non-empty
	if (med.intakes && med.intakes.length > 0) {
		return med.intakes;
	}
	// Fallback to legacy blisters (convert to Intake format)
	return med.blisters.map((b) => ({
		usage: b.usage,
		every: b.every,
		start: b.start,
		takenBy: null, // Legacy format has no per-intake takenBy
		intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
	}));
}

/**
 * Get blisters for a medication (for backward compatibility with coverage calculations)
 */
function getBlistersForMed(med: Medication): Blister[] {
	if (med.intakes && med.intakes.length > 0) {
		return med.intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start }));
	}
	return med.blisters;
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
		const intakes = getIntakesForMed(med);
		intakes.forEach((intake, idx) => {
			const start = new Date(intake.start);
			if (Number.isNaN(start.getTime())) return;
			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + intake.every)) {
				const isPast = d < todayStart;
				if (isPast && !includePast) continue;
				const whenMs = d.getTime();
				// Use date-only timestamp for stable ID (immune to time changes)
				// This ensures changing intake times doesn't invalidate past dose tracking
				const dateOnlyMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
				events.push({
					id: `${med.id}-${idx}-${dateOnlyMs}`,
					medName: med.name,
					takenBy: intake.takenBy, // Per-intake takenBy (string | null)
					usage: intake.usage,
					when: whenMs,
					isPast,
					timeStr: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
					dateStr: d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" }),
					intakeRemindersEnabled: intake.intakeRemindersEnabled,
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
		totalBlisters: meds.reduce((acc, m) => acc + getIntakesForMed(m).length, 0),
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

	const coverage: Coverage[] = meds.map((m) => {
		const intakes = getIntakesForMed(m);
		const blisters = getBlistersForMed(m);
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
		blisters.forEach((s, idx) => {
			const baseRate = s.every > 0 ? s.usage / s.every : 0;
			const intake = intakes[idx];
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
			blisters.forEach((s, blisterIdx) => {
				const blisterStart = new Date(s.start).getTime();
				const period = Math.max(1, s.every) * MS_PER_DAY;

				// After a stock correction, start counting consumption from the NEXT
				// scheduled dose on this blister's grid, because the user's pill count
				// already reflects all consumption up to the correction time.
				// We align to the schedule grid so that e.g. correction at 15:40 with
				// a daily 15:42 dose counts today's 15:42 dose (2 min later), not
				// tomorrow's dose (24h later as the old code did).
				let effectiveStart: number;
				if (stockCorrectionCutoff > 0 && stockCorrectionCutoff >= blisterStart) {
					const elapsedSinceStart = stockCorrectionCutoff - blisterStart;
					const periodsElapsed = Math.floor(elapsedSinceStart / period);
					effectiveStart = blisterStart + (periodsElapsed + 1) * period;
				} else {
					effectiveStart = blisterStart;
				}
				if (Number.isNaN(effectiveStart)) return;

				const intake = intakes[blisterIdx];
				const intakePerson = intake?.takenBy;

				// For per-intake takenBy, only count for that person
				// For legacy (no takenBy), count for all people in medication takenBy
				const fallbackPeople = m.takenBy?.length > 0 ? m.takenBy : [null];
				const peopleForThisIntake = intakePerson ? [intakePerson] : fallbackPeople;

				// Time-based: count doses where the scheduled time has already passed
				let timeBasedConsumed = 0;
				let lastAutoConsumedDateMs = 0;

				if (effectiveStart <= now) {
					const occurrences = Math.floor((now - effectiveStart) / period) + 1;
					timeBasedConsumed = occurrences * s.usage * peopleForThisIntake.length;

					// Date-only timestamp of the last auto-consumed dose
					const lastDoseTime = new Date(effectiveStart + (occurrences - 1) * period);
					lastAutoConsumedDateMs = new Date(
						lastDoseTime.getFullYear(),
						lastDoseTime.getMonth(),
						lastDoseTime.getDate()
					).getTime();
				}

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
							earlyTakenConsumed += s.usage;
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
					if (medId === m.id && blisters[blisterIdx]) {
						// Convert blister start to date-only for comparison (dose timestamps are date-only)
						const blisterStartDate = new Date(blisters[blisterIdx].start);
						const blisterStartDateOnly = new Date(
							blisterStartDate.getFullYear(),
							blisterStartDate.getMonth(),
							blisterStartDate.getDate()
						).getTime();

						// Use actual takenAt timestamp for stock correction comparison.
						// A dose counts only if it was MARKED after the stock correction,
						// regardless of what day it was scheduled for.
						const takenAt = takenDoseTimestamps?.get(doseId) ?? 0;
						const afterCorrectionOrNoCorrectionMs = stockCorrectionCutoff === 0 || takenAt > stockCorrectionCutoff;

						if (
							!Number.isNaN(blisterStartDateOnly) &&
							doseTimestamp >= blisterStartDateOnly &&
							afterCorrectionOrNoCorrectionMs
						) {
							consumed += blisters[blisterIdx].usage;
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
	// Out of stock or completely depleted = danger (red)
	if (medsLeft <= 0 || daysLeft === 0) {
		return { level: "out-of-stock", className: "danger", label: "status.outOfStock" };
	}

	// No schedule, but has stock = normal
	if (daysLeft === null) {
		return { level: "normal", className: "success", label: "status.noSchedule" };
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
	medications: ReadonlyArray<{ name: string; dismissedUntil?: string | null }>,
	takenDoses: Set<string>,
	dismissedDoses: Set<string>
): string[] {
	const totalPastDoses = pastDays.flatMap((d) =>
		d.meds.flatMap((m) => {
			const med = medications.find((med) => med.name === m.medName);
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
