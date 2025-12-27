import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";

// =============================================================================
// Types (no roles - all users are equal)
// =============================================================================
export interface User {
  id: number;
  username: string;
}

export interface AuthState {
  authEnabled: boolean;
  registrationEnabled: boolean;
  localAuthEnabled: boolean;
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

  // Fetch auth state on mount
  useEffect(() => {
    fetchAuthState();
  }, []);

  // Proactively refresh token every 10 minutes to prevent expiration
  useEffect(() => {
    if (!user || !authState?.authEnabled) return;
    
    const refreshInterval = setInterval(async () => {
      const success = await tryRefreshToken();
      if (!success) {
        // Refresh failed - check if user is still valid
        await refreshUser();
      }
    }, 10 * 60 * 1000); // 10 minutes (before 15 min access token expires)
    
    return () => clearInterval(refreshInterval);
  }, [user, authState?.authEnabled]);

  async function fetchAuthState() {
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
    } catch (err) {
      console.error("Failed to fetch auth state:", err);
      setAuthError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
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

  // Fetch wrapper that automatically refreshes token on 401
  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
  }, []);

  return (
    <AuthContext.Provider value={{ user, authState, loading, authError, login, register, logout, refreshUser, updateProfile, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

// =============================================================================
// Login Form
// =============================================================================
export function LoginForm({ onSuccess, onSwitchToRegister }: { onSuccess?: () => void; onSwitchToRegister?: () => void }) {
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
        <h1 className="auth-title">💊 MedAssist</h1>
        <h2 className="auth-subtitle">{t("auth.login", "Login")}</h2>

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
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t("auth.password", "Password")}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>{t("auth.rememberMe", "Remember me")}</span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading ? t("common.loading", "Loading...") : t("auth.login", "Login")}
          </button>
        </form>

        {authState?.registrationEnabled && onSwitchToRegister && (
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
        <h1 className="auth-title">💊 MedAssist</h1>
        <h2 className="auth-subtitle">
          {t("auth.register", "Create Account")}
        </h2>

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
              autoFocus
              minLength={3}
              maxLength={50}
              pattern="[a-zA-Z0-9_-]+"
              title={t("auth.usernameHint", "Letters, numbers, underscores, and hyphens only")}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t("auth.password", "Password")} *</label>
            <input
              id="password"
              type="password"
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
            <input
              id="confirmPassword"
              type="password"
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
  const { user, logout, updateProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword && newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch", "Passwords do not match"));
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

  async function handleLogout() {
    await logout();
    onClose?.();
  }

  if (!user) return null;

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h2>{t("auth.profile", "Profile")}</h2>
      </div>

      <div className="profile-info">
        <p><strong>{t("auth.username", "Username")}:</strong> {user.username}</p>
      </div>

      <form onSubmit={handleUpdate} className="profile-form">
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        <h3>{t("auth.changePassword", "Change Password")}</h3>

        <div className="form-group">
          <label htmlFor="current-password">{t("auth.currentPassword", "Current Password")}</label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="form-group">
          <label htmlFor="new-password">{t("auth.newPassword", "New Password")}</label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </div>

        <div className="form-group">
          <label htmlFor="confirm-new-password">{t("auth.confirmPassword", "Confirm Password")}</label>
          <input
            id="confirm-new-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="profile-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? t("common.loading", "Loading...") : t("common.save", "Save")}
          </button>
          <button type="button" className="btn btn-danger" onClick={handleLogout}>
            {t("auth.logout", "Logout")}
          </button>
        </div>
      </form>
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
    return (
      <RegisterForm 
        onSuccess={() => setMode("login")} 
        onSwitchToLogin={() => setMode("login")}
      />
    );
  }

  return (
    <LoginForm 
      onSwitchToRegister={authState?.registrationEnabled ? () => setMode("register") : undefined}
    />
  );
}
