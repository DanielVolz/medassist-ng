import { useTranslation } from "react-i18next";
import type { SharedMedicationOverviewItem } from "../types";
import { formatDate } from "../utils/formatters";
import { MedicationAvatar } from "./MedicationAvatar";

function formatPackageInfo(medication: SharedMedicationOverviewItem): string {
	if (medication.packageType === "blister") {
		return `${medication.packCount} x ${medication.blistersPerPack} x ${medication.pillsPerBlister}`;
	}

	if (medication.totalPills !== null) {
		return `${medication.packCount} x ${medication.totalPills}`;
	}

	return `${medication.packCount}`;
}

function getOverviewStatus(
	priority: SharedMedicationOverviewItem["priority"]
): { className: string; labelKey: string } | null {
	if (priority === null) return null;
	if (priority === "out-of-stock") {
		return { className: "danger", labelKey: "status.outOfStock" };
	}
	if (priority === "high") {
		return { className: "warning", labelKey: "status.lowStock" };
	}
	return { className: "normal", labelKey: "status.normal" };
}

export interface SharedMedicationOverviewSectionProps {
	takenBy: string;
	sharedBy: string | null;
	medications: SharedMedicationOverviewItem[];
	showTitle?: boolean;
	onMedicationImageClick?: (imageUrl: string, name: string) => void;
}

export function SharedMedicationOverviewSection({
	takenBy,
	medications,
	showTitle = true,
	onMedicationImageClick,
}: SharedMedicationOverviewSectionProps) {
	const { t } = useTranslation();
	const renderMedicationAvatar = (name: string, imageUrl: string | null) => {
		const isClickable = Boolean(imageUrl && onMedicationImageClick);

		return (
			<div
				className={isClickable ? "med-avatar clickable" : undefined}
				onClick={() => {
					if (imageUrl && onMedicationImageClick) onMedicationImageClick(imageUrl, name);
				}}
				onKeyDown={(e) => {
					if ((e.key === "Enter" || e.key === " ") && imageUrl && onMedicationImageClick) {
						onMedicationImageClick(imageUrl, name);
					}
				}}
			>
				<MedicationAvatar name={name} imageUrl={imageUrl} size="sm" />
			</div>
		);
	};

	return (
		<section className="shared-overview-inline-section" aria-label={t("sharedOverview.title", { person: takenBy })}>
			{showTitle ? (
				<div className="shared-overview-section-header">
					<h2>{t("sharedOverview.title", { person: takenBy })}</h2>
				</div>
			) : null}
			{medications.length === 0 ? (
				<p className="shared-schedule-empty">{t("sharedOverview.noMedications")}</p>
			) : (
				<>
					<div className="shared-overview-table-wrap">
						<table className="shared-overview-table">
							<thead>
								<tr>
									<th>{t("sharedOverview.columns.name")}</th>
									<th>{t("sharedOverview.columns.package")}</th>
									<th>{t("sharedOverview.columns.stock")}</th>
									<th>{t("sharedOverview.columns.daysLeft")}</th>
									<th>{t("sharedOverview.columns.depletion")}</th>
									<th>{t("sharedOverview.columns.priority")}</th>
								</tr>
							</thead>
							<tbody>
								{medications.map((medication) => {
									const overviewStatus = getOverviewStatus(medication.priority);

									return (
										<tr key={`${medication.name}-${medication.medicationStartDate ?? "no-start"}`}>
											<td>
												<div className="shared-overview-medication-cell">
													{renderMedicationAvatar(medication.name, medication.imageUrl)}
													<div className="shared-overview-medication-text">
														<div className="shared-overview-med-name">
															<strong>{medication.name}</strong>
															{medication.genericName ? (
																<span className="shared-overview-med-generic">{medication.genericName}</span>
															) : null}
														</div>
													</div>
												</div>
											</td>
											<td>{formatPackageInfo(medication)}</td>
											<td>
												<span className="shared-overview-stock-value">
													{medication.currentStock === null || medication.capacity === null
														? "-"
														: t("sharedOverview.stock.of", {
																current: medication.currentStock,
																capacity: medication.capacity,
															})}
												</span>
											</td>
											<td>{medication.daysLeft === null ? "-" : medication.daysLeft}</td>
											<td>
												<span className="shared-overview-date-value">{formatDate(medication.depletionDate)}</span>
											</td>
											<td>
												{overviewStatus === null ? (
													"-"
												) : (
													<span className={`shared-overview-priority ${overviewStatus.className}`}>
														{t(overviewStatus.labelKey)}
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					<div className="shared-overview-cards">
						{medications.map((medication) => {
							const overviewStatus = getOverviewStatus(medication.priority);

							return (
								<article
									className="shared-overview-card"
									key={`${medication.name}-${medication.medicationStartDate ?? "no-start"}`}
								>
									<div className="shared-overview-card-title">
										{renderMedicationAvatar(medication.name, medication.imageUrl)}
										<div className="shared-overview-medication-text">
											<div className="shared-overview-med-name">
												<strong>{medication.name}</strong>
												{medication.genericName ? (
													<span className="shared-overview-med-generic">{medication.genericName}</span>
												) : null}
											</div>
										</div>
									</div>
									<div className="shared-overview-card-grid">
										<span>{t("sharedOverview.columns.package")}</span>
										<strong>{formatPackageInfo(medication)}</strong>
										<span>{t("sharedOverview.columns.stock")}</span>
										<strong>
											<span className="shared-overview-stock-value">
												{medication.currentStock === null || medication.capacity === null
													? "-"
													: t("sharedOverview.stock.of", {
															current: medication.currentStock,
															capacity: medication.capacity,
														})}
											</span>
										</strong>
										<span>{t("sharedOverview.columns.daysLeft")}</span>
										<strong>{medication.daysLeft === null ? "-" : medication.daysLeft}</strong>

										<span>{t("sharedOverview.columns.depletion")}</span>
										<strong>
											<span className="shared-overview-date-value">{formatDate(medication.depletionDate)}</span>
										</strong>
									</div>
									{overviewStatus ? (
										<span className={`shared-overview-priority ${overviewStatus.className}`}>
											{t(overviewStatus.labelKey)}
										</span>
									) : null}
								</article>
							);
						})}
					</div>
				</>
			)}
		</section>
	);
}
