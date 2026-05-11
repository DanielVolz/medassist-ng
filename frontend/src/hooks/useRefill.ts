import { useCallback, useEffect, useState } from "react";
import type { Coverage, FormState, Medication, RefillEntry } from "../types";
import {
	getMedTotal,
	getPackageSize,
	isAmountBasedPackageType,
	isDiscreteCountPackageType,
	isLiquidContainerPackageType,
	isPackageAmountPackageType,
	isTubePackageType,
} from "../types";

export interface UseRefillReturn {
	// Refill state
	showRefillModal: boolean;
	setShowRefillModal: React.Dispatch<React.SetStateAction<boolean>>;
	refillPacks: number;
	setRefillPacks: React.Dispatch<React.SetStateAction<number>>;
	refillLoose: number;
	setRefillLoose: React.Dispatch<React.SetStateAction<number>>;
	usePrescriptionRefill: boolean;
	setUsePrescriptionRefill: React.Dispatch<React.SetStateAction<boolean>>;
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
	editStockLoosePills: number;
	setEditStockLoosePills: React.Dispatch<React.SetStateAction<number>>;
	editStockSaving: boolean;
	editStockMedication: Medication | null;

	// Actions
	clearRefillState: () => void;
	loadRefillHistory: (medId: number) => Promise<void>;
	submitRefill: (
		medId: number,
		editingId: number | null,
		setForm: React.Dispatch<React.SetStateAction<FormState>>,
		loadMeds: () => void,
		usePrescription?: boolean
	) => Promise<void>;
	submitStockCorrection: (medId: number, selectedMed: Medication, loadMeds: () => void) => Promise<void>;
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
	const [usePrescriptionRefill, setUsePrescriptionRefill] = useState(false);
	const [refillSaving, setRefillSaving] = useState(false);
	const [refillHistory, setRefillHistory] = useState<RefillEntry[]>([]);
	const [refillHistoryExpanded, setRefillHistoryExpanded] = useState(false);

	// Edit stock (correction) state
	const [showEditStockModal, setShowEditStockModal] = useState(false);
	const [editStockFullBlisters, setEditStockFullBlisters] = useState(0);
	const [editStockPartialBlisterPills, setEditStockPartialBlisterPills] = useState(0);
	const [editStockLoosePills, setEditStockLoosePills] = useState(0);
	const [editStockSaving, setEditStockSaving] = useState(false);
	const [editStockMedication, setEditStockMedication] = useState<Medication | null>(null);

	const resetRefillForm = useCallback(() => {
		setRefillPacks(1);
		setRefillLoose(0);
		setUsePrescriptionRefill(false);
		setRefillSaving(false);
	}, []);

	const clearRefillState = useCallback(() => {
		setShowRefillModal(false);
		resetRefillForm();
		setRefillHistory([]);
		setRefillHistoryExpanded(false);
		setShowEditStockModal(false);
		setEditStockFullBlisters(0);
		setEditStockPartialBlisterPills(0);
		setEditStockLoosePills(0);
		setEditStockSaving(false);
		setEditStockMedication(null);
	}, [resetRefillForm]);

	// Load refill history for a medication
	const loadRefillHistory = useCallback(async (medId: number) => {
		try {
			const res = await fetch(`/api/medications/${medId}/refills`, { credentials: "include" });
			if (res.ok) {
				const data = await res.json();
				setRefillHistory(Array.isArray(data) ? data : data.refills || []);
			} else {
				setRefillHistory([]);
			}
		} catch {
			setRefillHistory([]);
		}
	}, []);

