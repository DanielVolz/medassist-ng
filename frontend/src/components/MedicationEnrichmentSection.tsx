import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MedicationEnrichmentEnrichResponse,
	MedicationEnrichmentPackageOption,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
} from "../types";
import { formatDate } from "../utils/formatters";
import { getMedicationEnrichmentDisplayResultKey } from "../utils/medication-enrichment";

const OPEN_FDA_PACKAGE_CODE_PATTERN = /\s*\(([0-9A-Z]{4,}(?:-[0-9A-Z]{1,})+)\)\s*/gi;
const PACKAGE_CONTENT_UNIT_PATTERNS = [
	{ pattern: /\bcapsules?\b/i, key: "capsule" },
	{ pattern: /\btablets?\b/i, key: "tablet" },
	{ pattern: /\bcaplets?\b/i, key: "caplet" },
	{ pattern: /\bpills?\b/i, key: "pill" },
] as const;
const INITIAL_VISIBLE_STRENGTH_OPTIONS = 12;

type TranslateFunction = (key: string, options?: Record<string, unknown>) => string;

export interface MedicationEnrichmentViewModel {
	query: string;
	results: MedicationEnrichmentSearchResult[];
	hasMoreResults?: boolean;
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
}

export interface MedicationEnrichmentSectionProps {
	state: MedicationEnrichmentViewModel;
	onQueryChange: (value: string) => void;
	onSearch: () => void;
	onLoadMoreResults?: () => void;
	onApplyResult: (
		result: MedicationEnrichmentSearchResult,
		preferredPackageOption?: MedicationEnrichmentPackageOption
	) => void;
	onApplyStrength: (option: MedicationEnrichmentStrengthOption) => void;
	onApplyPackage: (option: MedicationEnrichmentPackageOption) => void;
}

type MedicationEnrichmentPackageChoice = {
	option: MedicationEnrichmentPackageOption;
	sourceResult: MedicationEnrichmentSearchResult;
};

type MedicationEnrichmentDisplayResult = {
	displayKey: string;
	representative: MedicationEnrichmentSearchResult;
	sourceResults: MedicationEnrichmentSearchResult[];
	packageChoices: MedicationEnrichmentPackageChoice[];
	firstIndex: number;
};

function normalizePackageOptionDisplayText(value: string): string {
	return value
		.replace(OPEN_FDA_PACKAGE_CODE_PATTERN, " ")
		.replace(/\b([A-Z]{2,})\b/g, (match) => match.toLowerCase())
		.replace(/\s+/g, " ")
		.trim();
}

function getPackageContainerTranslationKey(packageType: MedicationEnrichmentPackageOption["packageType"]): string {
	switch (packageType) {
		case "blister":
			return "form.enrichment.packageContainers.blister";
		case "bottle":
			return "form.enrichment.packageContainers.bottle";
			case "inhaler":
				return "form.enrichment.packageContainers.inhaler";
			case "injection":
				return "form.enrichment.packageContainers.injection";
		case "liquid_container":
			return "form.enrichment.packageContainers.liquidContainer";
		case "tube":
			return "form.enrichment.packageContainers.tube";
		default:
			return "form.enrichment.packageContainers.bottle";
	}
}

function detectPackageContentUnitKey(value: string): string {
	for (const candidate of PACKAGE_CONTENT_UNIT_PATTERNS) {
		if (candidate.pattern.test(value)) {
			return candidate.key;
		}
	}

	return "tablet";
}

function formatSolidPackageCount(count: number, sourceText: string, t: TranslateFunction): string {
	const unitKey = detectPackageContentUnitKey(sourceText);
	return `${count} ${t(`form.enrichment.packageUnits.${unitKey}`, { count })}`;
}

function formatPackageContainerCount(option: MedicationEnrichmentPackageOption, t: TranslateFunction): string {
	return t(getPackageContainerTranslationKey(option.packageType), { count: Math.max(option.packCount, 1) });
}

