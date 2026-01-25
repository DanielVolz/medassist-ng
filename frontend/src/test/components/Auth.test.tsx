import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPage, AuthProvider, LoginForm, RegisterForm, UserProfile, useAuth } from "../../components/Auth";

// Wrapper component for testing hooks that require AuthProvider
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe("AuthProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ authEnabled: true, localAuthEnabled: true }),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("provides auth context to children", () => {
		render(
			<AuthProvider>
				<div data-testid="child">Child content</div>
			</AuthProvider>
		);
		expect(screen.getByTestId("child")).toBeInTheDocument();
	});

	it("initializes with loading state", () => {
		const { result } = renderHook(() => useAuth(), { wrapper });
		// Initially loading
		expect(result.current.loading).toBe(true);
	});

	it("fetches auth state on mount", async () => {
		renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith("/api/auth/state");
		});
	});

	it("fetches auth state only ONCE on mount (no infinite loop)", async () => {
		// This test catches the infinite loop bug where fetchAuthState was in useEffect dependencies
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ authEnabled: false }),
		});

		renderHook(() => useAuth(), { wrapper });

		// Wait for the initial fetch to complete
		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith("/api/auth/state");
		});

		// Wait a bit more to ensure no additional calls happen
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Should be called exactly once, not multiple times (which would indicate infinite loop)
		const authStateCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
			(call) => call[0] === "/api/auth/state"
		);
		expect(authStateCalls.length).toBe(1);
	});

	it("throws error when useAuth is used outside AuthProvider", () => {
		expect(() => {
			renderHook(() => useAuth());
		}).toThrow("useAuth must be used within AuthProvider");
	});
});

describe("LoginForm", () => {
	const mockAuthState = {
		authEnabled: true,
		localAuthEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
		hasUsers: true,
		needsSetup: false,
		oidcProviderName: "",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockAuthState),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});
	});

	it("renders login form", async () => {
		render(
			<AuthProvider>
				<LoginForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText(/MedAssist/i)).toBeInTheDocument();
		});
	});

	it("renders username and password fields", async () => {
		render(
			<AuthProvider>
				<LoginForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.username/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/auth\.password/i)).toBeInTheDocument();
		});
	});

	it("renders remember me checkbox", async () => {
		render(
			<AuthProvider>
				<LoginForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText(/auth\.rememberMe/i)).toBeInTheDocument();
		});
	});

	it("renders create account link when registration enabled", async () => {
		const onSwitchToRegister = vi.fn();

		render(
			<AuthProvider>
				<LoginForm onSwitchToRegister={onSwitchToRegister} />
			</AuthProvider>
		);

		await waitFor(() => {
			const createAccountBtn = screen.getByText(/auth\.createAccount/i);
			expect(createAccountBtn).toBeInTheDocument();
		});
	});

	it("handles form input changes", async () => {
		render(
			<AuthProvider>
				<LoginForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.username/i)).toBeInTheDocument();
		});

		fireEvent.change(screen.getByLabelText(/auth\.username/i), { target: { value: "testuser" } });
		fireEvent.change(screen.getByLabelText(/auth\.password/i), { target: { value: "password123" } });

		expect(screen.getByLabelText(/auth\.username/i)).toHaveValue("testuser");
		expect(screen.getByLabelText(/auth\.password/i)).toHaveValue("password123");
	});

	it("renders submit button", async () => {
		render(
			<AuthProvider>
				<LoginForm />
			</AuthProvider>
		);

		await waitFor(() => {
			const buttons = screen.getAllByRole("button");
			const submitBtn = buttons.find((btn) => btn.getAttribute("type") === "submit");
			expect(submitBtn).toBeInTheDocument();
		});
	});
});

describe("RegisterForm", () => {
	const mockAuthState = {
		authEnabled: true,
		localAuthEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
		hasUsers: false,
		needsSetup: true,
		oidcProviderName: "",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockAuthState),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});
	});

	it("renders registration form", async () => {
		render(
			<AuthProvider>
				<RegisterForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText(/MedAssist/i)).toBeInTheDocument();
		});
	});

	it("renders all required fields", async () => {
		render(
			<AuthProvider>
				<RegisterForm />
			</AuthProvider>
		);

		await waitFor(() => {
			// Check for username field
			expect(screen.getByLabelText(/auth\.username/i)).toBeInTheDocument();
			// Check for password field
			expect(screen.getByLabelText(/auth\.password/i)).toBeInTheDocument();
		});
	});

	it("renders switch to login link", async () => {
		const onSwitchToLogin = vi.fn();

		render(
			<AuthProvider>
				<RegisterForm onSwitchToLogin={onSwitchToLogin} />
			</AuthProvider>
		);

		await waitFor(() => {
			const loginLink = screen.getByText(/auth\.alreadyHaveAccount/i);
			expect(loginLink).toBeInTheDocument();
		});
	});

	it("calls onSwitchToLogin when clicked", async () => {
		const onSwitchToLogin = vi.fn();

		render(
			<AuthProvider>
				<RegisterForm onSwitchToLogin={onSwitchToLogin} />
			</AuthProvider>
		);

		await waitFor(() => {
			const loginLink = screen.getByText(/auth\.alreadyHaveAccount/i);
			fireEvent.click(loginLink);
		});

		expect(onSwitchToLogin).toHaveBeenCalled();
	});
});

describe("AuthPage", () => {
	const mockAuthState = {
		authEnabled: true,
		localAuthEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
		hasUsers: true,
		needsSetup: false,
		oidcProviderName: "",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockAuthState),
			})
			.mockResolvedValueOnce({
				status: 401,
				ok: false,
			});
	});

	it("renders login form by default", async () => {
		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			// Should show login form with username field
			expect(screen.getByLabelText(/auth\.username/i)).toBeInTheDocument();
		});
	});
});

describe("UserProfile", () => {
	const mockUser = {
		id: 1,
		username: "testuser",
		avatarUrl: null,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ authEnabled: true, localAuthEnabled: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockUser),
			});
	});

	it("renders user profile when user is logged in", async () => {
		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText("testuser")).toBeInTheDocument();
		});
	});

	it("displays user avatar initial when no avatar", async () => {
		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			// The avatar shows first letter of username
			expect(screen.getByText("T")).toBeInTheDocument();
		});
	});

	it("renders change password section", async () => {
		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText(/auth\.changePassword/i)).toBeInTheDocument();
		});
	});

	it("renders cancel button that calls onClose", async () => {
		const onClose = vi.fn();

		render(
			<AuthProvider>
				<UserProfile onClose={onClose} />
			</AuthProvider>
		);

		await waitFor(() => {
			const cancelBtn = screen.getByText(/common\.cancel/i);
			fireEvent.click(cancelBtn);
		});

		expect(onClose).toHaveBeenCalled();
	});
});
