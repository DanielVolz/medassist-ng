import type { FastifyBaseLogger } from "fastify";
import type { PackageType } from "../utils/package-profiles.js";

const EMA_MEDICINES_URL =
	"https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json";
const RXNORM_BASE_URL = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA_NDC_URL = "https://api.fda.gov/drug/ndc.json";
const EMA_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const EMA_FETCH_TIMEOUT_MS = 15_000;
const RXNORM_FETCH_TIMEOUT_MS = 8_000;
const OPENFDA_FETCH_TIMEOUT_MS = 8_000;
export const MEDICATION_ENRICHMENT_SEARCH_DEFAULT_LIMIT = 6;
export const MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT = 20;
const RXNORM_SEARCH_LIMIT = MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT;
const OPENFDA_SEARCH_LIMIT = MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT;

const GERMAN_INGREDIENT_NORMALIZATION: Record<string, string> = {
	acetylsalicylsaeure: "acetylsalicylic acid",
	acetylsalicylsaure: "acetylsalicylic acid",
	aspirin: "acetylsalicylic acid",
	colecalciferol: "cholecalciferol",
	dimethylfumarat: "dimethyl fumarate",
	paracetamol: "acetaminophen",
};

export type MedicationEnrichmentSearchSource = "ema" | "rxnorm" | "openfda";
export type MedicationEnrichmentCombinedSource =
	| MedicationEnrichmentSearchSource
	| "ema+rxnorm"
	| "ema+openfda"
	| "rxnorm+openfda"
	| "ema+rxnorm+openfda";

export type MedicationEnrichmentSearchResult = {
	code: string;
	name: string;
	genericName: string | null;
	authorisationHolder: string | null;
	therapeuticArea: string | null;
	matchType: "brand" | "ingredient";
	genericStatus: "generic" | "original" | "unknown";
	authorisationDate: string | null;
	source: MedicationEnrichmentSearchSource;
	packageOptions: MedicationEnrichmentPackageOption[];
};

export type MedicationEnrichmentStrengthOption = {
	label: string;
	pillWeightMg: number | null;
	doseUnit: "mg" | "g" | "mcg" | "ml" | "IU" | "units" | "drops" | "puffs" | null;
};

export type MedicationEnrichmentPackageOption = {
	label: string;
	description: string;
	packageType: PackageType;
	packCount: number;
	blistersPerPack: number | null;
	pillsPerBlister: number | null;
	totalPills: number | null;
	looseTablets: number | null;
	packageAmountValue: number | null;
	packageAmountUnit: "ml" | "g" | null;
};

export type MedicationEnrichmentSearchResponse = {
	query: string;
	normalizedQuery: string;
	hasMore: boolean;
	results: MedicationEnrichmentSearchResult[];
};

export type MedicationEnrichmentEnrichRequest = {
	query: string;
	name: string;
	genericName?: string | null;
	code?: string | null;
	source?: MedicationEnrichmentSearchSource | null;
};

export type MedicationEnrichmentEnrichResponse = {
	selection: {
		name: string;
		genericName: string | null;
		therapeuticArea: string | null;
		indication: string | null;
		atcCode: string | null;
		source: MedicationEnrichmentCombinedSource;
	};
	suggestions: {
		name: string;
		genericName: string | null;
		medicationForm: "capsule" | "tablet" | "liquid" | "topical" | null;
		strengthOptions: MedicationEnrichmentStrengthOption[];
		packageOptions: MedicationEnrichmentPackageOption[];
	};
	meta: {
		rxNormMatched: boolean;
		openFdaMatched: boolean;
		partial: boolean;
		note: string | null;
	};
};

type MedicationEnrichmentLogger = Pick<FastifyBaseLogger, "debug" | "error" | "info" | "warn">;

type EmaMedicineRow = Record<string, unknown>;

type EmaCatalogEntry = {
	code: string;
	name: string;
	genericName: string | null;
	authorisationHolder: string | null;
	therapeuticArea: string | null;
	indication: string | null;
	atcCode: string | null;
	genericStatus: "generic" | "original" | "unknown";
	authorisationDate: string | null;
	nameKey: string;
	genericKey: string;
	activeSubstanceKey: string;
};

type EmaCatalogSnapshot = {
	entries: EmaCatalogEntry[];
	loadedAt: number;
};

type RxNormDrugConceptProperty = {
	rxcui?: string;
	name?: string;
	synonym?: string;
	tty?: string;
};

type RxNormDrugConceptGroup = {
	tty?: string;
	conceptProperties?: RxNormDrugConceptProperty[];
};

type RxNormDrugsResponse = {
	drugGroup?: {
		conceptGroup?: RxNormDrugConceptGroup[];
	};
};

type RxNormConceptProperty = {
	name?: string;
};

type RxNormConceptGroup = {
	conceptProperties?: RxNormConceptProperty[];
};

type RxNormRelatedResponse = {
	relatedGroup?: {
		conceptGroup?: RxNormConceptGroup[];
	};
};

type RxNormEnrichment = {
	strengthOptions: MedicationEnrichmentStrengthOption[];
	medicationForm: "capsule" | "tablet" | "liquid" | "topical" | null;
};

type OpenFdaActiveIngredient = {
	name?: string;
	strength?: string;
};

type OpenFdaProduct = {
	product_ndc?: string;
	product_id?: string;
	generic_name?: string;
	brand_name?: string;
	labeler_name?: string;
	dosage_form?: string;
	marketing_start_date?: string;
	active_ingredients?: OpenFdaActiveIngredient[];
	packaging?: OpenFdaPackaging[];
};

type OpenFdaPackaging = {
	description?: string;
	package_ndc?: string;
};

type OpenFdaResponse = {
	results?: OpenFdaProduct[];
};

type OpenFdaEnrichment = {
	name: string;
	genericName: string | null;
	strengthOptions: MedicationEnrichmentStrengthOption[];
	medicationForm: "capsule" | "tablet" | "liquid" | "topical" | null;
	packageOptions: MedicationEnrichmentPackageOption[];
};

type ParsedOpenFdaPackagingSegment = {
	quantity: number;
	itemText: string;
	containerCount: number;
	containerText: string;
};

