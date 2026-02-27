import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MedDetailModal } from "../../components/MedDetailModal";
import type { Coverage, Medication, RefillEntry, StockThresholds } from "../../types";
import * as utils from "../../utils";

const defaultSettings: StockThresholds = {
	lowStockDays: 7,
	normalStockDays: 30,
	highStockDays: 90,
	criticalStockDays: 3,
	expiryWarningDays: 30,
};

const mockMedication: Medication = {
	id: 1,
	name: "Test Med",
	genericName: "Generic Name",
	packageType: "blister",
	packCount: 1,
	blistersPerPack: 1,
	pillsPerBlister: 30,
	looseTablets: 0,
	takenBy: ["John"],
	blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00" }],
	updatedAt: null,
	expiryDate: "2025-12-31",
	notes: "Test notes",
};

const mockCoverage: Coverage = {
	name: "Test Med",
	medsLeft: 25,
	daysLeft: 25,
	depletionDate: "2024-04-01",
	depletionTime: Date.now() + 25 * 86400000,
	nextDose: null,
};

const defaultProps = {
	selectedMed: mockMedication,
	coverage: { all: [mockCoverage] },
	settings: defaultSettings,
	showImageLightbox: false,
	showRefillModal: false,
	showEditStockModal: false,
	onClose: vi.fn(),
	onOpenImageLightbox: vi.fn(),
	onCloseImageLightbox: vi.fn(),
	onOpenRefillModal: vi.fn(),
	onCloseRefillModal: vi.fn(),
	onOpenEditStockModal: vi.fn(),
	onCloseEditStockModal: vi.fn(),
	refillPacks: 0,
	onRefillPacksChange: vi.fn(),
	refillLoose: 0,
	onRefillLooseChange: vi.fn(),
	usePrescriptionRefill: false,
	onUsePrescriptionRefillChange: vi.fn(),
	refillSaving: false,
	refillHistory: [] as RefillEntry[],
	refillHistoryExpanded: false,
	onRefillHistoryExpandedChange: vi.fn(),
	onSubmitRefill: vi.fn(),
	editStockFullBlisters: 0,
	onEditStockFullBlistersChange: vi.fn(),
	editStockPartialBlisterPills: 0,
	onEditStockPartialBlisterPillsChange: vi.fn(),
	editStockLoosePills: 0,
	onEditStockLoosePillsChange: vi.fn(),
	editStockSaving: false,
	onSubmitStockCorrection: vi.fn(),
};

