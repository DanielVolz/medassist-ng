/// <reference types="node" />

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
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

function collectSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const fullPath = resolve(dir, entry);
		if (statSync(fullPath).isDirectory()) {
			return collectSourceFiles(fullPath);
		}

		return [".css", ".ts", ".tsx"].includes(extname(fullPath)) ? [fullPath] : [];
	});
}

function openingTagAround(source: string, tagName: string, marker: string) {
	const markerIndex = source.indexOf(marker);
	expect(markerIndex, `Expected marker ${marker}`).toBeGreaterThanOrEqual(0);

	const tagStart = source.lastIndexOf(`<${tagName}`, markerIndex);
	expect(tagStart, `Expected ${tagName} before ${marker}`).toBeGreaterThanOrEqual(0);

	const tagEnd = source.indexOf(">", markerIndex);
	expect(tagEnd, `Expected ${tagName} tag end after ${marker}`).toBeGreaterThan(tagStart);

	return source.slice(tagStart, tagEnd + 1);
}

describe("button height theme contract", () => {
	it("keeps standard action control sizes in Mantine theme", () => {
		const theme = readSource("ui/theme/mantineTheme.ts");

		expect(theme).toMatch(/Button\s*:\s*Button\.extend\(\s*\{[^}]*defaultProps\s*:\s*\{[^}]*size\s*:\s*"sm"/s);
		expect(theme).toMatch(
			/ActionIcon\s*:\s*ActionIcon\.extend\(\s*\{[^}]*defaultProps\s*:\s*\{[^}]*size\s*:\s*"input-sm"/s
		);
	});

	it("keeps AppButton as a thin Mantine wrapper without local height CSS", () => {
		const appButton = readSource("ui/primitives/AppButton.tsx");

		expect(existsSync(resolve(srcRoot, "ui/primitives/AppButton.module.css"))).toBe(false);
		expect(appButton).not.toMatch(/AppButton\.module\.css|data-app-button-size|--button-height|height\s*:/);
	});

	it("keeps text-bearing buttons from clipping their labels", () => {
		const appSurfaces = readSource("AppSurfaces.css");
		const authCss = readSource("components/Auth.module.css");
		const globalButton = cssBlock(appSurfaces, "button");
		const authSubmit = cssBlock(authCss, ".auth-submit");
		const authSubmitRoot = cssBlock(authCss, ".auth-submit:global(.mantine-Button-root)");
		const authSubmitInner = cssBlock(
			authCss,
			".auth-submit:global(.mantine-Button-root) :global(.mantine-Button-inner)"
		);
		const authSubmitLabel = cssBlock(
			authCss,
			".auth-submit:global(.mantine-Button-root) :global(.mantine-Button-label)"
		);

		expect(globalButton).toMatch(/line-height\s*:\s*1\.25/);
		expect(authSubmit).toMatch(/min-height\s*:\s*3rem/);
		expect(authSubmit).toMatch(/line-height\s*:\s*1\.25/);
		expect(authSubmit).toMatch(/overflow\s*:\s*visible/);
		expect(authSubmitRoot).toMatch(/height\s*:\s*auto/);
		expect(authSubmitRoot).toMatch(/min-height\s*:\s*3rem/);
		expect(authSubmitInner).toMatch(/height\s*:\s*auto/);
		expect(authSubmitInner).toMatch(/overflow\s*:\s*visible/);
		expect(authSubmitLabel).toMatch(/overflow\s*:\s*visible/);
		expect(authSubmitLabel).toMatch(/line-height\s*:\s*1\.25/);
	});

	it("does not reintroduce legacy app action height tokens", () => {
		const legacyTokens = [
			`--app-${"action-height"}`,
			`--app-${"action-height-sm"}`,
			`--app-${"action-height-xs"}`,
			`--app-${"header-action-height"}`,
		];
		const offenders = collectSourceFiles(srcRoot).filter((filePath) => {
			const source = readFileSync(filePath, "utf8");
			return legacyTokens.some((token) => source.includes(token));
		});

		expect(offenders.map((filePath) => filePath.slice(srcRoot.length + 1))).toEqual([]);
	});

	it("does not reintroduce large explicit action button sizes", () => {
		const offenders = collectSourceFiles(srcRoot)
			.filter((filePath) => !filePath.includes("/test/"))
			.flatMap((filePath) => {
				const source = readFileSync(filePath, "utf8");
				const relativePath = filePath.slice(srcRoot.length + 1);
				const matches = [
					...source.matchAll(/<AppButton\b[^>]*\bsize="lg"/gs),
					...source.matchAll(/<ActionIcon\b[^>]*\bsize="input-lg"/gs),
					...source.matchAll(/<ActionIcon\b[^>]*\bsize=\{40\}/gs),
				];
				return matches.map((match) => `${relativePath}:${match.index}`);
			});

		expect(offenders).toEqual([]);
	});

	it("keeps schedule header actions on Mantine default small sizing", () => {
		const dashboard = readSource("pages/DashboardPage.tsx");
		const schedule = readSource("pages/SchedulePage.tsx");
		const headerActions = readSource("features/schedule/components/ScheduleHeaderActions.module.css");

		expect(headerActions).not.toMatch(
			/--schedule-action-height|--schedule-action-font-size|--button-fz|--ai-size|height\s*:|min-height\s*:|font-size\s*:|padding-inline\s*:/
		);

		for (const source of [dashboard, schedule]) {
			expect(openingTagAround(source, "AppSelect", "schedule-days-select")).toContain('size="sm"');
			expect(openingTagAround(source, "AppButton", "journal-history-button")).toContain('size="sm"');
			expect(openingTagAround(source, "AppButton", 'className="clear-missed-btn"')).toContain('size="sm"');
		}

		expect(openingTagAround(dashboard, "ActionIcon", 'className={cx("share-btn"')).toContain('size="input-sm"');
	});
});
