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

describe("desktop medication edit layout contract", () => {
	it("keeps tabs, scroll body, and action footer visually connected", () => {
		const coordinatorCss = readSource("components/medications/MedicationEditCoordinator.module.css");
		const formCss = readSource("components/medications/MedicationForm.module.css");

		expect(cssBlock(coordinatorCss, ".editorShell")).toMatch(/--desktop-editor-panel-bg\s*:/);
		expect(cssBlock(coordinatorCss, ".cardContent")).toMatch(/gap\s*:\s*0/);
		expect(cssBlock(coordinatorCss, ".header")).toMatch(/margin-bottom\s*:\s*1rem/);
		expect(cssBlock(coordinatorCss, ".formBody")).toMatch(/background\s*:\s*var\(--desktop-editor-panel-bg\)/);
		expect(cssBlock(coordinatorCss, ".formBody")).toMatch(/border-top\s*:\s*none/);
		expect(cssBlock(coordinatorCss, ".formActions")).toMatch(/margin-top\s*:\s*0/);
		expect(cssBlock(coordinatorCss, ".formActions")).toMatch(/background\s*:\s*var\(--desktop-editor-panel-bg\)/);
		expect(cssBlock(formCss, ".tabs")).toMatch(/border-radius\s*:\s*10px 10px 0 0/);
	});
});
