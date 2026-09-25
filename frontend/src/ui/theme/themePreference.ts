export type Theme = "light" | "dark";
type ThemePreference = "light" | "dark" | "system";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: light)";

function getSystemTheme(): Theme {
	if (typeof window !== "undefined" && window.matchMedia?.(SYSTEM_THEME_QUERY).matches) {
		return "light";
	}

	return "dark";
}

function resolveStoredThemePreference(value: string | null | undefined): ThemePreference {
	if (value === "light" || value === "dark" || value === "system") {
		return value;
	}

	return "dark";
}

function resolveThemePreference(preference: ThemePreference): Theme {
	return preference === "system" ? getSystemTheme() : preference;
}

function getInitialThemePreference(): ThemePreference {
	if (typeof window === "undefined") {
		return "dark";
	}

	return resolveStoredThemePreference(window.localStorage.getItem("theme"));
}

export function getInitialTheme(): Theme {
	if (typeof document !== "undefined") {
		const attributeTheme = document.documentElement.getAttribute("data-theme");
		if (attributeTheme === "light" || attributeTheme === "dark") {
			return attributeTheme;
		}
	}

	return resolveThemePreference(getInitialThemePreference());
}

export function toMantineColorScheme(theme: Theme): "light" | "dark" {
	return theme === "light" ? "light" : "dark";
}