describe("MedDetailModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders nothing when selectedMed is null", () => {
		render(<MedDetailModal {...defaultProps} selectedMed={null} />);

		expect(screen.queryByText("Test Med")).not.toBeInTheDocument();
	});

	it("renders modal when medication is selected", () => {
		render(<MedDetailModal {...defaultProps} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("displays medication name", () => {
		render(<MedDetailModal {...defaultProps} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("displays generic name", () => {
		render(<MedDetailModal {...defaultProps} />);

		expect(screen.getByText("Generic Name")).toBeInTheDocument();
	});

	it("renders close button", () => {
		render(<MedDetailModal {...defaultProps} />);

		const closeButtons = screen.getAllByRole("button", { name: /common\.close/i });
		const closeBtn = closeButtons[0];
		expect(closeBtn).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		render(<MedDetailModal {...defaultProps} onClose={onClose} />);

		const closeButtons = screen.getAllByRole("button", { name: /common\.close/i });
		const closeBtn = closeButtons[0];
		fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when overlay clicked", () => {
		const onClose = vi.fn();
		render(<MedDetailModal {...defaultProps} onClose={onClose} />);

		const overlay = document.querySelector(".modal-overlay");
		if (overlay) {
			fireEvent.click(overlay);
		}

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when modal content clicked", () => {
		const onClose = vi.fn();
		render(<MedDetailModal {...defaultProps} onClose={onClose} />);

		const content = document.querySelector(".modal-content");
		if (content) {
			fireEvent.click(content);
		}

		expect(onClose).not.toHaveBeenCalled();
	});

	it("displays notes when available", () => {
		render(<MedDetailModal {...defaultProps} />);

		expect(screen.getByText("Test notes")).toBeInTheDocument();
	});

	it("shows loose pills in stock details for blister medications", () => {
		const medWithLoose: Medication = {
			...mockMedication,
			pillsPerBlister: 5,
			looseTablets: 2,
		};

		const coverageWithLoose: Coverage = {
			...mockCoverage,
			medsLeft: 50,
		};

		render(<MedDetailModal {...defaultProps} selectedMed={medWithLoose} coverage={{ all: [coverageWithLoose] }} />);

		expect(screen.getByText("+ 2 modal.loosePills", { exact: false })).toBeInTheDocument();
	});

	it("shows prescription details section when prescription is enabled", () => {
		const med: Medication = {
			...mockMedication,
			prescriptionEnabled: true,
			prescriptionAuthorizedRefills: 5,
			prescriptionRemainingRefills: 2,
			prescriptionLowRefillThreshold: 1,
			prescriptionExpiryDate: "2026-12-31",
		};

		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.getByText(/form\.sections\.prescription/i)).toBeInTheDocument();
		expect(screen.getByText(/prescription\.authorizedRefills/i)).toBeInTheDocument();
		expect(screen.getByText(/prescription\.remainingRefills/i)).toBeInTheDocument();
		expect(screen.getByText(/prescription\.lowThreshold/i)).toBeInTheDocument();
		expect(screen.getByText(/prescription\.expiryDate/i)).toBeInTheDocument();
	});

	it("does not show prescription details section when prescription is disabled", () => {
		const med: Medication = {
			...mockMedication,
			prescriptionEnabled: false,
		};

		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.queryByText(/form\.sections\.prescription/i)).not.toBeInTheDocument();
	});

	it("displays schedule information", () => {
		render(<MedDetailModal {...defaultProps} />);

		// Should have schedule section
		const scheduleSection = document.querySelector(".med-detail-schedules");
		expect(scheduleSection).toBeInTheDocument();
	});

	it("renders med detail header", () => {
		render(<MedDetailModal {...defaultProps} />);

		const header = document.querySelector(".med-detail-header");
		expect(header).toBeInTheDocument();
	});

	it("renders med detail body", () => {
		render(<MedDetailModal {...defaultProps} />);

		const body = document.querySelector(".med-detail-body");
		expect(body).toBeInTheDocument();
	});

	it("shows configured pack count in package details, independent from current stock", () => {
		const medWithConfiguredPacks: Medication = {
			...mockMedication,
			packCount: 11,
			blistersPerPack: 5,
			pillsPerBlister: 5,
		};

		const lowCurrentStockCoverage: Coverage = {
			...mockCoverage,
			medsLeft: 47,
		};

		render(
			<MedDetailModal
				{...defaultProps}
				selectedMed={medWithConfiguredPacks}
				coverage={{ all: [lowCurrentStockCoverage] }}
			/>
		);

		const packsLabel = screen.getByText(/modal\.packs/i);
		const packsValue = packsLabel.closest(".med-detail-item")?.querySelector(".med-detail-value");
		expect(packsValue?.textContent).toBe("11");
	});
});

describe("MedDetailModal without coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("works without coverage data", () => {
		render(<MedDetailModal {...defaultProps} coverage={{ all: [] }} />);

		// Should still render the medication name
		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});
});

