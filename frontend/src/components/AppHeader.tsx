/**
 * AppHeader - Main application header with navigation and user menu
 */
import { ActionIcon, Avatar, Group, Menu, Paper, Text, UnstyledButton } from "@mantine/core";
import { Info, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useUnsavedChanges } from "../context";
import { useTheme } from "../hooks";
import { AppTooltip } from "../ui/primitives/AppTooltip";
import classes from "./AppHeader.module.css";
import { useAuth } from "./Auth";
import { ThemeMenu } from "./ThemeMenu";

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

	// Safe navigation that checks for unsaved changes first
	const safeNavigate = async (path: string) => {
		if (await confirmNavigation()) {
			navigate(path);
		}
	};

	// Page titles based on current route
	const pageInfo = {
		"/dashboard": { eyebrow: t("header.eyebrow.overview"), title: t("nav.dashboard") },
		"/medications": { eyebrow: t("header.eyebrow.inventory"), title: t("nav.medications") },
		"/planner": { eyebrow: t("header.eyebrow.planner"), title: t("nav.planner") },
		"/settings": { eyebrow: t("header.eyebrow.settings"), title: t("nav.settings") },
		"/schedule": { eyebrow: t("header.eyebrow.schedule"), title: t("dashboard.schedules.title") },
	}[currentPath] || { eyebrow: t("header.eyebrow.overview"), title: t("nav.dashboard") };

	const navigationItems = [
		{ path: "/dashboard", label: t("nav.dashboard") },
		{ path: "/medications", label: t("nav.medications") },
		{ path: "/planner", label: t("nav.planner") },
	] as const;

	const isActivePath = (path: string) =>
		path === "/dashboard" ? currentPath === "/" || currentPath === "/dashboard" : currentPath === path;

	return (
		<Paper className={classes.header} component="header" data-testid="app-header">
			<Group className={classes.titleGroup} gap="sm" wrap="nowrap">
				<img src="/app-logo.png" alt="MedAssist-ng" className={classes.logo} />
				<div className={classes.titleCopy}>
					<Text className={classes.eyebrow} component="p">
						{pageInfo.eyebrow}
					</Text>
					<Text className={classes.title} component="h1">
						{pageInfo.title}
					</Text>
				</div>
			</Group>
			<Group className={classes.actions} gap="sm" wrap="nowrap">
				<Group className={classes.nav} data-testid="main-nav" gap={4} wrap="nowrap">
					{navigationItems.map((item) => (
						<UnstyledButton
							key={item.path}
							aria-current={isActivePath(item.path) ? "page" : undefined}
							className={classes.navButton}
							data-active={isActivePath(item.path) || undefined}
							onClick={() => {
								void safeNavigate(item.path);
							}}
							type="button"
						>
							{item.label}
						</UnstyledButton>
					))}
				</Group>
				<Group className={classes.controls} gap="sm" wrap="nowrap">
					{/* Settings button only shown when auth is disabled (no user dropdown available) */}
					{!authState?.authEnabled && (
						<AppTooltip label={t("nav.settings")}>
							<ActionIcon
								aria-label={t("nav.settings")}
								className={classes.iconButton}
								color="brand"
								data-active={currentPath === "/settings" || undefined}
								onClick={() => {
									void safeNavigate("/settings");
								}}
								radius="xl"
								size="input-sm"
								variant="subtle"
							>
								<Settings size={18} />
							</ActionIcon>
						</AppTooltip>
					)}
					<ThemeMenu resolvedTheme={theme} themePreference={themePreference} onChange={setThemePreference} />
					{authState?.authEnabled && user && (
						<Menu position="bottom-end" width={220}>
							<Menu.Target>
								<ActionIcon
									aria-label={user.username}
									className={classes.userMenuTrigger}
									data-testid="user-menu-trigger"
									radius="xl"
									size="input-sm"
									type="button"
									variant="subtle"
								>
									<Avatar
										alt={user.username}
										className={classes.userAvatar}
										radius="xl"
										size={36}
										src={user.avatarUrl ? `/api/images/${user.avatarUrl}` : undefined}
									>
										{user.username.charAt(0).toUpperCase()}
									</Avatar>
								</ActionIcon>
							</Menu.Target>
							<Menu.Dropdown data-testid="user-menu-dropdown">
								<Group className={classes.dropdownHeader} gap="sm" wrap="nowrap">
									<Avatar
										alt={user.username}
										radius="xl"
										size={32}
										src={user.avatarUrl ? `/api/images/${user.avatarUrl}` : undefined}
									>
										{user.username.charAt(0).toUpperCase()}
									</Avatar>
									<Text className={classes.dropdownUsername}>{user.username}</Text>
								</Group>
								<Menu.Divider />
								<Menu.Item data-testid="user-menu-profile" leftSection={<UserIcon size={16} />} onClick={onOpenProfile}>
									{t("auth.profile")}
								</Menu.Item>
								<Menu.Item
									data-testid="user-menu-settings"
									leftSection={<Settings size={16} />}
									onClick={() => {
										void safeNavigate("/settings");
									}}
								>
									{t("nav.settings")}
								</Menu.Item>
								<Menu.Item data-testid="user-menu-about" leftSection={<Info size={16} />} onClick={onOpenAbout}>
									{t("about.title")}
								</Menu.Item>
								<Menu.Divider />
								<Menu.Item
									data-testid="user-menu-signout"
									color="red"
									leftSection={<LogOut size={16} />}
									onClick={() => {
										void logout();
									}}
								>
									{t("auth.signOut")}
								</Menu.Item>
							</Menu.Dropdown>
						</Menu>
					)}
				</Group>
			</Group>
		</Paper>
	);
}
