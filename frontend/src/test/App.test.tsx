import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

type AuthStateMock = {
	user: { id: number; username: string } | null;
	authState: { authEnabled: boolean; needsSetup: boolean } | null;
	loading: boolean;
	authError: string | null;
};

let authMock: AuthStateMock = {
	user: null,
	authState: { authEnabled: false, needsSetup: false },
	loading: false,
	authError: null,
};

let appContextMock: Record<string, unknown>;

vi.mock("../components", () => ({
	AboutModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>about-modal-open</div> : null),
	Lightbox: ({ src }: { src: string }) => <div>lightbox-open-{src}</div>,
	MedDetailModal: () => null,
	ProfileModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>profile-modal-open</div> : null),
	ShareDialog: () => null,
	SharedSchedule: () => <div>shared-schedule-page</div>,
	UserFilterModal: () => null,
}));

vi.mock("../components/AppHeader", () => ({
	AppHeader: ({ onOpenProfile, onOpenAbout }: { onOpenProfile: () => void; onOpenAbout: () => void }) => (
		<header>
			<span>app-header</span>
			<button onClick={onOpenProfile}>open-profile</button>
			<button onClick={onOpenAbout}>open-about</button>
		</header>
	),
}));

vi.mock("../components/Auth", () => ({
	AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	AuthPage: () => <div>auth-page</div>,
	useAuth: () => authMock,
}));

vi.mock("../context", () => ({
	AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useAppContext: () => appContextMock,
}));

vi.mock("../pages", () => ({
	DashboardPage: () => <div>dashboard-page</div>,
	MedicationsPage: () => <div>medications-page</div>,
	PlannerPage: () => <div>planner-page</div>,
	SchedulePage: () => <div>schedule-page</div>,
	SettingsPage: () => <div>settings-page</div>,
	SharedOverviewPage: () => <div>shared-overview-page</div>,
}));