function buildPackageOptionKey(option: MedicationEnrichmentPackageOption): string {
	const sourceText = normalizePackageOptionDisplayText(option.description || option.label);
	const detectedUnit =
		option.packageType === "bottle" || option.packageType === "blister"
			? detectPackageContentUnitKey(sourceText)
			: null;

	return JSON.stringify([
		option.packageType,
		option.packCount,
		option.blistersPerPack,
		option.pillsPerBlister,
		option.totalPills,
		option.looseTablets,
		option.packageAmountValue,
		option.packageAmountUnit,
		detectedUnit,
	]);
}

function dedupePackageOptions(options: MedicationEnrichmentPackageOption[]): MedicationEnrichmentPackageOption[] {
	const uniqueOptions = new Map<string, MedicationEnrichmentPackageOption>();

	for (const option of options) {
		const key = buildPackageOptionKey(option);
		if (!uniqueOptions.has(key)) {
			uniqueOptions.set(key, option);
		}
	}

	return [...uniqueOptions.values()];
}

function formatPackageOptionDisplayText(
	value: MedicationEnrichmentPackageOption | string,
	t: TranslateFunction
): string {
	const rawText = typeof value === "string" ? value : value.description || value.label;
	const cleanedText = normalizePackageOptionDisplayText(rawText);

	if (typeof value === "string") {
		return cleanedText || rawText;
	}

	const packageContainerLabel = formatPackageContainerCount(value, t);

	if (value.packageType === "blister") {
		if (value.blistersPerPack !== null && value.blistersPerPack > 1 && value.pillsPerBlister !== null) {
			return `${packageContainerLabel} · ${value.blistersPerPack} × ${formatSolidPackageCount(
				value.pillsPerBlister,
				cleanedText,
				t
			)}`;
		}

		const blisterCount = value.pillsPerBlister ?? value.totalPills;
		if (blisterCount !== null && blisterCount > 0) {
			return `${packageContainerLabel} · ${formatSolidPackageCount(blisterCount, cleanedText, t)}`;
		}
	}

	if (value.packageType === "bottle") {
		const totalCount = value.totalPills ?? value.looseTablets;
		if (totalCount !== null && totalCount > 0) {
			const countPerContainer =
				value.packCount > 1 && totalCount % value.packCount === 0 ? totalCount / value.packCount : totalCount;
			return `${packageContainerLabel} · ${formatSolidPackageCount(countPerContainer, cleanedText, t)}`;
		}
	}

	if (
		(value.packageType === "liquid_container" || value.packageType === "tube") &&
		value.packageAmountValue !== null &&
		value.packageAmountUnit
	) {
		return `${packageContainerLabel} · ${value.packageAmountValue} ${value.packageAmountUnit}`;
	}

	return cleanedText || rawText;
}

function buildMedicationDisplayResults(
	results: MedicationEnrichmentSearchResult[]
): MedicationEnrichmentDisplayResult[] {
	const grouped = new Map<
		string,
		MedicationEnrichmentDisplayResult & { packageChoicesByKey: Map<string, MedicationEnrichmentPackageChoice> }
	>();

	results.forEach((result, index) => {
		const displayKey = getMedicationEnrichmentDisplayResultKey(result);
		const existing = grouped.get(displayKey);

		if (!existing) {
			const packageChoicesByKey = new Map<string, MedicationEnrichmentPackageChoice>();
			for (const option of result.packageOptions) {
				packageChoicesByKey.set(buildPackageOptionKey(option), { option, sourceResult: result });
			}

			grouped.set(displayKey, {
				displayKey,
				representative: result,
				sourceResults: [result],
				packageChoices: [...packageChoicesByKey.values()],
				packageChoicesByKey,
				firstIndex: index,
			});
			return;
		}

		existing.sourceResults.push(result);
		for (const option of result.packageOptions) {
			const key = buildPackageOptionKey(option);
			if (!existing.packageChoicesByKey.has(key)) {
				existing.packageChoicesByKey.set(key, { option, sourceResult: result });
			}
		}
		existing.packageChoices = [...existing.packageChoicesByKey.values()];
	});

	return [...grouped.values()]
		.sort(
			(left, right) => right.packageChoices.length - left.packageChoices.length || left.firstIndex - right.firstIndex
		)
		.map(({ packageChoicesByKey: _packageChoicesByKey, ...result }) => result);
}