	// Submit a refill
	const submitRefill = useCallback(
		async (
			medId: number,
			editingId: number | null,
			setForm: React.Dispatch<React.SetStateAction<FormState>>,
			loadMeds: () => void,
			usePrescription: boolean = false
		) => {
			if (refillPacks < 1 && refillLoose < 1) return;
			setRefillSaving(true);
			try {
				const res = await fetch(`/api/medications/${medId}/refill`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({
						packsAdded: refillPacks,
						loosePillsAdded: refillLoose,
						quantityAdded: refillLoose,
						usePrescription,
					}),
				});
				if (res.ok) {
					const data = await res.json();
					// Update form values if we're in edit mode
					if (editingId === medId && data.newStock) {
						setForm((f) => ({
							...f,
							packCount: String(data.newStock.packCount),
							looseTablets: String(data.newStock.looseTablets),
							prescriptionRemainingRefills:
								data.prescription?.remainingRefills != null
									? String(data.prescription.remainingRefills)
									: f.prescriptionRemainingRefills,
						}));
					}
					// Reset refill form
					setRefillPacks(1);
					setRefillLoose(0);
					setUsePrescriptionRefill(false);
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
		},
		[refillPacks, refillLoose, showRefillModal, loadRefillHistory]
	);

	// Submit a stock correction - user says how many pills they have RIGHT NOW
	const submitStockCorrection = useCallback(
		async (medId: number, selectedMed: Medication, loadMeds: () => void) => {
			if (!selectedMed) return;
			setEditStockSaving(true);
			try {
				const isTubePackage = isTubePackageType(selectedMed.packageType);
				const isLiquidPackage = isLiquidContainerPackageType(selectedMed.packageType);
				const isAmountPackage = isAmountBasedPackageType(selectedMed.packageType);
				const isPackageAmountPackage = isPackageAmountPackageType(selectedMed.packageType);
				const isDiscreteCountPackage = isDiscreteCountPackageType(selectedMed.packageType);
				const liquidAmountPerBottle = Math.max(
					1,
					Number.isFinite(Number(selectedMed.packageAmountValue)) && Number(selectedMed.packageAmountValue) > 0
						? Number(selectedMed.packageAmountValue)
						: Math.max(
								1,
								Math.round(Number(getPackageSize(selectedMed) || 0) / Math.max(1, Number(selectedMed.packCount || 1)))
							)
				);

				// Clamp all fields to non-negative values.
				let finalFullBlisters = Math.max(0, editStockFullBlisters);
				let finalPartialPills = isAmountPackage
					? Math.max(0, editStockPartialBlisterPills)
					: Math.max(0, editStockPartialBlisterPills);
				const finalLoosePills = Math.max(0, editStockLoosePills);

				// Canonicalize blister values: partial overflow becomes additional full blisters.
				if (!isAmountPackage && selectedMed.pillsPerBlister > 0) {
					finalFullBlisters += Math.floor(finalPartialPills / selectedMed.pillsPerBlister);
					finalPartialPills %= selectedMed.pillsPerBlister;
				}

				// Structural max = sealed package capacity only (no looseTablets offset).
				const structuralMax = isAmountPackage
					? (selectedMed.totalPills ?? getPackageSize(selectedMed))
					: selectedMed.packCount * selectedMed.blistersPerPack * selectedMed.pillsPerBlister;
				const isZeroReset = finalFullBlisters === 0 && finalPartialPills === 0 && finalLoosePills === 0;
				let correctedLiquidBottleCount = Math.max(0, selectedMed.packCount);
				if (isLiquidPackage) {
					correctedLiquidBottleCount = isZeroReset ? 0 : Math.max(1, finalFullBlisters);
				}
				const liquidStructuralMax = isLiquidPackage
					? correctedLiquidBottleCount * liquidAmountPerBottle
					: structuralMax;

				// For blister meds, only sealed pills are capped to package size.
				// Loose pills are extra and can be above package size.
				let desiredTotal: number;
				if (isTubePackage) {
					desiredTotal = Math.max(0, finalPartialPills);
				} else if (isAmountPackage) {
					desiredTotal = Math.min(liquidStructuralMax, Math.max(0, finalPartialPills));
				} else {
					desiredTotal =
						Math.min(structuralMax, finalFullBlisters * selectedMed.pillsPerBlister + finalPartialPills) +
						finalLoosePills;
				}

				// The "base" from DB structure used to compute stockAdjustment differs by type:
				// - Bottle: looseTablets is the base (not changed during correction)
				// - Blister: use structuralMax + finalLoosePills as the new base so that
				//   updating looseTablets in the DB doesn't cause a stale-split display bug.
				let baseTotal: number;
				if (isLiquidPackage) {
					baseTotal = liquidStructuralMax;
				} else if (isDiscreteCountPackage) {
					baseTotal = selectedMed.looseTablets;
				} else if (isPackageAmountPackage) {
					baseTotal = getPackageSize(selectedMed);
				} else {
					baseTotal = structuralMax + finalLoosePills; // blister: base = sealed capacity + NEW loose pills
				}
				// stockAdjustment = what we need to make getMedTotal() return desiredTotal
				const newStockAdjustment = desiredTotal - baseTotal;

				// For blister corrections also send the new looseTablets value so the DB
				// reflects the actual loose count (avoids stale-split display on reload).
				const patchBody: {
					stockAdjustment: number;
					looseTablets?: number;
					totalPills?: number;
					packageAmountValue?: number;
					packCount?: number;
				} = {
					stockAdjustment: newStockAdjustment,
				};
				if (isZeroReset) {
					patchBody.stockAdjustment = 0;
					patchBody.packCount = 0;
					patchBody.looseTablets = 0;
					if (isDiscreteCountPackage || isAmountPackage) {
						patchBody.totalPills = 0;
					}
					if (isPackageAmountPackage) {
						patchBody.packageAmountValue = 0;
					}
				} else if (isTubePackage) {
					// Tube has fixed count=1 and no automatic depletion.
					// Correction must update the base amount fields directly.
					patchBody.stockAdjustment = 0;
					patchBody.packCount = 1;
					patchBody.totalPills = desiredTotal;
					patchBody.looseTablets = desiredTotal;
					patchBody.packageAmountValue = desiredTotal;
				} else if (isLiquidPackage) {
					// Liquid correction supports bottle-count updates.
					// Keep packageAmountValue (ml per bottle) and update capacity base by bottle count.
					patchBody.packCount = correctedLiquidBottleCount;
					patchBody.totalPills = liquidStructuralMax;
					patchBody.looseTablets = liquidStructuralMax;
				} else if (!isAmountPackage) {
					patchBody.looseTablets = finalLoosePills;
				}

				// Use the PATCH endpoint - it sets stockAdjustment, looseTablets, AND lastStockCorrectionAt
				const res = await fetch(`/api/medications/${medId}/stock-adjustment`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify(patchBody),
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
		},
		[editStockFullBlisters, editStockPartialBlisterPills, editStockLoosePills, showEditStockModal]
	);

	const openRefillModal = useCallback(() => {
		resetRefillForm();
		setShowRefillModal(true);
		window.history.pushState({ modal: "refill" }, "");
	}, [resetRefillForm]);

	const closeRefillModal = useCallback(() => {
		if (showRefillModal) {
			window.history.back();
		}
	}, [showRefillModal]);

	const openEditStockModal = useCallback((selectedMed: Medication, coverage: { all: Coverage[] }) => {
		if (!selectedMed) return;
		setEditStockMedication(selectedMed);
		const isAmountPackage = isAmountBasedPackageType(selectedMed.packageType);
		const isDiscreteCountPackage = isDiscreteCountPackageType(selectedMed.packageType);
		// Get current stock from coverage (after consumption)
		const medCoverage = coverage.all.find((c) => c.name === selectedMed.name);
		const dbTotal = getMedTotal(selectedMed);
		const currentStock = Math.max(0, medCoverage ? Math.round(medCoverage.medsLeft) : dbTotal);

		// Bottle correction uses only total pills input.
		// For blister, keep loose pills separated from sealed blister/partial counts.
		const knownLoose = Math.min(currentStock, Math.max(0, selectedMed.looseTablets));
		const sealedPills = Math.max(0, currentStock - knownLoose);
		let fullBlisters: number;
		if (isLiquidContainerPackageType(selectedMed.packageType)) {
			fullBlisters = Math.max(1, selectedMed.packCount);
		} else if (isAmountPackage) {
			fullBlisters = 0;
		} else {
			fullBlisters = Math.floor(sealedPills / selectedMed.pillsPerBlister);
		}
		const partialPills = isAmountPackage ? Math.max(0, currentStock) : sealedPills % selectedMed.pillsPerBlister;

		// Pre-fill with current values
		setEditStockFullBlisters(fullBlisters);
		setEditStockPartialBlisterPills(partialPills);
		setEditStockLoosePills(isAmountPackage || isDiscreteCountPackage ? 0 : knownLoose);
		setShowEditStockModal(true);
		window.history.pushState({ modal: "editStock" }, "");
	}, []);

	const closeEditStockModal = useCallback(() => {
		if (showEditStockModal) {
			let popstateHandled = false;
			const handlePopstate = () => {
				popstateHandled = true;
			};
			window.addEventListener("popstate", handlePopstate, { once: true });
			window.history.back();

			// Fallback for cases where no history entry exists for edit stock.
			window.setTimeout(() => {
				if (!popstateHandled) {
					window.removeEventListener("popstate", handlePopstate);
					setShowEditStockModal(false);
				}
			}, 150);
		}
	}, [showEditStockModal]);

	useEffect(() => {
		if (!showEditStockModal) {
			setEditStockMedication(null);
		}
	}, [showEditStockModal]);

	return {
		clearRefillState,
		showRefillModal,
		setShowRefillModal,
		refillPacks,
		setRefillPacks,
		refillLoose,
		setRefillLoose,
		usePrescriptionRefill,
		setUsePrescriptionRefill,
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
		editStockLoosePills,
		setEditStockLoosePills,
		editStockSaving,
		editStockMedication,
		loadRefillHistory,
		submitRefill,
		submitStockCorrection,
		openRefillModal,
		closeRefillModal,
		openEditStockModal,
		closeEditStockModal,
	};
}
