/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

describe("medication detail footer action layout contract", () => {
	it("does not stack the mixed text and icon action footer on mobile", () => {
		const source = readSource("components/MedDetailModal.tsx");
		const nonStackingFooterIndex = source.indexOf("<AppModalFooter stackOnMobile={false}>");
		const mainRefillButtonIndex = source.indexOf('t("refill.button")');

		expect(source.match(/<AppModalFooter stackOnMobile=\{false\}>/g)).toHaveLength(1);
		expect(nonStackingFooterIndex).toBeGreaterThanOrEqual(0);
		expect(nonStackingFooterIndex).toBeLessThan(mainRefillButtonIndex);
	});

	it("keeps the refill prescription toggle grouped with its remaining refill count", () => {
		const source = readSource("components/MedDetailModal.tsx");
		const css = readSource("components/MedDetailModal.module.css");
		const rowBlock = css.match(/\.refill-prescription-row\s*\{[^}]*\}/s)?.[0] ?? "";
		const toggleBlock = css.match(/\.refill-form \.refill-prescription-toggle\s*\{[^}]*\}/s)?.[0] ?? "";
		const badgeBlock = css.match(/\.refill-remaining-badge\s*\{[^}]*\}/s)?.[0] ?? "";

		expect(source).toContain('classes["refill-remaining-label"]');
		expect(source).toContain('classes["refill-remaining-value"]');
		expect(rowBlock).toMatch(/display\s*:\s*grid/);
		expect(rowBlock).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
		expect(rowBlock).not.toMatch(/display\s*:\s*flex/);
		expect(toggleBlock).toMatch(/display\s*:\s*grid/);
		expect(toggleBlock).toMatch(/flex-direction\s*:\s*row/);
		expect(toggleBlock).toMatch(/grid-template-columns\s*:\s*18px\s+minmax\(0,\s*1fr\)/);
		expect(toggleBlock).not.toMatch(/flex-direction\s*:\s*column/);
		expect(badgeBlock).toMatch(/margin-left\s*:\s*calc\(18px \+ 0\.6rem\)/);
		expect(badgeBlock).not.toMatch(/margin-left\s*:\s*auto/);
	});
});
