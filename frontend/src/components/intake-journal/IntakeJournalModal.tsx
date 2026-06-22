import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { AppModal, AppModalFooter } from "../../ui/modal/AppModal";
import { AppButton } from "../../ui/primitives/AppButton";
import { AppTextarea } from "../../ui/primitives/AppTextarea";
import { MedicationAvatar } from "../MedicationAvatar";
import classes from "./IntakeJournalModal.module.css";
import { formatJournalDisplayDateTime, getJournalSourceLabel } from "./journal-display";

interface IntakeJournalModalProps {
	isOpen: boolean;
	entry: IntakeJournalEntry | null;
	isLoading: boolean;
	isSaving: boolean;
	isDeleting: boolean;
	error: string | null;
	onClose: () => void;
	onSave: (note: string) => Promise<boolean> | boolean;
	onDelete: () => Promise<void> | void;
	allowDelete?: boolean;
}

export function IntakeJournalModal({
	isOpen,
	entry,
	isLoading,
	isSaving,
	isDeleting,
	error,
	onClose,
	onSave,
	onDelete,
	allowDelete = true,
}: IntakeJournalModalProps) {
	const { t } = useTranslation();
	const [note, setNote] = useState("");
	const [showSavedState, setShowSavedState] = useState(false);
	const activeDoseTrackingIdRef = useRef<number | null>(null);
	const wasSavingRef = useRef(false);

	useEffect(() => {
		if (!isOpen) {
			setNote("");
			setShowSavedState(false);
			activeDoseTrackingIdRef.current = null;
			wasSavingRef.current = false;
			return;
		}

		if (!entry) {
			return;
		}

		setNote(entry.note ?? "");
		if (activeDoseTrackingIdRef.current !== entry.doseTrackingId) {
			activeDoseTrackingIdRef.current = entry.doseTrackingId;
			setShowSavedState(false);
		}
	}, [entry, isOpen]);

	useEffect(() => {
		if (!isOpen) {
			wasSavingRef.current = false;
			return;
		}

		if (isSaving) {
			setShowSavedState(false);
			wasSavingRef.current = true;
			return;
		}

		if (wasSavingRef.current) {
			wasSavingRef.current = false;
			if (entry && !error && note === (entry.note ?? "")) {
				setShowSavedState(true);
			}
		}
	}, [entry, error, isOpen, isSaving, note]);

	if (!isOpen) {
		return null;
	}

	const handleSave = async () => {
		const saved = await onSave(note);
		if (saved) {
			onClose();
		}
	};

	const scheduledForLabel = formatJournalDisplayDateTime(entry?.scheduledFor ?? null);
	const takenAtLabel = formatJournalDisplayDateTime(entry?.takenAt ?? null);
	const title = entry?.note ? t("journal.editor.editTitle") : t("journal.editor.addTitle");
	const saveLabel = showSavedState ? t("common.saved") : t("common.save");
	let bodyContent: React.ReactNode;

	if (isLoading) {
		bodyContent = <div className={classes.state}>{t("journal.editor.loading")}</div>;
	} else if (entry) {
		bodyContent = (
			<>
				<div className={classes.eventCard}>
					<div className={classes.eventMedication}>
						<MedicationAvatar name={entry.medicationName} size="sm" />
						<div>
							<strong>{entry.medicationName}</strong>
							<p>{entry.dismissed ? t("journal.context.statusSkipped") : t("journal.context.statusTaken")}</p>
						</div>
					</div>
					<div className={classes.eventGrid}>
						<div>
							<span>{t("journal.context.scheduledFor")}</span>
							<strong>{scheduledForLabel ?? t("common.notAvailable")}</strong>
						</div>
						<div>
							<span>{t("journal.context.takenAt")}</span>
							<strong>{takenAtLabel ?? t("journal.context.notRecorded")}</strong>
						</div>
						<div>
							<span>{t("journal.context.markedBy")}</span>
							<strong>{entry.markedBy ?? t("journal.context.self")}</strong>
						</div>
						<div>
							<span>{t("journal.context.source")}</span>
							<strong>{getJournalSourceLabel(entry, t)}</strong>
						</div>
					</div>
				</div>

				<AppTextarea
					id="journal-note-input"
					autosize={false}
					className={classes.field}
					classNames={{ input: classes.noteInput, label: classes.fieldLabel }}
					label={t("journal.editor.noteLabel")}
					maxLength={4000}
					minRows={7}
					onChange={(event) => {
						setNote(event.target.value);
						setShowSavedState(false);
					}}
					placeholder={t("journal.editor.notePlaceholder")}
					value={note}
				/>

				{error && <div className={classes.inlineError}>{error}</div>}
			</>
		);
	} else {
		bodyContent = <div className={classes.state}>{error ?? t("journal.errors.loadFailed")}</div>;
	}

	return (
		<AppModal
			classNames={{
				header: classes.header,
				title: classes.title,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			contentClassName={`${classes.modal} journal-modal`}
			onClose={onClose}
			opened={isOpen}
			size={720}
			title={
				<div className={classes.titleBlock}>
					<h2>{title}</h2>
					<p>{t("journal.editor.description")}</p>
				</div>
			}
			withCloseButton
		>
			{bodyContent}

			<AppModalFooter
				left={
					allowDelete ? (
						<AppButton
							type="button"
							tone="ghost"
							onClick={() => void onDelete()}
							disabled={isLoading || isSaving || isDeleting || !entry?.note}
						>
							{isDeleting ? t("journal.editor.deleting") : t("common.delete")}
						</AppButton>
					) : null
				}
			>
				<AppButton type="button" tone="secondary" onClick={onClose} disabled={isSaving || isDeleting}>
					{t("common.cancel")}
				</AppButton>
				<AppButton
					type="button"
					tone="primary"
					onClick={() => void handleSave()}
					disabled={isLoading || isSaving || isDeleting || !entry}
				>
					{saveLabel}
				</AppButton>
			</AppModalFooter>
		</AppModal>
	);
}
