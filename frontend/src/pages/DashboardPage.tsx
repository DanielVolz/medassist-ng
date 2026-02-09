import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import type { Coverage } from "../types";
import { formatNumber, getExpiryClass, getSystemLocale } from "../utils/formatters";
import { expandDoseIds, getStockStatus } from "../utils/schedule";

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// Helper function to calculate blister stock
function getBlisterStock(totalPills: number, pillsPerBlister: number, _looseTablets: number, _originalTotal: number) {
	const fullBlisters = Math.floor(totalPills / pillsPerBlister);
	const openBlisterPills = totalPills % pillsPerBlister;
	return { fullBlisters, openBlisterPills, loosePills: openBlisterPills };
}

// Helper to format full blisters
function formatFullBlisters(count: number, t: (key: string) => string): string {
	return `${count} ${t("common.blisters")}`;
}

// Helper to format open blister and loose pills
function formatOpenBlisterAndLoose(
	openBlisterPills: number,
	loosePills: number,
	pillsPerBlister: number,
	t: (key: string) => string
): string {
	if (openBlisterPills === 0 && loosePills === 0) return "-";
	return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")}`;
}

// Get total pills for a medication (packageType-aware)
function getMedTotal(med: {
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	stockAdjustment?: number | null;
	packageType?: string;
}): number {
	if (med.packageType === "bottle") {
		return med.looseTablets + (med.stockAdjustment ?? 0);
	}
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
}

// Notification bell SVG icon (no emoji)
function NotificationBellIcon() {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ display: "block" }}
		>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>
	);
}