export function MedicationEnrichmentSection({
	state,
	onQueryChange,
	onSearch,
	onLoadMoreResults,
	onApplyResult,
	onApplyStrength,
	onApplyPackage,
}: MedicationEnrichmentSectionProps) {
	const { t } = useTranslation();
	const canSearch = state.query.trim().length > 0 && !state.isSearching && !state.applyingCode;
	const shouldAutoExpand =
		state.isSearching ||
		state.hasSearched ||
		state.searchError !== null ||
		state.enrichError !== null ||
		state.results.length > 0 ||
		state.appliedSelection !== null ||
		state.packageOptions.length > 0 ||
		state.strengthOptions.length > 0 ||
		state.appliedPackageLabel !== null ||
		state.appliedStrengthLabel !== null ||
		Boolean(state.meta?.partial);
	const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
	const [showInfo, setShowInfo] = useState(false);
	const [expandedResultCode, setExpandedResultCode] = useState<string | null>(null);
	const [visibleStrengthOptionCount, setVisibleStrengthOptionCount] = useState(INITIAL_VISIBLE_STRENGTH_OPTIONS);
	const autoExpandStateRef = useRef(shouldAutoExpand);
	const resultRefs = useRef(new Map<string, HTMLElement>());
	const displayResults = useMemo(() => buildMedicationDisplayResults(state.results), [state.results]);
	const uniqueStatePackageOptions = useMemo(() => dedupePackageOptions(state.packageOptions), [state.packageOptions]);
	const visibleStrengthOptions = state.strengthOptions.slice(0, visibleStrengthOptionCount);
	const hasMoreStrengthOptions = state.strengthOptions.length > visibleStrengthOptions.length;
	const appliedPackageOption = useMemo(
		() => state.packageOptions.find((option) => option.label === state.appliedPackageLabel) ?? null,
		[state.appliedPackageLabel, state.packageOptions]
	);
	const isLoadingInitialSearch = state.isSearching && displayResults.length === 0;
	const isLoadingMoreResults = state.isSearching && displayResults.length > 0;
	const showLoadMoreAction =
		displayResults.length > 0 && (state.hasMoreResults || isLoadingMoreResults) && onLoadMoreResults;

	useEffect(() => {
		if (shouldAutoExpand && !autoExpandStateRef.current) {
			setIsExpanded(true);
		}

		autoExpandStateRef.current = shouldAutoExpand;
	}, [shouldAutoExpand]);

	useEffect(() => {
		setVisibleStrengthOptionCount(INITIAL_VISIBLE_STRENGTH_OPTIONS);
	}, []);

	useEffect(() => {
		if (!expandedResultCode) {
			return;
		}

		const animationFrameId = window.requestAnimationFrame(() => {
			resultRefs.current.get(expandedResultCode)?.scrollIntoView({
				block: "nearest",
				inline: "nearest",
				behavior: "smooth",
			});
		});

		return () => window.cancelAnimationFrame(animationFrameId);
	}, [expandedResultCode]);

	return (
		<div className="full medication-enrichment-section">
			<div className="medication-enrichment-header">
				<div>
					<h5 className="form-category-title medication-enrichment-title">{t("form.enrichment.title")}</h5>
					<p className="sub medication-enrichment-collapsed-hint">{t("form.enrichment.collapsedHint")}</p>
				</div>
				<button
					type="button"
					className={`medication-enrichment-toggle-button ${isExpanded ? "secondary small" : "primary small"}`}
					aria-expanded={isExpanded}
					onClick={() => setIsExpanded((current) => !current)}
				>
					{isExpanded ? t("form.enrichment.toggleHide") : t("form.enrichment.toggleShow")}
				</button>
			</div>

			{isExpanded ? (
				<div className="medication-enrichment-body">
					<div className="medication-enrichment-helper-row">
						<span className="status-chip small warning">{t("form.enrichment.coverageLabel")}</span>
						<button
							type="button"
							className="ghost small"
							aria-expanded={showInfo}
							onClick={() => setShowInfo((current) => !current)}
						>
							{showInfo ? t("form.enrichment.infoHide") : t("form.enrichment.infoShow")}
						</button>
					</div>

					{showInfo ? (
						<div className="medication-enrichment-info">
							<p className="medication-enrichment-info-title">{t("form.enrichment.infoTitle")}</p>
							<p className="sub medication-enrichment-description">{t("form.enrichment.description")}</p>
							<p className="sub medication-enrichment-manual-hint">{t("form.enrichment.manualEntryHint")}</p>
						</div>
					) : null}

					<label className="full">
						{t("form.enrichment.searchLabel")}
						<div className="medication-enrichment-search-row">
							<input
								type="search"
								value={state.query}
								onChange={(event) => onQueryChange(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									if (!canSearch) return;
									onSearch();
								}}
								placeholder={t("form.enrichment.searchPlaceholder")}
							/>
							<button
								type="button"
								className={`secondary small medication-enrichment-action-button${isLoadingInitialSearch ? " is-loading" : ""}`}
								onClick={onSearch}
								disabled={!canSearch}
							>
								{isLoadingInitialSearch ? <span className="medication-enrichment-spinner" aria-hidden="true" /> : null}
								<span>
									{isLoadingInitialSearch ? t("form.enrichment.loadingSearch") : t("form.enrichment.searchAction")}
								</span>
							</button>
						</div>
					</label>

					{state.searchError ? <p className="danger-text">{state.searchError}</p> : null}
					{state.enrichError ? <p className="danger-text">{state.enrichError}</p> : null}
					{state.meta?.partial ? <p className="info-text">{t("form.enrichment.partialNote")}</p> : null}
					{state.hasSearched && !state.isSearching && state.results.length === 0 && !state.searchError ? (
						<p className="info-text">{t("form.enrichment.noResults")}</p>
					) : null}

					{displayResults.length > 0 ? (
						<div className="medication-enrichment-results">
							{displayResults.map((displayResult) => {
								const { representative, sourceResults, packageChoices, displayKey } = displayResult;
								const isActive = sourceResults.some((result) => result.code === state.activeResultCode);
								const authorisationHolder =
									sourceResults.find((result) => result.authorisationHolder)?.authorisationHolder ?? null;
								const therapeuticArea = sourceResults.find((result) => result.therapeuticArea)?.therapeuticArea ?? null;
								const authorisationDate =
									sourceResults.find((result) => result.authorisationDate)?.authorisationDate ?? null;
								const hasPackageOptions = packageChoices.length > 0;
								const hasActiveStrengthOptions = isActive && state.strengthOptions.length > 0;
								const isApplyingPackageSelection =
									isActive && state.applyingCode !== null && state.applyingPackageLabel !== null;
								const hasDetails = Boolean(
									authorisationHolder ||
										therapeuticArea ||
										authorisationDate ||
										hasPackageOptions ||
										hasActiveStrengthOptions ||
										isApplyingPackageSelection
								);
								const isDetailsExpanded = expandedResultCode === displayKey;
								const activePackageOptions =
									isActive && uniqueStatePackageOptions.length > 0
										? uniqueStatePackageOptions
										: packageChoices.map((choice) => choice.option);
								const showInlinePackageChoices = activePackageOptions.length > 1;
								const genericStatusClass = representative.genericStatus === "generic" ? "success" : "neutral";
								const sourceClass = representative.source === "openfda" ? "warning" : "neutral";
								let applyLabel = t("form.enrichment.applyAction");
								if (isActive && state.applyingCode !== null) {
									applyLabel = t("form.enrichment.applying");
								} else if (isActive && state.appliedSelection) {
									applyLabel = t("form.enrichment.applied");
								}

								return (
									<article
										key={displayKey}
										className={`medication-enrichment-result${isActive ? " active" : ""}`}
										ref={(element) => {
											if (element) {
												resultRefs.current.set(displayKey, element);
												return;
											}

											resultRefs.current.delete(displayKey);
										}}
									>
										<div className="medication-enrichment-result-header">
											<div className="medication-enrichment-result-names">
												<strong>{representative.name}</strong>
												{representative.genericName ? (
													<span className="medication-enrichment-result-generic">{representative.genericName}</span>
												) : null}
											</div>
											<div className="medication-enrichment-result-actions">
												<span className={`pill ${hasPackageOptions ? "success" : "neutral"}`}>
													{hasPackageOptions
														? t("form.enrichment.packageAvailable")
														: t("form.enrichment.packageUnavailable")}
												</span>
												<span className={`pill ${sourceClass}`}>
													{t(`form.enrichment.sources.${representative.source}`)}
												</span>
												{representative.source === "ema" ? (
													<span className={`pill ${genericStatusClass}`}>
														{t(`form.enrichment.genericStatus.${representative.genericStatus}`)}
													</span>
												) : null}
												{hasDetails ? (
													<button
														type="button"
														className="ghost small"
														aria-expanded={isDetailsExpanded}
														onClick={() =>
															setExpandedResultCode((current) => (current === displayKey ? null : displayKey))
														}
													>
														{isDetailsExpanded
															? t("form.enrichment.details.hideAction")
															: t("form.enrichment.details.showAction")}
													</button>
												) : null}
												{showInlinePackageChoices ? null : (
													<button
														type="button"
														className={isActive ? "secondary small" : "primary small"}
														onClick={() => {
															setExpandedResultCode(displayKey);
															onApplyResult(representative);
														}}
														disabled={isActive && state.applyingCode !== null}
													>
														{applyLabel}
													</button>
												)}
											</div>
										</div>

										{hasDetails && isDetailsExpanded ? (
											<dl className="medication-enrichment-result-meta">
												{authorisationHolder ? (
													<div>
														<dt>{t("form.enrichment.details.authorisationHolder")}</dt>
														<dd>{authorisationHolder}</dd>
													</div>
												) : null}
												{therapeuticArea ? (
													<div>
														<dt>{t("form.enrichment.details.therapeuticArea")}</dt>
														<dd>{therapeuticArea}</dd>
													</div>
												) : null}
												{authorisationDate ? (
													<div>
														<dt>{t("form.enrichment.details.authorisationDate")}</dt>
														<dd>{formatDate(authorisationDate)}</dd>
													</div>
												) : null}
												{activePackageOptions.length > 0 ? (
													<div className="medication-enrichment-result-meta-full">
														<dt>{t("form.enrichment.details.packageSizes")}</dt>
														<dd>
															<div className="medication-enrichment-detail-stack">
																{showInlinePackageChoices ? (
																	<div className="medication-enrichment-strength-list medication-enrichment-package-choice-list">
																		{activePackageOptions.map((option) => {
																			const isApplyingPending =
																				isApplyingPackageSelection && state.applyingPackageLabel === option.label;
																			const isSelected =
																				isActive &&
																				(state.appliedPackageLabel === option.label ||
																					(appliedPackageOption !== null &&
																						buildPackageOptionKey(appliedPackageOption) ===
																							buildPackageOptionKey(option)));
																			const packageLabel = formatPackageOptionDisplayText(option, t);

																			return (
																				<button
																					key={option.label}
																					type="button"
																					className={`medication-enrichment-package-choice-button ${isSelected || isApplyingPending ? "primary small" : "secondary small"}${isApplyingPending ? " is-loading" : ""}`}
																					aria-pressed={isSelected}
																					title={packageLabel}
																					onClick={() =>
																						isActive && uniqueStatePackageOptions.length > 0
																							? onApplyPackage(option)
																							: onApplyResult(
																									packageChoices.find((choice) => choice.option.label === option.label)
																										?.sourceResult ?? representative,
																									option
																								)
																					}
																					disabled={isActive && state.applyingCode !== null}
																				>
																					{isApplyingPending ? (
																						<span className="medication-enrichment-spinner" aria-hidden="true" />
																					) : null}
																					<span>{packageLabel}</span>
																				</button>
																			);
																		})}
																	</div>
																) : (
																	<ul className="medication-enrichment-package-details">
																		{activePackageOptions.map((option) => (
																			<li key={option.label}>{formatPackageOptionDisplayText(option, t)}</li>
																		))}
																	</ul>
																)}
																{isActive && state.appliedPackageLabel ? (
																	<p className="success-text medication-enrichment-applied-note">
																		{t("form.enrichment.appliedPackage", {
																			label: formatPackageOptionDisplayText(
																				appliedPackageOption ?? state.appliedPackageLabel,
																				t
																			),
																		})}
																	</p>
																) : null}
															</div>
														</dd>
													</div>
												) : null}
												{isApplyingPackageSelection ? (
													<div className="medication-enrichment-result-meta-full">
														<dt>{t("form.enrichment.strengthTitle")}</dt>
														<dd>
															<div className="medication-enrichment-pending-panel" aria-live="polite">
																<span className="medication-enrichment-spinner" aria-hidden="true" />
																<span>{t("form.enrichment.applying")}</span>
															</div>
														</dd>
													</div>
												) : null}
												{hasActiveStrengthOptions ? (
													<div className="medication-enrichment-result-meta-full">
														<dt>{t("form.enrichment.strengthTitle")}</dt>
														<dd>
															<div className="medication-enrichment-detail-stack">
																<p className="sub medication-enrichment-detail-hint">
																	{t("form.enrichment.strengthHint")}
																</p>
																<div className="medication-enrichment-strength-list">
																	{visibleStrengthOptions.map((option) => {
																		const isSelected = state.appliedStrengthLabel === option.label;

																		return (
																			<button
																				key={option.label}
																				type="button"
																				className={isSelected ? "primary small" : "secondary small"}
																				onClick={() => onApplyStrength(option)}
																			>
																				{option.label}
																			</button>
																		);
																	})}
																</div>
																{hasMoreStrengthOptions ? (
																	<button
																		type="button"
																		className="secondary small medication-enrichment-inline-action"
																		onClick={() =>
																			setVisibleStrengthOptionCount(
																				(current) => current + INITIAL_VISIBLE_STRENGTH_OPTIONS
																			)
																		}
																	>
																		{t("form.enrichment.showMoreStrengthsAction")}
																	</button>
																) : null}
																{state.appliedStrengthLabel ? (
																	<p className="success-text medication-enrichment-applied-note">
																		{t("form.enrichment.appliedStrength", { label: state.appliedStrengthLabel })}
																	</p>
																) : null}
															</div>
														</dd>
													</div>
												) : null}
											</dl>
										) : null}
									</article>
								);
							})}
						</div>
					) : null}

					{showLoadMoreAction ? (
						<div className="medication-enrichment-results-footer">
							<button
								type="button"
								className={`secondary small medication-enrichment-action-button medication-enrichment-load-more-button${isLoadingMoreResults ? " is-loading" : ""}`}
								onClick={onLoadMoreResults}
								disabled={state.isSearching || Boolean(state.applyingCode)}
							>
								{isLoadingMoreResults ? <span className="medication-enrichment-spinner" aria-hidden="true" /> : null}
								<span>
									{isLoadingMoreResults ? t("form.enrichment.loadingMoreResults") : t("form.enrichment.showMoreAction")}
								</span>
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
