import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPage, AuthProvider, LoginForm, RegisterForm, UserProfile, useAuth } from "../../components/Auth";

// Wrapper component for testing hooks that require AuthProvider
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

function renderUserProfile(onClose?: () => void) {
	return render(
		<AuthProvider>
			<UserProfile onClose={onClose} />
		</AuthProvider>
	);
}

async function waitForUserProfile() {
	await waitFor(() => {
		expect(screen.getByText("testuser")).toBeInTheDocument();
	});
}

async function openDeleteAccountConfirmation() {
	await waitForUserProfile();
	const dangerButtons = screen.getAllByRole("button", { name: /auth\.deleteAccount/i });
	fireEvent.click(dangerButtons[0]);

	await waitFor(() => {
		expect(screen.getByRole("button", { name: /auth\.deleteAccountButton/i })).toBeInTheDocument();
	});
}

function getUsernameInput() {
	return screen.getByRole("textbox", { name: /auth\.(username|emailOrUsername)/i });
}

describe("AuthProvider", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
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
			expect(fetch).toHaveBeenCalledWith("/api/auth/state", expect.anything());
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
			expect(fetch).toHaveBeenCalledWith("/api/auth/state", expect.anything());
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

	it("authFetch retries original request after token refresh", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ authEnabled: false, formLoginEnabled: true }),
			})
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValueOnce({ ok: true, status: 200 })
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: true }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		const response = await result.current.authFetch("/api/medications", { method: "GET" });

		expect(response.ok).toBe(true);
		expect(fetch).toHaveBeenNthCalledWith(
			2,
			"/api/medications",
			expect.objectContaining({ method: "GET", credentials: "include" })
		);
		expect(fetch).toHaveBeenNthCalledWith(
			3,
			"/api/auth/refresh",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
		expect(fetch).toHaveBeenNthCalledWith(
			4,
			"/api/medications",
			expect.objectContaining({ method: "GET", credentials: "include" })
		);
	});

	it("authFetch adds a correlation id to authenticated API requests", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ authEnabled: false, formLoginEnabled: true }),
			})
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: true }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await result.current.authFetch("/api/medications", { method: "GET" });

		const requestInit = (fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] as RequestInit;
		expect(new Headers(requestInit.headers).get("x-correlation-id")).toMatch(/^fe-api-/);
	});

	it("authFetch logs user out when refresh fails", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }),
			})
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 1, username: "tester" }) })
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValueOnce({ ok: false, status: 401 });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.user?.username).toBe("tester");
		});

		await result.current.authFetch("/api/medications");

		await waitFor(() => {
			expect(result.current.user).toBeNull();
			expect(result.current.sessionExpired).toBe(true);
		});
	});

	it("runs periodic token refresh when authenticated", async () => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }),
			})
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "timer-user" }) })
			.mockResolvedValueOnce({ ok: true, status: 200 });

		renderHook(() => useAuth(), { wrapper });

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/refresh",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
		vi.useRealTimers();
	});
});

describe("LoginForm", () => {
	const mockAuthState = {
		authEnabled: true,
		formLoginEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
		needsSetup: false,
		oidcProviderName: "",
	};

	afterEach(() => {
		window.history.replaceState({}, "", "/");
	});

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
			expect(getUsernameInput()).toBeInTheDocument();
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
			expect(getUsernameInput()).toBeInTheDocument();
		});

		fireEvent.change(getUsernameInput(), { target: { value: "testuser" } });
		fireEvent.change(screen.getByLabelText(/auth\.password/i), { target: { value: "password123" } });

		expect(getUsernameInput()).toHaveValue("testuser");
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

	it("submits login form and calls onSuccess", async () => {
		vi.clearAllMocks();
		const onSuccess = vi.fn();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						authEnabled: false,
						formLoginEnabled: true,
						oidcEnabled: false,
						registrationEnabled: true,
						needsSetup: false,
						oidcProviderName: "",
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ user: { id: 1, username: "testuser" } }),
			});

		render(
			<AuthProvider>
				<LoginForm onSuccess={onSuccess} />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(getUsernameInput()).toBeInTheDocument();
		});

		fireEvent.change(getUsernameInput(), { target: { value: "testuser" } });
		fireEvent.change(screen.getByLabelText(/auth\.password/i), { target: { value: "password123" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.login/i }));

		await waitFor(() => {
			expect(onSuccess).toHaveBeenCalled();
		});
	});
});