const defaultLogger: MedicationEnrichmentLogger = {
	debug: (msg: string) => console.debug(msg),
	info: (msg: string) => console.info(msg),
	warn: (msg: string) => console.warn(msg),
	error: (msg: string) => console.error(msg),
};

let activeLogger: MedicationEnrichmentLogger = defaultLogger;
let emaCatalogSnapshot: EmaCatalogSnapshot | null = null;
let emaRefreshPromise: Promise<EmaCatalogSnapshot> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let schedulerStarted = false;

export class MedicationEnrichmentServiceError extends Error {
	statusCode: number;
	code: string;

	constructor(message: string, statusCode: number, code: string) {
		super(message);
		this.name = "MedicationEnrichmentServiceError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

function sanitizeText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&quot;/gi, '"')
		.replace(/&#039;/gi, "'")
		.replace(/&apos;/gi, "'")
		.replace(/&amp;/gi, "&")
		.replace(/\s+/g, " ")
		.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function parseEmaDate(value: unknown): string | null {
	const sanitized = sanitizeText(value);
	if (!sanitized) return null;
	const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(sanitized);
	if (!match) return sanitized;
	const [, day, month, year] = match;
	return `${year}-${month}-${day}`;
}

function parseCompactDate(value: unknown): string | null {
	const sanitized = sanitizeText(value);
	if (!sanitized) return null;
	const match = /^(\d{4})(\d{2})(\d{2})$/.exec(sanitized);
	if (!match) return null;
	const [, year, month, day] = match;
	return `${year}-${month}-${day}`;
}

function normalizeSearchText(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[(){}[\],/]/g, " ")
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function removeStrengthHints(value: string): string {
	return value
		.replace(/\b\d+(?:[.,]\d+)?\s*(mg|g|mcg|ml|iu|units?|drops?|puffs?)\b/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeIngredientTerm(value: string): string {
	const normalized = normalizeSearchText(value);
	return GERMAN_INGREDIENT_NORMALIZATION[normalized] ?? normalized;
}

function getSearchCandidates(query: string): string[] {
	const normalized = normalizeSearchText(query);
	const withoutStrength = normalizeSearchText(removeStrengthHints(query));
	const ingredient = normalizeIngredientTerm(query);
	const ingredientWithoutStrength = normalizeIngredientTerm(withoutStrength);
	return [...new Set([normalized, withoutStrength, ingredient, ingredientWithoutStrength].filter(Boolean))];
}

function isHumanMedicine(row: EmaMedicineRow): boolean {
	const category = sanitizeText(row.category)?.toLowerCase();
	return category === "human";
}

function isAuthorisedMedicine(row: EmaMedicineRow): boolean {
	const status = sanitizeText(row.medicine_status)?.toLowerCase() ?? "";
	if (!status.includes("authorised")) return false;
	return !status.includes("withdrawn") && !status.includes("revoked") && !status.includes("refused");
}

function deriveGenericStatus(row: EmaMedicineRow): "generic" | "original" | "unknown" {
	const generic = sanitizeText(row.generic_or_hybrid ?? row.generic)?.toLowerCase();
	const biosimilar = sanitizeText(row.biosimilar)?.toLowerCase();
	if (generic === "yes" || biosimilar === "yes") return "generic";
	if (generic === "no" && biosimilar === "no") return "original";
	return "unknown";
}

function buildCatalogEntry(row: EmaMedicineRow): EmaCatalogEntry | null {
	if (!isHumanMedicine(row) || !isAuthorisedMedicine(row)) return null;

	const name = sanitizeText(row.name_of_medicine);
	if (!name) return null;

	const genericName =
		sanitizeText(row.international_non_proprietary_name_common_name) ?? sanitizeText(row.active_substance) ?? null;
	const activeSubstance = sanitizeText(row.active_substance);
	const code = sanitizeText(row.ema_product_number) ?? normalizeSearchText(name);

	return {
		code,
		name,
		genericName,
		authorisationHolder: sanitizeText(row.marketing_authorisation_developer_applicant_holder),
		therapeuticArea: sanitizeText(row.therapeutic_area_mesh),
		indication: sanitizeText(row.therapeutic_indication),
		atcCode: sanitizeText(row.atc_code_human),
		genericStatus: deriveGenericStatus(row),
		authorisationDate:
			parseEmaDate(row.marketing_authorisation_date) ?? parseEmaDate(row.european_commission_decision_date),
		nameKey: normalizeSearchText(name),
		genericKey: genericName ? normalizeSearchText(genericName) : "",
		activeSubstanceKey: activeSubstance ? normalizeSearchText(activeSubstance) : "",
	};
}

function extractEmaRows(payload: unknown): EmaMedicineRow[] {
	if (Array.isArray(payload)) {
		return payload.filter((item): item is EmaMedicineRow => !!item && typeof item === "object");
	}

	if (!payload || typeof payload !== "object") return [];
	const record = payload as Record<string, unknown>;
	for (const key of ["medicines", "items", "data", "rows"]) {
		if (Array.isArray(record[key])) {
			return record[key].filter((item): item is EmaMedicineRow => !!item && typeof item === "object");
		}
	}

	return [];
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		try {
			const response = await fetch(url, {
				headers: { accept: "application/json" },
				redirect: "error",
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`HTTP_${response.status}`);
			}

			return await response.json();
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`TIMEOUT_${timeoutMs}MS`);
			}
			throw error;
		}
	} finally {
		clearTimeout(timeout);
	}
}

async function refreshEmaCatalog(reason: "startup" | "scheduled" | "request"): Promise<EmaCatalogSnapshot> {
	if (emaRefreshPromise) return emaRefreshPromise;

	emaRefreshPromise = (async () => {
		try {
			const payload = await fetchJson(EMA_MEDICINES_URL, EMA_FETCH_TIMEOUT_MS);
			const entries = extractEmaRows(payload)
				.map(buildCatalogEntry)
				.filter((entry): entry is EmaCatalogEntry => entry !== null);
			const snapshot = { entries, loadedAt: Date.now() };
			emaCatalogSnapshot = snapshot;
			activeLogger.info(`[MedicationEnrichment] EMA catalog refreshed (${reason}) with ${entries.length} entries`);
			return snapshot;
		} catch (error) {
			activeLogger.error(
				`[MedicationEnrichment] EMA catalog refresh failed (${reason}): ${error instanceof Error ? error.message : "unknown"}`
			);
			if (emaCatalogSnapshot) {
				return emaCatalogSnapshot;
			}
			throw new MedicationEnrichmentServiceError(
				"Medication enrichment is temporarily unavailable.",
				503,
				"MEDICATION_ENRICHMENT_UNAVAILABLE"
			);
		} finally {
			emaRefreshPromise = null;
		}
	})();

	return emaRefreshPromise;
}

async function ensureEmaCatalogReady(): Promise<EmaCatalogSnapshot> {
	if (emaCatalogSnapshot) return emaCatalogSnapshot;
	return refreshEmaCatalog("request");
}

function scoreNameAndIngredient(
	nameKey: string,
	genericKeys: string[],
	candidate: string
): { score: number; matchType: "brand" | "ingredient" } | null {
	const tokens = candidate.split(" ").filter(Boolean);
	if (tokens.length === 0) return null;

	const genericKey = genericKeys.join(" ");
	const ingredientContainsCandidate = genericKeys.some((value) => value === candidate);
	const ingredientStartsCandidate = genericKeys.some((value) => value.startsWith(candidate));
	const ingredientIncludesCandidate = genericKeys.some((value) => value.includes(candidate));
	const ingredientTokenMatch = tokens.every((token) => genericKeys.some((value) => value.includes(token)));

	if (nameKey === candidate) return { score: 120, matchType: "brand" };
	if (ingredientContainsCandidate) return { score: 115, matchType: "ingredient" };
	if (nameKey.startsWith(candidate)) return { score: 95, matchType: "brand" };
	if (ingredientStartsCandidate) return { score: 85, matchType: "ingredient" };
	if (nameKey.includes(candidate)) return { score: 70, matchType: "brand" };
	if (ingredientIncludesCandidate) return { score: 62, matchType: "ingredient" };
	if (tokens.every((token) => nameKey.includes(token))) return { score: 58, matchType: "brand" };
	if (ingredientTokenMatch || (genericKey.length > 0 && tokens.every((token) => genericKey.includes(token)))) {
		return { score: 52, matchType: "ingredient" };
	}
	return null;
}

function scoreEntry(
	entry: EmaCatalogEntry,
	candidate: string
): { score: number; matchType: "brand" | "ingredient" } | null {
	return scoreNameAndIngredient(entry.nameKey, [entry.genericKey, entry.activeSubstanceKey].filter(Boolean), candidate);
}

function getSearchSourcePriority(source: MedicationEnrichmentSearchSource): number {
	if (source === "rxnorm") return 0;
	if (source === "openfda") return 1;
	return 2;
}

function compareSearchResults(
	left: MedicationEnrichmentSearchResult & { score: number },
	right: MedicationEnrichmentSearchResult & { score: number }
): number {
	return (
		right.packageOptions.length - left.packageOptions.length ||
		getSearchSourcePriority(left.source) - getSearchSourcePriority(right.source) ||
		right.score - left.score ||
		left.name.localeCompare(right.name)
	);
}

function collectEmaSearchResults(
	snapshot: EmaCatalogSnapshot,
	query: string
): Array<MedicationEnrichmentSearchResult & { score: number }> {
	const candidates = getSearchCandidates(query);
	const byCode = new Map<string, MedicationEnrichmentSearchResult & { score: number }>();

	for (const entry of snapshot.entries) {
		let bestMatch: { score: number; matchType: "brand" | "ingredient" } | null = null;
		for (const candidate of candidates) {
			const match = scoreEntry(entry, candidate);
			if (!match) continue;
			if (!bestMatch || match.score > bestMatch.score) {
				bestMatch = match;
			}
		}

		if (!bestMatch) continue;

		const current = byCode.get(entry.code);
		if (current && current.score >= bestMatch.score) continue;

		byCode.set(entry.code, {
			code: entry.code,
			name: entry.name,
			genericName: entry.genericName,
			authorisationHolder: entry.authorisationHolder,
			therapeuticArea: entry.therapeuticArea,
			matchType: bestMatch.matchType,
			genericStatus: entry.genericStatus,
			authorisationDate: entry.authorisationDate,
			source: "ema",
			packageOptions: [],
			score: bestMatch.score,
		});
	}

	return [...byCode.values()].sort(compareSearchResults);
}

function selectCatalogEntry(
	snapshot: EmaCatalogSnapshot,
	request: MedicationEnrichmentEnrichRequest
): EmaCatalogEntry | null {
	if (request.source === "ema" && request.code) {
		return snapshot.entries.find((entry) => entry.code === request.code) ?? null;
	}

	const normalizedName = normalizeSearchText(request.name);
	const normalizedGeneric = request.genericName ? normalizeSearchText(request.genericName) : "";
	const normalizedQuery = normalizeSearchText(request.query);
	const candidates = [normalizedName, normalizedGeneric, normalizedQuery].filter(Boolean);

	let bestEntry: EmaCatalogEntry | null = null;
	let bestScore = 0;

	for (const entry of snapshot.entries) {
		for (const candidate of candidates) {
			const match = scoreEntry(entry, candidate);
			if (!match || match.score <= bestScore) continue;
			bestEntry = entry;
			bestScore = match.score;
		}
	}

	return bestEntry;
}

function uniqueStrengthOptions(options: MedicationEnrichmentStrengthOption[]): MedicationEnrichmentStrengthOption[] {
	const deduped = new Map<string, MedicationEnrichmentStrengthOption>();
	for (const option of options) {
		if (!deduped.has(option.label)) {
			deduped.set(option.label, option);
		}
	}
	return [...deduped.values()];
}

function normalizeDoseUnit(unit: string): MedicationEnrichmentStrengthOption["doseUnit"] {
	const normalized = unit.toLowerCase();
	if (normalized === "mg") return "mg";
	if (normalized === "g") return "g";
	if (normalized === "mcg" || normalized === "μg") return "mcg";
	if (normalized === "ml") return "ml";
	if (normalized === "iu") return "IU";
	if (normalized === "units" || normalized === "unit") return "units";
	if (normalized === "drops" || normalized === "drop") return "drops";
	if (normalized === "puffs" || normalized === "puff") return "puffs";
	return null;
}

function parseStrengthOption(label: string): MedicationEnrichmentStrengthOption | null {
	const match = label.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)\b/i);
	if (!match) return null;

	const numericValue = Number(match[1]);
	if (!Number.isFinite(numericValue)) return null;

	const doseUnit = normalizeDoseUnit(match[2]);
	let pillWeightMg: number | null = null;
	if (doseUnit === "mg") {
		pillWeightMg = numericValue;
	} else if (doseUnit === "g") {
		pillWeightMg = numericValue * 1000;
	} else if (doseUnit === "mcg") {
		pillWeightMg = numericValue / 1000;
	}

	return {
		label: `${match[1]} ${doseUnit ?? match[2].toLowerCase()}`,
		pillWeightMg,
		doseUnit,
	};
}

