/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

function blockFor(css: string, selector: string) {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s").exec(css);
	return match?.[1] ?? "";
}

// Regression rationale: settings controls must remain compact enough to keep their labels and actions usable in the shared card.
describe("settings language select layout contract", () => {
	it("keeps the language select compact inside the settings card", () => {
		const css = readSource("pages/SettingsPage.module.css");
		const content = blockFor(css, ".languageSettingsContent");
		const root = blockFor(css, ".languageSelectRoot");
		const input = blockFor(css, ".languageSelect");
		const timezoneInput = blockFor(css, ".timezoneInput");
		const timezoneDefaultButton = blockFor(css, ".timezoneDefaultButton");

		expect(content).toMatch(/--settings-timezone-default-button-width\s*:\s*9\.75rem/);
		expect(content).toMatch(/--settings-field-width\s*:\s*calc\(/);
		expect(content).toMatch(/\/\s*3/);
		expect(root).toMatch(/width\s*:\s*var\(--settings-field-width\)/);
		expect(root).toMatch(/max-width\s*:\s*100%/);
		expect(input).toMatch(/height\s*:\s*2\.75rem/);
		expect(input).toMatch(/min-height\s*:\s*2\.75rem/);
		expect(input).toMatch(/font-size\s*:\s*0\.95rem/);
		expect(timezoneInput).toMatch(/flex\s*:\s*0 1 var\(--settings-field-width\)/);
		expect(timezoneInput).toMatch(/width\s*:\s*var\(--settings-field-width\)/);
		expect(timezoneInput).toMatch(/max-width\s*:\s*none/);
		expect(timezoneDefaultButton).toMatch(/flex\s*:\s*0 0 var\(--settings-timezone-default-button-width\)/);
		expect(timezoneDefaultButton).toMatch(/white-space\s*:\s*nowrap/);
	});

	it("keeps settings action buttons readable and compact", () => {
		const css = readSource("pages/SettingsPageSurfaces.module.css");
		const root = blockFor(css, ".settings-form :global(.mantine-Button-root)");
		const label = blockFor(css, ".settings-form :global(.mantine-Button-label)");

		expect(root).toBe("");
		expect(label).toBe("");

		const theme = readSource("ui/theme/mantineTheme.ts");
		expect(theme).toMatch(/Button\s*:\s*Button\.extend\(\s*\{[^}]*defaultProps\s*:\s*\{[^}]*size\s*:\s*"sm"/s);
	});

	it("keeps notification test inputs half-width and inline with their buttons", () => {
		const css = readSource("pages/SettingsPage.module.css");
		const field = blockFor(css, ".notificationTestField");
		const row = blockFor(css, ".notificationTestRow");
		const input = blockFor(css, ".notificationTestInput");
		const button = blockFor(css, ".notificationTestButton");

		expect(field).toMatch(/--settings-notification-input-width\s*:\s*50%/);
		expect(row).toMatch(/display\s*:\s*flex/);
		expect(row).toMatch(/align-items\s*:\s*center/);
		expect(input).toMatch(/flex\s*:\s*0 1 var\(--settings-notification-input-width\)/);
		expect(input).toMatch(/width\s*:\s*var\(--settings-notification-input-width\)/);
		expect(button).toMatch(/white-space\s*:\s*nowrap/);
	});
});
