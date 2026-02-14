import { useTranslation } from "react-i18next";
import { MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import type { Coverage } from "../types";
import { expandDoseIds, isDoseDismissed } from "../utils/schedule";

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// Helper function to get stock status based on thresholds
function getStockStatus(
	daysLeft: number | null,
	medsLeft: number,
	settings: { lowStockDays: number; normalStockDays: number; highStockDays: number; reminderDaysBefore: number }
) {
	// Out of stock or completely depleted = danger (red)
	if (medsLeft <= 0 || daysLeft === 0) return { className: "danger", label: "status.outOfStock" };
	// No schedule, but has stock = normal
	if (daysLeft === null) return { className: "success", label: "status.noSchedule" };
	// Critical: at or below reminder threshold = danger (red)
	if (daysLeft <= settings.reminderDaysBefore) return { className: "danger", label: "status.criticalStock" };
	// Low: below low stock threshold = warning (yellow)
	if (daysLeft < settings.lowStockDays) return { className: "warning", label: "status.lowStock" };
	// High stock
	if (daysLeft >= settings.highStockDays) return { className: "high", label: "status.highStock" };
	// Normal stock
	return { className: "success", label: "status.normal" };
}

// Helper function to get worst stock status for a day
function getDayStockStatus(
	dayMeds: Array<{ medName: string }>,
	coverageByMed: Record<string, Coverage>,
	settings: { lowStockDays: number; normalStockDays: number; highStockDays: number; reminderDaysBefore: number }
): string {
	let worstLevel = 3; // 3=success, 2=warning, 1=danger
	for (const item of dayMeds) {
		const cov = coverageByMed[item.medName];
		if (!cov) continue;
		const status = getStockStatus(cov.daysLeft, cov.medsLeft, settings);
		if (status.className === "danger") worstLevel = Math.min(worstLevel, 1);
		else if (status.className === "warning") worstLevel = Math.min(worstLevel, 2);
	}
	return worstLevel === 1 ? "danger" : worstLevel === 2 ? "warning" : "success";
}

// Helper to get dose ID (with or without person)
function getDoseId(baseId: string, person: string | null): string {
	return person ? `${baseId}-${person}` : baseId;
}

export function SchedulePage() {
	const { t } = useTranslation();
	const { user } = useAuth();
	const {
		meds,
		settings,
		scheduleDays,
		setScheduleDays,
		showPastDays,
		setShowPastDays,
		pastDays,
		futureDays,
		takenDoses,
		dismissedDoses,
		markDoseTaken,
		undoDoseTaken,
		coverageByMed,
		depletionByMed,
		manuallyExpandedDays,
		toggleDayCollapse,
		openUserFilter,
		missedPastDoseIds,
	} = useAppContext();

	return (
		<section className="grid">
			<article className="card schedule-full">
				<div className="card-head">
					<h2>{t("dashboard.schedules.title")}</h2>
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
				<div className="timeline">
					{/* Past days (when expanded) — rendered above toggle */}
					{showPastDays &&
						pastDays.map((day) => {
							// Get ALL dose IDs for this day (for total count and yellow styling)
							const allDoseIds = day.meds.flatMap((item) =>
								item.doses.flatMap((d) => {
									const takenByArray = Array.isArray(d.takenBy) ? d.takenBy : [];
									return takenByArray.length > 0 ? takenByArray.map((p) => `${d.id}-${p}`) : [d.id];
								})
							);

							// Really taken = all doses marked as taken by human (for green "All taken")
							const allReallyTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
							const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;

							// Count missed doses that are NOT dismissed (for warning icon)
							const missedNotDismissedCount = day.meds.reduce((count, item) => {
								const med = meds.find((m) => m.name === item.medName);
								const dismissedUntilDate = med?.dismissedUntil ?? undefined;
								return (
									count +
									item.doses.reduce((doseCount, d) => {
										if (isDoseDismissed(d.id, dismissedUntilDate)) return doseCount;
										const takenByArray = Array.isArray(d.takenBy) ? d.takenBy : [];
										const ids = takenByArray.length > 0 ? takenByArray.map((p) => `${d.id}-${p}`) : [d.id];
										return doseCount + ids.filter((id) => !takenDoses.has(id) && !dismissedDoses.has(id)).length;
									}, 0)
								);
							}, 0);
							const hasRealMissed = missedNotDismissedCount > 0;

							const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
							const isCollapsed = !isManuallyExpanded;
							const worstStatus = getDayStockStatus(day.meds, coverageByMed, settings);

							return (
								<div
									key={day.dateStr}
									className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allReallyTaken ? "all-taken" : allDoseIds.length > 0 ? "past-missed" : ""}`}
								>
									<div
										className="day-divider clickable"
										onClick={() => toggleDayCollapse(day.dateStr, true)}
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
											const med = meds.find((m) => m.name === item.medName);
											const medCov = coverageByMed[item.medName];
											const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
											const itemDoseIds = expandDoseIds(item.doses);
											const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
											return (
												<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
													<div className="time-main">
														<div className="med-name">
															<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
															<span className="med-name-text">{item.medName}</span>
														</div>
														<div className="tag-row">
															<span className="tag subtle">{t("common.pillsTotal", { count: item.total })}</span>
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
																		{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
																	</span>{" "}
																	{dose.intakeRemindersEnabled && (
																		<span
																			className="reminder-icon info-tooltip"
																			data-tooltip={t("tooltips.intakeReminders")}
																		>
																			🔔
																		</span>
																	)}{" "}
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
																							disabled={isEmpty}
																							title={t("dose.markAsTaken")}
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
					{/* Past days toggle */}
					{pastDays.length > 0 &&
						(() => {
							const missedCount = missedPastDoseIds.length;
							return (
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
								>
									<span className="past-days-icon">{showPastDays ? "▼" : "▶"}</span>
									<span className="past-days-label">
										{showPastDays ? t("dashboard.schedules.hidePastDays") : t("dashboard.schedules.showPastDays")}
									</span>
									<span className="past-days-count">
										({t("dashboard.schedules.pastDaysCount", { count: pastDays.length })})
									</span>
									{missedCount > 0 && (
										<span
											className="past-days-warning"
											title={t("dashboard.schedules.missedDoses", { count: missedCount })}
										>
											⚠️ {missedCount}
										</span>
									)}
								</div>
							);
						})()}
					{/* Current and future days */}
					{futureDays.map((day) => {
						const today = new Date();
						today.setHours(0, 0, 0, 0);
						const dayDate = new Date(day.date);
						dayDate.setHours(0, 0, 0, 0);
						const isToday = dayDate.getTime() === today.getTime();
						return (
							<div key={day.dateStr} className={`day-block ${isToday ? "today" : ""}`}>
								<div className="day-divider">{day.dateStr}</div>
								{day.meds.map((item) => {
									const medCoverage = coverageByMed[item.medName];
									const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
									const med = meds.find((m) => m.name === item.medName);
									const depletionTime = depletionByMed[item.medName];
									// Check if this dose is scheduled after medication runs out
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									const status = willBeOutOfStock
										? { className: "danger", label: "status.outOfStock" }
										: medCoverage
											? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings)
											: null;
									const itemDoseIds = expandDoseIds(item.doses);
									const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
									return (
										<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
											<div className="time-main">
												<div className="med-name">
													<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
													<span className="med-name-text">{item.medName}</span>
												</div>
												<div className="tag-row">
													<span className="tag subtle">{t("common.pillsTotal", { count: item.total })}</span>
													{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
												</div>
											</div>
											<div className="doses-col">
												{item.doses.map((dose) => {
													const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
													const now = Date.now();
													const dayStart = new Date(day.date).setHours(0, 0, 0, 0);
													const isPastDay = dayStart < new Date().setHours(0, 0, 0, 0);
													return (
														<div key={dose.id} className="dose-item">
															<span className="dose-time">{dose.timeStr}</span>
															<span className="dose-usage">
																{dose.usage} {dose.usage !== 1 ? t("common.pills") : t("common.pill")}
																{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}
															</span>
															{dose.intakeRemindersEnabled && (
																<span
																	className="reminder-icon info-tooltip"
																	data-tooltip={t("tooltips.intakeReminders")}
																>
																	🔔
																</span>
															)}
															<div className="dose-checks">
																{people.map((person) => {
																	const doseId = getDoseId(dose.id, person);
																	const isTaken = takenDoses.has(doseId);
																	const isOverdue = !isTaken && dose.when < now && !isPastDay;
																	return (
																		<div
																			key={doseId}
																			className={`dose-person ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}
																		>
																			{person && (
																				<span className="person-name clickable" onClick={() => openUserFilter(person)}>
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
																					disabled={isEmpty}
																					title={t("dose.markAsTaken")}
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
	);
}
