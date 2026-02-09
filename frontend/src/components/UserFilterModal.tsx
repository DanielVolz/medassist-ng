/**
 * UserFilterModal - Shows medications for a specific person (takenBy filter)
 * Allows clicking through to medication details
 */
import { useTranslation } from "react-i18next";
import { MedicationAvatar } from "../components";
import type { Coverage, Medication, StockThresholds } from "../types";
import { getMedTotal, getPackageSize } from "../types";
import { formatNumber } from "../utils";
import { getStockStatus } from "../utils/schedule";

export interface UserFilterModalProps {
	selectedUser: string | null;
	meds: Medication[];
	coverage: { all: Coverage[] };
	settings: StockThresholds;
	onClose: () => void;
	onOpenMedDetail: (med: Medication) => void;
}

export function UserFilterModal({
	selectedUser,
	meds,
	coverage,
	settings,
	onClose,
	onOpenMedDetail,
}: UserFilterModalProps) {
	const { t } = useTranslation();

	if (!selectedUser) return null;

	const userMeds = meds.filter((m) => (m.takenBy || []).includes(selectedUser));

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="modal-content user-meds-modal" onClick={(e) => e.stopPropagation()}>
				<button className="modal-close" onClick={onClose}>
					×
				</button>

				<div className="user-meds-header">
					<div className="user-avatar">{selectedUser.charAt(0).toUpperCase()}</div>
					<h2>{t("modal.userMedications", { name: selectedUser })}</h2>
				</div>

				<div className="user-meds-list">
					{userMeds.map((med) => {
						const medCoverage = coverage.all.find((c) => c.name === med.name);
						const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
						const packageSize = getPackageSize(med);
						const currentStock = medCoverage ? formatNumber(medCoverage.medsLeft) : formatNumber(getMedTotal(med));
						return (
							<div
								key={med.id}
								className="user-med-item clickable"
								onClick={() => {
									onClose();
									onOpenMedDetail(med);
								}}
							>
								<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="sm" />
								<div className="user-med-info">
									<span className="user-med-name">{med.name}</span>
									{med.genericName && <span className="user-med-generic">{med.genericName}</span>}
								</div>
								<div className="user-med-stats">
									<span className="user-med-pills">
										{currentStock}/{formatNumber(packageSize)}{" "}
										{packageSize === 1 ? t("common.pill") : t("common.pills")}
									</span>
									{status && <span className={`status-chip ${status.className}`}>{t(status.label)}</span>}
								</div>
							</div>
						);
					})}
					{userMeds.length === 0 && (
						<div className="user-meds-empty">{t("modal.noMedsForUser", { name: selectedUser })}</div>
					)}
				</div>

				<div className="user-meds-footer">
					<button onClick={onClose}>{t("common.close")}</button>
				</div>
			</div>
		</div>
	);
}
