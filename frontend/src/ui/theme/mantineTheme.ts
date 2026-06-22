import {
	ActionIcon,
	Button,
	type CSSVariablesResolver,
	createTheme,
	type MantineColorsTuple,
	Menu,
	Popover,
	Tooltip,
} from "@mantine/core";

/**
 * Clinical ledger palette — teal brand accent.
 * Tuple indexes used: 5 = dark-theme accent, 7 = light-theme accent.
 */
const brand: MantineColorsTuple = [
	"#e6faf4",
	"#c3f2e3",
	"#9be8d0",
	"#74dcbc",
	"#4fd6b2",
	"#2bbf99",
	"#1ca583",
	"#0d8a6a",
	"#0a7257",
	"#075c46",
];

/** Clinical danger red (#f0796c dark / #cf4537 light). Overrides Mantine `red`. */
const red: MantineColorsTuple = [
	"#fdf0ee",
	"#fadcd8",
	"#f6c0ba",
	"#f29d93",
	"#f0796c",
	"#e35f50",
	"#cf4537",
	"#b03a2e",
	"#913026",
	"#75271f",
];

/** Clinical warning amber (#e8b14e dark / #b27c10 light). Overrides Mantine `yellow`. */
const yellow: MantineColorsTuple = [
	"#fdf6e8",
	"#f9e9c8",
	"#f3d89e",
	"#f0bf69",
	"#e8b14e",
	"#d99c2e",
	"#c98e14",
	"#b27c10",
	"#936608",
	"#785305",
];

/** Success maps to the teal accent in the clinical palette. Overrides Mantine `green`. */
const green: MantineColorsTuple = [
	"#e6faf4",
	"#c3f2e3",
	"#9be8d0",
	"#74dcbc",
	"#4fd6b2",
	"#2bbf99",
	"#1ca583",
	"#0d8a6a",
	"#0a7257",
	"#075c46",
];

/** Informational blue (#7cc0e8 dark / #20768f light). Overrides Mantine `blue`. */
const blue: MantineColorsTuple = [
	"#ecf6fc",
	"#d4ecf8",
	"#b3ddf2",
	"#97cfed",
	"#7cc0e8",
	"#54a8d6",
	"#3a90bd",
	"#20768f",
	"#1a6076",
	"#144b5d",
];

const appFontFamily = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const appFontFamilyMonospace = '"IBM Plex Mono", ui-monospace, "SF Mono", monospace';
const floatingLayerZIndex = 2600;

/**
 * Semantic design tokens bridged from the legacy foundation.css `:root` / `[data-theme]` blocks.
 * Dark values are the defaults, light values are resolved via cssVariablesResolver.
 */
export interface MedAssistThemeOther {
	fontUi: string;
	fontData: string;
	bgPrimary: string;
	bgSecondary: string;
	bgTertiary: string;
	bgInput: string;
	bgGradient: string;
	borderPrimary: string;
	borderSecondary: string;
	textPrimary: string;
	textSecondary: string;
	textMuted: string;
	accent: string;
	accentLight: string;
	accentBg: string;
	success: string;
	successBg: string;
	danger: string;
	dangerBg: string;
	warning: string;
	warningBg: string;
	info: string;
	shadow: string;
	surfaceRadius: string;
	surfaceShadow: string;
	surfaceBorder: string;
	focusRing: string;
	buttonRadius: string;
	inputRadius: string;
	buttonRadiusRound: string;
	buttonShadow: string;
	buttonShadowHover: string;
	buttonPrimaryBg: string;
	buttonPrimaryHover: string;
	buttonSubtleHover: string;
	buttonDangerText: string;
	buttonSuccessText: string;
	buttonObsoleteBg: string;
	buttonObsoleteHover: string;
	buttonObsoleteText: string;
	buttonObsoleteBorder: string;
	buttonObsoleteShadow: string;
}

