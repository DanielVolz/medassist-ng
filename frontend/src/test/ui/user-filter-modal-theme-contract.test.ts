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

describe("user filter modal theme contract", () => {
	it("keeps the person medications hero aligned with app surfaces", () => {
		const css = readSource("components/UserFilterModal.module.css");
		const hero = cssBlock(css, ".hero");
		const avatar = cssBlock(css, ".userAvatar");
		const title = cssBlock(css, ".heroTitle");

		expect(hero).not.toMatch(/linear-gradient|radial-gradient/);
		expect(hero).toMatch(/var\(--mantine-other-bg-tertiary\)/);
		expect(hero).toMatch(/var\(--mantine-other-border-primary\)/);
		expect(avatar).toMatch(/var\(--mantine-other-accent-bg\)/);
		expect(title).toMatch(/var\(--mantine-other-text-primary\)/);
	});
});
