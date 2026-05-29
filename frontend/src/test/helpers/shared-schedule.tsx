import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { vi } from "vitest";
import { SharedSchedule } from "../../components/SharedSchedule";

export function renderSharedSchedule(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/share/:token" element={<SharedSchedule />} />
			</Routes>
		</MemoryRouter>
	);
}

export function mockSharedScheduleRead(sharedData: unknown, token = "token-123") {
	(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
		if (url === `/api/share/${token}/doses` && (!init?.method || init.method === "GET")) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
		}
		if (url === `/api/share/${token}`) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
		}
		return Promise.reject(new Error(`Unexpected URL: ${url}`));
	});
}