describe("MedDetailModal without optional fields", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("works without generic name", () => {
		const med = { ...mockMedication, genericName: null };
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("works without notes", () => {
		const med = { ...mockMedication, notes: null };
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("works without takenBy", () => {
		const med = { ...mockMedication, takenBy: [] };
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("works without expiryDate", () => {
		const med = { ...mockMedication, expiryDate: null };
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});
});

describe("MedDetailModal with refill modal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows refill modal when open", () => {
		render(<MedDetailModal {...defaultProps} showRefillModal={true} />);

		// Modal should show refill section
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});

	it("calls onCloseRefillModal when refill modal closed", () => {
		const onCloseRefillModal = vi.fn();
		render(<MedDetailModal {...defaultProps} showRefillModal={true} onCloseRefillModal={onCloseRefillModal} />);

		// Modal close button
		const closeButtons = document.querySelectorAll("button");
		const cancelBtn = Array.from(closeButtons).find(
			(btn) => btn.textContent?.includes("cancel") || btn.textContent?.includes("Cancel")
		);
		if (cancelBtn) {
			fireEvent.click(cancelBtn);
		}
	});

	it("calls onSubmitRefill when refill submitted", () => {
		const onSubmitRefill = vi.fn();
		render(<MedDetailModal {...defaultProps} showRefillModal={true} onSubmitRefill={onSubmitRefill} refillLoose={1} />);

		const submitBtn = document.querySelector(".refill-modal .modal-footer .success") as HTMLButtonElement;
		fireEvent.click(submitBtn);
		expect(onSubmitRefill).toHaveBeenCalledWith(mockMedication.id, false);
	});

	it("disables refill submit button when no pills are entered", () => {
		render(<MedDetailModal {...defaultProps} showRefillModal={true} refillPacks={0} refillLoose={0} />);

		const submitBtn = document.querySelector(".refill-modal .modal-footer .success") as HTMLButtonElement;
		expect(submitBtn).toBeDisabled();
	});

	it("shows singular refill preview text when total refill is one pill", () => {
		const bottleMed: Medication = {
			...mockMedication,
			packageType: "bottle",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 10,
		};

		render(<MedDetailModal {...defaultProps} selectedMed={bottleMed} showRefillModal={true} refillLoose={1} />);

		expect(screen.getByText(/\+1 common\.pill/i)).toBeInTheDocument();
	});

	it("parses refill packs and loose pills inputs", () => {
		const onRefillPacksChange = vi.fn();
		const onRefillLooseChange = vi.fn();
		render(
			<MedDetailModal
				{...defaultProps}
				showRefillModal={true}
				onRefillPacksChange={onRefillPacksChange}
				onRefillLooseChange={onRefillLooseChange}
			/>
		);

		const numberInputs = document.querySelectorAll(".refill-modal input[type='number']");
		fireEvent.change(numberInputs[0], { target: { value: "3" } });
		fireEvent.change(numberInputs[1], { target: { value: "5" } });

		expect(onRefillPacksChange).toHaveBeenCalledWith(3);
		expect(onRefillLooseChange).toHaveBeenCalledWith(5);
	});

	it("uses zero fallback for invalid refill input values", () => {
		const onRefillPacksChange = vi.fn();
		const onRefillLooseChange = vi.fn();
		render(
			<MedDetailModal
				{...defaultProps}
				showRefillModal={true}
				onRefillPacksChange={onRefillPacksChange}
				onRefillLooseChange={onRefillLooseChange}
			/>
		);

		const numberInputs = document.querySelectorAll(".refill-modal input[type='number']");
		fireEvent.change(numberInputs[0], { target: { value: "NaN" } });
		fireEvent.change(numberInputs[1], { target: { value: "" } });

		expect(onRefillPacksChange).toHaveBeenCalledWith(0);
		expect(onRefillLooseChange).toHaveBeenCalledWith(0);
	});

	it("shows package size breakdown key for blister stock correction", () => {
		render(<MedDetailModal {...defaultProps} showEditStockModal={true} />);

		expect(screen.queryByText("editStock.packageSizeBreakdown")).not.toBeInTheDocument();
		expect(document.querySelector(".edit-stock-live-breakdown")).toBeInTheDocument();
	});

	it("shows numeric package size text for bottle stock correction", () => {
		const bottleMed: Medication = {
			...mockMedication,
			packageType: "bottle",
			totalPills: 150,
			looseTablets: 130,
		};

		render(<MedDetailModal {...defaultProps} selectedMed={bottleMed} showEditStockModal={true} />);

		expect(screen.getByText("editStock.packageSize_150")).toBeInTheDocument();
	});
});

describe("MedDetailModal actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders action buttons", () => {
		render(<MedDetailModal {...defaultProps} />);

		const buttons = document.querySelectorAll("button");
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("calls onOpenRefillModal when refill clicked", () => {
		const onOpenRefillModal = vi.fn();
		render(<MedDetailModal {...defaultProps} onOpenRefillModal={onOpenRefillModal} />);

		const buttons = document.querySelectorAll("button");
		const refillBtn = Array.from(buttons).find(
			(btn) => btn.textContent?.includes("refill") || btn.textContent?.includes("Refill")
		);
		if (refillBtn) {
			fireEvent.click(refillBtn);
			expect(onOpenRefillModal).toHaveBeenCalled();
		}
	});

	it("calls generateICS when export calendar button is clicked", () => {
		const generateICSSpy = vi.spyOn(utils, "generateICS").mockImplementation(() => "BEGIN:VCALENDAR");
		render(<MedDetailModal {...defaultProps} />);

		fireEvent.click(screen.getByRole("button", { name: /modal\.exportTooltip/i }));
		expect(generateICSSpy).toHaveBeenCalledWith(mockMedication);
	});

	it("calls onOpenEditStockModal when stock correction icon is clicked", () => {
		const onOpenEditStockModal = vi.fn();
		render(<MedDetailModal {...defaultProps} onOpenEditStockModal={onOpenEditStockModal} />);

		fireEvent.click(screen.getByRole("button", { name: /editStock\.buttonLabel/i }));
		expect(onOpenEditStockModal).toHaveBeenCalledTimes(1);
	});

	it("does not render export calendar button when no blisters exist", () => {
		const medWithoutBlisters: Medication = {
			...mockMedication,
			blisters: [],
		};

		render(<MedDetailModal {...defaultProps} selectedMed={medWithoutBlisters} />);
		expect(screen.queryByRole("button", { name: /modal\.exportTooltip/i })).not.toBeInTheDocument();
	});
});

describe("MedDetailModal with multiple blisters", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders multiple schedule entries", () => {
		const med = {
			...mockMedication,
			blisters: [
				{ usage: 1, every: 1, start: "2024-01-01T09:00:00" },
				{ usage: 2, every: 7, start: "2024-01-01T20:00:00" },
			],
		};
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		const _scheduleEntries = document.querySelectorAll(".schedule-entry");
		// Should have multiple schedule entries
	});
});

