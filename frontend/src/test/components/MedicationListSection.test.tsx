import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MedicationListSection } from "../../components/medications/MedicationListSection";
import type { Medication } from "../../types";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { count?: number; name?: string }) => {
			if (options?.name) return `${key} ${options.name}`;
			if (options?.count !== undefined) return `${key}_${options.count}`;
			return key;
		},
	}),
}));

function createMedication(overrides: Partial<Medication>): Medication {
	return {
		id: 1,
		name: "Photo Med",
		genericName: "",
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 0,
		totalPills: null,
		takenBy: [],
		intakes: [],
		blisters: [],
		intakeRemindersEnabled: false,
		notes: "",
		expiryDate: "",
		imageUrl: "photo.webp",
		updatedAt: "2026-06-20T10:00:00Z",
		...overrides,
	};
}

function renderSection(props: {
	orderedMeds: Medication[];
	obsoleteMeds?: Medication[];
	onImagePreview?: (med: Medication) => void;
	canRecordNow?: (med: Medication) => boolean;
	onRecordNow?: (med: Medication) => void;
}) {
	return render(
		<MedicationListSection
			orderedMeds={props.orderedMeds}
			obsoleteMeds={props.obsoleteMeds ?? []}
			editingId={null}
			showObsolete={false}
			coverageByMed={{}}
			onNewEntry={vi.fn()}
			onOpenReport={vi.fn()}
			onEdit={vi.fn()}
			canRecordNow={props.canRecordNow}
			onRecordNow={props.onRecordNow}
			onView={vi.fn()}
			onMarkObsolete={vi.fn()}
			onDelete={vi.fn()}
			onReactivate={vi.fn()}
			onToggleObsolete={vi.fn()}
			onImagePreview={props.onImagePreview ?? vi.fn()}
			getMedicationPackageTypeLabel={(med) => med.packageType}
			getMedicationStockSuffix={() => " pills"}
			getMedicationUsageUnitLabel={() => "pill"}
		/>
	);
}

describe("MedicationListSection", () => {
	it("exposes medication rows as named list items with unique action names", () => {
		renderSection({
			orderedMeds: [
				createMedication({ id: 1, name: "Aspirin", imageUrl: null }),
				createMedication({ id: 2, name: "Ibuprofen", imageUrl: null }),
			],
		});

		const medicationList = screen.getByRole("list", { name: "medications.list.title" });
		const rows = screen.getAllByRole("listitem");
		expect(medicationList).toContainElement(rows[0]);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveAccessibleName("Aspirin");
		expect(rows[1]).toHaveAccessibleName("Ibuprofen");
		expect(screen.getByRole("button", { name: "medications.list.actionEdit Aspirin" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "medications.list.actionEdit Ibuprofen" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "medications.list.actionDelete Aspirin" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "medications.list.actionDelete Ibuprofen" })).toBeInTheDocument();
	});

	it("labels and controls the collapsed obsolete medication list", () => {
		renderSection({
			orderedMeds: [],
			obsoleteMeds: [createMedication({ id: 3, name: "Old medication", isObsolete: true })],
		});

		const toggle = screen.getByRole("button", { name: "medications.list.obsoleteTitle_1" });
		const obsoleteList = document.getElementById("obsolete-medications-list");
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(toggle).toHaveAttribute("aria-controls", "obsolete-medications-list");
		expect(obsoleteList).toHaveAttribute("hidden");
		expect(toggle.querySelector("span")).toHaveAttribute("aria-hidden", "true");
	});

	it("shows no regular schedule when intakes are explicitly empty", () => {
		renderSection({
			orderedMeds: [
				createMedication({ intakes: [], blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }] }),
			],
		});

		expect(screen.getByText("form.blisters.noRegularSchedule")).toBeInTheDocument();
	});

	it("offers Take only when the page has confirmed an active zero-schedule medication", () => {
		const onRecordNow = vi.fn();
		const eligible = createMedication({ intakes: [] });
		const scheduled = createMedication({
			id: 2,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00", takenBy: "", intakeRemindersEnabled: false }],
		});
		renderSection({
			orderedMeds: [eligible, scheduled],
			canRecordNow: (med) => med.id === eligible.id,
			onRecordNow,
		});

		fireEvent.click(screen.getByRole("button", { name: "medications.list.actionRecordNow Photo Med" }));
		expect(onRecordNow).toHaveBeenCalledWith(eligible);
		expect(screen.getAllByText("form.blisters.noRegularSchedule")).toHaveLength(1);
	});

	it("opens the medication image preview from a clickable avatar", () => {
		const onImagePreview = vi.fn();
		const medication = createMedication({ id: 1, name: "Photo Med", imageUrl: "photo.webp" });

		renderSection({ orderedMeds: [medication], onImagePreview });
		fireEvent.click(screen.getByRole("button", { name: "medications.list.actionPreviewImage Photo Med" }));

		expect(onImagePreview).toHaveBeenCalledWith(medication, expect.any(HTMLButtonElement));
	});

	it("does not make medication avatars clickable when no image is available", () => {
		renderSection({ orderedMeds: [createMedication({ id: 2, name: "No Photo Med", imageUrl: null })] });

		expect(
			screen.queryByRole("button", { name: "medications.list.actionPreviewImage No Photo Med" })
		).not.toBeInTheDocument();
	});
});
