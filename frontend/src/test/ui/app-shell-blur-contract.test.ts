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

// Regression rationale: the header’s clipped blur and sticky boundary cannot be asserted reliably in jsdom.
describe("app shell header blur contract", () => {
	it("does not keep a disabled outer top blur in the active app shell", () => {
		const appSource = readSource("App.tsx");
		const css = readSource("App.module.css");

		expect(appSource).not.toMatch(/app-shell-top-blur/);
		expect(css).not.toMatch(/\.topBlur/);
		expect(css).not.toMatch(/--app-shell-top-blur-height/);
	});

	it("keeps blur clipped to the header surface and matching rounded corners", () => {
		const css = readSource("components/AppHeader.module.css");
		const header = blockFor(css, ".header");
		const headerBlur = blockFor(css, ".header::before");

		expect(header).toMatch(/--app-header-sticky-bleed\s*:\s*var\(--mantine-other-surface-radius\)/);
		expect(header).toMatch(/top\s*:\s*calc\(0px - var\(--app-header-sticky-bleed\)\)/);
		expect(header).toMatch(/margin\s*:\s*0\s+0\s+1\.75rem/);
		expect(header).toMatch(/padding\s*:\s*calc\(0\.6rem \+ var\(--app-header-sticky-bleed\)\) 1rem 0\.6rem/);
		expect(header).toMatch(/background\s*:\s*transparent/);
		expect(header).toMatch(/border-radius\s*:\s*var\(--mantine-other-surface-radius\)/);
		expect(header).toMatch(/isolation\s*:\s*isolate/);
		expect(header).toMatch(/overflow\s*:\s*hidden/);
		expect(headerBlur).toMatch(/inset\s*:\s*0/);
		expect(headerBlur).toMatch(/border-radius\s*:\s*inherit/);
		expect(headerBlur).toMatch(
			/background\s*:\s*color-mix\(in srgb, var\(--mantine-other-bg-secondary\) 82%, transparent\)/
		);
		expect(headerBlur).toMatch(/backdrop-filter\s*:\s*blur\(24px\) saturate\(1\.05\)/);
		expect(headerBlur).toMatch(/-webkit-backdrop-filter\s*:\s*blur\(24px\) saturate\(1\.05\)/);
	});

	it("keeps the mobile sticky boundary inside the header", () => {
		const css = readSource("components/AppHeader.module.css");

		expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*top\s*:\s*calc\(0px - var\(--app-header-sticky-bleed\)\)/);
		expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*margin\s*:\s*0\s+0\s+1rem/);
		expect(css).toMatch(
			/@media \(max-width: 700px\)[\s\S]*padding\s*:\s*calc\(0\.6rem \+ var\(--app-header-sticky-bleed\)\) 0\.7rem 0\.65rem/
		);
	});
});
