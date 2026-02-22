/* biome-ignore-all lint/correctness/useExhaustiveDependencies: auth refresh callbacks intentionally coordinate via refs/guards */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { log } from "../utils/logger";
import { ConfirmModal } from "./ConfirmModal";
import { PasswordInput } from "./PasswordInput";

// =============================================================================
// Types (no roles - all users are equal)
// =============================================================================
export interface User {
	id: number;
	username: string;
	avatarUrl?: string | null;
}

export interface AuthState {
	authEnabled: boolean;
	registrationEnabled: boolean;
	localAuthEnabled: boolean;
	oidcEnabled: boolean;
	oidcProviderName: string;
	hasUsers: boolean;
	needsSetup: boolean;
}

interface AuthContextType {
	user: User | null;
	authState: AuthState | null;
	loading: boolean;
	authError: string | null;
	login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
	register: (username: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	refreshUser: () => Promise<void>;
	updateProfile: (data: { currentPassword?: string; newPassword?: string }) => Promise<void>;
	uploadAvatar: (file: File) => Promise<void>;
	deleteAvatar: () => Promise<void>;
	deleteAccount: () => Promise<void>;
	authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

// =============================================================================
// Context
// =============================================================================
const AuthContext = createContext<AuthContextType | null>(null);

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

	// Track if initial fetch has been done to prevent duplicate calls
	const initialFetchDone = useRef(false);

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

		try {
			setAuthError(null);
			const res = await fetch("/api/auth/state");
			if (!res.ok) {
				throw new Error(`Server error: ${res.status}`);
			}
			const state = await res.json();
			setAuthState(state);

			// If auth is enabled and we might be logged in, check session
			if (state.authEnabled) {
				await refreshUser();
			}
			setLoading(false);
		} catch (err) {
			log.error(`Failed to fetch auth state (attempt ${retryCount + 1}/${maxRetries + 1}):`, err);

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
			const res = await fetch("/api/auth/me", { credentials: "include" });
			if (res.ok) {
				const userData = await res.json();
				setUser(userData);
			} else if (res.status === 401) {
				// Access token expired - try to refresh it
				const refreshed = await tryRefreshToken();
				if (refreshed) {
					// Retry /auth/me with new token
					const retryRes = await fetch("/api/auth/me", { credentials: "include" });
					if (retryRes.ok) {
						const userData = await retryRes.json();
						setUser(userData);
						return;
					}
				}
				setUser(null);
			} else {
				setUser(null);
			}
		} catch {
			setUser(null);
		}
	}

