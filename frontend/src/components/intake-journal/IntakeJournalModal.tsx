import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { AppModal, AppModalFooter } from "../../ui/modal/AppModal";
import { AppButton } from "../../ui/primitives/AppButton";
import { AppTextarea } from "../../ui/primitives/AppTextarea";
import { AppTooltip } from "../../ui/primitives/AppTooltip";
import { getIntakeMoodLabel, INTAKE_MOODS, type IntakeMood } from "../../utils/intake-mood";
import { MedicationAvatar } from "../MedicationAvatar";
import classes from "./IntakeJournalModal.module.css";
import { INTAKE_MOOD_ICONS } from "./intake-mood-icons";
import { formatJournalDisplayDateTime, getJournalSourceLabel } from "./journal-display";

interface IntakeJournalModalProps {
	isOpen: boolean;
	entry: IntakeJournalEntry | null;
	isLoading: boolean;
	isSaving: boolean;
	isDeleting: boolean;
	error: string | null;
	onClose: () => void;
	onSave: (note: string, mood: IntakeMood | null) => Promise<boolean> | boolean;
	onDelete: () => Promise<void> | void;
	allowDelete?: boolean;
	readOnly?: boolean;
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
	readOnly = false,
}: IntakeJournalModalProps) {
	const { t } = useTranslation();
	const [note, setNote] = useState("");
	const [mood, setMood] = useState<IntakeMood | null>(null);
	const [showSavedState, setShowSavedState] = useState(false);
	const activeDoseTrackingIdRef = useRef<number | null>(null);
	const wasSavingRef = useRef(false);
	const errorRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) {
			setNote("");
			setMood(null);
			setShowSavedState(false);
			activeDoseTrackingIdRef.current = null;
			wasSavingRef.current = false;
			return;
		}

		if (!entry) {
			return;
		}

		setNote(entry.note ?? "");
		setMood(entry.mood ?? null);
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
			if (entry && !error && note === (entry.note ?? "") && mood === (entry.mood ?? null)) {
				setShowSavedState(true);
			}
		}
	}, [entry, error, isOpen, isSaving, mood, note]);

	useEffect(() => {
		if (error) errorRef.current?.focus();
	}, [error]);

	if (!isOpen) {
		return null;
	}

	const handleSave = async () => {
		const saved = await onSave(note, mood);
		if (saved) {
			onClose();
		}
	};

	const scheduledForLabel = formatJournalDisplayDateTime(entry?.scheduledFor ?? null);
	const occurredAtLabel = formatJournalDisplayDateTime(entry?.occurredAt ?? null);
	const takenAtLabel = formatJournalDisplayDateTime(entry?.takenAt ?? null);
	let title = t("journal.editor.addTitle");
	if (entry?.note || entry?.mood) title = t("journal.editor.editTitle");
	if (readOnly) title = t("journal.editor.readOnlyTitle");
	const saveLabel = showSavedState ? t("common.saved") : t("common.save");
	let bodyContent: React.ReactNode;

	if (isLoading) {
		bodyContent = <div className={classes.state}>{t("journal.editor.loading")}</div>;
	} else if (entry) {
		const isAsNeeded = entry.eventType === "as_needed";
		const statusLabel = isAsNeeded
			? t(`asNeeded.history.status.${entry.status}`)
			: t(entry.dismissed ? "journal.context.statusSkipped" : "journal.context.statusTaken");
		bodyContent = (
			<>
				<div className={classes.eventCard}>
					<div className={classes.eventMedication}>
						<MedicationAvatar name={entry.medicationName} size="sm" />
						<div>
							<strong>{entry.medicationName}</strong>
							<p>{statusLabel}</p>
						</div>
					</div>
					<div className={classes.eventGrid}>
						{isAsNeeded ? (
							<div>
								<span>{t("journal.context.occurredAt")}</span>
								<strong>{occurredAtLabel ?? t("common.notAvailable")}</strong>
							</div>
						) : (
							<>
								<div>
									<span>{t("journal.context.scheduledFor")}</span>
									<strong>{scheduledForLabel ?? t("common.notAvailable")}</strong>
								</div>
								<div>
									<span>{t("journal.context.takenAt")}</span>
									<strong>{takenAtLabel ?? t("journal.context.notRecorded")}</strong>
								</div>
							</>
						)}
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
				{readOnly ? <div className={classes.readOnlyNotice}>{t("journal.editor.readOnlyDescription")}</div> : null}

				<fieldset className={classes.moodField} disabled={readOnly}>
					<legend className={classes.fieldLabel}>{t("journal.mood.label")}</legend>
					{mood ? (
						<div className={classes.moodHeader}>
							<AppButton
								type="button"
								size="xs"
								tone="ghost"
								onClick={() => {
									setMood(null);
									setShowSavedState(false);
								}}
							>
								{t("journal.mood.clear")}
							</AppButton>
						</div>
					) : null}
					<div className={classes.moodOptions}>
						{INTAKE_MOODS.map((option) => {
							const selected = mood === option;
							const MoodIcon = INTAKE_MOOD_ICONS[option];
							const label = getIntakeMoodLabel(option, t);
							return (
								<AppTooltip key={option} label={label} maw={160}>
									<button
										type="button"
										aria-label={label}
										aria-pressed={selected}
										className={`${classes.moodOption} ${selected ? classes.moodOptionSelected : ""}`}
										onClick={() => {
											setMood(selected ? null : option);
											setShowSavedState(false);
										}}
									>
										<MoodIcon aria-hidden="true" />
									</button>
								</AppTooltip>
							);
						})}
					</div>
				</fieldset>

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
					readOnly={readOnly}
					value={note}
				/>

				{error && (
					<div ref={errorRef} className={classes.inlineError} role="alert" tabIndex={-1}>
						{error}
					</div>
				)}
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
			onClose={() => {
				if (!isSaving && !isDeleting) onClose();
			}}
			opened={isOpen}
			size={720}
			title={
				<div className={classes.titleBlock}>
					<h2>{title}</h2>
					<p>{t(readOnly ? "journal.editor.readOnlyIntro" : "journal.editor.description")}</p>
				</div>
			}
			withCloseButton
		>
			{bodyContent}

			<AppModalFooter
				left={
					allowDelete && !readOnly ? (
						<AppButton
							type="button"
							tone="ghost"
							onClick={() => void onDelete()}
							disabled={isLoading || isSaving || isDeleting || (!entry?.note && !entry?.mood)}
						>
							{isDeleting ? t("journal.editor.deleting") : t("common.delete")}
						</AppButton>
					) : null
				}
			>
				<AppButton type="button" tone="secondary" onClick={onClose} disabled={isSaving || isDeleting}>
					{t(readOnly ? "common.close" : "common.cancel")}
				</AppButton>
				{readOnly ? null : (
					<AppButton
						type="button"
						tone="primary"
						onClick={() => void handleSave()}
						disabled={isLoading || isSaving || isDeleting || !entry}
					>
						{saveLabel}
					</AppButton>
				)}
			</AppModalFooter>
		</AppModal>
	);
}
