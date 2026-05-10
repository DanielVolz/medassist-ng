/* biome-ignore-all lint/style/noNestedTernary: timeline rendering uses explicit UI-state branching */
import { Archive, Bell, ClipboardList, NotebookPen, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ConfirmModal, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { DashboardReminderSection } from "../components/dashboard/DashboardReminderSection";
import { DashboardStatusSection } from "../components/dashboard/DashboardStatusSection";
import { useAppContext } from "../context";
import {
	allowsPillFormSelection,
	getMedDisplayName,
	type IntakeUnit,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
} from "../types";
import { formatNumber, getExpiryClass, getSystemLocale } from "../utils/formatters";
import { getIntakeDailyRate, getMedicationIntakes } from "../utils/intake-schedule";
import { convertLiquidUsageToMl, getLiquidCountUnitLabel } from "../utils/intake-units";
import { buildClearMissedPayload, expandDoseIds, getStockStatus, isDoseDismissed } from "../utils/schedule";
import {
	formatFullBlisters,
	formatOpenBlisterAndLoose,
	getBlisterStock,
	getMedTotal,
	getReminderStatusData,
	userStorageKey,
} from "./dashboard-helpers";

function getRouteDateKey(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getMedicationIdFromNotificationDoseId(doseId: string | null): string | null {
	if (!doseId) {
		return null;
	}

	const [rawMedicationId] = doseId.split("-");
	return rawMedicationId?.trim() ? rawMedicationId : null;
}

function findFocusTargetElement(doseId: string | null, medId: string | null): HTMLElement | null {
	if (doseId) {
		const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-dose-id]"));
		const doseElement = elements.find((element) => element.dataset.doseId === doseId);
		if (doseElement) {
			return doseElement.closest<HTMLElement>("[data-med-id]") ?? doseElement;
		}
	}

	if (medId) {
		const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-med-id]"));
		return elements.find((element) => element.dataset.medId === medId) ?? null;
	}

	return null;
}

function getDosePeople(takenBy: unknown): Array<string | null> {
	const takenByArray = Array.isArray(takenBy) ? takenBy : [];
	return takenByArray.length > 0 ? takenByArray : [null];
}

