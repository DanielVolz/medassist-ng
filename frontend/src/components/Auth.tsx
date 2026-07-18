/* biome-ignore-all lint/correctness/useExhaustiveDependencies: auth refresh callbacks intentionally coordinate via refs/guards */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useModalHistory } from "../hooks/useModalHistory";
import { AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppTooltip, AppTooltipIcon } from "../ui/primitives/AppTooltip";
import { createCorrelationId, withCorrelation } from "../utils/correlation";
import { MAX_IMAGE_UPLOAD_BYTES, resolveImageUploadError } from "../utils/image-upload";
import { log } from "../utils/logger";
import classes from "./Auth.module.css";
import { ConfirmModal } from "./ConfirmModal";
import { PasswordInput } from "./PasswordInput";

// =============================================================================
// Types (no roles - all users are equal)
// =============================================================================
export interface User {
	id: number;
	username: string;
	email?: string | null;
	avatarUrl?: string | null;
	authProvider?: string;
}

export interface AuthState {
	authEnabled: boolean;
	registrationEnabled: boolean;
	formLoginEnabled: boolean;
	passwordResetEnabled: boolean;
	oidcEnabled: boolean;
	oidcProviderName: string;
	needsSetup: boolean;
}

interface AuthContextType {
	user: User | null;
	authState: AuthState | null;
	loading: boolean;
	authError: string | null;
	sessionExpired: boolean;
	login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
	register: (username: string, email: string, password: string) => Promise<void>;
	forgotPassword: (emailOrUsername: string) => Promise<void>;
	resetPassword: (token: string, newPassword: string) => Promise<void>;
	logout: () => Promise<void>;
	refreshUser: () => Promise<void>;
	updateProfile: (data: { currentPassword?: string; email?: string; newPassword?: string }) => Promise<void>;
	uploadAvatar: (file: File) => Promise<void>;
	deleteAvatar: () => Promise<void>;
	deleteAccount: () => Promise<void>;
	authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function cx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

// =============================================================================
// Context
// =============================================================================
const AuthContext = createContext<AuthContextType | null>(null);

function getRequestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (typeof Request !== "undefined" && input instanceof Request) return input.url;
	return String(input);
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
	if (init?.method) return init.method.toUpperCase();
	if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
	return "GET";
}

function redactApiPath(path: string): string {
	return path.replace(/(\/api\/share\/)(?:[a-f0-9]{16}|[a-f0-9]{64})(?=\/|$|\?)/gi, "$1[share-token]");
}

