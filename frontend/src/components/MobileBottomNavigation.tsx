import { CalendarDays, LayoutDashboard, Pill, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useUnsavedChanges } from "../context";
import classes from "./MobileBottomNavigation.module.css";

const navigationItems = [
	{ path: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
	{ path: "/medications", label: "nav.medications", icon: Pill },
	{ path: "/planner", label: "nav.planner", icon: CalendarDays },
	{ path: "/settings", label: "nav.settings", icon: Settings },
] as const;

export function MobileBottomNavigation() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const { confirmNavigation } = useUnsavedChanges();
	const navigationRef = useRef<HTMLElement>(null);
	const [isModalOpen, setIsModalOpen] = useState(
		() => typeof document !== "undefined" && document.documentElement.classList.contains("modal-open")
	);

	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => {
			setIsModalOpen(root.classList.contains("modal-open"));
		});
		observer.observe(root, { attributeFilter: ["class"], attributes: true });

		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const navigation = navigationRef.current;
		const root = document.documentElement;
		if (!navigation) return;

		const updateClearance = () => {
			if (window.innerWidth > 700 || isModalOpen) {
				root.style.removeProperty("--mobile-bottom-nav-clearance");
				return;
			}

			const bounds = navigation.getBoundingClientRect();
			if (bounds.height === 0) {
				root.style.removeProperty("--mobile-bottom-nav-clearance");
				return;
			}

			const bottomInset = Math.max(0, window.innerHeight - bounds.bottom);
			root.style.setProperty("--mobile-bottom-nav-clearance", `${Math.ceil(bounds.height + bottomInset + 16)}px`);
		};

		updateClearance();
		window.addEventListener("resize", updateClearance);

		const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateClearance);
		resizeObserver?.observe(navigation);

		return () => {
			window.removeEventListener("resize", updateClearance);
			resizeObserver?.disconnect();
			root.style.removeProperty("--mobile-bottom-nav-clearance");
		};
	}, [isModalOpen]);

	const isActivePath = (path: (typeof navigationItems)[number]["path"]) =>
		path === "/dashboard"
			? location.pathname === "/" || location.pathname === "/dashboard"
			: location.pathname === path;

	const handleNavigate = async (path: string) => {
		if (await confirmNavigation()) {
			navigate(path);
		}
	};

	return (
		<nav
			ref={navigationRef}
			aria-label={t("nav.primaryNavigation")}
			aria-hidden={isModalOpen || undefined}
			className={classes.mobileNavigation}
			data-testid="mobile-main-nav"
			hidden={isModalOpen}
			inert={isModalOpen || undefined}
		>
			{navigationItems.map(({ path, label, icon: Icon }) => (
				<button
					key={path}
					type="button"
					aria-current={isActivePath(path) ? "page" : undefined}
					className={classes.navButton}
					onClick={() => {
						void handleNavigate(path);
					}}
				>
					<Icon aria-hidden="true" className={classes.navIcon} size={19} strokeWidth={2} />
					<span className={classes.navLabel}>{t(label)}</span>
				</button>
			))}
		</nav>
	);
}
