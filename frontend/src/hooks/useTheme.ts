// =============================================================================
// useTheme Hook - Theme (dark/light/system mode) state management
// =============================================================================

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = "light" | "dark" | "system";

export interface UseThemeReturn {
	/** The resolved theme applied to the DOM ("light" | "dark") */
	theme: Theme;
	/** The user's preference ("light" | "dark" | "system") */
	themePreference: ThemePreference;
	/** Set the theme preference */
	setThemePreference: (pref: ThemePreference) => void;
	/** Legacy toggle: cycles light → dark → system → light */
	toggleTheme: () => void;
}

function getSystemTheme(): Theme {
	if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
		return "light";
	}
	return "dark";
}

function resolveTheme(pref: ThemePreference): Theme {
	return pref === "system" ? getSystemTheme() : pref;
}

export function useTheme(): UseThemeReturn {
	const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
		if (typeof window !== "undefined") {
			const stored = localStorage.getItem("theme") as ThemePreference | null;
			if (stored === "light" || stored === "dark" || stored === "system") return stored;
			return "dark";
		}
		return "dark";
	});

	const [theme, setTheme] = useState<Theme>(() => resolveTheme(themePreference));

	// Apply resolved theme to DOM whenever preference or system theme changes
	useEffect(() => {
		const resolved = resolveTheme(themePreference);
		setTheme(resolved);
		document.documentElement.setAttribute("data-theme", resolved);
		localStorage.setItem("theme", themePreference);
	}, [themePreference]);

	// Listen for system theme changes when preference is "system"
	useEffect(() => {
		if (themePreference !== "system") return;
		const mq = window.matchMedia?.("(prefers-color-scheme: light)");
		if (!mq) return;

		const handler = () => {
			const resolved = resolveTheme("system");
			setTheme(resolved);
			document.documentElement.setAttribute("data-theme", resolved);
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [themePreference]);

	const setThemePreference = useCallback((pref: ThemePreference) => {
		setThemePreferenceState(pref);
	}, []);

	const toggleTheme = useCallback(() => {
		setThemePreferenceState((prev) => {
			if (prev === "light") return "dark";
			if (prev === "dark") return "system";
			return "light";
		});
	}, []);

	return { theme, themePreference, setThemePreference, toggleTheme };
}
