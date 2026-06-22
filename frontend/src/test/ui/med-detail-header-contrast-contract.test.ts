/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

function cssBlock(css: string, selector: string) {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s").exec(css);
	return match?.[1] ?? "";
}

describe("medication detail header contrast contract", () => {
	it("keeps taken-by names readable on the green detail header", () => {
		const css = readSource("components/MedDetailModal.module.css");

		expect(cssBlock(css, ".taken-by-person")).toMatch(/background\s*:\s*rgba\(5,\s*20,\s*28,\s*0\.7[0-9]\)/);
		expect(cssBlock(css, ".taken-by-person")).toMatch(/border\s*:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.58\)/);
		expect(cssBlock(css, ".taken-by-person")).toMatch(/box-shadow\s*:/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/color\s*:\s*white/);
		expect(cssBlock(css, ".taken-by-badge")).toMatch(/color\s*:\s*#fef3c7/);
		expect(cssBlock(css, ".taken-by-badge")).not.toMatch(/var\(--accent\)/);
	});
});
