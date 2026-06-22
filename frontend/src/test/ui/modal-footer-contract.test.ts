/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const guardedCssModules = [
	"components/Auth.module.css",
	"components/ProfileModal.module.css",
	"components/ShareDialog.module.css",
	"components/ReportModal.module.css",
	"components/ImportReviewModal.module.css",
	"components/UserFilterModal.module.css",
	"components/MobileEditModal.module.css",
	"components/MedDetailModal.module.css",
	"components/intake-journal/IntakeJournalModal.module.css",
];

function toSourcePath(filePath: string) {
	return relative(srcRoot, filePath).split(sep).join("/");
}

function readSource(filePath: string) {
	return readFileSync(resolve(srcRoot, filePath), "utf8");
}

function collectSourceFiles(directory: string, extension: string): Record<string, string> {
	const entries = readdirSync(directory, { withFileTypes: true });
	const sources: Record<string, string> = {};

	for (const entry of entries) {
		const filePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			Object.assign(sources, collectSourceFiles(filePath, extension));
			continue;
		}
		if (entry.isFile() && filePath.endsWith(extension)) {
			sources[toSourcePath(filePath)] = readFileSync(filePath, "utf8");
		}
	}

	return sources;
}

const tsxSources = collectSourceFiles(srcRoot, ".tsx");
const cssSources: Record<string, string> = {
	...Object.fromEntries(guardedCssModules.map((filePath) => [filePath, readSource(filePath)])),
	"ui/modal/AppModal.module.css": readSource("ui/modal/AppModal.module.css"),
};

function sourceEntriesEndingWith(sources: Record<string, string>, suffix: string) {
	return Object.entries(sources).filter(([filePath]) => filePath.endsWith(suffix));
}

