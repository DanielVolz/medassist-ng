import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultBlister, defaultForm, defaultIntake, useMedicationForm } from "../../hooks/useMedicationForm";
import type { Medication } from "../../types";
import { toDateValue } from "../../utils/formatters";

const tMock = (key: string) => key;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: tMock,
	}),
}));

describe("defaultBlister", () => {
	it("creates a blister with default values", () => {
		const blister = defaultBlister();
		expect(blister.usage).toBe("1");
		expect(blister.every).toBe("1");
		expect(blister.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(blister.startTime).toMatch(/^\d{2}:\d{2}$/);
	});

	it("uses current date", () => {
		const blister = defaultBlister();
		expect(blister.startDate).toBe(toDateValue(new Date()));
	});
});

describe("defaultForm", () => {
	it("creates a form with default values", () => {
		const form = defaultForm();
		expect(form.name).toBe("");
		expect(form.genericName).toBe("");
		expect(form.takenBy).toEqual([]);
		expect(form.packageType).toBe("blister");
		expect(form.packCount).toBe("1");
		expect(form.blistersPerPack).toBe("1");
		expect(form.pillsPerBlister).toBe("1");
		expect(form.totalPills).toBe("");
		expect(form.looseTablets).toBe("0");
		expect(form.pillWeightMg).toBe("");
		expect(form.doseUnit).toBe("mg");
		expect(form.expiryDate).toBe("");
		expect(form.notes).toBe("");
		expect(form.intakeRemindersEnabled).toBe(false);
		expect(form.blisters).toHaveLength(1);
		expect(form.intakes).toHaveLength(1);
	});

	it("creates a blister in the form", () => {
		const form = defaultForm();
		expect(form.blisters).toHaveLength(1);
		expect(form.blisters[0].usage).toBe("1");
		expect(form.blisters[0].every).toBe("1");
	});

	it("creates an intake in the form", () => {
		const form = defaultForm();
		expect(form.intakes).toHaveLength(1);
		expect(form.intakes[0].usage).toBe("1");
		expect(form.intakes[0].every).toBe("1");
		expect(form.intakes[0].takenBy).toBe("");
		expect(form.intakes[0].intakeRemindersEnabled).toBe(false);
	});

	it("creates independent forms", () => {
		const form1 = defaultForm();
		const form2 = defaultForm();

		form1.name = "Test";
		expect(form2.name).toBe("");
	});

	it("creates independent blisters arrays", () => {
		const form1 = defaultForm();
		const form2 = defaultForm();

		form1.blisters.push(defaultBlister());
		expect(form2.blisters).toHaveLength(1);
	});

	it("creates independent takenBy arrays", () => {
		const form1 = defaultForm();
		const form2 = defaultForm();

		form1.takenBy.push("John");
		expect(form2.takenBy).toHaveLength(0);
	});

	it("creates independent intakes arrays", () => {
		const form1 = defaultForm();
		const form2 = defaultForm();

		form1.intakes.push(defaultIntake("Jane"));
		expect(form2.intakes).toHaveLength(1);
	});
});

describe("defaultIntake", () => {
	it("creates an intake with default values", () => {
		const intake = defaultIntake();
		expect(intake.usage).toBe("1");
		expect(intake.every).toBe("1");
		expect(intake.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(intake.startTime).toMatch(/^\d{2}:\d{2}$/);
		expect(intake.takenBy).toBe("");
		expect(intake.intakeRemindersEnabled).toBe(false);
	});

	it("accepts a prefilled takenBy value", () => {
		const intake = defaultIntake("Alex");
		expect(intake.takenBy).toBe("Alex");
	});
});

describe("useMedicationForm", () => {
	it("initializes with default state", async () => {
		const { result } = renderHook(() => useMedicationForm());

		expect(result.current.form.name).toBe("");
		expect(result.current.editingId).toBeNull();
		expect(result.current.formChanged).toBe(false);

		await waitFor(() => {
			expect(result.current.fieldErrors.name).toBe("common.validation.nameOrGenericRequired");
			expect(result.current.hasValidationErrors).toBe(true);
		});
	});

	it("validates name required and max length fields", () => {
		const { result } = renderHook(() => useMedicationForm());

		// Cross-field validation: empty name alone returns no per-field error
		expect(result.current.validateField("name", "")).toBeUndefined();
		expect(result.current.validateField("takenBy", ["Alice"])).toBeUndefined();

		const tooLongGeneric = "a".repeat(101);
		const maxLengthError = result.current.validateField("genericName", tooLongGeneric);
		expect(maxLengthError).toBe("common.validation.maxLength");
	});

	it("updates form values and tracks changed state", async () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.handleValueChange("name", "Aspirin");
		});

		expect(result.current.form.name).toBe("Aspirin");
		expect(result.current.formChanged).toBe(true);

		await waitFor(() => {
			expect(result.current.fieldErrors.name).toBeUndefined();
		});
	});

	it("enforces liquid defaults when packageType is liquid_container", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.handleValueChange("packageType", "liquid_container");
		});

		expect(result.current.form.packageType).toBe("liquid_container");
		expect(result.current.form.medicationForm).toBe("liquid");
		expect(result.current.form.lifecycleCategory).toBe("refill_when_empty");
		expect(result.current.form.doseUnit).toBe("ml");
		expect(result.current.form.packageAmountUnit).toBe("ml");
	});

	it("keeps liquid settings locked when editing medicationForm under liquid_container", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.handleValueChange("packageType", "liquid_container");
			result.current.handleValueChange("medicationForm", "tablet");
		});

		expect(result.current.form.packageType).toBe("liquid_container");
		expect(result.current.form.medicationForm).toBe("liquid");
		expect(result.current.form.doseUnit).toBe("ml");
		expect(result.current.form.packageAmountUnit).toBe("ml");
	});

	it("enforces tube defaults and locks amount unit to grams", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.handleValueChange("packageType", "tube");
			result.current.handleValueChange("medicationForm", "liquid");
			result.current.handleValueChange("packageAmountUnit", "ml");
		});

		expect(result.current.form.packageType).toBe("tube");
		expect(result.current.form.medicationForm).toBe("topical");
		expect(result.current.form.lifecycleCategory).toBe("treatment_period");
		expect(result.current.form.doseUnit).toBe("units");
		expect(result.current.form.packageAmountUnit).toBe("g");
	});

	it("normalizes legacy tube records to grams in startEdit", () => {
		const { result } = renderHook(() => useMedicationForm());
		const openEditModal = vi.fn();
		Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });

		const med: Medication = {
			id: 12,
			name: "Topical Gel",
			takenBy: [],
			packageType: "tube",
			packageAmountUnit: "ml",
			packageAmountValue: 150,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 0,
			blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z" }],
			updatedAt: null,
		};

		act(() => {
			result.current.startEdit(med, openEditModal);
		});

		expect(result.current.form.packageType).toBe("tube");
		expect(result.current.form.packageAmountUnit).toBe("g");
	});

	it("adds, edits and removes blister rows", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.addBlister();
		});
		expect(result.current.form.blisters).toHaveLength(2);

		act(() => {
			result.current.setBlisterValue(1, "usage", "3");
			result.current.setBlisterValue(1, "every", "2");
		});
		expect(result.current.form.blisters[1].usage).toBe("3");
		expect(result.current.form.blisters[1].every).toBe("2");

		act(() => {
			result.current.removeBlister(0);
		});
		expect(result.current.form.blisters).toHaveLength(1);
	});

	it("adds, edits and removes intake rows", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.addIntake("Max");
		});
		expect(result.current.form.intakes).toHaveLength(2);
		expect(result.current.form.intakes[1].takenBy).toBe("Max");

		act(() => {
			result.current.setIntakeValue(1, "usage", "2.5");
			result.current.setIntakeValue(1, "intakeRemindersEnabled", true);
		});
		expect(result.current.form.intakes[1].usage).toBe("2.5");
		expect(result.current.form.intakes[1].intakeRemindersEnabled).toBe(true);

		act(() => {
			result.current.removeIntake(0);
		});
		expect(result.current.form.intakes).toHaveLength(1);
	});

	it("handles takenBy tag input add/remove and deduplication", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.addTakenByPerson("  Alice  ");
		});

		act(() => {
			result.current.addTakenByPerson("Alice");
			result.current.addTakenByPerson("");
		});

		expect(result.current.form.takenBy).toEqual(["Alice"]);

		act(() => {
			result.current.removeTakenByPerson("Alice");
		});
		expect(result.current.form.takenBy).toEqual([]);
	});

	it("handles takenBy keyboard shortcuts (Enter, comma, Backspace)", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.setTakenByInput("Bob");
		});

		const preventDefault = vi.fn();
		act(() => {
			result.current.handleTakenByKeyDown({
				key: "Enter",
				preventDefault,
			} as unknown as React.KeyboardEvent<HTMLInputElement>);
		});

		expect(preventDefault).toHaveBeenCalled();
		expect(result.current.form.takenBy).toContain("Bob");

		act(() => {
			result.current.setTakenByInput("Cara");
		});

		act(() => {
			result.current.handleTakenByKeyDown({
				key: ",",
				preventDefault,
			} as unknown as React.KeyboardEvent<HTMLInputElement>);
		});
		expect(result.current.form.takenBy).toContain("Cara");

		act(() => {
			result.current.setTakenByInput("");
			result.current.handleTakenByKeyDown({
				key: "Backspace",
				preventDefault,
			} as unknown as React.KeyboardEvent<HTMLInputElement>);
		});
		expect(result.current.form.takenBy).toEqual(["Bob"]);
	});

	it("maps medication with intakes in startEdit and opens modal on mobile", () => {
		const { result } = renderHook(() => useMedicationForm());
		const openEditModal = vi.fn();
		Object.defineProperty(window, "innerWidth", { value: 375, writable: true });

		const med: Medication = {
			id: 10,
			name: "Ibuprofen",
			genericName: "Ibuprofen",
			takenBy: ["Max"],
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
			pillWeightMg: 400,
			doseUnit: "mg",
			expiryDate: "2027-01-01",
			notes: "note",
			intakeRemindersEnabled: true,
			blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z" }],
			intakes: [
				{
					usage: 2,
					every: 1,
					start: "2026-01-02T09:00:00.000Z",
					takenBy: "Max",
					intakeRemindersEnabled: true,
				},
			],
			updatedAt: null,
		};

		act(() => {
			result.current.startEdit(med, openEditModal);
		});

		expect(result.current.editingId).toBe(10);
		expect(result.current.formSaved).toBe(true);
		expect(result.current.form.intakes[0].takenBy).toBe("Max");
		expect(openEditModal).toHaveBeenCalled();
	});

	it("falls back to legacy blisters when intakes are missing", () => {
		const { result } = renderHook(() => useMedicationForm());
		const openEditModal = vi.fn();
		Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });

		const med: Medication = {
			id: 11,
			name: "Legacy Med",
			takenBy: [],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 8,
			looseTablets: 0,
			blisters: [
				{ usage: 1, every: 2, start: "2026-01-03T10:00:00.000Z" },
				{ usage: 2, every: 1, start: "2026-01-04T12:00:00.000Z" },
			],
			intakeRemindersEnabled: true,
			updatedAt: null,
		};

		act(() => {
			result.current.startEdit(med, openEditModal);
		});

		expect(result.current.form.intakes).toHaveLength(2);
		expect(result.current.form.intakes[0].takenBy).toBe("");
		expect(result.current.form.intakes[0].intakeRemindersEnabled).toBe(true);
		expect(openEditModal).not.toHaveBeenCalled();
	});

	it("resets complete form state", () => {
		const { result } = renderHook(() => useMedicationForm());

		act(() => {
			result.current.setEditingId(5);
			result.current.setShowEditModal(true);
			result.current.setPendingImage(new File(["x"], "image.png", { type: "image/png" }));
			result.current.setPendingImagePreview("data:image/png;base64,abc");
			result.current.setFormSaved(true);
			result.current.setTakenByInput("X");
			result.current.handleValueChange("name", "Changed");
		});

		act(() => {
			result.current.resetForm();
		});

		expect(result.current.editingId).toBeNull();
		expect(result.current.showEditModal).toBe(false);
		expect(result.current.pendingImage).toBeNull();
		expect(result.current.pendingImagePreview).toBeNull();
		expect(result.current.takenByInput).toBe("");
		expect(result.current.formSaved).toBe(false);
		expect(result.current.form.name).toBe("");
		expect(result.current.formChanged).toBe(false);
	});
});
