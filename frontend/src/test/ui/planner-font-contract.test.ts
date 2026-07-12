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

function selectorsForBlock(selector: string) {
	return selector.split(",").map((part) => part.trim());
}

function fontFamilyForSelector(css: string, selector: string) {
	const block = extractSimpleCssBlocks(css).find((candidate) =>
		selectorsForBlock(candidate.selector).includes(selector)
	);
	const fontFamily = block?.body.match(/font-family\s*:\s*([^;]+);/);
	return fontFamily?.[1]?.trim() ?? null;
}

function blockForSelector(css: string, selector: string) {
	return (
		extractSimpleCssBlocks(css).find((candidate) => selectorsForBlock(candidate.selector).includes(selector))?.body ??
		""
	);
}

function lastBlockForSelector(css: string, selector: string) {
	return (
		extractSimpleCssBlocks(css)
			.filter((candidate) => selectorsForBlock(candidate.selector).includes(selector))
			.at(-1)?.body ?? ""
	);
}

// Regression rationale: planner result cards must remain compact and legible on mobile without a deterministic browser data fixture.
describe("planner font contract", () => {
	it("uses the app standard font for planner table values", () => {
		const css = readSource("pages/PlannerPage.module.css");

		expect(fontFamilyForSelector(css, ".metric")).toBe("var(--mantine-font-family)");
		expect(fontFamilyForSelector(css, ".availableValue")).toBe("var(--mantine-font-family)");
		expect(css).not.toMatch(
			/font-family\s*:\s*(?:var\(--(?:font-data|mantine-other-font-data)\)|monospace|["']IBM Plex Mono)/i
		);
	});

	it("uses a full-width mobile medication card header instead of a label/value row", () => {
		const css = readSource("pages/PlannerPage.module.css");
		const medicationCell = blockForSelector(css, '.resultsTable :global(td[data-column-key="medication"])');
		const medicationLabel = blockForSelector(css, '.resultsTable :global(td[data-column-key="medication"])::before');
		const medicationAvatar = blockForSelector(css, ".medicationCell :global(.med-avatar-sm)");

		expect(medicationCell).toMatch(/display\s*:\s*block/);
		expect(medicationLabel).toMatch(/display\s*:\s*none/);
		expect(medicationLabel).toMatch(/content\s*:\s*none/);
		expect(medicationAvatar).toMatch(/width\s*:\s*2\.75rem/);
		expect(medicationAvatar).toMatch(/height\s*:\s*2\.75rem/);
	});

	it("keeps mobile planner result values compact without splitting stock chunks", () => {
		const css = readSource("pages/PlannerPage.module.css");
		const compactMobileCell = blockForSelector(css, '.resultsTable :global(td[data-column-key="available"])');
		const availableCell = lastBlockForSelector(css, '.resultsTable :global(td[data-column-key="available"])');
		const availableChunk = blockForSelector(css, ".availableChunk");

		expect(compactMobileCell).toMatch(/grid-template-columns\s*:\s*minmax\(8\.5rem, 40%\) minmax\(0, 1fr\)/);
		expect(compactMobileCell).toMatch(/gap\s*:\s*0\.6rem/);
		expect(availableCell).toMatch(/align-items\s*:\s*baseline/);
		expect(availableChunk).toMatch(/white-space\s*:\s*nowrap/);
	});
});