describe("RegisterForm", () => {
	const mockAuthState = {
		authEnabled: true,
		formLoginEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
		needsSetup: true,
		oidcProviderName: "",
	};

	beforeEach(() => {
		vi.resetAllMocks();
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
			expect(getUsernameInput()).toBeInTheDocument();
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

	it("shows password mismatch error and does not submit", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					authEnabled: true,
					formLoginEnabled: true,
					oidcEnabled: false,
					registrationEnabled: true,
					needsSetup: true,
					oidcProviderName: "",
				}),
		});

		render(
			<AuthProvider>
				<RegisterForm />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(getUsernameInput()).toBeInTheDocument();
		});

		fireEvent.change(getUsernameInput(), { target: { value: "new-user" } });
		fireEvent.change(screen.getByLabelText(/auth\.email/i), { target: { value: "new-user@example.com" } });
		fireEvent.change(screen.getByLabelText(/auth\.password/i), { target: { value: "password123" } });
		fireEvent.change(screen.getByLabelText(/auth\.confirmPassword/i), { target: { value: "different123" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.register/i }));

		await waitFor(() => {
			expect(screen.getByText(/auth\.passwordMismatch/i)).toBeInTheDocument();
		});

		expect(fetch).not.toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ method: "POST" }));
	});
});

describe("AuthPage", () => {
	const mockAuthState = {
		authEnabled: true,
		formLoginEnabled: true,
		oidcEnabled: false,
		registrationEnabled: true,
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
			expect(getUsernameInput()).toBeInTheDocument();
		});
	});

	it("switches to register mode when create account is clicked", async () => {
		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /auth\.createAccount/i })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /auth\.createAccount/i }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^auth\.register$/i })).toBeInTheDocument();
		});
	});

	it("submits a generic password-recovery request when the capability is enabled", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ ...mockAuthState, passwordResetEnabled: true }),
			})
			.mockResolvedValueOnce({ status: 401, ok: false })
			.mockResolvedValueOnce({ ok: true });

		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /auth\.forgotPassword/i })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /auth\.forgotPassword/i }));
		fireEvent.change(screen.getByLabelText(/auth\.emailOrUsername/i), { target: { value: "user@example.com" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.sendResetLink/i }));

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith("/api/auth/forgot-password", expect.objectContaining({ method: "POST" }));
		});
		expect(screen.getByText(/auth\.resetEmailSent/i)).toBeInTheDocument();
	});

	it("disables forgot-password submit while its request is in flight", async () => {
		let resolveForgotPassword: (value: { ok: boolean }) => void;
		const forgotPasswordRequest = new Promise<{ ok: boolean }>((resolve) => {
			resolveForgotPassword = resolve;
		});
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ ...mockAuthState, passwordResetEnabled: true }),
			})
			.mockResolvedValueOnce({ status: 401, ok: false })
			.mockReturnValueOnce(forgotPasswordRequest);

		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /auth\.forgotPassword/i })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /auth\.forgotPassword/i }));
		fireEvent.change(screen.getByLabelText(/auth\.emailOrUsername/i), { target: { value: "user@example.com" } });
		const submit = screen.getByRole("button", { name: /auth\.sendResetLink/i });
		fireEvent.click(submit);

		await waitFor(() => {
			expect(submit).toBeDisabled();
		});
		resolveForgotPassword!({ ok: true });
		await waitFor(() => {
			expect(screen.getByText(/auth\.resetEmailSent/i)).toBeInTheDocument();
		});
	});

	it("shows password recovery when registration is disabled", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ ...mockAuthState, registrationEnabled: false, passwordResetEnabled: true }),
			})
			.mockResolvedValueOnce({ status: 401, ok: false });

		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /auth\.forgotPassword/i })).toBeInTheDocument();
		});
		expect(screen.queryByRole("button", { name: /auth\.createAccount/i })).not.toBeInTheDocument();
	});

	it("scrubs the reset fragment before submitting the token to the reset endpoint", async () => {
		const token = "a".repeat(64);
		window.location.hash = `reset-password?token=${token}`;
		const replaceStateSpy = vi.spyOn(window.history, "replaceState");
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockReset()
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAuthState) })
			.mockResolvedValueOnce({ status: 401, ok: false })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "reset-user" }) })
			.mockResolvedValueOnce({ ok: true });

		render(
			<AuthProvider>
				<AuthPage />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.newPassword/i)).toBeInTheDocument();
		});
		expect(replaceStateSpy).toHaveBeenCalledWith({}, "", `${window.location.pathname}${window.location.search}`);
		fireEvent.change(screen.getByLabelText(/auth\.newPassword/i), { target: { value: "NewPassword456" } });
		fireEvent.change(screen.getByLabelText(/auth\.confirmPassword/i), { target: { value: "NewPassword456" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.resetPassword/i }));

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith(
				"/api/auth/reset-password",
				expect.objectContaining({ method: "POST", body: JSON.stringify({ token, newPassword: "NewPassword456" }) })
			);
		});
		window.history.replaceState({}, "", "/");
		replaceStateSpy.mockRestore();
	});

	it("returns to login shortly after a successful password reset", async () => {
		vi.useFakeTimers();
		const token = "b".repeat(64);
		window.location.hash = `reset-password?token=${token}`;
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockReset()
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAuthState) })
			.mockResolvedValueOnce({ status: 401, ok: false })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "reset-user" }) })
			.mockResolvedValueOnce({ ok: true });

		try {
			render(
				<AuthProvider>
					<AuthPage />
				</AuthProvider>
			);

			await act(async () => {});
			expect(screen.getByLabelText(/auth\.newPassword/i)).toBeInTheDocument();
			fireEvent.change(screen.getByLabelText(/auth\.newPassword/i), { target: { value: "NewPassword456" } });
			fireEvent.change(screen.getByLabelText(/auth\.confirmPassword/i), { target: { value: "NewPassword456" } });
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: /auth\.resetPassword/i }));
				await Promise.resolve();
			});
			expect(screen.getByText(/auth\.passwordResetSuccess/i)).toBeInTheDocument();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3000);
			});
			expect(screen.getByLabelText(/auth\.emailOrUsername/i)).toBeInTheDocument();
			expect(screen.queryByText(/auth\.sessionExpiredTitle/i)).not.toBeInTheDocument();
		} finally {
			vi.useRealTimers();
			window.history.replaceState({}, "", "/");
		}
	});
});

