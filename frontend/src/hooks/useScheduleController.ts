import { useAppContext } from "../context";

export function useScheduleController() {
	const ctx = useAppContext();

	return {
		meds: ctx.meds,
		loading: ctx.loading,
		settings: ctx.settings,
		settingsLoading: ctx.settingsLoading,
		coverage: ctx.coverage,
		coverageByMed: ctx.coverageByMed,
		depletionByMed: ctx.depletionByMed,
		stockThresholds: ctx.stockThresholds,
		scheduleDays: ctx.scheduleDays,
		setScheduleDays: ctx.setScheduleDays,
		showPastDays: ctx.showPastDays,
		setShowPastDays: ctx.setShowPastDays,
		showFutureDays: ctx.showFutureDays,
		setShowFutureDays: ctx.setShowFutureDays,
		pastDays: ctx.pastDays,
		todayDay: ctx.todayDay,
		futureDays: ctx.futureDays,
		takenDoses: ctx.takenDoses,
		dismissedDoses: ctx.dismissedDoses,
		skippedDoses: ctx.skippedDoses,
		markDoseTaken: ctx.markDoseTaken,
		markDoseSkipped: ctx.markDoseSkipped,
		undoDoseTaken: ctx.undoDoseTaken,
		undoDoseSkipped: ctx.undoDoseSkipped,
		manuallyCollapsedDays: ctx.manuallyCollapsedDays,
		manuallyExpandedDays: ctx.manuallyExpandedDays,
		toggleDayCollapse: ctx.toggleDayCollapse,
		missedPastDoseIds: ctx.missedPastDoseIds,
		getDayStockStatus: ctx.getDayStockStatus,
		getDoseId: ctx.getDoseId,
		isDoseTakenAutomatically: ctx.isDoseTakenAutomatically,
		openMedDetail: ctx.openMedDetail,
		openUserFilter: ctx.openUserFilter,
		openScheduleLightbox: ctx.openScheduleLightbox,
		loadMeds: ctx.loadMeds,
		loadSettings: ctx.loadSettings,
	};
}
