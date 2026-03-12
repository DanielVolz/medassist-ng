import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "../../i18n/de.json";
import en from "../../i18n/en.json";
import { SharedOverviewPage } from "../../pages/SharedOverviewPage";

function renderSharedOverview(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/share/:token/overview" element={<SharedOverviewPage />} />
			</Routes>
		</MemoryRouter>
	);
}

describe("SharedOverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
	});

	it("renders medication overview for valid token", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					takenBy: "Max",
					sharedBy: "Owner",
					generatedAt: "2026-03-06T10:00:00.000Z",
					medications: [
						{
							name: "Aspirin",
							genericName: "Acetylsalicylic Acid",
							imageUrl: null,
							packageType: "blister",
							packCount: 1,
							blistersPerPack: 2,
							pillsPerBlister: 10,
							totalPills: null,
							looseTablets: 0,
							currentStock: 18,
							capacity: 20,
							daysLeft: 18,
							nextIntakeDate: "2026-03-07",
							depletionDate: "2026-03-24",
							priority: "normal",
							expiryDate: null,
							medicationStartDate: null,
							prescriptionEnabled: false,
							prescriptionRemainingRefills: null,
						},
					],
				}),
		});

		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("sharedOverview.title")).toBeInTheDocument();
			expect(screen.getAllByText("Aspirin").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Acetylsalicylic Acid").length).toBeGreaterThan(0);
		});

		const headerPair = document.querySelector(".shared-overview-table .date-pair-stack-header");
		expect(headerPair).toBeInTheDocument();
		expect(headerPair).toHaveTextContent("sharedOverview.columns.nextIntake");
		expect(headerPair).toHaveTextContent("sharedOverview.columns.depletion");

		const rowPair = document.querySelector(".shared-overview-table .date-pair-stack");
		expect(rowPair).toBeInTheDocument();

		const rowEntries = Array.from(rowPair?.querySelectorAll(".date-pair-entry") ?? []);
		expect(rowEntries).toHaveLength(2);
		expect(rowEntries[0]).toHaveTextContent("sharedOverview.columns.nextIntake");
		expect(rowEntries[1]).toHaveTextContent("sharedOverview.columns.depletion");
		expect(screen.getAllByText("sharedOverview.columns.daysLeft")).toHaveLength(2);
		expect(screen.getByText("sharedOverview.columns.priority")).toBeInTheDocument();
		expect(screen.getAllByText("sharedOverview.priority.normal")).toHaveLength(2);

		expect(globalThis.fetch).toHaveBeenCalledWith("/api/share/abcdef0123456789/overview");
	});

	it("keeps the updated shared overview stock wording in English and German", () => {
		expect(en.sharedOverview.columns.daysLeft).toBe("Estimated days left");
		expect(en.sharedOverview.columns.priority).toBe("Stock alert");
		expect(en.sharedOverview.priority.normal).toBe("Stock OK");
		expect(en.sharedOverview.priority.high).toBe("Low stock");

		expect(de.sharedOverview.columns.daysLeft).toBe("Geschätzte Resttage");
		expect(de.sharedOverview.columns.priority).toBe("Bestandswarnung");
		expect(de.sharedOverview.priority.normal).toBe("Bestand ok");
		expect(de.sharedOverview.priority.high).toBe("Niedriger Bestand");
	});

	it("renders not found state for missing token", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: false,
			status: 404,
			json: () => Promise.resolve({ error: "not_found" }),
		});

		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("sharedOverview.error.notFound")).toBeInTheDocument();
		});
	});

	it("renders expired state for expired token", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: false,
			status: 410,
			json: () => Promise.resolve({ error: "expired", expiredAt: "2026-03-01T10:00:00.000Z" }),
		});

		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("sharedOverview.error.expired")).toBeInTheDocument();
			expect(screen.getByText("sharedOverview.expiredOn")).toBeInTheDocument();
		});
	});

	it("renders rate-limit error state", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: false,
			status: 429,
			json: () => Promise.resolve({ error: "rate_limited" }),
		});

		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("sharedOverview.error.rateLimit")).toBeInTheDocument();
		});
	});
});
