/* biome-ignore-all lint/style/noNestedTernary: schedule timeline branches are intentionally explicit */
import { Archive, Bell, ClipboardList, NotebookPen } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, IntakeJournalHistoryModal, IntakeJournalModal, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useFeedback } from "../context/FeedbackContext";
import { ScheduleUsageTag } from "../features/schedule/components";
import { formatScheduleDoseUsageLabel, formatScheduleTotalUsageLabel } from "../features/schedule/formatters";
import { useModalHistory, useScheduleController } from "../hooks";
import type { Coverage, IntakeUnit } from "../types";
import { getMedDisplayName, isLiquidContainerPackageType, isTubePackageType } from "../types";
import { buildClearMissedPayload, isDoseDismissed } from "../utils/schedule";

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// Helper function to get stock status based on thresholds
function getStockStatus(
	daysLeft: number | null,
	medsLeft: number,
	settings: { lowStockDays: number; normalStockDays: number; highStockDays: number; reminderDaysBefore: number },
	packageType?: string
) {
	if (isTubePackageType(packageType)) return { className: "success", label: "status.noSchedule" };
	// Only a real zero-or-below stock count is out of stock.
	if (medsLeft <= 0) return { className: "danger", label: "status.outOfStock" };
	// No schedule, but has stock = normal
	if (daysLeft === null) return { className: "success", label: "status.noSchedule" };
	if (isLiquidContainerPackageType(packageType)) {
		const lowDays = Math.max(1, Math.floor(settings.reminderDaysBefore));
		const criticalDays = Math.max(1, Math.ceil(lowDays / 2));
		if (daysLeft <= criticalDays) return { className: "danger", label: "status.criticalStock" };
		if (daysLeft <= lowDays) return { className: "warning", label: "status.lowStock" };
		return { className: "success", label: "status.normal" };
	}
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
	settings: { lowStockDays: number; normalStockDays: number; highStockDays: number; reminderDaysBefore: number },
	meds: Array<{ name: string; genericName?: string | null; packageType?: string }>
): string {
	let worstLevel = 3; // 3=success, 2=warning, 1=danger
	for (const item of dayMeds) {
		const cov = coverageByMed[item.medName];
		if (!cov) continue;
		const med = meds.find((m) => getMedDisplayName(m) === item.medName);
		const status = getStockStatus(cov.daysLeft, cov.medsLeft, settings, med?.packageType);
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
	const { user, authFetch } = useAuth();
	const { showFeedback } = useFeedback();
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
		isDoseTakenAutomatically,
		dismissedDoses,
		markDoseTaken,
		skippedDoses,
		markDoseSkipped,
		undoDoseTaken,
		undoDoseSkipped,
		coverageByMed,
		depletionByMed,
		manuallyExpandedDays,
		toggleDayCollapse,
		openUserFilter,
		missedPastDoseIds,
		loadMeds,
		journalEditorOpen,
		journalHistoryOpen,
		journalEvent,
		journalEventLoading,
		journalEventSaving,
		journalEventDeleting,
		journalEventError,
		journalHistoryEntries,
		journalHistoryFilters,
		journalHistoryLoading,
		journalHistoryError,
		openJournalEditor,
		closeJournalEditor,
		saveJournalNote,
		deleteJournalNote,
		openJournalHistory,
		closeJournalHistory,
		setJournalHistoryFilters,
		reloadJournalHistory,
		reopenJournalHistoryEntry,
	} = useScheduleController();
	const [showClearMissedConfirm, setShowClearMissedConfirm] = useState(false);
	const [clearingMissed, setClearingMissed] = useState(false);
	const [showObsoleteConfirm, setShowObsoleteConfirm] = useState(false);
	const [obsoleteCandidate, setObsoleteCandidate] = useState<{ id: number; name: string } | null>(null);

	const closeClearMissedConfirm = useCallback(() => {
		if (!clearingMissed) {
			setShowClearMissedConfirm(false);
		}
	}, [clearingMissed]);

	const closeObsoleteConfirm = useCallback(() => {
		setShowObsoleteConfirm(false);
		setObsoleteCandidate(null);
	}, []);

	useModalHistory(showClearMissedConfirm, "schedule-clear-missed", closeClearMissedConfirm);
	useModalHistory(showObsoleteConfirm, "schedule-obsolete", closeObsoleteConfirm);

	const isDoseTakenForDisplay = (doseId: string) => takenDoses.has(doseId);

	const shouldHideNoScheduleStatusForTube = (
		med: (typeof meds)[number] | undefined,
		status: { className: string; label: string } | null
	) => isTubePackageType(med?.packageType) && status?.label === "status.noSchedule";

	const clearMissedDoses = async (missedCount: number) => {
		const payload = buildClearMissedPayload(pastDays, meds, takenDoses, dismissedDoses);
		if (payload.medicationIds.length === 0 || !payload.until) {
			setShowClearMissedConfirm(false);
			return;
		}

		setClearingMissed(true);
		try {
			const res = await authFetch("/api/medications/dismiss-until", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			await loadMeds();
			setShowClearMissedConfirm(false);
			showFeedback({
				message: t("dashboard.schedules.clearMissedSuccess", { count: missedCount }),
				tone: "success",
			});
		} catch {
			showFeedback({ message: t("common.saveFailed"), tone: "error" });
		} finally {
			setClearingMissed(false);
		}
	};

	const handleSaveJournalNote = async (note: string) => {
		return saveJournalNote(note);
	};

	const handleDeleteJournalNote = async () => {
		const deleted = await deleteJournalNote();
		if (deleted) {
			closeJournalEditor();
		}
	};

	const handleResetJournalFilters = () => {
		setJournalHistoryFilters({
			medicationId: null,
			from: "",
			to: "",
			limit: 100,
		});
	};

	const requestMarkObsolete = (med: { id: number; name: string }) => {
		setObsoleteCandidate(med);
		setShowObsoleteConfirm(true);
	};

	const handleConfirmMarkObsolete = async () => {
		if (!obsoleteCandidate) return;
		try {
			const res = await authFetch(`/api/medications/${obsoleteCandidate.id}/obsolete`, {
				method: "POST",
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await loadMeds();
			setShowObsoleteConfirm(false);
			setObsoleteCandidate(null);
		} catch {
			showFeedback({ message: t("common.saveFailed"), tone: "error" });
		}
	};

	const handleCancelMarkObsolete = () => {
		closeObsoleteConfirm();
	};

	const formatDoseUsageLabel = (
		med: (typeof meds)[number] | undefined,
		usage: number,
		intakeUnit?: IntakeUnit | null
	) => formatScheduleDoseUsageLabel(med, usage, t, intakeUnit);

	const formatTotalUsageLabel = (
		med: (typeof meds)[number] | undefined,
		total: number,
		doses?: Array<{ usage: number; intakeUnit?: IntakeUnit | null }>
	) => formatScheduleTotalUsageLabel(med, total, t, doses);

	const renderDoseSummary = (
		med: (typeof meds)[number] | undefined,
		dose: { timeStr: string; usage: number; intakeUnit?: IntakeUnit | null; intakeRemindersEnabled: boolean }
	) => (
		<>
			<span className="dose-time">{dose.timeStr}</span>
			<span className="dose-usage">
				<span className="dose-usage-main">{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}</span>
				{med?.pillWeightMg && (
					<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
				)}
			</span>
			{dose.intakeRemindersEnabled && (
				<span className="reminder-icon info-tooltip" data-tooltip={t("tooltips.intakeReminders")}>
					<Bell size={14} aria-hidden="true" />
				</span>
			)}
		</>
	);

	const renderDoseActionButtons = (options: {
		doseId: string;
		isTaken: boolean;
		isSkipped: boolean;
		isAutomaticallyTaken: boolean;
		isEmpty: boolean;
	}) => {
		const journalUnavailable = !(options.isTaken || options.isSkipped);
		const takeButton = options.isTaken ? (
			<button className="dose-btn undo take" onClick={() => undoDoseTaken(options.doseId)} title={t("common.undo")}>
				{options.isAutomaticallyTaken && (
					<span className="info-tooltip" data-tooltip={t("tooltips.automaticTaken")}>
						🤖
					</span>
				)}
				<span className="dose-btn-label">{t("common.undo")}</span>
				<span aria-hidden="true">↩</span>
			</button>
		) : (
			<button
				className={`dose-btn take${options.isEmpty ? " out-of-stock" : ""}`}
				onClick={() => markDoseTaken(options.doseId)}
				disabled={options.isEmpty || options.isSkipped}
				title={options.isEmpty ? t("common.outOfStockTakeBlocked") : t("dose.markAsTaken")}
			>
				<span className="dose-btn-label">{t("dose.take")}</span>
				<span aria-hidden="true">{options.isEmpty ? "⊘" : "✓"}</span>
			</button>
		);

		const skipButton = options.isSkipped ? (
			<button className="dose-btn undo skip" onClick={() => undoDoseSkipped(options.doseId)} title={t("common.undo")}>
				<span className="dose-btn-label">{t("common.undo")}</span>
				<span aria-hidden="true">↩</span>
			</button>
		) : (
			<button
				className="dose-btn skip"
				onClick={() => markDoseSkipped(options.doseId)}
				title={t("dose.markAsSkipped")}
				disabled={options.isTaken}
			>
				<span className="dose-btn-label">{t("dose.skip")}</span>
			</button>
		);

		const journalButton = (
			<span
				className={journalUnavailable ? "tooltip-trigger" : undefined}
				data-tooltip={journalUnavailable ? t("journal.actions.noteTakenOnly") : undefined}
			>
				<button
					type="button"
					className="dose-btn journal"
					onClick={() => {
						if (!journalUnavailable) {
							void openJournalEditor(options.doseId);
						}
					}}
					title={!journalUnavailable ? t("journal.actions.note") : undefined}
					disabled={journalUnavailable}
				>
					<NotebookPen size={14} aria-hidden="true" />
					<span className="dose-btn-label">{t("journal.actions.note")}</span>
				</button>
			</span>
		);

		return (
			<>
				{takeButton}
				{skipButton}
				{journalButton}
			</>
		);
	};

	return (
		<section className="grid">
			<article className="card schedule-full">
				<div className="card-head">
					<h2>{t("dashboard.schedules.title")}</h2>
					<div className="card-head-actions">
						<select
							className="select-field schedule-days-select"
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
						<button
							type="button"
							className="ghost journal-history-button"
							onClick={openJournalHistory}
							aria-label={t("journal.actions.history")}
							title={t("journal.actions.history")}
						>
							<ClipboardList size={16} aria-hidden="true" />
							<span className="journal-history-label-full">{t("journal.actions.history")}</span>
							<span className="journal-history-label-short">{t("journal.actions.historyShort")}</span>
						</button>
					</div>
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
							const allReallyTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
							const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;

							// Count missed doses that are NOT dismissed (for warning icon)
							const missedNotDismissedCount = day.meds.reduce((count, item) => {
								const med = meds.find((m) => getMedDisplayName(m) === item.medName);
								const dismissedUntilDate = med?.dismissedUntil ?? undefined;
								return (
									count +
									item.doses.reduce((doseCount, d) => {
										if (isDoseDismissed(d.id, dismissedUntilDate)) return doseCount;
										const takenByArray = Array.isArray(d.takenBy) ? d.takenBy : [];
										const ids = takenByArray.length > 0 ? takenByArray.map((p) => `${d.id}-${p}`) : [d.id];
										return doseCount + ids.filter((id) => !isDoseTakenForDisplay(id) && !dismissedDoses.has(id)).length;
									}, 0)
								);
							}, 0);
							const hasRealMissed = missedNotDismissedCount > 0;

							const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
							const isCollapsed = !isManuallyExpanded;
							const _worstStatus = getDayStockStatus(day.meds, coverageByMed, settings, meds);

							return (
								<div
									key={day.dateStr}
									className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allReallyTaken ? "all-taken" : allDoseIds.length > 0 ? "past-missed" : ""}`}
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
											const med = meds.find((m) => getMedDisplayName(m) === item.medName);
											const medCov = coverageByMed[item.medName];
											const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
											const rawStatus = medCov
												? getStockStatus(medCov.daysLeft, medCov.medsLeft, settings, med?.packageType)
												: null;
											const visibleStatus = shouldHideNoScheduleStatusForTube(med, rawStatus) ? null : rawStatus;
											const isLowStock = !isEmpty && visibleStatus?.className === "warning";
											const rowClasses = ["time-row"];
											if (isEmpty) rowClasses.push("med-empty");
											else if (isLowStock) rowClasses.push("med-low");
											return (
												<div key={`${day.dateStr}-${item.medName}`} className={rowClasses.join(" ")}>
													<div className="time-main">
														<div className="med-name">
															<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
															<span className="med-name-text">{item.medName}</span>
														</div>
														<div className="tag-row">
															<ScheduleUsageTag>{formatTotalUsageLabel(med, item.total, item.doses)}</ScheduleUsageTag>
														</div>
													</div>
													<div className="doses-col">
														{item.doses.map((dose) => {
															// If no takenBy, show single checkbox; otherwise show one per person
															const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
															const allTaken = people.every((person) =>
																isDoseTakenForDisplay(getDoseId(dose.id, person))
															);
															const doseClasses = ["dose-item", "past"];
															if (allTaken) doseClasses.push("all-taken");
															if (isEmpty) doseClasses.push("med-empty");
															else if (isLowStock) doseClasses.push("med-low");
															return (
																<div key={dose.id} className={doseClasses.join(" ")}>
																	{renderDoseSummary(med, dose)}{" "}
																	<div className="dose-checks">
																		{people.map((person) => {
																			const doseId = getDoseId(dose.id, person);
																			const isTaken = isDoseTakenForDisplay(doseId);
																			const isSkipped = skippedDoses.has(doseId);
																			const isAutomaticallyTaken =
																				isTaken && isDoseTakenAutomatically(doseId) && dose.when <= Date.now();
																			const personClasses = ["dose-person"];
																			if (isTaken) personClasses.push("taken");
																			if (isSkipped) personClasses.push("skipped");
																			return (
																				<div key={doseId} className={personClasses.join(" ")}>
																					{person && (
																						<span
																							className="person-name clickable"
																							onClick={() => openUserFilter(person)}
																							onKeyDown={(e) => {
																								if (e.key === "Enter" || e.key === " ") openUserFilter(person);
																							}}
																						>
																							{person}
																						</span>
																					)}
																					{renderDoseActionButtons({
																						doseId,
																						isTaken,
																						isSkipped,
																						isAutomaticallyTaken,
																						isEmpty,
																					})}
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
											if (e.key === "Enter" || e.key === " ") {
												const wasCollapsed = !showPastDays;
												setShowPastDays(!showPastDays);
												if (wasCollapsed) {
													setTimeout(() => {
														document
															.querySelector(".day-block.today")
															?.scrollIntoView({ behavior: "smooth", block: "center" });
													}, 50);
												}
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
									{missedCount > 0 && (
										<button type="button" className="clear-missed-btn" onClick={() => setShowClearMissedConfirm(true)}>
											{t("dashboard.schedules.clearMissed")}
										</button>
									)}
								</div>
							);
						})()}
					{showClearMissedConfirm && (
						<ConfirmModal
							title={t("dashboard.schedules.clearMissedConfirmTitle")}
							message={t("dashboard.schedules.clearMissedConfirmMessage", {
								count: missedPastDoseIds.length,
							})}
							confirmLabel={t("dashboard.schedules.clearMissedConfirm")}
							cancelLabel={t("dashboard.schedules.clearMissedCancel")}
							onConfirm={() => void clearMissedDoses(missedPastDoseIds.length)}
							onCancel={closeClearMissedConfirm}
							isLoading={clearingMissed}
							confirmVariant="warning"
						/>
					)}
					{showObsoleteConfirm && obsoleteCandidate && (
						<ConfirmModal
							title={t("medications.obsoleteModal.title")}
							message={t("medications.obsoleteModal.message", { name: obsoleteCandidate.name })}
							confirmLabel={t("medications.list.markObsolete")}
							cancelLabel={t("common.cancel")}
							onConfirm={() => void handleConfirmMarkObsolete()}
							onCancel={handleCancelMarkObsolete}
							confirmVariant="warning"
						/>
					)}
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
									const med = meds.find((m) => getMedDisplayName(m) === item.medName);
									const depletionTime = depletionByMed[item.medName];
									// Check if this dose is scheduled after medication runs out
									const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
									const status = willBeOutOfStock
										? { className: "danger", label: "status.outOfStock" }
										: medCoverage
											? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings, med?.packageType)
											: null;
									const visibleStatus = shouldHideNoScheduleStatusForTube(med, status) ? null : status;
									const isLowStock = !isEmpty && visibleStatus?.className === "warning";
									const rowClasses = ["time-row"];
									if (isEmpty) rowClasses.push("med-empty");
									else if (isLowStock) rowClasses.push("med-low");
									return (
										<div key={`${day.dateStr}-${item.medName}`} className={rowClasses.join(" ")}>
											<div className="time-main">
												<div className="med-name">
													<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
													<span className="med-name-text">{item.medName}</span>
												</div>
												<div className="tag-row">
													<ScheduleUsageTag>{formatTotalUsageLabel(med, item.total, item.doses)}</ScheduleUsageTag>
													{visibleStatus && (
														<span className={`tag ${visibleStatus.className}`}>{t(visibleStatus.label)}</span>
													)}
												</div>
												{isEmpty && med && !med.isObsolete && (
													<div className="timeline-obsolete-row">
														<button
															type="button"
															className="timeline-obsolete-btn btn-obsolete"
															onClick={() => requestMarkObsolete({ id: med.id, name: getMedDisplayName(med) })}
														>
															<Archive size={16} aria-hidden="true" />
															<span>{t("medications.list.markObsolete")}</span>
														</button>
													</div>
												)}
											</div>
											<div className="doses-col">
												{item.doses.map((dose) => {
													const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
													const now = Date.now();
													const dayStart = new Date(day.date).setHours(0, 0, 0, 0);
													const isPastDay = dayStart < new Date().setHours(0, 0, 0, 0);
													const allTaken = people.every((person) => isDoseTakenForDisplay(getDoseId(dose.id, person)));
													const doseClasses = ["dose-item"];
													if (allTaken) doseClasses.push("all-taken");
													if (isEmpty) doseClasses.push("med-empty");
													else if (isLowStock) doseClasses.push("med-low");
													return (
														<div key={dose.id} className={doseClasses.join(" ")}>
															{renderDoseSummary(med, dose)}
															<div className="dose-checks">
																{people.map((person) => {
																	const doseId = getDoseId(dose.id, person);
																	const isTaken = isDoseTakenForDisplay(doseId);
																	const isSkipped = skippedDoses.has(doseId);
																	const isAutomaticallyTaken =
																		isTaken && isDoseTakenAutomatically(doseId) && dose.when <= now;
																	const isOverdue = !isTaken && !isSkipped && !isEmpty && dose.when < now && !isPastDay;
																	const personClasses = ["dose-person"];
																	if (isTaken) personClasses.push("taken");
																	if (isSkipped) personClasses.push("skipped");
																	if (isOverdue) personClasses.push("overdue");
																	return (
																		<div key={doseId} className={personClasses.join(" ")}>
																			{person && (
																				<span
																					className="person-name clickable"
																					onClick={() => openUserFilter(person)}
																					onKeyDown={(e) => {
																						if (e.key === "Enter" || e.key === " ") openUserFilter(person);
																					}}
																				>
																					{person}
																				</span>
																			)}
																			{renderDoseActionButtons({
																				doseId,
																				isTaken,
																				isSkipped,
																				isAutomaticallyTaken,
																				isEmpty,
																			})}
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
				<IntakeJournalModal
					isOpen={journalEditorOpen}
					entry={journalEvent}
					isLoading={journalEventLoading}
					isSaving={journalEventSaving}
					isDeleting={journalEventDeleting}
					error={journalEventError}
					onClose={closeJournalEditor}
					onSave={handleSaveJournalNote}
					onDelete={handleDeleteJournalNote}
				/>
				<IntakeJournalHistoryModal
					isOpen={journalHistoryOpen}
					entries={journalHistoryEntries}
					filters={journalHistoryFilters}
					medications={meds}
					isLoading={journalHistoryLoading}
					error={journalHistoryError}
					onClose={closeJournalHistory}
					onFilterChange={setJournalHistoryFilters}
					onReload={reloadJournalHistory}
					onResetFilters={handleResetJournalFilters}
					onReopen={reopenJournalHistoryEntry}
				/>
			</article>
		</section>
	);
}
