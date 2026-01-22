// =============================================================================
// useDoses Hook - Dose tracking state and operations
// =============================================================================

import { useCallback, useEffect, useState } from "react";

export interface UseDosesReturn {
	takenDoses: Set<string>;
	setTakenDoses: React.Dispatch<React.SetStateAction<Set<string>>>;
	dismissedDoses: Set<string>;
	clearingMissed: boolean;
	showClearMissedConfirm: boolean;
	setShowClearMissedConfirm: (show: boolean) => void;
	getDoseId: (baseDoseId: string, person: string | null) => string;
	countTakenDoses: (doses: Array<{ id: string; takenBy: string[] }>) => { total: number; taken: number };
	markDoseTaken: (doseId: string) => Promise<void>;
	undoDoseTaken: (doseId: string) => Promise<void>;
	dismissMissedDoses: (doseIds: string[]) => Promise<void>;
	loadTakenDoses: () => Promise<void>;
}

export function useDoses(): UseDosesReturn {
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [dismissedDoses, setDismissedDoses] = useState<Set<string>>(new Set());
	const [showClearMissedConfirm, setShowClearMissedConfirm] = useState(false);
	const [clearingMissed, setClearingMissed] = useState(false);

	// Load taken doses from server
	const loadTakenDoses = useCallback(async () => {
		try {
			const res = await fetch("/api/doses/taken", { credentials: "include" });
			if (res.ok) {
				const data = await res.json();
				const taken = new Set<string>();
				const dismissed = new Set<string>();
				for (const d of data.doses) {
					if (d.dismissed) {
						dismissed.add(d.doseId);
					} else {
						taken.add(d.doseId);
					}
				}
				setTakenDoses(taken);
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

	const markDoseTaken = useCallback(async (doseId: string) => {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});

		// Send to server
		try {
			await fetch("/api/doses/taken", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ doseId })
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});
		}
	}, []);

	const undoDoseTaken = useCallback(async (doseId: string) => {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		// Send to server
		try {
			await fetch(`/api/doses/taken/${encodeURIComponent(doseId)}`, {
				method: "DELETE",
				credentials: "include"
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
		}
	}, []);

	// Dismiss missed doses without deducting from stock
	const dismissMissedDoses = useCallback(async (doseIds: string[]) => {
		if (doseIds.length === 0) return;

		setClearingMissed(true);
		try {
			const res = await fetch("/api/doses/dismiss", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ doseIds })
			});

			if (res.ok) {
				// Update local state - move these from neither set to dismissed set
				setDismissedDoses((prev) => {
					const next = new Set(prev);
					for (const id of doseIds) next.add(id);
					return next;
				});
				setShowClearMissedConfirm(false);
			}
		} catch {
			// Error - dialog stays open
		} finally {
			setClearingMissed(false);
		}
	}, []);

	return {
		takenDoses,
		setTakenDoses,
		dismissedDoses,
		clearingMissed,
		showClearMissedConfirm,
		setShowClearMissedConfirm,
		getDoseId,
		countTakenDoses,
		markDoseTaken,
		undoDoseTaken,
		dismissMissedDoses,
		loadTakenDoses
	};
}
