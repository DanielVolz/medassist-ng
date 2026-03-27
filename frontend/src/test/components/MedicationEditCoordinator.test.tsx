import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { MedicationEditCoordinator } from "../../components/medications/MedicationEditCoordinator";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

describe("MedicationEditCoordinator", () => {
	it("renders new-entry header and closes via back action", () => {
		const onBack = vi.fn();
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

		render(
			<MedicationEditCoordinator
				viewMode="grid"
				editingId={null}
				readOnlyView={false}
				onBack={onBack}
				onSubmit={onSubmit}
			>
				<div>content</div>
			</MedicationEditCoordinator>
		);

		expect(screen.getByText("form.newEntry")).toBeInTheDocument();
		expect(document.querySelector(".edit-sidebar.open")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "<- common.back" }));
		expect(onBack).toHaveBeenCalledTimes(1);

		fireEvent.submit(document.querySelector("form") as HTMLFormElement);
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("renders edit header for editable and read-only flows", () => {
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

		const { rerender } = render(
			<MedicationEditCoordinator
				viewMode="form"
				editingId={42}
				readOnlyView={false}
				selectedMedicationName="Aspirin"
				onBack={vi.fn()}
				onSubmit={onSubmit}
			>
				<div>content</div>
			</MedicationEditCoordinator>
		);

		expect(document.querySelector(".edit-sidebar.open")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "form.editEntry: Aspirin" })).toBeInTheDocument();

		rerender(
			<MedicationEditCoordinator
				viewMode="form"
				editingId={42}
				readOnlyView={true}
				selectedMedicationName="Aspirin"
				onBack={vi.fn()}
				onSubmit={onSubmit}
			>
				<div>content</div>
			</MedicationEditCoordinator>
		);

		expect(screen.getByRole("heading", { name: "form.viewEntry: Aspirin" })).toBeInTheDocument();
	});
});