/** Clinical ledger — ink */
const darkTokens: MedAssistThemeOther = {
	fontUi: appFontFamily,
	fontData: appFontFamilyMonospace,
	bgPrimary: "#101314",
	bgSecondary: "#16191b",
	bgTertiary: "#1b1f22",
	bgInput: "#121516",
	bgGradient: "#101314",
	borderPrimary: "#272c30",
	borderSecondary: "#383f45",
	textPrimary: "#f0f2f3",
	textSecondary: "#8d979e",
	textMuted: "#c2cad0",
	accent: "#2bbf99",
	accentLight: "#4fd6b2",
	accentBg: "rgba(43, 191, 153, 0.1)",
	success: "#4fd6b2",
	successBg: "rgba(79, 214, 178, 0.09)",
	danger: "#f0796c",
	dangerBg: "rgba(240, 121, 108, 0.1)",
	warning: "#e8b14e",
	warningBg: "rgba(232, 177, 78, 0.1)",
	info: "#7cc0e8",
	shadow: "rgba(0, 0, 0, 0.4)",
	surfaceRadius: "10px",
	surfaceShadow: "none",
	surfaceBorder: "1px solid var(--border-primary)",
	focusRing: "0 0 0 3px rgba(43, 191, 153, 0.32)",
	buttonRadius: "8px",
	inputRadius: "8px",
	buttonRadiusRound: "50%",
	buttonShadow: "none",
	buttonShadowHover: "none",
	buttonPrimaryBg: "#1ca583",
	buttonPrimaryHover: "#23b993",
	buttonSubtleHover: "rgba(255, 255, 255, 0.06)",
	buttonDangerText: "#2f0a0a",
	buttonSuccessText: "#0a2b1f",
	buttonObsoleteBg: "#e8b14e",
	buttonObsoleteHover: "#f0bf69",
	buttonObsoleteText: "#2b2205",
	buttonObsoleteBorder: "#e8b14e",
	buttonObsoleteShadow: "none",
};

/** Clinical ledger — paper */
const lightTokens: MedAssistThemeOther = {
	fontUi: appFontFamily,
	fontData: appFontFamilyMonospace,
	bgPrimary: "#f6f6f4",
	bgSecondary: "#ffffff",
	bgTertiary: "#efefec",
	bgInput: "#ffffff",
	bgGradient: "#f6f6f4",
	borderPrimary: "#e3e3de",
	borderSecondary: "#c9c9c2",
	textPrimary: "#1b1f21",
	textSecondary: "#6b7479",
	textMuted: "#424a4f",
	accent: "#0d8a6a",
	accentLight: "#11a37e",
	accentBg: "rgba(13, 138, 106, 0.08)",
	success: "#0d8a6a",
	successBg: "rgba(13, 138, 106, 0.09)",
	danger: "#cf4537",
	dangerBg: "rgba(207, 69, 55, 0.08)",
	warning: "#b27c10",
	warningBg: "rgba(178, 124, 16, 0.1)",
	info: "#20768f",
	shadow: "rgba(27, 31, 33, 0.12)",
	surfaceRadius: "10px",
	surfaceShadow: "none",
	surfaceBorder: "1px solid var(--border-primary)",
	focusRing: "0 0 0 3px rgba(13, 138, 106, 0.25)",
	buttonRadius: "8px",
	inputRadius: "8px",
	buttonRadiusRound: "50%",
	buttonShadow: "none",
	buttonShadowHover: "none",
	buttonPrimaryBg: "#0d8a6a",
	buttonPrimaryHover: "#0fa07b",
	buttonSubtleHover: "rgba(27, 31, 33, 0.05)",
	buttonDangerText: "#ffffff",
	buttonSuccessText: "#ffffff",
	buttonObsoleteBg: "#c98e14",
	buttonObsoleteHover: "#daa02a",
	buttonObsoleteText: "#ffffff",
	buttonObsoleteBorder: "#c98e14",
	buttonObsoleteShadow: "none",
};

