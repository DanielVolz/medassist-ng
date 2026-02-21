import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportModal from "../../components/ReportModal";
import type { Medication } from "../../types";

function createMedication(overrides: Partial<Medication> = {}): Medication {
	return {
		id: 1,
		name: "Aspirin",
		genericName: "Acetylsalicylic acid",
		takenBy: ["Alice"],
		packageType: "blister",
		packCount: 2,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 0,
		blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z" }],
		updatedAt: null,
		...overrides,
	};
}

describe("ReportModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders and closes when cancel is clicked", () => {
		const onClose = vi.fn();
		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		expect(screen.getByText(/report\.title/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /common\.close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("generates text report and closes modal", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				1: {
					dosesTaken: 2,
					dosesDismissed: 0,
					firstDoseAt: "2026-01-01T08:00:00.000Z",
					lastDoseAt: "2026-01-02T08:00:00.000Z",
					refills: [],
				},
			}),
		});

		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/medications/report-data",
				expect.objectContaining({ method: "POST" })
			);
		});

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it("generates printable report when PDF format is selected", async () => {
		const onClose = vi.fn();
		const mockWrite = vi.fn();
		const mockClose = vi.fn();
		const mockPrint = vi.fn();
		const openSpy = vi.spyOn(window, "open").mockReturnValue({
			document: {
				write: mockWrite,
				close: mockClose,
			},
			onload: null,
			print: mockPrint,
		} as unknown as Window);

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				1: {
					dosesTaken: 0,
					dosesDismissed: 0,
					firstDoseAt: null,
					lastDoseAt: null,
					refills: [],
				},
			}),
		});

		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(openSpy).toHaveBeenCalled();
			expect(mockWrite).toHaveBeenCalled();
			expect(mockClose).toHaveBeenCalled();
		});

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("shows person filter and supports deselect/select all", () => {
		const onClose = vi.fn();
		render(
			<ReportModal
				isOpen={true}
				onClose={onClose}
				medications={[
					createMedication({ id: 1, name: "Alice Med", takenBy: ["Alice"] }),
					createMedication({ id: 2, name: "Bob Med", takenBy: ["Bob"] }),
				]}
			/>
		);

		expect(screen.getByText(/report\.filterByPerson/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
		expect(screen.getByText("Alice Med")).toBeInTheDocument();
		expect(screen.queryByText("Bob Med")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /report\.deselectAll/i }));
		expect(screen.getByRole("button", { name: /report\.generate/i })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: /report\.selectAll/i }));
		expect(screen.getByRole("button", { name: /report\.generate/i })).not.toBeDisabled();
	});

	it("generates markdown report and keeps modal open on fetch error", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatMd/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalled();
		});

		expect(onClose).not.toHaveBeenCalled();
	});
});
