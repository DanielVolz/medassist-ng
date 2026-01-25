import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../../components/AppHeader";
import { AuthProvider } from "../../components/Auth";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
	const actual = await vi.importActual("react-router-dom");
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

describe("AppHeader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNavigate.mockClear();
		// Set up default auth mock - auth disabled
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: false,
						localAuthEnabled: true,
						hasUsers: false,
						needsSetup: false,
					}),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});
	});

	it("renders header with logo", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			const logo = screen.getByAltText("MedAssist-ng");
			expect(logo).toBeInTheDocument();
		});
	});

	it("renders navigation tabs", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			// Use getAllBy since there are multiple elements with same text
			const dashboardElements = screen.getAllByText(/nav\.dashboard/i);
			expect(dashboardElements.length).toBeGreaterThan(0);
		});
	});

	it("renders theme toggle button", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			const buttons = screen.getAllByRole("button");
			const themeBtn = buttons.find((btn) => btn.textContent?.includes("🌙") || btn.textContent?.includes("☀️"));
			expect(themeBtn).toBeInTheDocument();
		});
	});

	it("renders settings button when auth is disabled", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			const settingsBtn = screen.queryByTitle(/nav\.settings/i);
			expect(settingsBtn).toBeInTheDocument();
		});
	});

	it("shows page eyebrow and title", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.overview/i)).toBeInTheDocument();
		});
	});

	it("shows medications page title on medications route", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		// Reset mock for this test
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: false,
						localAuthEnabled: true,
						hasUsers: false,
						needsSetup: false,
					}),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});

		render(
			<MemoryRouter initialEntries={["/medications"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.inventory/i)).toBeInTheDocument();
		});
	});

	it("shows planner page title on planner route", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: false,
						localAuthEnabled: true,
						hasUsers: false,
						needsSetup: false,
					}),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});

		render(
			<MemoryRouter initialEntries={["/planner"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.planner/i)).toBeInTheDocument();
		});
	});

	it("shows settings page title on settings route", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: false,
						localAuthEnabled: true,
						hasUsers: false,
						needsSetup: false,
					}),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});

		render(
			<MemoryRouter initialEntries={["/settings"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.settings/i)).toBeInTheDocument();
		});
	});

	it("navigates when tab clicked", async () => {
		const mockOnOpenProfile = vi.fn();
		const mockOnOpenAbout = vi.fn();

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={mockOnOpenProfile} onOpenAbout={mockOnOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			const buttons = screen.getAllByRole("button");
			const medsBtn = buttons.find((btn) => btn.textContent?.includes("nav.medications"));
			if (medsBtn) {
				fireEvent.click(medsBtn);
				expect(mockNavigate).toHaveBeenCalledWith("/medications");
			}
		});
	});
});
