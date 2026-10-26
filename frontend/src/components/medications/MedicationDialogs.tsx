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
	onUnsavedConfirmExit: () => void;
	showNoScheduleConfirm: boolean;
	noScheduleTitle: string;
	noScheduleMessage: string;
	noScheduleConfirmLabel: string;
	noScheduleCancelLabel: string;
	onConfirmNoSchedule: () => void;
	onCancelNoSchedule: () => void;
	onNoScheduleConfirmExit: () => void;
	showObsoleteConfirm: boolean;
	obsoleteCandidate: Medication | null;
	obsoleteTitle: string;
	obsoleteMessage: string;
	obsoleteConfirmLabel: string;
	obsoleteCancelLabel: string;
	onConfirmMarkObsolete: () => void;
	onCancelMarkObsolete: () => void;
	onObsoleteConfirmExit: () => void;
	showDeleteConfirm: boolean;
	deleteCandidate: Medication | null;
	deleteTitle: string;
	deleteMessage: string;
	deleteConfirmLabel: string;
	deleteCancelLabel: string;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
	onDeleteConfirmExit: () => void;
	showEditModal: boolean;
	lightboxImage: { src: string; alt: string } | null;
	onCloseLightbox: () => void;
	showReportModal: boolean;
	onCloseReportModal: () => void;
	onReportModalExit: () => void;
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
	onUnsavedConfirmExit,
	showNoScheduleConfirm,
	noScheduleTitle,
	noScheduleMessage,
	noScheduleConfirmLabel,
	noScheduleCancelLabel,
	onConfirmNoSchedule,
	onCancelNoSchedule,
	onNoScheduleConfirmExit,
	showObsoleteConfirm,
	obsoleteCandidate,
	obsoleteTitle,
	obsoleteMessage,
	obsoleteConfirmLabel,
	obsoleteCancelLabel,
	onConfirmMarkObsolete,
	onCancelMarkObsolete,
	onObsoleteConfirmExit,
	showDeleteConfirm,
	deleteCandidate,
	deleteTitle,
	deleteMessage,
	deleteConfirmLabel,
	deleteCancelLabel,
	onConfirmDelete,
	onCancelDelete,
	onDeleteConfirmExit,
	showEditModal,
	lightboxImage,
	onCloseLightbox,
	showReportModal,
	onCloseReportModal,
	onReportModalExit,
	medications,
}: MedicationDialogsProps) {
	return (
		<>
			{mobileEditModal}

			<ConfirmModal
				opened={showUnsavedConfirm}
				title={unsavedTitle}
				message={unsavedMessage}
				confirmLabel={unsavedConfirmLabel}
				cancelLabel={unsavedCancelLabel}
				onConfirm={onConfirmClose}
				onCancel={onCancelClose}
				confirmVariant="danger"
				onExitTransitionEnd={onUnsavedConfirmExit}
				overlayClassName={showEditModal ? "nested-confirm" : undefined}
			/>

			<ConfirmModal
				opened={showObsoleteConfirm && !!obsoleteCandidate}
				title={obsoleteTitle}
				message={obsoleteMessage}
				confirmLabel={obsoleteConfirmLabel}
				cancelLabel={obsoleteCancelLabel}
				onConfirm={onConfirmMarkObsolete}
				onCancel={onCancelMarkObsolete}
				confirmVariant="warning"
				onExitTransitionEnd={onObsoleteConfirmExit}
				overlayClassName={showEditModal ? "nested-confirm" : undefined}
			/>

			<ConfirmModal
				opened={showNoScheduleConfirm}
				title={noScheduleTitle}
				message={noScheduleMessage}
				confirmLabel={noScheduleConfirmLabel}
				cancelLabel={noScheduleCancelLabel}
				onConfirm={onConfirmNoSchedule}
				onCancel={onCancelNoSchedule}
				confirmVariant="warning"
				onExitTransitionEnd={onNoScheduleConfirmExit}
				overlayClassName={showEditModal ? "nested-confirm" : undefined}
			/>

			<ConfirmModal
				opened={showDeleteConfirm && !!deleteCandidate}
				title={deleteTitle}
				message={deleteMessage}
				confirmLabel={deleteConfirmLabel}
				cancelLabel={deleteCancelLabel}
				onConfirm={onConfirmDelete}
				onCancel={onCancelDelete}
				confirmVariant="danger"
				onExitTransitionEnd={onDeleteConfirmExit}
				overlayClassName={showEditModal ? "nested-confirm" : undefined}
			/>

			{lightboxImage && <Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={onCloseLightbox} />}

			<ReportModal
				isOpen={showReportModal}
				onClose={onCloseReportModal}
				onExitTransitionEnd={onReportModalExit}
				medications={medications}
			/>
		</>
	);
}
