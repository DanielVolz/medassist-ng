import type React from "react";
import type { Medication } from "../../types";
import { ConfirmModal } from "../ConfirmModal";
import { Lightbox } from "../Lightbox";
import ReportModal from "../ReportModal";

type MedicationDialogsProps = {
	mobileEditModal: React.ReactNode;
	showUnsavedConfirm: boolean;
	unsavedCancelLabel: string;
	unsavedConfirmLabel: string;
	unsavedMessage: string;
	unsavedTitle: string;
	onConfirmClose: () => void;
	onCancelClose: () => void;
	showNoScheduleConfirm: boolean;
	noScheduleTitle: string;
	noScheduleMessage: string;
	noScheduleConfirmLabel: string;
	noScheduleCancelLabel: string;
	onConfirmNoSchedule: () => void;
	onCancelNoSchedule: () => void;
	showObsoleteConfirm: boolean;
	obsoleteCandidate: Medication | null;
	obsoleteTitle: string;
	obsoleteMessage: string;
	obsoleteConfirmLabel: string;
	obsoleteCancelLabel: string;
	onConfirmMarkObsolete: () => void;
	onCancelMarkObsolete: () => void;
	showDeleteConfirm: boolean;
	deleteCandidate: Medication | null;
	deleteTitle: string;
	deleteMessage: string;
	deleteConfirmLabel: string;
	deleteCancelLabel: string;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
	showEditModal: boolean;
	lightboxImage: { src: string; alt: string } | null;
	onCloseLightbox: () => void;
	showReportModal: boolean;
	onCloseReportModal: () => void;
	medications: Medication[];
};

export function MedicationDialogs({
	mobileEditModal,
	showUnsavedConfirm,
	unsavedCancelLabel,
	unsavedConfirmLabel,
	unsavedMessage,
	unsavedTitle,
	onConfirmClose,
	onCancelClose,
	showNoScheduleConfirm,
	noScheduleTitle,
	noScheduleMessage,
	noScheduleConfirmLabel,
	noScheduleCancelLabel,
	onConfirmNoSchedule,
	onCancelNoSchedule,
	showObsoleteConfirm,
	obsoleteCandidate,
	obsoleteTitle,
	obsoleteMessage,
	obsoleteConfirmLabel,
	obsoleteCancelLabel,
	onConfirmMarkObsolete,
	onCancelMarkObsolete,
	showDeleteConfirm,
	deleteCandidate,
	deleteTitle,
	deleteMessage,
	deleteConfirmLabel,
	deleteCancelLabel,
	onConfirmDelete,
	onCancelDelete,
	showEditModal,
	lightboxImage,
	onCloseLightbox,
	showReportModal,
	onCloseReportModal,
	medications,
}: MedicationDialogsProps) {
	return (
		<>
			{mobileEditModal}

			{showUnsavedConfirm && (
				<ConfirmModal
					title={unsavedTitle}
					message={unsavedMessage}
					confirmLabel={unsavedConfirmLabel}
					cancelLabel={unsavedCancelLabel}
					onConfirm={onConfirmClose}
					onCancel={onCancelClose}
					confirmVariant="danger"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{showObsoleteConfirm && obsoleteCandidate && (
				<ConfirmModal
					title={obsoleteTitle}
					message={obsoleteMessage}
					confirmLabel={obsoleteConfirmLabel}
					cancelLabel={obsoleteCancelLabel}
					onConfirm={onConfirmMarkObsolete}
					onCancel={onCancelMarkObsolete}
					confirmVariant="warning"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{showNoScheduleConfirm && (
				<ConfirmModal
					title={noScheduleTitle}
					message={noScheduleMessage}
					confirmLabel={noScheduleConfirmLabel}
					cancelLabel={noScheduleCancelLabel}
					onConfirm={onConfirmNoSchedule}
					onCancel={onCancelNoSchedule}
					confirmVariant="warning"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{showDeleteConfirm && deleteCandidate && (
				<ConfirmModal
					title={deleteTitle}
					message={deleteMessage}
					confirmLabel={deleteConfirmLabel}
					cancelLabel={deleteCancelLabel}
					onConfirm={onConfirmDelete}
					onCancel={onCancelDelete}
					confirmVariant="danger"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{lightboxImage && <Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={onCloseLightbox} />}

			<ReportModal isOpen={showReportModal} onClose={onCloseReportModal} medications={medications} />
		</>
	);
}
