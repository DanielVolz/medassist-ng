import * as fs from "node:fs";
import * as path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

type SafeAxeContrast = Record<string, string | number>;

export type AxeDiagnosticTarget = {
	selector: string | string[] | null;
	contrast: SafeAxeContrast[];
};

type ElementMeasurement = {
	kind: string;
	index: number;
	tag: string;
	box: {
		bottom: number;
		height: number;
		left: number;
		right: number;
		top: number;
		width: number;
	};
	font: {
		family: string;
		size: string;
		lineHeight: string;
		weight: string;
	};
	foreground: string;
	background: string;
	display: string;
};

type UiDomDiagnostics = {
	viewport: {
		width: number;
		height: number;
		deviceScaleFactor: number;
		documentWidth: number;
		documentHeight: number;
	};
	colorSchemePreference: "dark" | "light";
	reducedMotionPreference: "reduce" | "no-preference";
	theme: "dark" | "light" | "unknown";
	elements: ElementMeasurement[];
	axeTargets: Array<{
		index: number;
		tag: string | null;
		measurement: ElementMeasurement | null;
		contrast: SafeAxeContrast[];
	}>;
};

const axeTargetsByPage = new WeakMap<Page, AxeDiagnosticTarget[]>();

function safeColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const color = value.trim();
	if (
		color.length <= 64 &&
		(/^(?:rgba?|hsla?)\([0-9.,%/\s+-]+\)$/i.test(color) || /^#[0-9a-f]{3,8}$/i.test(color) || color === "transparent")
	) {
		return color;
	}
	return null;
}

export function sanitizeAxeContrast(check: { data?: unknown }): SafeAxeContrast {
	if (!check.data || typeof check.data !== "object") return {};
	const data = check.data as Record<string, unknown>;
	const result: SafeAxeContrast = {};
	for (const key of ["fgColor", "bgColor"]) {
		const color = safeColor(data[key]);
		if (color) result[key] = color;
	}
	for (const key of ["contrastRatio", "expectedContrastRatio"]) {
		const value = data[key];
		if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
	}
	return result;
}

export function recordUiAxeDiagnostics(page: Page, targets: AxeDiagnosticTarget[]) {
	axeTargetsByPage.set(
		page,
		targets.slice(0, 24).map((target) => {
			let selector: AxeDiagnosticTarget["selector"] = null;
			if (typeof target.selector === "string") {
				selector = target.selector.slice(0, 500);
			} else if (Array.isArray(target.selector)) {
				selector = target.selector.slice(0, 8).map((part) => part.slice(0, 300));
			}
			return {
				selector,
				contrast: target.contrast.map((contrast) => {
					const safe: SafeAxeContrast = {};
					const fgColor = safeColor(contrast.fgColor);
					const bgColor = safeColor(contrast.bgColor);
					if (fgColor) safe.fgColor = fgColor;
					if (bgColor) safe.bgColor = bgColor;
					for (const key of ["contrastRatio", "expectedContrastRatio"]) {
						const value = contrast[key];
						if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
					}
					return safe;
				}),
			};
		})
	);
}

/**
 * Runs in the page context and returns only selected computed measurements.
 * Selectors are used transiently to locate elements, never returned in evidence.
 */
