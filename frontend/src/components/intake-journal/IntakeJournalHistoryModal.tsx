import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import type { IntakeJournalEntry, IntakeJournalHistoryFilters } from "../../hooks/useIntakeJournal";
import { useScrollLock } from "../../hooks/useScrollLock";
import type { Medication } from "../../types";
import { formatDateTime, getNumericLocale } from "../../utils/formatters";
import { DateTimeInput } from "../DateTimeInput";
import { MedicationAvatar } from "../MedicationAvatar";

interface IntakeJournalHistoryModalProps {
	isOpen: boolean;
	entries: IntakeJournalEntry[];
	filters: IntakeJournalHistoryFilters;
	medications: Medication[];
	isLoading: boolean;
	error: string | null;
	onClose: () => void;
	onFilterChange: (patch: Partial<IntakeJournalHistoryFilters>) => void;
	onReload: () => Promise<void> | void;
	onResetFilters: () => void;
	onReopen: (doseId: string) => Promise<void> | void;
}

function formatDisplayDateTime(value: string | null): string | null {
	if (!value) {
		return null;
	}

	return formatDateTime(value, getNumericLocale());
}

function getJournalSourceLabel(entry: IntakeJournalEntry, t: ReturnType<typeof useTranslation>["t"]): string {
	if (entry.takenSource === "automatic") {
		return t("journal.context.sourceAutomaticReminder");
	}

	return entry.markedBy ? t("journal.context.sourceSharedLink") : t("journal.context.sourceOwnerApp");
}

export function IntakeJournalHistoryModal({
	isOpen,
	entries,
	filters,
	medications,
	isLoading,
	error,
	onClose,
	onFilterChange,
	onReload,
	onResetFilters,
	onReopen,
}: IntakeJournalHistoryModalProps) {
	const { t } = useTranslation();

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);

	if (!isOpen) {
		return null;
	}

	let listContent: React.ReactNode;

	if (isLoading) {
		listContent = <div className="journal-modal-state">{t("journal.history.loading")}</div>;
	} else if (entries.length === 0) {
		listContent = <div className="journal-modal-state">{t("journal.history.empty")}</div>;
	} else {
		listContent = entries.map((entry) => (
			<article key={entry.doseTrackingId} className="journal-history-entry">
				<div className="journal-history-entry-main">
					<div className="journal-history-entry-header">
						<MedicationAvatar name={entry.medicationName} size="sm" />
						<div>
							<strong>{entry.medicationName}</strong>
							<p>{formatDisplayDateTime(entry.scheduledFor) ?? t("common.notAvailable")}</p>
						</div>
					</div>
					<p className="journal-history-note">{entry.note ?? t("journal.history.noNote")}</p>
					<div className="journal-history-meta">
						<span>{t(entry.dismissed ? "journal.context.statusSkipped" : "journal.context.statusTaken")}</span>
						<span>{getJournalSourceLabel(entry, t)}</span>
						{entry.updatedAt && (
							<span>
								{t("journal.history.updatedAt", {
									date: formatDisplayDateTime(entry.updatedAt) ?? entry.updatedAt,
								})}
							</span>
						)}
					</div>
				</div>
				<button type="button" className="primary small" onClick={() => void onReopen(entry.doseId)}>
					{t("journal.history.reopen")}
				</button>
			</article>
		));
	}

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(event) => {
				if (event.key !== "Escape") {
					event.stopPropagation();
				}
			}}
		>
			<div
				className="modal-content journal-history-modal"
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key !== "Escape") {
						event.stopPropagation();
					}
				}}
			>
				<button type="button" className="modal-close" onClick={onClose} aria-label={t("common.close")}>
					×
				</button>
				<div className="journal-modal-header">
					<h2>{t("journal.history.title")}</h2>
					<p>{t("journal.history.description")}</p>
				</div>

				<div className="journal-history-filters">
					<label className="journal-field" htmlFor="journal-history-medication">
						<span>{t("journal.history.filters.medication")}</span>
						<select
							id="journal-history-medication"
							className="select-field"
							value={filters.medicationId ?? "all"}
							onChange={(event) => {
								const value = event.target.value;
								onFilterChange({ medicationId: value === "all" ? null : Number(value) });
							}}
						>
							<option value="all">{t("journal.history.filters.allMedications")}</option>
							{medications.map((medication) => (
								<option key={medication.id} value={medication.id}>
									{medication.name}
								</option>
							))}
						</select>
					</label>
					<div className="journal-field journal-date-filter">
						<span>{t("journal.history.filters.from")}</span>
						<DateTimeInput
							value={filters.from}
							onChange={(event) => onFilterChange({ from: event.target.value })}
							step="60"
							aria-label={t("journal.history.filters.from")}
							placeholder={t("journal.history.filters.fromPlaceholder")}
						/>
					</div>
					<div className="journal-field journal-date-filter">
						<span>{t("journal.history.filters.to")}</span>
						<DateTimeInput
							value={filters.to}
							onChange={(event) => onFilterChange({ to: event.target.value })}
							step="60"
							aria-label={t("journal.history.filters.to")}
							placeholder={t("journal.history.filters.toPlaceholder")}
						/>
					</div>
				</div>

				<div className="journal-history-toolbar">
					<button type="button" className="ghost small" onClick={onResetFilters}>
						{t("journal.history.resetFilters")}
					</button>
					<button type="button" className="ghost small" onClick={() => void onReload()} disabled={isLoading}>
						{t("journal.history.reload")}
					</button>
				</div>

				{error && <div className="journal-inline-error">{error}</div>}

				<div className="journal-history-list">{listContent}</div>

				<div className="modal-footer journal-modal-footer">
					<div className="footer-right">
						<button type="button" className="ghost" onClick={onClose}>
							{t("common.close")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
