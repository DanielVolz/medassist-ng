import { useState, useCallback } from "react";
import type { Medication, RefillEntry, Coverage, FormState } from "../types";
import { getMedTotal } from "../types";

export interface UseRefillReturn {
	// Refill state
	showRefillModal: boolean;
	setShowRefillModal: React.Dispatch<React.SetStateAction<boolean>>;
	refillPacks: number;
	setRefillPacks: React.Dispatch<React.SetStateAction<number>>;
	refillLoose: number;
	setRefillLoose: React.Dispatch<React.SetStateAction<number>>;
	refillSaving: boolean;
	refillHistory: RefillEntry[];
	refillHistoryExpanded: boolean;
	setRefillHistoryExpanded: React.Dispatch<React.SetStateAction<boolean>>;
	
	// Edit stock (correction) state
	showEditStockModal: boolean;
	setShowEditStockModal: React.Dispatch<React.SetStateAction<boolean>>;
	editStockFullBlisters: number;
	setEditStockFullBlisters: React.Dispatch<React.SetStateAction<number>>;
	editStockPartialBlisterPills: number;
	setEditStockPartialBlisterPills: React.Dispatch<React.SetStateAction<number>>;
	editStockSaving: boolean;
	
	// Actions
	loadRefillHistory: (medId: number) => Promise<void>;
	submitRefill: (
		medId: number,
		editingId: number | null,
		setForm: React.Dispatch<React.SetStateAction<FormState>>,
		loadMeds: () => void
	) => Promise<void>;
	submitStockCorrection: (
		medId: number,
		selectedMed: Medication,
		loadMeds: () => void
	) => Promise<void>;
	openRefillModal: () => void;
	closeRefillModal: () => void;
	openEditStockModal: (selectedMed: Medication, coverage: { all: Coverage[] }) => void;
	closeEditStockModal: () => void;
}

