import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MedicationEnrichmentEnrichResponse,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
} from "../types";
import { formatDate } from "../utils/formatters";

export interface MedicationEnrichmentViewModel {
	query: string;
	results: MedicationEnrichmentSearchResult[];
	hasMoreResults?: boolean;
	isSearching: boolean;
	hasSearched: boolean;
	searchError: string | null;
	applyingCode: string | null;
	activeResultCode: string | null;
	appliedSelection: MedicationEnrichmentEnrichResponse["selection"] | null;
	enrichError: string | null;
	meta: MedicationEnrichmentEnrichResponse["meta"] | null;
	strengthOptions: MedicationEnrichmentStrengthOption[];
	appliedStrengthLabel: string | null;
}

export interface MedicationEnrichmentSectionProps {
	state: MedicationEnrichmentViewModel;
	onQueryChange: (value: string) => void;
	onSearch: () => void;
	onLoadMoreResults?: () => void;
	onApplyResult: (result: MedicationEnrichmentSearchResult) => void;
	onApplyStrength: (option: MedicationEnrichmentStrengthOption) => void;
}

export function MedicationEnrichmentSection({
	state,
	onQueryChange,
	onSearch,
	onLoadMoreResults,
	onApplyResult,
	onApplyStrength,
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
		state.strengthOptions.length > 0 ||
		state.appliedStrengthLabel !== null ||
		Boolean(state.meta?.partial);
	const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
	const [showInfo, setShowInfo] = useState(false);
	const [expandedResultCode, setExpandedResultCode] = useState<string | null>(null);
	const autoExpandStateRef = useRef(shouldAutoExpand);

	useEffect(() => {
		if (shouldAutoExpand && !autoExpandStateRef.current) {
			setIsExpanded(true);
		}

		autoExpandStateRef.current = shouldAutoExpand;
	}, [shouldAutoExpand]);

	return (
		<div className="full medication-enrichment-section">
			<div className="medication-enrichment-header">
				<div>
					<h5 className="form-category-title medication-enrichment-title">{t("form.enrichment.title")}</h5>
					<p className="sub medication-enrichment-collapsed-hint">{t("form.enrichment.collapsedHint")}</p>
				</div>
				<button
					type="button"
					className="secondary small"
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
							<button type="button" className="secondary small" onClick={onSearch} disabled={!canSearch}>
								{state.isSearching ? t("form.enrichment.searching") : t("form.enrichment.searchAction")}
							</button>
						</div>
					</label>

					{state.searchError ? <p className="danger-text">{state.searchError}</p> : null}
					{state.enrichError ? <p className="danger-text">{state.enrichError}</p> : null}
					{state.meta?.partial ? <p className="info-text">{t("form.enrichment.partialNote")}</p> : null}
					{state.hasSearched && !state.isSearching && state.results.length === 0 ? (
						<p className="info-text">{t("form.enrichment.noResults")}</p>
					) : null}

					{state.results.length > 0 ? (
						<div className="medication-enrichment-results">
							{state.results.map((result) => {
								const isActive = state.activeResultCode === result.code;
								const hasDetails = Boolean(
									result.authorisationHolder || result.therapeuticArea || result.authorisationDate
								);
								const isDetailsExpanded = expandedResultCode === result.code;
								const genericStatusClass = result.genericStatus === "generic" ? "success" : "neutral";
								const sourceClass = result.source === "openfda" ? "warning" : "neutral";
								let applyLabel = t("form.enrichment.applyAction");
								if (state.applyingCode === result.code) {
									applyLabel = t("form.enrichment.applying");
								} else if (isActive && state.appliedSelection) {
									applyLabel = t("form.enrichment.applied");
								}

								return (
									<article key={result.code} className={`medication-enrichment-result${isActive ? " active" : ""}`}>
										<div className="medication-enrichment-result-header">
											<div className="medication-enrichment-result-names">
												<strong>{result.name}</strong>
												{result.genericName ? (
													<span className="medication-enrichment-result-generic">{result.genericName}</span>
												) : null}
											</div>
											<div className="medication-enrichment-result-actions">
												<span className={`pill ${sourceClass}`}>{t(`form.enrichment.sources.${result.source}`)}</span>
												{result.source === "ema" ? (
													<span className={`pill ${genericStatusClass}`}>
														{t(`form.enrichment.genericStatus.${result.genericStatus}`)}
													</span>
												) : null}
												{hasDetails ? (
													<button
														type="button"
														className="ghost small"
														aria-expanded={isDetailsExpanded}
														onClick={() =>
															setExpandedResultCode((current) => (current === result.code ? null : result.code))
														}
													>
														{isDetailsExpanded
															? t("form.enrichment.details.hideAction")
															: t("form.enrichment.details.showAction")}
													</button>
												) : null}
												<button
													type="button"
													className={isActive ? "secondary small" : "primary small"}
													onClick={() => {
														setExpandedResultCode(result.code);
														onApplyResult(result);
													}}
													disabled={state.applyingCode === result.code}
												>
													{applyLabel}
												</button>
											</div>
										</div>

										{hasDetails && isDetailsExpanded ? (
											<dl className="medication-enrichment-result-meta">
												{result.authorisationHolder ? (
													<div>
														<dt>{t("form.enrichment.details.authorisationHolder")}</dt>
														<dd>{result.authorisationHolder}</dd>
													</div>
												) : null}
												{result.therapeuticArea ? (
													<div>
														<dt>{t("form.enrichment.details.therapeuticArea")}</dt>
														<dd>{result.therapeuticArea}</dd>
													</div>
												) : null}
												{result.authorisationDate ? (
													<div>
														<dt>{t("form.enrichment.details.authorisationDate")}</dt>
														<dd>{formatDate(result.authorisationDate)}</dd>
													</div>
												) : null}
											</dl>
										) : null}
									</article>
								);
							})}
						</div>
					) : null}

					{state.results.length > 0 && state.hasMoreResults && onLoadMoreResults ? (
						<div className="medication-enrichment-results-footer">
							<button
								type="button"
								className="secondary small"
								onClick={onLoadMoreResults}
								disabled={state.isSearching || Boolean(state.applyingCode)}
							>
								{t("form.enrichment.showMoreAction")}
							</button>
						</div>
					) : null}

					{state.appliedSelection || state.strengthOptions.length > 0 || state.appliedStrengthLabel ? (
						<div className="medication-enrichment-followup">
							{state.appliedSelection ? (
								<div>
									<p className="success-text">{t("form.enrichment.applied")}</p>
									<p className="sub medication-enrichment-selection-summary">
										<strong>{state.appliedSelection.name}</strong>
										{state.appliedSelection.genericName ? ` • ${state.appliedSelection.genericName}` : ""}
									</p>
								</div>
							) : null}

							{state.strengthOptions.length > 0 ? (
								<div className="medication-enrichment-strengths">
									<p className="medication-enrichment-strength-title">{t("form.enrichment.strengthTitle")}</p>
									<p className="sub">{t("form.enrichment.strengthHint")}</p>
									<div className="medication-enrichment-strength-list">
										{state.strengthOptions.map((option) => {
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
								</div>
							) : null}

							{state.appliedStrengthLabel ? (
								<p className="success-text">
									{t("form.enrichment.appliedStrength", { label: state.appliedStrengthLabel })}
								</p>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