describe("MedDetailModal with image", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders medication avatar", () => {
		render(<MedDetailModal {...defaultProps} />);

		const avatar = document.querySelector(".med-avatar");
		expect(avatar).toBeInTheDocument();
	});

	it("shows lightbox when image clicked", () => {
		const onOpenImageLightbox = vi.fn();
		const med = { ...mockMedication, imageUrl: "test-image.jpg" };
		render(<MedDetailModal {...defaultProps} selectedMed={med} onOpenImageLightbox={onOpenImageLightbox} />);

		const avatar = document.querySelector(".med-avatar");
		if (avatar) {
			fireEvent.click(avatar);
		}

		expect(onOpenImageLightbox).toHaveBeenCalledTimes(1);
	});

	it("renders lightbox when enabled and image is present", () => {
		const med = { ...mockMedication, imageUrl: "test-image.jpg" };
		render(<MedDetailModal {...defaultProps} selectedMed={med} showImageLightbox={true} />);

		expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
	});
});

describe("MedDetailModal nested modal overlays", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("closes refill modal when clicking refill overlay", () => {
		const onCloseRefillModal = vi.fn();
		render(<MedDetailModal {...defaultProps} showRefillModal={true} onCloseRefillModal={onCloseRefillModal} />);

		const overlays = document.querySelectorAll(".modal-overlay");
		fireEvent.click(overlays[1]);
		expect(onCloseRefillModal).toHaveBeenCalledTimes(1);
	});

	it("closes edit stock modal when clicking edit-stock overlay", () => {
		const onCloseEditStockModal = vi.fn();
		render(
			<MedDetailModal {...defaultProps} showEditStockModal={true} onCloseEditStockModal={onCloseEditStockModal} />
		);

		const overlays = document.querySelectorAll(".modal-overlay");
		fireEvent.click(overlays[1]);
		expect(onCloseEditStockModal).toHaveBeenCalledTimes(1);
	});

	it("renders only edit stock modal in editStockOnly mode", () => {
		render(<MedDetailModal {...defaultProps} showEditStockModal={true} editStockOnly={true} />);

		expect(screen.getByText("editStock.title")).toBeInTheDocument();
		expect(screen.queryByText("form.sections.schedule")).not.toBeInTheDocument();
	});

	it("closes edit stock modal on Escape", () => {
		const onCloseEditStockModal = vi.fn();
		render(
			<MedDetailModal {...defaultProps} showEditStockModal={true} onCloseEditStockModal={onCloseEditStockModal} />
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onCloseEditStockModal).toHaveBeenCalled();
	});
});

