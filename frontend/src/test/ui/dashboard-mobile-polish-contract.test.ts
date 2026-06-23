/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import de from "../../i18n/de.json";
import en from "../../i18n/en.json";

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

function lastBlockFor(css: string, selector: string) {
	return (
		extractSimpleCssBlocks(css)
			.filter((block) => block.selector === selector)
			.at(-1)?.body ?? ""
	);
}

describe("dashboard and shared mobile polish contract", () => {
	it("keeps overview table headers readable and mobile date values right aligned", () => {
		const css = readSource("ui/primitives/DataTable.module.css");
		const headCell = blockFor(css, ".headCell");
		const mobileCell = lastBlockFor(css, ".bodyCell");
		const mobileLabel = lastBlockFor(css, ".bodyCell::before");
		const mobileDateValue = blockFor(css, '.bodyCell[data-column-key="datePair"] :global(.date-pair-value)');

		expect(headCell).toMatch(/font-size\s*:\s*0\.95rem/);
		expect(headCell).toMatch(/font-weight\s*:\s*750/);
		expect(mobileCell).toMatch(/align-items\s*:\s*center/);
		expect(mobileLabel).toMatch(/font-size\s*:\s*0\.82rem/);
		expect(mobileDateValue).toMatch(/justify-self\s*:\s*end/);
		expect(mobileDateValue).toMatch(/text-align\s*:\s*right/);
	});

	it("keeps shared medication generic names and mobile dose actions in stable slots", () => {
		const appSurfacesCss = readSource("AppSurfaces.css");
		const doseButtonCss = readSource("components/DoseActionButton.module.css");

		expect(blockFor(appSurfacesCss, ".time-main .med-name-stack")).toMatch(/flex-direction\s*:\s*column/);
		expect(blockFor(appSurfacesCss, ".time-main .med-generic-inline")).toMatch(/display\s*:\s*block/);
		expect(lastBlockFor(appSurfacesCss, ".dose-person")).toMatch(/grid-template-columns/);
		expect(blockFor(doseButtonCss, ".tooltipTarget")).toMatch(/width\s*:\s*100%/);
		expect(blockFor(doseButtonCss, ".takeAction")).toMatch(/grid-column\s*:\s*2/);
		expect(blockFor(doseButtonCss, ".skipAction")).toMatch(/grid-column\s*:\s*3/);
		expect(blockFor(doseButtonCss, ".journalAction")).toMatch(/grid-column\s*:\s*4/);
	});

	it("keeps the taken-by intake tooltip translated in English and German", () => {
		expect(en.form.blisters.takenByTooltip).toBeTruthy();
		expect(de.form.blisters.takenByTooltip).toBeTruthy();
		expect(en.form.blisters.takenByTooltip).not.toBe("form.blisters.takenByTooltip");
		expect(de.form.blisters.takenByTooltip).not.toBe("form.blisters.takenByTooltip");
	});
});
