import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { useScrollLock } from "../../hooks/useScrollLock";
import { formatDateTime, getNumericLocale } from "../../utils/formatters";
import { MedicationAvatar } from "../MedicationAvatar";

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

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);

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

	const scheduledForLabel = formatDisplayDateTime(entry?.scheduledFor ?? null);
	const takenAtLabel = formatDisplayDateTime(entry?.takenAt ?? null);
	const title = entry?.note ? t("journal.editor.editTitle") : t("journal.editor.addTitle");
	const saveLabel = showSavedState ? t("common.saved") : t("common.save");
	let bodyContent: React.ReactNode;

	if (isLoading) {
		bodyContent = <div className="journal-modal-state">{t("journal.editor.loading")}</div>;
	} else if (entry) {
		bodyContent = (
			<>
				<div className="journal-event-card">
					<div className="journal-event-medication">
						<MedicationAvatar name={entry.medicationName} size="sm" />
						<div>
							<strong>{entry.medicationName}</strong>
							<p>{entry.dismissed ? t("journal.context.statusSkipped") : t("journal.context.statusTaken")}</p>
						</div>
					</div>
					<div className="journal-event-grid">
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

				<label className="journal-field" htmlFor="journal-note-input">
					<span>{t("journal.editor.noteLabel")}</span>
					<textarea
						id="journal-note-input"
						className="journal-note-input"
						rows={7}
						value={note}
						onChange={(event) => {
							setNote(event.target.value);
							setShowSavedState(false);
						}}
						placeholder={t("journal.editor.notePlaceholder")}
						maxLength={4000}
					/>
				</label>

				{error && <div className="journal-inline-error">{error}</div>}
			</>
		);
	} else {
		bodyContent = <div className="journal-modal-state">{error ?? t("journal.errors.loadFailed")}</div>;
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
				className="modal-content journal-modal"
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
					<h2>{title}</h2>
					<p>{t("journal.editor.description")}</p>
				</div>

				{bodyContent}

				<div className="modal-footer journal-modal-footer">
					<div className="footer-left">
						{allowDelete && (
							<button
								type="button"
								className="ghost"
								onClick={() => void onDelete()}
								disabled={isLoading || isSaving || isDeleting || !entry?.note}
							>
								{isDeleting ? t("journal.editor.deleting") : t("common.delete")}
							</button>
						)}
					</div>
					<div className="footer-right">
						<button type="button" className="ghost" onClick={onClose} disabled={isSaving || isDeleting}>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className="primary"
							onClick={() => void handleSave()}
							disabled={isLoading || isSaving || isDeleting || !entry}
						>
							{saveLabel}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
