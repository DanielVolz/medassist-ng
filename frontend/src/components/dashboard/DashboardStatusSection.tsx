import { Text } from "@mantine/core";
import type { Coverage, Medication, StockThresholds } from "../../types";
import { getMedDisplayName } from "../../types";
import { SectionCard } from "../../ui/components/SectionCard";
import { AppTextAction } from "../../ui/primitives/AppTextAction";
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
	const getStatusTextColor = (statusClassName: string): string | undefined => {
		if (statusClassName === "danger") return "red";
		if (statusClassName === "warning") return "yellow";
		return undefined;
	};

	if (!show) {
		return null;
	}

	return (
		<section className="grid">
			<SectionCard title={t("dashboard.reorder.title")}>
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
						return (
							<Text c="green" component="p" fw={700} m={0}>
								{t("dashboard.reorder.allGood")}
							</Text>
						);
					}

					return (
						<p>
							{t("dashboard.reorder.lowWarningPrefix")}{" "}
							{lowStockMeds.map((c, idx) => {
								const med = meds.find((m) => getMedDisplayName(m) === c.name);
								const status = getStockStatus(c.daysLeft, c.medsLeft, stockThresholds, med?.packageType);
								const textColor = getStatusTextColor(status.className);
								return (
									<span key={c.name}>
										{idx > 0 && ", "}
										{med ? (
											<AppTextAction color={textColor} fontWeight={700} onClick={() => onOpenMedicationDetail(med)}>
												{c.name}
											</AppTextAction>
										) : (
											<Text c={textColor} component="span" fw={700}>
												{c.name}
											</Text>
										)}
										<Text c={textColor} component="span" fw={textColor ? 700 : undefined}>
											{" "}
											({t("dashboard.reminders.daysLeft", { count: c.daysLeft ?? 0, days: c.daysLeft ?? 0 })})
										</Text>
									</span>
								);
							})}{" "}
							{t("dashboard.reorder.lowWarningSuffix", { count: lowStockCount })}
						</p>
					);
				})()}
			</SectionCard>
		</section>
	);
}
