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

describe("planner font contract", () => {
	it("uses the app standard font for planner table values", () => {
		const css = readSource("pages/PlannerPage.module.css");

		expect(fontFamilyForSelector(css, ".metric")).toBe("var(--mantine-font-family)");
		expect(fontFamilyForSelector(css, ".availableValue")).toBe("var(--mantine-font-family)");
		expect(css).not.toMatch(
			/font-family\s*:\s*(?:var\(--(?:font-data|mantine-other-font-data)\)|monospace|["']IBM Plex Mono)/i
		);
	});
});
