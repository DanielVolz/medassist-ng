import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../../components/AppHeader";
import { AuthProvider } from "../../components/Auth";

// Mock useNavigate
const mockNavigate = vi.fn();
const mockConfirmNavigation = vi.fn();
vi.mock("react-router-dom", async () => {
	const actual = await vi.importActual("react-router-dom");
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

// Mock useUnsavedChanges
vi.mock("../../context", () => ({
	useUnsavedChanges: () => ({
		setHasUnsavedChanges: vi.fn(),
		hasUnsavedChanges: false,
		confirmNavigation: mockConfirmNavigation,
	}),
}));

function mockAuthDisabled() {
	(global.fetch as ReturnType<typeof vi.fn>)
		.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					authEnabled: false,
					formLoginEnabled: true,
					needsSetup: false,
				}),
		})
		.mockResolvedValueOnce({
			status: 401,
			ok: false,
		});
}

function renderHeader(route = "/dashboard") {
	return render(
		<MemoryRouter initialEntries={[route]}>
			<AuthProvider>
				<AppHeader onOpenProfile={vi.fn()} onOpenAbout={vi.fn()} />
			</AuthProvider>
		</MemoryRouter>
	);
}

describe("AppHeader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNavigate.mockClear();
		mockConfirmNavigation.mockResolvedValue(true);
		// Set up default auth mock - auth disabled
		mockAuthDisabled();
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

	it("renders theme menu button", async () => {
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
			const themeBtn = screen.getByTitle(/theme\.title/i);
			expect(themeBtn).toBeInTheDocument();
		});
	});

	it("opens theme dropdown and shows Light/Dark/System options", async () => {
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
			const themeBtn = screen.getByTitle(/theme\.title/i);
			fireEvent.click(themeBtn);
		});

		expect(screen.getByText(/theme\.light/i)).toBeInTheDocument();
		expect(screen.getByText(/theme\.dark/i)).toBeInTheDocument();
		expect(screen.getByText(/theme\.system/i)).toBeInTheDocument();
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
		// Reset mock for this test
		vi.clearAllMocks();
		mockAuthDisabled();

		renderHeader("/medications");

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.inventory/i)).toBeInTheDocument();
		});
	});

	it("shows planner page title on planner route", async () => {
		vi.clearAllMocks();
		mockAuthDisabled();

		renderHeader("/planner");

		await waitFor(() => {
			expect(screen.getByText(/header\.eyebrow\.planner/i)).toBeInTheDocument();
		});
	});

	it("shows settings page title on settings route", async () => {
		vi.clearAllMocks();
		mockAuthDisabled();

		renderHeader("/settings");

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

	it("does not navigate when unsaved changes confirmation is denied", async () => {
		mockConfirmNavigation.mockResolvedValueOnce(false);

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={vi.fn()} onOpenAbout={vi.fn()} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			const buttons = screen.getAllByRole("button");
			const plannerBtn = buttons.find((btn) => btn.textContent?.includes("nav.planner"));
			expect(plannerBtn).toBeInTheDocument();
			if (plannerBtn) fireEvent.click(plannerBtn);
		});

		await waitFor(() => {
			expect(mockConfirmNavigation).toHaveBeenCalled();
			expect(mockNavigate).not.toHaveBeenCalledWith("/planner");
		});
	});

	it("renders authenticated user menu and handles profile/about/settings/logout actions", async () => {
		const onOpenProfile = vi.fn();
		const onOpenAbout = vi.fn();

		(global.fetch as ReturnType<typeof vi.fn>).mockReset();
		mockNavigate.mockClear();
		mockConfirmNavigation.mockResolvedValue(true);
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: true,
						registrationEnabled: true,
						formLoginEnabled: true,
						oidcEnabled: false,
						oidcProviderName: "",
						needsSetup: false,
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ id: 1, username: "tester", avatarUrl: null }),
			})
			.mockResolvedValueOnce({
				ok: true,
			});

		const { container } = render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AuthProvider>
					<AppHeader onOpenProfile={onOpenProfile} onOpenAbout={onOpenAbout} />
				</AuthProvider>
			</MemoryRouter>
		);

		await waitFor(() => {
			expect(container.querySelector(".user-menu-btn")).toBeInTheDocument();
		});

		// Settings icon should not be shown when auth is enabled
		expect(screen.queryByTitle(/nav\.settings/i)).not.toBeInTheDocument();

		const userMenuBtn = container.querySelector(".user-menu-btn") as HTMLButtonElement;
		fireEvent.click(userMenuBtn);
		fireEvent.click(screen.getByText(/auth\.profile/i));
		expect(onOpenProfile).toHaveBeenCalled();

		fireEvent.click(userMenuBtn);
		fireEvent.click(screen.getByText(/about\.title/i));
		expect(onOpenAbout).toHaveBeenCalled();

		fireEvent.click(userMenuBtn);
		fireEvent.click(screen.getByText(/^nav\.settings$/i));
		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/settings");
		});

		fireEvent.click(userMenuBtn);
		fireEvent.click(screen.getByText(/auth\.signOut/i));
		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith(
				"/api/auth/logout",
				expect.objectContaining({
					method: "POST",
					credentials: "include",
				})
			);
		});
	});
});
