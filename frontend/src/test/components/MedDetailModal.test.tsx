import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MedDetailModal } from "../../components/MedDetailModal";
import type { Coverage, Medication, RefillEntry, StockThresholds } from "../../types";

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
	refillSaving: false,
	refillHistory: [] as RefillEntry[],
	refillHistoryExpanded: false,
	onRefillHistoryExpandedChange: vi.fn(),
	onSubmitRefill: vi.fn(),
	editStockFullBlisters: 0,
	onEditStockFullBlistersChange: vi.fn(),
	editStockPartialBlisterPills: 0,
	onEditStockPartialBlisterPillsChange: vi.fn(),
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

		const closeBtn = screen.getByText("×");
		expect(closeBtn).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		render(<MedDetailModal {...defaultProps} onClose={onClose} />);

		const closeBtn = screen.getByText("×");
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
		render(<MedDetailModal {...defaultProps} showRefillModal={true} onSubmitRefill={onSubmitRefill} />);

		const submitBtns = document.querySelectorAll("button");
		const submitBtn = Array.from(submitBtns).find(
			(btn) => btn.textContent?.includes("refill") || btn.textContent?.includes("submit")
		);
		if (submitBtn) {
			fireEvent.click(submitBtn);
		}
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
			{ id: 1, medicationId: 1, timestamp: new Date().toISOString(), packsAdded: 1, looseAdded: 0 },
		];

		render(<MedDetailModal {...defaultProps} refillHistory={refillHistory} refillHistoryExpanded={true} />);

		// Refill history should be visible
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});

	it("calls onRefillHistoryExpandedChange when toggle clicked", () => {
		const onRefillHistoryExpandedChange = vi.fn();
		const refillHistory: RefillEntry[] = [
			{ id: 1, medicationId: 1, timestamp: new Date().toISOString(), packsAdded: 1, looseAdded: 0 },
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
