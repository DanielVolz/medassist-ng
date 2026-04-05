/**
 * AppHeader - Main application header with navigation and user menu
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useUnsavedChanges } from "../context";
import { useTheme } from "../hooks";
import { useAuth } from "./Auth";

interface AppHeaderProps {
	onOpenProfile: () => void;
	onOpenAbout: () => void;
}

export function AppHeader({ onOpenProfile, onOpenAbout }: AppHeaderProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const currentPath = location.pathname;
	const { user, authState, logout } = useAuth();
	const { theme, themePreference, setThemePreference } = useTheme();
	const { confirmNavigation } = useUnsavedChanges();

	// Theme dropdown state
	const [themeMenuOpen, setThemeMenuOpen] = useState(false);
	const themeMenuRef = useRef<HTMLDivElement>(null);

	// Close theme dropdown when clicking outside
	useEffect(() => {
		if (!themeMenuOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
				setThemeMenuOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [themeMenuOpen]);

	// Safe navigation that checks for unsaved changes first
	const safeNavigate = async (path: string) => {
		if (await confirmNavigation()) {
			navigate(path);
		}
	};

	// User dropdown state (for mobile click-based behavior)
	const [userDropdownOpen, setUserDropdownOpen] = useState(false);

	// Close user dropdown when clicking outside
	useEffect(() => {
		if (!userDropdownOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest(".user-menu")) {
				setUserDropdownOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [userDropdownOpen]);

	// Page titles based on current route
	const pageInfo = {
		"/dashboard": { eyebrow: t("header.eyebrow.overview"), title: t("nav.dashboard") },
		"/medications": { eyebrow: t("header.eyebrow.inventory"), title: t("nav.medications") },
		"/planner": { eyebrow: t("header.eyebrow.planner"), title: t("nav.planner") },
		"/settings": { eyebrow: t("header.eyebrow.settings"), title: t("nav.settings") },
		"/schedule": { eyebrow: t("header.eyebrow.schedule"), title: t("dashboard.schedules.title") },
	}[currentPath] || { eyebrow: t("header.eyebrow.overview"), title: t("nav.dashboard") };

	return (
		<header className="hero" data-testid="app-header">
			<div className="hero-title">
				<img src="/app-logo.png" alt="MedAssist-ng" className="hero-logo" />
				<div>
					<p className="eyebrow">{pageInfo.eyebrow}</p>
					<h1>{pageInfo.title}</h1>
				</div>
			</div>
			<div className="header-actions">
				<div className="tabs" data-testid="main-nav">
					<button
						className={currentPath === "/dashboard" || currentPath === "/" ? "pill primary" : "pill"}
						onClick={() => safeNavigate("/dashboard")}
					>
						{t("nav.dashboard")}
					</button>
					<button
						className={currentPath === "/medications" ? "pill primary" : "pill"}
						onClick={() => safeNavigate("/medications")}
					>
						{t("nav.medications")}
					</button>
					<button
						className={currentPath === "/planner" ? "pill primary" : "pill"}
						onClick={() => safeNavigate("/planner")}
					>
						{t("nav.planner")}
					</button>
				</div>
				{/* Settings button only shown when auth is disabled (no user dropdown available) */}
				{!authState?.authEnabled && (
					<button
						className={`icon-btn ${currentPath === "/settings" ? "active" : ""}`}
						onClick={() => safeNavigate("/settings")}
						title={t("nav.settings")}
					>
						⚙️
					</button>
				)}
				<div className={`theme-menu ${themeMenuOpen ? "open" : ""}`} ref={themeMenuRef}>
					<button className="icon-btn" onClick={() => setThemeMenuOpen(!themeMenuOpen)} title={t("theme.title")}>
						{theme === "dark" ? "🌙" : "☀️"}
					</button>
					<div className="theme-dropdown">
						<button
							className={`theme-dropdown-item${themePreference === "light" ? " active" : ""}`}
							onClick={() => {
								setThemePreference("light");
								setThemeMenuOpen(false);
							}}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<circle cx="12" cy="12" r="5" />
								<line x1="12" y1="1" x2="12" y2="3" />
								<line x1="12" y1="21" x2="12" y2="23" />
								<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
								<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
								<line x1="1" y1="12" x2="3" y2="12" />
								<line x1="21" y1="12" x2="23" y2="12" />
								<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
								<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
							</svg>
							{t("theme.light")}
							{themePreference === "light" && <span className="theme-check">✓</span>}
						</button>
						<button
							className={`theme-dropdown-item${themePreference === "dark" ? " active" : ""}`}
							onClick={() => {
								setThemePreference("dark");
								setThemeMenuOpen(false);
							}}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
							</svg>
							{t("theme.dark")}
							{themePreference === "dark" && <span className="theme-check">✓</span>}
						</button>
						<button
							className={`theme-dropdown-item${themePreference === "system" ? " active" : ""}`}
							onClick={() => {
								setThemePreference("system");
								setThemeMenuOpen(false);
							}}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
								<line x1="8" y1="21" x2="16" y2="21" />
								<line x1="12" y1="17" x2="12" y2="21" />
							</svg>
							{t("theme.system")}
							{themePreference === "system" && <span className="theme-check">✓</span>}
						</button>
					</div>
				</div>
				{authState?.authEnabled && user && (
					<div className={`user-menu ${userDropdownOpen ? "open" : ""}`}>
						<button
							className="user-menu-btn"
							data-testid="user-menu-trigger"
							onClick={() => setUserDropdownOpen(!userDropdownOpen)}
						>
							{user.avatarUrl ? (
								<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className="user-avatar-img" />
							) : (
								<span className="user-avatar">{user.username.charAt(0).toUpperCase()}</span>
							)}
						</button>
						<div className="user-dropdown">
							<div className="dropdown-header">
								{user.avatarUrl ? (
									<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className="dropdown-avatar-img" />
								) : (
									<div className="dropdown-avatar">{user.username.charAt(0).toUpperCase()}</div>
								)}
								<span className="dropdown-username">{user.username}</span>
							</div>
							<div className="dropdown-menu">
								<button
									className="dropdown-item"
									data-testid="user-menu-profile"
									onClick={() => {
										onOpenProfile();
										setUserDropdownOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
										<circle cx="12" cy="7" r="4" />
									</svg>
									{t("auth.profile", "Profile")}
								</button>
								<button
									className="dropdown-item"
									data-testid="user-menu-settings"
									onClick={() => {
										safeNavigate("/settings");
										setUserDropdownOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<circle cx="12" cy="12" r="3" />
										<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
									</svg>
									{t("nav.settings", "Settings")}
								</button>
								<button
									className="dropdown-item"
									data-testid="user-menu-about"
									onClick={() => {
										onOpenAbout();
										setUserDropdownOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<circle cx="12" cy="12" r="10" />
										<path d="M12 16v-4" />
										<path d="M12 8h.01" />
									</svg>
									{t("about.title", "About")}
								</button>
								<button
									className="dropdown-item danger"
									data-testid="user-menu-signout"
									onClick={() => {
										logout();
										setUserDropdownOpen(false);
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
										<polyline points="16 17 21 12 16 7" />
										<line x1="21" y1="12" x2="9" y2="12" />
									</svg>
									{t("auth.signOut", "Sign Out")}
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</header>
	);
}
