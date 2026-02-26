import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserFilterModal } from "../../components/UserFilterModal";
import type { Coverage, Medication, StockThresholds } from "../../types";

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
};

const mockCoverage: Coverage = {
	name: "Test Med",
	medsLeft: 25,
	daysLeft: 25,
	depletionDate: null,
	depletionTime: null,
	nextDose: null,
};

describe("UserFilterModal", () => {
	it("renders nothing when selectedUser is null", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser={null}
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.queryByText(/modal\.userMedications/i)).not.toBeInTheDocument();
	});

	it("renders modal when selectedUser is provided", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.getByText(/modal\.userMedications/i)).toBeInTheDocument();
	});

	it("displays user avatar", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		// Avatar should show first letter
		expect(screen.getByText("J")).toBeInTheDocument();
	});

	it("displays medications for selected user", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("displays generic name when available", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.getByText("Generic Name")).toBeInTheDocument();
	});

	it("shows empty message when user has no medications", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="Jane"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.getByText(/modal\.noMedsForUser/i)).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		const closeBtn = screen.getByText("×");
		fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when overlay clicked", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		const overlay = document.querySelector(".modal-overlay");
		if (overlay) {
			fireEvent.click(overlay);
		}

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClearUser and onOpenMedDetail when medication clicked", () => {
		const onClose = vi.fn();
		const onClearUser = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={onClearUser}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		const medItem = document.querySelector(".user-med-item");
		if (medItem) {
			fireEvent.click(medItem);
		}

		expect(onClearUser).toHaveBeenCalledTimes(1);
		expect(onOpenMedDetail).toHaveBeenCalledWith(mockMedication);
	});

	it("calls onClose when footer close button clicked", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		const footerCloseBtn = screen.getByText(/common\.close/i);
		fireEvent.click(footerCloseBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when modal content clicked", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		render(
			<UserFilterModal
				selectedUser="John"
				meds={[mockMedication]}
				coverage={{ all: [mockCoverage] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		const content = document.querySelector(".modal-content");
		if (content) {
			fireEvent.click(content);
		}

		expect(onClose).not.toHaveBeenCalled();
	});

	it("filters medications by takenBy correctly", () => {
		const onClose = vi.fn();
		const onOpenMedDetail = vi.fn();

		const meds: Medication[] = [
			{ ...mockMedication, id: 1, name: "Med1", takenBy: ["John"] },
			{ ...mockMedication, id: 2, name: "Med2", takenBy: ["Jane"] },
			{ ...mockMedication, id: 3, name: "Med3", takenBy: ["John", "Jane"] },
		];

		render(
			<UserFilterModal
				selectedUser="John"
				meds={meds}
				coverage={{ all: [] }}
				settings={defaultSettings}
				onClose={onClose}
				onClearUser={vi.fn()}
				onOpenMedDetail={onOpenMedDetail}
			/>
		);

		expect(screen.getByText("Med1")).toBeInTheDocument();
		expect(screen.queryByText("Med2")).not.toBeInTheDocument();
		expect(screen.getByText("Med3")).toBeInTheDocument();
	});
});