	// Try to refresh the access token using the refresh token
	async function tryRefreshToken(): Promise<boolean> {
		try {
			const res = await fetch("/api/auth/refresh", {
				method: "POST",
				credentials: "include",
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function login(username: string, password: string, rememberMe: boolean = false) {
		const res = await fetch("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ username, password, rememberMe }),
		});

		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || "Login failed");
		}

		const data = await res.json();
		setUser(data.user);
	}

	async function register(username: string, password: string) {
		const res = await fetch("/api/auth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ username, password }),
		});

		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || "Registration failed");
		}

		// Auto-login after registration
		await login(username, password);

		// Refresh auth state (registration might disable further registrations)
		await fetchAuthState();
	}

	async function logout() {
		await fetch("/api/auth/logout", {
			method: "POST",
			credentials: "include",
		});
		setUser(null);
	}

	async function updateProfile(data: { currentPassword?: string; newPassword?: string }) {
		const res = await fetch("/api/auth/me", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			const err = await res.json();
			throw new Error(err.error || "Update failed");
		}

		await refreshUser();
	}

	// Upload avatar
	async function uploadAvatar(file: File) {
		const formData = new FormData();
		formData.append("file", file);

		const res = await fetch("/api/auth/avatar", {
			method: "POST",
			credentials: "include",
			body: formData,
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Upload failed" }));
			throw new Error(err.error || "Upload failed");
		}

		await refreshUser();
	}

	// Delete avatar
	async function deleteAvatar() {
		const res = await fetch("/api/auth/avatar", {
			method: "DELETE",
			credentials: "include",
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Delete failed" }));
			throw new Error(err.error || "Delete failed");
		}

		await refreshUser();
	}

	// Delete account
	async function deleteAccount() {
		const res = await fetch("/api/auth/me", {
			method: "DELETE",
			credentials: "include",
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Delete failed" }));
			throw new Error(err.error || "Delete failed");
		}

		setUser(null);
	}

	// Fetch wrapper that automatically refreshes token on 401
	const authFetch = useCallback(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const options: RequestInit = {
				...init,
				credentials: "include",
			};

			let res = await fetch(input, options);

			// If 401 and not already a refresh/login request, try to refresh token
			if (res.status === 401 && !String(input).includes("/auth/")) {
				const refreshed = await tryRefreshToken();
				if (refreshed) {
					// Retry the original request with new token
					res = await fetch(input, options);
				} else {
					// Refresh failed - user needs to login again
					setUser(null);
				}
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
				login,
				register,
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
}: {
	onSuccess?: () => void;
	onSwitchToRegister?: () => void;
}) {
	const { t } = useTranslation();
	const { login, authState } = useAuth();
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
		<div className="auth-container">
			<div className="auth-card">
				<h1 className="auth-title">💊 MedAssist-ng</h1>
				<h2 className="auth-subtitle">{t("auth.login", "Login")}</h2>

				{/* SSO Login Button */}
				{authState?.oidcEnabled && (
					<div className="auth-sso">
						<button
							type="button"
							className="btn btn-secondary auth-submit sso-btn"
							onClick={() => (window.location.href = "/api/auth/oidc/login")}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sso-icon">
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
								<polyline points="10 17 15 12 10 7" />
								<line x1="15" y1="12" x2="3" y2="12" />
							</svg>
							{t("auth.loginWithSSO", "Login with {{provider}}", { provider: authState.oidcProviderName || "SSO" })}
						</button>
						{authState?.localAuthEnabled && (
							<div className="auth-divider">
								<span>{t("auth.or", "or")}</span>
							</div>
						)}
					</div>
				)}

				{/* Local Login Form - only show if local auth is enabled */}
				{authState?.localAuthEnabled && (
					<form onSubmit={handleSubmit} className="auth-form">
						{error && <div className="auth-error">{error}</div>}

						<div className="form-group">
							<label htmlFor="username">{t("auth.username", "Username")}</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								required
								autoComplete="username"
							/>
						</div>

						<div className="form-group">
							<label htmlFor="password">{t("auth.password", "Password")}</label>
							<PasswordInput
								id="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
							/>
						</div>

						<div className="form-group checkbox-group">
							<label className="checkbox-label">
								<input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
								<span>{t("auth.rememberMe", "Remember me")}</span>
							</label>
						</div>

						<button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
							{loading ? t("common.loading", "Loading...") : t("auth.login", "Login")}
						</button>
					</form>
				)}

				{authState?.registrationEnabled && authState?.localAuthEnabled && onSwitchToRegister && (
					<div className="auth-links">
						<button type="button" className="auth-link-btn" onClick={onSwitchToRegister}>
							{t("auth.createAccount", "Create account")}
						</button>
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
			await register(username, password);
			onSuccess?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Registration failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="auth-container">
			<div className="auth-card">
				<h1 className="auth-title">💊 MedAssist-ng</h1>
				<h2 className="auth-subtitle">{t("auth.register", "Create Account")}</h2>

				{/* SSO Login Button - also show on registration */}
				{authState?.oidcEnabled && (
					<div className="auth-sso">
						<button
							type="button"
							className="btn btn-secondary auth-submit sso-btn"
							onClick={() => (window.location.href = "/api/auth/oidc/login")}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sso-icon">
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
								<polyline points="10 17 15 12 10 7" />
								<line x1="15" y1="12" x2="3" y2="12" />
							</svg>
							{t("auth.loginWithSSO", "Login with {{provider}}", { provider: authState.oidcProviderName || "SSO" })}
						</button>
						{authState?.localAuthEnabled && (
							<div className="auth-divider">
								<span>{t("auth.or", "or")}</span>
							</div>
						)}
					</div>
				)}

				{/* Local Registration Form - only show if local auth is enabled */}
				{authState?.localAuthEnabled && (
					<form onSubmit={handleSubmit} className="auth-form">
						{error && <div className="auth-error">{error}</div>}

						<div className="form-group">
							<label htmlFor="username">{t("auth.username", "Username")} *</label>
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
								title={t("auth.usernameHint", "Letters, numbers, underscores, and hyphens only")}
							/>
						</div>

						<div className="form-group">
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

						<div className="form-group">
							<label htmlFor="confirmPassword">{t("auth.confirmPassword", "Confirm Password")} *</label>
							<PasswordInput
								id="confirmPassword"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								autoComplete="new-password"
							/>
						</div>

						<button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
							{loading ? t("common.loading", "Loading...") : t("auth.register", "Create Account")}
						</button>
					</form>
				)}

				{onSwitchToLogin && (
					<div className="auth-links">
						<button type="button" className="auth-link-btn" onClick={onSwitchToLogin}>
							{t("auth.alreadyHaveAccount", "Already have an account? Login")}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

// =============================================================================
// User Profile Component
// =============================================================================
export function UserProfile({ onClose }: { onClose?: () => void }) {
	const { t } = useTranslation();
	const { user, updateProfile, uploadAvatar, deleteAvatar, deleteAccount } = useAuth();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [loading, setLoading] = useState(false);
	const [avatarLoading, setAvatarLoading] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEscapeKey(!!onClose, onClose ?? (() => {}));

	async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		setAvatarLoading(true);
		setError("");
		try {
			await uploadAvatar(file);
			setSuccess(t("auth.avatarUpdated", "Avatar updated"));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setAvatarLoading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}

	async function handleAvatarDelete() {
		setAvatarLoading(true);
		setError("");
		try {
			await deleteAvatar();
			setSuccess(t("auth.avatarRemoved", "Avatar removed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
		} finally {
			setAvatarLoading(false);
		}
	}

	async function handleUpdate(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setSuccess("");

		if (newPassword && newPassword !== confirmPassword) {
			setError(t("auth.passwordMismatch", "Passwords do not match"));
			return;
		}

		if (!currentPassword || !newPassword) {
			setError(t("auth.fillAllFields", "Please fill in all password fields"));
			return;
		}

		setLoading(true);

		try {
			await updateProfile({
				currentPassword: currentPassword || undefined,
				newPassword: newPassword || undefined,
			});
			setSuccess(t("auth.profileUpdated", "Profile updated successfully"));
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

	const hasChanges = currentPassword || newPassword || confirmPassword;

	return (
		<div className="profile-container">
			<div className="profile-user-section">
				<div className="profile-avatar-wrapper">
					{user.avatarUrl ? (
						<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className="profile-avatar-img" />
					) : (
						<div className="profile-avatar">{user.username.charAt(0).toUpperCase()}</div>
					)}
					<input
						type="file"
						ref={fileInputRef}
						onChange={handleAvatarUpload}
						accept="image/jpeg,image/png,image/webp,image/gif"
						style={{ display: "none" }}
					/>
					<div className="profile-avatar-actions">
						<button
							type="button"
							className="avatar-btn"
							onClick={() => fileInputRef.current?.click()}
							disabled={avatarLoading}
							title={t("auth.uploadAvatar", "Upload avatar")}
						>
							📷
						</button>
						{user.avatarUrl && (
							<button
								type="button"
								className="avatar-btn danger"
								onClick={handleAvatarDelete}
								disabled={avatarLoading}
								title={t("auth.removeAvatar", "Remove avatar")}
							>
								🗑
							</button>
						)}
					</div>
				</div>
				<span className="profile-username">{user.username}</span>
			</div>

			<form onSubmit={handleUpdate} className="profile-form">
				<div className="profile-section">
					<h3 className="profile-section-title">{t("auth.changePassword", "Change Password")}</h3>

					{error && <div className="auth-error">{error}</div>}
					{success && <div className="auth-success">{success}</div>}

					<div className="form-group">
						<label htmlFor="current-password">{t("auth.currentPassword", "Current Password")}</label>
						<PasswordInput
							id="current-password"
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							autoComplete="current-password"
							placeholder="••••••••"
						/>
					</div>

					<div className="form-group">
						<label htmlFor="new-password">{t("auth.newPassword", "New Password")}</label>
						<PasswordInput
							id="new-password"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							autoComplete="new-password"
							minLength={8}
							placeholder="••••••••"
						/>
					</div>

					<div className="form-group">
						<label htmlFor="confirm-new-password">{t("auth.confirmPassword", "Confirm Password")}</label>
						<PasswordInput
							id="confirm-new-password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							autoComplete="new-password"
							placeholder="••••••••"
						/>
					</div>
				</div>

				<div className="profile-actions">
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						{t("common.close", "Close")}
					</button>
					<button type="submit" className="btn btn-primary" disabled={loading || !hasChanges}>
						{loading ? t("common.saving", "Saving...") : t("auth.updatePassword", "Update Password")}
					</button>
				</div>
			</form>

			{/* Delete Account Section */}
			<div className="profile-section profile-danger-zone">
				<h3 className="profile-section-title">{t("auth.deleteAccount", "Delete Account")}</h3>
				<button type="button" className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
					{t("auth.deleteAccount", "Delete Account")}
				</button>
			</div>

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
							{error && <div className="auth-error">{error}</div>}
						</>
					}
					confirmLabel={t("auth.deleteAccountButton", "Yes, delete my account")}
					cancelLabel={t("common.cancel", "Cancel")}
					onConfirm={handleDeleteAccount}
					onCancel={() => setShowDeleteConfirm(false)}
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
	const [mode, setMode] = useState<"login" | "register">("login");

	// Auto-show register if no users exist yet (first setup)
	useEffect(() => {
		if (authState?.needsSetup) {
			setMode("register");
		}
	}, [authState?.needsSetup]);

	if (mode === "register") {
		return <RegisterForm onSuccess={() => setMode("login")} onSwitchToLogin={() => setMode("login")} />;
	}

	return <LoginForm onSwitchToRegister={authState?.registrationEnabled ? () => setMode("register") : undefined} />;
}