export function useRefill(): UseRefillReturn {
	// Refill state
	const [showRefillModal, setShowRefillModal] = useState(false);
	const [refillPacks, setRefillPacks] = useState(1);
	const [refillLoose, setRefillLoose] = useState(0);
	const [refillSaving, setRefillSaving] = useState(false);
	const [refillHistory, setRefillHistory] = useState<RefillEntry[]>([]);
	const [refillHistoryExpanded, setRefillHistoryExpanded] = useState(false);
	
	// Edit stock (correction) state
	const [showEditStockModal, setShowEditStockModal] = useState(false);
	const [editStockFullBlisters, setEditStockFullBlisters] = useState(0);
	const [editStockPartialBlisterPills, setEditStockPartialBlisterPills] = useState(0);
	const [editStockSaving, setEditStockSaving] = useState(false);

	// Load refill history for a medication
	const loadRefillHistory = useCallback(async (medId: number) => {
		try {
			const res = await fetch(`/api/medications/${medId}/refills`, { credentials: "include" });
			if (res.ok) {
				const data = await res.json();
				setRefillHistory(Array.isArray(data) ? data : (data.refills || []));
			} else {
				setRefillHistory([]);
			}
		} catch {
			setRefillHistory([]);
		}
	}, []);

	// Submit a refill
	const submitRefill = useCallback(async (
		medId: number,
		editingId: number | null,
		setForm: React.Dispatch<React.SetStateAction<FormState>>,
		loadMeds: () => void
	) => {
		if (refillPacks < 1 && refillLoose < 1) return;
		setRefillSaving(true);
		try {
			const res = await fetch(`/api/medications/${medId}/refill`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ packsAdded: refillPacks, loosePillsAdded: refillLoose }),
			});
			if (res.ok) {
				const data = await res.json();
				// Update form values if we're in edit mode
				if (editingId === medId && data.newStock) {
					setForm(f => ({
						...f,
						packCount: String(data.newStock.packCount),
						looseTablets: String(data.newStock.looseTablets),
					}));
				}
				// Reset refill form
				setRefillPacks(1);
				setRefillLoose(0);
				// Close refill modal via history back for proper back-button support
				if (showRefillModal) {
					window.history.back();
				}
				// Reload medications to get updated stock
				loadMeds();
				// Reload refill history
				await loadRefillHistory(medId);
			}
		} catch {
			// ignore
		}
		setRefillSaving(false);
	}, [refillPacks, refillLoose, showRefillModal, loadRefillHistory]);

	// Submit a stock correction - user says how many pills they have RIGHT NOW
	const submitStockCorrection = useCallback(async (
		medId: number,
		selectedMed: Medication,
		loadMeds: () => void
	) => {
		if (!selectedMed) return;
		setEditStockSaving(true);
		try {
			// Auto-convert: handle full blister and negative partial blister
			let finalFullBlisters = editStockFullBlisters;
			let finalPartialPills = editStockPartialBlisterPills;
			
			// Handle full blister: e.g. 9 pills in a 9-pill blister = +1 full blister, 0 partial
			if (finalPartialPills >= selectedMed.pillsPerBlister) {
				finalFullBlisters += 1;
				finalPartialPills = 0;
			}
			
			// Handle negative partial: e.g. -3 with 136 full = 135 full, 6 partial (for 9-pill blister)
			if (finalPartialPills < 0 && finalFullBlisters > 0) {
				finalFullBlisters -= 1;
				finalPartialPills = selectedMed.pillsPerBlister + finalPartialPills;
			}
			
			// Ensure we don't go negative
			if (finalPartialPills < 0) finalPartialPills = 0;
			if (finalFullBlisters < 0) finalFullBlisters = 0;
			
			// What the user says they have RIGHT NOW = the new DB total
			const desiredTotal = finalFullBlisters * selectedMed.pillsPerBlister + finalPartialPills;
			
			// The "base" from DB structure (without any stockAdjustment)
			const baseTotal = selectedMed.packCount * selectedMed.blistersPerPack * selectedMed.pillsPerBlister + selectedMed.looseTablets;
			
			// stockAdjustment = what we need to make getMedTotal() return desiredTotal
			const newStockAdjustment = desiredTotal - baseTotal;
			
			// Use the PATCH endpoint - it sets stockAdjustment AND lastStockCorrectionAt
			const res = await fetch(`/api/medications/${medId}/stock-adjustment`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ stockAdjustment: newStockAdjustment }),
			});
			if (res.ok) {
				// Close edit stock modal via history back
				if (showEditStockModal) {
					window.history.back();
				}
				// Reload medications to get updated stock
				loadMeds();
			}
		} catch {
			// ignore
		}
		setEditStockSaving(false);
	}, [editStockFullBlisters, editStockPartialBlisterPills, showEditStockModal]);

	const openRefillModal = useCallback(() => {
		setShowRefillModal(true);
		window.history.pushState({ modal: 'refill' }, '');
	}, []);

	const closeRefillModal = useCallback(() => {
		if (showRefillModal) {
			window.history.back();
		}
	}, [showRefillModal]);

	const openEditStockModal = useCallback((selectedMed: Medication, coverage: { all: Coverage[] }) => {
		if (!selectedMed) return;
		// Get current stock from coverage (after consumption)
		const medCoverage = coverage.all.find(c => c.name === selectedMed.name);
		const dbTotal = getMedTotal(selectedMed);
		const currentStock = medCoverage ? Math.round(medCoverage.medsLeft) : dbTotal;
		
		// Simply divide into full blisters and partial
		const fullBlisters = Math.floor(currentStock / selectedMed.pillsPerBlister);
		const partialPills = currentStock % selectedMed.pillsPerBlister;
		
		// Pre-fill with current values
		setEditStockFullBlisters(fullBlisters);
		setEditStockPartialBlisterPills(partialPills);
		setShowEditStockModal(true);
		window.history.pushState({ modal: 'editStock' }, '');
	}, []);

	const closeEditStockModal = useCallback(() => {
		if (showEditStockModal) {
			window.history.back();
		}
	}, [showEditStockModal]);

	return {
		showRefillModal,
		setShowRefillModal,
		refillPacks,
		setRefillPacks,
		refillLoose,
		setRefillLoose,
		refillSaving,
		refillHistory,
		refillHistoryExpanded,
		setRefillHistoryExpanded,
		showEditStockModal,
		setShowEditStockModal,
		editStockFullBlisters,
		setEditStockFullBlisters,
		editStockPartialBlisterPills,
		setEditStockPartialBlisterPills,
		editStockSaving,
		loadRefillHistory,
		submitRefill,
		submitStockCorrection,
		openRefillModal,
		closeRefillModal,
		openEditStockModal,
		closeEditStockModal,
	};
}
