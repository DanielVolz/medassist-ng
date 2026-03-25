import type { MedicationEnrichmentSearchResult } from "../types";

function normalizeMedicationEnrichmentGroupingText(value: string | null | undefined): string {
	return (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function getMedicationEnrichmentDisplayResultKey(result: MedicationEnrichmentSearchResult): string {
	if (result.source === "openfda") {
		return `openfda:${normalizeMedicationEnrichmentGroupingText(result.name)}:${normalizeMedicationEnrichmentGroupingText(result.genericName)}`;
	}

	return result.code;
}

export function countMedicationEnrichmentDisplayResults(results: MedicationEnrichmentSearchResult[]): number {
	return new Set(results.map(getMedicationEnrichmentDisplayResultKey)).size;
}
