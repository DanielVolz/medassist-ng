import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	MedicationEnrichmentSection,
	type MedicationEnrichmentViewModel,
} from "../../components/MedicationEnrichmentSection";
import type { MedicationEnrichmentSearchResult, MedicationEnrichmentStrengthOption } from "../../types";

function createResult(overrides: Partial<MedicationEnrichmentSearchResult> = {}): MedicationEnrichmentSearchResult {
	return {
		code: "EMA-ASPIRIN",
		name: "Aspirin 500 mg tablets",
		genericName: "Acetylsalicylic acid",
		authorisationHolder: "Bayer",
		therapeuticArea: "Pain",
		matchType: "brand",
		genericStatus: "original",
		authorisationDate: "2024-02-01",
		source: "ema",
		...overrides,
	};
}

function createStrengthOption(
	overrides: Partial<MedicationEnrichmentStrengthOption> = {}
): MedicationEnrichmentStrengthOption {
	return {
		label: "500 mg",
		pillWeightMg: 500,
		doseUnit: "mg",
		...overrides,
	};
}

function createState(overrides: Partial<MedicationEnrichmentViewModel> = {}): MedicationEnrichmentViewModel {
	return {
		query: "",
		results: [],
		isSearching: false,
		hasSearched: false,
		searchError: null,
		applyingCode: null,
		activeResultCode: null,
		appliedSelection: null,
		enrichError: null,
		meta: null,
		strengthOptions: [],
		appliedStrengthLabel: null,
		...overrides,
	};
}

describe("MedicationEnrichmentSection", () => {
	it("starts collapsed so the lookup stays optional by default", () => {
		render(
			<MedicationEnrichmentSection
				state={createState()}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
			/>
		);

		expect(screen.getByText("form.enrichment.title")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.collapsedHint")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.toggleShow" })).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("form.enrichment.searchPlaceholder")).not.toBeInTheDocument();
	});

	it("supports explicit show and hide toggles for the lookup and source guidance", () => {
		render(
			<MedicationEnrichmentSection
				state={createState()}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		expect(screen.getByPlaceholderText("form.enrichment.searchPlaceholder")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.toggleHide" })).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.infoTitle")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.infoShow" }));
		expect(screen.getByText("form.enrichment.infoTitle")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.infoHide" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.infoHide" }));
		expect(screen.queryByText("form.enrichment.infoTitle")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.infoShow" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleHide" }));
		expect(screen.queryByPlaceholderText("form.enrichment.searchPlaceholder")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.toggleShow" })).toBeInTheDocument();
	});

	it("reveals guidance only when requested and wires search/apply actions", () => {
		const onQueryChange = vi.fn();
		const onSearch = vi.fn();
		const onApplyResult = vi.fn();
		const result = createResult();

		render(
			<MedicationEnrichmentSection
				state={createState({ query: "Aspirin", results: [result] })}
				onQueryChange={onQueryChange}
				onSearch={onSearch}
				onApplyResult={onApplyResult}
				onApplyStrength={vi.fn()}
			/>
		);

		expect(screen.queryByText("form.enrichment.details.authorisationHolder")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.infoShow" }));
		expect(screen.getByText("form.enrichment.infoTitle")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.description")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.manualEntryHint")).toBeInTheDocument();

		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.keyDown(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), { key: "Enter" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.applyAction" }));

		expect(onQueryChange).toHaveBeenCalledWith("Ibuprofen");
		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onApplyResult).toHaveBeenCalledWith(result);
		expect(screen.getByText("form.enrichment.details.authorisationHolder")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.details.therapeuticArea")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.genericStatus.original")).toBeInTheDocument();
	});

	it("labels RxNorm and openFDA results with their source badges", () => {
		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Semaglutide",
					results: [
						createResult({
							code: "RX-123",
							name: "Wegovy",
							genericName: "Semaglutide",
							source: "rxnorm",
						}),
						createResult({
							code: "NDC-123",
							name: "Ozempic",
							genericName: "Semaglutide",
							source: "openfda",
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
			/>
		);

		expect(screen.getByText("form.enrichment.sources.rxnorm")).toBeInTheDocument();
		const openFdaBadge = screen.getByText("form.enrichment.sources.openfda");
		expect(openFdaBadge).toBeInTheDocument();
		expect(openFdaBadge).toHaveClass("warning");
		expect(screen.queryByText("form.enrichment.genericStatus.unknown")).not.toBeInTheDocument();
	});

	it("shows a load-more action when the backend reports more results", () => {
		const onLoadMoreResults = vi.fn();

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Aspirin",
					results: [createResult({ source: "rxnorm", code: "RX-123", name: "Aspirin" })],
					hasMoreResults: true,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onLoadMoreResults={onLoadMoreResults}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		expect(onLoadMoreResults).toHaveBeenCalledTimes(1);
	});

	it("can expand automatically when follow-up feedback exists", () => {
		render(
			<MedicationEnrichmentSection
				state={createState({
					hasSearched: true,
					searchError: "Lookup unavailable",
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
			/>
		);

		expect(screen.getByPlaceholderText("form.enrichment.searchPlaceholder")).toBeInTheDocument();
		expect(screen.getByText("Lookup unavailable")).toBeInTheDocument();
	});

	it("shows partial coverage feedback and optional strength suggestions", () => {
		const onApplyStrength = vi.fn();
		const strengthOption = createStrengthOption();

		render(
			<MedicationEnrichmentSection
				state={createState({
					hasSearched: true,
					appliedSelection: {
						name: "Aspirin 500 mg tablets",
						genericName: "Acetylsalicylic acid",
						therapeuticArea: "Pain",
						indication: "Pain relief",
						atcCode: "N02BA01",
						source: "ema",
					},
					meta: {
						rxNormMatched: false,
						openFdaMatched: false,
						partial: true,
						note: "Returned EMA enrichment without RxNorm suggestions.",
					},
					strengthOptions: [strengthOption],
					appliedStrengthLabel: "500 mg",
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={onApplyStrength}
			/>
		);

		expect(screen.getByText("form.enrichment.partialNote")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.applied")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.strengthTitle")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "500 mg" }));

		expect(onApplyStrength).toHaveBeenCalledWith(strengthOption);
		expect(screen.getByText("form.enrichment.appliedStrength")).toBeInTheDocument();
	});
});
