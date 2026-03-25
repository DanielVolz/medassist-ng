import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (key.startsWith("form.enrichment.packageContainers.") && typeof options?.count === "number") {
				const count = Number(options.count);
				const container = key.replace("form.enrichment.packageContainers.", "");
				const labels = {
					blister: count === 1 ? "1 blister pack" : `${count} blister packs`,
					bottle: count === 1 ? "1 bottle" : `${count} bottles`,
					liquidContainer: count === 1 ? "1 bottle" : `${count} bottles`,
					tube: count === 1 ? "1 tube" : `${count} tubes`,
				} as const;
				return labels[container as keyof typeof labels] ?? `${count} package`;
			}
			if (key.startsWith("form.enrichment.packageUnits.") && typeof options?.count === "number") {
				const count = Number(options.count);
				const unit = key.replace("form.enrichment.packageUnits.", "");
				const labels = {
					tablet: count === 1 ? "tablet" : "tablets",
					capsule: count === 1 ? "capsule" : "capsules",
					caplet: count === 1 ? "caplet" : "caplets",
					pill: count === 1 ? "pill" : "pills",
				} as const;
				return labels[unit as keyof typeof labels] ?? (count === 1 ? "tablet" : "tablets");
			}
			if (
				(key === "form.enrichment.appliedPackage" || key === "form.enrichment.appliedStrength") &&
				typeof options?.label === "string"
			) {
				return `${key}: ${options.label}`;
			}
			return key;
		},
		i18n: {
			language: "en",
			changeLanguage: vi.fn(),
		},
	}),
}));

import {
	MedicationEnrichmentSection,
	type MedicationEnrichmentViewModel,
} from "../../components/MedicationEnrichmentSection";
import type {
	MedicationEnrichmentPackageOption,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
} from "../../types";

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
		packageOptions: [],
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

