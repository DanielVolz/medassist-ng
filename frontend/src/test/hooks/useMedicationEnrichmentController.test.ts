import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	MEDICATION_ENRICHMENT_INITIAL_LIMIT,
	useMedicationEnrichmentController,
} from "../../hooks/useMedicationEnrichmentController";

describe("useMedicationEnrichmentController", () => {
	it("tracks a search query and resets search, application, and error state when the flow is cancelled", () => {
		const { result } = renderHook(() => useMedicationEnrichmentController());

		expect(result.current.medicationEnrichment).toMatchObject({
			query: "",
			resultLimit: MEDICATION_ENRICHMENT_INITIAL_LIMIT,
			isSearching: false,
			hasSearched: false,
		});

		act(() => {
			result.current.handleMedicationEnrichmentQueryChange("  aspirin  ");
			result.current.setMedicationEnrichment((previous) => ({
				...previous,
				isSearching: true,
				hasSearched: true,
				results: [
					{
						code: "123",
						name: "Aspirin",
						genericName: null,
						authorisationHolder: null,
						therapeuticArea: null,
						matchType: "brand",
						genericStatus: "original",
						authorisationDate: null,
						source: "ema",
						packageOptions: [],
					},
				],
				searchError: "Search failed",
				applyingCode: "123",
				applyingPackageLabel: "Box of 20",
				enrichError: "Apply failed",
			}));
		});

		expect(result.current.medicationEnrichmentQueryRef.current).toBe("  aspirin  ");
		expect(result.current.medicationEnrichment).toMatchObject({
			query: "  aspirin  ",
			isSearching: true,
			applyingCode: "123",
			searchError: "Search failed",
			enrichError: "Apply failed",
		});

		act(() => result.current.resetMedicationEnrichment("ibuprofen"));

		expect(result.current.medicationEnrichmentQueryRef.current).toBe("ibuprofen");
		expect(result.current.medicationEnrichment).toEqual({
			query: "ibuprofen",
			results: [],
			hasMoreResults: false,
			resultLimit: MEDICATION_ENRICHMENT_INITIAL_LIMIT,
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
		});
	});
});
