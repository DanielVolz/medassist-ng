import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import type { IntakeMood } from "../utils/intake-mood";
import { useModalHistory } from "./useModalHistory";

export type IntakeJournalEntry = {
	doseTrackingId: number;
	doseId: string;
	medicationId: number;
	medicationName: string;
	scheduledFor: string;
	takenAt: string | null;
	dismissed: boolean;
	takenSource: "manual" | "automatic" | "notification";
	markedBy: string | null;
	mood: IntakeMood | null;
	note: string | null;
	updatedAt: string | null;
	createdAt: string | null;
};

export type IntakeJournalHistoryFilters = {
	medicationId: number | null;
	from: string;
	to: string;
	limit: number;
};

export interface UseIntakeJournalReturn {
	journalEditorOpen: boolean;
	journalHistoryOpen: boolean;
	journalTargetDoseId: string | null;
	journalEvent: IntakeJournalEntry | null;
	journalEventLoading: boolean;
	journalEventSaving: boolean;
	journalEventDeleting: boolean;
	journalEventError: string | null;
	journalHistoryEntries: IntakeJournalEntry[];
	journalHistoryFilters: IntakeJournalHistoryFilters;
	journalHistoryLoading: boolean;
	journalHistoryError: string | null;
	resetJournalState: () => void;
	openJournalEditor: (doseId: string) => Promise<void>;
	closeJournalEditor: () => void;
	saveJournalNote: (note: string, mood?: IntakeMood | null) => Promise<boolean>;
	deleteJournalNote: () => Promise<boolean>;
	openJournalHistory: () => void;
	closeJournalHistory: () => void;
	setJournalHistoryFilters: (patch: Partial<IntakeJournalHistoryFilters>) => void;
	reloadJournalHistory: () => Promise<void>;
	reopenJournalHistoryEntry: (doseId: string) => Promise<void>;
}

const DEFAULT_HISTORY_FILTERS: IntakeJournalHistoryFilters = {
	medicationId: null,
	from: "",
	to: "",
	limit: 100,
};

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
	try {
		const data = (await response.json()) as { error?: string; code?: string };
		if (typeof data.error === "string" && data.error.trim().length > 0) {
			return data.error;
		}
		if (typeof data.code === "string" && data.code.trim().length > 0) {
			return data.code;
		}
	} catch {
		// Fall back to the supplied message when the response body is not JSON.
	}

	return fallbackMessage;
}

function buildHistoryQuery(filters: IntakeJournalHistoryFilters): string {
	const params = new URLSearchParams();
	if (typeof filters.medicationId === "number") {
		params.set("medicationId", String(filters.medicationId));
	}
	if (filters.from.trim().length > 0) {
		params.set("from", filters.from.trim());
	}
	if (filters.to.trim().length > 0) {
		params.set("to", filters.to.trim());
	}
	params.set("limit", String(filters.limit));

	const query = params.toString();
	return query.length > 0 ? `?${query}` : "";
}

