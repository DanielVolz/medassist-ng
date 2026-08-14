import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MedicationDialogs } from "../../components/medications/MedicationDialogs";
import type { Medication } from "../../types";

vi.mock("../../components/ConfirmModal", () => ({
	ConfirmModal: ({
		title,
		confirmLabel,
		cancelLabel,
		onConfirm,
		onCancel,
		overlayClassName,
	}: {
		title: string;
		confirmLabel: string;
		cancelLabel: string;
		onConfirm: () => void;
		onCancel: () => void;
		overlayClassName?: string;
	}) => (
		<div data-testid={`confirm-${title}`} data-overlay-class={overlayClassName ?? ""}>
			<button type="button" onClick={onConfirm}>
				{confirmLabel}
			</button>
			<button type="button" onClick={onCancel}>
				{cancelLabel}
			</button>
		</div>
	),
}));

vi.mock("../../components/Lightbox", () => ({
	Lightbox: ({ src, alt }: { src: string; alt: string }) => <div data-testid="lightbox">{`${src}|${alt}`}</div>,
}));

vi.mock("../../components/ReportModal", () => ({
	default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="report-modal">report</div> : null),
}));

const baseMedication: Medication = {
	id: 1,
	name: "Aspirin",
	genericName: "Acetylsalicylic acid",
	takenBy: ["John"],
	packageType: "blister",
	packCount: 1,
	blistersPerPack: 2,
	pillsPerBlister: 10,
	totalPills: null,
	packageAmountValue: null,
	packageAmountUnit: null,
	looseTablets: 0,
	stockAdjustment: 0,
	lastStockCorrectionAt: null,
	pillWeightMg: 500,
	doseUnit: "mg",
	medicationForm: "tablet",
	pillForm: "tablet",
	lifecycleCategory: "refill_when_empty",
	blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00Z" }],
	intakes: [
		{
			usage: 1,
			every: 1,
			start: "2024-01-01T09:00:00Z",
			takenBy: "",
			intakeRemindersEnabled: false,
			scheduleMode: "interval",
			weekdays: [],
		},
	],
	imageUrl: null,
	expiryDate: null,
	notes: null,
	intakeRemindersEnabled: false,
	medicationStartDate: "",
	medicationEndDate: null,
	autoMarkObsoleteAfterEndDate: true,
	isObsolete: false,
	obsoleteAt: null,
	prescriptionEnabled: false,
	prescriptionAuthorizedRefills: null,
	prescriptionRemainingRefills: null,
	prescriptionLowRefillThreshold: 1,
	prescriptionExpiryDate: null,
	dismissedUntil: null,
	updatedAt: null,
};

function createProps(overrides: Partial<React.ComponentProps<typeof MedicationDialogs>> = {}) {
	return {
		mobileEditModal: <div data-testid="mobile-edit">mobile</div>,
		showUnsavedConfirm: false,
		unsavedCancelLabel: "cancel-unsaved",
		unsavedConfirmLabel: "confirm-unsaved",
		unsavedMessage: "unsaved-message",
		unsavedTitle: "unsaved-title",
		onConfirmClose: vi.fn(),
		onCancelClose: vi.fn(),
		showNoScheduleConfirm: false,
		noScheduleTitle: "no-schedule-title",
		noScheduleMessage: "no-schedule-message",
		noScheduleConfirmLabel: "confirm-no-schedule",
		noScheduleCancelLabel: "cancel-no-schedule",
		onConfirmNoSchedule: vi.fn(),
		onCancelNoSchedule: vi.fn(),
		showObsoleteConfirm: false,
		obsoleteCandidate: null,
		obsoleteTitle: "obsolete-title",
		obsoleteMessage: "obsolete-message",
		obsoleteConfirmLabel: "confirm-obsolete",
		obsoleteCancelLabel: "cancel-obsolete",
		onConfirmMarkObsolete: vi.fn(),
		onCancelMarkObsolete: vi.fn(),
		showDeleteConfirm: false,
		deleteCandidate: null,
		deleteTitle: "delete-title",
		deleteMessage: "delete-message",
		deleteConfirmLabel: "confirm-delete",
		deleteCancelLabel: "cancel-delete",
		onConfirmDelete: vi.fn(),
		onCancelDelete: vi.fn(),
		showEditModal: false,
		lightboxImage: null,
		onCloseLightbox: vi.fn(),
		showReportModal: false,
		onCloseReportModal: vi.fn(),
		medications: [baseMedication],
		...overrides,
	};
}

describe("MedicationDialogs", () => {
	it("always renders mobile edit container and report modal state", () => {
		render(<MedicationDialogs {...createProps({ showReportModal: true })} />);

		expect(screen.getByTestId("mobile-edit")).toBeInTheDocument();
		expect(screen.getByTestId("report-modal")).toBeInTheDocument();
	});

	it("renders nested unsaved confirm when edit modal is open and triggers callbacks", () => {
		const onConfirmClose = vi.fn();
		const onCancelClose = vi.fn();

		render(
			<MedicationDialogs
				{...createProps({
					showUnsavedConfirm: true,
					showEditModal: true,
					onConfirmClose,
					onCancelClose,
				})}
			/>
		);

		const modal = screen.getByTestId("confirm-unsaved-title");
		expect(modal).toHaveAttribute("data-overlay-class", "nested-confirm");

		fireEvent.click(screen.getByText("confirm-unsaved"));
		fireEvent.click(screen.getByText("cancel-unsaved"));

		expect(onConfirmClose).toHaveBeenCalledTimes(1);
		expect(onCancelClose).toHaveBeenCalledTimes(1);
	});

	it("renders the no-schedule confirmation without changing its cancel semantics", () => {
		const onConfirmNoSchedule = vi.fn();
		const onCancelNoSchedule = vi.fn();
		render(
			<MedicationDialogs {...createProps({ showNoScheduleConfirm: true, onConfirmNoSchedule, onCancelNoSchedule })} />
		);

		fireEvent.click(screen.getByText("cancel-no-schedule"));
		expect(onCancelNoSchedule).toHaveBeenCalledTimes(1);
		expect(onConfirmNoSchedule).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("confirm-no-schedule"));
		expect(onConfirmNoSchedule).toHaveBeenCalledTimes(1);
	});

	it("renders obsolete and delete confirms only when a candidate exists", () => {
		const { rerender } = render(
			<MedicationDialogs
				{...createProps({
					showObsoleteConfirm: true,
					showDeleteConfirm: true,
					obsoleteCandidate: baseMedication,
					deleteCandidate: baseMedication,
				})}
			/>
		);

		expect(screen.getByTestId("confirm-obsolete-title")).toBeInTheDocument();
		expect(screen.getByTestId("confirm-delete-title")).toBeInTheDocument();

		rerender(
			<MedicationDialogs
				{...createProps({
					showObsoleteConfirm: true,
					showDeleteConfirm: true,
					obsoleteCandidate: null,
					deleteCandidate: null,
				})}
			/>
		);

		expect(screen.queryByTestId("confirm-obsolete-title")).not.toBeInTheDocument();
		expect(screen.queryByTestId("confirm-delete-title")).not.toBeInTheDocument();
	});

	it("renders lightbox when image data is present", () => {
		render(
			<MedicationDialogs
				{...createProps({
					lightboxImage: { src: "https://example.com/a.jpg", alt: "Medication image" },
				})}
			/>
		);

		expect(screen.getByTestId("lightbox")).toHaveTextContent("https://example.com/a.jpg|Medication image");
	});
});
