import type { Coverage, Medication, StockThresholds } from "../../types";
import { getMedDisplayName } from "../../types";
import { getStockStatus } from "../../utils/schedule";

type DashboardStatusSectionProps = {
	t: (key: string, options?: Record<string, unknown>) => string;
	show: boolean;
	meds: Medication[];
	coverage: { all: Coverage[] };
	stockThresholds: StockThresholds;
	onOpenMedicationDetail: (med: Medication) => void;
};

export function DashboardStatusSection({
	t,
	show,
	meds,
	coverage,
	stockThresholds,
	onOpenMedicationDetail,
}: DashboardStatusSectionProps) {
	const getStatusTextClass = (statusClassName: string): string => {
		if (statusClassName === "danger") return "danger-text";
		if (statusClassName === "warning") return "warning-text";
		return "";
	};

	if (!show) {
		return null;
	}

	return (
		<section className="grid">
			<article className="card">
				<div className="card-head">
					<h2>{t("dashboard.reorder.title")}</h2>
				</div>
				{(() => {
					if (meds.length === 0) {
						return <p className="muted">{t("dashboard.reorder.noMeds")}</p>;
					}

					const lowStockMap = new Map<string, Coverage>();
					for (const c of coverage.all) {
						if (c.daysLeft === null && c.medsLeft > 0) continue;
						const med = meds.find((m) => getMedDisplayName(m) === c.name);
						const status = getStockStatus(c.daysLeft, c.medsLeft, stockThresholds, med?.packageType);
						if (status.className === "danger" || status.className === "warning") {
							const existing = lowStockMap.get(c.name);
							if (!existing || (c.daysLeft ?? 0) < (existing.daysLeft ?? 0)) {
								lowStockMap.set(c.name, c);
							}
						}
					}
					const lowStockMeds = Array.from(lowStockMap.values());
					const lowStockCount = lowStockMeds.length;
					if (lowStockCount === 0) {
						return <p className="success-text">{t("dashboard.reorder.allGood")}</p>;
					}

					return (
						<p>
							{t("dashboard.reorder.lowWarningPrefix")}{" "}
							{lowStockMeds.map((c, idx) => {
								const med = meds.find((m) => getMedDisplayName(m) === c.name);
								const status = getStockStatus(c.daysLeft, c.medsLeft, stockThresholds, med?.packageType);
								const textClass = getStatusTextClass(status.className);
								return (
									<span key={c.name}>
										{idx > 0 && ", "}
										<span
											className={`med-link clickable ${textClass}`}
											onClick={() => med && onOpenMedicationDetail(med)}
											onKeyDown={(e) => {
												if ((e.key === "Enter" || e.key === " ") && med) {
													onOpenMedicationDetail(med);
												}
											}}
										>
											{c.name}
										</span>
										<span className={`reminder-days-left ${textClass}`}>
											{" "}
											({t("dashboard.reminders.daysLeft", { count: c.daysLeft ?? 0, days: c.daysLeft ?? 0 })})
										</span>
									</span>
								);
							})}{" "}
							{t("dashboard.reorder.lowWarningSuffix", { count: lowStockCount })}
						</p>
					);
				})()}
			</article>
		</section>
	);
}
