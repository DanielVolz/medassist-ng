/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const medicationPageCssFiles = [
	"pages/MedicationsPage.module.css",
	...readdirSync(resolve(srcRoot, "components/medications"))
		.filter((fileName) => fileName.endsWith(".module.css"))
		.map((fileName) => `components/medications/${fileName}`),
];

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

function cssBlock(css: string, selector: string) {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s").exec(css);
	return match?.[1] ?? "";
}

describe("medications page font contract", () => {
	it("keeps medication page surfaces on the standard app font", () => {
		const offenders = medicationPageCssFiles.filter((filePath) => {
			const css = readSource(filePath);
			return /font-family\s*:\s*(?:var\(--(?:font-data|mantine-other-font-data)\)|monospace|ui-monospace|["']SF Mono|["']IBM Plex Mono)/i.test(
				css
			);
		});

		expect(offenders).toEqual([]);
	});

	it("pins medication list details to the standard Mantine font", () => {
		const css = readSource("components/medications/MedicationListSection.module.css");

		expect(cssBlock(css, ".medicationRow")).toMatch(/font-family\s*:\s*var\(--mantine-font-family\)/);
		expect(cssBlock(css, ".details strong")).toMatch(/font-family\s*:\s*var\(--mantine-font-family\)/);
	});
});