export function useIntakeJournal(): UseIntakeJournalReturn {
	const { authFetch } = useAuth();
	const { t } = useTranslation();
	const [journalEditorOpen, setJournalEditorOpen] = useState(false);
	const [journalHistoryOpen, setJournalHistoryOpen] = useState(false);
	const [journalTargetDoseId, setJournalTargetDoseId] = useState<string | null>(null);
	const [journalEvent, setJournalEvent] = useState<IntakeJournalEntry | null>(null);
	const [journalEventLoading, setJournalEventLoading] = useState(false);
	const [journalEventSaving, setJournalEventSaving] = useState(false);
	const [journalEventDeleting, setJournalEventDeleting] = useState(false);
	const [journalEventError, setJournalEventError] = useState<string | null>(null);
	const [journalHistoryEntries, setJournalHistoryEntries] = useState<IntakeJournalEntry[]>([]);
	const [journalHistoryFilters, setJournalHistoryFiltersState] =
		useState<IntakeJournalHistoryFilters>(DEFAULT_HISTORY_FILTERS);
	const [journalHistoryLoading, setJournalHistoryLoading] = useState(false);
	const [journalHistoryError, setJournalHistoryError] = useState<string | null>(null);

	const resetJournalState = useCallback(() => {
		setJournalEditorOpen(false);
		setJournalHistoryOpen(false);
		setJournalTargetDoseId(null);
		setJournalEvent(null);
		setJournalEventLoading(false);
		setJournalEventSaving(false);
		setJournalEventDeleting(false);
		setJournalEventError(null);
		setJournalHistoryEntries([]);
		setJournalHistoryFiltersState(DEFAULT_HISTORY_FILTERS);
		setJournalHistoryLoading(false);
		setJournalHistoryError(null);
	}, []);

	const loadJournalEvent = useCallback(
		async (doseId: string) => {
			setJournalEventLoading(true);
			setJournalEventError(null);

			try {
				const response = await authFetch(`/api/intake-journal/event/${encodeURIComponent(doseId)}`);

				if (!response.ok) {
					const message = await readErrorMessage(response, t("journal.errors.loadFailed"));
					setJournalEvent(null);
					setJournalEventError(message);
					return;
				}

				const data = (await response.json()) as { entry: IntakeJournalEntry };
				setJournalEvent(data.entry);
			} catch {
				setJournalEvent(null);
				setJournalEventError(t("journal.errors.loadFailed"));
			} finally {
				setJournalEventLoading(false);
			}
		},
		[authFetch, t]
	);

	const loadJournalHistory = useCallback(
		async (filters: IntakeJournalHistoryFilters) => {
			setJournalHistoryLoading(true);
			setJournalHistoryError(null);

			try {
				const response = await authFetch(`/api/intake-journal${buildHistoryQuery(filters)}`);

				if (!response.ok) {
					const message = await readErrorMessage(response, t("journal.errors.historyFailed"));
					setJournalHistoryEntries([]);
					setJournalHistoryError(message);
					return;
				}

				const data = (await response.json()) as { entries: IntakeJournalEntry[] };
				setJournalHistoryEntries(Array.isArray(data.entries) ? data.entries : []);
			} catch {
				setJournalHistoryEntries([]);
				setJournalHistoryError(t("journal.errors.historyFailed"));
			} finally {
				setJournalHistoryLoading(false);
			}
		},
		[authFetch, t]
	);

	useEffect(() => {
		if (!journalHistoryOpen) {
			return;
		}

		void loadJournalHistory(journalHistoryFilters);
	}, [journalHistoryFilters, journalHistoryOpen, loadJournalHistory]);

	const openJournalEditor = useCallback(
		async (doseId: string) => {
			setJournalHistoryOpen(false);
			setJournalEditorOpen(true);
			setJournalTargetDoseId(doseId);
			setJournalEvent(null);
			await loadJournalEvent(doseId);
		},
		[loadJournalEvent]
	);

	const closeJournalEditor = useCallback(() => {
		setJournalEditorOpen(false);
		setJournalTargetDoseId(null);
		setJournalEvent(null);
		setJournalEventError(null);
		setJournalEventLoading(false);
		setJournalEventSaving(false);
		setJournalEventDeleting(false);
	}, []);

	const saveJournalNote = useCallback(
		async (note: string, mood: IntakeMood | null = null) => {
			if (!journalTargetDoseId) {
				setJournalEventError(t("journal.errors.noEventSelected"));
				return false;
			}

			setJournalEventSaving(true);
			setJournalEventError(null);

			try {
				const response = await authFetch(`/api/intake-journal/event/${encodeURIComponent(journalTargetDoseId)}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ note, mood }),
				});

				if (!response.ok) {
					const message = await readErrorMessage(response, t("journal.errors.saveFailed"));
					setJournalEventError(message);
					return false;
				}

				const data = (await response.json()) as { entry: IntakeJournalEntry };
				setJournalEvent(data.entry);
				if (journalHistoryOpen) {
					void loadJournalHistory(journalHistoryFilters);
				}
				return true;
			} catch {
				setJournalEventError(t("journal.errors.saveFailed"));
				return false;
			} finally {
				setJournalEventSaving(false);
			}
		},
		[authFetch, journalHistoryFilters, journalHistoryOpen, journalTargetDoseId, loadJournalHistory, t]
	);

	const deleteJournalNote = useCallback(async () => {
		if (!journalTargetDoseId) {
			setJournalEventError(t("journal.errors.noEventSelected"));
			return false;
		}

		setJournalEventDeleting(true);
		setJournalEventError(null);

		try {
			const response = await authFetch(`/api/intake-journal/event/${encodeURIComponent(journalTargetDoseId)}`, {
				method: "DELETE",
			});

			if (!response.ok) {
				const message = await readErrorMessage(response, t("journal.errors.deleteFailed"));
				setJournalEventError(message);
				return false;
			}

			setJournalEvent((previous) =>
				previous ? { ...previous, mood: null, note: null, updatedAt: null, createdAt: null } : previous
			);
			if (journalHistoryOpen) {
				void loadJournalHistory(journalHistoryFilters);
			}
			return true;
		} catch {
			setJournalEventError(t("journal.errors.deleteFailed"));
			return false;
		} finally {
			setJournalEventDeleting(false);
		}
	}, [authFetch, journalHistoryFilters, journalHistoryOpen, journalTargetDoseId, loadJournalHistory, t]);

	const openJournalHistory = useCallback(() => {
		setJournalEditorOpen(false);
		setJournalHistoryOpen(true);
		setJournalHistoryError(null);
	}, []);

	const closeJournalHistory = useCallback(() => {
		setJournalHistoryOpen(false);
		setJournalHistoryError(null);
	}, []);

	useModalHistory(journalEditorOpen, "intake-journal-editor", closeJournalEditor);
	useModalHistory(journalHistoryOpen, "intake-journal-history", closeJournalHistory);

	const updateJournalHistoryFilters = useCallback((patch: Partial<IntakeJournalHistoryFilters>) => {
		setJournalHistoryFiltersState((previous) => ({
			...previous,
			...patch,
		}));
	}, []);

	const reloadJournalHistory = useCallback(async () => {
		await loadJournalHistory(journalHistoryFilters);
	}, [journalHistoryFilters, loadJournalHistory]);

	const reopenJournalHistoryEntry = useCallback(
		async (doseId: string) => {
			setJournalHistoryOpen(false);
			await openJournalEditor(doseId);
		},
		[openJournalEditor]
	);

	return {
		journalEditorOpen,
		journalHistoryOpen,
		journalTargetDoseId,
		journalEvent,
		journalEventLoading,
		journalEventSaving,
		journalEventDeleting,
		journalEventError,
		journalHistoryEntries,
		journalHistoryFilters,
		journalHistoryLoading,
		journalHistoryError,
		resetJournalState,
		openJournalEditor,
		closeJournalEditor,
		saveJournalNote,
		deleteJournalNote,
		openJournalHistory,
		closeJournalHistory,
		setJournalHistoryFilters: updateJournalHistoryFilters,
		reloadJournalHistory,
		reopenJournalHistoryEntry,
	};
}