/** Convert camelCase token key to kebab-case CSS variable name */
function toKebab(key: string): string {
	return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Map Mantine theme other keys to the legacy CSS variable names from foundation.css.
 * During the migration, both `var(--bg-primary)` (legacy) and
 * `var(--mantine-other-bg-primary)` (new) will resolve to the same value.
 * Remove legacy entries as each CSS file is deleted.
 */
const legacyVarMap: Record<string, string> = {
	fontUi: "--font-ui",
	fontData: "--font-data",
	bgPrimary: "--bg-primary",
	bgSecondary: "--bg-secondary",
	bgTertiary: "--bg-tertiary",
	bgInput: "--bg-input",
	bgGradient: "--bg-gradient",
	borderPrimary: "--border-primary",
	borderSecondary: "--border-secondary",
	textPrimary: "--text-primary",
	textSecondary: "--text-secondary",
	textMuted: "--text-muted",
	accent: "--accent",
	accentLight: "--accent-light",
	accentBg: "--accent-bg",
	success: "--success",
	successBg: "--success-bg",
	danger: "--danger",
	dangerBg: "--danger-bg",
	warning: "--warning",
	warningBg: "--warning-bg",
	info: "--info",
	shadow: "--shadow",
	surfaceRadius: "--surface-radius",
	surfaceShadow: "--surface-shadow",
	surfaceBorder: "--surface-border",
	focusRing: "--focus-ring",
	buttonRadius: "--button-radius",
	inputRadius: "--input-radius",
	buttonRadiusRound: "--button-radius-round",
	buttonShadow: "--button-shadow",
	buttonShadowHover: "--button-shadow-hover",
	buttonPrimaryBg: "--button-primary-bg",
	buttonPrimaryHover: "--button-primary-hover",
	buttonSubtleHover: "--button-subtle-hover",
	buttonDangerText: "--button-danger-text",
	buttonSuccessText: "--button-success-text",
	buttonObsoleteBg: "--button-obsolete-bg",
	buttonObsoleteHover: "--button-obsolete-hover",
	buttonObsoleteText: "--button-obsolete-text",
	buttonObsoleteBorder: "--button-obsolete-border",
	buttonObsoleteShadow: "--button-obsolete-shadow",
};

export const cssVariablesResolver: CSSVariablesResolver = () => {
	// Map Mantine core component variables onto the clinical palette so built-in
	// components (Menu, Modal, Paper, inputs) match the app surfaces automatically.
	const darkVars: Record<string, string> = {
		"--mantine-color-body": darkTokens.bgPrimary,
		"--mantine-color-text": darkTokens.textPrimary,
		"--mantine-color-dimmed": darkTokens.textSecondary,
		"--mantine-color-placeholder": darkTokens.textSecondary,
		"--mantine-color-default": darkTokens.bgSecondary,
		"--mantine-color-default-hover": darkTokens.bgTertiary,
		"--mantine-color-default-color": darkTokens.textPrimary,
		"--mantine-color-default-border": darkTokens.borderPrimary,
		"--mantine-color-error": darkTokens.danger,
	};
	const lightVars: Record<string, string> = {
		"--mantine-color-body": lightTokens.bgPrimary,
		"--mantine-color-text": lightTokens.textPrimary,
		"--mantine-color-dimmed": lightTokens.textSecondary,
		"--mantine-color-placeholder": lightTokens.textSecondary,
		"--mantine-color-default": lightTokens.bgSecondary,
		"--mantine-color-default-hover": lightTokens.bgTertiary,
		"--mantine-color-default-color": lightTokens.textPrimary,
		"--mantine-color-default-border": lightTokens.borderPrimary,
		"--mantine-color-error": lightTokens.danger,
	};
	for (const key of Object.keys(darkTokens) as (keyof MedAssistThemeOther)[]) {
		const varName = `--mantine-other-${toKebab(key)}`;
		darkVars[varName] = darkTokens[key];
		lightVars[varName] = lightTokens[key];
		// Emit legacy CSS variable name so non-migrated CSS files continue to resolve
		const legacyName = legacyVarMap[key];
		if (legacyName) {
			darkVars[legacyName] = darkTokens[key];
			lightVars[legacyName] = lightTokens[key];
		}
	}
	return { variables: {}, dark: darkVars, light: lightVars };
};

export const mantineTheme = createTheme({
	colors: {
		brand,
		blue,
		green,
		red,
		yellow,
	},
	components: {
		ActionIcon: ActionIcon.extend({
			defaultProps: { radius: "md", size: "input-sm" },
		}),
		Button: Button.extend({
			defaultProps: { radius: "md", size: "sm" },
			styles: {
				inner: {
					height: "100%",
				},
				root: {
					fontWeight: 700,
					lineHeight: 1.2,
				},
			},
		}),
		Menu: Menu.extend({
			defaultProps: { radius: 10, shadow: "md", withinPortal: true, zIndex: floatingLayerZIndex },
			styles: {
				dropdown: {
					backgroundColor: "var(--bg-secondary)",
					borderColor: "var(--border-primary)",
				},
			},
		}),
		Popover: Popover.extend({
			defaultProps: { withinPortal: true, zIndex: floatingLayerZIndex },
		}),
		Tooltip: Tooltip.extend({
			defaultProps: {
				events: { hover: true, focus: true, touch: true },
				radius: 8,
				withinPortal: true,
				withArrow: true,
				zIndex: floatingLayerZIndex,
			},
		}),
	},
	defaultRadius: "md",
	fontFamily: appFontFamily,
	fontFamilyMonospace: appFontFamilyMonospace,
	headings: {
		fontFamily: appFontFamily,
	},
	other: darkTokens,
	primaryColor: "brand",
	primaryShade: { dark: 5, light: 7 },
});
