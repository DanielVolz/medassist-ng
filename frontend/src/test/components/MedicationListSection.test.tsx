import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MedicationListSection } from "../../components/medications/MedicationListSection";
import type { Medication } from "../../types";

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
	onImagePreview?: (med: Medication) => void;
	canRecordNow?: (med: Medication) => boolean;
	onRecordNow?: (med: Medication) => void;
}) {
	return render(
		<MedicationListSection
			orderedMeds={props.orderedMeds}
			obsoleteMeds={[]}
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
	it("shows no regular schedule when intakes are explicitly empty", () => {
		renderSection({
			orderedMeds: [
				createMedication({ intakes: [], blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }] }),
			],
		});

		expect(screen.getByText("form.blisters.noRegularSchedule")).toBeInTheDocument();
	});

	it("offers Record now only when the page has confirmed an active zero-schedule medication", () => {
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

		fireEvent.click(screen.getByRole("button", { name: "asNeeded.record.action" }));
		expect(onRecordNow).toHaveBeenCalledWith(eligible);
		expect(screen.getAllByText("form.blisters.noRegularSchedule")).toHaveLength(1);
	});

	it("opens the medication image preview from a clickable avatar", () => {
		const onImagePreview = vi.fn();
		const medication = createMedication({ id: 1, name: "Photo Med", imageUrl: "photo.webp" });

		renderSection({ orderedMeds: [medication], onImagePreview });
		fireEvent.click(screen.getByRole("button", { name: "Photo Med" }));

		expect(onImagePreview).toHaveBeenCalledWith(medication);
	});

	it("does not make medication avatars clickable when no image is available", () => {
		renderSection({ orderedMeds: [createMedication({ id: 2, name: "No Photo Med", imageUrl: null })] });

		expect(screen.queryByRole("button", { name: "No Photo Med" })).not.toBeInTheDocument();
	});
});
