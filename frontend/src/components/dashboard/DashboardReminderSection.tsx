import { type Coverage, getMedDisplayName, type Medication, type StockThresholds } from "../../types";
import { getStockStatus } from "../../utils/schedule";

type ReminderData = {
	status: { className: string; text: string };
	lowStockMeds: Array<{ name: string; daysLeft: number; isCritical: boolean }>;
	lastStockSent: { medNames: string | null; date: string } | null;
	lastIntakeSent: { medName: string | null; takenBy: string | null; date: string } | null;
};

type PrescriptionLowMed = {
	id: number;
	name: string;
	remainingRefills: number;
	threshold: number;
};

type DashboardReminderSectionProps = {
	t: (key: string, options?: Record<string, unknown>) => string;
	remindersLoading: boolean;
	anyRemindersEnabled: boolean;
	stockRemindersEnabled: boolean;
	intakeRemindersEnabled: boolean;
	prescriptionRemindersEnabled: boolean;
	reminderData: ReminderData;
	prescriptionLowMeds: PrescriptionLowMed[];
	prescriptionStatus: { text: string; className: string } | null;
	meds: Medication[];
	coverage: { all: Coverage[] };
	stockThresholds: StockThresholds;
	sendingReminder: boolean;
	reminderResult: { success: boolean; message: string } | null;
	onSendManualReminder: () => void;
	onOpenMedicationDetail: (med: Medication) => void;
};

function NotificationBellIcon() {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ display: "block" }}
		>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>
	);
}

