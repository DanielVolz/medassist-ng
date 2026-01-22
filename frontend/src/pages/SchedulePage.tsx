import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import { MedicationAvatar } from "../components";
import type { Coverage } from "../types";

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// Helper function to get stock status
function getStockStatus(daysLeft: number | null, medsLeft: number, settings: { lowStockDays: number; normalStockDays: number; highStockDays: number }) {
	if (medsLeft <= 0 || daysLeft === null || daysLeft <= 0) return { className: "danger", label: "status.outOfStock" };
	if (daysLeft <= settings.lowStockDays) return { className: "danger", label: "status.lowStock" };
	if (daysLeft >= settings.highStockDays) return { className: "success", label: "status.highStock" };
	return { className: "success", label: "status.normal" };
}

// Helper function to get worst stock status for a day
function getDayStockStatus(dayMeds: Array<{ medName: string }>, coverageByMed: Record<string, Coverage>, settings: { lowStockDays: number; normalStockDays: number; highStockDays: number }): string {
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
		markDoseTaken,
		undoDoseTaken,
		coverageByMed,
		depletionByMed,
		manuallyExpandedDays,
		toggleDayCollapse,
		openUserFilter,
	} = useAppContext();

	return (
		<section className="grid">
			<article className="card schedule-full">
				<div className="card-head">
					<h2>{t('dashboard.schedules.title')}</h2>
					<select 
						className="schedule-days-select"
						value={scheduleDays}
						onChange={(e) => {
							const val = Number(e.target.value);
							setScheduleDays(val);
							if (user?.id) localStorage.setItem(userStorageKey(user.id, "scheduleDays"), String(val));
						}}
					>
						<option value={30}>{t('dashboard.schedules.1month')}</option>
						<option value={90}>{t('dashboard.schedules.3months')}</option>
						<option value={180}>{t('dashboard.schedules.6months')}</option>
					</select>
				</div>
				<div className="timeline">
					{/* Past days toggle */}
					{pastDays.length > 0 && (() => {
						const totalPastDoses = pastDays.flatMap(d => d.meds.flatMap(m => m.doses.flatMap(dose => (dose.takenBy || []).length > 0 ? dose.takenBy.map(p => `${dose.id}-${p}`) : [dose.id])));
						const missedPastDoses = totalPastDoses.filter(id => !takenDoses.has(id)).length;
						return (
							<div 
								className={`past-days-toggle ${showPastDays ? 'expanded' : ''} ${missedPastDoses > 0 ? 'has-missed' : ''}`}
								onClick={() => setShowPastDays(!showPastDays)}
							>
								<span className="past-days-icon">{showPastDays ? '▼' : '▶'}</span>
								<span className="past-days-label">
									{showPastDays ? t('dashboard.schedules.hidePastDays') : t('dashboard.schedules.showPastDays')}
								</span>
								<span className="past-days-count">({t('dashboard.schedules.pastDaysCount', { count: pastDays.length })})</span>
								{missedPastDoses > 0 && <span className="past-days-warning" title={t('dashboard.schedules.missedDoses', { count: missedPastDoses })}>⚠️ {missedPastDoses}</span>}
							</div>
						);
					})()}
					{/* Past days (when expanded) */}
					{showPastDays && pastDays.map((day) => {
						const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
						const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
						const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
						const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
						const isCollapsed = !isManuallyExpanded;
						const worstStatus = getDayStockStatus(day.meds, coverageByMed, settings);
						
						return (
							<div key={day.dateStr} className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}>
								<div 
									className="day-divider clickable" 
									onClick={() => toggleDayCollapse(day.dateStr, true)}
									title={isCollapsed ? t('common.expand') : t('common.collapse')}
								>
									<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
									<span className="day-date">{day.dateStr}</span>
									<span className="day-summary">
										{allDayTaken ? (
											<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
										) : (
											<><span className="day-warning" title={t('dashboard.schedules.missedDoses', { count: allDoseIds.length - takenCount })}>⚠️</span><span className="day-progress">{takenCount}/{allDoseIds.length}</span></>
										)}
									</span>
								</div>
								{!isCollapsed && day.meds.map((item) => {
									const med = meds.find(m => m.name === item.medName);
									const medCov = coverageByMed[item.medName];
									const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
									const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
									const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
									return (
										<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
											<div className="time-main">
												<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
												<div className="tag-row">
													<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
												</div>
											</div>
											<div className="doses-col">
												{item.doses.map((dose) => {
													// If no takenBy, show single checkbox; otherwise show one per person
													const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
													return (
														<div key={dose.id} className="dose-item past">
															<span className="dose-time">{dose.timeStr}</span>
															<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
															<div className="dose-checks">
																{people.map((person) => {
																	const doseId = getDoseId(dose.id, person);
																	const isTaken = takenDoses.has(doseId);
																	return (
																		<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																			{person && <span className="person-name clickable" onClick={() => openUserFilter(person)}>{person}</span>}
																			{isTaken ? (
																				<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																			) : (
																				<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} disabled={isEmpty} title={t('dose.markAsTaken')}>✓</button>
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
								const med = meds.find(m => m.name === item.medName);
								const depletionTime = depletionByMed[item.medName];
								// Check if this dose is scheduled after medication runs out
								const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
								const status = willBeOutOfStock 
									? { className: "danger", label: "status.outOfStock" }
									: medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
								const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
								const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
								return (
									<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
										<div className="time-main">
											<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
											<div className="tag-row">
												<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
												{status && <span className={`tag ${status.className}`}>
													{t(status.label)}
												</span>}
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
														<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
														<div className="dose-checks">
															{people.map((person) => {
																const doseId = getDoseId(dose.id, person);
																const isTaken = takenDoses.has(doseId);
																const isOverdue = !isTaken && dose.when < now && !isPastDay;
																return (
																	<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}>
																		{person && <span className="person-name clickable" onClick={() => openUserFilter(person)}>{person}</span>}
																		{isTaken ? (
																			<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																		) : (
																			<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} disabled={isEmpty} title={t('dose.markAsTaken')}>✓</button>
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
					);})}
				</div>
			</article>
		</section>
	);
}
