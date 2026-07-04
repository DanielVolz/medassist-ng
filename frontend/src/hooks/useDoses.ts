// =============================================================================
// useDoses Hook - Dose tracking state and operations
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { useFeedback } from "../context/FeedbackContext";
import { log } from "../utils/logger";

export interface UseDosesReturn {
	takenDoses: Set<string>;
	setTakenDoses: React.Dispatch<React.SetStateAction<Set<string>>>;
	takenDoseTimestamps: Map<string, number>;
	takenDoseSources: Map<string, "manual" | "automatic">;
	skippedDoses: Set<string>;
	dismissedDoses: Set<string>;
	clearDosesState: () => void;
	getDoseId: (baseDoseId: string, person: string | null) => string;
	isDoseTakenAutomatically: (doseId: string) => boolean;
	countTakenDoses: (doses: Array<{ id: string; takenBy: string[] }>) => { total: number; taken: number };
	markDoseTaken: (doseId: string) => Promise<void>;
	markDoseSkipped: (doseId: string) => Promise<void>;
	undoDoseTaken: (doseId: string) => Promise<void>;
	undoDoseSkipped: (doseId: string) => Promise<void>;
	loadTakenDoses: () => Promise<void>;
}

interface UseDosesOptions {
	loadOnMount?: boolean;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useDoses(options: UseDosesOptions = {}): UseDosesReturn {
	const loadOnMount = options.loadOnMount ?? true;
	const { t } = useTranslation();
	const { authFetch } = useAuth();
	const { showFeedback } = useFeedback();
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [takenDoseTimestamps, setTakenDoseTimestamps] = useState<Map<string, number>>(new Map());
	const [takenDoseSources, setTakenDoseSources] = useState<Map<string, "manual" | "automatic">>(new Map());
	const [dismissedDoses, setDismissedDoses] = useState<Set<string>>(new Set());

	// Track in-flight mutations to prevent polling from overwriting optimistic updates
	const mutationInFlightRef = useRef(0);
	const loadInFlightRef = useRef(false);
	const loadGenerationRef = useRef(0);

	const clearDosesState = useCallback(() => {
		setTakenDoses(new Set());
		setTakenDoseTimestamps(new Map());
		setTakenDoseSources(new Map());
		setDismissedDoses(new Set());
		mutationInFlightRef.current = 0;
		loadGenerationRef.current += 1;
		loadInFlightRef.current = false;
	}, []);

	const clearTakenDoseState = useCallback((doseId: string) => {
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});
		setTakenDoseTimestamps((prev) => {
			const next = new Map(prev);
			next.delete(doseId);
			return next;
		});
		setTakenDoseSources((prev) => {
			const next = new Map(prev);
			next.delete(doseId);
			return next;
		});
	}, []);

	const restoreTakenDoseState = useCallback(
		(options: {
			doseId: string;
			wasTaken: boolean;
			previousTimestamp?: number;
			previousSource?: "manual" | "automatic";
		}) => {
			setTakenDoses((prev) => {
				const next = new Set(prev);
				if (options.wasTaken) {
					next.add(options.doseId);
				}
				return next;
			});
			setTakenDoseTimestamps((prev) => {
				const next = new Map(prev);
				if (options.wasTaken && typeof options.previousTimestamp === "number") {
					next.set(options.doseId, options.previousTimestamp);
				}
				return next;
			});
			setTakenDoseSources((prev) => {
				const next = new Map(prev);
				if (options.wasTaken && options.previousSource) {
					next.set(options.doseId, options.previousSource);
				}
				return next;
			});
		},
		[]
	);

	// Load taken doses from server
	const loadTakenDoses = useCallback(async () => {
		// Skip polling while mutations are in-flight to prevent race conditions
		// where a poll response with stale data overwrites optimistic updates
		if (mutationInFlightRef.current > 0) return;
		if (loadInFlightRef.current) return;
		const generation = loadGenerationRef.current + 1;
		loadGenerationRef.current = generation;
		loadInFlightRef.current = true;

		try {
			const res = await authFetch("/api/doses/taken");
			if (loadGenerationRef.current !== generation) return;
			if (res.ok) {
				// Double-check no mutation started while we were fetching
				if (mutationInFlightRef.current > 0) return;
				if (loadGenerationRef.current !== generation) return;

				const data = await res.json();
				if (loadGenerationRef.current !== generation) return;
				const taken = new Set<string>();
				const timestamps = new Map<string, number>();
				const sources = new Map<string, "manual" | "automatic">();
				const dismissed = new Set<string>();
				for (const d of data.doses) {
					if (d.skipped === true || d.dismissed === true) {
						dismissed.add(d.doseId);
					} else {
						taken.add(d.doseId);
						timestamps.set(d.doseId, d.takenAt);
						sources.set(d.doseId, d.takenSource === "automatic" ? "automatic" : "manual");
					}
				}
				setTakenDoses(taken);
				setTakenDoseTimestamps(timestamps);
				setTakenDoseSources(sources);
				setDismissedDoses(dismissed);
			} else if (res.status === 401 || res.status === 403) {
				// Prevent showing previous user's dose state after auth/session changes.
				clearDosesState();
			} else {
				log.debug("[useDoses] dose polling failed", { status: res.status });
			}
			// Don't reset on error - keep current state
		} catch (error) {
			log.debug("[useDoses] dose polling request failed", { error: getErrorMessage(error) });
			// Don't reset on error - keep current state
		} finally {
			if (loadGenerationRef.current === generation) {
				loadInFlightRef.current = false;
			}
		}
	}, [authFetch, clearDosesState]);

	// Poll for taken doses from server (works with or without auth)
	useEffect(() => {
		if (loadOnMount) {
			void loadTakenDoses();
		}

		// Poll for updates every 5 seconds (real-time sync with share links)
		const interval = setInterval(loadTakenDoses, 5000);
		return () => clearInterval(interval);
	}, [loadOnMount, loadTakenDoses]);

	// Get dose ID with optional person suffix
	const getDoseId = useCallback((baseDoseId: string, person: string | null): string => {
		return person ? `${baseDoseId}-${person}` : baseDoseId;
	}, []);

	const isDoseTakenAutomatically = useCallback(
		(doseId: string): boolean => {
			return takenDoseSources.get(doseId) === "automatic";
		},
		[takenDoseSources]
	);

	// Count taken doses for a day/item
	const countTakenDoses = useCallback(
		(doses: Array<{ id: string; takenBy: string[] }>): { total: number; taken: number } => {
			let total = 0;
			let taken = 0;
			for (const d of doses) {
				const people = (d.takenBy || []).length > 0 ? d.takenBy : [null];
				for (const person of people) {
					total++;
					if (takenDoses.has(getDoseId(d.id, person))) taken++;
				}
			}
			return { total, taken };
		},
		[takenDoses, getDoseId]
	);

	const getErrorCode = useCallback(async (response: Response): Promise<string | null> => {
		try {
			const data = (await response.json()) as { code?: string };
			return typeof data.code === "string" ? data.code : null;
		} catch {
			return null;
		}
	}, []);

	const markDoseTaken = useCallback(
		async (doseId: string) => {
			if (dismissedDoses.has(doseId)) {
				return;
			}

			const wasTaken = takenDoses.has(doseId);
			const wasSkipped = dismissedDoses.has(doseId);
			const previousTimestamp = takenDoseTimestamps.get(doseId);
			const previousSource = takenDoseSources.get(doseId);

			// Optimistic update
			mutationInFlightRef.current++;
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});
			setTakenDoseTimestamps((prev) => {
				const next = new Map(prev);
				next.set(doseId, Date.now());
				return next;
			});
			setTakenDoseSources((prev) => {
				const next = new Map(prev);
				next.set(doseId, "manual");
				return next;
			});

			// Send to server
			let failureStatus: number | null = null;
			let failureCode: string | null = null;
			try {
				const response = await authFetch("/api/doses/taken", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ doseId }),
				});
				if (!response.ok) {
					failureStatus = response.status;
					failureCode = await getErrorCode(response);
					if (failureCode === "OUT_OF_STOCK") {
						showFeedback({ message: t("common.outOfStockTakeBlocked"), tone: "error" });
					} else if (failureCode === "FUTURE_DOSE") {
						showFeedback({ message: t("dose.actionBlocked.futureTake"), tone: "error" });
					}
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useDoses] mark dose taken failed", {
					status: failureStatus,
					code: failureCode,
					error: getErrorMessage(error),
				});
				// Revert on error
				setTakenDoses((prev) => {
					const next = new Set(prev);
					if (wasTaken) {
						next.add(doseId);
					} else {
						next.delete(doseId);
					}
					return next;
				});
				setDismissedDoses((prev) => {
					const next = new Set(prev);
					if (wasSkipped) {
						next.add(doseId);
					} else {
						next.delete(doseId);
					}
					return next;
				});
				setTakenDoseTimestamps((prev) => {
					const next = new Map(prev);
					if (wasTaken && typeof previousTimestamp === "number") {
						next.set(doseId, previousTimestamp);
					} else {
						next.delete(doseId);
					}
					return next;
				});
				setTakenDoseSources((prev) => {
					const next = new Map(prev);
					if (wasTaken && previousSource) {
						next.set(doseId, previousSource);
					} else {
						next.delete(doseId);
					}
					return next;
				});
			} finally {
				mutationInFlightRef.current--;
				// Re-sync with server after mutation completes
				loadTakenDoses();
			}
		},
		[
			authFetch,
			dismissedDoses,
			getErrorCode,
			loadTakenDoses,
			showFeedback,
			t,
			takenDoseSources,
			takenDoseTimestamps,
			takenDoses,
		]
	);

	const markDoseSkipped = useCallback(
		async (doseId: string) => {
			if (takenDoses.has(doseId)) {
				return;
			}

			const wasTaken = takenDoses.has(doseId);
			const wasSkipped = dismissedDoses.has(doseId);
			const previousTimestamp = takenDoseTimestamps.get(doseId);
			const previousSource = takenDoseSources.get(doseId);

			mutationInFlightRef.current++;
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
			clearTakenDoseState(doseId);

			let failureStatus: number | null = null;
			let failureCode: string | null = null;
			try {
				const response = await authFetch("/api/doses/skip", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ doseId }),
				});
				if (!response.ok) {
					failureStatus = response.status;
					failureCode = await getErrorCode(response);
					if (failureCode === "FUTURE_DOSE") {
						showFeedback({ message: t("dose.actionBlocked.futureSkip"), tone: "error" });
					}
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useDoses] mark dose skipped failed", {
					status: failureStatus,
					code: failureCode,
					error: getErrorMessage(error),
				});
				setDismissedDoses((prev) => {
					const next = new Set(prev);
					if (wasSkipped) {
						next.add(doseId);
					} else {
						next.delete(doseId);
					}
					return next;
				});
				restoreTakenDoseState({ doseId, wasTaken, previousTimestamp, previousSource });
			} finally {
				mutationInFlightRef.current--;
				loadTakenDoses();
			}
		},
		[
			authFetch,
			clearTakenDoseState,
			dismissedDoses,
			getErrorCode,
			loadTakenDoses,
			restoreTakenDoseState,
			showFeedback,
			t,
			takenDoseSources,
			takenDoseTimestamps,
			takenDoses,
		]
	);

	const undoDoseTaken = useCallback(
		async (doseId: string) => {
			const previousTimestamp = takenDoseTimestamps.get(doseId);
			const previousSource = takenDoseSources.get(doseId);

			// Optimistic update
			mutationInFlightRef.current++;
			clearTakenDoseState(doseId);

			// Send to server
			let failureStatus: number | null = null;
			try {
				const response = await authFetch(`/api/doses/taken/${encodeURIComponent(doseId)}`, {
					method: "DELETE",
				});
				if (!response.ok) {
					failureStatus = response.status;
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useDoses] undo dose taken failed", {
					status: failureStatus,
					error: getErrorMessage(error),
				});
				// Revert on error
				restoreTakenDoseState({ doseId, wasTaken: true, previousTimestamp, previousSource });
			} finally {
				mutationInFlightRef.current--;
				// Re-sync with server after mutation completes
				loadTakenDoses();
			}
		},
		[authFetch, clearTakenDoseState, loadTakenDoses, restoreTakenDoseState, takenDoseSources, takenDoseTimestamps]
	);

	const undoDoseSkipped = useCallback(
		async (doseId: string) => {
			const wasSkipped = dismissedDoses.has(doseId);

			mutationInFlightRef.current++;
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});

			let failureStatus: number | null = null;
			try {
				const response = await authFetch(`/api/doses/skip/${encodeURIComponent(doseId)}`, {
					method: "DELETE",
				});
				if (!response.ok) {
					failureStatus = response.status;
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useDoses] undo dose skipped failed", {
					status: failureStatus,
					error: getErrorMessage(error),
				});
				setDismissedDoses((prev) => {
					const next = new Set(prev);
					if (wasSkipped) {
						next.add(doseId);
					}
					return next;
				});
			} finally {
				mutationInFlightRef.current--;
				loadTakenDoses();
			}
		},
		[authFetch, dismissedDoses, loadTakenDoses]
	);

	return {
		takenDoses,
		setTakenDoses,
		takenDoseTimestamps,
		takenDoseSources,
		skippedDoses: dismissedDoses,
		dismissedDoses,
		clearDosesState,
		getDoseId,
		isDoseTakenAutomatically,
		countTakenDoses,
		markDoseTaken,
		markDoseSkipped,
		undoDoseTaken,
		undoDoseSkipped,
		loadTakenDoses,
	};
}