export function DashboardPage() {
	const { t, i18n } = useTranslation();
	const { user } = useAuth();
	const location = useLocation();
	const {
		meds,
		loading,
		settings,
		settingsLoading,
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
		skippedDoses,
		dismissedDoses,
		markDoseTaken,
		markDoseSkipped,
		undoDoseTaken,
		undoDoseSkipped,
		manuallyCollapsedDays,
		manuallyExpandedDays,
		toggleDayCollapse,
		missedPastDoseIds,
		getDayStockStatus,
		getDoseId,
		isDoseTakenAutomatically,
		openMedDetail,
		openUserFilter,
		openShareDialog,
		openScheduleLightbox,
		stockThresholds,
		loadMeds,
		loadSettings,
	} = useAppContext();
	const [showClearMissedConfirm, setShowClearMissedConfirm] = useState(false);
	const [clearingMissed, setClearingMissed] = useState(false);
	const [showObsoleteConfirm, setShowObsoleteConfirm] = useState(false);
	const [obsoleteCandidate, setObsoleteCandidate] = useState<{ id: number; name: string } | null>(null);
	const notificationFocusAppliedRef = useRef<string | null>(null);

	const isDoseTakenForDisplay = useCallback((doseId: string) => takenDoses.has(doseId), [takenDoses]);

	const notificationTarget = useMemo(() => {
		const params = new URLSearchParams(location.search);
		const date = params.get("day")?.trim() ?? params.get("date")?.trim() ?? "";
		const doseId = params.get("dose")?.trim() ?? params.get("doseId")?.trim() ?? "";
		const medId =
			params.get("med")?.trim() ?? params.get("medId")?.trim() ?? getMedicationIdFromNotificationDoseId(doseId) ?? "";
		if (!date && !doseId && !medId) {
			return null;
		}

		return {
			date: date || null,
			doseId: doseId || null,
			medId: medId || null,
			key: `${date}|${doseId}|${medId}`,
		};
	}, [location.search]);

	const targetDayState = useMemo(() => {
		if (!notificationTarget?.date) {
			return null;
		}

		const todayDateKey = todayDay ? getRouteDateKey(todayDay.date) : null;
		if (todayDay && todayDateKey === notificationTarget.date) {
			const allDoseIds = todayDay.meds.flatMap((item) => expandDoseIds(item.doses));
			const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
			const isAutoCollapsed = allDayTaken;
			const isManuallyExpanded = manuallyExpandedDays.has(todayDay.dateStr);
			const isManuallyCollapsed = manuallyCollapsedDays.has(todayDay.dateStr);
			const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;
			return { day: todayDay, isAutoCollapsed, isCollapsed, section: "today" as const };
		}

		const pastDay = pastDays.find((day) => getRouteDateKey(day.date) === notificationTarget.date);
		if (pastDay) {
			const isAutoCollapsed = true;
			const isCollapsed = !manuallyExpandedDays.has(pastDay.dateStr);
			return { day: pastDay, isAutoCollapsed, isCollapsed, section: "past" as const };
		}

		const futureDay = futureDays.find((day) => getRouteDateKey(day.date) === notificationTarget.date);
		if (futureDay) {
			const isAutoCollapsed = true;
			const isCollapsed = !manuallyExpandedDays.has(futureDay.dateStr);
			return { day: futureDay, isAutoCollapsed, isCollapsed, section: "future" as const };
		}

		return null;
	}, [
		notificationTarget,
		todayDay,
		pastDays,
		futureDays,
		manuallyExpandedDays,
		manuallyCollapsedDays,
		isDoseTakenForDisplay,
	]);

	useEffect(() => {
		if (!notificationTarget || !targetDayState) {
			return;
		}

		if (targetDayState.section === "past" && !showPastDays) {
			setShowPastDays(true);
		}

		if (targetDayState.section === "future" && !showFutureDays) {
			setShowFutureDays(true);
		}

		if (targetDayState.isCollapsed) {
			toggleDayCollapse(targetDayState.day.dateStr, targetDayState.isAutoCollapsed);
		}
	}, [
		notificationTarget,
		targetDayState,
		setShowPastDays,
		setShowFutureDays,
		showPastDays,
		showFutureDays,
		toggleDayCollapse,
	]);

	useEffect(() => {
		if (!notificationTarget) {
			notificationFocusAppliedRef.current = null;
			return;
		}

		if (loading || settingsLoading) {
			return;
		}

		if (!targetDayState) {
			return;
		}

		if (notificationFocusAppliedRef.current === notificationTarget.key) {
			return;
		}

		let correctionTimerId: number | null = null;

		const scrollTargetIntoView = () => {
			const targetElement = findFocusTargetElement(notificationTarget.doseId, notificationTarget.medId);

			if (!targetElement) {
				return false;
			}

			targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
			return true;
		};

		const frameId = requestAnimationFrame(() => {
			if (!scrollTargetIntoView()) {
				return;
			}

			correctionTimerId = window.setTimeout(() => {
				if (!scrollTargetIntoView()) {
					return;
				}

				notificationFocusAppliedRef.current = notificationTarget.key;
			}, 220);
		});

		return () => {
			cancelAnimationFrame(frameId);
			if (correctionTimerId !== null) {
				window.clearTimeout(correctionTimerId);
			}
		};
	}, [notificationTarget, targetDayState, loading, settingsLoading]);

	// Get structured reminder data
	const reminderData = getReminderStatusData(
		settings.reminderDaysBefore,
		settings.lowStockDays,
		coverage.low,
		coverage.all,
		meds,
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
	const prescriptionRemindersEnabled =
		(settings.emailEnabled && settings.emailPrescriptionReminders) ||
		(settings.shoutrrrEnabled && settings.shoutrrrPrescriptionReminders);

	const prescriptionLowMeds = meds
		.filter((med) => {
			if (!med.prescriptionEnabled) return false;
			const remaining = med.prescriptionRemainingRefills ?? 0;
			const threshold = med.prescriptionLowRefillThreshold ?? 1;
			return remaining <= threshold;
		})
		.map((med) => ({
			id: med.id,
			name: getMedDisplayName(med),
			remainingRefills: med.prescriptionRemainingRefills ?? 0,
			threshold: med.prescriptionLowRefillThreshold ?? 1,
		}))
		.sort((a, b) => a.remainingRefills - b.remainingRefills);

	const anyRemindersEnabled = stockRemindersEnabled || intakeRemindersEnabled || prescriptionRemindersEnabled;
	const remindersLoading = loading || settingsLoading;
	const showOnlyToday = settings.upcomingTodayOnly;

	const prescriptionEmptyCount = prescriptionLowMeds.filter((med) => med.remainingRefills <= 0).length;

	const clearMissedDoses = async (missedCount: number) => {
		const payload = buildClearMissedPayload(pastDays, meds, takenDoses, dismissedDoses);
		if (payload.medicationIds.length === 0 || !payload.until) {
			setShowClearMissedConfirm(false);
			return;
		}

		setClearingMissed(true);
		try {
			const res = await fetch("/api/medications/dismiss-until", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			await loadMeds();
			setShowClearMissedConfirm(false);
			alert(t("dashboard.schedules.clearMissedSuccess", { count: missedCount }));
		} catch {
			alert(t("common.saveFailed"));
		} finally {
			setClearingMissed(false);
		}
	};

	const renderDoseActionButtons = (options: {
		doseId: string;
		isTaken: boolean;
		isSkipped: boolean;
		isAutomaticallyTaken: boolean;
		isEmpty: boolean;
	}) => {
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
				title={options.isEmpty ? t("common.outOfStockTakeBlocked") : t("dose.markAsTaken")}
				disabled={options.isEmpty || options.isSkipped}
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

		return (
			<>
				{takeButton}
				{skipButton}
			</>
		);
	};

	const requestMarkObsolete = (med: { id: number; name: string }) => {
		setObsoleteCandidate(med);
		setShowObsoleteConfirm(true);
	};

	const handleConfirmMarkObsolete = async () => {
		if (!obsoleteCandidate) return;
		try {
			const res = await fetch(`/api/medications/${obsoleteCandidate.id}/obsolete`, {
				method: "POST",
				credentials: "include",
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await loadMeds();
			setShowObsoleteConfirm(false);
			setObsoleteCandidate(null);
		} catch {
			alert(t("common.saveFailed"));
		}
	};

	const handleCancelMarkObsolete = () => {
		setShowObsoleteConfirm(false);
		setObsoleteCandidate(null);
	};

	const getTubeUnitLabel = (med: (typeof meds)[number] | undefined, value: number) =>
		isLiquidContainerPackageType(med?.packageType) || med?.medicationForm === "liquid"
			? t("form.packageAmountUnitMl")
			: t("form.blisters.applications", { count: Math.abs(value) });

	const getTubeStockUnitLabel = () => t("form.packageAmountUnitG");

	const formatStockLabel = (med: (typeof meds)[number] | undefined, medsLeft: number) => {
		if (isLiquidContainerPackageType(med?.packageType)) {
			return `${formatNumber(medsLeft)} ${t("form.packageAmountUnitMl")}`;
		}
		if (isTubePackageType(med?.packageType)) {
			return `${formatNumber(medsLeft)} ${getTubeStockUnitLabel()}`;
		}
		return t("table.pillsCount", { count: Math.round(medsLeft) });
	};

	const formatLiquidUsageLabel = (usage: number, unit: IntakeUnit | null | undefined): string => {
		const normalizedUsage = Number(usage);
		if (!Number.isFinite(normalizedUsage) || normalizedUsage <= 0) {
			return `0 ${t("form.packageAmountUnitMl")}`;
		}

		if (unit === "ml" || unit == null) {
			return `${formatNumber(normalizedUsage)} ${t("form.packageAmountUnitMl")}`;
		}

		const mlTotal = convertLiquidUsageToMl(normalizedUsage, unit);
		return `${formatNumber(normalizedUsage)} ${getLiquidCountUnitLabel(unit, normalizedUsage, t)} ${formatNumber(mlTotal)} ${t("form.packageAmountUnitMl")}`;
	};

	const formatDoseUsageLabel = (
		med: (typeof meds)[number] | undefined,
		usage: number,
		intakeUnit?: IntakeUnit | null
	) => {
		if (isLiquidContainerPackageType(med?.packageType)) {
			return formatLiquidUsageLabel(usage, intakeUnit);
		}
		if (isTubePackageType(med?.packageType)) {
			return `${usage} ${getTubeUnitLabel(med, usage)}`;
		}
		return `${usage} ${usage !== 1 ? t("common.pills") : t("common.pill")}`;
	};

	const formatTotalUsageLabel = (
		med: (typeof meds)[number] | undefined,
		total: number,
		intakeUnit?: IntakeUnit | null,
		doses?: Array<{ usage: number; intakeUnit?: IntakeUnit | null }>
	) => {
		if (isLiquidContainerPackageType(med?.packageType)) {
			if (doses && doses.length > 0) {
				const normalizedDoses = doses.filter((dose) => Number.isFinite(Number(dose.usage)) && Number(dose.usage) > 0);
				if (normalizedDoses.length > 0) {
					const allUnits = new Set(normalizedDoses.map((dose) => dose.intakeUnit ?? "ml"));
					const totalMl = normalizedDoses.reduce(
						(sum, dose) => sum + convertLiquidUsageToMl(Number(dose.usage), dose.intakeUnit ?? "ml"),
						0
					);

					if (allUnits.size === 1) {
						const onlyUnit = normalizedDoses[0]?.intakeUnit ?? "ml";
						const totalUsageInUnit = normalizedDoses.reduce((sum, dose) => sum + Number(dose.usage), 0);
						return formatLiquidUsageLabel(totalUsageInUnit, onlyUnit);
					}

					return `${formatNumber(totalMl)} ${t("form.packageAmountUnitMl")}`;
				}
			}

			return formatLiquidUsageLabel(total, intakeUnit);
		}
		if (isTubePackageType(med?.packageType)) {
			return `${total} ${getTubeUnitLabel(med, total)}`;
		}
		return t("common.pillsTotal", { count: total });
	};

	const formatDailyConsumption = (med: (typeof meds)[number] | undefined) => {
		if (!med) return "-";

		const intakes = getMedicationIntakes(med);

		if (intakes.length === 0) return "-";

		let dailyTotal = 0;
		for (const intake of intakes) {
			const usage = Number(intake.usage);
			if (!Number.isFinite(usage) || usage <= 0) continue;

			const hasPerIntakeTakenBy = typeof intake.takenBy === "string" && intake.takenBy.trim().length > 0;
			const personMultiplier = hasPerIntakeTakenBy ? 1 : Math.max(1, med.takenBy?.length ?? 0);
			const normalizedUsage = usage * personMultiplier * getIntakeDailyRate(intake);

			if (isLiquidContainerPackageType(med.packageType)) {
				dailyTotal += convertLiquidUsageToMl(normalizedUsage, intake.intakeUnit ?? "ml");
			} else {
				dailyTotal += normalizedUsage;
			}
		}

		if (dailyTotal <= 0) return "-";

		if (isLiquidContainerPackageType(med.packageType)) {
			return t("table.perDayWithUnit", { value: formatNumber(dailyTotal), unit: t("form.packageAmountUnitMl") });
		}

		if (isTubePackageType(med.packageType)) {
			const tubeUnit =
				med.medicationForm === "liquid"
					? t("form.packageAmountUnitMl")
					: t("form.blisters.applications", { count: Math.abs(dailyTotal) });
			return t("table.perDayWithUnit", { value: formatNumber(dailyTotal), unit: tubeUnit });
		}

		const pillUnit = dailyTotal === 1 ? t("common.pill") : t("common.pills");
		return t("table.perDayWithUnit", { value: formatNumber(dailyTotal), unit: pillUnit });
	};

	const shouldHideNoScheduleStatusForTube = (
		med: (typeof meds)[number] | undefined,
		status: { className: string; label: string } | null
	) => isTubePackageType(med?.packageType) && status?.label === "status.noSchedule";

	const getVisibleStockStatus = (
		med: (typeof meds)[number] | undefined,
		status: { className: string; label: string } | null
	) => (shouldHideNoScheduleStatusForTube(med, status) ? null : status);

	const getMedByName = (name: string) => meds.find((m) => getMedDisplayName(m) === name);

	const prescriptionStatus =
		prescriptionRemindersEnabled && prescriptionLowMeds.length > 0
			? {
					text:
						prescriptionEmptyCount > 0
							? t("dashboard.reminders.prescriptionCriticalMeds", { count: prescriptionEmptyCount })
							: t("dashboard.reminders.prescriptionLowMeds", { count: prescriptionLowMeds.length }),
					className: prescriptionEmptyCount > 0 ? "danger" : "warning",
				}
			: null;

	// Manual reminder send state
	const [sendingReminder, setSendingReminder] = useState(false);
	const [reminderResult, setReminderResult] = useState<{ success: boolean; message: string } | null>(null);

	async function sendManualReminder() {
		const sendableStock = stockRemindersEnabled && reminderData.lowStockMeds.length > 0;
		const sendablePrescription = prescriptionRemindersEnabled && prescriptionLowMeds.length > 0;
		if (!sendableStock && !sendablePrescription) return;

		setSendingReminder(true);
		setReminderResult(null);

		try {
			const messages: string[] = [];
			const errors: string[] = [];

			if (sendableStock) {
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

				const stockRes = await fetch("/api/reminder/send-email", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({
						email: settings.notificationEmail,
						lowStock,
					}),
				});
				const stockData = await stockRes.json();
				if (stockRes.ok) {
					messages.push(stockData.message || t("common.sent"));
				} else {
					errors.push(stockData.error || t("common.sendFailed"));
				}
			}

			if (sendablePrescription) {
				const prescriptionLow = prescriptionLowMeds.map((med) => {
					const fullMed = meds.find((m) => m.id === med.id);
					return {
						name: med.name,
						remainingRefills: med.remainingRefills,
						threshold: med.threshold,
						expiryDate: fullMed?.prescriptionExpiryDate ?? null,
					};
				});

				const prescriptionRes = await fetch("/api/reminder/send-prescription", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({
						email: settings.notificationEmail,
						prescriptionLow,
					}),
				});
				const prescriptionData = await prescriptionRes.json();
				if (prescriptionRes.ok) {
					messages.push(prescriptionData.message || t("common.sent"));
				} else {
					errors.push(prescriptionData.error || t("common.sendFailed"));
				}
			}

			if (messages.length > 0) {
				setReminderResult({ success: true, message: messages.join(" • ") });
				loadSettings();
			} else {
				setReminderResult({ success: false, message: errors.join(" • ") || t("common.sendFailed") });
			}
		} catch {
			setReminderResult({ success: false, message: t("common.networkError") });
		}
		setSendingReminder(false);
	}

	return (
		<>
			<DashboardReminderSection
				t={t}
				remindersLoading={remindersLoading}
				anyRemindersEnabled={anyRemindersEnabled}
				stockRemindersEnabled={stockRemindersEnabled}
				intakeRemindersEnabled={intakeRemindersEnabled}
				prescriptionRemindersEnabled={prescriptionRemindersEnabled}
				reminderData={reminderData}
				prescriptionLowMeds={prescriptionLowMeds}
				prescriptionStatus={prescriptionStatus}
				meds={meds}
				coverage={coverage}
				stockThresholds={stockThresholds}
				sendingReminder={sendingReminder}
				reminderResult={reminderResult}
				onSendManualReminder={sendManualReminder}
				onOpenMedicationDetail={openMedDetail}
			/>

			<DashboardStatusSection
				t={t}
				show={!remindersLoading && !anyRemindersEnabled}
				meds={meds}
				coverage={coverage}
				stockThresholds={stockThresholds}
				onOpenMedicationDetail={openMedDetail}
			/>

			<div
				className={`dashboard-main-sections${settings.swapDashboardMainSections ? " dashboard-main-sections-swapped" : ""}`}
			>
				<section className="grid dashboard-overview-section">
					<article className="card">
						<div className="card-head">
							<h2>{t("dashboard.overview.title")}</h2>
						</div>
						{loading ? (
							<div className="dashboard-card-skeleton" aria-busy="true">
								<span className="screen-reader-only">{t("common.loading")}</span>
								<span className="skeleton-line skeleton-line-long" />
								<span className="skeleton-line skeleton-line-medium" />
								<span className="skeleton-line skeleton-line-long" />
								<span className="skeleton-line skeleton-line-short" />
							</div>
						) : (
							<div className="table table-8">
								<div className="table-head">
									<span>{t("table.name")}</span>
									<span>{t("table.stock")}</span>
									<span>{t("table.dailyConsumption")}</span>
									<span>{t("table.stockDetails")}</span>
									<span>{t("table.daysLeft")}</span>
									<span className="date-pair-stack-header">
										<span className="date-pair-label">{t("table.runsOut")}</span>
										<span className="date-pair-label">{t("table.expiry")}</span>
									</span>
									<span>{t("table.status")}</span>
								</div>
								{coverage.all.map((row) => {
									const med = meds.find((m) => getMedDisplayName(m) === row.name);
									const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
									const status = getVisibleStockStatus(med, rawStatus);
									const expiryClass = getExpiryClass(med?.expiryDate, settings.expiryWarningDays);
									const textClass =
										rawStatus.className === "danger"
											? "danger-text"
											: rawStatus.className === "warning"
												? "warning-text"
												: "success-text";
									const stock = getBlisterStock(
										Math.round(row.medsLeft),
										med?.pillsPerBlister ?? 1,
										med?.looseTablets ?? 0,
										med ? getMedTotal(med) : Math.round(row.medsLeft)
									);
									return (
										<div
											key={row.name}
											className="table-row clickable"
											onClick={() => med && openMedDetail(med)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													if (med) openMedDetail(med);
												}
											}}
										>
											<span data-label={t("table.name")} className="cell-with-avatar">
												<span className="med-name-line">
													<span
														className={med?.imageUrl ? "med-avatar-clickable" : undefined}
														onClick={(e) => {
															e.stopPropagation();
															if (med?.imageUrl) openScheduleLightbox(`/api/images/${med.imageUrl}`);
														}}
														onKeyDown={(e) => {
															e.stopPropagation();
															if (e.key === "Enter" || e.key === " ") {
																if (med?.imageUrl) openScheduleLightbox(`/api/images/${med.imageUrl}`);
															}
														}}
													>
														<MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />
													</span>
													<span className="med-name-block-dash">
														<span className="med-name-text">
															{row.name}
															{med?.notes && (
																<>
																	{" "}
																	<span className="notes-icon info-tooltip" data-tooltip={t("tooltips.hasNotes")}>
																		<NotebookPen size={13} aria-hidden="true" />
																	</span>
																</>
															)}
															{med?.prescriptionEnabled && (
																<>
																	{" "}
																	<span
																		className="prescription-icon info-tooltip"
																		data-tooltip={t("tooltips.hasPrescription")}
																	>
																		<ClipboardList size={13} aria-hidden="true" />
																	</span>
																</>
															)}
														</span>
														{med?.takenBy && med.takenBy.length > 0 && (
															<span className="med-taken-by-line">
																{med.takenBy.map((person) => (
																	<span
																		key={person}
																		className="taken-by-badge clickable"
																		onClick={(e) => {
																			e.stopPropagation();
																			openUserFilter(person);
																		}}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				e.stopPropagation();
																				openUserFilter(person);
																			}
																		}}
																	>
																		{person}
																		{med.intakes?.some((i) => i.takenBy === person && i.intakeRemindersEnabled) && (
																			<Bell
																				size={11}
																				aria-hidden="true"
																				className="blister-reminder-icon"
																				style={{ display: "inline", verticalAlign: "middle", marginLeft: "2px" }}
																			/>
																		)}
																	</span>
																))}
															</span>
														)}
													</span>
												</span>
											</span>
											<span data-label={t("table.stock")} className={textClass}>
												{isAmountBasedPackageType(med?.packageType)
													? formatStockLabel(med, row.medsLeft)
													: formatFullBlisters(stock.fullBlisters, t)}
											</span>
											<span data-label={t("table.dailyConsumption")} className={textClass}>
												{formatDailyConsumption(med)}
											</span>
											<span
												data-label={t("table.stockDetails")}
												className={`${textClass}${isAmountBasedPackageType(med?.packageType) ? " hide-on-card" : ""}`}
											>
												{isAmountBasedPackageType(med?.packageType)
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
											<span className="date-pair-stack">
												<span className="date-pair-entry">
													<span className="date-pair-label">{t("table.runsOut")}</span>
													<span className="date-pair-value">{row.depletionDate ?? "-"}</span>
												</span>
												<span className="date-pair-entry">
													<span className="date-pair-label">{t("table.expiry")}</span>
													<span className={`date-pair-value ${expiryClass}`}>
														{med?.expiryDate
															? new Date(med.expiryDate).toLocaleDateString(getSystemLocale(i18n.language), {
																	day: "2-digit",
																	month: "short",
																	year: "2-digit",
																})
															: "-"}
													</span>
												</span>
											</span>
											<span data-label={t("table.status")} className={status ? `status-chip ${status.className}` : ""}>
												{status ? t(status.label) : "-"}
											</span>
										</div>
									);
								})}
							</div>
						)}
					</article>
				</section>

				<section className="grid dashboard-schedules-section">
					<article className="card">
						<div className="card-head">
							<h2>{t("dashboard.schedules.title")}</h2>
							{loading ? (
								<div className="card-head-actions dashboard-actions-skeleton" aria-hidden="true">
									<span className="skeleton-line skeleton-pill" />
								</div>
							) : (
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
									{meds.some((m) => m.takenBy && m.takenBy.length > 0) && (
										<button
											className="ghost share-btn icon-only tooltip-trigger"
											onClick={openShareDialog}
											aria-label={t("share.button")}
											data-tooltip={t("share.button")}
										>
											<Share2 size={18} aria-hidden="true" />
										</button>
									)}
								</div>
							)}
						</div>
						{loading ? (
							<div className="dashboard-card-skeleton" aria-busy="true">
								<span className="screen-reader-only">{t("common.loading")}</span>
								<span className="skeleton-line skeleton-line-long" />
								<span className="skeleton-line skeleton-line-medium" />
								<span className="skeleton-line skeleton-line-short" />
							</div>
						) : (
							<div className="timeline">
								{/* Past days (when expanded) — rendered above toggle */}
								{!showOnlyToday &&
									showPastDays &&
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
													return (
														doseCount + ids.filter((id) => !isDoseTakenForDisplay(id) && !dismissedDoses.has(id)).length
													);
												}, 0)
											);
										}, 0);
										const hasRealMissed = missedNotDismissedCount > 0;

										const isAutoCollapsed = true; // Past days are always auto-collapsed
										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isCollapsed = !isManuallyExpanded;
										const _worstStatus = getDayStockStatus(day.meds);

										return (
											<div
												key={day.dateStr}
												data-date-key={getRouteDateKey(day.date)}
												className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allReallyTaken ? "all-taken" : allDoseIds.length > 0 ? "past-missed" : ""}`}
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
															? getStockStatus(medCov.daysLeft, medCov.medsLeft, stockThresholds, med?.packageType)
															: null;
														const status = getVisibleStockStatus(med, rawStatus);
														const isLowStock = !isEmpty && status?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");
														if (med?.id != null && notificationTarget?.medId === String(med.id)) {
															rowClasses.push("notification-focus-target-row");
														}
														return (
															<div
																key={`${day.dateStr}-${item.medName}`}
																className={rowClasses.join(" ")}
																data-med-id={med?.id != null ? String(med.id) : undefined}
															>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med?.imageUrl) openScheduleLightbox(`/api/images/${med.imageUrl}`);
																				}
																			}}
																		>
																			<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																		</div>
																		<div
																			className="med-name-stack clickable"
																			onClick={() => med && openMedDetail(med)}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med) openMedDetail(med);
																				}
																			}}
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{status && (
																			<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
																		)}
																	</div>
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		// If no takenBy, show single checkbox; otherwise show one per person
																		const people = getDosePeople(dose.takenBy);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item", "past"];
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<span className="dose-usage">
																					<span className="dose-usage-main">
																						{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																					</span>
																					{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																						<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																					)}
																				</span>
																				{dose.intakeRemindersEnabled && (
																					<span
																						className="reminder-icon info-tooltip"
																						data-tooltip={t("tooltips.intakeReminders")}
																					>
																						<Bell size={13} aria-hidden="true" />
																					</span>
																				)}
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
																						if (notificationTarget?.doseId === doseId)
																							personClasses.push("notification-focus-target");
																						return (
																							<div
																								key={doseId}
																								data-dose-id={doseId}
																								className={personClasses.join(" ")}
																							>
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
								{!showOnlyToday &&
									pastDays.length > 0 &&
									(() => {
										const missedCount = missedPastDoseIds.length;
										const totalPastDoses = pastDays.flatMap((d) => d.meds.flatMap((m) => expandDoseIds(m.doses)));
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
														{showPastDays
															? t("dashboard.schedules.hidePastDays")
															: t("dashboard.schedules.showPastDays")}
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
														onClick={() => setShowClearMissedConfirm(true)}
													>
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
										onCancel={() => {
											if (!clearingMissed) setShowClearMissedConfirm(false);
										}}
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
								{/* Today - always visible */}
								{todayDay &&
									(() => {
										const day = todayDay;
										const allDoseIds = day.meds.flatMap((item) => expandDoseIds(item.doses));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
										const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;

										const dayStockStatuses = day.meds.map((item) => {
											const medCoverage = coverageByMed[item.medName];
											const depletionTime = depletionByMed[item.medName];
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											if (willBeOutOfStock) return "danger";
											if (!medCoverage) return "success";
											const med = getMedByName(item.medName);
											const status = getStockStatus(
												medCoverage.daysLeft,
												medCoverage.medsLeft,
												stockThresholds,
												med?.packageType
											);
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
												data-date-key={getRouteDateKey(day.date)}
												className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} today ${worstStatus ? `stock-${worstStatus}` : ""}`}
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
														const medCoverage = coverageByMed[item.medName];
														const med = meds.find((m) => getMedDisplayName(m) === item.medName);
														const depletionTime = depletionByMed[item.medName];
														const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
														const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
														const status = willBeOutOfStock
															? { className: "danger", label: "status.outOfStock" }
															: medCoverage
																? getStockStatus(
																		medCoverage.daysLeft,
																		medCoverage.medsLeft,
																		stockThresholds,
																		med?.packageType
																	)
																: null;
														const visibleStatus = getVisibleStockStatus(med, status);
														const isLowStock = !isEmpty && visibleStatus?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");
														if (med?.id != null && notificationTarget?.medId === String(med.id)) {
															rowClasses.push("notification-focus-target-row");
														}
														return (
															<div
																key={`${day.dateStr}-${item.medName}`}
																className={rowClasses.join(" ")}
																data-med-id={med?.id != null ? String(med.id) : undefined}
															>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med?.imageUrl) openScheduleLightbox(`/api/images/${med.imageUrl}`);
																				}
																			}}
																		>
																			<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																		</div>
																		<div
																			className="med-name-stack clickable"
																			onClick={() => med && openMedDetail(med)}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med) openMedDetail(med);
																				}
																			}}
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{visibleStatus && (
																			<span className={`status-chip small ${visibleStatus.className}`}>
																				{t(visibleStatus.label)}
																			</span>
																		)}
																	</div>
																	{isEmpty && med && !med.isObsolete && (
																		<div className="timeline-obsolete-row">
																			<button
																				type="button"
																				className="timeline-obsolete-btn btn-obsolete"
																				onClick={() =>
																					requestMarkObsolete({ id: med.id, name: getMedDisplayName(med) })
																				}
																			>
																				<Archive size={16} aria-hidden="true" />
																				<span>{t("medications.list.markObsolete")}</span>
																			</button>
																		</div>
																	)}
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		const isOverdue = dose.when < Date.now() && !isEmpty;
																		const people = getDosePeople(dose.takenBy);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item"];
																		if (isOverdue) doseClasses.push("overdue");
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<span className="dose-usage">
																					<span className="dose-usage-main">
																						{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																					</span>
																					{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																						<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																					)}
																				</span>
																				{dose.intakeRemindersEnabled && (
																					<span
																						className="reminder-icon info-tooltip"
																						data-tooltip={t("tooltips.intakeReminders")}
																					>
																						<Bell size={13} aria-hidden="true" />
																					</span>
																				)}
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
																						if (notificationTarget?.doseId === doseId)
																							personClasses.push("notification-focus-target");
																						return (
																							<div
																								key={doseId}
																								data-dose-id={doseId}
																								className={personClasses.join(" ")}
																							>
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
									})()}
								{/* Future days toggle */}
								{!showOnlyToday &&
									futureDays.length > 0 &&
									(() => {
										const totalFutureDoses = futureDays.flatMap((d) =>
											d.meds.flatMap((m) =>
												m.doses.flatMap((dose) =>
													getDosePeople(dose.takenBy).map((person) => (person ? `${dose.id}-${person}` : dose.id))
												)
											)
										);
										const takenFutureDoses = totalFutureDoses.filter((id) => isDoseTakenForDisplay(id)).length;
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
								{/* Future days */}
								{!showOnlyToday &&
									showFutureDays &&
									futureDays.map((day) => {
										const allDoseIds = day.meds.flatMap((item) => expandDoseIds(item.doses));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
										const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;

										const dayStockStatuses = day.meds.map((item) => {
											const medCoverage = coverageByMed[item.medName];
											const depletionTime = depletionByMed[item.medName];
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											if (willBeOutOfStock) return "danger";
											if (!medCoverage) return "success";
											const med = getMedByName(item.medName);
											const status = getStockStatus(
												medCoverage.daysLeft,
												medCoverage.medsLeft,
												stockThresholds,
												med?.packageType
											);
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
												data-date-key={getRouteDateKey(day.date)}
												className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} ${worstStatus ? `stock-${worstStatus}` : ""}`}
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
														const medCoverage = coverageByMed[item.medName];
														const med = meds.find((m) => getMedDisplayName(m) === item.medName);
														const depletionTime = depletionByMed[item.medName];
														const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
														const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
														const status = willBeOutOfStock
															? { className: "danger", label: "status.outOfStock" }
															: medCoverage
																? getStockStatus(
																		medCoverage.daysLeft,
																		medCoverage.medsLeft,
																		stockThresholds,
																		med?.packageType
																	)
																: null;
														const visibleStatus = getVisibleStockStatus(med, status);
														const isLowStock = !isEmpty && visibleStatus?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");
														if (med?.id != null && notificationTarget?.medId === String(med.id)) {
															rowClasses.push("notification-focus-target-row");
														}
														return (
															<div
																key={`${day.dateStr}-${item.medName}`}
																className={rowClasses.join(" ")}
																data-med-id={med?.id != null ? String(med.id) : undefined}
															>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openScheduleLightbox(`/api/images/${med.imageUrl}`)
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med?.imageUrl) openScheduleLightbox(`/api/images/${med.imageUrl}`);
																				}
																			}}
																		>
																			<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
																		</div>
																		<div
																			className="med-name-stack clickable"
																			onClick={() => med && openMedDetail(med)}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					if (med) openMedDetail(med);
																				}
																			}}
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{visibleStatus && (
																			<span className={`status-chip small ${visibleStatus.className}`}>
																				{t(visibleStatus.label)}
																			</span>
																		)}
																	</div>
																	{isEmpty && med && !med.isObsolete && (
																		<div className="timeline-obsolete-row">
																			<button
																				type="button"
																				className="timeline-obsolete-btn btn-obsolete"
																				onClick={() =>
																					requestMarkObsolete({ id: med.id, name: getMedDisplayName(med) })
																				}
																			>
																				<Archive size={16} aria-hidden="true" />
																				<span>{t("medications.list.markObsolete")}</span>
																			</button>
																		</div>
																	)}
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		const people = getDosePeople(dose.takenBy);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item", "future"];
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<span className="dose-usage">
																					<span className="dose-usage-main">
																						{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																					</span>
																					{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																						<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																					)}
																				</span>
																				{dose.intakeRemindersEnabled && (
																					<span
																						className="reminder-icon info-tooltip"
																						data-tooltip={t("tooltips.intakeReminders")}
																					>
																						<Bell size={13} aria-hidden="true" />
																					</span>
																				)}
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
																						if (notificationTarget?.doseId === doseId)
																							personClasses.push("notification-focus-target");
																						return (
																							<div
																								key={doseId}
																								data-dose-id={doseId}
																								className={personClasses.join(" ")}
																							>
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
																									isEmpty: true,
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
						)}
					</article>
				</section>
			</div>
		</>
	);
}