// Get structured reminder status data
function getReminderStatusData(
	reminderDaysBefore: number,
	lowStockDays: number,
	lowCoverage: Coverage[],
	allCoverage: Coverage[],
	lastAutoEmailSent: string | null,
	lastNotificationType: string | null,
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
	const criticalCount = lowCoverage.length;
	const lowCount = allCoverage.filter((c) => {
		if (c.medsLeft <= 0) return false;
		if (c.daysLeft === null) return false;
		return c.daysLeft < lowStockDays && c.daysLeft > reminderDaysBefore;
	}).length;

	// Determine status
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

	// Collect all low stock medications (critical + low), deduplicated by name
	const lowStockMap = new Map<string, { name: string; daysLeft: number; isCritical: boolean }>();

	// Add critical meds (from lowCoverage - these are ≤3 days)
	for (const c of lowCoverage) {
		if (c.daysLeft !== null) {
			const existing = lowStockMap.get(c.name);
			if (!existing || c.daysLeft < existing.daysLeft) {
				lowStockMap.set(c.name, { name: c.name, daysLeft: Math.round(c.daysLeft), isCritical: true });
			}
		}
	}

	// Add low but not critical meds
	for (const c of allCoverage) {
		if (c.medsLeft <= 0) continue;
		if (c.daysLeft === null) continue;
		if (c.daysLeft < lowStockDays && c.daysLeft > reminderDaysBefore) {
			const existing = lowStockMap.get(c.name);
			if (!existing || c.daysLeft < existing.daysLeft) {
				lowStockMap.set(c.name, { name: c.name, daysLeft: Math.round(c.daysLeft), isCritical: false });
			}
		}
	}

	// Convert to array and sort by days left (most urgent first)
	const lowStockMeds = Array.from(lowStockMap.values()).sort((a, b) => a.daysLeft - b.daysLeft);

	// Parse last stock reminder sent info (from dedicated stock tracking columns)
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

	// Parse last intake reminder sent info (from intake tracking columns)
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

export function DashboardPage() {
	const { t, i18n } = useTranslation();
	const { user } = useAuth();
	const {
		meds,
		settings,
		coverage,
		coverageByMed,
		depletionByMed,
		scheduleDays,
		setScheduleDays,
		showPastDays,
		setShowPastDays,
		showFutureDays,
		setShowFutureDays,
		pastDays,
		todayDay,
		futureDays,
		takenDoses,
		dismissedDoses,
		markDoseTaken,
		undoDoseTaken,
		manuallyCollapsedDays,
		manuallyExpandedDays,
		toggleDayCollapse,
		missedPastDoseIds,
		getDayStockStatus,
		getDoseId,
		showClearMissedConfirm,
		setShowClearMissedConfirm,
		clearingMissed,
		dismissMissedDoses,
		openMedDetail,
		openUserFilter,
		openShareDialog,
		openScheduleLightbox,
		stockThresholds,
		loadSettings,
	} = useAppContext();

	// Get structured reminder data
	const reminderData = getReminderStatusData(
		settings.reminderDaysBefore,
		settings.lowStockDays,
		coverage.low,
		coverage.all,
		settings.lastAutoEmailSent,
		settings.lastNotificationType,
		settings.lastNotificationChannel,
		settings.lastReminderMedName,
		settings.lastReminderTakenBy,
		settings.lastStockReminderSent,
		settings.lastStockReminderChannel,
		settings.lastStockReminderMedNames,
		t,
		getSystemLocale(i18n.language)
	);

	// Check which reminder types are actually enabled (channel must be enabled too)
	const stockRemindersEnabled =
		(settings.emailEnabled && settings.emailStockReminders) ||
		(settings.shoutrrrEnabled && settings.shoutrrrStockReminders);
	const intakeRemindersEnabled =
		(settings.emailEnabled && settings.emailIntakeReminders) ||
		(settings.shoutrrrEnabled && settings.shoutrrrIntakeReminders);
	const anyRemindersEnabled = stockRemindersEnabled || intakeRemindersEnabled;

	// Manual reminder send state
	const [sendingReminder, setSendingReminder] = useState(false);
	const [reminderResult, setReminderResult] = useState<{ success: boolean; message: string } | null>(null);

	async function sendManualReminder() {
		if (!stockRemindersEnabled || reminderData.lowStockMeds.length === 0) return;
		setSendingReminder(true);
		setReminderResult(null);

		try {
			const lowStock = reminderData.lowStockMeds.map((m) => {
				const cov = coverage.all.find((c) => c.name === m.name);
				return {
					name: m.name,
					medsLeft: cov?.medsLeft ?? 0,
					daysLeft: m.daysLeft,
					depletionDate: cov?.depletionDate ?? null,
					isCritical: m.isCritical,
				};
			});

			const res = await fetch("/api/reminder/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					email: settings.notificationEmail,
					lowStock,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setReminderResult({ success: true, message: data.message || t("common.sent") });
				// Refresh settings so "Last stock reminder" row appears immediately
				loadSettings();
			} else {
				setReminderResult({ success: false, message: data.error || t("common.sendFailed") });
			}
		} catch {
			setReminderResult({ success: false, message: t("common.networkError") });
		}
		setSendingReminder(false);
	}

	return (
		<>
			{anyRemindersEnabled && (
				<section className="reminder-status-bar">
					<div className="reminder-status-header">
						<span className="reminder-status-icon">
							<NotificationBellIcon />
						</span>
						<span className="reminder-status-title">{t("dashboard.reminders.active")}</span>
						<span className={`status-chip small ${reminderData.status.className}`}>{reminderData.status.text}</span>
					</div>
					{(reminderData.lowStockMeds.length > 0 ||
						(stockRemindersEnabled && reminderData.lastStockSent) ||
						(intakeRemindersEnabled && reminderData.lastIntakeSent)) && (
						<div className="reminder-status-details">
							{stockRemindersEnabled && reminderData.lowStockMeds.length > 0 && (
								<div className="reminder-status-row">
									<span className="reminder-status-label">{t("dashboard.reminders.needsRefill")}:</span>
									<span className="reminder-status-value">
										{reminderData.lowStockMeds.map((med, idx) => {
											const medication = meds.find((m) => m.name === med.name);
											const cov = coverage.all.find((c) => c.name === med.name);
											const status = cov ? getStockStatus(cov.daysLeft, cov.medsLeft, stockThresholds) : null;
											const textClass =
												status?.className === "danger"
													? "danger-text"
													: status?.className === "warning"
														? "warning-text"
														: "";
											return (
												<span key={med.name}>
													{idx > 0 && ", "}
													<span
														className={`med-link clickable ${textClass}`}
														onClick={() => medication && openMedDetail(medication)}
													>
														{med.name}
													</span>
													<span className={`reminder-days-left ${textClass}`}>
														{" "}
														{t("dashboard.reminders.daysLeft", { count: med.daysLeft, days: med.daysLeft })}
													</span>
												</span>
											);
										})}
									</span>
								</div>
							)}
							{stockRemindersEnabled && reminderData.lastStockSent && (
								<div className="reminder-status-row">
									<span className="reminder-status-label">{t("dashboard.reminders.lastStockSent")}:</span>
									<span className="reminder-status-value">
										{reminderData.lastStockSent.medNames &&
											(() => {
												// Extract first med name (medNames may be "Name (+N)")
												const rawName = reminderData.lastStockSent!.medNames!;
												const firstName = rawName.replace(/\s*\(\+\d+\)$/, "");
												const suffix = rawName.includes("(+") ? rawName.slice(firstName.length) : "";
												const medication = meds.find((m) => m.name === firstName);
												return medication ? (
													<>
														<span className="med-link clickable" onClick={() => openMedDetail(medication)}>
															{firstName}
														</span>
														{suffix && <span className="reminder-med-name">{suffix}</span>}
													</>
												) : (
													<span className="reminder-med-name">{rawName}</span>
												);
											})()}
										<span className="reminder-date"> {reminderData.lastStockSent.date}</span>
									</span>
								</div>
							)}
							{intakeRemindersEnabled && reminderData.lastIntakeSent && (
								<div className="reminder-status-row">
									<span className="reminder-status-label">{t("dashboard.reminders.lastSent")}:</span>
									<span className="reminder-status-value">
										{reminderData.lastIntakeSent.medName &&
											(() => {
												const medication = meds.find((m) => m.name === reminderData.lastIntakeSent!.medName);
												return medication ? (
													<span className="med-link clickable" onClick={() => openMedDetail(medication)}>
														{reminderData.lastIntakeSent!.medName}
													</span>
												) : (
													<span className="reminder-med-name">{reminderData.lastIntakeSent!.medName}</span>
												);
											})()}
										{reminderData.lastIntakeSent.takenBy && (
											<span className="reminder-taken-by"> ({reminderData.lastIntakeSent.takenBy})</span>
										)}
										<span className="reminder-date"> {reminderData.lastIntakeSent.date}</span>
									</span>
								</div>
							)}
						</div>
					)}
					{stockRemindersEnabled && reminderData.lowStockMeds.length > 0 && (
						<div className="reminder-send-row">
							<button type="button" className="ghost" onClick={sendManualReminder} disabled={sendingReminder}>
								{sendingReminder ? t("common.sending") : t("dashboard.reorder.sendReminder")}
							</button>
							{reminderResult && (
								<span className={`reminder-send-result ${reminderResult.success ? "success" : "error"}`}>
									{reminderResult.message}
								</span>
							)}
						</div>
					)}
				</section>
			)}
			{/* Reorder Reminder card: Only show when reminders are NOT enabled (otherwise Reminder Bar shows the same info) */}
			{!anyRemindersEnabled && (
				<section className="grid">
					<article className="card">
						<div className="card-head">
							<h2>{t("dashboard.reorder.title")}</h2>
						</div>
						{(() => {
							if (meds.length === 0) {
								return <p className="muted">{t("dashboard.reorder.noMeds")}</p>;
							}

							// Count medications with low stock (based on lowStockDays setting), deduplicated by name
							const lowStockMap = new Map<string, Coverage>();
							for (const c of coverage.all) {
								if (c.daysLeft === null && c.medsLeft > 0) continue; // no schedule, has stock
								if (c.medsLeft <= 0 || c.daysLeft === null || c.daysLeft < settings.lowStockDays) {
									const existing = lowStockMap.get(c.name);
									if (!existing || (c.daysLeft ?? 0) < (existing.daysLeft ?? 0)) {
										lowStockMap.set(c.name, c);
									}
								}
							}
							const lowStockMeds = Array.from(lowStockMap.values());
							const lowStockCount = lowStockMeds.length;

							if (lowStockCount === 0) {
								// All good - everything is Normal or High
								return <p className="success-text">{t("dashboard.reorder.allGood")}</p>;
							}

							// Some meds are low - show simple text with clickable names and days left
							return (
								<p>
									{t("dashboard.reorder.lowWarningPrefix")}{" "}
									{lowStockMeds.map((c, idx) => {
										const med = meds.find((m) => m.name === c.name);
										const status = getStockStatus(c.daysLeft, c.medsLeft, stockThresholds);
										const textClass =
											status.className === "danger"
												? "danger-text"
												: status.className === "warning"
													? "warning-text"
													: "";
										return (
											<span key={c.name}>
												{idx > 0 && ", "}
												<span className={`med-link clickable ${textClass}`} onClick={() => med && openMedDetail(med)}>
													{c.name}
												</span>
												<span className={`reminder-days-left ${textClass}`}>
													{" "}
													({t("dashboard.reminders.daysLeft", { count: c.daysLeft ?? 0, days: c.daysLeft ?? 0 })})
												</span>
											</span>
										);
									})}{" "}
									{t("dashboard.reorder.lowWarningSuffix", { count: lowStockCount })}
								</p>
							);
						})()}
					</article>
				</section>
			)}

			<section className="grid">
				<article className="card">
					<div className="card-head">
						<h2>{t("dashboard.overview.title")}</h2>
					</div>
					<div className="table table-7">
						<div className="table-head">
							<span>{t("table.name")}</span>
							<span>{t("table.stock")}</span>
							<span>{t("table.stockDetails")}</span>
							<span>{t("table.daysLeft")}</span>
							<span>{t("table.runsOut")}</span>
							<span>{t("table.expiry")}</span>
							<span>{t("table.status")}</span>
						</div>
						{coverage.all.map((row) => {
							const status = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds);
							const med = meds.find((m) => m.name === row.name);
							const expiryClass = getExpiryClass(med?.expiryDate, settings.expiryWarningDays);
							const textClass =
								status.className === "danger"
									? "danger-text"
									: status.className === "warning"
										? "warning-text"
										: "success-text";
							const stock = getBlisterStock(
								Math.round(row.medsLeft),
								med?.pillsPerBlister ?? 1,
								med?.looseTablets ?? 0,
								med ? getMedTotal(med) : Math.round(row.medsLeft)
							);
							return (
								<div key={row.name} className="table-row clickable" onClick={() => med && openMedDetail(med)}>
									<span data-label={t("table.name")} className="cell-with-avatar">
										<span className="med-name-line">
											<MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />
											<span className="med-name-text">{row.name}</span>
											{med?.takenBy &&
												med.takenBy.length > 0 &&
												med.takenBy.map((person) => (
													<span
														key={person}
														className="taken-by-badge clickable"
														onClick={(e) => {
															e.stopPropagation();
															openUserFilter(person);
														}}
													>
														{person}
													</span>
												))}
										</span>
										{(med?.intakeRemindersEnabled || med?.notes) && (
											<span className="med-icons">
												{med?.intakeRemindersEnabled && (
													<span className="reminder-icon info-tooltip" data-tooltip={t("tooltips.intakeReminders")}>
														🔔
													</span>
												)}
												{med?.notes && (
													<span className="notes-icon info-tooltip" data-tooltip={t("tooltips.hasNotes")}>
														📝
													</span>
												)}
											</span>
										)}
									</span>
									<span data-label={t("table.stock")} className={textClass}>
										{med?.packageType === "bottle"
											? t("table.pillsCount", { count: Math.round(row.medsLeft) })
											: formatFullBlisters(stock.fullBlisters, t)}
									</span>
									<span
										data-label={t("table.stockDetails")}
										className={`${textClass}${med?.packageType === "bottle" ? " hide-on-card" : ""}`}
									>
										{med?.packageType === "bottle"
											? "—"
											: formatOpenBlisterAndLoose(
													stock.openBlisterPills,
													stock.loosePills,
													med?.pillsPerBlister ?? 1,
													t
												)}
									</span>
									<span data-label={t("table.daysLeft")} className={textClass}>
										{formatNumber(row.daysLeft)}
									</span>
									<span data-label={t("table.runsOut")}>{row.depletionDate ?? "-"}</span>
									<span data-label={t("table.expiry")} className={expiryClass}>
										{med?.expiryDate
											? new Date(med.expiryDate).toLocaleDateString(getSystemLocale(i18n.language), {
													day: "2-digit",
													month: "short",
													year: "2-digit",
												})
											: "-"}
									</span>
									<span data-label={t("table.status")} className={`status-chip ${status.className}`}>
										{t(status.label)}
									</span>
								</div>
							);
						})}
					</div>
				</article>
			</section>

			<section className="grid">
				<article className="card">
					<div className="card-head">
						<h2>{t("dashboard.schedules.title")}</h2>
						<div className="card-head-actions">
							{meds.some((m) => m.takenBy && m.takenBy.length > 0) && (
								<button className="ghost share-btn" onClick={openShareDialog} title={t("share.button")}>
									🔗 {t("share.button")}
								</button>
							)}
							<select
								className="schedule-days-select"
								value={scheduleDays}
								onChange={(e) => {
									const val = Number(e.target.value);
									setScheduleDays(val);
									if (user?.id) localStorage.setItem(userStorageKey(user.id, "scheduleDays"), String(val));
								}}
							>
								<option value={30}>{t("dashboard.schedules.1month")}</option>
								<option value={90}>{t("dashboard.schedules.3months")}</option>
								<option value={180}>{t("dashboard.schedules.6months")}</option>
							</select>
						</div>
					</div>
					<div className="timeline">
						{/* Past days toggle */}
						{pastDays.length > 0 &&
							(() => {
								const missedCount = missedPastDoseIds.length;
								const totalPastDoses = pastDays.flatMap((d) => d.meds.flatMap((m) => expandDoseIds(m.doses)));
								return (
									<div className="past-days-header">
										<div
											className={`past-days-toggle ${showPastDays ? "expanded" : ""} ${missedCount > 0 ? "has-missed" : ""}`}
											onClick={() => setShowPastDays(!showPastDays)}
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
										{missedCount > 0 && (
											<button
												type="button"
												className="clear-missed-btn"
												onClick={(e) => {
													e.stopPropagation();
													setShowClearMissedConfirm(true);
												}}
												title={t("dashboard.schedules.clearMissed")}
											>
												{t("dashboard.schedules.clearMissed")}
											</button>
										)}
									</div>
								);
							})()}
						{/* Past days (when expanded) */}
						{showPastDays &&
							pastDays.map((day) => {
								const allDoseIds = day.meds.flatMap((item) =>
									item.doses.flatMap((d) => {
										const takenByArray = Array.isArray(d.takenBy) ? d.takenBy : [];
										return takenByArray.length > 0 ? takenByArray.map((p) => `${d.id}-${p}`) : [d.id];
									})
								);
								const allDayTaken =
									allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id) || dismissedDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id) || dismissedDoses.has(id)).length;
								const isAutoCollapsed = true; // Past days are always auto-collapsed
								const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
								const isCollapsed = !isManuallyExpanded;
								const worstStatus = getDayStockStatus(day.meds);

								return (
									<div
										key={day.dateStr}
										className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : allDoseIds.length > 0 ? "past-missed" : ""}`}
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
													<>
														<span
															className="day-warning"
															title={t("dashboard.schedules.missedDoses", { count: allDoseIds.length - takenCount })}
														>
															⚠️
														</span>
														<span className="day-progress">
															{takenCount}/{allDoseIds.length}
														</span>
													</>
												)}
											</span>
										</div>
										{!isCollapsed &&
											day.meds.map((item) => {
												const med = meds.find((m) => m.name === item.medName);
												const medCov = coverageByMed[item.medName];
												const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
												const status = medCov
													? getStockStatus(medCov.daysLeft, medCov.medsLeft, stockThresholds)
													: null;
												const itemDoseIds = expandDoseIds(item.doses);
												const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
												return (
													<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
														<div className="time-main">
															<div className="med-name">
																<div
																	className={med?.imageUrl ? "med-avatar clickable" : ""}
																	onClick={() => med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)}
																>
																	<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																</div>
																<span className="med-name-text">{item.medName}</span>
																{med?.intakeRemindersEnabled && (
																	<span
																		className="reminder-icon info-tooltip"
																		data-tooltip={t("tooltips.intakeReminders")}
																	>
																		🔔
																	</span>
																)}
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
																// If no takenBy, show single checkbox; otherwise show one per person
																const people = dose.takenBy.length > 0 ? dose.takenBy : [null];
																return (
																	<div key={dose.id} className="dose-item past">
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg &&
																				` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
																		</span>
																		<div className="dose-checks">
																			{people.map((person) => {
																				const doseId = getDoseId(dose.id, person);
																				const isTaken = takenDoses.has(doseId);
																				return (
																					<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																						{person && (
																							<span
																								className="person-name clickable"
																								onClick={() => openUserFilter(person)}
																							>
																								{person}
																							</span>
																						)}
																						{isTaken ? (
																							<button
																								className="dose-btn undo"
																								onClick={() => undoDoseTaken(doseId)}
																								title={t("common.undo")}
																							>
																								↩
																							</button>
																						) : (
																							<button
																								className="dose-btn take"
																								onClick={() => markDoseTaken(doseId)}
																								title={t("dose.markAsTaken")}
																								disabled={isEmpty}
																							>
																								✓
																							</button>
																						)}
																					</div>
																				);
																			})}
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
						{/* Today - always visible */}
						{todayDay &&
							(() => {
								const day = todayDay;
								const allDoseIds = day.meds.flatMap((item) => expandDoseIds(item.doses));
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

								const dayStockStatuses = day.meds.map((item) => {
									const medCoverage = coverageByMed[item.medName];
									const depletionTime = depletionByMed[item.medName];
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									if (willBeOutOfStock) return "danger";
									if (!medCoverage) return "success";
									const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds);
									return status.className;
								});
								const worstStatus = dayStockStatuses.includes("danger")
									? "danger"
									: dayStockStatuses.includes("warning")
										? "warning"
										: "success";

								// Today: expanded by default, can be manually collapsed
								const isAutoCollapsed = allDayTaken;
								const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
								const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
								const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;

								return (
									<div
										key={day.dateStr}
										className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} today ${worstStatus ? `stock-${worstStatus}` : ""}`}
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
												const medCoverage = coverageByMed[item.medName];
												const med = meds.find((m) => m.name === item.medName);
												const depletionTime = depletionByMed[item.medName];
												const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
												const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
												const status = willBeOutOfStock
													? { className: "danger", label: "status.outOfStock" }
													: medCoverage
														? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds)
														: null;
												const itemDoseIds = expandDoseIds(item.doses);
												const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
												return (
													<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
														<div className="time-main">
															<div className="med-name">
																<div
																	className={med?.imageUrl ? "med-avatar clickable" : ""}
																	onClick={() => med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)}
																>
																	<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																</div>
																<span className="med-name-text">{item.medName}</span>
																{med?.intakeRemindersEnabled && (
																	<span
																		className="reminder-icon info-tooltip"
																		data-tooltip={t("tooltips.intakeReminders")}
																	>
																		🔔
																	</span>
																)}
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
																const isOverdue = dose.when < Date.now();
																const people = dose.takenBy.length > 0 ? dose.takenBy : [null];
																const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
																return (
																	<div
																		key={dose.id}
																		className={`dose-item ${isOverdue ? "overdue" : ""} ${allTaken ? "all-taken" : ""}`}
																	>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg &&
																				` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
																		</span>
																		<div className="dose-checks">
																			{people.map((person) => {
																				const doseId = getDoseId(dose.id, person);
																				const isTaken = takenDoses.has(doseId);
																				return (
																					<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																						{person && (
																							<span
																								className="person-name clickable"
																								onClick={() => openUserFilter(person)}
																							>
																								{person}
																							</span>
																						)}
																						{isTaken ? (
																							<button
																								className="dose-btn undo"
																								onClick={() => undoDoseTaken(doseId)}
																								title={t("common.undo")}
																							>
																								↩
																							</button>
																						) : (
																							<button
																								className="dose-btn take"
																								onClick={() => markDoseTaken(doseId)}
																								title={t("dose.markAsTaken")}
																								disabled={isEmpty}
																							>
																								✓
																							</button>
																						)}
																					</div>
																				);
																			})}
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
						{futureDays.length > 0 &&
							(() => {
								const totalFutureDoses = futureDays.flatMap((d) =>
									d.meds.flatMap((m) =>
										m.doses.flatMap((dose) =>
											dose.takenBy.length > 0 ? dose.takenBy.map((p) => `${dose.id}-${p}`) : [dose.id]
										)
									)
								);
								const takenFutureDoses = totalFutureDoses.filter((id) => takenDoses.has(id)).length;
								return (
									<div className="future-days-header">
										<div
											className={`future-days-toggle ${showFutureDays ? "expanded" : ""}`}
											onClick={() => setShowFutureDays(!showFutureDays)}
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
						{/* Future days */}
						{showFutureDays &&
							futureDays.map((day) => {
								const allDoseIds = day.meds.flatMap((item) => expandDoseIds(item.doses));
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

								const dayStockStatuses = day.meds.map((item) => {
									const medCoverage = coverageByMed[item.medName];
									const depletionTime = depletionByMed[item.medName];
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									if (willBeOutOfStock) return "danger";
									if (!medCoverage) return "success";
									const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds);
									return status.className;
								});
								const worstStatus = dayStockStatuses.includes("danger")
									? "danger"
									: dayStockStatuses.includes("warning")
										? "warning"
										: "success";

								// Future days: collapsed by default
								const isAutoCollapsed = true;
								const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
								const isCollapsed = !isManuallyExpanded;

								return (
									<div
										key={day.dateStr}
										className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} ${worstStatus ? `stock-${worstStatus}` : ""}`}
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
												const medCoverage = coverageByMed[item.medName];
												const med = meds.find((m) => m.name === item.medName);
												const depletionTime = depletionByMed[item.medName];
												const _isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
												const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
												const status = willBeOutOfStock
													? { className: "danger", label: "status.outOfStock" }
													: medCoverage
														? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, stockThresholds)
														: null;
												const itemDoseIds = expandDoseIds(item.doses);
												const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
												return (
													<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
														<div className="time-main">
															<div className="med-name">
																<div
																	className={med?.imageUrl ? "med-avatar clickable" : ""}
																	onClick={() => med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)}
																>
																	<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																</div>
																<span className="med-name-text">{item.medName}</span>
																{med?.intakeRemindersEnabled && (
																	<span
																		className="reminder-icon info-tooltip"
																		data-tooltip={t("tooltips.intakeReminders")}
																	>
																		🔔
																	</span>
																)}
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
																const people = dose.takenBy.length > 0 ? dose.takenBy : [null];
																const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
																return (
																	<div key={dose.id} className={`dose-item future ${allTaken ? "all-taken" : ""}`}>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg &&
																				` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
																		</span>
																		<div className="dose-checks">
																			{people.map((person) => {
																				const doseId = getDoseId(dose.id, person);
																				const isTaken = takenDoses.has(doseId);
																				return (
																					<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																						{person && (
																							<span
																								className="person-name clickable"
																								onClick={() => openUserFilter(person)}
																							>
																								{person}
																							</span>
																						)}
																						{isTaken ? (
																							<button
																								className="dose-btn undo"
																								onClick={() => undoDoseTaken(doseId)}
																								title={t("common.undo")}
																							>
																								↩
																							</button>
																						) : (
																							<button
																								className="dose-btn take"
																								onClick={() => markDoseTaken(doseId)}
																								title={t("dose.markAsTaken")}
																								disabled={true}
																							>
																								✓
																							</button>
																						)}
																					</div>
																				);
																			})}
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
					</div>
				</article>
			</section>

			{/* Clear Missed Doses Confirmation Modal */}
			{showClearMissedConfirm && (
				<ConfirmModal
					title={t("dashboard.schedules.clearMissedConfirmTitle")}
					message={t("dashboard.schedules.clearMissedConfirmMessage", { count: missedPastDoseIds.length })}
					confirmLabel={clearingMissed ? t("common.loading") : t("dashboard.schedules.clearMissedConfirm")}
					cancelLabel={t("dashboard.schedules.clearMissedCancel")}
					onConfirm={() => dismissMissedDoses(missedPastDoseIds)}
					onCancel={() => setShowClearMissedConfirm(false)}
					isLoading={clearingMissed}
				/>
			)}
		</>
	);
}