function deriveMedicationFormFromName(value: string): "capsule" | "tablet" | "liquid" | "topical" | null {
	const normalized = value.toLowerCase();
	if (normalized.includes("capsule")) return "capsule";
	if (normalized.includes("tablet")) return "tablet";
	if (
		normalized.includes("solution") ||
		normalized.includes("suspension") ||
		normalized.includes("syrup") ||
		normalized.includes("oral liquid")
	) {
		return "liquid";
	}
	if (
		normalized.includes("cream") ||
		normalized.includes("ointment") ||
		normalized.includes("gel") ||
		normalized.includes("lotion") ||
		normalized.includes("spray") ||
		normalized.includes("patch")
	) {
		return "topical";
	}
	return null;
}

function extractBracketedBrand(value: string): string | null {
	const match = /\[([^\]]+)\]\s*$/.exec(value);
	return match?.[1] ? sanitizeText(match[1]) : null;
}

function stripBracketedBrand(value: string): string {
	return value.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

function extractIngredientName(value: string): string | null {
	const sanitized = sanitizeText(stripBracketedBrand(value));
	if (!sanitized) return null;
	const beforeStrength = sanitized.split(/\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b/i)[0]?.trim() ?? sanitized;
	const ingredient = beforeStrength.split("/")[0]?.trim() ?? beforeStrength;
	return ingredient.length > 0 ? ingredient : sanitized;
}

function isRxNormSearchGroup(group: RxNormDrugConceptGroup): boolean {
	return group.tty === "SBD" || group.tty === "SCD";
}

function buildRxNormSearchResult(property: RxNormDrugConceptProperty): MedicationEnrichmentSearchResult | null {
	const code = sanitizeText(property.rxcui);
	const rawName = sanitizeText(property.name);
	if (!code || !rawName) return null;

	const bracketBrand = extractBracketedBrand(rawName);
	const synonym = sanitizeText(property.synonym);
	const genericName = extractIngredientName(rawName);
	const displayName = bracketBrand ?? synonym ?? stripBracketedBrand(rawName);
	if (!displayName) return null;

	return {
		code,
		name: displayName,
		genericName,
		authorisationHolder: null,
		therapeuticArea: null,
		matchType: bracketBrand ? "brand" : "ingredient",
		genericStatus: "unknown",
		authorisationDate: null,
		source: "rxnorm",
		packageOptions: [],
	};
}

async function fetchRxNormSearchResults(query: string, limit: number): Promise<MedicationEnrichmentSearchResult[]> {
	const byCode = new Map<string, MedicationEnrichmentSearchResult & { score: number }>();
	const candidates = getSearchCandidates(query);

	for (const candidate of candidates) {
		let payload: RxNormDrugsResponse;
		try {
			payload = (await fetchJson(
				`${RXNORM_BASE_URL}/drugs.json?name=${encodeURIComponent(candidate)}`,
				RXNORM_FETCH_TIMEOUT_MS
			)) as RxNormDrugsResponse;
		} catch (error) {
			activeLogger.warn(
				`[MedicationEnrichment] RxNorm search failed for "${candidate}": ${error instanceof Error ? error.message : "unknown"}`
			);
			continue;
		}

		for (const group of payload.drugGroup?.conceptGroup ?? []) {
			if (!isRxNormSearchGroup(group)) continue;
			for (const property of group.conceptProperties ?? []) {
				const result = buildRxNormSearchResult(property);
				if (!result) continue;
				const match = scoreNameAndIngredient(
					normalizeSearchText(result.name),
					result.genericName ? [normalizeSearchText(result.genericName)] : [],
					candidate
				);
				if (!match) continue;

				const score = match.score - (group.tty === "SCD" ? 6 : 0);
				const current = byCode.get(result.code);
				if (current && current.score >= score) continue;

				byCode.set(result.code, {
					...result,
					matchType: match.matchType,
					score,
				});
			}
		}
	}

	return [...byCode.values()]
		.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
		.slice(0, Math.min(limit, RXNORM_SEARCH_LIMIT))
		.map(({ score: _score, ...result }) => result);
}

async function fetchRxNormEnrichmentByRxcui(rxcui: string): Promise<RxNormEnrichment | null> {
	if (!rxcui) return null;
	const relatedPayload = (await fetchJson(
		`${RXNORM_BASE_URL}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=SCD+SBD`,
		RXNORM_FETCH_TIMEOUT_MS
	)) as RxNormRelatedResponse;

	const conceptNames =
		relatedPayload.relatedGroup?.conceptGroup?.flatMap((group) =>
			(group.conceptProperties ?? [])
				.map((property) => sanitizeText(property.name))
				.filter((value): value is string => value !== null)
		) ?? [];

	if (conceptNames.length === 0) return null;

	const strengthOptions = uniqueStrengthOptions(
		conceptNames
			.map((name) => parseStrengthOption(name))
			.filter((value): value is MedicationEnrichmentStrengthOption => value !== null)
	);
	const medicationForm =
		conceptNames
			.map(deriveMedicationFormFromName)
			.find((value): value is NonNullable<typeof value> => value !== null) ?? null;

	return { strengthOptions, medicationForm };
}

async function fetchRxNormEnrichment(term: string): Promise<RxNormEnrichment | null> {
	if (!term) return null;

	const payload = (await fetchJson(
		`${RXNORM_BASE_URL}/rxcui.json?name=${encodeURIComponent(term)}&search=2`,
		RXNORM_FETCH_TIMEOUT_MS
	)) as {
		idGroup?: { rxnormId?: string[] };
	};
	const rxcui = payload.idGroup?.rxnormId?.[0];
	if (!rxcui) return null;
	return fetchRxNormEnrichmentByRxcui(rxcui);
}

function buildOpenFdaSearchUrls(query: string): string[] {
	const raw = query.trim();
	const withoutStrength = removeStrengthHints(raw);
	const normalizedIngredient = normalizeIngredientTerm(raw);
	const normalizedIngredientWithoutStrength = normalizeIngredientTerm(withoutStrength);
	const searchTerms = [
		{ field: "brand_name", value: raw },
		{ field: "brand_name", value: withoutStrength },
		{ field: "generic_name", value: normalizedIngredient },
		{ field: "generic_name", value: normalizedIngredientWithoutStrength },
	].filter((entry) => entry.value.length > 0);

	return [...new Set(searchTerms.map((entry) => `${entry.field}:${entry.value}`))].map((entry) => {
		const [field, value] = entry.split(":");
		const params = new URLSearchParams({
			search: `${field}:"${value}"`,
			limit: String(OPENFDA_SEARCH_LIMIT),
		});
		return `${OPENFDA_NDC_URL}?${params.toString()}`;
	});
}

function normalizeOpenFdaName(value: unknown): string | null {
	const sanitized = sanitizeText(value);
	if (!sanitized) return null;
	return sanitized
		.split(/\s*;\s*/)[0]
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeOpenFdaPackagingText(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseOpenFdaPackagingSegment(segment: string): ParsedOpenFdaPackagingSegment | null {
	const sanitized = sanitizeText(segment);
	if (!sanitized) return null;
	const match = /^(\d+(?:[.,]\d+)?)\s+(.+?)\s+in\s+(\d+(?:[.,]\d+)?)\s+(.+)$/i.exec(sanitized);
	if (!match) return null;

	const quantity = Number(match[1].replace(",", "."));
	const containerCount = Number(match[3].replace(",", "."));
	if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(containerCount) || containerCount <= 0) {
		return null;
	}

	return {
		quantity,
		itemText: match[2].trim(),
		containerCount,
		containerText: match[4].trim(),
	};
}

function isOpenFdaBlisterLikeContainer(containerText: string): boolean {
	const normalized = normalizeOpenFdaPackagingText(containerText);
	return (
		normalized.includes("BLISTER") ||
		normalized.includes("POUCH") ||
		normalized.includes("STRIP") ||
		normalized.includes("SACHET")
	);
}

function isOpenFdaBottleLikeContainer(containerText: string): boolean {
	const normalized = normalizeOpenFdaPackagingText(containerText);
	return normalized.includes("BOTTLE") || normalized.includes("JAR") || normalized.includes("VIAL");
}

function isOpenFdaSolidUnit(itemText: string): boolean {
	const normalized = normalizeOpenFdaPackagingText(itemText);
	return (
		normalized.includes("TABLET") ||
		normalized.includes("CAPSULE") ||
		normalized.includes("CAPLET") ||
		normalized.includes("SOFTGEL") ||
		normalized.includes("LOZENGE")
	);
}

function getOpenFdaAmountUnit(itemText: string): "ml" | "g" | null {
	const normalized = normalizeOpenFdaPackagingText(itemText);
	if (normalized.includes("ML")) return "ml";
	if (normalized === "G" || normalized.startsWith("G ") || normalized.includes("GRAM")) return "g";
	return null;
}

function toPositiveInteger(value: number): number | null {
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.round(value);
}

function uniquePackageOptions(options: MedicationEnrichmentPackageOption[]): MedicationEnrichmentPackageOption[] {
	const byKey = new Map<string, MedicationEnrichmentPackageOption>();
	for (const option of options) {
		const key = JSON.stringify([
			option.description,
			option.packageType,
			option.packCount,
			option.blistersPerPack,
			option.pillsPerBlister,
			option.totalPills,
			option.packageAmountValue,
			option.packageAmountUnit,
		]);
		if (!byKey.has(key)) {
			byKey.set(key, option);
		}
	}
	return [...byKey.values()];
}

function buildOpenFdaPackageOptions(product: OpenFdaProduct): MedicationEnrichmentPackageOption[] {
	return uniquePackageOptions(
		(product.packaging ?? [])
			.map((entry): MedicationEnrichmentPackageOption | null => {
				const description = sanitizeText(entry.description);
				if (!description) return null;

				const segments = description.split(/\s*\/\s*/).filter((value) => value.trim().length > 0);
				const outerSegment = segments.length > 1 ? parseOpenFdaPackagingSegment(segments[0] ?? "") : null;
				const primarySegment = parseOpenFdaPackagingSegment(segments[segments.length - 1] ?? "");
				if (!primarySegment) return null;

				const packCount = toPositiveInteger(outerSegment?.quantity ?? 1) ?? 1;
				const packageAmountUnit = getOpenFdaAmountUnit(primarySegment.itemText);
				if (packageAmountUnit) {
					const packageAmountValue = toPositiveInteger(primarySegment.quantity);
					if (packageAmountValue === null) return null;
					const totalAmount = packCount * packageAmountValue;
					return {
						label: description,
						description,
						packageType: packageAmountUnit === "g" ? "tube" : "liquid_container",
						packCount,
						blistersPerPack: null,
						pillsPerBlister: null,
						totalPills: totalAmount,
						looseTablets: totalAmount,
						packageAmountValue,
						packageAmountUnit,
					} satisfies MedicationEnrichmentPackageOption;
				}

				if (!isOpenFdaSolidUnit(primarySegment.itemText)) return null;
				const pillsPerUnit = toPositiveInteger(primarySegment.quantity);
				if (pillsPerUnit === null) return null;

				if (isOpenFdaBlisterLikeContainer(primarySegment.containerText)) {
					return {
						label: description,
						description,
						packageType: "blister",
						packCount: 1,
						blistersPerPack: packCount,
						pillsPerBlister: pillsPerUnit,
						totalPills: packCount * pillsPerUnit,
						looseTablets: 0,
						packageAmountValue: null,
						packageAmountUnit: null,
					} satisfies MedicationEnrichmentPackageOption;
				}

				if (isOpenFdaBottleLikeContainer(primarySegment.containerText) || outerSegment === null) {
					const totalPills = packCount * pillsPerUnit;
					return {
						label: description,
						description,
						packageType: "bottle",
						packCount,
						blistersPerPack: null,
						pillsPerBlister: null,
						totalPills,
						looseTablets: totalPills,
						packageAmountValue: null,
						packageAmountUnit: null,
					} satisfies MedicationEnrichmentPackageOption;
				}

				return null;
			})
			.filter((value): value is MedicationEnrichmentPackageOption => value !== null)
	);
}

function buildOpenFdaSearchResult(product: OpenFdaProduct): MedicationEnrichmentSearchResult | null {
	const code = sanitizeText(product.product_ndc) ?? sanitizeText(product.product_id);
	const name = normalizeOpenFdaName(product.brand_name) ?? normalizeOpenFdaName(product.generic_name);
	if (!code || !name) return null;

	const genericName =
		normalizeOpenFdaName(product.generic_name) ?? normalizeOpenFdaName(product.active_ingredients?.[0]?.name) ?? null;
	const nameKey = normalizeSearchText(name);
	const genericKey = genericName ? normalizeSearchText(genericName) : "";
	const match = scoreNameAndIngredient(nameKey, genericKey ? [genericKey] : [], nameKey) ?? {
		score: 40,
		matchType: genericKey === nameKey ? "ingredient" : "brand",
	};

	return {
		code,
		name,
		genericName,
		authorisationHolder: null,
		therapeuticArea: null,
		matchType: match.matchType,
		genericStatus: "unknown",
		authorisationDate: parseCompactDate(product.marketing_start_date),
		source: "openfda",
		packageOptions: buildOpenFdaPackageOptions(product),
	};
}

async function fetchOpenFdaSearchResults(query: string, limit: number): Promise<MedicationEnrichmentSearchResult[]> {
	const byCode = new Map<string, MedicationEnrichmentSearchResult & { score: number }>();
	const candidates = getSearchCandidates(query);

	for (const url of buildOpenFdaSearchUrls(query)) {
		let payload: OpenFdaResponse;
		try {
			payload = (await fetchJson(url, OPENFDA_FETCH_TIMEOUT_MS)) as OpenFdaResponse;
		} catch (error) {
			if (error instanceof Error && error.message === "HTTP_404") {
				continue;
			}
			activeLogger.warn(
				`[MedicationEnrichment] openFDA search failed for "${query}": ${error instanceof Error ? error.message : "unknown"}`
			);
			continue;
		}

		for (const product of payload.results ?? []) {
			const result = buildOpenFdaSearchResult(product);
			if (!result) continue;

			let bestScore = 0;
			let bestMatchType: "brand" | "ingredient" = result.matchType;
			for (const candidate of candidates) {
				const match = scoreNameAndIngredient(
					normalizeSearchText(result.name),
					result.genericName ? [normalizeSearchText(result.genericName)] : [],
					candidate
				);
				if (!match || match.score <= bestScore) continue;
				bestScore = match.score;
				bestMatchType = match.matchType;
			}
			if (bestScore === 0) continue;

			const score = bestScore - 12;
			const current = byCode.get(result.code);
			if (current && current.score >= score) continue;

			byCode.set(result.code, {
				...result,
				matchType: bestMatchType,
				score,
			});
		}
	}

	return [...byCode.values()]
		.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
		.slice(0, Math.min(limit, OPENFDA_SEARCH_LIMIT))
		.map(({ score: _score, ...result }) => result);
}

function buildOpenFdaStrengthOptions(product: OpenFdaProduct): MedicationEnrichmentStrengthOption[] {
	return uniqueStrengthOptions(
		(product.active_ingredients ?? [])
			.map((ingredient) => sanitizeText(ingredient.strength))
			.filter((value): value is string => value !== null)
			.map((strength) => strength.split("/")[0]?.trim() ?? strength)
			.map((strength) => parseStrengthOption(strength))
			.filter((value): value is MedicationEnrichmentStrengthOption => value !== null)
	);
}

function buildOpenFdaEnrichment(product: OpenFdaProduct): OpenFdaEnrichment | null {
	const name = normalizeOpenFdaName(product.brand_name) ?? normalizeOpenFdaName(product.generic_name);
	if (!name) return null;
	const genericName =
		normalizeOpenFdaName(product.generic_name) ?? normalizeOpenFdaName(product.active_ingredients?.[0]?.name) ?? null;

	return {
		name,
		genericName,
		strengthOptions: buildOpenFdaStrengthOptions(product),
		medicationForm: product.dosage_form ? deriveMedicationFormFromName(product.dosage_form) : null,
		packageOptions: buildOpenFdaPackageOptions(product),
	};
}

async function fetchOpenFdaProductByCode(code: string): Promise<OpenFdaProduct | null> {
	if (!code) return null;
	const params = new URLSearchParams({
		search: `product_ndc:"${code}"`,
		limit: "1",
	});

	try {
		const payload = (await fetchJson(
			`${OPENFDA_NDC_URL}?${params.toString()}`,
			OPENFDA_FETCH_TIMEOUT_MS
		)) as OpenFdaResponse;
		return payload.results?.[0] ?? null;
	} catch (error) {
		if (error instanceof Error && error.message === "HTTP_404") {
			return null;
		}
		throw error;
	}
}

async function fetchOpenFdaEnrichmentByQuery(query: string): Promise<OpenFdaEnrichment | null> {
	for (const url of buildOpenFdaSearchUrls(query)) {
		try {
			const payload = (await fetchJson(url, OPENFDA_FETCH_TIMEOUT_MS)) as OpenFdaResponse;
			const enrichment = payload.results
				?.map(buildOpenFdaEnrichment)
				.find((value): value is OpenFdaEnrichment => value !== null);
			if (enrichment) return enrichment;
		} catch (error) {
			if (error instanceof Error && error.message === "HTTP_404") {
				continue;
			}
			throw error;
		}
	}
	return null;
}

function mergeStrengthOptions(
	rxNormOptions: MedicationEnrichmentStrengthOption[],
	openFdaOptions: MedicationEnrichmentStrengthOption[]
): MedicationEnrichmentStrengthOption[] {
	return uniqueStrengthOptions([...rxNormOptions, ...openFdaOptions]);
}

function buildCombinedSource(
	primarySource: MedicationEnrichmentSearchSource,
	rxNormMatched: boolean,
	openFdaMatched: boolean
): MedicationEnrichmentCombinedSource {
	const sources = new Set<MedicationEnrichmentSearchSource>([primarySource]);
	if (rxNormMatched) sources.add("rxnorm");
	if (openFdaMatched) sources.add("openfda");
	const ordered = ["ema", "rxnorm", "openfda"].filter((source): source is MedicationEnrichmentSearchSource =>
		sources.has(source as MedicationEnrichmentSearchSource)
	);
	return ordered.join("+") as MedicationEnrichmentCombinedSource;
}

function buildSelectionNameAndGeneric(request: MedicationEnrichmentEnrichRequest): {
	name: string;
	genericName: string | null;
} {
	const genericName = request.genericName?.trim() ? request.genericName.trim() : extractIngredientName(request.name);
	return {
		name: request.name,
		genericName,
	};
}

export function startMedicationEnrichmentService(logger: MedicationEnrichmentLogger): void {
	activeLogger = logger;
	if (schedulerStarted) return;

	schedulerStarted = true;
	void refreshEmaCatalog("startup").catch((error: unknown) => {
		activeLogger.error(
			`[MedicationEnrichment] startup refresh failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	});

	refreshTimer = setInterval(() => {
		void refreshEmaCatalog("scheduled").catch((error: unknown) => {
			activeLogger.error(
				`[MedicationEnrichment] scheduled refresh failed: ${error instanceof Error ? error.message : String(error)}`
			);
			return undefined;
		});
	}, EMA_REFRESH_INTERVAL_MS);

	if (typeof refreshTimer.unref === "function") {
		refreshTimer.unref();
	}
}

export const startMedicationEnrichmentCatalogRefresh = startMedicationEnrichmentService;

export async function searchMedicationEnrichment(
	query: string,
	limit: number
): Promise<MedicationEnrichmentSearchResponse> {
	const cappedLimit = Math.min(limit, MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT);
	const fetchLimit = MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT;
	const byCode = new Map<string, MedicationEnrichmentSearchResult & { score: number }>();

	const [rxNormResults, openFdaResults] = await Promise.all([
		fetchRxNormSearchResults(query, fetchLimit),
		fetchOpenFdaSearchResults(query, fetchLimit),
	]);

	for (const result of rxNormResults) {
		if (byCode.has(result.code)) continue;
		const score = result.matchType === "brand" ? 82 : 74;
		byCode.set(result.code, { ...result, score });
	}

	for (const result of openFdaResults) {
		if (byCode.has(result.code)) continue;
		const score = result.matchType === "brand" ? 68 : 60;
		byCode.set(result.code, { ...result, score });
	}

	if (byCode.size < fetchLimit) {
		const snapshot = await ensureEmaCatalogReady();
		const emaResults = collectEmaSearchResults(snapshot, query);
		for (const result of emaResults) {
			if (byCode.has(result.code)) continue;
			byCode.set(result.code, result);
			if (byCode.size >= fetchLimit) break;
		}
	}

	const orderedResults = [...byCode.values()].sort(compareSearchResults);

	return {
		query,
		normalizedQuery: normalizeSearchText(query),
		hasMore: orderedResults.length > cappedLimit,
		results: orderedResults.slice(0, cappedLimit).map(({ score: _score, ...result }) => result),
	};
}

export async function enrichMedicationSelection(
	request: MedicationEnrichmentEnrichRequest,
	logger?: MedicationEnrichmentLogger
): Promise<MedicationEnrichmentEnrichResponse> {
	const loggerToUse = logger ?? activeLogger;
	const requestedSource = request.source ?? "ema";
	let rxNormMatched = false;
	let openFdaMatched = false;
	let partial = false;
	let note: string | null = null;
	let rxNormEnrichment: RxNormEnrichment | null = null;
	let openFdaEnrichment: OpenFdaEnrichment | null = null;

	if (requestedSource === "ema") {
		const snapshot = await ensureEmaCatalogReady();
		const selectedEntry = selectCatalogEntry(snapshot, request);
		if (!selectedEntry) {
			throw new MedicationEnrichmentServiceError(
				"Selected medication could not be resolved.",
				404,
				"MEDICATION_ENRICHMENT_NOT_FOUND"
			);
		}

		const rxNormTerm = normalizeIngredientTerm(request.genericName ?? selectedEntry.genericName ?? request.query);
		try {
			rxNormEnrichment = await fetchRxNormEnrichment(rxNormTerm);
			rxNormMatched =
				rxNormEnrichment !== null &&
				(rxNormEnrichment.medicationForm !== null || rxNormEnrichment.strengthOptions.length > 0);
		} catch (error) {
			partial = true;
			note = "Returned EMA enrichment without RxNorm suggestions.";
			loggerToUse.warn(
				`[MedicationEnrichment] RxNorm enrichment failed: ${error instanceof Error ? error.message : "unknown"}`
			);
		}

		if (!rxNormMatched) {
			try {
				openFdaEnrichment = await fetchOpenFdaEnrichmentByQuery(
					selectedEntry.genericName ?? request.genericName ?? request.query
				);
				openFdaMatched =
					openFdaEnrichment !== null &&
					(openFdaEnrichment.medicationForm !== null ||
						openFdaEnrichment.strengthOptions.length > 0 ||
						openFdaEnrichment.packageOptions.length > 0);
			} catch (error) {
				partial = true;
				note = note ?? "Returned EMA enrichment without secondary-source suggestions.";
				loggerToUse.warn(
					`[MedicationEnrichment] openFDA enrichment failed: ${error instanceof Error ? error.message : "unknown"}`
				);
			}
		}

		return {
			selection: {
				name: selectedEntry.name,
				genericName: selectedEntry.genericName,
				therapeuticArea: selectedEntry.therapeuticArea,
				indication: selectedEntry.indication,
				atcCode: selectedEntry.atcCode,
				source: buildCombinedSource("ema", rxNormMatched, openFdaMatched),
			},
			suggestions: {
				name: selectedEntry.name,
				genericName: selectedEntry.genericName,
				medicationForm: rxNormEnrichment?.medicationForm ?? openFdaEnrichment?.medicationForm ?? null,
				strengthOptions: mergeStrengthOptions(
					rxNormEnrichment?.strengthOptions ?? [],
					openFdaEnrichment?.strengthOptions ?? []
				),
				packageOptions: openFdaEnrichment?.packageOptions ?? [],
			},
			meta: {
				rxNormMatched,
				openFdaMatched,
				partial,
				note,
			},
		};
	}

	if (requestedSource === "rxnorm") {
		if (!request.code) {
			throw new MedicationEnrichmentServiceError(
				"Selected medication could not be resolved.",
				404,
				"MEDICATION_ENRICHMENT_NOT_FOUND"
			);
		}

		const selection = buildSelectionNameAndGeneric(request);
		try {
			rxNormEnrichment = await fetchRxNormEnrichmentByRxcui(request.code);
			rxNormMatched =
				rxNormEnrichment !== null &&
				(rxNormEnrichment.medicationForm !== null || rxNormEnrichment.strengthOptions.length > 0);
		} catch (error) {
			partial = true;
			note = "Returned RxNorm enrichment without strength suggestions.";
			loggerToUse.warn(
				`[MedicationEnrichment] RxNorm enrich-by-code failed: ${error instanceof Error ? error.message : "unknown"}`
			);
		}

		if (!rxNormMatched) {
			try {
				openFdaEnrichment = await fetchOpenFdaEnrichmentByQuery(selection.genericName ?? selection.name);
				openFdaMatched =
					openFdaEnrichment !== null &&
					(openFdaEnrichment.medicationForm !== null ||
						openFdaEnrichment.strengthOptions.length > 0 ||
						openFdaEnrichment.packageOptions.length > 0);
			} catch (error) {
				partial = true;
				note = note ?? "Returned RxNorm enrichment without openFDA suggestions.";
				loggerToUse.warn(
					`[MedicationEnrichment] openFDA fallback failed after RxNorm match: ${error instanceof Error ? error.message : "unknown"}`
				);
			}
		}

		return {
			selection: {
				name: selection.name,
				genericName: selection.genericName,
				therapeuticArea: null,
				indication: null,
				atcCode: null,
				source: buildCombinedSource("rxnorm", rxNormMatched, openFdaMatched),
			},
			suggestions: {
				name: selection.name,
				genericName: selection.genericName,
				medicationForm: rxNormEnrichment?.medicationForm ?? openFdaEnrichment?.medicationForm ?? null,
				strengthOptions: mergeStrengthOptions(
					rxNormEnrichment?.strengthOptions ?? [],
					openFdaEnrichment?.strengthOptions ?? []
				),
				packageOptions: openFdaEnrichment?.packageOptions ?? [],
			},
			meta: {
				rxNormMatched,
				openFdaMatched,
				partial,
				note,
			},
		};
	}

	if (!request.code) {
		throw new MedicationEnrichmentServiceError(
			"Selected medication could not be resolved.",
			404,
			"MEDICATION_ENRICHMENT_NOT_FOUND"
		);
	}

	let product: OpenFdaProduct | null = null;
	try {
		product = await fetchOpenFdaProductByCode(request.code);
	} catch (error) {
		loggerToUse.warn(
			`[MedicationEnrichment] openFDA product lookup failed: ${error instanceof Error ? error.message : "unknown"}`
		);
	}

	if (!product) {
		throw new MedicationEnrichmentServiceError(
			"Selected medication could not be resolved.",
			404,
			"MEDICATION_ENRICHMENT_NOT_FOUND"
		);
	}

	openFdaEnrichment = buildOpenFdaEnrichment(product);
	openFdaMatched =
		openFdaEnrichment !== null &&
		(openFdaEnrichment.medicationForm !== null ||
			openFdaEnrichment.strengthOptions.length > 0 ||
			openFdaEnrichment.packageOptions.length > 0);

	const openFdaGeneric = openFdaEnrichment?.genericName ?? request.genericName ?? request.name;
	try {
		rxNormEnrichment = await fetchRxNormEnrichment(normalizeIngredientTerm(openFdaGeneric));
		rxNormMatched =
			rxNormEnrichment !== null &&
			(rxNormEnrichment.medicationForm !== null || rxNormEnrichment.strengthOptions.length > 0);
	} catch (error) {
		partial = true;
		note = "Returned openFDA enrichment without RxNorm suggestions.";
		loggerToUse.warn(
			`[MedicationEnrichment] RxNorm fallback failed after openFDA match: ${error instanceof Error ? error.message : "unknown"}`
		);
	}

	return {
		selection: {
			name: openFdaEnrichment?.name ?? request.name,
			genericName: openFdaEnrichment?.genericName ?? request.genericName ?? null,
			therapeuticArea: null,
			indication: null,
			atcCode: null,
			source: buildCombinedSource("openfda", rxNormMatched, openFdaMatched),
		},
		suggestions: {
			name: openFdaEnrichment?.name ?? request.name,
			genericName: openFdaEnrichment?.genericName ?? request.genericName ?? null,
			medicationForm: rxNormEnrichment?.medicationForm ?? openFdaEnrichment?.medicationForm ?? null,
			strengthOptions: mergeStrengthOptions(
				rxNormEnrichment?.strengthOptions ?? [],
				openFdaEnrichment?.strengthOptions ?? []
			),
			packageOptions: openFdaEnrichment?.packageOptions ?? [],
		},
		meta: {
			rxNormMatched,
			openFdaMatched,
			partial,
			note,
		},
	};
}
