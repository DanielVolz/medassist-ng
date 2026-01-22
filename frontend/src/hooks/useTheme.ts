// =============================================================================
// useTheme Hook - Theme (dark/light mode) state management
// =============================================================================

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export interface UseThemeReturn {
	theme: Theme;
	toggleTheme: () => void;
}

export function useTheme(): UseThemeReturn {
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window !== "undefined") {
			return (localStorage.getItem("theme") as Theme) || "dark";
		}
		return "dark";
	});

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("theme", theme);
	}, [theme]);

	const toggleTheme = useCallback(() => {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}, []);

	return { theme, toggleTheme };
}