function createPackageOption(
	overrides: Partial<MedicationEnrichmentPackageOption> = {}
): MedicationEnrichmentPackageOption {
	return {
		label: "10 tablets in 1 blister",
		description: "10 tablets in 1 blister",
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		totalPills: 10,
		looseTablets: 0,
		packageAmountValue: null,
		packageAmountUnit: null,
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
		applyingPackageLabel: null,
		activeResultCode: null,
		appliedSelection: null,
		enrichError: null,
		meta: null,
		strengthOptions: [],
		packageOptions: [],
		appliedStrengthLabel: null,
		appliedPackageLabel: null,
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
				onApplyPackage={vi.fn()}
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
				onApplyPackage={vi.fn()}
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
				onApplyPackage={vi.fn()}
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

	it("sanitizes package codes in expanded package details while keeping plain text unchanged", () => {
		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [
						createResult({
							code: "NDC-123",
							name: "Ibuprofen",
							source: "openfda",
							packageOptions: [
								createPackageOption({
									label: "10 tablets in 1 blister (59651-083-14)",
									description: "10 tablets in 1 blister (59651-083-14)",
								}),
								createPackageOption({
									label: "20 tablets in 1 blister",
									description: "20 tablets in 1 blister",
									pillsPerBlister: 20,
									totalPills: 20,
								}),
								createPackageOption({
									label: "30 tablets in 1 bottle (00093-7424-56)",
									description: "30 tablets in 1 bottle (00093-7424-56)",
									packageType: "bottle",
									pillsPerBlister: null,
									blistersPerPack: null,
									totalPills: 30,
									looseTablets: 30,
								}),
							],
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.queryByText(/59651-083-14/)).not.toBeInTheDocument();
		expect(screen.queryByText(/00093-7424-56/)).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		expect(screen.getByText("form.enrichment.details.packageSizes")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "1 blister pack · 10 tablets" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "1 blister pack · 20 tablets" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "1 bottle · 30 tablets" })).toBeInTheDocument();
		expect(screen.queryByText("10 tablets in 1 blister (59651-083-14)")).not.toBeInTheDocument();
		expect(screen.queryByText("30 tablets in 1 bottle (00093-7424-56)")).not.toBeInTheDocument();
	});

	it("normalizes all-uppercase package labels to readable sentence-style casing", () => {
		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Dimethyl fumarate",
					results: [
						createResult({
							code: "NDC-DMF",
							name: "Dimethyl fumarate",
							genericName: "Dimethyl fumarate",
							source: "openfda",
							packageOptions: [
								createPackageOption({
									label: "60 CAPSULE, DELAYED RELEASE in 1 BOTTLE (31722-658-32)",
									description: "60 CAPSULE, DELAYED RELEASE in 1 BOTTLE (31722-658-32)",
									packageType: "bottle",
									pillsPerBlister: null,
									blistersPerPack: null,
									totalPills: 60,
									looseTablets: 60,
								}),
							],
						}),
					],
					activeResultCode: "NDC-DMF",
					appliedSelection: {
						name: "Dimethyl fumarate",
						genericName: "Dimethyl fumarate",
						therapeuticArea: null,
						indication: null,
						atcCode: null,
						source: "openfda",
					},
					packageOptions: [
						createPackageOption({
							label: "60 CAPSULE, DELAYED RELEASE in 1 BOTTLE (31722-658-32)",
							description: "60 CAPSULE, DELAYED RELEASE in 1 BOTTLE (31722-658-32)",
							packageType: "bottle",
							pillsPerBlister: null,
							blistersPerPack: null,
							totalPills: 60,
							looseTablets: 60,
						}),
					],
					appliedPackageLabel: "60 CAPSULE, DELAYED RELEASE in 1 BOTTLE (31722-658-32)",
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		expect(screen.getByText("1 bottle · 60 capsules")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /60 CAPSULE, DELAYED RELEASE in 1 BOTTLE/ })).not.toBeInTheDocument();
		expect(screen.getByText("form.enrichment.appliedPackage: 1 bottle · 60 capsules")).toBeInTheDocument();
	});

	it("removes inline package codes even when they appear before the slash", () => {
		const rawLabel = "1 BOTTLE in 1 CARTON (31722-658-32) / 60 CAPSULE, DELAYED RELEASE in 1 BOTTLE";

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Dimethyl fumarate",
					results: [
						createResult({
							code: "NDC-DMF-COMBO",
							name: "Dimethyl fumarate",
							genericName: "Dimethyl fumarate",
							source: "openfda",
							packageOptions: [
								createPackageOption({
									label: rawLabel,
									description: rawLabel,
									packageType: "bottle",
									pillsPerBlister: null,
									blistersPerPack: null,
									totalPills: 60,
									looseTablets: 60,
								}),
							],
							authorisationDate: null,
						}),
					],
					activeResultCode: "NDC-DMF-COMBO",
					appliedSelection: {
						name: "Dimethyl fumarate",
						genericName: "Dimethyl fumarate",
						therapeuticArea: null,
						indication: null,
						atcCode: null,
						source: "openfda",
					},
					packageOptions: [
						createPackageOption({
							label: rawLabel,
							description: rawLabel,
							packageType: "bottle",
							pillsPerBlister: null,
							blistersPerPack: null,
							totalPills: 60,
							looseTablets: 60,
						}),
					],
					appliedPackageLabel: rawLabel,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		const cleanedLabel = "1 bottle · 60 capsules";

		expect(screen.queryByText(/31722-658-32/)).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		expect(screen.getByText(cleanedLabel)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /31722-658-32/ })).not.toBeInTheDocument();
		expect(screen.getByText(`form.enrichment.appliedPackage: ${cleanedLabel}`)).toBeInTheDocument();
	});

	it("summarizes multi-blister package labels into compact quantity text", () => {
		const rawLabel = "10 blister pack in 1 carton / 10 capsule, delayed release in 1 blister pack";

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Dimethyl fumarate",
					results: [
						createResult({
							code: "NDC-DMF-BLISTER",
							name: "Dimethyl fumarate",
							source: "openfda",
							packageOptions: [
								createPackageOption({
									label: rawLabel,
									description: rawLabel,
									packageType: "blister",
									packCount: 1,
									blistersPerPack: 10,
									pillsPerBlister: 10,
									totalPills: 100,
									looseTablets: 0,
								}),
							],
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.queryByText(/delayed release/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/10 blister pack in 1 carton/i)).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		expect(screen.getByText("1 blister pack · 10 × 10 capsules")).toBeInTheDocument();
	});

	it("renders multiple inline package options as buttons and preserves raw package data in callbacks", () => {
		const onApplyResult = vi.fn();
		const packageOptions = [
			createPackageOption({
				label: "10 tablets in 1 blister (59651-083-14)",
				description: "10 tablets in 1 blister (59651-083-14)",
			}),
			createPackageOption({
				label: "30 tablets in 1 bottle (00093-7424-56)",
				description: "30 tablets in 1 bottle (00093-7424-56)",
				packageType: "bottle",
				pillsPerBlister: null,
				blistersPerPack: null,
				totalPills: 30,
				looseTablets: 30,
			}),
		];
		const result = createResult({
			code: "NDC-123",
			name: "Ibuprofen",
			source: "openfda",
			packageOptions,
		});

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [result],
					activeResultCode: result.code,
					appliedPackageLabel: packageOptions[0].label,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={onApplyResult}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		const packageSizesSection = screen.getByText("form.enrichment.details.packageSizes").closest("div");
		const selectedPackageButton = screen.getByRole("button", { name: "1 blister pack · 10 tablets" });
		const alternatePackageButton = screen.getByRole("button", { name: "1 bottle · 30 tablets" });
		const packageChoiceList = selectedPackageButton.closest("div");

		expect(packageSizesSection).toHaveClass("medication-enrichment-result-meta-full");
		expect(packageChoiceList).toHaveClass(
			"medication-enrichment-strength-list",
			"medication-enrichment-package-choice-list"
		);
		expect(selectedPackageButton).toHaveAttribute("aria-pressed", "true");
		expect(selectedPackageButton).toHaveAttribute("title", "1 blister pack · 10 tablets");
		expect(alternatePackageButton).toHaveAttribute("aria-pressed", "false");
		expect(alternatePackageButton).toHaveAttribute("title", "1 bottle · 30 tablets");
		expect(screen.queryByRole("button", { name: packageOptions[1].description })).not.toBeInTheDocument();

		fireEvent.click(alternatePackageButton);

		expect(onApplyResult).toHaveBeenCalledWith(result, packageOptions[1]);
	});

	it("collapses duplicate openFDA hits into one card and merges their package choices", () => {
		const firstResult = createResult({
			code: "NDC-IBU-10",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [
				createPackageOption({
					label: "10 tablets in 1 blister (59651-083-14)",
					description: "10 tablets in 1 blister (59651-083-14)",
				}),
			],
		});
		const secondResult = createResult({
			code: "NDC-IBU-30",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [
				createPackageOption({
					label: "30 tablets in 1 bottle (00093-7424-56)",
					description: "30 tablets in 1 bottle (00093-7424-56)",
					packageType: "bottle",
					pillsPerBlister: null,
					blistersPerPack: null,
					totalPills: 30,
					looseTablets: 30,
				}),
			],
		});
		const duplicateBottleResult = createResult({
			code: "NDC-IBU-30-DUP",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [
				createPackageOption({
					label: "1 bottle in 1 carton / 30 tablets in 1 bottle (00093-7424-56)",
					description: "1 bottle in 1 carton / 30 tablets in 1 bottle (00093-7424-56)",
					packageType: "bottle",
					pillsPerBlister: null,
					blistersPerPack: null,
					totalPills: 30,
					looseTablets: 30,
				}),
			],
		});
		const rxNormResult = createResult({
			code: "RX-IBU",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "rxnorm",
		});
		const { container } = render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [firstResult, secondResult, duplicateBottleResult, rxNormResult],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(container.querySelectorAll(".medication-enrichment-result")).toHaveLength(2);
		expect(screen.getAllByText("form.enrichment.sources.openfda")).toHaveLength(1);
		fireEvent.click(screen.getAllByRole("button", { name: "form.enrichment.details.showAction" })[0]);

		expect(screen.getByRole("button", { name: "1 blister pack · 10 tablets" })).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "1 bottle · 30 tablets" })).toHaveLength(1);
	});

	it("keeps the original source result and raw package option when clicking grouped package choices", () => {
		const onApplyResult = vi.fn();
		const firstPackageOption = createPackageOption({
			label: "10 tablets in 1 blister (59651-083-14)",
			description: "10 tablets in 1 blister (59651-083-14)",
		});
		const secondPackageOption = createPackageOption({
			label: "30 tablets in 1 bottle (00093-7424-56)",
			description: "30 tablets in 1 bottle (00093-7424-56)",
			packageType: "bottle",
			pillsPerBlister: null,
			blistersPerPack: null,
			totalPills: 30,
			looseTablets: 30,
		});
		const firstResult = createResult({
			code: "NDC-IBU-10",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [firstPackageOption],
		});
		const secondResult = createResult({
			code: "NDC-IBU-30",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [secondPackageOption],
		});

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [firstResult, secondResult],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={onApplyResult}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));
		fireEvent.click(screen.getByRole("button", { name: "1 bottle · 30 tablets" }));

		expect(onApplyResult).toHaveBeenCalledWith(secondResult, secondPackageOption);
	});

	it("sorts grouped cards by merged package count and preserves original order on ties", () => {
		const { container } = render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Pain relief",
					results: [
						createResult({
							code: "NDC-NAP",
							name: "Naproxen",
							genericName: "Naproxen",
							source: "openfda",
							packageOptions: [createPackageOption({ label: "12 tablets", description: "12 tablets" })],
						}),
						createResult({
							code: "NDC-IBU-10",
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							source: "openfda",
							packageOptions: [createPackageOption({ label: "10 tablets", description: "10 tablets" })],
						}),
						createResult({
							code: "NDC-IBU-30",
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							source: "openfda",
							packageOptions: [
								createPackageOption({
									label: "30 tablets",
									description: "30 tablets",
									packageType: "bottle",
									pillsPerBlister: null,
									blistersPerPack: null,
									totalPills: 30,
									looseTablets: 30,
								}),
							],
						}),
						createResult({
							code: "NDC-DIC",
							name: "Diclofenac",
							genericName: "Diclofenac",
							source: "openfda",
							packageOptions: [createPackageOption({ label: "20 tablets", description: "20 tablets" })],
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		const cardTitles = Array.from(
			container.querySelectorAll(".medication-enrichment-result .medication-enrichment-result-names strong")
		).map((element) => element.textContent);

		expect(cardTitles).toEqual(["Ibuprofen", "Naproxen", "Diclofenac"]);
	});

	it("does not collapse non-openFDA results that share the same medication identity", () => {
		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [
						createResult({
							code: "RX-IBU-1",
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							source: "rxnorm",
						}),
						createResult({
							code: "RX-IBU-2",
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							source: "rxnorm",
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getAllByText("form.enrichment.sources.rxnorm")).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: "form.enrichment.applyAction" })).toHaveLength(2);
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
							packageOptions: [createPackageOption()],
						}),
					],
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getByText("form.enrichment.sources.rxnorm")).toBeInTheDocument();
		const openFdaBadge = screen.getByText("form.enrichment.sources.openfda");
		expect(openFdaBadge).toBeInTheDocument();
		expect(openFdaBadge).toHaveClass("warning");
		expect(screen.getByText("form.enrichment.packageAvailable")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.packageUnavailable")).toBeInTheDocument();
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
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		expect(onLoadMoreResults).toHaveBeenCalledTimes(1);
	});

	it("shows visible loading feedback for both search and load-more states", () => {
		const { rerender } = render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Aspirin",
					isSearching: true,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onLoadMoreResults={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getByRole("button", { name: "form.enrichment.loadingSearch" })).toBeDisabled();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();

		rerender(
			<MedicationEnrichmentSection
				state={createState({
					query: "Aspirin",
					results: [createResult({ source: "rxnorm", code: "RX-123", name: "Aspirin" })],
					hasMoreResults: true,
					isSearching: true,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onLoadMoreResults={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getByRole("button", { name: "form.enrichment.loadingMoreResults" })).toBeDisabled();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("shows a stable pending state when a package selection is still loading enrichment details", () => {
		const pendingPackage = createPackageOption({
			label: "60 capsules in 1 bottle",
			description: "60 capsules in 1 bottle",
			packageType: "bottle",
			blistersPerPack: null,
			pillsPerBlister: null,
			totalPills: 60,
			looseTablets: 60,
		});
		const alternatePackage = createPackageOption({
			label: "90 capsules in 1 bottle",
			description: "90 capsules in 1 bottle",
			packageType: "bottle",
			blistersPerPack: null,
			pillsPerBlister: null,
			totalPills: 90,
			looseTablets: 90,
		});

		render(
			<MedicationEnrichmentSection
				state={createState({
					results: [
						createResult({
							code: "NDC-PENDING",
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							source: "openfda",
							packageOptions: [pendingPackage, alternatePackage],
						}),
					],
					activeResultCode: "NDC-PENDING",
					applyingCode: "NDC-PENDING",
					applyingPackageLabel: pendingPackage.label,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		const packageButton = screen.getByRole("button", { name: "1 bottle · 60 capsules" });
		expect(packageButton).toBeDisabled();
		expect(packageButton.querySelector(".medication-enrichment-spinner")).not.toBeNull();
		expect(screen.getByText("form.enrichment.strengthTitle")).toBeInTheDocument();
		expect(screen.getByText("form.enrichment.applying")).toBeInTheDocument();
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
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getByPlaceholderText("form.enrichment.searchPlaceholder")).toBeInTheDocument();
		expect(screen.getByText("Lookup unavailable")).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.noResults")).not.toBeInTheDocument();
	});

	it("shows partial coverage feedback and optional strength suggestions", () => {
		const onApplyStrength = vi.fn();
		const strengthOption = createStrengthOption();
		const result = createResult({
			code: "EMA-ASPIRIN-STRENGTH",
			name: "Aspirin 500 mg tablets",
			genericName: "Acetylsalicylic acid",
			source: "ema",
		});

		render(
			<MedicationEnrichmentSection
				state={createState({
					hasSearched: true,
					results: [result],
					activeResultCode: result.code,
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
				onApplyPackage={vi.fn()}
			/>
		);

		expect(screen.getByText("form.enrichment.partialNote")).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.strengthTitle")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		expect(screen.getByText("form.enrichment.strengthTitle")).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.packageTitle")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "500 mg" }));

		expect(onApplyStrength).toHaveBeenCalledWith(strengthOption);
		expect(screen.getByText("form.enrichment.appliedStrength: 500 mg")).toBeInTheDocument();
	});

	it("shows only the first 12 strength suggestions initially and reveals more incrementally", () => {
		const strengthOptions = Array.from({ length: 25 }, (_, index) =>
			createStrengthOption({
				label: `${(index + 1) * 25} mg`,
				pillWeightMg: (index + 1) * 25,
			})
		);

		const packageOptions = [
			createPackageOption(),
			createPackageOption({
				label: "20 tablets in 1 blister",
				description: "20 tablets in 1 blister",
				pillsPerBlister: 20,
				totalPills: 20,
			}),
		];
		const result = createResult({
			code: "RX-STRENGTH-CARD",
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			source: "rxnorm",
			packageOptions,
		});
		const { container } = render(
			<MedicationEnrichmentSection
				state={createState({
					results: [result],
					activeResultCode: result.code,
					strengthOptions,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		const activeCard = container.querySelector(".medication-enrichment-result.active");
		expect(activeCard).toBeTruthy();

		const activeCardQueries = within(activeCard as HTMLElement);
		expect(activeCardQueries.getByText("form.enrichment.details.packageSizes")).toBeInTheDocument();
		expect(activeCardQueries.getByText("form.enrichment.strengthTitle")).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.packageTitle")).not.toBeInTheDocument();

		const detailLabels = Array.from((activeCard as HTMLElement).querySelectorAll("dt")).map((element) =>
			element.textContent?.trim()
		);
		expect(detailLabels.indexOf("form.enrichment.details.packageSizes")).toBeGreaterThanOrEqual(0);
		expect(detailLabels.indexOf("form.enrichment.strengthTitle")).toBeGreaterThan(
			detailLabels.indexOf("form.enrichment.details.packageSizes")
		);

		for (const option of strengthOptions.slice(0, 12)) {
			expect(activeCardQueries.getByRole("button", { name: option.label })).toBeInTheDocument();
		}
		expect(activeCardQueries.queryByRole("button", { name: strengthOptions[12].label })).not.toBeInTheDocument();
		expect(
			activeCardQueries.getByRole("button", { name: "form.enrichment.showMoreStrengthsAction" })
		).toBeInTheDocument();

		fireEvent.click(activeCardQueries.getByRole("button", { name: "form.enrichment.showMoreStrengthsAction" }));

		for (const option of strengthOptions.slice(0, 24)) {
			expect(activeCardQueries.getByRole("button", { name: option.label })).toBeInTheDocument();
		}
		expect(activeCardQueries.queryByRole("button", { name: strengthOptions[24].label })).not.toBeInTheDocument();
		expect(
			activeCardQueries.getByRole("button", { name: "form.enrichment.showMoreStrengthsAction" })
		).toBeInTheDocument();

		fireEvent.click(activeCardQueries.getByRole("button", { name: "form.enrichment.showMoreStrengthsAction" }));

		for (const option of strengthOptions) {
			expect(activeCardQueries.getByRole("button", { name: option.label })).toBeInTheDocument();
		}
		expect(
			activeCardQueries.queryByRole("button", { name: "form.enrichment.showMoreStrengthsAction" })
		).not.toBeInTheDocument();
	});

	it("keeps package selection and applied feedback inside the active result card without a separate follow-up summary", () => {
		const onApplyPackage = vi.fn();
		const selectedPackageOption = createPackageOption({
			label: "100 mL in 1 bottle (00536-1167-01)",
			description: "100 mL in 1 bottle (00536-1167-01)",
			packageType: "liquid_container",
			blistersPerPack: null,
			pillsPerBlister: null,
			totalPills: 100,
			looseTablets: 100,
			packageAmountValue: 100,
			packageAmountUnit: "ml",
		});
		const alternatePackageOption = createPackageOption({
			label: "200 mL in 1 bottle (00536-1167-02)",
			description: "200 mL in 1 bottle (00536-1167-02)",
			packageType: "liquid_container",
			blistersPerPack: null,
			pillsPerBlister: null,
			totalPills: 200,
			looseTablets: 200,
			packageAmountValue: 200,
			packageAmountUnit: "ml",
		});
		const result = createResult({
			code: "NDC-IBU-LIQUID",
			name: "Ibuprofen suspension",
			genericName: "Ibuprofen",
			source: "openfda",
			packageOptions: [selectedPackageOption, alternatePackageOption],
		});

		render(
			<MedicationEnrichmentSection
				state={createState({
					query: "Ibuprofen",
					results: [result],
					activeResultCode: result.code,
					appliedSelection: {
						name: "Ibuprofen suspension",
						genericName: "Ibuprofen",
						therapeuticArea: null,
						indication: null,
						atcCode: null,
						source: "openfda",
					},
					packageOptions: [selectedPackageOption, alternatePackageOption],
					appliedPackageLabel: selectedPackageOption.label,
				})}
				onQueryChange={vi.fn()}
				onSearch={vi.fn()}
				onApplyResult={vi.fn()}
				onApplyStrength={vi.fn()}
				onApplyPackage={onApplyPackage}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		const selectedPackageButton = screen.getByRole("button", { name: "1 bottle · 100 ml" });
		const alternatePackageButton = screen.getByRole("button", { name: "1 bottle · 200 ml" });
		const packageChoiceList = selectedPackageButton.closest("div");

		expect(packageChoiceList).toHaveClass(
			"medication-enrichment-strength-list",
			"medication-enrichment-package-choice-list"
		);
		expect(selectedPackageButton).toHaveAttribute("aria-pressed", "true");
		expect(selectedPackageButton).toHaveAttribute("title", "1 bottle · 100 ml");
		expect(alternatePackageButton).toHaveAttribute("aria-pressed", "false");
		expect(alternatePackageButton).toHaveAttribute("title", "1 bottle · 200 ml");
		expect(screen.queryByRole("button", { name: selectedPackageOption.label })).not.toBeInTheDocument();
		expect(screen.getByText("form.enrichment.appliedPackage: 1 bottle · 100 ml")).toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.packageTitle")).not.toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.applied")).not.toBeInTheDocument();

		fireEvent.click(selectedPackageButton);

		expect(onApplyPackage).toHaveBeenCalledWith(selectedPackageOption);
	});

	it("keeps the expanded active result card in view when more details are opened", async () => {
		const result = createResult({
			code: "EMA-SCROLL-TARGET",
			name: "Aspirin 500 mg tablets",
			genericName: "Acetylsalicylic acid",
			source: "ema",
		});
		const requestAnimationFrameSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		let scrolledElement: Element | null = null;
		let scrollOptions: ScrollIntoViewOptions | undefined;
		const scrollIntoViewMock = vi.fn(function (this: Element, options?: ScrollIntoViewOptions) {
			scrolledElement = this;
			scrollOptions = options;
		});
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoViewMock,
		});

		try {
			const { container } = render(
				<MedicationEnrichmentSection
					state={createState({
						results: [result],
						activeResultCode: result.code,
					})}
					onQueryChange={vi.fn()}
					onSearch={vi.fn()}
					onApplyResult={vi.fn()}
					onApplyStrength={vi.fn()}
					onApplyPackage={vi.fn()}
				/>
			);

			const activeCard = container.querySelector(".medication-enrichment-result.active");
			expect(activeCard).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

			await waitFor(() => {
				expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
			});

			expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
			expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
			expect(scrolledElement).toBe(activeCard);
			expect(scrollOptions).toEqual({
				block: "nearest",
				inline: "nearest",
				behavior: "smooth",
			});
		} finally {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: originalScrollIntoView,
			});
			requestAnimationFrameSpy.mockRestore();
			cancelAnimationFrameSpy.mockRestore();
		}
	});
});
