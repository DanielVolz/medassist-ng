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
	it("keeps taken-by names readable without pill backgrounds on the green detail header", () => {
		const css = readSource("components/MedDetailModal.module.css");

		expect(cssBlock(css, ".taken-by-person")).not.toMatch(/background\s*:/);
		expect(cssBlock(css, ".taken-by-person")).not.toMatch(/border\s*:/);
		expect(cssBlock(css, ".taken-by-person")).not.toMatch(/box-shadow\s*:/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/color\s*:\s*white/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/background\s*:\s*transparent/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/border-radius\s*:\s*0/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/box-shadow\s*:\s*none/);
		expect(cssBlock(css, ".taken-by-name")).toMatch(/text-decoration-line\s*:\s*underline/);
		expect(cssBlock(css, ".taken-by-name:hover,\n.taken-by-name:focus-visible")).toMatch(
			/background\s*:\s*transparent/
		);
		expect(cssBlock(css, ".taken-by-name:hover,\n.taken-by-name:focus-visible")).toMatch(/box-shadow\s*:\s*none/);
		expect(cssBlock(css, ".taken-by-badge")).toMatch(/color\s*:\s*#fef3c7/);
		expect(cssBlock(css, ".taken-by-badge")).not.toMatch(/var\(--accent\)/);
	});
});
