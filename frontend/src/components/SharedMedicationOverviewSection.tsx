import { useTranslation } from "react-i18next";
import {
	getPackageSize,
	isLiquidContainerPackageType,
	isTubePackageType,
	type SharedMedicationOverviewItem,
} from "../types";
import { formatDisplayDate, getSystemLocale } from "../utils/formatters";
import { MedicationAvatar } from "./MedicationAvatar";
import sharedClasses from "./SharedSchedule.module.css";

function formatPackageAmountUnit(medication: SharedMedicationOverviewItem, t: (key: string) => string): string | null {
	if (isTubePackageType(medication.packageType)) {
		return t("form.packageAmountUnitG");
	}

	if (isLiquidContainerPackageType(medication.packageType)) {
		return t("form.packageAmountUnitMl");
	}

	if (medication.packageAmountUnit === "g") {
		return t("form.packageAmountUnitG");
	}

	if (medication.packageAmountUnit === "ml") {
		return t("form.packageAmountUnitMl");
	}

	return null;
}

function formatPackageInfo(medication: SharedMedicationOverviewItem, t: (key: string) => string): string {
	if (medication.packageType === "blister") {
		return `${medication.packCount} x ${medication.blistersPerPack} x ${medication.pillsPerBlister}`;
	}

	const unitLabel = formatPackageAmountUnit(medication, t);
	if (unitLabel && medication.packageAmountValue && medication.packageAmountValue > 0) {
		const sizeLabel = `${medication.packageAmountValue} ${unitLabel}`;
		return medication.packCount > 1 ? `${medication.packCount} x ${sizeLabel}` : sizeLabel;
	}

	const packageSize = getPackageSize(medication);
	if (packageSize > 0) {
		return medication.packCount > 1 ? `${medication.packCount} x ${packageSize}` : `${packageSize}`;
	}

	return `${Math.max(medication.packCount, 1)}`;
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
	imageSrcResolver?: (filename: string) => string;
}

export function SharedMedicationOverviewSection({
	takenBy,
	medications,
	showTitle = true,
	onMedicationImageClick,
	imageSrcResolver,
}: SharedMedicationOverviewSectionProps) {
	const { t, i18n } = useTranslation();
	const displayLocale = getSystemLocale(i18n.language);
	const cx = (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(" ");
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
				<MedicationAvatar name={name} imageUrl={imageUrl} size="sm" imageSrcResolver={imageSrcResolver} />
			</div>
		);
	};

	return (
		<section
			className={sharedClasses["shared-overview-inline-section"]}
			aria-label={t("sharedOverview.title", { person: takenBy })}
		>
			{showTitle ? (
				<div className={sharedClasses["shared-overview-section-header"]}>
					<h2>{t("sharedOverview.title", { person: takenBy })}</h2>
				</div>
			) : null}
			{medications.length === 0 ? (
				<p className={sharedClasses["shared-schedule-empty"]}>{t("sharedOverview.noMedications")}</p>
			) : (
				<>
					<div className={sharedClasses["shared-overview-table-wrap"]}>
						<table className={sharedClasses["shared-overview-table"]}>
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
												<div className={sharedClasses["shared-overview-medication-cell"]}>
													{renderMedicationAvatar(medication.name, medication.imageUrl)}
													<div className={sharedClasses["shared-overview-medication-text"]}>
														<div className={sharedClasses["shared-overview-med-name"]}>
															<strong>{medication.name}</strong>
															{medication.genericName ? (
																<span className={sharedClasses["shared-overview-med-generic"]}>
																	{medication.genericName}
																</span>
															) : null}
														</div>
													</div>
												</div>
											</td>
											<td>{formatPackageInfo(medication, t)}</td>
											<td>
												<span className={sharedClasses["shared-overview-stock-value"]}>
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
												<span className={sharedClasses["shared-overview-date-value"]}>
													{formatDisplayDate(medication.depletionDate, displayLocale, { weekday: true })}
												</span>
											</td>
											<td>
												{overviewStatus === null ? (
													"-"
												) : (
													<span
														className={cx(
															sharedClasses["shared-overview-priority"],
															sharedClasses[overviewStatus.className]
														)}
													>
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

					<div className={sharedClasses["shared-overview-cards"]}>
						{medications.map((medication) => {
							const overviewStatus = getOverviewStatus(medication.priority);

							return (
								<article
									className={sharedClasses["shared-overview-card"]}
									key={`${medication.name}-${medication.medicationStartDate ?? "no-start"}`}
								>
									<div className={sharedClasses["shared-overview-card-title"]}>
										{renderMedicationAvatar(medication.name, medication.imageUrl)}
										<div className={sharedClasses["shared-overview-medication-text"]}>
											<div className={sharedClasses["shared-overview-med-name"]}>
												<strong>{medication.name}</strong>
												{medication.genericName ? (
													<span className={sharedClasses["shared-overview-med-generic"]}>{medication.genericName}</span>
												) : null}
											</div>
										</div>
									</div>
									<div className={sharedClasses["shared-overview-card-grid"]}>
										<span>{t("sharedOverview.columns.package")}</span>
										<strong>{formatPackageInfo(medication, t)}</strong>
										<span>{t("sharedOverview.columns.stock")}</span>
										<strong>
											<span className={sharedClasses["shared-overview-stock-value"]}>
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
											<span className={sharedClasses["shared-overview-date-value"]}>
												{formatDisplayDate(medication.depletionDate, displayLocale, { weekday: true })}
											</span>
										</strong>
									</div>
									{overviewStatus ? (
										<span
											className={cx(sharedClasses["shared-overview-priority"], sharedClasses[overviewStatus.className])}
										>
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
