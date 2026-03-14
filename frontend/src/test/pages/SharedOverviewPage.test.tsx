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
				<Route path="/share/:token" element={<div>shared schedule target</div>} />
			</Routes>
		</MemoryRouter>
	);
}

describe("SharedOverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
	});

	it("redirects the legacy overview route to the normal shared schedule route", async () => {
		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("shared schedule target")).toBeInTheDocument();
		});
		expect(globalThis.fetch).not.toHaveBeenCalled();
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

	it("redirects even when the token would previously have been loaded from the overview route", async () => {
		renderSharedOverview("/share/abcdef0123456789/overview");

		await waitFor(() => {
			expect(screen.getByText("shared schedule target")).toBeInTheDocument();
		});
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
