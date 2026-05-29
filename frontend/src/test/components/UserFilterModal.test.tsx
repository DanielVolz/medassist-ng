import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
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

function renderUserFilterModal(overrides: Partial<ComponentProps<typeof UserFilterModal>> = {}) {
	const props: ComponentProps<typeof UserFilterModal> = {
		selectedUser: "John",
		meds: [mockMedication],
		coverage: { all: [mockCoverage] },
		settings: defaultSettings,
		onClose: vi.fn(),
		onClearUser: vi.fn(),
		onOpenMedDetail: vi.fn(),
		...overrides,
	};

	return {
		...render(<UserFilterModal {...props} />),
		props,
	};
}

describe("UserFilterModal", () => {
	it("renders nothing when selectedUser is null", () => {
		renderUserFilterModal({ selectedUser: null });

		expect(screen.queryByText(/modal\.userMedications/i)).not.toBeInTheDocument();
	});

	it("renders modal when selectedUser is provided", () => {
		renderUserFilterModal();

		expect(screen.getByText(/modal\.userMedications/i)).toBeInTheDocument();
	});

	it("displays user avatar", () => {
		renderUserFilterModal();

		// Avatar should show first letter
		expect(screen.getByText("J")).toBeInTheDocument();
	});

	it("displays medications for selected user", () => {
		renderUserFilterModal();

		expect(screen.getByText("Test Med")).toBeInTheDocument();
	});

	it("displays generic name when available", () => {
		renderUserFilterModal();

		expect(screen.getByText("Generic Name")).toBeInTheDocument();
	});

	it("shows empty message when user has no medications", () => {
		renderUserFilterModal({ selectedUser: "Jane" });

		expect(screen.getByText(/modal\.noMedsForUser/i)).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		renderUserFilterModal({ onClose });

		const closeBtn = screen.getByText("×");
		fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when overlay clicked", () => {
		const onClose = vi.fn();
		renderUserFilterModal({ onClose });

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

		renderUserFilterModal({ onClose, onClearUser, onOpenMedDetail });

		const medItem = document.querySelector(".user-med-item");
		if (medItem) {
			fireEvent.click(medItem);
		}

		expect(onClearUser).toHaveBeenCalledTimes(1);
		expect(onOpenMedDetail).toHaveBeenCalledWith(mockMedication);
	});

	it("calls onClose when footer close button clicked", () => {
		const onClose = vi.fn();
		renderUserFilterModal({ onClose });

		const footerCloseBtn = screen.getByText(/common\.close/i);
		fireEvent.click(footerCloseBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when modal content clicked", () => {
		const onClose = vi.fn();
		renderUserFilterModal({ onClose });

		const content = document.querySelector(".modal-content");
		if (content) {
			fireEvent.click(content);
		}

		expect(onClose).not.toHaveBeenCalled();
	});

	it("filters medications by takenBy correctly", () => {
		const meds: Medication[] = [
			{ ...mockMedication, id: 1, name: "Med1", takenBy: ["John"] },
			{ ...mockMedication, id: 2, name: "Med2", takenBy: ["Jane"] },
			{ ...mockMedication, id: 3, name: "Med3", takenBy: ["john", "Jane"] },
		];

		renderUserFilterModal({ meds, coverage: { all: [] } });

		expect(screen.getByText("Med1")).toBeInTheDocument();
		expect(screen.queryByText("Med2")).not.toBeInTheDocument();
		expect(screen.getByText("Med3")).toBeInTheDocument();
	});

	it("renders tube intakes as applications and stock in g", () => {
		const tubeMedication: Medication = {
			...mockMedication,
			id: 10,
			name: "Tube Med",
			genericName: "Tube Generic",
			packageType: "tube",
			totalPills: 600,
			looseTablets: 600,
			intakes: [
				{
					usage: 1,
					every: 1,
					start: "2024-01-01T21:04:00",
					takenBy: "John",
					intakeRemindersEnabled: true,
				},
			],
		};

		const tubeCoverage: Coverage = {
			name: "Tube Med",
			medsLeft: 600,
			daysLeft: null,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		renderUserFilterModal({ meds: [tubeMedication], coverage: { all: [tubeCoverage] } });

		expect(screen.getByText(/form\.blisters\.applications_1/)).toBeInTheDocument();
		expect(screen.getByText("600/600 form.packageAmountUnitG")).toBeInTheDocument();
		expect(screen.queryByText(/600\/600 .*common\.pills/)).not.toBeInTheDocument();
	});

	it("shows liquid stock against configured multi-container capacity", () => {
		const liquidMedication: Medication = {
			...mockMedication,
			id: 13,
			name: "Liquid Multi",
			genericName: "Liquid Generic",
			packageType: "liquid_container",
			packCount: 4,
			packageAmountValue: 150,
			packageAmountUnit: "ml",
			totalPills: 450,
			looseTablets: 450,
			intakes: [
				{
					usage: 2,
					every: 1,
					start: "2024-01-01T09:32:00",
					intakeUnit: "ml",
					takenBy: "John",
					intakeRemindersEnabled: true,
				},
			],
		};

		const liquidCoverage: Coverage = {
			name: "Liquid Multi",
			medsLeft: 450,
			daysLeft: 30,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		renderUserFilterModal({ meds: [liquidMedication], coverage: { all: [liquidCoverage] } });

		expect(screen.getByText("450/600 form.packageAmountUnitMl")).toBeInTheDocument();
		expect(screen.queryByText("450/450 form.packageAmountUnitMl")).not.toBeInTheDocument();
	});

	it("renders liquid container intakes and stock in ml", () => {
		const liquidMedication: Medication = {
			...mockMedication,
			id: 11,
			name: "Liquid Container",
			genericName: "Liquid Generic",
			packageType: "liquid_container",
			totalPills: 150,
			looseTablets: 150,
			intakes: [
				{
					usage: 2,
					every: 1,
					start: "2024-01-01T09:32:00",
					intakeUnit: "ml",
					takenBy: "John",
					intakeRemindersEnabled: true,
				},
			],
		};

		const liquidCoverage: Coverage = {
			name: "Liquid Container",
			medsLeft: 0,
			daysLeft: 0,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		renderUserFilterModal({ meds: [liquidMedication], coverage: { all: [liquidCoverage] } });

		expect(screen.getByText(/2 form\.packageAmountUnitMl common\.daily/)).toBeInTheDocument();
		expect(screen.getByText("0/150 form.packageAmountUnitMl")).toBeInTheDocument();
		expect(screen.queryByText(/0\/150 .*common\.pills/)).not.toBeInTheDocument();
	});

	it("renders medicationForm liquid as ml in modal fallback", () => {
		const legacyLiquidMedication: Medication = {
			...mockMedication,
			id: 12,
			name: "Legacy Liquid",
			medicationForm: "liquid",
			packageType: "bottle",
			totalPills: 100,
			looseTablets: 100,
			blisters: [{ usage: 1, every: 1, start: "2024-01-01T10:00:00" }],
		};

		const legacyLiquidCoverage: Coverage = {
			name: "Legacy Liquid",
			medsLeft: 40,
			daysLeft: 10,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		renderUserFilterModal({ meds: [legacyLiquidMedication], coverage: { all: [legacyLiquidCoverage] } });

		expect(screen.getByText(/1 form\.packageAmountUnitMl common\.daily/)).toBeInTheDocument();
		expect(screen.getByText("40/100 form.packageAmountUnitMl")).toBeInTheDocument();
	});
});
