import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportModal from "../../components/ReportModal";
import type { Medication } from "../../types";
import { formatDate, formatDateTime } from "../../utils/formatters";

const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({ authFetch: authFetchMock }),
}));

function getPreviewContent() {
	return screen.getByTestId("report-preview-content").textContent ?? "";
}

function expectPreviewToBeVisible() {
	expect(screen.getByTestId("report-preview")).toBeInTheDocument();
}

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

function createPersonFilterMedications(): Medication[] {
	return [
		createMedication({ id: 1, name: "Alice Med", takenBy: ["Alice"] }),
		createMedication({ id: 2, name: "Alice Lower", takenBy: ["alice"] }),
		createMedication({ id: 3, name: "Bob Med", takenBy: ["Bob"] }),
	];
}

function renderReportModal(options: { onClose?: () => void; medications?: Medication[] } = {}) {
	const onClose = options.onClose ?? vi.fn();
	const view = render(
		<ReportModal isOpen={true} onClose={onClose} medications={options.medications ?? [createMedication()]} />
	);

	return { ...view, onClose };
}

function getFirstReportRequestBody() {
	const [, requestInit] = authFetchMock.mock.calls[0] ?? [];
	return JSON.parse((requestInit?.body as string) ?? "{}");
}

describe("ReportModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	});

	it("renders and closes when cancel is clicked", () => {
		const onClose = vi.fn();
		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		expect(screen.getByText(/report\.title/i)).toBeInTheDocument();
		const closeButtons = screen.getAllByRole("button", { name: /common\.close/i });
		fireEvent.click(closeButtons[closeButtons.length - 1]);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("closes only the report modal when browser back is used", () => {
		const onClose = vi.fn();
		const parentPopState = vi.fn();
		window.addEventListener("popstate", parentPopState);

		try {
			render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

			act(() => {
				window.dispatchEvent(new PopStateEvent("popstate"));
			});

			expect(onClose).toHaveBeenCalledTimes(1);
			expect(parentPopState).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener("popstate", parentPopState);
		}
	});

	it("generates txt and md previews in-app without closing the modal", async () => {
		const onClose = vi.fn();
		for (const format of ["txt", "md"] as const) {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					1: {
						dosesTaken: 2,
						automaticDosesTaken: 0,
						dosesSkipped: 0,
						firstDoseAt: "2026-01-01T08:00:00.000Z",
						lastDoseAt: "2026-01-02T08:00:00.000Z",
						refills: [],
					},
				}),
			});

			const view = render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

			fireEvent.click(
				screen.getByRole("radio", { name: new RegExp(`report\\.format${format === "txt" ? "Txt" : "Md"}`, "i") })
			);
			fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

			await waitFor(() => {
				expectPreviewToBeVisible();
			});

			expect(screen.getByRole("button", { name: /report\.download/i })).toBeInTheDocument();
			expect(onClose).not.toHaveBeenCalled();
			expect(URL.createObjectURL).not.toHaveBeenCalled();
			expect(getPreviewContent()).toContain("report.docTitle");

			view.unmount();
		}
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
			expectPreviewToBeVisible();
		});

		const content = getPreviewContent();

		expect(content).toContain(formatDate("2026-02-01"));
		expect(content).toContain(formatDateTime("2026-02-02T08:30:00.000Z"));
		expect(content).toContain(formatDate("2026-02-03T12:00:00.000Z"));
		expect(onClose).not.toHaveBeenCalled();
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
			expectPreviewToBeVisible();
		});

		const content = getPreviewContent();

		expect(content).toContain("report.docTotalCapacity: 100");
		expect(content).toContain("report.docCurrentStock: 70 common.pills");
		expect(content).not.toContain("report.docCurrentStock: 100 common.pills");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("exports injection refill history with injection unit wording", async () => {
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
					refills: [
						{
							packsAdded: 1,
							loosePillsAdded: 0,
							quantityAdded: 3,
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
						packageType: "injection",
						totalPills: 6,
						looseTablets: 6,
					}),
				]}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expectPreviewToBeVisible();
		});

		const content = getPreviewContent();

		expect(content).toContain("report.docCurrentStock: 6 common.injections");
		expect(content).toContain("+3 common.injections");
		expect(onClose).not.toHaveBeenCalled();
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
							quantityAdded: 20,
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
		renderReportModal({ medications: createPersonFilterMedications() });

		expect(screen.getByText(/report\.filterByPerson/i)).toBeInTheDocument();
		expect(screen.getAllByRole("checkbox", { name: "Alice" })).toHaveLength(1);
		fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
		expect(screen.getByText("Alice Med")).toBeInTheDocument();
		expect(screen.getByText("Alice Lower")).toBeInTheDocument();
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

		const firstRender = renderReportModal({ onClose, medications: createPersonFilterMedications() });

		fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			const body = getFirstReportRequestBody();
			expect(body).toMatchObject({ medicationIds: [1, 2], takenByFilter: ["Alice"] });
			expect(typeof body.startDate).toBe("string");
			expect(typeof body.endDate).toBe("string");
		});

		authFetchMock.mockClear();
		(global.fetch as ReturnType<typeof vi.fn>).mockClear();
		firstRender.unmount();
		renderReportModal({ onClose, medications: createPersonFilterMedications() });
		fireEvent.click(screen.getByRole("radio", { name: /report\.formatTxt/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			const body = getFirstReportRequestBody();
			expect(body).toMatchObject({ medicationIds: [1, 2, 3] });
			expect(body).not.toHaveProperty("takenByFilter");
			expect(typeof body.startDate).toBe("string");
			expect(typeof body.endDate).toBe("string");
		});
	});

	it("shows a localized fetch error and keeps the modal open when preview generation fails", async () => {
		const onClose = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		fireEvent.click(screen.getByRole("radio", { name: /report\.formatMd/i }));
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith(
				"/api/medications/report-data",
				expect.objectContaining({ method: "POST" })
			);
		});

		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText(/report\.error/i)).toBeInTheDocument();
		expect(screen.queryByText(/report\.preview/i)).not.toBeInTheDocument();
	});

	it("shows a localized error and skips the request when the date range is invalid", async () => {
		const onClose = vi.fn();
		render(<ReportModal isOpen={true} onClose={onClose} medications={[createMedication()]} />);

		const inputs = screen.getAllByDisplayValue(/\d{2}\.\d{2}\.\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/i);
		const startInput = inputs[0] as HTMLInputElement;
		const endInput = inputs[1] as HTMLInputElement;

		fireEvent.change(startInput.parentElement?.querySelector("input") ?? startInput, {
			target: { value: "2026-02-10T10:00" },
		});
		fireEvent.change(endInput.parentElement?.querySelector("input") ?? endInput, {
			target: { value: "2026-02-10T09:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: /report\.generate/i }));

		expect(authFetchMock).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText(/report\.invalidDateRange/i)).toBeInTheDocument();
	});
});