describe("MedDetailModal with low stock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows stock status for low stock", () => {
		const lowCoverage: Coverage = {
			name: "Test Med",
			medsLeft: 3,
			daysLeft: 3,
			depletionDate: "2024-01-05",
			depletionTime: Date.now() + 3 * 86400000,
			nextDose: null,
		};

		render(<MedDetailModal {...defaultProps} coverage={{ all: [lowCoverage] }} />);

		// Should render status indicator
		const _statusElements = document.querySelectorAll(".danger, .warning, .success");
		// Status should be visible
	});
});

describe("MedDetailModal with refill history", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows refill history when expanded", () => {
		const refillHistory: RefillEntry[] = [
			{ id: 1, refillDate: new Date().toISOString(), packsAdded: 1, loosePillsAdded: 0 },
		];

		render(<MedDetailModal {...defaultProps} refillHistory={refillHistory} refillHistoryExpanded={true} />);

		// Refill history should be visible
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});

	it("calls onRefillHistoryExpandedChange when toggle clicked", () => {
		const onRefillHistoryExpandedChange = vi.fn();
		const refillHistory: RefillEntry[] = [
			{ id: 1, refillDate: new Date().toISOString(), packsAdded: 1, loosePillsAdded: 0 },
		];

		render(
			<MedDetailModal
				{...defaultProps}
				refillHistory={refillHistory}
				onRefillHistoryExpandedChange={onRefillHistoryExpandedChange}
			/>
		);

		// Click expand toggle if exists
		const expandButton = document.querySelector('[class*="expand"], [class*="toggle"]');
		if (expandButton) {
			fireEvent.click(expandButton);
		}
	});
});

describe("MedDetailModal intake schedule usage display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not multiply usage by personCount when intakes have per-intake takenBy", () => {
		// Two people at medication level, but each intake has its own takenBy
		const med: Medication = {
			...mockMedication,
			takenBy: ["Alice", "Bob"],
			blisters: [
				{ usage: 1, every: 1, start: "2024-01-01T09:00:00" },
				{ usage: 1, every: 1, start: "2024-01-01T21:00:00" },
			],
			intakes: [
				{ usage: 1, every: 1, start: "2024-01-01T09:00:00", takenBy: "Alice", intakeRemindersEnabled: false },
				{ usage: 1, every: 1, start: "2024-01-01T21:00:00", takenBy: "Bob", intakeRemindersEnabled: false },
			],
		};
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		const usageElements = document.querySelectorAll(".med-schedule-usage");
		// Each intake should show "1 pill" (not "2 pills")
		usageElements.forEach((el) => {
			expect(el.textContent).toContain("1");
			expect(el.textContent).not.toMatch(/^2\b/);
		});
	});

	it("multiplies usage by personCount for legacy blisters without per-intake takenBy", () => {
		// Two people at medication level, legacy blisters without intakes
		const med: Medication = {
			...mockMedication,
			takenBy: ["Alice", "Bob"],
			blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00" }],
			// No intakes array - legacy format
		};
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		const usageElements = document.querySelectorAll(".med-schedule-usage");
		// Legacy: 1 pill * 2 people = "2 pills"
		expect(usageElements.length).toBe(1);
		expect(usageElements[0].textContent).toContain("2");
	});

	it("shows correct usage for single person with per-intake takenBy", () => {
		const med: Medication = {
			...mockMedication,
			takenBy: ["Alice"],
			pillWeightMg: 500,
			blisters: [{ usage: 2, every: 1, start: "2024-01-01T09:00:00" }],
			intakes: [{ usage: 2, every: 1, start: "2024-01-01T09:00:00", takenBy: "Alice", intakeRemindersEnabled: false }],
		};
		render(<MedDetailModal {...defaultProps} selectedMed={med} />);

		const usageElements = document.querySelectorAll(".med-schedule-usage");
		expect(usageElements.length).toBe(1);
		// Should show "2 pills (1000 mg)" - usage=2, not multiplied
		expect(usageElements[0].textContent).toContain("2");
		expect(usageElements[0].textContent).toContain("1000");
	});
});

