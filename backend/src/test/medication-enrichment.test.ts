import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

const { fetchMock, requireAuthMock } = vi.hoisted(() => ({
	fetchMock: vi.fn(),
	requireAuthMock: vi.fn(async () => {}),
}));

vi.mock("../plugins/auth.js", () => ({
	requireAuth: requireAuthMock,
}));

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response;
}

function createEmaRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		category: "Human",
		medicine_status: "Authorised",
		name_of_medicine: "Aspirin 500 mg tablets",
		international_non_proprietary_name_common_name: "Acetylsalicylic acid",
		active_substance: "Acetylsalicylic acid",
		marketing_authorisation_developer_applicant_holder: "Bayer",
		therapeutic_area_mesh: "Pain",
		therapeutic_indication: "Pain relief",
		atc_code_human: "N02BA01",
		generic_or_hybrid: "No",
		biosimilar: "No",
		marketing_authorisation_date: "01/02/2024",
		ema_product_number: "EMA-ASPIRIN",
		...overrides,
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const { medicationEnrichmentRoutes } = await import("../routes/medication-enrichment.js");
	const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
	await app.register(sensible);
	await app.register(medicationEnrichmentRoutes);
	await app.ready();
	return app;
}

describe("medication enrichment", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		fetchMock.mockReset();
		requireAuthMock.mockReset();
		requireAuthMock.mockImplementation(async () => {});
		vi.stubGlobal("fetch", fetchMock);
	});

	it("normalizes German ingredient queries for EMA-backed search results", async () => {
		const { searchMedicationEnrichment } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("medicines-output-medicines_json-report_en.json")) {
				return Promise.resolve(
					jsonResponse([
						createEmaRow({
							name_of_medicine: "Tylenol 500 mg tablets",
							international_non_proprietary_name_common_name: "Acetaminophen",
							active_substance: "Acetaminophen",
							ema_product_number: "EMA-TYLENOL",
						}),
						createEmaRow({
							name_of_medicine: "Ibuprofen 400 mg tablets",
							international_non_proprietary_name_common_name: "Ibuprofen",
							active_substance: "Ibuprofen",
							ema_product_number: "EMA-IBUPROFEN",
						}),
					])
				);
			}
			if (url.includes("/drugs.json?name=")) {
				return Promise.resolve(jsonResponse({ drugGroup: { conceptGroup: [] } }));
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(jsonResponse({ results: [] }));
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await searchMedicationEnrichment("Paracetamol 500 mg", 5);

		expect(response.normalizedQuery).toBe("paracetamol 500 mg");
		expect(response.results).toHaveLength(1);
		expect(response.results[0]).toMatchObject({
			code: "EMA-TYLENOL",
			name: "Tylenol 500 mg tablets",
			matchType: "ingredient",
			source: "ema",
		});
	});

	it("requires auth and returns EMA search results from the route", async () => {
		const app = await buildApp();
		fetchMock.mockImplementation((url: string) => {
			if (url.includes("/drugs.json?name=")) {
				return Promise.resolve(jsonResponse({ drugGroup: { conceptGroup: [] } }));
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(jsonResponse({ results: [] }));
			}
			if (url.includes("medicines-output-medicines_json-report_en.json")) {
				return Promise.resolve(jsonResponse([createEmaRow()]));
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await app.inject({
			method: "GET",
			url: "/medication-enrichment/search?q=aspirin&limit=1",
		});

		expect(response.statusCode).toBe(200);
		expect(requireAuthMock).toHaveBeenCalledTimes(1);
		expect(response.json()).toMatchObject({
			query: "aspirin",
			normalizedQuery: "aspirin",
			hasMore: false,
			results: [
				{
					code: "EMA-ASPIRIN",
					name: "Aspirin 500 mg tablets",
					source: "ema",
				},
			],
		});

		await app.close();
	});

	it("falls back from EMA to RxNorm and openFDA search results when EMA has no match", async () => {
		const { searchMedicationEnrichment } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("medicines-output-medicines_json-report_en.json")) {
				return Promise.resolve(jsonResponse([createEmaRow()]));
			}
			if (url.includes("/drugs.json?name=semaglutide")) {
				return Promise.resolve(
					jsonResponse({
						drugGroup: {
							conceptGroup: [
								{
									tty: "SBD",
									conceptProperties: [
										{
											rxcui: "12345",
											name: "Semaglutide 0.25 MG Oral Tablet [Wegovy]",
											synonym: "Wegovy 0.25 mg oral tablet",
										},
									],
								},
							],
						},
					})
				);
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(
					jsonResponse({
						results: [
							{
								product_ndc: "00011-1111",
								brand_name: "Ozempic",
								generic_name: "Semaglutide",
								dosage_form: "Tablet",
								marketing_start_date: "20240101",
							},
						],
					})
				);
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await searchMedicationEnrichment("Semaglutide", 3);

		expect(response.hasMore).toBe(false);
		expect(response.results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "12345",
					name: "Wegovy",
					genericName: "Semaglutide",
					source: "rxnorm",
				}),
				expect.objectContaining({
					code: "00011-1111",
					name: "Ozempic",
					genericName: "Semaglutide",
					source: "openfda",
				}),
			])
		);
	});

	it("prioritizes RxNorm first, then openFDA, and keeps EMA last", async () => {
		const { searchMedicationEnrichment } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("medicines-output-medicines_json-report_en.json")) {
				return Promise.resolve(jsonResponse([createEmaRow()]));
			}
			if (url.includes("/drugs.json?name=")) {
				return Promise.resolve(
					jsonResponse({
						drugGroup: {
							conceptGroup: [
								{
									tty: "SBD",
									conceptProperties: [
										{
											rxcui: "1191",
											name: "Aspirin 500 MG Oral Tablet [Aspirin]",
											synonym: "Aspirin 500 mg oral tablet",
										},
									],
								},
							],
						},
					})
				);
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(
					jsonResponse({
						results: [
							{
								product_ndc: "00011-1111",
								brand_name: "Bayer Aspirin",
								generic_name: "Acetylsalicylic acid",
								dosage_form: "Tablet",
								marketing_start_date: "20240101",
							},
						],
					})
				);
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await searchMedicationEnrichment("Aspirin", 3);

		expect(response.hasMore).toBe(false);
		expect(response.results).toHaveLength(3);
		expect(response.results[0]).toMatchObject({
			code: "1191",
			source: "rxnorm",
		});
		expect(response.results[1]).toMatchObject({
			code: "00011-1111",
			source: "openfda",
		});
		expect(response.results[2]).toMatchObject({
			code: "EMA-ASPIRIN",
			source: "ema",
		});
	});

	it("validates malformed search requests", async () => {
		const app = await buildApp();

		const response = await app.inject({
			method: "GET",
			url: "/medication-enrichment/search?q=",
		});

		expect(response.statusCode).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();

		await app.close();
	});

	it("returns enrichment suggestions with optional RxNorm strength data", async () => {
		const app = await buildApp();
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse([
					createEmaRow({
						name_of_medicine: "Tylenol 500 mg tablets",
						international_non_proprietary_name_common_name: "Acetaminophen",
						active_substance: "Acetaminophen",
						ema_product_number: "EMA-TYLENOL",
					}),
				])
			)
			.mockResolvedValueOnce(jsonResponse({ idGroup: { rxnormId: ["161"] } }))
			.mockResolvedValueOnce(
				jsonResponse({
					relatedGroup: {
						conceptGroup: [
							{
								conceptProperties: [
									{ name: "Acetaminophen 500 MG Oral Tablet" },
									{ name: "Acetaminophen 650 MG Oral Tablet" },
								],
							},
						],
					},
				})
			);

		const response = await app.inject({
			method: "POST",
			url: "/medication-enrichment/enrich",
			payload: {
				query: "Paracetamol",
				name: "Tylenol 500 mg tablets",
				genericName: "Acetaminophen",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			selection: {
				name: "Tylenol 500 mg tablets",
				genericName: "Acetaminophen",
				source: "ema+rxnorm",
			},
			suggestions: {
				medicationForm: "tablet",
				strengthOptions: [
					{ label: "500 mg", pillWeightMg: 500, doseUnit: "mg" },
					{ label: "650 mg", pillWeightMg: 650, doseUnit: "mg" },
				],
			},
			meta: {
				rxNormMatched: true,
				openFdaMatched: false,
				partial: false,
				note: null,
			},
		});

		await app.close();
	});

	it("keeps incomplete-coverage messaging honest when RxNorm enrichment fails", async () => {
		const { enrichMedicationSelection } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("medicines-output-medicines_json-report_en.json")) {
				return Promise.resolve(
					jsonResponse([
						createEmaRow({
							name_of_medicine: "Tylenol 500 mg tablets",
							international_non_proprietary_name_common_name: "Acetaminophen",
							active_substance: "Acetaminophen",
							ema_product_number: "EMA-TYLENOL",
						}),
					])
				);
			}
			if (url.includes("/rxcui.json?name=acetaminophen&search=2")) {
				return Promise.reject(new Error("rxnorm timeout"));
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(jsonResponse({ results: [] }));
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await enrichMedicationSelection({
			query: "Paracetamol",
			name: "Tylenol 500 mg tablets",
			genericName: "Acetaminophen",
		});

		expect(response.selection.source).toBe("ema");
		expect(response.suggestions.strengthOptions).toEqual([]);
		expect(response.meta).toEqual({
			rxNormMatched: false,
			openFdaMatched: false,
			partial: true,
			note: "Returned EMA enrichment without RxNorm suggestions.",
		});
	});

	it("enriches RxNorm selections by code and falls back to openFDA without best-match guessing", async () => {
		const { enrichMedicationSelection } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("/rxcui/12345/related.json")) {
				return Promise.resolve(
					jsonResponse({
						relatedGroup: {
							conceptGroup: [],
						},
					})
				);
			}
			if (url.includes("api.fda.gov/drug/ndc.json")) {
				return Promise.resolve(
					jsonResponse({
						results: [
							{
								product_ndc: "00011-1111",
								brand_name: "Ozempic",
								generic_name: "Semaglutide",
								dosage_form: "Tablet",
								active_ingredients: [{ name: "Semaglutide", strength: "2 mg" }],
							},
						],
					})
				);
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await enrichMedicationSelection({
			query: "Ozempic",
			name: "Ozempic",
			genericName: "Semaglutide",
			code: "12345",
			source: "rxnorm",
		});

		expect(response).toMatchObject({
			selection: {
				name: "Ozempic",
				genericName: "Semaglutide",
				source: "rxnorm+openfda",
			},
			suggestions: {
				medicationForm: "tablet",
				strengthOptions: [{ label: "2 mg", pillWeightMg: 2, doseUnit: "mg" }],
			},
			meta: {
				rxNormMatched: false,
				openFdaMatched: true,
				partial: false,
				note: null,
			},
		});
	});

	it("enriches openFDA selections by code and augments them with RxNorm strength data", async () => {
		const { enrichMedicationSelection } = await import("../services/medication-enrichment.js");

		fetchMock.mockImplementation((url: string) => {
			if (url.includes("search=product_ndc%3A%2200011-1111%22")) {
				return Promise.resolve(
					jsonResponse({
						results: [
							{
								product_ndc: "00011-1111",
								brand_name: "US Ibuprofen",
								generic_name: "Ibuprofen",
								dosage_form: "Tablet",
								active_ingredients: [{ name: "Ibuprofen", strength: "200 mg" }],
							},
						],
					})
				);
			}
			if (url.includes("/rxcui.json?name=ibuprofen&search=2")) {
				return Promise.resolve(jsonResponse({ idGroup: { rxnormId: ["161"] } }));
			}
			if (url.includes("/rxcui/161/related.json")) {
				return Promise.resolve(
					jsonResponse({
						relatedGroup: {
							conceptGroup: [
								{
									conceptProperties: [
										{ name: "Ibuprofen 200 MG Oral Tablet" },
										{ name: "Ibuprofen 400 MG Oral Tablet" },
									],
								},
							],
						},
					})
				);
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		const response = await enrichMedicationSelection({
			query: "US Ibuprofen",
			name: "US Ibuprofen",
			genericName: "Ibuprofen",
			code: "00011-1111",
			source: "openfda",
		});

		expect(response).toMatchObject({
			selection: {
				name: "US Ibuprofen",
				genericName: "Ibuprofen",
				source: "rxnorm+openfda",
			},
			suggestions: {
				medicationForm: "tablet",
				strengthOptions: [
					{ label: "200 mg", pillWeightMg: 200, doseUnit: "mg" },
					{ label: "400 mg", pillWeightMg: 400, doseUnit: "mg" },
				],
			},
			meta: {
				rxNormMatched: true,
				openFdaMatched: true,
				partial: false,
				note: null,
			},
		});
	});

	it("returns not found when an explicit selection cannot be resolved", async () => {
		const app = await buildApp();
		fetchMock.mockResolvedValueOnce(jsonResponse([createEmaRow()]));

		const response = await app.inject({
			method: "POST",
			url: "/medication-enrichment/enrich",
			payload: {
				query: "Unknown",
				name: "Completely Different Medication",
				genericName: "No match",
			},
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			code: "MEDICATION_ENRICHMENT_NOT_FOUND",
			error: "Selected medication could not be resolved.",
		});

		await app.close();
	});
});
