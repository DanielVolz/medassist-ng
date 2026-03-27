import { useCallback, useRef, useState } from "react";
import type {
	MedicationEnrichmentEnrichResponse,
	MedicationEnrichmentPackageOption,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
} from "../types";

export const MEDICATION_ENRICHMENT_INITIAL_LIMIT = 6;
export const MEDICATION_ENRICHMENT_LIMIT_STEP = 6;
export const MEDICATION_ENRICHMENT_MAX_LIMIT = 20;

export type MedicationEnrichmentState = {
	query: string;
	results: MedicationEnrichmentSearchResult[];
	hasMoreResults: boolean;
	resultLimit: number;
	isSearching: boolean;
	hasSearched: boolean;
	searchError: string | null;
	applyingCode: string | null;
	applyingPackageLabel: string | null;
	activeResultCode: string | null;
	appliedSelection: MedicationEnrichmentEnrichResponse["selection"] | null;
	enrichError: string | null;
	meta: MedicationEnrichmentEnrichResponse["meta"] | null;
	strengthOptions: MedicationEnrichmentStrengthOption[];
	packageOptions: MedicationEnrichmentPackageOption[];
	appliedStrengthLabel: string | null;
	appliedPackageLabel: string | null;
};

export function createMedicationEnrichmentState(
	query = "",
	resultLimit = MEDICATION_ENRICHMENT_INITIAL_LIMIT
): MedicationEnrichmentState {
	return {
		query,
		results: [],
		hasMoreResults: false,
		resultLimit,
		isSearching: false,
		hasSearched: false,
		searchError: null,
		applyingCode: null,
		applyingPackageLabel: null,
		activeResultCode: null,
		appliedSelection: null,
		enrichError: null,
		meta: null,
		strengthOptions: [],
		packageOptions: [],
		appliedStrengthLabel: null,
		appliedPackageLabel: null,
	};
}

export function useMedicationEnrichmentController() {
	const [medicationEnrichment, setMedicationEnrichment] = useState<MedicationEnrichmentState>(() =>
		createMedicationEnrichmentState()
	);
	const medicationEnrichmentQueryRef = useRef("");

	const resetMedicationEnrichment = useCallback((query = "") => {
		medicationEnrichmentQueryRef.current = query;
		setMedicationEnrichment(createMedicationEnrichmentState(query));
	}, []);

	const handleMedicationEnrichmentQueryChange = useCallback((value: string) => {
		medicationEnrichmentQueryRef.current = value;
		setMedicationEnrichment((previous) => ({
			...previous,
			query: value,
		}));
	}, []);

	return {
		medicationEnrichment,
		setMedicationEnrichment,
		medicationEnrichmentQueryRef,
		resetMedicationEnrichment,
		handleMedicationEnrichmentQueryChange,
	};
}
