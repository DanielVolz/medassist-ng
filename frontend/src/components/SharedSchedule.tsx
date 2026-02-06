// =============================================================================
// SharedSchedule Component - Public view for shared schedules
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import type { ExpiredLinkData, SharedScheduleData } from "../types";
import { getMedTotal } from "../types";
import { getSystemLocale } from "../utils/formatters";
import { isDoseDismissed } from "../utils/schedule";
import { loadCollapsedDaysFromStorage } from "../utils/storage";
import { MedicationAvatar } from "./MedicationAvatar";

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
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof window !== "undefined") {
			return (localStorage.getItem("theme") as "light" | "dark") || "dark";
		}
		return "dark";
	});

	// Apply theme to document
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("theme", theme);
	}, [theme]);

	function toggleTheme() {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}

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
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && lightboxImage) {
				closeLightbox();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [lightboxImage, closeLightbox]);

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
	function getDoseId(doseId: string, _person: string | null): string {
		// The dose.id already includes the person suffix if there's a per-intake takenBy
		return doseId;
	}

	// Count taken doses for a day/item (simplified - per-intake takenBy means one person per dose)
	function _countTakenDoses(doses: Array<{ id: string; takenBy: string | null }>): { total: number; taken: number } {
		let total = 0;
		let taken = 0;
		for (const d of doses) {
			total++;
			if (takenDoses.has(d.id)) taken++;
		}
		return { total, taken };
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
						medName: med.name,
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

	// Build a map of medication name -> dismissedUntil date string
	// This is robust against timestamp changes from schedule updates or timezone fixes
	const dismissedUntilByMed = useMemo(() => {
		if (!data) return new Map<string, string>();
		const map = new Map<string, string>();
		for (const med of data.medications) {
			if (med.dismissedUntil) {
				map.set(med.name, med.dismissedUntil);
			}
		}
		return map;
	}, [data]);

	// Helper to check if a dose date is on or before the dismissedUntil date
	function isDoseDismissedByName(doseTimestamp: number, medName: string): boolean {
		const dismissedUntilDate = dismissedUntilByMed.get(medName);
		if (!dismissedUntilDate) return false;
		// Compare date strings (YYYY-MM-DD format sorts correctly)
		const doseDate = new Date(doseTimestamp);
		const doseDateStr = `${doseDate.getFullYear()}-${String(doseDate.getMonth() + 1).padStart(2, "0")}-${String(doseDate.getDate()).padStart(2, "0")}`;
		return doseDateStr <= dismissedUntilDate;
	}

	// Calculate coverage for stock status colors (matches main app logic)
	// This needs to account for taken doses and calculate depletion time
	const { coverageByMed, depletionByMed } = useMemo(() => {
		if (!data) return { coverageByMed: {}, depletionByMed: {} };
		const coverage: Record<string, { daysLeft: number | null; medsLeft: number; dailyUsage: number }> = {};
		const depletion: Record<string, number | null> = {};

		// Calculate total pills taken per medication from takenDoses
		// With per-intake takenBy, each dose.id is unique and already has person suffix if needed
		const takenByMed: Record<string, number> = {};
		for (const dose of schedule.flatMap((d) => d.meds.flatMap((m) => m.doses))) {
			if (takenDoses.has(dose.id)) {
				takenByMed[dose.medName] = (takenByMed[dose.medName] || 0) + dose.usage;
			}
		}

		for (const med of data.medications) {
			const totalCount = getMedTotal(med);
			const taken = takenByMed[med.name] || 0;
			const currentCount = Math.max(0, totalCount - taken);
			// Calculate daily usage from intakes (or blisters for legacy)
			const intakes = med.intakes || med.blisters;
			const dailyUsage = intakes.reduce((sum, b) => sum + b.usage / b.every, 0);
			const daysLeft = dailyUsage > 0 ? currentCount / dailyUsage : null;
			coverage[med.name] = { daysLeft, medsLeft: currentCount, dailyUsage };

			// Calculate depletion time (when medication will run out)
			if (dailyUsage > 0 && currentCount > 0) {
				const daysUntilEmpty = currentCount / dailyUsage;
				depletion[med.name] = Date.now() + daysUntilEmpty * 24 * 60 * 60 * 1000;
			} else if (currentCount <= 0) {
				depletion[med.name] = Date.now(); // Already empty
			} else {
				depletion[med.name] = null; // No usage schedule
			}
		}
		return { coverageByMed: coverage, depletionByMed: depletion };
	}, [data, schedule, takenDoses]);

	// Stock thresholds from user settings (provided by API) or defaults
	const lowStockDays = data?.stockThresholds?.lowStockDays ?? 30;

	// Get worst stock status for a day's medications (matches main app logic with depletion)
	const getDayStockStatus = (meds: { medName: string; lastWhen: number }[]) => {
		const statuses = meds.map((item) => {
			const coverage = coverageByMed[item.medName];
			const depletionTime = depletionByMed[item.medName];

			// Will be out of stock by this day?
			if (typeof depletionTime === "number" && item.lastWhen > depletionTime) {
				return "danger";
			}

			if (!coverage) return "success";
			const { daysLeft, medsLeft } = coverage;

			// Currently out of stock
			if (medsLeft <= 0 || daysLeft === 0) return "danger";
			// No schedule (can't calculate)
			if (daysLeft === null) return "success";
			// Low stock: < lowStockDays (warning)
			if (daysLeft < lowStockDays) return "warning";
			// Normal/High stock
			return "success";
		});
		return statuses.includes("danger") ? "danger" : statuses.includes("warning") ? "warning" : "success";
	};

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
						<button
							className="icon-btn"
							onClick={toggleTheme}
							title={theme === "dark" ? t("tooltips.lightMode") : t("tooltips.darkMode")}
						>
							{theme === "dark" ? "☀️" : "🌙"}
						</button>
					</div>
					<p className="shared-schedule-period">
						{t("share.period")}:{" "}
						{data.scheduleDays === 30
							? t("dashboard.schedules.1month")
							: data.scheduleDays === 90
								? t("dashboard.schedules.3months")
								: t("dashboard.schedules.6months")}
					</p>
				</header>

				<div className="timeline">
					{schedule.length === 0 ? (
						<p className="shared-schedule-empty">{t("share.noSchedule")}</p>
					) : (
						<>
							{/* Past days toggle */}
							{pastDays.length > 0 &&
								(() => {
									// Count all past doses (for display)
									// With per-intake takenBy, each dose.id is unique
									const totalPastDoses = pastDays.flatMap((d) => d.meds.flatMap((m) => m.doses.map((dose) => dose.id)));
									// Count missed doses (not taken AND not dismissed AND not from previous schedule)
									// Check: per-dose dismissed flag, medication-level dismissedUntil, and updatedAt
									const missedPastDoses = totalPastDoses.filter((id) => {
										if (takenDoses.has(id)) return false;
										// Check if this dose is dismissed via per-dose flag from API
										if (dismissedDoses.has(id)) return false;
										// Check if dismissed via medication-level dismissedUntil date
										const parts = id.split("-");
										if (parts.length >= 3) {
											const medId = parts[0];
											const med = data?.medications.find((m) => String(m.id) === medId);
											if (med) {
												if (isDoseDismissed(id, med.dismissedUntil ?? undefined)) {
													return false; // dismissed = not missed
												}
											}
										}
										return true; // not taken, not dismissed = missed
									}).length;
									return (
										<div
											className={`past-days-toggle ${showPastDays ? "expanded" : ""} ${missedPastDoses > 0 ? "has-missed" : ""}`}
											onClick={() => setShowPastDays(!showPastDays)}
										>
											<span className="past-days-icon">{showPastDays ? "▼" : "▶"}</span>
											<span className="past-days-label">
												{showPastDays ? t("dashboard.schedules.hidePastDays") : t("dashboard.schedules.showPastDays")}
											</span>
											<span className="past-days-count">
												({t("dashboard.schedules.pastDaysCount", { count: pastDays.length })})
											</span>
											{missedPastDoses > 0 ? (
												<span
													className="past-days-warning"
													title={t("dashboard.schedules.missedDoses", { count: missedPastDoses })}
												>
													⚠️ {missedPastDoses}
												</span>
											) : totalPastDoses.length > 0 ? (
												<span className="past-days-complete" title={t("dashboard.schedules.allTaken")}>
													✓
												</span>
											) : null}
										</div>
									);
								})()}
							{/* Past days (when expanded) */}
							{showPastDays &&
								pastDays.map((day) => {
									// Helper to check if a dose ID is "done" (taken or dismissed)
									// Checks: per-dose dismissed flag and medication-level dismissedUntil
									const isDoseIdDone = (doseId: string) => {
										if (takenDoses.has(doseId)) return true;
										// Check if this dose is dismissed via per-dose flag from API
										if (dismissedDoses.has(doseId)) return true;
										// Check if dismissed via medication-level dismissedUntil date
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
									};

									const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
									const allDayDone = allDoseIds.length > 0 && allDoseIds.every(isDoseIdDone);
									const doneCount = allDoseIds.filter(isDoseIdDone).length;
									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isCollapsed = !isManuallyExpanded;

									// Calculate stock status for this day
									const worstStatus = getDayStockStatus(day.meds);

									return (
										<div
											key={day.dateStr}
											className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayDone ? "all-taken" : ""} stock-${worstStatus}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, true)}
												title={isCollapsed ? t("common.expand") : t("common.collapse")}
											>
												<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
												<span className="day-date">{day.dateStr}</span>
												<span className="day-summary">
													{allDayDone ? (
														<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
													) : (
														<>
															<span
																className="day-warning"
																title={t("dashboard.schedules.missedDoses", { count: allDoseIds.length - doneCount })}
															>
																⚠️
															</span>
															<span className="day-progress">
																{doneCount}/{allDoseIds.length}
															</span>
														</>
													)}
												</span>
											</div>
											{!isCollapsed &&
												day.meds.map((item) => {
													const med = data.medications.find((m) => m.name === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;

													// Calculate status for this medication on this day
													let status: { className: string; label: string } | null = null;
													if (willBeOutOfStock) {
														status = { className: "danger", label: "status.outOfStock" };
													} else if (medCoverage) {
														const { daysLeft, medsLeft } = medCoverage;
														if (medsLeft <= 0 || daysLeft === 0) {
															status = { className: "danger", label: "status.outOfStock" };
														} else if (daysLeft !== null && daysLeft < lowStockDays) {
															status = { className: "warning", label: "status.lowStock" };
														} else {
															status = { className: "success", label: "status.normal" };
														}
													}

													const itemDoseIds = item.doses.map((d) => d.id);
													// A dose is "done" if taken OR dismissed
													const allDone = itemDoseIds.every(isDoseIdDone);

													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allDone ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<span
																		className={med?.imageUrl ? "clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, med.name)}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</span>
																	<span className="med-name-text">{item.medName}</span>
																	{med?.genericName && <span className="med-generic-inline">({med.genericName})</span>}
																</div>
																<div className="tag-row">
																	<span className="tag subtle">
																		{item.total} {t("common.pills")} {t("common.total")}
																	</span>
																	{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	// Check: medication-level dismissedUntil and per-dose dismissed flag
																	const isMedLevelDismissed = isDoseDismissedByName(dose.when, dose.medName);
																	const isTaken = takenDoses.has(dose.id);
																	const isPerDoseDismissed = dismissedDoses.has(dose.id);
																	const isDone = isTaken || isPerDoseDismissed || isMedLevelDismissed;
																	return (
																		<div key={dose.id} className={`dose-item past ${isDone ? "all-taken" : ""}`}>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				{med?.pillWeightMg &&
																					` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
																			</span>
																			<div className="dose-checks">
																				<div className={`dose-person ${isDone ? "taken" : ""}`}>
																					{dose.takenBy && <span className="person-name">{dose.takenBy}</span>}
																					{isDone ? (
																						isTaken ? (
																							<button
																								className="dose-btn undo"
																								onClick={() => undoDoseTaken(dose.id)}
																								title={t("common.undo")}
																							>
																								↩
																							</button>
																						) : (
																							// Dismissed - show checkmark but no undo
																							<span
																								className="dose-btn dismissed"
																								title={t("dashboard.schedules.dismissed") ?? "Dismissed"}
																							>
																								✓
																							</span>
																						)
																					) : (
																						<button
																							className="dose-btn take"
																							onClick={() => markDoseTaken(dose.id)}
																							disabled={isEmpty}
																							title={t("dose.markAsTaken")}
																						>
																							✓
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
											className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} today stock-${worstStatus}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
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
													const med = data.medications.find((m) => m.name === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;

													let status: { className: string; label: string } | null = null;
													if (willBeOutOfStock) {
														status = { className: "danger", label: "status.outOfStock" };
													} else if (medCoverage) {
														const { daysLeft, medsLeft } = medCoverage;
														if (medsLeft <= 0 || daysLeft === 0) {
															status = { className: "danger", label: "status.outOfStock" };
														} else if (daysLeft !== null && daysLeft < lowStockDays) {
															status = { className: "warning", label: "status.lowStock" };
														} else {
															status = { className: "success", label: "status.normal" };
														}
													}

													const itemDoseIds = item.doses.map((d) => d.id);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allTaken ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<span
																		className={med?.imageUrl ? "clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, med.name)}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</span>
																	<span className="med-name-text">{item.medName}</span>
																	{med?.genericName && <span className="med-generic-inline">({med.genericName})</span>}
																</div>
																<div className="tag-row">
																	<span className="tag subtle">
																		{item.total} {t("common.pills")} {t("common.total")}
																	</span>
																	{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isTaken = takenDoses.has(dose.id);
																	const isOverdue = dose.when < Date.now() && !isTaken;
																	return (
																		<div key={dose.id} className={`dose-item ${isTaken ? "all-taken" : ""}`}>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				{med?.pillWeightMg &&
																					` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
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
																							✓
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

							{/* Future days toggle */}
							{futureDays.length > 0 && (
								<div
									className={`future-days-toggle ${showFutureDays ? "expanded" : ""}`}
									onClick={() => setShowFutureDays(!showFutureDays)}
								>
									<span className="future-days-icon">{showFutureDays ? "▼" : "▶"}</span>
									<span className="future-days-label">
										{showFutureDays ? t("dashboard.schedules.hideFutureDays") : t("dashboard.schedules.showFutureDays")}
									</span>
									<span className="future-days-count">
										({t("dashboard.schedules.futureDaysCount", { count: futureDays.length })})
									</span>
								</div>
							)}

							{/* Future days (when expanded) */}
							{showFutureDays &&
								futureDays.map((day) => {
									// Check if all doses in this day are taken (auto-collapse)
									const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
									const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
									const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

									// Calculate stock status for this day
									const worstStatus = getDayStockStatus(day.meds);

									// Determine if day should be collapsed (auto-collapsed by default, manual override)
									const isAutoCollapsed = allDayTaken;
									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
									const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;

									return (
										<div
											key={day.dateStr}
											className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}
										>
											<div
												className="day-divider clickable"
												onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
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
													const med = data.medications.find((m) => m.name === item.medName);
													const medCoverage = coverageByMed[item.medName];
													const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
													const depletionTime = depletionByMed[item.medName];
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;

													// Calculate status for this medication on this day
													let status: { className: string; label: string } | null = null;
													if (willBeOutOfStock) {
														status = { className: "danger", label: "status.outOfStock" };
													} else if (medCoverage) {
														const { daysLeft, medsLeft } = medCoverage;
														if (medsLeft <= 0 || daysLeft === 0) {
															status = { className: "danger", label: "status.outOfStock" };
														} else if (daysLeft !== null && daysLeft < lowStockDays) {
															status = { className: "warning", label: "status.lowStock" };
														} else {
															status = { className: "success", label: "status.normal" };
														}
													}

													const itemDoseIds = item.doses.map((d) => d.id);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div
															key={`${day.dateStr}-${item.medName}`}
															className={`time-row ${allTaken ? "taken" : ""}`}
														>
															<div className="time-main">
																<div className="med-name">
																	<span
																		className={med?.imageUrl ? "clickable" : ""}
																		onClick={() => med?.imageUrl && openLightbox(med.imageUrl, med.name)}
																	>
																		<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																	</span>
																	<span className="med-name-text">{item.medName}</span>
																	{med?.genericName && <span className="med-generic-inline">({med.genericName})</span>}
																</div>
																<div className="tag-row">
																	<span className="tag subtle">
																		{item.total} {t("common.pills")} {t("common.total")}
																	</span>
																	{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isTaken = takenDoses.has(dose.id);
																	// Only disable doses on future DAYS, not later today
																	const doseDate = new Date(dose.when);
																	doseDate.setHours(0, 0, 0, 0);
																	const todayMidnight = new Date();
																	todayMidnight.setHours(0, 0, 0, 0);
																	const isFutureDose = doseDate.getTime() > todayMidnight.getTime();
																	const isOverdue = dose.when < Date.now() && !isTaken && !isFutureDose;
																	return (
																		<div
																			key={dose.id}
																			className={`dose-item ${isFutureDose ? "future" : ""} ${isTaken ? "all-taken" : ""}`}
																		>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">
																				{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																				{med?.pillWeightMg &&
																					` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
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
																							disabled={isFutureDose || isEmpty}
																						>
																							✓
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
				<div className="lightbox-overlay" onClick={closeLightbox}>
					<button className="lightbox-close" onClick={closeLightbox}>
						×
					</button>
					<img
						src={`/api/images/${lightboxImage.url}`}
						alt={lightboxImage.name}
						className="lightbox-image"
						onClick={(e) => e.stopPropagation()}
					/>
				</div>
			)}
		</div>
	);
}
