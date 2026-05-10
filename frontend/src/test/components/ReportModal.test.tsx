import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportModal from "../../components/ReportModal";
import type { Medication } from "../../types";
import { formatDate, formatDateTime } from "../../utils/formatters";

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
					dosesSkipped: 0,
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

	it("renders shared formatter output in exported text reports", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				1: {
					dosesTaken: 1,
					automaticDosesTaken: 0,
					dosesSkipped: 0,
					firstDoseAt: "2026-02-03T12:00:00.000Z",
					lastDoseAt: null,
					refills: [],
				},
			}),
		});

		render(
			<ReportModal
				isOpen={true}
				onClose={onClose}
				medications={[
					createMedication({
						medicationStartDate: "2026-02-01",
						blisters: [{ usage: 1, every: 1, start: "2026-02-02T08:30:00.000Z" }],
					}),
				]}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(URL.createObjectURL).toHaveBeenCalled();
		});

		const [blob] = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1) ?? [];
		expect(blob).toBeInstanceOf(Blob);

		const content = await (blob as Blob).text();

		expect(content).toContain(formatDate("2026-02-01"));
		expect(content).toContain(formatDateTime("2026-02-02T08:30:00.000Z"));
		expect(content).toContain(formatDate("2026-02-03T12:00:00.000Z"));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("exports bottle current stock separately from configured capacity", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				1: {
					dosesTaken: 0,
					automaticDosesTaken: 0,
					dosesSkipped: 0,
					firstDoseAt: null,
					lastDoseAt: null,
					refills: [],
				},
			}),
		});

		render(
			<ReportModal
				isOpen={true}
				onClose={onClose}
				medications={[
					createMedication({
						packageType: "bottle",
						packCount: 0,
						blistersPerPack: 1,
						pillsPerBlister: 1,
						totalPills: 100,
						looseTablets: 20,
						stockAdjustment: 50,
					}),
				]}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(URL.createObjectURL).toHaveBeenCalled();
		});

		const [blob] = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1) ?? [];
		const content = await (blob as Blob).text();

		expect(content).toContain("report.docTotalCapacity: 100");
		expect(content).toContain("report.docCurrentStock: 70 common.pills");
		expect(content).not.toContain("report.docCurrentStock: 100 common.pills");
		expect(onClose).toHaveBeenCalledTimes(1);
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
					dosesTaken: 1,
					automaticDosesTaken: 0,
					dosesSkipped: 0,
					firstDoseAt: "2026-03-03T12:00:00.000Z",
					lastDoseAt: null,
					refills: [
						{
							packsAdded: 1,
							loosePillsAdded: 0,
							usedPrescription: false,
							refillDate: "2026-03-04",
						},
					],
				},
			}),
		});

		render(
			<ReportModal
				isOpen={true}
				onClose={onClose}
				medications={[
					createMedication({
						medicationStartDate: "2026-03-01",
						blisters: [{ usage: 1, every: 1, start: "2026-03-02T08:30:00.000Z" }],
					}),
				]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(openSpy).toHaveBeenCalled();
			expect(mockWrite).toHaveBeenCalled();
			expect(mockClose).toHaveBeenCalled();
		});

		const [html] = mockWrite.mock.calls.at(-1) ?? [];
		expect(html).toContain(formatDate("2026-03-01"));
		expect(html).toContain(formatDateTime("2026-03-02T08:30:00.000Z"));
		expect(html).toContain(formatDate("2026-03-03T12:00:00.000Z"));
		expect(html).toContain(formatDate("2026-03-04"));
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

	it("sends the selected person filter with the report request and clears it for all people", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				1: {
					dosesTaken: 2,
					automaticDosesTaken: 0,
					dosesSkipped: 1,
					firstDoseAt: "2026-01-01T08:00:00.000Z",
					lastDoseAt: "2026-01-02T08:00:00.000Z",
					refills: [],
				},
				2: {
					dosesTaken: 1,
					automaticDosesTaken: 0,
					dosesSkipped: 0,
					firstDoseAt: "2026-01-01T08:00:00.000Z",
					lastDoseAt: "2026-01-02T08:00:00.000Z",
					refills: [],
				},
			}),
		});

		const firstRender = render(
			<ReportModal
				isOpen={true}
				onClose={onClose}
				medications={[
					createMedication({ id: 1, name: "Alice Med", takenBy: ["Alice"] }),
					createMedication({ id: 2, name: "Bob Med", takenBy: ["Bob"] }),
				]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/medications/report-data",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ medicationIds: [1], takenByFilter: ["Alice"] }),
				})
			);
		});

		(global.fetch as ReturnType<typeof vi.fn>).mockClear();
		firstRender.unmount();
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
		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/medications/report-data",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ medicationIds: [1, 2], takenByFilter: undefined }),
				})
			);
		});
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
