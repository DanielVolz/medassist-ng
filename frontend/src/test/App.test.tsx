import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const appTranslations: Record<string, string> = {
	"auth.connectionErrorTitle": "Connection Error",
	"auth.connectionErrorHelp": "Please check if the server is running and try again.",
	"common.initializing": "Initializing...",
	"common.loading": "Loading...",
	"common.retry": "Retry",
};

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => appTranslations[key] ?? key,
			i18n: {
				language: "en",
				changeLanguage: vi.fn(),
			},
		}),
	};
});

type AuthStateMock = {
	user: { id: number; username: string } | null;
	authState: { authEnabled: boolean; needsSetup: boolean } | null;
	loading: boolean;
	authError: string | null;
	sessionExpired?: boolean;
};

let authMock: AuthStateMock = {
	user: null,
	authState: { authEnabled: false, needsSetup: false },
	loading: false,
	authError: null,
	sessionExpired: false,
};

let appContextMock: Record<string, unknown>;
let shareContextMock: Record<string, unknown>;

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

vi.mock("../context", async () => {
	const actual = await vi.importActual<typeof import("../context")>("../context");
	return {
		...actual,
		AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		ShareContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useAppContext: () => appContextMock,
		useShareContext: () => shareContextMock,
	};
});

vi.mock("../pages/DashboardPage", () => ({
	DashboardPage: () => {
		const location = useLocation();
		return (
			<div>
				<span>dashboard-page</span>
				<span data-testid="dashboard-location-search">{location.search}</span>
			</div>
		);
	},
}));

vi.mock("../pages/MedicationsPage", () => ({
	MedicationsPage: () => <div>medications-page</div>,
}));

vi.mock("../pages/PlannerPage", () => ({
	PlannerPage: () => <div>planner-page</div>,
}));

vi.mock("../pages/SchedulePage", () => ({
	SchedulePage: () => <div>schedule-page</div>,
}));

vi.mock("../pages/SettingsPage", () => ({
	SettingsPage: () => <div>settings-page</div>,
}));

vi.mock("../pages/SharedOverviewPage", () => ({
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
		shareContextMock = {
			showShareDialog: false,
			sharePeople: [],
			shareSelectedPerson: "",
			setShareSelectedPerson: vi.fn(),
			shareSelectedDays: 7,
			setShareSelectedDays: vi.fn(),
			shareSelectedExpiryDays: null,
			setShareSelectedExpiryDays: vi.fn(),
			shareAllowJournalNotes: false,
			setShareAllowJournalNotes: vi.fn(),
			shareGenerating: false,
			shareLink: null,
			setShareLink: vi.fn(),
			shareCopied: false,
			setShareCopied: vi.fn(),
			activeShareLinks: [],
			activeSharesLoading: false,
			revokingShareToken: null,
			generateShareLink: vi.fn(),
			revokeShareLink: vi.fn(),
			copyShareLink: vi.fn(),
			closeShareDialog: vi.fn(),
			resetShareDialogState: vi.fn(),
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
		expect(screen.getByText("Please check if the server is running and try again.")).toBeInTheDocument();
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

	it("renders app shell when auth is disabled", async () => {
		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		expect(screen.getByText("app-header")).toBeInTheDocument();
		expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
	});

	it("preserves notification query params when redirecting root to dashboard", async () => {
		const search = "?date=2026-05-06&medId=4332&doseId=4332-0-1778104500000";

		render(
			<MemoryRouter initialEntries={[`/${search}`]}>
				<App />
			</MemoryRouter>
		);

		expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
		expect(await screen.findByTestId("dashboard-location-search")).toHaveTextContent(search);
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
		shareContextMock.showShareDialog = true;

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
		shareContextMock.showShareDialog = true;

		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<App />
			</MemoryRouter>
		);

		window.dispatchEvent(new PopStateEvent("popstate"));
		expect(shareContextMock.resetShareDialogState).toHaveBeenCalled();
	});

	it("redirects unknown routes to dashboard", async () => {
		render(
			<MemoryRouter initialEntries={["/unknown-route"]}>
				<App />
			</MemoryRouter>
		);

		expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
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
