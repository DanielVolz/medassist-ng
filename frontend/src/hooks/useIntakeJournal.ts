import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import type { IntakeMood } from "../utils/intake-mood";
import { useModalHistory } from "./useModalHistory";

export type IntakeJournalEntry = {
	eventType?: "scheduled" | "as_needed";
	eventId?: string | null;
	doseTrackingId: number;
	doseId: string;
	medicationId: number;
	medicationName: string;
	scheduledFor: string | null;
	occurredAt?: string | null;
	status?: "taken" | "skipped" | "active" | "reversed";
	takenAt: string | null;
	dismissed: boolean;
	takenSource: "manual" | "automatic" | "notification" | "owner_as_needed";
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

type UseIntakeJournalOptions = {
	manageProgrammaticClose?: boolean;
	onEventReversed?: () => void;
};

const DEFAULT_HISTORY_FILTERS: IntakeJournalHistoryFilters = {
	medicationId: null,
	from: "",
	to: "",
	limit: 100,
};

async function readErrorCode(response: Response): Promise<string | null> {
	try {
		const data = (await response.json()) as { code?: string };
		if (typeof data.code === "string" && data.code.trim().length > 0) {
			return data.code;
		}
	} catch {
		// The caller maps missing or malformed error bodies to a translated fallback.
	}

	return null;
}

function getJournalErrorMessage(
	code: string | null,
	fallbackKey: "loadFailed" | "historyFailed" | "saveFailed" | "deleteFailed",
	t: (key: string) => string
): string {
	if (code === "EVENT_REVERSED") return t("journal.errors.eventReversed");
	if (code === "API_KEY_SCOPE_FORBIDDEN" || code === "READ_ONLY") return t("journal.errors.readOnly");
	if (code === "DOSE_NOT_FOUND") return t("journal.errors.notFound");
	return t(`journal.errors.${fallbackKey}`);
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

export function useIntakeJournal(options: UseIntakeJournalOptions = {}): UseIntakeJournalReturn {
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
	const editorRequestVersionRef = useRef(0);
	const editorAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => editorAbortRef.current?.abort();
	}, []);

	const resetJournalState = useCallback(() => {
		editorAbortRef.current?.abort();
		editorRequestVersionRef.current += 1;
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
			editorAbortRef.current?.abort();
			const controller = new AbortController();
			editorAbortRef.current = controller;
			const requestVersion = ++editorRequestVersionRef.current;
			setJournalEventLoading(true);
			setJournalEventError(null);

			try {
				const response = await authFetch(`/api/intake-journal/event/${encodeURIComponent(doseId)}`, {
					signal: controller.signal,
				});

				if (!response.ok) {
					const code = await readErrorCode(response);
					if (requestVersion !== editorRequestVersionRef.current) return;
					setJournalEvent(null);
					setJournalEventError(getJournalErrorMessage(code, "loadFailed", t));
					return;
				}

				const data = (await response.json()) as { entry: IntakeJournalEntry };
				if (requestVersion !== editorRequestVersionRef.current) return;
				setJournalEvent(data.entry);
			} catch {
				if (requestVersion !== editorRequestVersionRef.current) return;
				setJournalEvent(null);
				setJournalEventError(t("journal.errors.loadFailed"));
			} finally {
				if (requestVersion === editorRequestVersionRef.current) setJournalEventLoading(false);
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
					const code = await readErrorCode(response);
					setJournalHistoryEntries([]);
					setJournalHistoryError(getJournalErrorMessage(code, "historyFailed", t));
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

	const dismissJournalEditor = useCallback(() => {
		editorAbortRef.current?.abort();
		editorRequestVersionRef.current += 1;
		setJournalEditorOpen(false);
		setJournalTargetDoseId(null);
		setJournalEvent(null);
		setJournalEventError(null);
		setJournalEventLoading(false);
		setJournalEventSaving(false);
		setJournalEventDeleting(false);
	}, []);
	const { closeModal: closeJournalEditorWithHistory } = useModalHistory(
		journalEditorOpen,
		"intake-journal-editor",
		dismissJournalEditor
	);
	const closeJournalEditor = options.manageProgrammaticClose ? closeJournalEditorWithHistory : dismissJournalEditor;

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
					const code = await readErrorCode(response);
					setJournalEventError(getJournalErrorMessage(code, "saveFailed", t));
					if (code === "EVENT_REVERSED") {
						await loadJournalEvent(journalTargetDoseId);
						setJournalEventError(t("journal.errors.eventReversed"));
						options.onEventReversed?.();
					}
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
		[
			authFetch,
			journalHistoryFilters,
			journalHistoryOpen,
			journalTargetDoseId,
			loadJournalEvent,
			loadJournalHistory,
			options.onEventReversed,
			t,
		]
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
				const code = await readErrorCode(response);
				setJournalEventError(getJournalErrorMessage(code, "deleteFailed", t));
				if (code === "EVENT_REVERSED") {
					await loadJournalEvent(journalTargetDoseId);
					setJournalEventError(t("journal.errors.eventReversed"));
					options.onEventReversed?.();
				}
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
	}, [
		authFetch,
		journalHistoryFilters,
		journalHistoryOpen,
		journalTargetDoseId,
		loadJournalEvent,
		loadJournalHistory,
		options.onEventReversed,
		t,
	]);

	const openJournalHistory = useCallback(() => {
		setJournalEditorOpen(false);
		setJournalHistoryOpen(true);
		setJournalHistoryError(null);
	}, []);

	const dismissJournalHistory = useCallback(() => {
		setJournalHistoryOpen(false);
		setJournalHistoryError(null);
	}, []);
	useModalHistory(journalHistoryOpen, "intake-journal-history", dismissJournalHistory);
	const closeJournalHistory = dismissJournalHistory;

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
