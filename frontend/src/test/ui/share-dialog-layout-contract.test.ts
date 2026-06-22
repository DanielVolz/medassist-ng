/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

describe("share dialog layout contract", () => {
	it("keeps active share regenerate and revoke actions in one stable desktop row", () => {
		const css = readSource("components/ShareDialog.module.css");
		const desktopCss = css.split("@media")[0];

		expect(desktopCss).toMatch(
			/\.activeItem\s*\{[^}]*display\s*:\s*grid;[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+max-content;/s
		);
		expect(desktopCss).toMatch(
			/\.activeActions\s*\{[^}]*display\s*:\s*grid;[^}]*grid-template-columns\s*:\s*repeat\(2,\s*max-content\);/s
		);
		expect(desktopCss).not.toMatch(/\.activeActions\s*\{[^}]*flex-wrap\s*:\s*wrap/s);
	});
});