function readSourceBySuffix(sources: Record<string, string>, suffix: string) {
	const matches = sourceEntriesEndingWith(sources, suffix);
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one source match for ${suffix}, found ${matches.length}`);
	}
	return matches[0][1];
}

function extractSimpleCssBlocks(css: string) {
	return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({
		selector: match[1].trim(),
		body: match[2],
	}));
}

function isZeroSpacingToken(token: string) {
	return /^0(?:$|[a-z%]+$)/i.test(token.trim());
}

function hasZeroInlinePadding(body: string) {
	for (const match of body.matchAll(/padding\s*:\s*([^;]+);/g)) {
		const tokens = match[1].trim().split(/\s+/).filter(Boolean);
		if (tokens.length === 2 && isZeroSpacingToken(tokens[1])) return true;
		if (tokens.length >= 3 && isZeroSpacingToken(tokens[1])) return true;
		if (tokens.length >= 4 && isZeroSpacingToken(tokens[3])) return true;
	}
	return false;
}

function isGuardedFooterSelector(selector: string) {
	return /\.(?:footer|actions|profile-actions|modal-footer|med-detail-footer)(?:\b|[^\w-])/.test(selector);
}

describe("modal footer UI contract", () => {
	it("does not allow local className overrides on AppModalFooter", () => {
		const offenders = Object.entries(tsxSources).flatMap(([filePath, source]) => {
			if (filePath.endsWith("ui/modal/AppModal.tsx")) return [];
			return /<AppModalFooter\b[^>]*\bclassName\s*=/.test(source) ? [filePath] : [];
		});

		expect(offenders).toEqual([]);
	});

	it("does not split modal content through custom component boundaries", () => {
		const appModalSource = readSourceBySuffix(tsxSources, "ui/modal/AppModal.tsx");

		expect(appModalSource).toContain('if (typeof child.type !== "string") return false;');
	});

	it("keeps the shared AppModalFooter layout pinned to the approved defaults", () => {
		const css = readSourceBySuffix(cssSources, "ui/modal/AppModal.module.css");
		const bodyWithFooterBlock = extractSimpleCssBlocks(css).find((block) => block.selector === ".bodyWithFooter");
		const scrollAreaBlock = extractSimpleCssBlocks(css).find((block) => block.selector === ".scrollArea");
		const footerBlock = extractSimpleCssBlocks(css).find((block) => block.selector === ".footer");
		const appModalSource = readSourceBySuffix(tsxSources, "ui/modal/AppModal.tsx");

		expect(bodyWithFooterBlock, "missing .bodyWithFooter block in AppModal.module.css").toBeTruthy();
		expect(bodyWithFooterBlock?.body).toMatch(/display\s*:\s*flex/);
		expect(bodyWithFooterBlock?.body).toMatch(/flex-direction\s*:\s*column/);
		expect(bodyWithFooterBlock?.body).toMatch(/overflow\s*:\s*hidden/);
		expect(scrollAreaBlock, "missing .scrollArea block in AppModal.module.css").toBeTruthy();
		expect(scrollAreaBlock?.body).toMatch(/overflow-y\s*:\s*auto/);
		expect(scrollAreaBlock?.body).toMatch(/overscroll-behavior\s*:\s*contain/);
		expect(footerBlock, "missing .footer block in AppModal.module.css").toBeTruthy();
		expect(footerBlock?.body).toMatch(/position\s*:\s*sticky/);
		expect(footerBlock?.body).toMatch(/bottom\s*:\s*calc\(-1 \* var\(--app-modal-footer-bottom-offset/);
		expect(footerBlock?.body).toMatch(/width\s*:\s*calc\(\s*100%\s*\+\s*var\(--app-modal-footer-inline-offset/);
		expect(footerBlock?.body).toMatch(/justify-content\s*:\s*flex-end/);
		expect(footerBlock?.body).toMatch(/padding\s*:\s*[^;]*1\.5rem[^;]*;/);
		expect(footerBlock?.body).not.toMatch(/--app-modal-footer-action-height/);
		expect(footerBlock?.body).not.toMatch(/box-shadow\s*:/);
		expect(css).toMatch(/\.footer::after\s*\{[^}]*height\s*:\s*var\(--app-modal-footer-bottom-offset/s);
		expect(css).toMatch(/\.footer\[data-stack-on-mobile="false"\]\s+\.footerActions\s*\{[^}]*display\s*:\s*grid/s);
		expect(css).toMatch(
			/\.footer\[data-stack-on-mobile="false"\]\s+\.footerActions\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+repeat\(3,\s*max-content\)/s
		);
		expect(appModalSource).toContain('data-testid="app-modal-scroll-area"');
		expect(appModalSource).toContain('data-testid="app-modal-footer"');
	});

	it("keeps medication detail modal clipped to the shared modal frame", () => {
		const css = readSourceBySuffix(cssSources, "components/MedDetailModal.module.css");

		expect(css).toMatch(/(?:^|\n)\.med-detail-modal\s*\{[^}]*overflow\s*:\s*hidden/s);
		expect(css).not.toMatch(/(?:^|\n)\.med-detail-modal\s*\{[^}]*overflow\s*:\s*visible/s);
		expect(css).toMatch(/(?:^|\n)\.med-detail-modal-shell-body\s*\{[^}]*--app-modal-footer-bottom-offset\s*:\s*0px/s);
		expect(css).toMatch(/(?:^|\n)\.med-detail-modal-shell-body\s*\{[^}]*display\s*:\s*flex/s);
		expect(css).toMatch(/(?:^|\n)\.med-detail-modal-shell-body\s*\{[^}]*overflow\s*:\s*hidden/s);
		expect(css).toMatch(/(?:^|\n)\.med-detail-modal-shell-body\s*\{[^}]*padding\s*:\s*0/s);
		expect(css).toMatch(/(?:^|\n)\.med-detail-focus-scope\s*\{[^}]*min-height\s*:\s*0/s);
		expect(css).not.toMatch(/(?:^|\n)\.med-detail-modal \.med-detail-body\s*\{[^}]*overflow-y\s*:\s*auto/s);
		expect(css).not.toMatch(/(?:^|\n)\.med-detail-modal \.med-detail-body\s*\{[^}]*overscroll-behavior\s*:\s*contain/s);
	});

	it("prevents modal footer drift in component CSS modules", () => {
		const violations: string[] = [];

		for (const filePath of guardedCssModules) {
			const matches = sourceEntriesEndingWith(cssSources, filePath);
			if (matches.length === 0) continue;

			const css = matches[0][1];
			for (const block of extractSimpleCssBlocks(css)) {
				if (!isGuardedFooterSelector(block.selector)) continue;

				if (/box-shadow\s*:/i.test(block.body)) {
					violations.push(`${filePath}: ${block.selector} declares box-shadow`);
				}
				if (/justify-content\s*:\s*space-between/i.test(block.body)) {
					violations.push(`${filePath}: ${block.selector} uses space-between`);
				}
				if (hasZeroInlinePadding(block.body)) {
					violations.push(`${filePath}: ${block.selector} uses zero inline padding`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
