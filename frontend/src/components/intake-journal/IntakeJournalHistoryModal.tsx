import { useTranslation } from "react-i18next";
import type { IntakeJournalEntry, IntakeJournalHistoryFilters } from "../../hooks/useIntakeJournal";
import type { Medication } from "../../types";
import { AppModal, AppModalFooter } from "../../ui/modal/AppModal";
import { AppButton } from "../../ui/primitives/AppButton";
import { AppSelect } from "../../ui/primitives/AppSelect";
import { getIntakeMoodDisplay } from "../../utils/intake-mood";
import { DateTimeInput } from "../DateTimeInput";
import { MedicationAvatar } from "../MedicationAvatar";
import classes from "./IntakeJournalModal.module.css";
import { formatJournalDisplayDateTime, getJournalSourceLabel } from "./journal-display";

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

	if (!isOpen) {
		return null;
	}

	let listContent: React.ReactNode;

	if (isLoading) {
		listContent = <div className={classes.state}>{t("journal.history.loading")}</div>;
	} else if (entries.length === 0) {
		listContent = <div className={classes.state}>{t("journal.history.empty")}</div>;
	} else {
		listContent = entries.map((entry) =>
			(() => {
				const scheduledForLabel = formatJournalDisplayDateTime(entry.scheduledFor) ?? t("common.notAvailable");
				const updatedAtLabel = entry.updatedAt
					? (formatJournalDisplayDateTime(entry.updatedAt) ?? entry.updatedAt)
					: null;
				const statusLabel = t(entry.dismissed ? "journal.context.statusSkipped" : "journal.context.statusTaken");
				const sourceLabel = getJournalSourceLabel(entry, t);

				return (
					<article key={entry.doseTrackingId} className={classes.entry}>
						<div className={classes.entryMain}>
							<div className={classes.entryHeader}>
								<MedicationAvatar name={entry.medicationName} size="sm" />
								<div className={classes.entryHeading}>
									<strong>{entry.medicationName}</strong>
									<span className={classes.statusPill}>{statusLabel}</span>
								</div>
							</div>
							<div className={classes.noteBlock}>
								<span className={classes.noteLabel}>{t("journal.actions.note")}</span>
								{entry.mood ? <span className={classes.moodBadge}>{getIntakeMoodDisplay(entry.mood, t)}</span> : null}
								<p className={classes.entryNote}>{entry.note ?? t("journal.history.noNote")}</p>
							</div>
							<dl className={classes.entryMetaGrid}>
								<div className={classes.metaCell}>
									<dt>{t("journal.context.scheduledFor")}</dt>
									<dd>{scheduledForLabel}</dd>
								</div>
								<div className={classes.metaCell}>
									<dt>{t("journal.context.source")}</dt>
									<dd>{sourceLabel}</dd>
								</div>
								{updatedAtLabel ? (
									<div className={classes.metaCell}>
										<dt>{t("journal.history.updatedLabel")}</dt>
										<dd>{updatedAtLabel}</dd>
									</div>
								) : null}
							</dl>
						</div>
						<div className={classes.entryActions}>
							<AppButton type="button" onClick={() => void onReopen(entry.doseId)}>
								{t("journal.history.reopen")}
							</AppButton>
						</div>
					</article>
				);
			})()
		);
	}

	return (
		<AppModal
			classNames={{
				header: classes.header,
				title: classes.title,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			contentClassName={`${classes.modal} journal-history-modal`}
			onClose={onClose}
			opened={isOpen}
			size={720}
			title={
				<div className={classes.titleBlock}>
					<h2>{t("journal.history.title")}</h2>
					<p>{t("journal.history.description")}</p>
				</div>
			}
			withCloseButton
		>
			<div className={classes.filters}>
				<AppSelect
					id="journal-history-medication"
					classNames={{ input: classes.selectInput, label: classes.fieldLabel }}
					data={[
						{ value: "all", label: t("journal.history.filters.allMedications") },
						...medications.map((medication) => ({ value: String(medication.id), label: medication.name })),
					]}
					label={t("journal.history.filters.medication")}
					onChange={(event) => {
						const value = event.target.value;
						onFilterChange({ medicationId: value === "all" ? null : Number(value) });
					}}
					value={filters.medicationId == null ? "all" : String(filters.medicationId)}
				/>
				<div className={`${classes.field} ${classes.dateFilter}`}>
					<span className={classes.fieldLabel}>{t("journal.history.filters.from")}</span>
					<DateTimeInput
						value={filters.from}
						onChange={(event) => onFilterChange({ from: event.target.value })}
						step="60"
						aria-label={t("journal.history.filters.from")}
						placeholder={t("journal.history.filters.fromPlaceholder")}
					/>
				</div>
				<div className={`${classes.field} ${classes.dateFilter}`}>
					<span className={classes.fieldLabel}>{t("journal.history.filters.to")}</span>
					<DateTimeInput
						value={filters.to}
						onChange={(event) => onFilterChange({ to: event.target.value })}
						step="60"
						aria-label={t("journal.history.filters.to")}
						placeholder={t("journal.history.filters.toPlaceholder")}
					/>
				</div>
			</div>

			<div className={classes.toolbar}>
				<AppButton type="button" tone="ghost" onClick={onResetFilters}>
					{t("journal.history.resetFilters")}
				</AppButton>
				<AppButton type="button" tone="ghost" onClick={() => void onReload()} disabled={isLoading}>
					{t("journal.history.reload")}
				</AppButton>
			</div>

			{error && <div className={classes.inlineError}>{error}</div>}

			<div className={classes.list}>{listContent}</div>

			<AppModalFooter>
				<AppButton type="button" tone="secondary" onClick={onClose}>
					{t("common.close")}
				</AppButton>
			</AppModalFooter>
		</AppModal>
	);
}