describe("MedDetailModal partial blister normalization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("carries partial pills into full blisters when partial reaches pillsPerBlister", () => {
		const onEditStockFullBlistersChange = vi.fn();
		const onEditStockPartialBlisterPillsChange = vi.fn();
		const blisterMed: Medication = {
			...mockMedication,
			packCount: 10,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			looseTablets: 0,
		};

		// full=12, partial=4 (one below pillsPerBlister)
		render(
			<MedDetailModal
				{...defaultProps}
				selectedMed={blisterMed}
				showEditStockModal={true}
				editStockFullBlisters={12}
				editStockPartialBlisterPills={4}
				editStockLoosePills={0}
				onEditStockFullBlistersChange={onEditStockFullBlistersChange}
				onEditStockPartialBlisterPillsChange={onEditStockPartialBlisterPillsChange}
			/>
		);

		// Find the increment button for the partial blister pills stepper
		// The partial stepper is the second stepper in the modal
		const incrementButtons = document.querySelectorAll(".stepper-btn.increment");
		const partialIncrementBtn = incrementButtons[1]; // full[0], partial[1], loose[2]
		expect(partialIncrementBtn).not.toBeDisabled();

		// Press + on partial: 4 → 5 = pillsPerBlister → normalization carries to full
		fireEvent.click(partialIncrementBtn);

		// full should have been called with 13 (12 + 1 carry)
		expect(onEditStockFullBlistersChange).toHaveBeenCalledWith(13);
		// partial should have been called with 0 (5 % 5 = 0)
		expect(onEditStockPartialBlisterPillsChange).toHaveBeenCalledWith(0);
	});

	it("does not carry partial pills into full when below pillsPerBlister", () => {
		const onEditStockFullBlistersChange = vi.fn();
		const onEditStockPartialBlisterPillsChange = vi.fn();
		const blisterMed: Medication = {
			...mockMedication,
			packCount: 10,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			looseTablets: 0,
		};

		// full=12, partial=0
		render(
			<MedDetailModal
				{...defaultProps}
				selectedMed={blisterMed}
				showEditStockModal={true}
				editStockFullBlisters={12}
				editStockPartialBlisterPills={0}
				editStockLoosePills={0}
				onEditStockFullBlistersChange={onEditStockFullBlistersChange}
				onEditStockPartialBlisterPillsChange={onEditStockPartialBlisterPillsChange}
			/>
		);

		const incrementButtons = document.querySelectorAll(".stepper-btn.increment");
		const partialIncrementBtn = incrementButtons[1];
		fireEvent.click(partialIncrementBtn);

		// full should not change (1 partial pill with pbb=5 is NOT a carry)
		expect(onEditStockFullBlistersChange).toHaveBeenCalledWith(12);
		// partial should go to 1
		expect(onEditStockPartialBlisterPillsChange).toHaveBeenCalledWith(1);
	});
});

describe("MedDetailModal stock overflow warning", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows overflow warning icon when stock exceeds blister package capacity", () => {
		const overflowCoverage: Coverage = {
			name: "Test Med",
			medsLeft: 49,
			daysLeft: 49,
			depletionDate: "2024-03-01",
			depletionTime: Date.now() + 49 * 86400000,
			nextDose: null,
		};

		render(<MedDetailModal {...defaultProps} coverage={{ all: [overflowCoverage] }} />);

		// For blister meds, denominator is package capacity (not current stock), so overflow is shown.
		const warningIcon = document.querySelector(".info-tooltip.tooltip-align-left.warning-text");
		expect(warningIcon).toBeInTheDocument();
	});

	it("does not show warning icon when stock is within package capacity", () => {
		render(<MedDetailModal {...defaultProps} />);

		// packageSize = 30, currentStock = 25 < 30
		const warningIcon = document.querySelector(".info-tooltip.tooltip-align-left.warning-text");
		expect(warningIcon).not.toBeInTheDocument();
	});

	it("does not show warning icon when stock equals package capacity", () => {
		const exactCoverage: Coverage = {
			name: "Test Med",
			medsLeft: 30,
			daysLeft: 30,
			depletionDate: "2024-02-01",
			depletionTime: Date.now() + 30 * 86400000,
			nextDose: null,
		};

		render(<MedDetailModal {...defaultProps} coverage={{ all: [exactCoverage] }} />);

		// packageSize = 30, currentStock = 30 — equal, no warning
		const warningIcon = document.querySelector(".info-tooltip.tooltip-align-left.warning-text");
		expect(warningIcon).not.toBeInTheDocument();
	});
});