export function DashboardReminderSection({
	t,
	remindersLoading,
	anyRemindersEnabled,
	stockRemindersEnabled,
	intakeRemindersEnabled,
	prescriptionRemindersEnabled,
	reminderData,
	prescriptionLowMeds,
	prescriptionStatus,
	meds,
	coverage,
	stockThresholds,
	sendingReminder,
	reminderResult,
	onSendManualReminder,
	onOpenMedicationDetail,
}: DashboardReminderSectionProps) {
	const getStatusTextClass = (statusClassName: string | undefined): string => {
		if (statusClassName === "danger") return "danger-text";
		if (statusClassName === "warning") return "warning-text";
		return "";
	};

	if (remindersLoading) {
		return (
			<section className="reminder-status-bar reminder-status-skeleton" aria-busy="true">
				<div className="reminder-status-header">
					<span className="reminder-status-icon">
						<NotificationBellIcon />
					</span>
					<span className="reminder-status-title">{t("dashboard.reminders.active")}</span>
				</div>
				<div className="reminder-status-details reminder-status-skeleton-lines">
					<span className="skeleton-line skeleton-line-long" />
					<span className="skeleton-line skeleton-line-medium" />
					<span className="skeleton-line skeleton-line-short" />
				</div>
			</section>
		);
	}

	if (!anyRemindersEnabled) {
		return null;
	}

	return (
		<section className="reminder-status-bar">
			<div className="reminder-status-header">
				<span className="reminder-status-icon">
					<NotificationBellIcon />
				</span>
				<span className="reminder-status-title">{t("dashboard.reminders.active")}</span>
				{stockRemindersEnabled && (
					<span className={`status-chip small ${reminderData.status.className}`}>{reminderData.status.text}</span>
				)}
				{prescriptionStatus && (
					<span className={`status-chip small ${prescriptionStatus.className}`}>{prescriptionStatus.text}</span>
				)}
			</div>
			{(reminderData.lowStockMeds.length > 0 ||
				(prescriptionRemindersEnabled && prescriptionLowMeds.length > 0) ||
				(stockRemindersEnabled && reminderData.lastStockSent) ||
				(intakeRemindersEnabled && reminderData.lastIntakeSent)) && (
				<div className="reminder-status-details">
					{stockRemindersEnabled && reminderData.lowStockMeds.length > 0 && (
						<div className="reminder-status-row">
							<span className="reminder-status-label">{t("dashboard.reminders.needsRefill")}:</span>
							<span className="reminder-status-value">
								{reminderData.lowStockMeds.map((med, idx) => {
									const medication = meds.find((m) => getMedDisplayName(m) === med.name);
									const cov = coverage.all.find((c) => c.name === med.name);
									const status = cov
										? getStockStatus(cov.daysLeft, cov.medsLeft, stockThresholds, medication?.packageType)
										: null;
									const textClass = getStatusTextClass(status?.className);
									return (
										<span key={med.name}>
											{idx > 0 && ", "}
											<span
												className={`med-link clickable ${textClass}`}
												onClick={() => medication && onOpenMedicationDetail(medication)}
												onKeyDown={(e) => {
													if ((e.key === "Enter" || e.key === " ") && medication) {
														onOpenMedicationDetail(medication);
													}
												}}
											>
												{med.name}
											</span>
											<span className={`reminder-days-left ${textClass}`}>
												{" "}
												{t("dashboard.reminders.daysLeft", { count: med.daysLeft, days: med.daysLeft })}
											</span>
										</span>
									);
								})}
							</span>
						</div>
					)}
					{prescriptionRemindersEnabled && prescriptionLowMeds.length > 0 && (
						<div className="reminder-status-row">
							<span className="reminder-status-label">{t("dashboard.reminders.needsPrescriptionRefill")}:</span>
							<span className="reminder-status-value">
								{prescriptionLowMeds.map((med, idx) => {
									const medication = meds.find((m) => m.id === med.id);
									const textClass = med.remainingRefills <= 0 ? "danger-text" : "warning-text";
									return (
										<span key={med.id}>
											{idx > 0 && ", "}
											<span className={`reminder-days-left ${textClass}`}>
												{t("prescription.remainingRefills")}: {med.remainingRefills} · {t("dashboard.reminders.usedBy")}
												:{" "}
												<span
													className={`med-link clickable ${textClass}`}
													onClick={() => medication && onOpenMedicationDetail(medication)}
													onKeyDown={(e) => {
														if ((e.key === "Enter" || e.key === " ") && medication) {
															onOpenMedicationDetail(medication);
														}
													}}
												>
													{med.name}
												</span>
											</span>
										</span>
									);
								})}
							</span>
						</div>
					)}
					{stockRemindersEnabled && reminderData.lastStockSent && (
						<div className="reminder-status-row">
							<span className="reminder-status-label">{t("dashboard.reminders.lastStockSent")}:</span>
							<span className="reminder-status-value">
								{reminderData.lastStockSent.medNames &&
									(() => {
										const names = reminderData.lastStockSent?.medNames?.split(", ") ?? [];
										return names.map((name, idx) => {
											const medication = meds.find((m) => getMedDisplayName(m) === name);
											return (
												<span key={name}>
													{idx > 0 && ", "}
													{medication ? (
														<span
															className="med-link clickable"
															onClick={() => onOpenMedicationDetail(medication)}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") onOpenMedicationDetail(medication);
															}}
														>
															{name}
														</span>
													) : (
														<span className="reminder-med-name">{name}</span>
													)}
												</span>
											);
										});
									})()}
								<span className="reminder-date"> {reminderData.lastStockSent.date}</span>
							</span>
						</div>
					)}
					{intakeRemindersEnabled && reminderData.lastIntakeSent && (
						<div className="reminder-status-row">
							<span className="reminder-status-label">{t("dashboard.reminders.lastSent")}:</span>
							<span className="reminder-status-value">
								{reminderData.lastIntakeSent.medName &&
									(() => {
										const medication = meds.find((m) => getMedDisplayName(m) === reminderData.lastIntakeSent?.medName);
										return medication ? (
											<span
												className="med-link clickable"
												onClick={() => onOpenMedicationDetail(medication)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") onOpenMedicationDetail(medication);
												}}
											>
												{reminderData.lastIntakeSent?.medName}
											</span>
										) : (
											<span className="reminder-med-name">{reminderData.lastIntakeSent?.medName}</span>
										);
									})()}
								{reminderData.lastIntakeSent.takenBy && (
									<span className="reminder-taken-by"> ({reminderData.lastIntakeSent.takenBy})</span>
								)}
								<span className="reminder-date"> {reminderData.lastIntakeSent.date}</span>
							</span>
						</div>
					)}
				</div>
			)}
			{((stockRemindersEnabled && reminderData.lowStockMeds.length > 0) ||
				(prescriptionRemindersEnabled && prescriptionLowMeds.length > 0)) && (
				<div className="reminder-send-row">
					<button type="button" className="ghost" onClick={onSendManualReminder} disabled={sendingReminder}>
						{sendingReminder ? t("common.sending") : t("dashboard.reorder.sendReminder")}
					</button>
					{reminderResult && (
						<span className={`reminder-send-result ${reminderResult.success ? "success" : "error"}`}>
							{reminderResult.message}
						</span>
					)}
				</div>
			)}
		</section>
	);
}
