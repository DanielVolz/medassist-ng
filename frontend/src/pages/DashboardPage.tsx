/* biome-ignore-all lint/style/noNestedTernary: timeline rendering uses explicit UI-state branching */
import { ActionIcon, Group } from "@mantine/core";
import { Archive, Bell, ClipboardList, NotebookPen, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ConfirmModal, IntakeJournalHistoryModal, IntakeJournalModal, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import doseButtonClasses from "../components/DoseActionButton.module.css";
import { DashboardReminderSection } from "../components/dashboard/DashboardReminderSection";
import { DashboardStatusSection } from "../components/dashboard/DashboardStatusSection";
import journalHistoryActionClasses from "../components/intake-journal/JournalHistoryAction.module.css";
import { useAppContext } from "../context";
import { useFeedback } from "../context/FeedbackContext";
import scheduleActionClasses from "../features/schedule/components/ScheduleHeaderActions.module.css";
import { useModalHistory } from "../hooks";
import {
	allowsPillFormSelection,
	type Coverage,
	getMedDisplayName,
	type IntakeUnit,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
} from "../types";
import { SectionCard } from "../ui/components/SectionCard";
import { AppButton } from "../ui/primitives/AppButton";
import { AppSelect } from "../ui/primitives/AppSelect";
import { AppTextAction } from "../ui/primitives/AppTextAction";
import { AppTooltip, AppTooltipTrigger } from "../ui/primitives/AppTooltip";
import { DataTable, type DataTableColumn } from "../ui/primitives/DataTable";
import { StatusBadge, type StatusTone } from "../ui/primitives/StatusBadge";
import { formatNumber, getExpiryClass, getSystemLocale } from "../utils/formatters";
import { getIntakeDailyRate, getMedicationIntakes } from "../utils/intake-schedule";
import { convertLiquidUsageToMl, getLiquidCountUnitLabel, type UnitLabelVariant } from "../utils/intake-units";
import { buildClearMissedPayload, expandDoseIds, getStockStatus, isDoseDismissed } from "../utils/schedule";
import classes from "./DashboardPage.module.css";
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

function getStatusTone(className?: string): StatusTone {
	if (className === "danger" || className === "warning" || className === "high" || className === "success") {
		return className;
	}
	return "info";
}

function cx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

function findFocusTargetElement(doseId: string | null, medId: string | null): HTMLElement | null {
	if (typeof document === "undefined") {
		return null;
	}

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

function getNamedDosePeople(people: Array<string | null>): string[] {
	return people.filter((person): person is string => typeof person === "string" && person.trim().length > 0);
}

function getDosePersonTextColor(isTaken: boolean, isSkipped: boolean): string {
	if (isTaken) return "var(--success)";
	if (isSkipped) return "color-mix(in srgb, var(--warning) 82%, var(--text-primary))";
	return "var(--text-secondary)";
}

const EMPTY_DOSE_SET = new Set<string>();

export function DashboardPage() {
	const { t, i18n } = useTranslation();
	const { user, authFetch } = useAuth();
	const { showFeedback } = useFeedback();
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
		stockThresholds,
		loadMeds,
		loadSettings,
	} = useAppContext();
	const [showClearMissedConfirm, setShowClearMissedConfirm] = useState(false);
	const [clearingMissed, setClearingMissed] = useState(false);
	const [showObsoleteConfirm, setShowObsoleteConfirm] = useState(false);
	const [obsoleteCandidate, setObsoleteCandidate] = useState<{ id: number; name: string } | null>(null);
	const notificationFocusAppliedRef = useRef<string | null>(null);

	const closeClearMissedConfirm = useCallback(() => {
		if (!clearingMissed) {
			setShowClearMissedConfirm(false);
		}
	}, [clearingMissed]);

	const closeObsoleteConfirm = useCallback(() => {
		setShowObsoleteConfirm(false);
		setObsoleteCandidate(null);
	}, []);

	useModalHistory(showClearMissedConfirm, "dashboard-clear-missed", closeClearMissedConfirm);
	useModalHistory(showObsoleteConfirm, "dashboard-obsolete", closeObsoleteConfirm);

	const effectiveSkippedDoses =
		skippedDoses instanceof Set ? skippedDoses : dismissedDoses instanceof Set ? dismissedDoses : EMPTY_DOSE_SET;
	const canManageSkippedDoses = typeof markDoseSkipped === "function" && typeof undoDoseSkipped === "function";

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

		try {
			if (targetDayState.section === "past" && !showPastDays) {
				setShowPastDays(true);
			}

			if (targetDayState.section === "future" && !showFutureDays) {
				setShowFutureDays(true);
			}

			if (targetDayState.isCollapsed) {
				toggleDayCollapse(targetDayState.day.dateStr, targetDayState.isAutoCollapsed);
			}
		} catch {
			notificationFocusAppliedRef.current = null;
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
			try {
				const targetElement = findFocusTargetElement(notificationTarget.doseId, notificationTarget.medId);

				if (!targetElement || typeof targetElement.scrollIntoView !== "function") {
					return false;
				}

				targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
				return true;
			} catch {
				return false;
			}
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

	const renderDoseActionButtons = (options: {
		doseId: string;
		isTaken: boolean;
		isSkipped: boolean;
		isAutomaticallyTaken: boolean;
		isEmpty: boolean;
	}) => {
		const journalUnavailable = !(options.isTaken || options.isSkipped);
		const takeButtonControl = options.isTaken ? (
			<AppButton
				type="button"
				size="sm"
				className={cx(doseButtonClasses.button, doseButtonClasses.undo, doseButtonClasses.undoTake)}
				onClick={() => undoDoseTaken(options.doseId)}
			>
				{options.isAutomaticallyTaken && <AppTooltipTrigger label={t("tooltips.automaticTaken")}>🤖</AppTooltipTrigger>}
				<span className={doseButtonClasses.label}>{t("common.undo")}</span>
				<span aria-hidden="true">↩</span>
			</AppButton>
		) : (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					doseButtonClasses.button,
					doseButtonClasses.take,
					doseButtonClasses.dashboardTake,
					options.isEmpty && doseButtonClasses.outOfStock
				)}
				onClick={() => markDoseTaken(options.doseId)}
				disabled={options.isEmpty || options.isSkipped}
			>
				<span className={doseButtonClasses.label}>{t("dose.take")}</span>
				<span aria-hidden="true">{options.isEmpty ? "⊘" : "✓"}</span>
			</AppButton>
		);
		const takeButton =
			!options.isTaken && options.isEmpty ? (
				<AppTooltip label={t("common.outOfStockTakeBlocked")}>
					<span className={doseButtonClasses.tooltipTarget}>{takeButtonControl}</span>
				</AppTooltip>
			) : (
				takeButtonControl
			);

		const journalButtonControl = (
			<AppButton
				type="button"
				size="sm"
				className={cx(doseButtonClasses.button, doseButtonClasses.journal)}
				onClick={() => {
					if (!journalUnavailable) {
						void openJournalEditor(options.doseId);
					}
				}}
				disabled={journalUnavailable}
			>
				<NotebookPen size={14} aria-hidden="true" />
				<span className={doseButtonClasses.label}>{t("journal.actions.note")}</span>
			</AppButton>
		);
		const journalButton = journalUnavailable ? (
			<AppTooltip label={t("journal.actions.noteTakenOnly")}>
				<span className={doseButtonClasses.tooltipTarget}>{journalButtonControl}</span>
			</AppTooltip>
		) : (
			journalButtonControl
		);

		if (!canManageSkippedDoses) {
			return (
				<>
					{takeButton}
					{journalButton}
				</>
			);
		}

		const skipButton = options.isSkipped ? (
			<AppButton
				type="button"
				size="sm"
				className={cx(doseButtonClasses.button, doseButtonClasses.undo, doseButtonClasses.undoSkip)}
				onClick={() => undoDoseSkipped(options.doseId)}
			>
				<span className={doseButtonClasses.label}>{t("common.undo")}</span>
				<span aria-hidden="true">↩</span>
			</AppButton>
		) : (
			<AppButton
				type="button"
				size="sm"
				className={cx(doseButtonClasses.button, doseButtonClasses.skip)}
				onClick={() => markDoseSkipped(options.doseId)}
				disabled={options.isTaken}
			>
				<span className={doseButtonClasses.label}>{t("dose.skip")}</span>
			</AppButton>
		);

		return (
			<>
				{takeButton}
				{skipButton}
				{journalButton}
			</>
		);
	};

	const renderDoseRecipients = (people: string[]) => {
		if (people.length === 0) {
			return null;
		}

		return (
			<div className="dose-recipients">
				{people.map((person) => (
					<AppTextAction
						key={person}
						className="dose-recipient-name"
						color="var(--text-secondary)"
						fontWeight={600}
						lineHeight={1.15}
						onClick={() => openUserFilter(person)}
						textAlign="right"
					>
						{person}
					</AppTextAction>
				))}
			</div>
		);
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

	const getDiscreteUnitLabel = (packageType: string | undefined, count: number, variant: UnitLabelVariant = "full") => {
		if (packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
		if (packageType === "injection") {
			if (variant === "compact") return count === 1 ? t("common.injectionShort") : t("common.injectionsShort");
			return count === 1 ? t("common.injection") : t("common.injections");
		}
		return count === 1 ? t("common.pill") : t("common.pills");
	};

	const getTubeUnitLabel = (
		med: (typeof meds)[number] | undefined,
		value: number,
		variant: UnitLabelVariant = "full"
	) => {
		if (isLiquidContainerPackageType(med?.packageType) || med?.medicationForm === "liquid") {
			return t("form.packageAmountUnitMl");
		}
		return variant === "compact"
			? t("form.blisters.applicationsShort")
			: t("form.blisters.applications", { count: Math.abs(value) });
	};

	const getTubeStockUnitLabel = () => t("form.packageAmountUnitG");

	const formatStockLabel = (med: (typeof meds)[number] | undefined, medsLeft: number) => {
		if (isLiquidContainerPackageType(med?.packageType)) {
			return `${formatNumber(medsLeft)} ${t("form.packageAmountUnitMl")}`;
		}
		if (isTubePackageType(med?.packageType)) {
			return `${formatNumber(medsLeft)} ${getTubeStockUnitLabel()}`;
		}
		const roundedCount = Math.round(medsLeft);
		if (med?.packageType !== "inhaler" && med?.packageType !== "injection") {
			return t("table.pillsCount", { count: roundedCount });
		}
		return `${roundedCount} ${getDiscreteUnitLabel(med?.packageType, roundedCount)}`;
	};

	const formatLiquidUsageLabel = (
		usage: number,
		unit: IntakeUnit | null | undefined,
		variant: UnitLabelVariant = "full"
	): string => {
		const normalizedUsage = Number(usage);
		if (!Number.isFinite(normalizedUsage) || normalizedUsage <= 0) {
			return `0 ${t("form.packageAmountUnitMl")}`;
		}

		if (unit === "ml" || unit == null) {
			return `${formatNumber(normalizedUsage)} ${t("form.packageAmountUnitMl")}`;
		}

		const mlTotal = convertLiquidUsageToMl(normalizedUsage, unit);
		return `${formatNumber(normalizedUsage)} ${getLiquidCountUnitLabel(unit, normalizedUsage, t, variant)} ${formatNumber(mlTotal)} ${t("form.packageAmountUnitMl")}`;
	};

	const formatDoseUsageLabel = (
		med: (typeof meds)[number] | undefined,
		usage: number,
		intakeUnit?: IntakeUnit | null,
		variant: UnitLabelVariant = "full"
	) => {
		if (isLiquidContainerPackageType(med?.packageType)) {
			return formatLiquidUsageLabel(usage, intakeUnit, variant);
		}
		if (isTubePackageType(med?.packageType)) {
			return `${usage} ${getTubeUnitLabel(med, usage, variant)}`;
		}
		return `${usage} ${getDiscreteUnitLabel(med?.packageType, usage, variant)}`;
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
		if (med?.packageType === "inhaler" || med?.packageType === "injection") {
			return `${total} ${getDiscreteUnitLabel(med.packageType, total)}`;
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

		// Keep fractional daily totals (e.g. one application every 2 days = 0.5)
		// visible instead of rounding them up to a misleading whole number.
		const dailyDecimals = Number.isInteger(dailyTotal) ? 0 : 1;

		if (isLiquidContainerPackageType(med.packageType)) {
			return t("table.perDayWithUnit", {
				value: formatNumber(dailyTotal, dailyDecimals),
				unit: t("form.packageAmountUnitMl"),
			});
		}

		if (isTubePackageType(med.packageType)) {
			const tubeUnit =
				med.medicationForm === "liquid"
					? t("form.packageAmountUnitMl")
					: t("form.blisters.applications", { count: Math.abs(dailyTotal) });
			return t("table.perDayWithUnit", { value: formatNumber(dailyTotal, dailyDecimals), unit: tubeUnit });
		}

		const pillUnit = getDiscreteUnitLabel(med.packageType, dailyTotal);
		return t("table.perDayWithUnit", { value: formatNumber(dailyTotal, dailyDecimals), unit: pillUnit });
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

				const stockRes = await authFetch("/api/reminder/send-email", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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

				const prescriptionRes = await authFetch("/api/reminder/send-prescription", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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

	const overviewColumns = [
		{
			key: "name",
			header: t("table.name"),
			width: "38%",
			render: (row) => {
				const med = getMedByName(row.name);
				return (
					<span data-label={t("table.name")} className={classes.overviewNameCell}>
						<span className={classes.overviewNameLine}>
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
							<span className={classes.overviewNameBlock}>
								<span className={classes.overviewMedicationTitle}>
									{med ? (
										<AppTextAction
											className={classes.overviewMedicationName}
											onClick={(event) => {
												event.stopPropagation();
												openMedDetail(med);
											}}
											textAlign="left"
										>
											{row.name}
										</AppTextAction>
									) : (
										<span className={classes.overviewMedicationName}>{row.name}</span>
									)}
									{med?.notes && (
										<AppTooltipTrigger label={t("tooltips.hasNotes")} className="notes-icon">
											<NotebookPen size={13} aria-hidden="true" />
										</AppTooltipTrigger>
									)}
									{med?.prescriptionEnabled && (
										<AppTooltipTrigger label={t("tooltips.hasPrescription")} className="prescription-icon">
											<ClipboardList size={13} aria-hidden="true" />
										</AppTooltipTrigger>
									)}
								</span>
								{med?.takenBy && med.takenBy.length > 0 && (
									<span className={classes.overviewTakenByLine}>
										{med.takenBy.map((person) => (
											<button
												type="button"
												key={person}
												className={cx(classes.overviewTakenByBadge, classes.overviewTakenByBadgeClickable)}
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
													<Bell size={11} aria-hidden="true" className={classes.overviewTakenByReminderIcon} />
												)}
											</button>
										))}
									</span>
								)}
							</span>
						</span>
					</span>
				);
			},
		},
		{
			key: "stock",
			header: t("table.stock"),
			render: (row) => {
				const med = getMedByName(row.name);
				const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
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
					<span data-label={t("table.stock")} className={textClass}>
						{isAmountBasedPackageType(med?.packageType)
							? formatStockLabel(med, row.medsLeft)
							: formatFullBlisters(stock.fullBlisters, t)}
					</span>
				);
			},
		},
		{
			key: "dailyConsumption",
			header: t("table.dailyConsumption"),
			render: (row) => {
				const med = getMedByName(row.name);
				const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
				const textClass =
					rawStatus.className === "danger"
						? "danger-text"
						: rawStatus.className === "warning"
							? "warning-text"
							: "success-text";
				return (
					<span data-label={t("table.dailyConsumption")} className={textClass}>
						{formatDailyConsumption(med)}
					</span>
				);
			},
		},
		{
			key: "stockDetails",
			header: t("table.stockDetails"),
			render: (row) => {
				const med = getMedByName(row.name);
				const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
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
					<span
						data-label={t("table.stockDetails")}
						className={`${textClass}${isAmountBasedPackageType(med?.packageType) ? " hide-on-card" : ""}`}
					>
						{isAmountBasedPackageType(med?.packageType)
							? "—"
							: formatOpenBlisterAndLoose(stock.openBlisterPills, stock.loosePills, med?.pillsPerBlister ?? 1, t)}
					</span>
				);
			},
		},
		{
			key: "daysLeft",
			header: t("table.daysLeft"),
			render: (row) => {
				const med = getMedByName(row.name);
				const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
				const textClass =
					rawStatus.className === "danger"
						? "danger-text"
						: rawStatus.className === "warning"
							? "warning-text"
							: "success-text";
				return (
					<span data-label={t("table.daysLeft")} className={textClass}>
						{formatNumber(row.daysLeft)}
					</span>
				);
			},
		},
		{
			key: "datePair",
			header: (
				<span className="date-pair-stack-header">
					<span className="date-pair-label">{t("table.runsOut")}</span>
					<span className="date-pair-label">{t("table.expiry")}</span>
				</span>
			),
			render: (row) => {
				const med = getMedByName(row.name);
				const expiryClass = getExpiryClass(med?.expiryDate, settings.expiryWarningDays);
				return (
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
				);
			},
		},
		{
			key: "status",
			header: t("table.status"),
			width: "7.5rem",
			render: (row) => {
				const med = getMedByName(row.name);
				const rawStatus = getStockStatus(row.daysLeft, row.medsLeft, stockThresholds, med?.packageType);
				const status = getVisibleStockStatus(med, rawStatus);
				return status ? (
					<span data-label={t("table.status")}>
						<StatusBadge size="xs" tone={getStatusTone(status.className)}>
							{t(status.label)}
						</StatusBadge>
					</span>
				) : (
					<span data-label={t("table.status")}>-</span>
				);
			},
		},
	] satisfies DataTableColumn<Coverage>[];

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
				className={[
					"dashboard-main-sections",
					classes.mainSections,
					settings.swapDashboardMainSections ? classes.mainSectionsSwapped : "",
				]
					.filter(Boolean)
					.join(" ")}
			>
				<section className={`grid dashboard-overview-section ${classes.overviewSection}`}>
					<SectionCard title={t("dashboard.overview.title")}>
						{loading ? (
							<div className="dashboard-card-skeleton" aria-busy="true">
								<span className="screen-reader-only">{t("common.loading")}</span>
								<span className="skeleton-line skeleton-line-long" />
								<span className="skeleton-line skeleton-line-medium" />
								<span className="skeleton-line skeleton-line-long" />
								<span className="skeleton-line skeleton-line-short" />
							</div>
						) : (
							<DataTable
								columns={overviewColumns}
								data-testid="dashboard-overview-table"
								rows={coverage.all}
								rowKey={(row) => row.name}
								getRowProps={(row) => ({
									"aria-label": row.name,
									"data-testid": "dashboard-overview-row",
								})}
							/>
						)}
					</SectionCard>
				</section>

				<section className={`grid dashboard-schedules-section ${classes.schedulesSection}`}>
					<SectionCard
						title={t("dashboard.schedules.title")}
						actions={
							loading ? (
								<Group gap="sm" aria-hidden="true">
									<span className="skeleton-line skeleton-pill" />
								</Group>
							) : (
								<Group className={scheduleActionClasses.actions} gap={0} justify="flex-end" wrap="wrap">
									<AppSelect
										size="sm"
										classNames={{
											root: scheduleActionClasses.selectRoot,
											input: cx("schedule-days-select", scheduleActionClasses.selectInput),
										}}
										value={String(scheduleDays)}
										onChange={(e) => {
											const val = Number(e.currentTarget.value);
											setScheduleDays(val);
											if (user?.id) localStorage.setItem(userStorageKey(user.id, "scheduleDays"), String(val));
										}}
										data={[
											{ value: "30", label: t("dashboard.schedules.1month") },
											{ value: "90", label: t("dashboard.schedules.3months") },
											{ value: "180", label: t("dashboard.schedules.6months") },
										]}
									/>
									<AppButton
										type="button"
										tone="secondary"
										size="sm"
										className={cx(
											"journal-history-button",
											journalHistoryActionClasses.button,
											scheduleActionClasses.historyButton
										)}
										onClick={openJournalHistory}
										aria-label={t("journal.actions.history")}
										leftSection={<ClipboardList size={16} aria-hidden="true" />}
									>
										<span className={cx("journal-history-label-full", journalHistoryActionClasses.labelFull)}>
											{t("journal.actions.history")}
										</span>
										<span className={cx("journal-history-label-short", journalHistoryActionClasses.labelShort)}>
											{t("journal.actions.historyShort")}
										</span>
									</AppButton>
									{meds.some((m) => m.takenBy && m.takenBy.length > 0) && (
										<AppTooltip label={t("share.button")}>
											<ActionIcon
												type="button"
												size="input-sm"
												className={cx("share-btn", scheduleActionClasses.shareButton)}
												color="brand"
												variant="default"
												onClick={openShareDialog}
												aria-label={t("share.button")}
											>
												<Share2 size={18} aria-hidden="true" />
											</ActionIcon>
										</AppTooltip>
									)}
								</Group>
							)
						}
					>
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
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allReallyTaken ? (
															<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
														) : (
															<>
																{hasRealMissed && (
																	<AppTooltipTrigger
																		label={t("dashboard.schedules.missedDoses", { count: missedNotDismissedCount })}
																		className="day-warning"
																	>
																		⚠️
																	</AppTooltipTrigger>
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
																		<AppTextAction
																			className="med-name-stack"
																			onClick={() => med && openMedDetail(med)}
																			style={{
																				alignItems: "flex-start",
																				display: "inline-flex",
																				flexDirection: "column",
																			}}
																			textAlign="left"
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</AppTextAction>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{status && (
																			<StatusBadge size="xs" tone={getStatusTone(status.className)}>
																				{t(status.label)}
																			</StatusBadge>
																		)}
																	</div>
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		// If no takenBy, show single checkbox; otherwise show one per person
																		const people = getDosePeople(dose.takenBy);
																		const namedPeople = getNamedDosePeople(people);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item", "past"];
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<div className="dose-summary">
																					<span className="dose-usage">
																						<span className="dose-usage-main dose-usage-main-full">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																						</span>
																						<span className="dose-usage-main dose-usage-main-compact">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit, "compact")}
																						</span>
																						{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																							<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																						)}
																					</span>
																					{renderDoseRecipients(namedPeople)}
																				</div>
																				{dose.intakeRemindersEnabled && (
																					<AppTooltipTrigger
																						label={t("tooltips.intakeReminders")}
																						className="reminder-icon"
																					>
																						<Bell size={13} aria-hidden="true" />
																					</AppTooltipTrigger>
																				)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary",
																						namedPeople.length > 1 && "multi-person"
																					)}
																				>
																					{people.map((person) => {
																						const doseId = getDoseId(dose.id, person);
																						const isTaken = isDoseTakenForDisplay(doseId);
																						const isSkipped = effectiveSkippedDoses.has(doseId);
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
																									<AppTextAction
																										className="person-name"
																										color={getDosePersonTextColor(isTaken, isSkipped)}
																										onClick={() => openUserFilter(person)}
																									>
																										{person}
																									</AppTextAction>
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
														<AppTooltipTrigger
															label={t("dashboard.schedules.missedDoses", { count: missedCount })}
															className="past-days-warning"
														>
															⚠️ {missedCount}
														</AppTooltipTrigger>
													) : totalPastDoses.length > 0 ? (
														<AppTooltipTrigger label={t("dashboard.schedules.allTaken")} className="past-days-complete">
															✓
														</AppTooltipTrigger>
													) : null}
												</div>
												{missedCount > 0 && (
													<AppButton
														type="button"
														tone="warningOutline"
														size="sm"
														className="clear-missed-btn"
														onClick={() => setShowClearMissedConfirm(true)}
													>
														{t("dashboard.schedules.clearMissed")}
													</AppButton>
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
																		<AppTextAction
																			className="med-name-stack"
																			onClick={() => med && openMedDetail(med)}
																			style={{
																				alignItems: "flex-start",
																				display: "inline-flex",
																				flexDirection: "column",
																			}}
																			textAlign="left"
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</AppTextAction>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{visibleStatus && (
																			<StatusBadge size="xs" tone={getStatusTone(visibleStatus.className)}>
																				{t(visibleStatus.label)}
																			</StatusBadge>
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
																		const namedPeople = getNamedDosePeople(people);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item"];
																		if (isOverdue) doseClasses.push("overdue");
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<div className="dose-summary">
																					<span className="dose-usage">
																						<span className="dose-usage-main dose-usage-main-full">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																						</span>
																						<span className="dose-usage-main dose-usage-main-compact">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit, "compact")}
																						</span>
																						{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																							<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																						)}
																					</span>
																					{renderDoseRecipients(namedPeople)}
																				</div>
																				{dose.intakeRemindersEnabled && (
																					<AppTooltipTrigger
																						label={t("tooltips.intakeReminders")}
																						className="reminder-icon"
																					>
																						<Bell size={13} aria-hidden="true" />
																					</AppTooltipTrigger>
																				)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary",
																						namedPeople.length > 1 && "multi-person"
																					)}
																				>
																					{people.map((person) => {
																						const doseId = getDoseId(dose.id, person);
																						const isTaken = isDoseTakenForDisplay(doseId);
																						const isSkipped = effectiveSkippedDoses.has(doseId);
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
																									<AppTextAction
																										className="person-name"
																										color={getDosePersonTextColor(isTaken, isSkipped)}
																										onClick={() => openUserFilter(person)}
																									>
																										{person}
																									</AppTextAction>
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
																		<AppTextAction
																			className="med-name-stack"
																			onClick={() => med && openMedDetail(med)}
																			style={{
																				alignItems: "flex-start",
																				display: "inline-flex",
																				flexDirection: "column",
																			}}
																			textAlign="left"
																		>
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</AppTextAction>
																	</div>
																	<div className="tag-row">
																		<span className="tag subtle">
																			{formatTotalUsageLabel(med, item.total, item.doses[0]?.intakeUnit, item.doses)}
																		</span>
																		{visibleStatus && (
																			<StatusBadge size="xs" tone={getStatusTone(visibleStatus.className)}>
																				{t(visibleStatus.label)}
																			</StatusBadge>
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
																		const namedPeople = getNamedDosePeople(people);
																		const allTaken = people.every((person) =>
																			isDoseTakenForDisplay(getDoseId(dose.id, person))
																		);
																		const doseClasses = ["dose-item", "future"];
																		if (allTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				<span className="dose-time">{dose.timeStr}</span>
																				<div className="dose-summary">
																					<span className="dose-usage">
																						<span className="dose-usage-main dose-usage-main-full">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit)}
																						</span>
																						<span className="dose-usage-main dose-usage-main-compact">
																							{formatDoseUsageLabel(med, dose.usage, dose.intakeUnit, "compact")}
																						</span>
																						{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
																							<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
																						)}
																					</span>
																					{renderDoseRecipients(namedPeople)}
																				</div>
																				{dose.intakeRemindersEnabled && (
																					<AppTooltipTrigger
																						label={t("tooltips.intakeReminders")}
																						className="reminder-icon"
																					>
																						<Bell size={13} aria-hidden="true" />
																					</AppTooltipTrigger>
																				)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary",
																						namedPeople.length > 1 && "multi-person"
																					)}
																				>
																					{people.map((person) => {
																						const doseId = getDoseId(dose.id, person);
																						const isTaken = isDoseTakenForDisplay(doseId);
																						const isSkipped = effectiveSkippedDoses.has(doseId);
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
																									<AppTextAction
																										className="person-name"
																										color={getDosePersonTextColor(isTaken, isSkipped)}
																										onClick={() => openUserFilter(person)}
																									>
																										{person}
																									</AppTextAction>
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
					</SectionCard>
				</section>
			</div>
		</>
	);
}