describe("App", () => {
	beforeEach(() => {
		authMock = {
			user: null,
			authState: { authEnabled: false, needsSetup: false },
			loading: false,
			authError: null,
		};
		appContextMock = {
			meds: [],
			loadMeds: vi.fn(),
			settings: {},
			showRefillModal: false,
			setShowRefillModal: vi.fn(),
			refillPacks: 0,
			setRefillPacks: vi.fn(),
			refillLoose: 0,
			setRefillLoose: vi.fn(),
			refillSaving: false,
			refillHistory: [],
			refillHistoryExpanded: false,
			setRefillHistoryExpanded: vi.fn(),
			showEditStockModal: false,
			setShowEditStockModal: vi.fn(),
			editStockFullBlisters: 0,
			setEditStockFullBlisters: vi.fn(),
			editStockPartialBlisterPills: 0,
			setEditStockPartialBlisterPills: vi.fn(),
			editStockSaving: false,
			openRefillModal: vi.fn(),
			closeRefillModal: vi.fn(),
			openEditStockModal: vi.fn(),
			closeEditStockModal: vi.fn(),
			showShareDialog: false,
			sharePeople: [],
			shareSelectedPerson: "",
			setShareSelectedPerson: vi.fn(),
			shareSelectedDays: 7,
			setShareSelectedDays: vi.fn(),
			shareGenerating: false,
			shareLink: null,
			setShareLink: vi.fn(),
			shareCopied: false,
			setShareCopied: vi.fn(),
			generateShareLink: vi.fn(),
			copyShareLink: vi.fn(),
			closeShareDialog: vi.fn(),
			resetShareDialogState: vi.fn(),
			coverage: { all: [], low: [] },
			selectedMed: null,
			setSelectedMed: vi.fn(),
			showImageLightbox: false,
			setShowImageLightbox: vi.fn(),
			scheduleLightboxImage: null,
			setScheduleLightboxImage: vi.fn(),
			selectedUser: null,
			setSelectedUser: vi.fn(),
			openMedDetail: vi.fn(),
			closeMedDetail: vi.fn(),
			openImageLightbox: vi.fn(),
			closeImageLightbox: vi.fn(),
			closeScheduleLightbox: vi.fn(),
			closeUserFilter: vi.fn(),
			openShareDialog: vi.fn(),
			submitStockCorrection: vi.fn(),
			submitRefill: vi.fn(),
			stockThresholds: {
				lowStockDays: 7,
				normalStockDays: 30,
				highStockDays: 90,
				criticalStockDays: 7,
				expiryWarningDays: 30,
			},
		};
		document.documentElement.classList.remove("modal-open");
		document.body.classList.remove("modal-open");
		vi.spyOn(window.history, "back").mockImplementation(() => {});
		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
		vi.clearAllMocks();
	});

	it("renders public shared schedule route without auth", () => {
		render(
			<MemoryRouter initialEntries={["/share/test-token"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("shared-schedule-page")).toBeInTheDocument();
	});

	it("renders loading state while auth is being checked", () => {
		authMock = {
			user: null,
			authState: null,
			loading: true,
			authError: null,
		};

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("renders connection error state", () => {
		authMock = {
			user: null,
			authState: { authEnabled: false, needsSetup: false },
			loading: false,
			authError: "Backend is unreachable",
		};

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("Connection Error")).toBeInTheDocument();
		expect(screen.getByText("Backend is unreachable")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("reloads page when retry button is clicked", () => {
		authMock = {
			user: null,
			authState: { authEnabled: false, needsSetup: false },
			loading: false,
			authError: "Backend is unreachable",
		};

		const reloadSpy = vi.fn();
		Object.defineProperty(window, "location", {
			value: { ...window.location, reload: reloadSpy },
			writable: true,
		});

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(reloadSpy).toHaveBeenCalled();
	});

	it("renders auth page when setup is required", () => {
		authMock = {
			user: null,
			authState: { authEnabled: true, needsSetup: true },
			loading: false,
			authError: null,
		};

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("auth-page")).toBeInTheDocument();
	});

	it("renders auth page when auth is enabled and no user is logged in", () => {
		authMock = {
			user: null,
			authState: { authEnabled: true, needsSetup: false },
			loading: false,
			authError: null,
		};

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("auth-page")).toBeInTheDocument();
	});

	it("renders app shell when auth is disabled", () => {
		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("app-header")).toBeInTheDocument();
		expect(screen.getByText("dashboard-page")).toBeInTheDocument();
	});

	it("renders initializing state when auth state is missing", () => {
		authMock = {
			user: null,
			authState: null,
			loading: false,
			authError: null,
		};

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("Initializing...")).toBeInTheDocument();
	});

	it("renders schedule lightbox when schedule image is set", () => {
		appContextMock.scheduleLightboxImage = "med-image.png";

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("lightbox-open-med-image.png")).toBeInTheDocument();
	});

	it("handles popstate by closing selected medication", () => {
		appContextMock.selectedMed = { id: 1, packCount: 1, looseTablets: 0, updatedAt: null };

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		window.dispatchEvent(new PopStateEvent("popstate"));

		expect(appContextMock.setSelectedMed).toHaveBeenCalledWith(null);
	});

	it("adds modal-open class when modal state is active", () => {
		appContextMock.showShareDialog = true;

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		expect(document.documentElement.classList.contains("modal-open")).toBe(true);
		expect(document.body.classList.contains("modal-open")).toBe(true);
	});

	it("opens profile and about modals from header actions", () => {
		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: "open-profile" }));
		expect(screen.getByText("profile-modal-open")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "open-about" }));
		expect(screen.getByText("about-modal-open")).toBeInTheDocument();
		expect(window.history.pushState).toHaveBeenCalled();
	});

	it("handles popstate by resetting share dialog state", () => {
		appContextMock.showShareDialog = true;

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		window.dispatchEvent(new PopStateEvent("popstate"));
		expect(appContextMock.resetShareDialogState).toHaveBeenCalled();
	});

	it("redirects unknown routes to dashboard", () => {
		render(
			<MemoryRouter initialEntries={["/unknown-route"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("dashboard-page")).toBeInTheDocument();
	});

	it("popstate closes image lightbox before other modals", () => {
		appContextMock.showImageLightbox = true;
		appContextMock.scheduleLightboxImage = "img.png";

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		window.dispatchEvent(new PopStateEvent("popstate"));
		expect(appContextMock.setShowImageLightbox).toHaveBeenCalledWith(false);
		expect(appContextMock.setScheduleLightboxImage).not.toHaveBeenCalledWith(null);
	});

	it("popstate closes schedule lightbox when image lightbox is not open", () => {
		appContextMock.showImageLightbox = false;
		appContextMock.scheduleLightboxImage = "img.png";

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		window.dispatchEvent(new PopStateEvent("popstate"));
		expect(appContextMock.setScheduleLightboxImage).toHaveBeenCalledWith(null);
	});
});
