/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

function extractSimpleCssBlocks(css: string) {
	return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({
		selector: match[1].trim(),
		body: match[2],
	}));
}

function blockFor(css: string, selector: string) {
	return extractSimpleCssBlocks(css).find((block) => block.selector === selector)?.body ?? "";
}

// Regression rationale: adjacent tooltip controls need a shared spacing invariant to avoid target overlap.
describe("settings tooltip spacing contract", () => {
	it("uses the same inline gap for section title and setting label tooltip icons", () => {
		const sectionCardCss = readSource("ui/components/SectionCard.module.css");
		const settingsCss = readSource("pages/SettingsPageSurfaces.module.css");
		const sectionTitle = blockFor(sectionCardCss, ".title");
		const compactSettingLabel = blockFor(settingsCss, ".settings-control-row.compact .setting-label");
		const languageSettingLabel = blockFor(settingsCss, ".settings-control-row.language-row .setting-label");

		expect(sectionTitle).toMatch(/display\s*:\s*inline-flex/);
		expect(sectionTitle).toMatch(/align-items\s*:\s*center/);
		expect(sectionTitle).toMatch(/gap\s*:\s*0\.45rem/);
		expect(compactSettingLabel).toMatch(/gap\s*:\s*0\.45rem/);
		expect(languageSettingLabel).toMatch(/gap\s*:\s*0\.45rem/);
	});
});
