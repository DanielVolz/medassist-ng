// =============================================================================
// SharedSchedule Component - Public view for shared schedules
// =============================================================================
/* biome-ignore-all lint/style/noNestedTernary: rendering branches are intentionally explicit in schedule UI */
/* biome-ignore-all lint/correctness/useExhaustiveDependencies: modal and helper callbacks are stable at runtime */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useEscapeKey } from "../hooks";
import type { ExpiredLinkData, SharedScheduleData } from "../types";
import { getMedDisplayName, getMedTotal } from "../types";
import { getSystemLocale } from "../utils/formatters";
import { isDoseDismissed } from "../utils/schedule";
import { loadCollapsedDaysFromStorage } from "../utils/storage";
import { MedicationAvatar } from "./MedicationAvatar";

// =============================================================================
// Stock status helper — identical to DashboardPage's getStockStatus
// =============================================================================
function getStockStatus(
	daysLeft: number | null,
	medsLeft: number,
	thresholds: { lowStockDays: number; normalStockDays: number; highStockDays: number; criticalStockDays: number }
) {
	if (medsLeft <= 0 || daysLeft === 0) return { className: "danger", label: "status.outOfStock" };
	if (daysLeft === null) return { className: "success", label: "status.noSchedule" };
	if (daysLeft <= thresholds.criticalStockDays) return { className: "danger", label: "status.criticalStock" };
	if (daysLeft < thresholds.lowStockDays) return { className: "warning", label: "status.lowStock" };
	if (daysLeft >= thresholds.highStockDays) return { className: "high", label: "status.highStock" };
	return { className: "success", label: "status.normal" };
}

