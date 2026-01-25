import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import type { Coverage } from "../types";
import { formatNumber, getExpiryClass, getSystemLocale } from "../utils/formatters";

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// Helper function to get stock status
function getStockStatus(
	daysLeft: number | null,
	medsLeft: number,
	settings: { lowStockDays: number; normalStockDays: number; highStockDays: number }
) {
	if (medsLeft <= 0 || daysLeft === null || daysLeft <= 0) return { className: "danger", label: "status.outOfStock" };
	if (daysLeft <= settings.lowStockDays) return { className: "danger", label: "status.lowStock" };
	if (daysLeft >= settings.highStockDays) return { className: "success", label: "status.highStock" };
	return { className: "success", label: "status.normal" };
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

// Get total pills for a medication
function getMedTotal(med: {
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	stockAdjustment?: number | null;
}): number {
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
}

// Get next reminder date for a medication
function getNextReminderForMed(row: Coverage, reminderDaysBefore: number, locale: string): string {
	if (!row.depletionDate) return "-";
	const depletionDate = new Date(row.depletionDate);
	const reminderDate = new Date(depletionDate);
	reminderDate.setDate(reminderDate.getDate() - reminderDaysBefore);

	const now = new Date();
	if (reminderDate <= now) return "-";

	return reminderDate.toLocaleDateString(locale, { day: "2-digit", month: "short" });
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
	t: (key: string, options?: Record<string, unknown>) => string,
	locale: string
): {
	status: { text: string; className: string };
	next: { name: string; days: number } | null;
	lastSent: { date: string; medName: string | null; takenBy: string | null } | null;
} {
	const criticalCount = lowCoverage.length;
	const lowCount = allCoverage.filter((c) => {
		if (c.medsLeft <= 0) return false;
		if (c.daysLeft === null) return false;
		return c.daysLeft < lowStockDays && c.daysLeft > 3;
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

	// Find next medication to hit reminder threshold
	const nextToRunOut = allCoverage
		.filter((c) => c.daysLeft !== null && c.daysLeft > reminderDaysBefore)
		.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))[0];

	let next: { name: string; days: number } | null = null;
	if (nextToRunOut && nextToRunOut.daysLeft !== null) {
		const daysUntilReminder = Math.round(nextToRunOut.daysLeft - reminderDaysBefore);
		next = { name: nextToRunOut.name, days: daysUntilReminder };
	}

	// Parse last sent info
	let lastSent: { date: string; medName: string | null; takenBy: string | null } | null = null;
	if (lastAutoEmailSent) {
		const lastSentDate = new Date(lastAutoEmailSent);
		const formattedDate = lastSentDate.toLocaleDateString(locale, {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});

		lastSent = {
			date: formattedDate,
			medName: lastReminderMedName,
			takenBy: lastReminderTakenBy,
		};
	}

	return { status, next, lastSent };
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
	} = useAppContext();

	// Local state for reminder email
	const [sendingReminderEmail, setSendingReminderEmail] = useState(false);
	const [reminderEmailResult, setReminderEmailResult] = useState<{ success: boolean; message: string } | null>(null);

	async function sendReminderEmail() {
		if (!settings.notificationEmail || coverage.low.length === 0) return;
		setSendingReminderEmail(true);
		setReminderEmailResult(null);

		try {
			const res = await fetch("/api/reminder/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					lowStock: coverage.low,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setReminderEmailResult({ success: true, message: data.message || "Email sent!" });
			} else {
				setReminderEmailResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setReminderEmailResult({ success: false, message: "Network error" });
		}
		setSendingReminderEmail(false);
	}

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

	return (
		<>
			{anyRemindersEnabled && (
				<section className="reminder-status-bar">
					<div className="reminder-status-header">
						<span className="reminder-status-icon">
							<NotificationBellIcon />
						</span>
						<span className="reminder-status-title">{t("dashboard.reminders.active")}</span>
						<span className={`reminder-status-badge ${reminderData.status.className}`}>
							{reminderData.status.className === "success" && "✓ "}
							{reminderData.status.text}
						</span>
					</div>
					<div className="reminder-status-details">
						{stockRemindersEnabled && reminderData.next && (
							<div className="reminder-status-row">
								<span className="reminder-status-label">{t("dashboard.reminders.next")}:</span>
								<span className="reminder-status-value">
									{reminderData.next.name}{" "}
									{t("dashboard.reminders.inDays", { count: reminderData.next.days, days: reminderData.next.days })}
								</span>
							</div>
						)}
						{intakeRemindersEnabled && reminderData.lastSent && (
							<div className="reminder-status-row">
								<span className="reminder-status-label">{t("dashboard.reminders.lastSent")}:</span>
								<span className="reminder-status-value">
									{reminderData.lastSent.medName && (
										<span className="reminder-med-name">{reminderData.lastSent.medName}</span>
									)}
									{reminderData.lastSent.takenBy && (
										<span className="reminder-taken-by">({reminderData.lastSent.takenBy})</span>
									)}
									<span className="reminder-date">{reminderData.lastSent.date}</span>
								</span>
							</div>
						)}
					</div>
				</section>
			)}
			<section className="grid">
				<article className="card">
					<div className="card-head">
						<h2>{t("dashboard.reorder.title")}</h2>
					</div>
					{(() => {
						if (meds.length === 0) {
							return <p className="muted">{t("dashboard.reorder.noMeds")}</p>;
						}

						// Count medications with "Low" stock status (based on lowStockDays setting)
						const lowStockCount = coverage.all.filter((c) => {
							if (c.medsLeft <= 0) return true; // out of stock
							if (c.daysLeft === null) return false; // no schedule
							return c.daysLeft < settings.lowStockDays;
						}).length;

						if (coverage.low.length === 0) {
							// No critical meds (≤3 days)
							if (lowStockCount === 0) {
								// All good - everything is Normal or High
								return <p className="success-text">{t("dashboard.reorder.allGood")}</p>;
							} else {
								// Some meds are Low but not critical
								return <p className="warning-text">{t("dashboard.reorder.lowWarning", { count: lowStockCount })}</p>;
							}
						}

						return (
							<>
								<div className="table table-7">
									<div className="table-head">
										<span>{t("table.name")}</span>
										<span>{t("table.fullBlisters")}</span>
										<span>{t("table.openBlister")}</span>
										<span>{t("table.daysLeft")}</span>
										<span>{t("table.status")}</span>
										<span>{t("table.runsOut")}</span>
										<span>{t("table.autoRemind")}</span>
									</div>
									{coverage.low.map((row) => {
										const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
										const med = meds.find((m) => m.name === row.name);
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
													{(med?.intakeRemindersEnabled || med?.notes) && (
														<span className="med-icons">
															{med?.intakeRemindersEnabled && (
																<span
																	className="reminder-icon info-tooltip"
																	data-tooltip={t("tooltips.intakeReminders")}
																>
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
												<span data-label={t("table.fullBlisters")} className={textClass}>
													{formatFullBlisters(stock.fullBlisters, t)}
												</span>
												<span data-label={t("table.openBlister")} className={textClass}>
													{formatOpenBlisterAndLoose(
														stock.openBlisterPills,
														stock.loosePills,
														med?.pillsPerBlister ?? 1,
														t
													)}
												</span>
												<span data-label={t("table.days")} className={textClass}>
													{formatNumber(row.daysLeft)}
												</span>
												<span data-label={t("table.status")} className={`status-chip ${status.className}`}>
													{t(status.label)}
												</span>
												<span data-label={t("table.runsOut")}>{row.depletionDate ?? "-"}</span>
												<span data-label={t("table.autoRemind")} className="next-reminder-date">
													{getNextReminderForMed(row, settings.reminderDaysBefore, getSystemLocale(i18n.language))}
												</span>
											</div>
										);
									})}
								</div>
								{(settings.emailEnabled || settings.shoutrrrEnabled) && (
									<div className="email-send-action">
										<button type="button" className="ghost" onClick={sendReminderEmail} disabled={sendingReminderEmail}>
											{sendingReminderEmail ? t("common.sending") : t("dashboard.reorder.sendReminder")}
										</button>
										{reminderEmailResult && (
											<span className={reminderEmailResult.success ? "success-text" : "danger-text"}>
												{reminderEmailResult.message}
											</span>
										)}
									</div>
								)}
							</>
						);
					})()}
				</article>
			</section>

			<section className="grid">
				<article className="card">
					<div className="card-head">
						<h2>{t("dashboard.overview.title")}</h2>
					</div>
					<div className="table table-7">
						<div className="table-head">
							<span>{t("table.name")}</span>
							<span>{t("table.fullBlisters")}</span>
							<span>{t("table.openBlister")}</span>
							<span>{t("table.daysLeft")}</span>
							<span>{t("table.runsOut")}</span>
							<span>{t("table.expiry")}</span>
							<span>{t("table.status")}</span>
						</div>
						{coverage.all.map((row) => {
							const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
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
									<span data-label={t("table.fullBlisters")} className={textClass}>
										{formatFullBlisters(stock.fullBlisters, t)}
									</span>
									<span data-label={t("table.openBlister")} className={textClass}>
										{formatOpenBlisterAndLoose(stock.openBlisterPills, stock.loosePills, med?.pillsPerBlister ?? 1, t)}
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
								const totalPastDoses = pastDays.flatMap((d) =>
									d.meds.flatMap((m) =>
										m.doses.flatMap((dose) =>
											(dose.takenBy || []).length > 0 ? dose.takenBy.map((p) => `${dose.id}-${p}`) : [dose.id]
										)
									)
								);
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
									item.doses.flatMap((d) =>
										(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
									)
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
										className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}
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
												const itemDoseIds = item.doses.flatMap((d) =>
													(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
												);
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
																<span className="tag subtle">
																	{item.total} {t("common.pills")} {t("common.total")}
																</span>
															</div>
														</div>
														<div className="doses-col">
															{item.doses.map((dose) => {
																// If no takenBy, show single checkbox; otherwise show one per person
																const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																return (
																	<div key={dose.id} className="dose-item past">
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}
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
								const allDoseIds = day.meds.flatMap((item) =>
									item.doses.flatMap((d) =>
										(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
									)
								);
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

								const dayStockStatuses = day.meds.map((item) => {
									const medCoverage = coverageByMed[item.medName];
									const depletionTime = depletionByMed[item.medName];
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									if (willBeOutOfStock) return "danger";
									if (!medCoverage) return "success";
									const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings);
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
														? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings)
														: null;
												const itemDoseIds = item.doses.flatMap((d) =>
													(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
												);
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
																<span className="tag subtle">
																	{item.total} {t("common.pills")} {t("common.total")}
																</span>
																{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
															</div>
														</div>
														<div className="doses-col">
															{item.doses.map((dose) => {
																const isOverdue = dose.when < Date.now();
																const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
																return (
																	<div
																		key={dose.id}
																		className={`dose-item ${isOverdue ? "overdue" : ""} ${allTaken ? "all-taken" : ""}`}
																	>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}
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
											(dose.takenBy || []).length > 0 ? dose.takenBy.map((p) => `${dose.id}-${p}`) : [dose.id]
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
								const allDoseIds = day.meds.flatMap((item) =>
									item.doses.flatMap((d) =>
										(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
									)
								);
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

								const dayStockStatuses = day.meds.map((item) => {
									const medCoverage = coverageByMed[item.medName];
									const depletionTime = depletionByMed[item.medName];
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									if (willBeOutOfStock) return "danger";
									if (!medCoverage) return "success";
									const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings);
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
														? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings)
														: null;
												const itemDoseIds = item.doses.flatMap((d) =>
													(d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]
												);
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
																<span className="tag subtle">
																	{item.total} {t("common.pills")} {t("common.total")}
																</span>
																{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
															</div>
														</div>
														<div className="doses-col">
															{item.doses.map((dose) => {
																const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
																return (
																	<div key={dose.id} className={`dose-item future ${allTaken ? "all-taken" : ""}`}>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">
																			{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																			{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}
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