describe("UserProfile", () => {
	const mockUser = {
		id: 1,
		username: "testuser",
		email: null,
		avatarUrl: null,
	};
	type ProfileUser = Omit<typeof mockUser, "email"> & { authProvider?: string; email?: string | null };

	function mockProfileRequests(
		users: ProfileUser[],
		deleteResponse: { ok: boolean; json?: () => Promise<{ error: string }> } = { ok: true }
	) {
		let userResponseIndex = 0;
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
			const path = input.toString();
			if (path === "/api/auth/state") {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }),
				});
			}
			if (path === "/api/auth/me" && init?.method === "DELETE") {
				return Promise.resolve(deleteResponse);
			}
			if (path === "/api/auth/me" && init?.method === "PUT") {
				return Promise.resolve({ ok: true });
			}
			if (path === "/api/auth/me") {
				const user = users[Math.min(userResponseIndex, users.length - 1)];
				userResponseIndex += 1;
				return Promise.resolve({ ok: true, json: () => Promise.resolve(user) });
			}
			return Promise.resolve({ ok: true });
		});
	}

	beforeEach(() => {
		vi.resetAllMocks();
		mockProfileRequests([mockUser]);
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
			expect(screen.getByRole("button", { name: /^auth\.changePassword$/i })).toBeInTheDocument();
		});
	});

	it("shows the recovery email field for a local account without an email", async () => {
		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.email/i)).toHaveValue("");
		});
	});

	it("refreshes a stale local user without email once to show the stored recovery email", async () => {
		const staleUser: ProfileUser = {
			id: 1,
			username: "testuser",
			avatarUrl: null,
		};
		mockProfileRequests([staleUser, { ...mockUser, email: "testuser@example.com" }]);

		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.email/i)).toHaveValue("testuser@example.com");
		});

		const userRequests = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0] === "/api/auth/me");
		expect(userRequests).toHaveLength(2);
	});

	it("shows the saved recovery email for a local account", async () => {
		mockProfileRequests([{ ...mockUser, email: "testuser@example.com" }]);

		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.email/i)).toHaveValue("testuser@example.com");
		});
	});

	it("hides the recovery email field for an OIDC account", async () => {
		mockProfileRequests([{ ...mockUser, authProvider: "oidc" }]);

		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByText("testuser")).toBeInTheDocument();
		});
		expect(screen.queryByLabelText(/auth\.email/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/auth\.currentPassword/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/auth\.newPassword/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/auth\.confirmPassword/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /auth\.saveChanges/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /^auth\.changePassword$/i })).not.toBeInTheDocument();
	});

	it("requires confirmation only after the recovery email changes and saves it separately", async () => {
		mockProfileRequests([mockUser]);

		renderUserProfile();

		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.email/i)).toBeInTheDocument();
		});
		expect(screen.queryByLabelText(/auth\.currentPassword/i)).not.toBeInTheDocument();

		fireEvent.change(screen.getByLabelText(/auth\.email/i), { target: { value: "recovery@example.com" } });
		await waitFor(() => {
			expect(screen.getByLabelText(/auth\.currentPassword/i)).toBeInTheDocument();
		});
		fireEvent.change(screen.getByLabelText(/auth\.currentPassword/i), { target: { value: "current-password" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.saveChanges/i }));

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith(
				"/api/auth/me",
				expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ currentPassword: "current-password", email: "recovery@example.com" }),
				})
			);
		});
	});

	it("keeps password fields hidden until Change Password is selected and saves the password form separately", async () => {
		mockProfileRequests([mockUser]);

		renderUserProfile();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^auth\.changePassword$/i })).toBeInTheDocument();
		});
		expect(screen.queryByLabelText(/auth\.currentPassword/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/auth\.newPassword/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/auth\.confirmPassword/i)).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /^auth\.changePassword$/i }));
		fireEvent.change(screen.getByLabelText(/auth\.currentPassword/i), { target: { value: "current-password" } });
		fireEvent.change(screen.getByLabelText(/auth\.newPassword/i), { target: { value: "new-password-123" } });
		fireEvent.change(screen.getByLabelText(/auth\.confirmPassword/i), { target: { value: "new-password-123" } });
		fireEvent.click(screen.getByRole("button", { name: /auth\.updatePassword/i }));

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith(
				"/api/auth/me",
				expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ currentPassword: "current-password", newPassword: "new-password-123" }),
				})
			);
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
			const cancelBtn = screen.getByText(/common\.close/i);
			fireEvent.click(cancelBtn);
		});

		expect(onClose).toHaveBeenCalled();
	});

	it("shows password mismatch error on update", async () => {
		render(
			<AuthProvider>
				<UserProfile />
			</AuthProvider>
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^auth\.changePassword$/i })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /^auth\.changePassword$/i }));
		fireEvent.change(screen.getByLabelText(/auth\.currentPassword/i), { target: { value: "current-password" } });
		fireEvent.change(screen.getByLabelText(/auth\.newPassword/i), { target: { value: "new-password-123" } });
		fireEvent.change(screen.getByLabelText(/auth\.confirmPassword/i), { target: { value: "different-password" } });

		const submitButton = screen.getByRole("button", { name: /auth\.updatePassword/i });
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(screen.getByText(/auth\.passwordMismatch/i)).toBeInTheDocument();
		});
	});

	it("opens delete confirmation and executes account deletion", async () => {
		renderUserProfile();
		await openDeleteAccountConfirmation();

		fireEvent.click(screen.getByRole("button", { name: /auth\.deleteAccountButton/i }));

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith(
				"/api/auth/me",
				expect.objectContaining({ method: "DELETE", credentials: "include" })
			);
		});
	});

	it("closes profile on Escape key when onClose is provided", async () => {
		const onClose = vi.fn();

		renderUserProfile(onClose);
		await waitForUserProfile();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});

	it("shows delete error when account deletion fails", async () => {
		mockProfileRequests([mockUser], {
			ok: false,
			json: () => Promise.resolve({ error: "Delete failed badly" }),
		});

		renderUserProfile();
		await openDeleteAccountConfirmation();

		fireEvent.click(screen.getByRole("button", { name: /auth\.deleteAccountButton/i }));

		await waitFor(() => {
			expect(screen.getAllByText("Delete failed badly").length).toBeGreaterThan(0);
		});
	});
});