function getRequestLogPath(input: RequestInfo | URL): string {
	const rawUrl = getRequestUrl(input);
	try {
		return redactApiPath(new URL(rawUrl, "http://localhost").pathname);
	} catch {
		return redactApiPath(rawUrl.split("?")[0] ?? rawUrl);
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isPollingRequest(path: string, method: string): boolean {
	if (method !== "GET") return false;
	return path === "/api/doses/taken" || /^\/api\/share\/[^/]+\/doses$/.test(path);
}

function shouldWarnForResponse(path: string, method: string, response: Response): boolean {
	if (response.ok || isPollingRequest(path, method)) return false;
	if (method === "GET" || method === "HEAD") return response.status >= 500;
	return true;
}

function withAuthFetchCorrelation(init?: RequestInit): { correlationId: string; init: RequestInit } {
	const headers = new Headers(init?.headers ?? {});
	const existingCorrelationId = headers.get("x-correlation-id")?.trim();
	const correlationId = existingCorrelationId || createCorrelationId("fe-api");
	if (!existingCorrelationId) {
		headers.set("x-correlation-id", correlationId);
	}

	return {
		correlationId,
		init: {
			...init,
			headers,
			credentials: "include",
		},
	};
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within AuthProvider");
	}
	return context;
}

// =============================================================================
// Provider
// =============================================================================
export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [authState, setAuthState] = useState<AuthState | null>(null);
	const [loading, setLoading] = useState(true);
	const [authError, setAuthError] = useState<string | null>(null);
	const [sessionExpired, setSessionExpired] = useState(false);
	// Track if initial fetch has been done to prevent duplicate calls
	const initialFetchDone = useRef(false);
	const hadAuthenticatedSession = useRef(false);

	// Fetch auth state on mount (only once)
	useEffect(() => {
		if (initialFetchDone.current) return;
		initialFetchDone.current = true;
		fetchAuthState();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetchAuthState]);

	// Proactively refresh token every 10 minutes to prevent expiration
	useEffect(() => {
		if (!user || !authState?.authEnabled) return;

		const refreshInterval = setInterval(
			async () => {
				const success = await tryRefreshToken();
				if (!success) {
					// Refresh failed - check if user is still valid
					await refreshUser();
				}
			},
			10 * 60 * 1000
		); // 10 minutes (before 15 min access token expires)

		return () => clearInterval(refreshInterval);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user, authState?.authEnabled, refreshUser, tryRefreshToken]);

	async function fetchAuthState(retryCount = 0) {
		const maxRetries = 3;
		const retryDelay = 1000; // 1 second
		let correlationId: string | null = null;

		try {
			setAuthError(null);
			const correlated = withCorrelation(undefined, "fe-auth-state");
			correlationId = correlated.correlationId;
			const res = await fetch("/api/auth/state", correlated.init);
			if (!res.ok) {
				throw new Error(`Server error: ${res.status}`);
			}
			const state = await res.json();
			setAuthState(state);

			// If auth is enabled and we might be logged in, check session
			if (state.authEnabled) {
				await refreshUser();
			} else {
				hadAuthenticatedSession.current = false;
				setSessionExpired(false);
			}
			setLoading(false);
		} catch (err) {
			log.error(`Failed to fetch auth state (attempt ${retryCount + 1}/${maxRetries + 1}):`, err, {
				correlationId,
			});

			// Retry on connection errors or 5xx errors (server might be restarting)
			if (retryCount < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				return fetchAuthState(retryCount + 1);
			}

			setAuthError(err instanceof Error ? err.message : "Failed to connect to server");
			setLoading(false);
		}
	}

	async function refreshUser() {
		try {
			const { correlationId, init } = withCorrelation({ credentials: "include" }, "fe-auth-me");
			const res = await fetch("/api/auth/me", init);
			if (res.ok) {
				const userData = await res.json();
				setUser(userData);
				hadAuthenticatedSession.current = true;
				setSessionExpired(false);
				log.debug("[Auth] Session user loaded", { userId: userData.id, correlationId });
			} else if (res.status === 401) {
				// Access token expired - try to refresh it
				log.info("[Auth] Access token invalid, attempting refresh", { correlationId });
				const refreshed = await tryRefreshToken();
				if (refreshed) {
					// Retry /auth/me with new token
					const retry = withCorrelation({ credentials: "include" }, "fe-auth-me-retry");
					const retryRes = await fetch("/api/auth/me", retry.init);
					if (retryRes.ok) {
						const userData = await retryRes.json();
						setUser(userData);
						hadAuthenticatedSession.current = true;
						setSessionExpired(false);
						log.info("[Auth] Session restored after token refresh", {
							userId: userData.id,
							correlationId: retry.correlationId,
						});
						return;
					}
				}
				log.debug("[Auth] Session refresh unavailable, clearing local user state", { correlationId });
				setUser(null);
				setSessionExpired(hadAuthenticatedSession.current);
			} else {
				log.warn("[Auth] Unexpected /auth/me response", { status: res.status, correlationId });
				setUser(null);
			}
		} catch (error) {
			log.error("[Auth] Failed to refresh user", { error });
			setUser(null);
		}
	}

	// Try to refresh the access token using the refresh token
	async function tryRefreshToken(): Promise<boolean> {
		try {
			const { correlationId, init } = withCorrelation(
				{
					method: "POST",
					credentials: "include",
				},
				"fe-auth-refresh"
			);
			const res = await fetch("/api/auth/refresh", init);
			if (!res.ok) {
				if (res.status === 401) {
					log.debug("[Auth] Token refresh rejected (unauthenticated)", { status: res.status, correlationId });
				} else {
					log.warn("[Auth] Token refresh rejected", { status: res.status, correlationId });
				}
			}
			return res.ok;
		} catch (error) {
			log.error("[Auth] Token refresh request failed", { error });
			return false;
		}
	}

	async function login(username: string, password: string, rememberMe: boolean = false) {
		const { correlationId, init } = withCorrelation(
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ username, password, rememberMe }),
			},
			"fe-auth-login"
		);
		log.info("[Auth] Login requested", { username, rememberMe, correlationId });
		const res = await fetch("/api/auth/login", init);

		if (!res.ok) {
			const data = await res.json();
			log.warn("[Auth] Login failed", { username, status: res.status, code: data.code, correlationId });
			throw new Error(data.error || "Login failed");
		}

		const data = await res.json();
		setUser(data.user);
		hadAuthenticatedSession.current = true;
		setSessionExpired(false);
		log.info("[Auth] Login successful", { userId: data.user?.id, username: data.user?.username, correlationId });
	}

	async function register(username: string, email: string, password: string) {
		const { correlationId, init } = withCorrelation(
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ username, email, password }),
			},
			"fe-auth-register"
		);
		const res = await fetch("/api/auth/register", init);

		if (!res.ok) {
			const data = await res.json();
			log.warn("[Auth] Registration failed", { status: res.status, code: data.code, correlationId });
			throw new Error(data.error || "Registration failed");
		}

		// Auto-login after registration
		await login(username, password);
		setSessionExpired(false);

		// Refresh auth state (registration might disable further registrations)
		await fetchAuthState();
	}

	async function forgotPassword(emailOrUsername: string) {
		const { init } = withCorrelation(
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailOrUsername }) },
			"fe-auth-forgot-password"
		);
		await fetch("/api/auth/forgot-password", init);
	}

	async function resetPassword(token: string, newPassword: string) {
		const { init } = withCorrelation(
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword }) },
			"fe-auth-reset-password"
		);
		const res = await fetch("/api/auth/reset-password", init);
		if (!res.ok) throw new Error("RESET_FAILED");
		setUser(null);
		hadAuthenticatedSession.current = false;
		setSessionExpired(false);
	}

	async function logout() {
		const { correlationId, init } = withCorrelation(
			{
				method: "POST",
				credentials: "include",
			},
			"fe-auth-logout"
		);
		log.info("[Auth] Logout requested", { userId: user?.id ?? null, correlationId });
		await fetch("/api/auth/logout", init);
		setUser(null);
		hadAuthenticatedSession.current = false;
		setSessionExpired(false);
		log.info("[Auth] Logout completed", { correlationId });
	}

	async function updateProfile(data: { currentPassword?: string; email?: string; newPassword?: string }) {
		const { correlationId, init } = withCorrelation(
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(data),
			},
			"fe-auth-profile"
		);
		const res = await fetch("/api/auth/me", init);

		if (!res.ok) {
			const err = await res.json();
			log.warn("[Auth] Profile update failed", { status: res.status, code: err.code, correlationId });
			throw new Error(err.error || "Update failed");
		}

		await refreshUser();
	}

	// Upload avatar
	async function uploadAvatar(file: File) {
		const formData = new FormData();
		formData.append("file", file);

		const { correlationId, init } = withCorrelation(
			{
				method: "POST",
				credentials: "include",
				body: formData,
			},
			"fe-auth-avatar"
		);
		const res = await fetch("/api/auth/avatar", init);

		if (!res.ok) {
			let code = "UNKNOWN";
			try {
				const body = (await res.json()) as { code?: string };
				if (typeof body?.code === "string" && body.code.trim().length > 0) {
					code = body.code;
				}
			} catch {
				// No JSON body
			}
			log.warn("[Auth] Avatar upload failed", { status: res.status, code, correlationId });
			throw new Error(code);
		}

		await refreshUser();
	}

	// Delete avatar
	async function deleteAvatar() {
		const { correlationId, init } = withCorrelation(
			{
				method: "DELETE",
				credentials: "include",
			},
			"fe-auth-avatar-delete"
		);
		const res = await fetch("/api/auth/avatar", init);

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Delete failed" }));
			log.warn("[Auth] Avatar delete failed", { status: res.status, code: err.code, correlationId });
			throw new Error(err.error || "Delete failed");
		}

		await refreshUser();
	}

	// Delete account
	async function deleteAccount() {
		const { correlationId, init } = withCorrelation(
			{
				method: "DELETE",
				credentials: "include",
			},
			"fe-auth-account-delete"
		);
		const res = await fetch("/api/auth/me", init);

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Delete failed" }));
			log.warn("[Auth] Account delete failed", { status: res.status, code: err.code, correlationId });
			throw new Error(err.error || "Delete failed");
		}

		setUser(null);
		hadAuthenticatedSession.current = false;
		setSessionExpired(false);
	}

	// Fetch wrapper that automatically refreshes token on 401
	const authFetch = useCallback(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const method = getRequestMethod(input, init);
			const path = getRequestLogPath(input);
			const correlated = withAuthFetchCorrelation(init);
			const options = correlated.init;
			const { correlationId } = correlated;

			let res: Response;
			try {
				res = await fetch(input, options);
			} catch (error) {
				const details = { method, path, correlationId, error: getErrorMessage(error) };
				if (isPollingRequest(path, method)) {
					log.debug("[Auth] API polling request failed", details);
				} else {
					log.error("[Auth] API request failed", details);
				}
				throw error;
			}

			// If 401 and not already a refresh/login request, try to refresh token
			let retried = false;
			if (res.status === 401 && !path.startsWith("/api/auth/")) {
				const refreshed = await tryRefreshToken();
				if (refreshed) {
					// Retry the original request with new token
					retried = true;
					try {
						res = await fetch(input, options);
					} catch (error) {
						log.error("[Auth] API retry request failed", {
							method,
							path,
							correlationId,
							error: getErrorMessage(error),
						});
						throw error;
					}
					if (res.ok) {
						setSessionExpired(false);
					}
				} else {
					// Refresh failed - user needs to login again
					setUser(null);
					setSessionExpired(hadAuthenticatedSession.current);
				}
			}

			if (shouldWarnForResponse(path, method, res)) {
				log.warn("[Auth] API request completed with failure status", {
					method,
					path,
					status: res.status,
					correlationId,
					retried,
				});
			}

			return res;
		},
		[tryRefreshToken]
	);

	return (
		<AuthContext.Provider
			value={{
				user,
				authState,
				loading,
				authError,
				sessionExpired,
				login,
				register,
				forgotPassword,
				resetPassword,
				logout,
				refreshUser,
				updateProfile,
				uploadAvatar,
				deleteAvatar,
				deleteAccount,
				authFetch,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

// =============================================================================
// Login Form
// =============================================================================
export function LoginForm({
	onSuccess,
	onSwitchToRegister,
	onSwitchToForgot,
}: {
	onSuccess?: () => void;
	onSwitchToRegister?: () => void;
	onSwitchToForgot?: () => void;
}) {
	const { t } = useTranslation();
	const { login, authState, sessionExpired } = useAuth();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [rememberMe, setRememberMe] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			await login(username, password, rememberMe);
			onSuccess?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className={cx(classes["auth-container"], "auth-container")}>
			<div className={classes["auth-panel"]}>
				<h1 className={classes["auth-title"]}>💊 MedAssist-ng</h1>
				<h2 className={classes["auth-subtitle"]}>{t("auth.login", "Login")}</h2>

				{/* SSO Login Button */}
				{authState?.oidcEnabled && (
					<div className={classes["auth-sso"]}>
						<button
							type="button"
							className={cx(classes["auth-submit"], classes["sso-btn"])}
							onClick={() => (window.location.href = "/api/auth/oidc/login")}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className={classes["sso-icon"]}
							>
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
								<polyline points="10 17 15 12 10 7" />
								<line x1="15" y1="12" x2="3" y2="12" />
							</svg>
							{t("auth.loginWithSSO", "Login with {{provider}}", { provider: authState.oidcProviderName || "SSO" })}
						</button>
						{authState?.formLoginEnabled && (
							<div className={classes["auth-divider"]}>
								<span>{t("auth.or", "or")}</span>
							</div>
						)}
					</div>
				)}

				{/* Local login form - only show if form login is enabled */}
				{authState?.formLoginEnabled && (
					<form onSubmit={handleSubmit} className={classes["auth-form"]}>
						{sessionExpired && (
							<div className={classes["auth-error"]}>
								<strong>{t("auth.sessionExpiredTitle")}</strong>
								<br />
								{t("auth.sessionExpiredHelp")}
							</div>
						)}
						{error && <div className={classes["auth-error"]}>{error}</div>}

						<div className={classes.formGroup}>
							<label htmlFor="username">{t("auth.emailOrUsername")}</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								required
								autoComplete="username"
							/>
						</div>

						<div className={classes.formGroup}>
							<label htmlFor="password">{t("auth.password", "Password")}</label>
							<PasswordInput
								id="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
							/>
						</div>

						<div className={cx(classes.formGroup, classes["checkbox-group"])}>
							<label className={classes["checkbox-label"]}>
								<input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
								<span>{t("auth.rememberMe", "Remember me")}</span>
							</label>
						</div>

						<AppButton type="submit" className={classes["auth-submit"]} disabled={loading}>
							{loading ? t("common.loading", "Loading...") : t("auth.login", "Login")}
						</AppButton>
					</form>
				)}

				{authState?.formLoginEnabled &&
					(onSwitchToForgot || (authState?.registrationEnabled && onSwitchToRegister)) && (
						<div className={classes["auth-links"]}>
							{authState.passwordResetEnabled && onSwitchToForgot && (
								<button type="button" className={classes["auth-link-btn"]} onClick={onSwitchToForgot}>
									{t("auth.forgotPassword")}
								</button>
							)}
							{authState.registrationEnabled && onSwitchToRegister && (
								<button type="button" className={classes["auth-link-btn"]} onClick={onSwitchToRegister}>
									{t("auth.createAccount", "Create account")}
								</button>
							)}
						</div>
					)}
			</div>
		</div>
	);
}

// =============================================================================
// Registration Form
// =============================================================================
export function RegisterForm({ onSuccess, onSwitchToLogin }: { onSuccess?: () => void; onSwitchToLogin?: () => void }) {
	const { t } = useTranslation();
	const { register, authState } = useAuth();
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError(t("auth.passwordMismatch", "Passwords do not match"));
			return;
		}

		setLoading(true);

		try {
			await register(username, email, password);
			onSuccess?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Registration failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className={cx(classes["auth-container"], "auth-container")}>
			<div className={classes["auth-panel"]}>
				<h1 className={classes["auth-title"]}>💊 MedAssist-ng</h1>
				<h2 className={classes["auth-subtitle"]}>{t("auth.register", "Create Account")}</h2>

				{/* SSO Login Button - also show on registration */}
				{authState?.oidcEnabled && (
					<div className={classes["auth-sso"]}>
						<button
							type="button"
							className={cx(classes["auth-submit"], classes["sso-btn"])}
							onClick={() => (window.location.href = "/api/auth/oidc/login")}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className={classes["sso-icon"]}
							>
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
								<polyline points="10 17 15 12 10 7" />
								<line x1="15" y1="12" x2="3" y2="12" />
							</svg>
							{t("auth.loginWithSSO", "Login with {{provider}}", { provider: authState.oidcProviderName || "SSO" })}
						</button>
						{authState?.formLoginEnabled && (
							<div className={classes["auth-divider"]}>
								<span>{t("auth.or", "or")}</span>
							</div>
						)}
					</div>
				)}

				{/* Local Registration Form - only show if local auth is enabled */}
				{authState?.formLoginEnabled && (
					<form onSubmit={handleSubmit} className={classes["auth-form"]}>
						{error && <div className={classes["auth-error"]}>{error}</div>}

						<div className={classes.formGroup}>
							<label htmlFor="username" className={classes.labelWithTooltip}>
								<span>{t("auth.username", "Username")} *</span>
								<AppTooltipIcon label={t("auth.usernameHint", "Letters, numbers, underscores, and hyphens only")} />
							</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								required
								autoComplete="username"
								minLength={3}
								maxLength={50}
								pattern="[a-zA-Z0-9_-]+"
							/>
						</div>

						<div className={classes.formGroup}>
							<label htmlFor="email">{t("auth.email")} *</label>
							<input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
							/>
						</div>

						<div className={classes.formGroup}>
							<label htmlFor="password">{t("auth.password", "Password")} *</label>
							<PasswordInput
								id="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="new-password"
								minLength={8}
								maxLength={128}
							/>
						</div>

						<div className={classes.formGroup}>
							<label htmlFor="confirmPassword">{t("auth.confirmPassword", "Confirm Password")} *</label>
							<PasswordInput
								id="confirmPassword"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								autoComplete="new-password"
							/>
						</div>

						<AppButton type="submit" className={classes["auth-submit"]} disabled={loading}>
							{loading ? t("common.loading", "Loading...") : t("auth.register", "Create Account")}
						</AppButton>
					</form>
				)}

				{onSwitchToLogin && (
					<div className={classes["auth-links"]}>
						<button type="button" className={classes["auth-link-btn"]} onClick={onSwitchToLogin}>
							{t("auth.alreadyHaveAccount", "Already have an account? Login")}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
	const { t } = useTranslation();
	const { forgotPassword } = useAuth();
	const [emailOrUsername, setEmailOrUsername] = useState("");
	const [sent, setSent] = useState(false);
	const [sending, setSending] = useState(false);
	return (
		<div className={cx(classes["auth-container"], "auth-container")}>
			<div className={classes["auth-panel"]}>
				<h1 className={classes["auth-title"]}>MedAssist-ng</h1>
				<h2 className={classes["auth-subtitle"]}>{t("auth.passwordReset")}</h2>
				{sent ? (
					<div className={classes["auth-success"]}>{t("auth.resetEmailSent")}</div>
				) : (
					<form
						className={classes["auth-form"]}
						onSubmit={async (event) => {
							event.preventDefault();
							if (sending) return;
							setSending(true);
							try {
								await forgotPassword(emailOrUsername);
								setSent(true);
							} finally {
								setSending(false);
							}
						}}
					>
						<div className={classes.formGroup}>
							<label htmlFor="recovery-identifier">{t("auth.emailOrUsername")}</label>
							<input
								id="recovery-identifier"
								value={emailOrUsername}
								onChange={(event) => setEmailOrUsername(event.target.value)}
								required
							/>
						</div>
						<AppButton type="submit" className={classes["auth-submit"]} disabled={sending}>
							{sending ? t("common.sending") : t("auth.sendResetLink")}
						</AppButton>
					</form>
				)}
				<div className={classes["auth-links"]}>
					<button type="button" className={classes["auth-link-btn"]} onClick={onBack}>
						{t("auth.backToLogin")}
					</button>
				</div>
			</div>
		</div>
	);
}

function ResetPasswordForm({ token, onBack }: { token: string; onBack: () => void }) {
	const { t } = useTranslation();
	const { resetPassword } = useAuth();
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		if (!success) return;

		const redirectTimer = window.setTimeout(onBack, 3000);
		return () => window.clearTimeout(redirectTimer);
	}, [onBack, success]);

	return (
		<div className={cx(classes["auth-container"], "auth-container")}>
			<div className={classes["auth-panel"]}>
				<h1 className={classes["auth-title"]}>MedAssist-ng</h1>
				<h2 className={classes["auth-subtitle"]}>{t("auth.resetPassword")}</h2>
				{success ? (
					<div className={classes["auth-success"]}>{t("auth.passwordResetSuccess")}</div>
				) : (
					<form
						className={classes["auth-form"]}
						onSubmit={async (event) => {
							event.preventDefault();
							if (password !== confirmPassword) {
								setError(t("auth.passwordMismatch"));
								return;
							}
							try {
								await resetPassword(token, password);
								setSuccess(true);
							} catch {
								setError(t("auth.resetLinkInvalid"));
							}
						}}
					>
						{error && <div className={classes["auth-error"]}>{error}</div>}
						<div className={classes.formGroup}>
							<label htmlFor="reset-password">{t("auth.newPassword")}</label>
							<PasswordInput
								id="reset-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								minLength={8}
								required
								autoComplete="new-password"
							/>
						</div>
						<div className={classes.formGroup}>
							<label htmlFor="reset-password-confirm">{t("auth.confirmPassword")}</label>
							<PasswordInput
								id="reset-password-confirm"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
								required
								autoComplete="new-password"
							/>
						</div>
						<AppButton type="submit" className={classes["auth-submit"]}>
							{t("auth.resetPassword")}
						</AppButton>
					</form>
				)}
				<div className={classes["auth-links"]}>
					<button type="button" className={classes["auth-link-btn"]} onClick={onBack}>
						{t("auth.backToLogin")}
					</button>
				</div>
			</div>
		</div>
	);
}

// =============================================================================
// User Profile Component
// =============================================================================
export function UserProfile({ onClose }: { onClose?: () => void }) {
	const { t } = useTranslation();
	const { user, refreshUser, updateProfile, uploadAvatar, deleteAvatar, deleteAccount } = useAuth();
	const [email, setEmail] = useState("");
	const [emailConfirmationPassword, setEmailConfirmationPassword] = useState("");
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [avatarError, setAvatarError] = useState("");
	const [loading, setLoading] = useState(false);
	const [avatarLoading, setAvatarLoading] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const refreshedMissingEmail = useRef(false);

	useEffect(() => {
		setEmail(user?.email ?? "");
	}, [user?.email]);

	useEffect(() => {
		if (user?.authProvider === "oidc" || user?.email !== undefined || refreshedMissingEmail.current) return;
		refreshedMissingEmail.current = true;
		void refreshUser();
	}, [refreshUser, user?.authProvider, user?.email]);

	const closeDeleteConfirm = useCallback(() => {
		if (!deleteLoading) {
			setShowDeleteConfirm(false);
		}
	}, [deleteLoading]);

	useEscapeKey(!!onClose, onClose ?? (() => {}));
	useModalHistory(showDeleteConfirm, "profile-delete-account", closeDeleteConfirm);

	async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
			setAvatarError(t("form.imageUploadErrors.tooLarge"));
			if (fileInputRef.current) fileInputRef.current.value = "";
			return;
		}

		setAvatarLoading(true);
		setAvatarError("");
		try {
			await uploadAvatar(file);
			setAvatarError("");
		} catch (err) {
			const code = err instanceof Error ? err.message : "UNKNOWN";
			setAvatarError(resolveImageUploadError(code, t));
		} finally {
			setAvatarLoading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}

	async function handleAvatarDelete() {
		setAvatarLoading(true);
		setAvatarError("");
		try {
			await deleteAvatar();
			setAvatarError("");
		} catch (err) {
			const code = err instanceof Error ? err.message : "UNKNOWN";
			setAvatarError(resolveImageUploadError(code, t));
		} finally {
			setAvatarLoading(false);
		}
	}

	async function handleEmailUpdate(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setSuccess("");

		if (email === (user?.email ?? "")) {
			return;
		}

		if (!emailConfirmationPassword) {
			setError(t("auth.currentPasswordRequired"));
			return;
		}

		setLoading(true);

		try {
			await updateProfile({
				currentPassword: emailConfirmationPassword,
				email,
			});
			setSuccess(t("auth.profileUpdated", "Profile updated successfully"));
			setEmailConfirmationPassword("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Update failed");
		} finally {
			setLoading(false);
		}
	}

	function closePasswordChange() {
		setIsPasswordChangeOpen(false);
		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
		setError("");
	}

	async function handlePasswordUpdate(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setSuccess("");

		if (newPassword !== confirmPassword) {
			setError(t("auth.passwordMismatch", "Passwords do not match"));
			return;
		}

		if (!currentPassword || !newPassword || !confirmPassword) {
			setError(t("auth.fillAllFields", "Please fill in all password fields"));
			return;
		}

		setLoading(true);

		try {
			await updateProfile({ currentPassword, newPassword });
			setSuccess(t("auth.profileUpdated", "Profile updated successfully"));
			setIsPasswordChangeOpen(false);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Update failed");
		} finally {
			setLoading(false);
		}
	}

	async function handleDeleteAccount() {
		setDeleteLoading(true);
		setError("");
		try {
			await deleteAccount();
			// User will be logged out automatically
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
			setDeleteLoading(false);
		}
	}

	if (!user) return null;

	const canManageLocalCredentials = user.authProvider !== "oidc";
	const emailChanged = email !== (user.email ?? "");

	return (
		<div className={classes["profile-container"]}>
			<div className={classes["profile-user-section"]}>
				<div className={classes["profile-avatar-wrapper"]}>
					{user.avatarUrl ? (
						<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className={classes["profile-avatar-img"]} />
					) : (
						<div className={classes["profile-avatar"]}>{user.username.charAt(0).toUpperCase()}</div>
					)}
					<input
						type="file"
						ref={fileInputRef}
						onChange={handleAvatarUpload}
						accept="image/jpeg,image/png,image/webp,image/gif"
						style={{ display: "none" }}
					/>
					<div className={classes["profile-avatar-actions"]}>
						<AppTooltip label={t("auth.uploadAvatar", "Upload avatar")}>
							<span>
								<button
									type="button"
									className={classes["avatar-btn"]}
									onClick={() => fileInputRef.current?.click()}
									disabled={avatarLoading}
									aria-label={t("auth.uploadAvatar", "Upload avatar")}
								>
									📷
								</button>
							</span>
						</AppTooltip>
						{user.avatarUrl && (
							<AppTooltip label={t("auth.removeAvatar", "Remove avatar")}>
								<span>
									<button
										type="button"
										className={cx(classes["avatar-btn"], classes["avatar-btn-delete"])}
										onClick={handleAvatarDelete}
										disabled={avatarLoading}
										aria-label={t("auth.removeAvatar", "Remove avatar")}
									>
										🗑
									</button>
								</span>
							</AppTooltip>
						)}
					</div>
				</div>
				<div className={classes["profile-identity"]}>
					<span className={classes["profile-username"]}>{user.username}</span>
					<span className={classes["profile-account-type"]}>
						{canManageLocalCredentials ? t("auth.localAccount") : user.authProvider}
					</span>
				</div>
				{avatarError && <span className="field-error">{avatarError}</span>}
			</div>

			<div className={classes["profile-form"]}>
				{error && <div className={classes["auth-error"]}>{error}</div>}
				{success && <div className={classes["auth-success"]}>{success}</div>}

				{canManageLocalCredentials && (
					<>
						<form className={classes["profile-section"]} onSubmit={handleEmailUpdate}>
							<div className={classes["profile-section-header"]}>
								<h3 className={classes["profile-section-title"]}>{t("auth.recoveryEmail")}</h3>
								<p className={classes["profile-section-description"]}>{t("auth.recoveryEmailDescription")}</p>
							</div>
							<div className={classes.formGroup}>
								<label htmlFor="profile-email">{t("auth.email")}</label>
								<input
									id="profile-email"
									type="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									autoComplete="email"
								/>
							</div>
							{emailChanged && (
								<div className={classes.formGroup}>
									<label htmlFor="profile-email-current-password">{t("auth.currentPassword")}</label>
									<p className={classes["profile-field-description"]}>
										{t("auth.recoveryEmailConfirmationDescription")}
									</p>
									<PasswordInput
										id="profile-email-current-password"
										value={emailConfirmationPassword}
										onChange={(event) => setEmailConfirmationPassword(event.target.value)}
										required
										autoComplete="current-password"
									/>
								</div>
							)}
							<div className={classes["profile-action-row"]}>
								<AppButton type="submit" disabled={loading || !emailChanged}>
									{loading ? t("common.saving") : t("auth.saveChanges")}
								</AppButton>
							</div>
						</form>

						<div className={classes["profile-section"]}>
							<div className={classes["profile-section-header"]}>
								<h3 className={classes["profile-section-title"]}>{t("auth.changePassword")}</h3>
								<p className={classes["profile-section-description"]}>{t("auth.passwordChangeDescription")}</p>
							</div>

							{isPasswordChangeOpen ? (
								<form className={classes["profile-password-change-form"]} onSubmit={handlePasswordUpdate}>
									<div className={classes.formGroup}>
										<label htmlFor="current-password">{t("auth.currentPassword")}</label>
										<PasswordInput
											id="current-password"
											value={currentPassword}
											onChange={(event) => setCurrentPassword(event.target.value)}
											required
											autoComplete="current-password"
										/>
									</div>

									<div className={classes.formGroup}>
										<label htmlFor="new-password">{t("auth.newPassword")}</label>
										<PasswordInput
											id="new-password"
											value={newPassword}
											onChange={(event) => setNewPassword(event.target.value)}
											required
											autoComplete="new-password"
											minLength={8}
										/>
									</div>

									<div className={classes.formGroup}>
										<label htmlFor="confirm-new-password">{t("auth.confirmPassword")}</label>
										<PasswordInput
											id="confirm-new-password"
											value={confirmPassword}
											onChange={(event) => setConfirmPassword(event.target.value)}
											required
											autoComplete="new-password"
										/>
									</div>

									<div className={classes["profile-action-row"]}>
										<AppButton type="button" tone="secondary" onClick={closePasswordChange} disabled={loading}>
											{t("common.cancel")}
										</AppButton>
										<AppButton type="submit" disabled={loading}>
											{loading ? t("common.saving") : t("auth.updatePassword")}
										</AppButton>
									</div>
								</form>
							) : (
								<AppButton type="button" tone="secondary" onClick={() => setIsPasswordChangeOpen(true)}>
									{t("auth.changePassword")}
								</AppButton>
							)}
						</div>
					</>
				)}
			</div>

			{/* Delete Account Section */}
			<div className={cx(classes["profile-section"], classes["profile-critical-zone"])}>
				<h3 className={classes["profile-section-title"]}>{t("auth.dangerZone")}</h3>
				<p className={classes["profile-section-description"]}>{t("auth.deleteAccountDescription")}</p>
				<AppButton type="button" tone="danger" onClick={() => setShowDeleteConfirm(true)}>
					{t("auth.deleteAccount")}
				</AppButton>
			</div>

			<AppModalFooter>
				<AppButton type="button" tone="secondary" onClick={onClose}>
					{t("common.close", "Close")}
				</AppButton>
			</AppModalFooter>

			{/* Delete Confirmation Modal */}
			{showDeleteConfirm && (
				<ConfirmModal
					title={t("auth.deleteAccountConfirmTitle", "Delete Account?")}
					message={
						<>
							<p>
								{t(
									"auth.deleteAccountConfirmText",
									"This will permanently delete your account and all your data (medications, settings, history). This action cannot be undone."
								)}
							</p>
							{error && <div className={classes["auth-error"]}>{error}</div>}
						</>
					}
					confirmLabel={t("auth.deleteAccountButton", "Yes, delete my account")}
					cancelLabel={t("common.cancel", "Cancel")}
					onConfirm={handleDeleteAccount}
					onCancel={closeDeleteConfirm}
					isLoading={deleteLoading}
					confirmVariant="danger"
				/>
			)}
		</div>
	);
}

// =============================================================================
// Auth Page (combines Login/Register with routing)
// =============================================================================
export function AuthPage() {
	const { authState } = useAuth();
	const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");
	const [resetToken, setResetToken] = useState<string | null>(null);

	useEffect(() => {
		const fragment = window.location.hash;
		if (!fragment.startsWith("#reset-password?")) return;
		const token = new URLSearchParams(fragment.slice(fragment.indexOf("?") + 1)).get("token");
		window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
		if (token) {
			setResetToken(token);
			setMode("reset");
		}
	}, []);

	// Auto-show register if no users exist yet (first setup)
	useEffect(() => {
		if (authState?.needsSetup) {
			setMode("register");
		}
	}, [authState?.needsSetup]);

	if (mode === "register") {
		return <RegisterForm onSuccess={() => setMode("login")} onSwitchToLogin={() => setMode("login")} />;
	}
	if (mode === "forgot") return <ForgotPasswordForm onBack={() => setMode("login")} />;
	if (mode === "reset" && resetToken) return <ResetPasswordForm token={resetToken} onBack={() => setMode("login")} />;

	return (
		<LoginForm
			onSwitchToRegister={authState?.registrationEnabled ? () => setMode("register") : undefined}
			onSwitchToForgot={() => setMode("forgot")}
		/>
	);
}
