// =============================================================================
// useDoses Hook - Dose tracking state and operations
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseDosesReturn {
	takenDoses: Set<string>;
	setTakenDoses: React.Dispatch<React.SetStateAction<Set<string>>>;
	takenDoseTimestamps: Map<string, number>;
	dismissedDoses: Set<string>;
	showClearMissedConfirm: boolean;
	setShowClearMissedConfirm: (show: boolean) => void;
	getDoseId: (baseDoseId: string, person: string | null) => string;
	countTakenDoses: (doses: Array<{ id: string; takenBy: string[] }>) => { total: number; taken: number };
	markDoseTaken: (doseId: string) => Promise<void>;
	undoDoseTaken: (doseId: string) => Promise<void>;
	loadTakenDoses: () => Promise<void>;
}

export function useDoses(): UseDosesReturn {
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [takenDoseTimestamps, setTakenDoseTimestamps] = useState<Map<string, number>>(new Map());
	const [dismissedDoses, setDismissedDoses] = useState<Set<string>>(new Set());
	const [showClearMissedConfirm, setShowClearMissedConfirm] = useState(false);

	// Track in-flight mutations to prevent polling from overwriting optimistic updates
	const mutationInFlightRef = useRef(0);

	// Load taken doses from server
	const loadTakenDoses = useCallback(async () => {
		// Skip polling while mutations are in-flight to prevent race conditions
		// where a poll response with stale data overwrites optimistic updates
		if (mutationInFlightRef.current > 0) return;

		try {
			const res = await fetch("/api/doses/taken", { credentials: "include" });
			if (res.ok) {
				// Double-check no mutation started while we were fetching
				if (mutationInFlightRef.current > 0) return;

				const data = await res.json();
				const taken = new Set<string>();
				const timestamps = new Map<string, number>();
				const dismissed = new Set<string>();
				for (const d of data.doses) {
					if (d.dismissed) {
						dismissed.add(d.doseId);
					} else {
						taken.add(d.doseId);
						timestamps.set(d.doseId, d.takenAt);
					}
				}
				setTakenDoses(taken);
				setTakenDoseTimestamps(timestamps);
				setDismissedDoses(dismissed);
			}
			// Don't reset on error - keep current state
		} catch {
			// Don't reset on error - keep current state
		}
	}, []);

	// Poll for taken doses from server (works with or without auth)
	useEffect(() => {
		loadTakenDoses();

		// Poll for updates every 5 seconds (real-time sync with share links)
		const interval = setInterval(loadTakenDoses, 5000);
		return () => clearInterval(interval);
	}, [loadTakenDoses]);

	// Get dose ID with optional person suffix
	const getDoseId = useCallback((baseDoseId: string, person: string | null): string => {
		return person ? `${baseDoseId}-${person}` : baseDoseId;
	}, []);

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

	const markDoseTaken = useCallback(
		async (doseId: string) => {
			// Optimistic update
			mutationInFlightRef.current++;
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
			setTakenDoseTimestamps((prev) => {
				const next = new Map(prev);
				next.set(doseId, Date.now());
				return next;
			});

			// Send to server
			try {
				await fetch("/api/doses/taken", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ doseId }),
				});
			} catch {
				// Revert on error
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
			} finally {
				mutationInFlightRef.current--;
				// Re-sync with server after mutation completes
				loadTakenDoses();
			}
		},
		[loadTakenDoses]
	);

	const undoDoseTaken = useCallback(
		async (doseId: string) => {
			// Optimistic update
			mutationInFlightRef.current++;
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

			// Send to server
			try {
				await fetch(`/api/doses/taken/${encodeURIComponent(doseId)}`, {
					method: "DELETE",
					credentials: "include",
				});
			} catch {
				// Revert on error
				setTakenDoses((prev) => {
					const next = new Set(prev);
					next.add(doseId);
					return next;
				});
			} finally {
				mutationInFlightRef.current--;
				// Re-sync with server after mutation completes
				loadTakenDoses();
			}
		},
		[loadTakenDoses]
	);

	return {
		takenDoses,
		setTakenDoses,
		takenDoseTimestamps,
		dismissedDoses,
		showClearMissedConfirm,
		setShowClearMissedConfirm,
		getDoseId,
		countTakenDoses,
		markDoseTaken,
		undoDoseTaken,
		loadTakenDoses,
	};
}