describe("AuthProvider methods", () => {
	it("register performs auto-login and refreshes auth state", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ user: { id: 2, username: "newuser" } }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.register("newuser", "newuser@example.com", "secure-password-123");
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/register",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/login",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
	});

	it("logout clears current user", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ user: { id: 3, username: "logout-user" } }) })
			.mockResolvedValueOnce({ ok: true });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.login("logout-user", "pw");
		});

		expect(result.current.user?.username).toBe("logout-user");

		await act(async () => {
			await result.current.logout();
		});

		expect(result.current.user).toBeNull();
	});

	it("refreshUser retries after token refresh on 401", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false, formLoginEnabled: true }) })
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "refreshed-user" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.refreshUser();
		});

		await waitFor(() => {
			expect(result.current.user?.username).toBe("refreshed-user");
		});
	});

	it("login throws backend error message on failed login", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "Invalid credentials" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await expect(result.current.login("user", "bad-password")).rejects.toThrow("Invalid credentials");
	});

	it("updateProfile sends PUT and refreshes user data", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "updated-user" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.updateProfile({ currentPassword: "old", newPassword: "new-password-123" });
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/me",
			expect.objectContaining({ method: "PUT", credentials: "include" })
		);
		expect(result.current.user?.username).toBe("updated-user");
	});

	it("uploadAvatar posts FormData and refreshes user", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "avatar-user" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		const file = new File(["avatar"], "avatar.png", { type: "image/png" });
		await act(async () => {
			await result.current.uploadAvatar(file);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/avatar",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
		expect(result.current.user?.username).toBe("avatar-user");
	});

	it("deleteAvatar throws backend error on failure", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "Delete failed" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await expect(result.current.deleteAvatar()).rejects.toThrow("Delete failed");
	});

	it("authFetch does not refresh token for auth endpoints", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: false, status: 401 });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		const response = await result.current.authFetch("/api/auth/me", { method: "GET" });
		expect(response.status).toBe(401);

		const refreshCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
			(call) => call[0] === "/api/auth/refresh"
		);
		expect(refreshCalls.length).toBe(0);
	});

	it("refreshUser clears user when /auth/me returns non-401 error", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: false, status: 500 });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.refreshUser();
		});

		expect(result.current.user).toBeNull();
		expect(result.current.sessionExpired).toBe(false);
	});

	it("marks the session as expired when refreshUser cannot recover from 401", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "expired-user" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.user?.username).toBe("expired-user");
		});
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValueOnce({ ok: false, status: 401 });

		await act(async () => {
			await result.current.refreshUser();
		});

		expect(result.current.user).toBeNull();
		expect(result.current.sessionExpired).toBe(true);
	});

	it("does not mark an initially unauthenticated visitor session as expired", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: true, formLoginEnabled: true }) })
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValueOnce({ ok: false, status: 401 });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});
		expect(result.current.user).toBeNull();
		expect(result.current.sessionExpired).toBe(false);
	});

	it("updateProfile throws default message when backend has no error field", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await expect(result.current.updateProfile({ currentPassword: "a", newPassword: "b" })).rejects.toThrow(
			"Update failed"
		);
	});

	it("uploadAvatar throws default message when error payload is invalid JSON", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({
				ok: false,
				json: () => Promise.reject(new Error("invalid json")),
			});

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		const file = new File(["avatar"], "avatar.png", { type: "image/png" });
		await expect(result.current.uploadAvatar(file)).rejects.toThrow("UNKNOWN");
	});

	it("deleteAvatar succeeds and refreshes user", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1, username: "avatar-deleted" }) });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.deleteAvatar();
		});

		expect(result.current.user?.username).toBe("avatar-deleted");
	});

	it("deleteAccount clears current user on success", async () => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ authEnabled: false }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ user: { id: 9, username: "to-delete" } }) })
			.mockResolvedValueOnce({ ok: true });

		const { result } = renderHook(() => useAuth(), { wrapper });

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		await act(async () => {
			await result.current.login("to-delete", "pw");
		});
		expect(result.current.user?.username).toBe("to-delete");

		await act(async () => {
			await result.current.deleteAccount();
		});

		expect(result.current.user).toBeNull();
	});
});