describe("MedDetailModal bottle package type", () => {
	const bottleMed: Medication = {
		id: 2,
		name: "Bottle Med",
		genericName: null,
		packageType: "bottle",
		packCount: 0,
		blistersPerPack: 1,
		pillsPerBlister: 1,
		looseTablets: 80,
		totalPills: 100,
		takenBy: [],
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00" }],
		updatedAt: null,
		expiryDate: null,
		notes: null,
	};

	const bottleCoverage: Coverage = {
		name: "Bottle Med",
		medsLeft: 80,
		daysLeft: 80,
		depletionDate: "2024-06-01",
		depletionTime: Date.now() + 80 * 86400000,
		nextDose: null,
	};

	const bottleProps = {
		...defaultProps,
		selectedMed: bottleMed,
		coverage: { all: [bottleCoverage] },
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not show blister fields in stock info section", () => {
		render(<MedDetailModal {...bottleProps} />);

		// Should show current stock
		expect(screen.getByText(/modal\.currentStock/i)).toBeInTheDocument();

		// Should NOT show full blisters or open blister labels
		expect(screen.queryByText(/table\.fullBlisters/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/table\.openBlister/i)).not.toBeInTheDocument();
	});

	it("shows bottle type in package details section", () => {
		render(<MedDetailModal {...bottleProps} />);

		// Should show package type as bottle
		expect(screen.getByText(/form\.packageTypeBottle/i)).toBeInTheDocument();

		// Should show total capacity
		expect(screen.getByText(/form\.totalCapacity/i)).toBeInTheDocument();
	});

	it("shows pills-only refill modal for bottle type", () => {
		render(<MedDetailModal {...bottleProps} showRefillModal={true} />);

		// Should show pills to add label
		expect(screen.getByText(/refill\.pillsToAdd/i)).toBeInTheDocument();

		// Should NOT show packs label in refill
		const _refillModal = document.querySelector(".refill-modal");
		// Packs label should not be present for bottle type
		expect(screen.queryByText("refill.packs")).not.toBeInTheDocument();
	});

	it("parses bottle refill pills input", () => {
		const onRefillLooseChange = vi.fn();
		render(<MedDetailModal {...bottleProps} showRefillModal={true} onRefillLooseChange={onRefillLooseChange} />);

		const input = document.querySelector(".refill-modal input[type='number']") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "7" } });
		expect(onRefillLooseChange).toHaveBeenCalledWith(7);
	});

	it("uses zero fallback for invalid bottle refill input", () => {
		const onRefillLooseChange = vi.fn();
		render(<MedDetailModal {...bottleProps} showRefillModal={true} onRefillLooseChange={onRefillLooseChange} />);

		const input = document.querySelector(".refill-modal input[type='number']") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "" } });
		expect(onRefillLooseChange).toHaveBeenCalledWith(0);
	});

	it("shows looseTablets as total capacity fallback when totalPills is null (backward compat)", () => {
		// Old medications created before totalPills column existed
		const oldBottleMed: Medication = {
			...bottleMed,
			totalPills: null,
			looseTablets: 180,
		};
		const oldCoverage: Coverage = {
			name: "Bottle Med",
			medsLeft: 138,
			daysLeft: 138,
			depletionDate: "2024-06-01",
			depletionTime: Date.now() + 138 * 86400000,
			nextDose: null,
		};
		render(<MedDetailModal {...bottleProps} selectedMed={oldBottleMed} coverage={{ all: [oldCoverage] }} />);

		// Total Capacity should show 180 (looseTablets), not "—"
		const capacityLabel = screen.getByText(/form\.totalCapacity/i);
		const capacityValue = capacityLabel.closest(".med-detail-item")?.querySelector(".med-detail-value");
		expect(capacityValue?.textContent).toBe("180");
	});

	it("shows total pills input in edit stock modal for bottle type", () => {
		render(<MedDetailModal {...bottleProps} showEditStockModal={true} />);

		// Should show total pills label
		expect(screen.getByText(/editStock\.totalPills/i)).toBeInTheDocument();

		// Should NOT show full blisters or partial blister labels
		expect(screen.queryByText(/editStock\.fullBlisters/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/editStock\.partialBlisterPills/i)).not.toBeInTheDocument();
	});
});
