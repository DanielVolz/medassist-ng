import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const contextMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../context", () => ({
	useAppContext: () => contextMock.value,
}));

import { useScheduleController } from "../../hooks/useScheduleController";

describe("useScheduleController", () => {
	it("forwards schedule state, transitions, and journal errors from the app context", () => {
		const markDoseTaken = vi.fn();
		const setShowPastDays = vi.fn();
		const openJournalEditor = vi.fn();
		contextMock.value = {
			meds: [{ id: 7, name: "Aspirin" }],
			loading: false,
			settings: { language: "en" },
			settingsLoading: false,
			coverage: new Map([[7, 5]]),
			coverageByMed: new Map([[7, 5]]),
			depletionByMed: new Map([[7, "2026-07-20"]]),
			stockThresholds: new Map([[7, 3]]),
			scheduleDays: [],
			setScheduleDays: vi.fn(),
			showPastDays: true,
			setShowPastDays,
			showFutureDays: false,
			setShowFutureDays: vi.fn(),
			pastDays: [],
			todayDay: null,
			futureDays: [],
			takenDoses: new Set(["dose-1"]),
			dismissedDoses: new Set(),
			skippedDoses: new Set(),
			markDoseTaken,
			markDoseSkipped: vi.fn(),
			undoDoseTaken: vi.fn(),
			undoDoseSkipped: vi.fn(),
			journalEditorOpen: true,
			journalHistoryOpen: false,
			journalTargetDoseId: "dose-1",
			journalEvent: null,
			journalEventLoading: false,
			journalEventSaving: false,
			journalEventDeleting: false,
			journalEventError: "Unable to save note",
			journalHistoryEntries: [],
			journalHistoryFilters: { medicationId: null },
			journalHistoryLoading: false,
			journalHistoryError: "Unable to load history",
			openJournalEditor,
			closeJournalEditor: vi.fn(),
			saveJournalNote: vi.fn(),
			deleteJournalNote: vi.fn(),
			openJournalHistory: vi.fn(),
			closeJournalHistory: vi.fn(),
			setJournalHistoryFilters: vi.fn(),
			reloadJournalHistory: vi.fn(),
			reopenJournalHistoryEntry: vi.fn(),
			manuallyCollapsedDays: new Set(),
			manuallyExpandedDays: new Set(),
			toggleDayCollapse: vi.fn(),
			missedPastDoseIds: new Set(),
			getDoseId: vi.fn(),
			isDoseTakenAutomatically: vi.fn(),
			openMedDetail: vi.fn(),
			openUserFilter: vi.fn(),
			openScheduleLightbox: vi.fn(),
			loadMeds: vi.fn(),
			loadSettings: vi.fn(),
		};

		const { result, rerender } = renderHook(() => useScheduleController());

		expect(result.current.meds).toEqual([{ id: 7, name: "Aspirin" }]);
		expect(result.current.takenDoses).toEqual(new Set(["dose-1"]));
		expect(result.current.journalEventError).toBe("Unable to save note");
		expect(result.current.journalHistoryError).toBe("Unable to load history");
		expect(result.current.markDoseTaken).toBe(markDoseTaken);
		expect(result.current.openJournalEditor).toBe(openJournalEditor);

		contextMock.value = {
			...contextMock.value,
			showPastDays: false,
			journalEventError: null,
			journalHistoryError: null,
		};
		rerender();

		expect(result.current.showPastDays).toBe(false);
		expect(result.current.journalEventError).toBeNull();
		expect(result.current.journalHistoryError).toBeNull();
		expect(result.current.setShowPastDays).toBe(setShowPastDays);
	});
});
