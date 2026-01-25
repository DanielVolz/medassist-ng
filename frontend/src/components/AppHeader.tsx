/**
 * AppHeader - Main application header with navigation and user menu
 */
import { useEffect, useState } from "react";
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
	const { theme, toggleTheme } = useTheme();
	const { confirmNavigation } = useUnsavedChanges();

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
		<header className="hero">
			<div className="hero-title">
				<img src="/favicon.svg" alt="MedAssist-ng" className="hero-logo" />
				<div>
					<p className="eyebrow">{pageInfo.eyebrow}</p>
					<h1>{pageInfo.title}</h1>
				</div>
			</div>
			<div className="header-actions">
				<div className="tabs">
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
				<button
					className="icon-btn"
					onClick={toggleTheme}
					title={theme === "dark" ? t("tooltips.lightMode") : t("tooltips.darkMode")}
				>
					{theme === "dark" ? "☀️" : "🌙"}
				</button>
				{authState?.authEnabled && user && (
					<div className={`user-menu ${userDropdownOpen ? "open" : ""}`}>
						<button className="user-menu-btn" onClick={() => setUserDropdownOpen(!userDropdownOpen)}>
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