export function collectUiDomDiagnostics(targets: AxeDiagnosticTarget[]): UiDomDiagnostics {
	const finite = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);
	const pageSafeColor = (value: string) => {
		const color = value.trim();
		return color.length <= 64 &&
			(/^(?:rgba?|hsla?)\([0-9.,%/\s+-]+\)$/i.test(color) || /^#[0-9a-f]{3,8}$/i.test(color) || color === "transparent")
			? color
			: null;
	};
	const safeDimension = (value: string, allowNormal = false) => {
		if (allowNormal && value === "normal") return value;
		return /^\d+(?:\.\d+)?(?:px|rem|em|%)$/i.test(value) ? value.slice(0, 24) : "unavailable";
	};
	const safeFontFamily = (value: string) => (/^[a-zA-Z0-9 ,'"_-]{1,120}$/.test(value) ? value : "unavailable");
	const safeComputedColor = (value: string) => pageSafeColor(value) ?? "unavailable";
	const describe = (element: Element, kind: string, index: number): ElementMeasurement => {
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return {
			kind,
			index,
			tag: element.tagName.toLowerCase(),
			box: {
				bottom: finite(rect.bottom),
				height: finite(rect.height),
				left: finite(rect.left),
				right: finite(rect.right),
				top: finite(rect.top),
				width: finite(rect.width),
			},
			font: {
				family: safeFontFamily(style.fontFamily),
				size: safeDimension(style.fontSize),
				lineHeight: safeDimension(style.lineHeight, true),
				weight: /^\d{1,3}$/.test(style.fontWeight) ? style.fontWeight : "unavailable",
			},
			foreground: safeComputedColor(style.color),
			background: safeComputedColor(style.backgroundColor),
			display: /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|none|contents|table|table-cell)$/.test(
				style.display
			)
				? style.display
				: "other",
		};
	};

	const editor = Array.from(
		document.querySelectorAll('[data-ui-a11y-scope="true"], [role="dialog"], aside[data-open="true"]')
	).find((element) => {
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
	});
	const selected = [
		{ kind: "heading", selector: "h2", limit: 4 },
		{ kind: "form", selector: "form", limit: 4 },
		{ kind: "label", selector: "label", limit: 4 },
		{ kind: "input", selector: "input", limit: 4 },
		{ kind: "tab", selector: '[role="tab"]', limit: 8 },
		{ kind: "action", selector: "button", limit: 8 },
	];
	const elements: ElementMeasurement[] = [];
	if (editor) elements.push(describe(editor, "editor", 0));
	for (const { kind, selector, limit } of selected) {
		Array.from(editor?.querySelectorAll(selector) ?? [])
			.slice(0, limit)
			.forEach((element, index) => elements.push(describe(element, kind, index)));
	}

	const themeValue = document.documentElement.dataset.theme ?? document.body.dataset.theme ?? "";
	let theme: UiDomDiagnostics["theme"] = "unknown";
	if (themeValue === "light" || themeValue === "dark") {
		theme = themeValue;
	} else if (document.documentElement.classList.contains("dark")) {
		theme = "dark";
	} else if (document.documentElement.classList.contains("light")) {
		theme = "light";
	}
	const mediaMatches = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

	return {
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight,
			deviceScaleFactor: window.devicePixelRatio,
			documentWidth: document.documentElement.clientWidth,
			documentHeight: document.documentElement.clientHeight,
		},
		colorSchemePreference: mediaMatches("(prefers-color-scheme: dark)") ? "dark" : "light",
		reducedMotionPreference: mediaMatches("(prefers-reduced-motion: reduce)") ? "reduce" : "no-preference",
		theme,
		elements,
		axeTargets: targets.slice(0, 24).map((target, index) => {
			let element: Element | null = null;
			let selectorPath: string[] = [];
			if (Array.isArray(target.selector)) {
				selectorPath = target.selector;
			} else if (typeof target.selector === "string") {
				selectorPath = [target.selector];
			}
			if (selectorPath.length > 0) {
				try {
					let root: ParentNode = document;
					for (const selector of selectorPath) {
						element = root.querySelector(selector);
						if (!element) break;
						root = element.shadowRoot ?? element;
					}
				} catch {
					// Invalid axe selectors are omitted from measured evidence.
				}
			}
			return {
				index,
				tag: element?.tagName.toLowerCase() ?? null,
				measurement: element ? describe(element, "axe-target", index) : null,
				contrast: target.contrast.map((contrast) => {
					const safe: SafeAxeContrast = {};
					const fgColor = typeof contrast.fgColor === "string" ? pageSafeColor(contrast.fgColor) : null;
					const bgColor = typeof contrast.bgColor === "string" ? pageSafeColor(contrast.bgColor) : null;
					if (fgColor) safe.fgColor = fgColor;
					if (bgColor) safe.bgColor = bgColor;
					for (const key of ["contrastRatio", "expectedContrastRatio"]) {
						const value = contrast[key];
						if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
					}
					return safe;
				}),
			};
		}),
	};
}

export async function attachUiFailureDiagnostics(
	page: Page,
	testInfo: TestInfo,
	errorCounts: { consoleErrors: number; pageErrors: number; failedRequests: number; httpErrorStatuses: number[] }
) {
	const browser = page.context().browser();
	const dom = await page.evaluate(collectUiDomDiagnostics, axeTargetsByPage.get(page) ?? []);
	const viewport = page.viewportSize();
	const payload = {
		schemaVersion: 1,
		browser: {
			name: browser?.browserType().name() ?? "unknown",
			version: browser?.version() ?? "unknown",
			project: testInfo.project.name,
		},
		viewport: {
			...dom.viewport,
			playwrightWidth: viewport?.width ?? null,
			playwrightHeight: viewport?.height ?? null,
		},
		colorSchemePreference: dom.colorSchemePreference,
		reducedMotionPreference: dom.reducedMotionPreference,
		theme: dom.theme,
		errorCounts: {
			...errorCounts,
			httpErrorStatuses: errorCounts.httpErrorStatuses.slice(0, 40),
		},
		elements: dom.elements,
		axeTargets: dom.axeTargets,
	};
	const diagnosticsPath = testInfo.outputPath("ui-safe-diagnostics.json");
	await fs.promises.mkdir(path.dirname(diagnosticsPath), { recursive: true });
	await fs.promises.writeFile(diagnosticsPath, JSON.stringify(payload, null, 2));
	await testInfo.attach("ui-safe-diagnostics", {
		path: diagnosticsPath,
		contentType: "application/json",
	});
}