export function SharedSchedule() {
	const { token } = useParams<{ token: string }>();
	const { t, i18n } = useTranslation();
	const [data, setData] = useState<SharedScheduleData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expiredData, setExpiredData] = useState<ExpiredLinkData | null>(null);
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [dismissedDoses, setDismissedDoses] = useState<Set<string>>(new Set());
	const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
	const [showPastDays, setShowPastDays] = useState(false);
	const [showFutureDays, setShowFutureDays] = useState(false);

	// Theme preference: light, dark, or system
	type ThemePreference = "light" | "dark" | "system";
	const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
		if (typeof window !== "undefined") {
			const stored = localStorage.getItem("theme") as ThemePreference | null;
			if (stored === "light" || stored === "dark" || stored === "system") return stored;
		}
		return "dark";
	});

	function getSystemTheme(): "light" | "dark" {
		if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
			return "light";
		}
		return "dark";
	}

	const resolvedTheme = themePreference === "system" ? getSystemTheme() : themePreference;

	// Apply resolved theme to document
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolvedTheme);
		localStorage.setItem("theme", themePreference);
	}, [themePreference, resolvedTheme]);

	// Listen for system theme changes when preference is "system"
	useEffect(() => {
		if (themePreference !== "system") return;
		const mq = window.matchMedia?.("(prefers-color-scheme: light)");
		if (!mq) return;
		const handler = () => {
			const resolved = mq.matches ? "light" : "dark";
			document.documentElement.setAttribute("data-theme", resolved);
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [themePreference]);

	// Theme dropdown state
	const [themeMenuOpen, setThemeMenuOpen] = useState(false);
	const themeMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!themeMenuOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
				setThemeMenuOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [themeMenuOpen]);

	// Collapsed days state for SharedSchedule (token-specific localStorage)
	const [manuallyCollapsedDays, setManuallyCollapsedDays] = useState<Set<string>>(new Set());
	const [manuallyExpandedDays, setManuallyExpandedDays] = useState<Set<string>>(new Set());

	// Load collapsed/expanded state from localStorage
	useEffect(() => {
		if (token && typeof window !== "undefined") {
			const { collapsed, expanded } = loadCollapsedDaysFromStorage(
				`share_${token}_collapsedDays`,
				`share_${token}_expandedDays`
			);
			setManuallyCollapsedDays(collapsed);
			setManuallyExpandedDays(expanded);
		}
	}, [token]);

	// Toggle day collapse/expand for SharedSchedule
	function toggleDayCollapse(dateStr: string, isAutoCollapsed: boolean) {
		if (isAutoCollapsed) {
			setManuallyExpandedDays((prev) => {
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (token) localStorage.setItem(`share_${token}_expandedDays`, JSON.stringify([...next]));
				return next;
			});
		} else {
			setManuallyCollapsedDays((prev) => {
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (token) localStorage.setItem(`share_${token}_collapsedDays`, JSON.stringify([...next]));
				return next;
			});
		}
	}

	// Helper functions for lightbox with history support (mobile back swipe)
	function openLightbox(url: string, name: string) {
		setLightboxImage({ url, name });
		window.history.pushState({ modal: "lightbox" }, "");
	}
	function closeLightbox() {
		if (lightboxImage) {
			window.history.back();
		}
	}

	// Close lightbox on Escape key
	useEscapeKey(!!lightboxImage, closeLightbox);

	// Handle browser back button to close lightbox
	useEffect(() => {
		function handlePopState() {
			if (lightboxImage) {
				setLightboxImage(null);
			}
		}
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [lightboxImage]);

	// Load taken doses from server with polling for real-time sync
	// Separates taken and dismissed doses (like main app's useDoses hook)
	useEffect(() => {
		if (token) {
			async function loadTakenDoses() {
				try {
					const res = await fetch(`/api/share/${token}/doses`);
					if (res.ok) {
						const data = await res.json();
						const taken = new Set<string>();
						const dismissed = new Set<string>();
						for (const d of data.doses as Array<{ doseId: string; dismissed?: boolean }>) {
							if (d.dismissed) {
								dismissed.add(d.doseId);
							} else {
								taken.add(d.doseId);
							}
						}
						setTakenDoses(taken);
						setDismissedDoses(dismissed);
					} else {
						setTakenDoses(new Set());
						setDismissedDoses(new Set());
					}
				} catch {
					setTakenDoses(new Set());
					setDismissedDoses(new Set());
				}
			}
			loadTakenDoses();

			// Poll for updates every 5 seconds (real-time sync with dashboard)
			const interval = setInterval(loadTakenDoses, 5000);
			return () => clearInterval(interval);
		}
	}, [token]);

	// Get dose ID - for per-intake takenBy, the ID already has the person suffix
	// This helper is kept for compatibility but since dose.id already includes the suffix, it just returns the id
	function _getDoseId(doseId: string, _person: string | null): string {
		// The dose.id already includes the person suffix if there's a per-intake takenBy
		return doseId;
	}

	async function markDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});

		// Send to server
		try {
			await fetch(`/api/share/${token}/doses`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doseId }),
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});
		}
	}

	async function undoDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		// Send to server
		try {
			await fetch(`/api/share/${token}/doses/${encodeURIComponent(doseId)}`, {
				method: "DELETE",
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
		}
	}

	useEffect(() => {
		async function fetchData() {
			if (!token) {
				setError("Invalid link");
				setLoading(false);
				return;
			}

			try {
				const res = await fetch(`/api/share/${token}`);
				if (res.ok) {
					const json = await res.json();
					setData(json);
				} else if (res.status === 410) {
					// Link expired - get owner info
					const json = await res.json();
					setExpiredData({
						ownerUsername: json.ownerUsername,
						takenBy: json.takenBy,
						expiredAt: json.expiredAt,
					});
				} else if (res.status === 404) {
					setError(t("share.notFound"));
				} else {
					setError(t("share.error"));
				}
			} catch {
				setError(t("share.error"));
			} finally {
				setLoading(false);
			}
		}
		fetchData();
	}, [token, t]);

	// Build schedule from medications - matches buildSchedulePreview logic exactly
	const schedule = useMemo(() => {
		if (!data) return [];

		// Use same logic as buildSchedulePreview in main app
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today

		// Use 180 days horizon like main app (scheduleDays only limits futureDays display)
		const end = new Date();
		end.setDate(end.getDate() + 180);

		const doses: {
			id: string;
			when: number;
			medName: string;
			usage: number;
			timeStr: string;
			isPast: boolean;
			takenBy: string | null; // Per-intake takenBy (single person or null)
			dateStr: string;
		}[] = [];

		for (const med of data.medications) {
			// Use intakes (with per-intake takenBy) if available, fallback to blisters (legacy)
			const intakes =
				med.intakes ||
				med.blisters.map((b) => ({ ...b, takenBy: null as string | null, intakeRemindersEnabled: false }));

			intakes.forEach((intake, intakeIdx) => {
				// Filter: only include intakes for this person (null = everyone, or matches share's takenBy)
				if (intake.takenBy !== null && intake.takenBy !== data.takenBy) return;

				const startDate = new Date(intake.start);
				if (Number.isNaN(startDate.getTime())) return;

				// Use the same iteration method as buildSchedulePreview (setDate instead of adding ms)
				// This ensures identical timestamps even across DST changes
				for (let d = new Date(startDate); d <= end; d.setDate(d.getDate() + intake.every)) {
					const t = d.getTime();
					const isPast = d < todayStart;
					// Use date-only timestamp for stable ID (immune to time changes)
					// This ensures changing intake times doesn't invalidate past dose tracking
					// Must match buildSchedulePreview in schedule.ts exactly
					const dateOnlyMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					// Dose ID includes person suffix if there's a per-intake takenBy
					const baseDoseId = `${med.id}-${intakeIdx}-${dateOnlyMs}`;
					const doseId = intake.takenBy ? `${baseDoseId}-${intake.takenBy}` : baseDoseId;
					doses.push({
						id: doseId,
						when: t,
						medName: getMedDisplayName(med),
						usage: intake.usage,
						isPast,
						takenBy: intake.takenBy, // Per-intake takenBy (string | null)
						timeStr: d.toLocaleTimeString(getSystemLocale(i18n.language), { hour: "2-digit", minute: "2-digit" }),
						dateStr: d.toLocaleDateString(getSystemLocale(i18n.language), {
							weekday: "short",
							day: "2-digit",
							month: "short",
						}),
					});
				}
			});
		}

		doses.sort((a, b) => a.when - b.when);

		// Group by date - matches groupedSchedule logic in main app
		type DoseInfo = (typeof doses)[number];
		const days = new Map<
			string,
			{
				dateStr: string;
				date: Date;
				isPast: boolean;
				meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }>;
			}
		>();

		for (const dose of doses.slice(0, 2000)) {
			const day = days.get(dose.dateStr) ?? {
				dateStr: dose.dateStr,
				date: new Date(dose.when),
				isPast: dose.isPast,
				meds: new Map(),
			};
			const medEntry = day.meds.get(dose.medName) ?? {
				medName: dose.medName,
				total: 0,
				doses: [],
				lastWhen: dose.when,
			};
			medEntry.total += dose.usage;
			medEntry.doses.push(dose);
			medEntry.lastWhen = Math.max(medEntry.lastWhen, dose.when);
			day.meds.set(dose.medName, medEntry);
			days.set(dose.dateStr, day);
		}

		return Array.from(days.values()).map((d) => ({
			dateStr: d.dateStr,
			date: d.date,
			isPast: d.isPast,
			meds: Array.from(d.meds.values()),
		}));
	}, [data, i18n.language]);

	// Split into past, today, and future - matches main app logic
	const pastDays = useMemo(() => schedule.filter((d) => d.isPast), [schedule]);

	// Separate today from future days
	const { todayDay, futureDays } = useMemo(() => {
		const today = new Date();
		const todayStr = today.toLocaleDateString(getSystemLocale(i18n.language), {
			weekday: "short",
			day: "2-digit",
			month: "short",
		});
		const nonPastDays = schedule.filter((d) => !d.isPast).slice(0, data?.scheduleDays ?? 30);

		const todayEntry = nonPastDays.find((d) => d.dateStr === todayStr);
		const future = nonPastDays.filter((d) => d.dateStr !== todayStr);

		return { todayDay: todayEntry || null, futureDays: future };
	}, [schedule, data?.scheduleDays, i18n.language]);

	// Calculate coverage for stock status colors — matches main app's calculateCoverage logic
	// Uses time-based automatic consumption (same as DashboardPage) for accurate stock levels
	const { coverageByMed, depletionByMed } = useMemo(() => {
		if (!data) return { coverageByMed: {}, depletionByMed: {} };
		const MS_PER_DAY = 86_400_000;
		const now = Date.now();
		const calcMode = data.stockCalculationMode ?? "automatic";
		const toLiquidMl = (usage: number, intakeUnit: "ml" | "tsp" | "tbsp" | null | undefined) => {
			if (intakeUnit === "tsp") return usage * 5;
			if (intakeUnit === "tbsp") return usage * 15;
			return usage;
		};
		const coverage: Record<string, { daysLeft: number | null; medsLeft: number; dailyUsage: number }> = {};
		const depletion: Record<string, number | null> = {};

		for (const med of data.medications) {
			const intakes =
				med.intakes || med.blisters.map((b) => ({ ...b, takenBy: null as string | null, intakeUnit: null }));
			const isTopical = med.medicationForm === "topical" || med.packageType === "tube";
			const blisters = intakes.map((intake) => ({
				usage:
					med.medicationForm === "liquid" || med.packageType === "liquid_container"
						? toLiquidMl(intake.usage, intake.intakeUnit)
						: intake.usage,
				every: intake.every,
				start: intake.start,
			}));

			// Count unique people from all intakes (for per-intake takenBy)
			const uniquePeople = new Set<string>();
			intakes.forEach((intake) => {
				if (intake.takenBy) uniquePeople.add(intake.takenBy);
			});
			med.takenBy?.forEach((person) => uniquePeople.add(person));
			const personCount = Math.max(1, uniquePeople.size || med.takenBy?.length || 1);

			// Calculate daily consumption rate accounting for per-intake takenBy
			let dailyRate = 0;
			blisters.forEach((s, idx) => {
				const baseRate = s.every > 0 ? s.usage / s.every : 0;
				const intake = intakes[idx];
				if (intake?.takenBy) {
					dailyRate += baseRate; // Per-intake takenBy: 1 person
				} else {
					dailyRate += baseRate * personCount; // Legacy: all people
				}
			});
			if (isTopical) {
				dailyRate = 0;
			}

			let consumed = 0;
			const stockCorrectionCutoff = med.lastStockCorrectionAt ? med.lastStockCorrectionAt : 0;

			if (isTopical) {
				consumed = 0;
			} else if (calcMode === "automatic") {
				// Time-based: every scheduled dose counts as consumed once its time has passed
				blisters.forEach((s, blisterIdx) => {
					const blisterStart = new Date(s.start).getTime();
					const period = Math.max(1, s.every) * MS_PER_DAY;

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
					const fallbackPeople = med.takenBy?.length > 0 ? med.takenBy : [null];
					const peopleForThisIntake = intakePerson ? [intakePerson] : fallbackPeople;

					let timeBasedConsumed = 0;
					let lastAutoConsumedDateMs = 0;

					if (effectiveStart <= now) {
						const occurrences = Math.floor((now - effectiveStart) / period) + 1;
						timeBasedConsumed = occurrences * s.usage * peopleForThisIntake.length;
						const lastDoseTime = new Date(effectiveStart + (occurrences - 1) * period);
						lastAutoConsumedDateMs = new Date(
							lastDoseTime.getFullYear(),
							lastDoseTime.getMonth(),
							lastDoseTime.getDate()
						).getTime();
					}

					// Early intakes: future doses already marked as taken
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
							if (medId === med.id && bIdx === blisterIdx && timestamp > earlyCutoff) {
								earlyTakenConsumed += s.usage;
							}
						}
					}

					consumed += timeBasedConsumed + earlyTakenConsumed;
				});
			} else {
				// Manual mode: only count explicitly taken doses
				takenDoses.forEach((doseId) => {
					const parts = doseId.split("-");
					if (parts.length >= 3) {
						const medId = parseInt(parts[0], 10);
						const blisterIdx = parseInt(parts[1], 10);
						const doseTimestamp = parseInt(parts[2], 10);
						if (medId === med.id && blisters[blisterIdx]) {
							const blisterStartDate = new Date(blisters[blisterIdx].start);
							const blisterStartDateOnly = new Date(
								blisterStartDate.getFullYear(),
								blisterStartDate.getMonth(),
								blisterStartDate.getDate()
							).getTime();
							const afterCorrection = stockCorrectionCutoff === 0 || doseTimestamp > stockCorrectionCutoff;
							if (!Number.isNaN(blisterStartDateOnly) && doseTimestamp >= blisterStartDateOnly && afterCorrection) {
								consumed += blisters[blisterIdx].usage;
							}
						}
					}
				});
			}

			const totalPills = getMedTotal(med);
			const medsLeft = Math.max(0, totalPills - consumed);
			const rawDaysLeft = dailyRate > 0 ? medsLeft / dailyRate : null;
			const daysLeft = rawDaysLeft !== null ? Math.max(0, Math.floor(rawDaysLeft)) : null;
			const depletionMs = daysLeft !== null ? now + daysLeft * MS_PER_DAY : null;

			coverage[getMedDisplayName(med)] = { daysLeft, medsLeft: Number(medsLeft.toFixed(1)), dailyUsage: dailyRate };
			depletion[getMedDisplayName(med)] = depletionMs;
		}
		return { coverageByMed: coverage, depletionByMed: depletion };
	}, [data, takenDoses]);

	// Stock thresholds from API — matches DashboardPage's StockThresholds type exactly
	const stockThresholds = useMemo(
		() => ({
			lowStockDays: data?.stockThresholds?.lowStockDays ?? 30,
			normalStockDays: data?.stockThresholds?.normalStockDays ?? 60,
			highStockDays: data?.stockThresholds?.highStockDays ?? 90,
			criticalStockDays: data?.stockThresholds?.reminderDaysBefore ?? 7,
			expiryWarningDays: data?.stockThresholds?.expiryWarningDays ?? 90,
		}),
		[data]
	);

	// Get worst stock status for a day's medications — identical to DashboardPage
	function getDayStockStatus(meds: { medName: string; lastWhen: number }[]) {
		const statuses = meds.map((item) => {
			const coverage = coverageByMed[item.medName];
			const depletionTime = depletionByMed[item.medName];
			if (typeof depletionTime === "number" && item.lastWhen > depletionTime) return "danger";
			if (!coverage) return "success";
			const status = getStockStatus(coverage.daysLeft, coverage.medsLeft, stockThresholds);
			return status.className;
		});
		const fallbackStatus = statuses.includes("warning") ? "warning" : "success";
		return statuses.includes("danger") ? "danger" : fallbackStatus;
	}

	// Whether to show stock status indicators on the shared schedule
	const showStock = data?.shareStockStatus !== false;
	const showOnlyToday = data?.shareScheduleTodayOnly === true && (data?.upcomingTodayOnly ?? true);

	// Helper: check if a dose is "done" (taken, per-dose dismissed, or med-level dismissed)
	function isDoseIdDone(doseId: string): boolean {
		if (takenDoses.has(doseId)) return true;
		if (dismissedDoses.has(doseId)) return true;
		const parts = doseId.split("-");
		if (parts.length >= 3) {
			const medId = parts[0];
			const med = data?.medications.find((m) => String(m.id) === medId);
			if (med) {
				if (isDoseDismissed(doseId, med.dismissedUntil ?? undefined)) {
					return true;
				}
			}
		}
		return false;
	}

	// Missed past dose IDs — matches DashboardPage's missedPastDoseIds logic
	const missedPastDoseIds = useMemo(() => {
		const allPastDoseIds = pastDays.flatMap((d) => d.meds.flatMap((m) => m.doses.map((dose) => dose.id)));
		return allPastDoseIds.filter((id) => !isDoseIdDone(id));
	}, [pastDays, isDoseIdDone]);

	if (loading) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-loading">
					<h1>💊 MedAssist-ng</h1>
					<p>{t("common.loading")}</p>
				</div>
			</div>
		);
	}

	if (expiredData) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-error expired">
					<h1>💊 MedAssist-ng</h1>
					<div className="expired-icon">⏰</div>
					<h2>{t("share.expired.title")}</h2>
					<p className="expired-message">{t("share.expired.message", { takenBy: expiredData.takenBy })}</p>
					<p className="expired-contact">{t("share.expired.contact", { username: expiredData.ownerUsername })}</p>
					<p className="expired-date">
						{t("share.expired.expiredOn", {
							date: new Date(expiredData.expiredAt).toLocaleDateString(getSystemLocale(i18n.language)),
						})}
					</p>
				</div>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-error">
					<h1>💊 MedAssist-ng</h1>
					<p className="error-message">{error || "Unknown error"}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="shared-schedule-page">
			<div className="shared-schedule-container">
				<header className="shared-schedule-header">
					<h1>
						💊 {t("share.scheduleFor")} {data.takenBy}
					</h1>
					<div className="shared-schedule-header-actions">
						<div className={`theme-menu ${themeMenuOpen ? "open" : ""}`} ref={themeMenuRef}>
							<button className="icon-btn" onClick={() => setThemeMenuOpen(!themeMenuOpen)} title={t("theme.title")}>
								{resolvedTheme === "dark" ? "🌙" : "☀️"}
							</button>
							<div className="theme-dropdown">
								<button
									className={`theme-dropdown-item${themePreference === "light" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("light");
										setThemeMenuOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<circle cx="12" cy="12" r="5" />
										<line x1="12" y1="1" x2="12" y2="3" />
										<line x1="12" y1="21" x2="12" y2="23" />
										<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
										<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
										<line x1="1" y1="12" x2="3" y2="12" />
										<line x1="21" y1="12" x2="23" y2="12" />
										<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
										<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
									</svg>
									{t("theme.light")}
									{themePreference === "light" && <span className="theme-check">✓</span>}
								</button>
								<button
									className={`theme-dropdown-item${themePreference === "dark" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("dark");
										setThemeMenuOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
									</svg>
									{t("theme.dark")}
									{themePreference === "dark" && <span className="theme-check">✓</span>}
								</button>
								<button
									className={`theme-dropdown-item${themePreference === "system" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("system");
										setThemeMenuOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
										<line x1="8" y1="21" x2="16" y2="21" />
										<line x1="12" y1="17" x2="12" y2="21" />
									</svg>
									{t("theme.system")}
									{themePreference === "system" && <span className="theme-check">✓</span>}
								</button>
							</div>
						</div>
					</div>
					{!showOnlyToday &&
						(() => {
							const periodLabel =
								data.scheduleDays === 30
									? t("dashboard.schedules.1month")
									: data.scheduleDays === 90
										? t("dashboard.schedules.3months")
										: t("dashboard.schedules.6months");
							return (
								<p className="shared-schedule-period">
									{t("share.period")}: {periodLabel}
								</p>
							);
						})()}
				</header>

				<div className="timeline">
					{schedule.length === 0 ? (
						<p className="shared-schedule-empty">{t("share.noSchedule")}</p>
					) : (
						<>
							{/* Past days (when expanded) — rendered above toggle */}
							{!showOnlyToday &&
								showPastDays &&
								pastDays.map((day) => {
									// Get ALL dose IDs for this day (for total count and yellow styling)
									const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));

									// Really taken = all doses marked as taken by human (for green "All taken")
									const allReallyTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
									const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

									// Count missed doses that are NOT dismissed (for warning icon)
									const missedNotDismissedCount = day.meds.reduce((count, item) => {
										const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
										const dismissedUntilDate = med?.dismissedUntil ?? undefined;
										return (
											count +
											item.doses.reduce((doseCount, d) => {
												if (isDoseDismissed(d.id, dismissedUntilDate)) return doseCount;
												if (takenDoses.has(d.id) || dismissedDoses.has(d.id)) return doseCount;
												return doseCount + 1;
											}, 0)
										);
									}, 0);
									const hasRealMissed = missedNotDismissedCount > 0;

									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isCollapsed = !isManuallyExpanded;

									const pastMissedClass = allDoseIds.length > 0 ? "past-missed" : "";
									return (
										<div
											key={day.dateStr}
											className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allReallyTaken ? "all-taken" : pastMissedClass}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, true)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, true);
												}}
												title={isCollapsed ? t("common.expand") : t("common.collapse")}
											>
												<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
												<span className="day-date">{day.dateStr}</span>
												<span className="day-summary">
													{allReallyTaken ? (
														<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
													) : (
														<>
															{hasRealMissed && (
																<span
																	className="day-warning"
																	title={t("dashboard.schedules.missedDoses", { count: missedNotDismissedCount })}
																>
																	⚠️
																</span>
															)}
															<span className="day-progress">
																{takenCount}/{allDoseIds.length}
															</span>
														</>
													)}
												</span>
											</div>
											{!isCollapsed &&
												day.meds.map((item) => {
													const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const isEmpty = showStock && medCoverage ? medCoverage.medsLeft <= 0 : false;
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
													const status = showStock
														? willBeOutOfStock
															? { className: "danger", label: "status.outOfStock" }
															: medCoverage
																? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds)
																: null
														: null;

													const itemDoseIds = item.doses.map((d) => d.id);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));

													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allTaken ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<div
																		className={med?.imageUrl ? "med-avatar clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																			}
																		}}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</div>
																	<div className="med-name-stack">
																		<span className="med-name-text">{item.medName}</span>
																		{med?.genericName && <span className="med-generic-inline">{med.genericName}</span>}
																	</div>
																</div>
																<div className="tag-row">
																	<span className="tag subtle">{t("common.pillsTotal", { count: item.total })}</span>
																	{status && (
																		<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
																	)}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isTaken = takenDoses.has(dose.id);
																	return (
																		<div key={dose.id} className="dose-item past">
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				<span className="dose-usage-main">
																					{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				</span>
																				{med?.pillWeightMg && (
																					<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																				)}
																			</span>
																			<div className="dose-checks">
																				<div className={`dose-person ${isTaken ? "taken" : ""}`}>
																					{dose.takenBy && <span className="person-name">{dose.takenBy}</span>}
																					{isTaken ? (
																						<button
																							className="dose-btn undo"
																							onClick={() => undoDoseTaken(dose.id)}
																							title={t("common.undo")}
																						>
																							↩
																						</button>
																					) : (
																						<button
																							className="dose-btn take"
																							onClick={() => markDoseTaken(dose.id)}
																							disabled={isEmpty}
																							title={t("dose.markAsTaken")}
																						>
																							<span className="dose-btn-label">{t("dose.take")}</span>
																							<span aria-hidden="true">✓</span>
																						</button>
																					)}
																				</div>
																			</div>
																		</div>
																	);
																})}
															</div>
														</div>
													);
												})}
										</div>
									);
								})}
							{/* Past days toggle */}
							{!showOnlyToday &&
								pastDays.length > 0 &&
								(() => {
									const missedCount = missedPastDoseIds.length;
									const totalPastDoses = pastDays.flatMap((d) => d.meds.flatMap((m) => m.doses.map((dose) => dose.id)));
									return (
										<div className="past-days-header">
											<div
												className={`past-days-toggle ${showPastDays ? "expanded" : ""} ${missedCount > 0 ? "has-missed" : ""}`}
												onClick={() => {
													const wasCollapsed = !showPastDays;
													setShowPastDays(!showPastDays);
													if (wasCollapsed) {
														setTimeout(() => {
															document
																.querySelector(".day-block.today")
																?.scrollIntoView({ behavior: "smooth", block: "center" });
														}, 50);
													}
												}}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") setShowPastDays(!showPastDays);
												}}
											>
												<span className="past-days-icon">{showPastDays ? "▼" : "▶"}</span>
												<span className="past-days-label">
													{showPastDays ? t("dashboard.schedules.hidePastDays") : t("dashboard.schedules.showPastDays")}
												</span>
												<span className="past-days-count">
													({t("dashboard.schedules.pastDaysCount", { count: pastDays.length })})
												</span>
												{missedCount > 0 ? (
													<span
														className="past-days-warning"
														title={t("dashboard.schedules.missedDoses", { count: missedCount })}
													>
														⚠️ {missedCount}
													</span>
												) : totalPastDoses.length > 0 ? (
													<span className="past-days-complete" title={t("dashboard.schedules.allTaken")}>
														✓
													</span>
												) : null}
											</div>
										</div>
									);
								})()}
							{/* Today (always visible) */}
							{todayDay &&
								(() => {
									const day = todayDay;
									const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
									const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
									const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
									const worstStatus = getDayStockStatus(day.meds);

									// Today: only collapse if manually collapsed or all taken
									const isAutoCollapsed = allDayTaken;
									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
									const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;

									return (
										<div
											key={day.dateStr}
											className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} today stock-${showStock ? worstStatus : "success"}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, isAutoCollapsed);
												}}
												title={isCollapsed ? t("common.expand") : t("common.collapse")}
											>
												<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
												<span className="day-date">{day.dateStr}</span>
												<span className="day-summary">
													{allDayTaken ? (
														<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
													) : (
														<span className="day-progress">
															{takenCount}/{allDoseIds.length}
														</span>
													)}
												</span>
											</div>
											{!isCollapsed &&
												day.meds.map((item) => {
													const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const isEmpty = showStock && medCoverage ? medCoverage.medsLeft <= 0 : false;
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
													const status = showStock
														? willBeOutOfStock
															? { className: "danger", label: "status.outOfStock" }
															: medCoverage
																? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds)
																: null
														: null;

													const itemDoseIds = item.doses.map((d) => d.id);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allTaken ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<div
																		className={med?.imageUrl ? "med-avatar clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																			}
																		}}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</div>
																	<div className="med-name-stack">
																		<span className="med-name-text">{item.medName}</span>
																		{med?.genericName && <span className="med-generic-inline">{med.genericName}</span>}
																	</div>
																</div>
																<div className="tag-row">
																	<span className="tag subtle">{t("common.pillsTotal", { count: item.total })}</span>
																	{status && (
																		<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
																	)}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isTaken = takenDoses.has(dose.id);
																	const isOverdue = dose.when < Date.now() && !isTaken;
																	return (
																		<div
																			key={dose.id}
																			className={`dose-item ${isOverdue ? "overdue" : ""} ${isTaken ? "all-taken" : ""}`}
																		>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				<span className="dose-usage-main">
																					{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				</span>
																				{med?.pillWeightMg && (
																					<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																				)}
																			</span>
																			<div className="dose-checks">
																				<div
																					className={`dose-person ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}
																				>
																					{dose.takenBy && <span className="person-name">{dose.takenBy}</span>}
																					{isTaken ? (
																						<button
																							className="dose-btn undo"
																							onClick={() => undoDoseTaken(dose.id)}
																							title={t("common.undo")}
																						>
																							↩
																						</button>
																					) : (
																						<button
																							className="dose-btn take"
																							onClick={() => markDoseTaken(dose.id)}
																							title={t("dose.markAsTaken")}
																							disabled={isEmpty}
																						>
																							<span className="dose-btn-label">{t("dose.take")}</span>
																							<span aria-hidden="true">✓</span>
																						</button>
																					)}
																				</div>
																			</div>
																		</div>
																	);
																})}
															</div>
														</div>
													);
												})}
										</div>
									);
								})()}

							{/* Future days toggle — identical to DashboardPage */}
							{!showOnlyToday &&
								futureDays.length > 0 &&
								(() => {
									const totalFutureDoses = futureDays.flatMap((d) =>
										d.meds.flatMap((m) => m.doses.map((dose) => dose.id))
									);
									const takenFutureDoses = totalFutureDoses.filter((id) => takenDoses.has(id)).length;
									return (
										<div className="future-days-header">
											<div
												className={`future-days-toggle ${showFutureDays ? "expanded" : ""}`}
												onClick={() => setShowFutureDays(!showFutureDays)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") setShowFutureDays(!showFutureDays);
												}}
											>
												<span className="future-days-icon">{showFutureDays ? "▼" : "▶"}</span>
												<span className="future-days-label">
													{showFutureDays
														? t("dashboard.schedules.hideFutureDays")
														: t("dashboard.schedules.showFutureDays")}
												</span>
												<span className="future-days-count">
													({t("dashboard.schedules.futureDaysCount", { count: futureDays.length })})
												</span>
												{takenFutureDoses > 0 && totalFutureDoses.length > 0 && (
													<span className="future-days-progress">
														{takenFutureDoses}/{totalFutureDoses.length}
													</span>
												)}
											</div>
										</div>
									);
								})()}

							{/* Future days (when expanded) — identical to DashboardPage */}
							{!showOnlyToday &&
								showFutureDays &&
								futureDays.map((day) => {
									const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
									const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
									const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
									const worstStatus = getDayStockStatus(day.meds);

									// Future days: collapsed by default, manual override to expand
									const isAutoCollapsed = true;
									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isCollapsed = !isManuallyExpanded;

									return (
										<div
											key={day.dateStr}
											className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${showStock ? worstStatus : "success"}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, isAutoCollapsed);
												}}
												title={isCollapsed ? t("common.expand") : t("common.collapse")}
											>
												<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
												<span className="day-date">{day.dateStr}</span>
												<span className="day-summary">
													{allDayTaken ? (
														<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
													) : (
														<span className="day-progress">
															{takenCount}/{allDoseIds.length}
														</span>
													)}
												</span>
											</div>
											{!isCollapsed &&
												day.meds.map((item) => {
													const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
													const status = showStock
														? willBeOutOfStock
															? { className: "danger", label: "status.outOfStock" }
															: medCoverage
																? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds)
																: null
														: null;

													const itemDoseIds = item.doses.map((d) => d.id);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allTaken ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<div
																		className={med?.imageUrl ? "med-avatar clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																			}
																		}}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</div>
																	<div className="med-name-stack">
																		<span className="med-name-text">{item.medName}</span>
																		{med?.genericName && <span className="med-generic-inline">{med.genericName}</span>}
																	</div>
																</div>
																<div className="tag-row">
																	<span className="tag subtle">{t("common.pillsTotal", { count: item.total })}</span>
																	{status && (
																		<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
																	)}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isTaken = takenDoses.has(dose.id);
																	return (
																		<div key={dose.id} className={`dose-item future ${isTaken ? "all-taken" : ""}`}>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				<span className="dose-usage-main">
																					{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				</span>
																				{med?.pillWeightMg && (
																					<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																				)}
																			</span>
																			<div className="dose-checks">
																				<div className={`dose-person ${isTaken ? "taken" : ""}`}>
																					{dose.takenBy && <span className="person-name">{dose.takenBy}</span>}
																					{isTaken ? (
																						<button
																							className="dose-btn undo"
																							onClick={() => undoDoseTaken(dose.id)}
																							title={t("common.undo")}
																						>
																							↩
																						</button>
																					) : (
																						<button
																							className="dose-btn take"
																							onClick={() => markDoseTaken(dose.id)}
																							title={t("dose.markAsTaken")}
																							disabled={true}
																						>
																							<span className="dose-btn-label">{t("dose.take")}</span>
																							<span aria-hidden="true">✓</span>
																						</button>
																					)}
																				</div>
																			</div>
																		</div>
																	);
																})}
															</div>
														</div>
													);
												})}
										</div>
									);
								})}
						</>
					)}
				</div>

				<footer className="shared-schedule-footer">
					<p>
						{t("share.generatedBy")}{" "}
						{data?.sharedBy && (
							<>
								<strong>{data.sharedBy}</strong> ·{" "}
							</>
						)}
						<a href="/">MedAssist</a>
					</p>
				</footer>
			</div>

			{/* Image Lightbox */}
			{lightboxImage && (
				<div
					className="lightbox-overlay"
					onClick={closeLightbox}
					onKeyDown={(e) => {
						if (e.key !== "Escape") e.stopPropagation();
					}}
				>
					<button className="lightbox-close" onClick={closeLightbox}>
						×
					</button>
					<img
						src={`/api/images/${lightboxImage.url}`}
						alt={lightboxImage.name}
						className="lightbox-image"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key !== "Escape") e.stopPropagation();
						}}
					/>
				</div>
			)}
		</div>
	);
}
