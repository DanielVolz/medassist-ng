/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import de from "../../i18n/de.json";
import en from "../../i18n/en.json";

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

function lastBlockFor(css: string, selector: string) {
	return (
		extractSimpleCssBlocks(css)
			.filter((block) => block.selector === selector)
			.at(-1)?.body ?? ""
	);
}

// Regression rationale: these mobile overflow, typography, and localization invariants need deterministic coverage without viewport rendering.
describe("dashboard and shared mobile polish contract", () => {
	it("keeps mobile browser text autosizing pinned to the app scale where supported", () => {
		const baselineCss = readSource("ui/providers/AppGlobalBaseline.module.css");
		const html = blockFor(baselineCss, ":global(html)");

		expect(baselineCss).toContain('@import "@fontsource/ibm-plex-sans/latin-400.css"');
		expect(baselineCss).not.toContain("fonts.googleapis.com");
		expect(html).toMatch(/-webkit-text-size-adjust\s*:\s*100%/);
		expect(html).toMatch(/text-size-adjust\s*:\s*100%/);
	});

	it("lets the mobile main swipe hint wrap instead of clipping the text", () => {
		const appCss = readSource("App.module.css");
		const hint = lastBlockFor(appCss, ".mainSwipeHint");
		const hintText = lastBlockFor(appCss, ".mainSwipeHint span");

		expect(hint).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*auto/);
		expect(hint).toMatch(/width\s*:\s*calc\(100%\s*-\s*1rem\)/);
		expect(hintText).toMatch(/white-space\s*:\s*normal/);
		expect(hintText).toMatch(/overflow-wrap\s*:\s*anywhere/);
		expect(hintText).not.toMatch(/text-overflow\s*:\s*ellipsis/);
		expect(hintText).not.toMatch(/white-space\s*:\s*nowrap/);
	});

	it("keeps overview table headers readable and mobile date values left aligned", () => {
		const css = readSource("ui/primitives/DataTable.module.css");
		const headCell = blockFor(css, ".headCell");
		const mobileCell = lastBlockFor(css, ".bodyCell");
		const mobileLabel = lastBlockFor(css, ".bodyCell::before");
		const mobileDateValue = blockFor(css, '.bodyCell[data-column-key="datePair"] :global(.date-pair-value)');

		expect(headCell).toMatch(/font-size\s*:\s*0\.95rem/);
		expect(headCell).toMatch(/font-weight\s*:\s*750/);
		expect(mobileCell).toMatch(/align-items\s*:\s*center/);
		expect(mobileLabel).toMatch(/font-size\s*:\s*0\.82rem/);
		expect(mobileDateValue).toMatch(/justify-self\s*:\s*start/);
		expect(mobileDateValue).toMatch(/text-align\s*:\s*left/);
	});

	it("keeps shared medication generic names and mobile dose actions in stable slots", () => {
		const appSurfacesCss = readSource("AppSurfaces.css");
		const doseButtonCss = readSource("components/DoseActionButton.module.css");

		expect(blockFor(appSurfacesCss, ".time-main .med-name-stack")).toMatch(/flex-direction\s*:\s*column/);
		expect(blockFor(appSurfacesCss, ".time-main .med-generic-inline")).toMatch(/display\s*:\s*block/);
		expect(lastBlockFor(appSurfacesCss, ".dose-person")).toMatch(/grid-template-columns/);
		expect(blockFor(doseButtonCss, ".tooltipTarget")).toMatch(/width\s*:\s*100%/);
		expect(blockFor(doseButtonCss, ".takeAction")).toMatch(/grid-column\s*:\s*1/);
		expect(blockFor(doseButtonCss, ".skipAction")).toMatch(/grid-column\s*:\s*2/);
		expect(blockFor(doseButtonCss, ".journalAction")).toMatch(/grid-column\s*:\s*3/);
	});

	it("keeps the taken-by intake tooltip translated in English and German", () => {
		expect(en.form.blisters.takenByTooltip).toBeTruthy();
		expect(de.form.blisters.takenByTooltip).toBeTruthy();
		expect(en.form.blisters.takenByTooltip).not.toBe("form.blisters.takenByTooltip");
		expect(de.form.blisters.takenByTooltip).not.toBe("form.blisters.takenByTooltip");
	});

	it("keeps German mobile dose action labels concise without changing English copy", () => {
		expect(en.dose.take).toBe("Take");
		expect(en.dose.skip).toBe("Skip");
		expect(en.dose.undoAction).toBe("Undo");
		expect(de.dose.take).toBe("Nehmen");
		expect(de.dose.skip).toBe("Auslassen");
		expect(de.dose.undoAction).toBe("Rückg.");
		expect(de.dose.skip.length).toBeLessThan("Überspringen".length);
		expect(de.dose.undoAction.length).toBeLessThan("Rückgängig".length);
	});

	it("keeps the shared-link help copy concise, user-facing, and properly localized", () => {
		expect(de.share.publicAccessHelp).toBe(
			"Du siehst nur den freigegebenen Zeitplan. Falls erlaubt, kannst du Einnahmen markieren und Notizen hinzufügen. Kein Zugriff auf Konto, Einstellungen oder andere Medikamente."
		);
		expect(en.share.publicAccessHelp).toBe(
			"You only see the shared schedule. If allowed, you can mark intakes and add notes. No access to the account, settings, or other medications."
		);
		expect(de.share.publicAccessHelp).toMatch(/[äöüÄÖÜß]/);
		expect(de.share.publicAccessHelp).not.toMatch(/ae|oe|ue/);
		expect(de.share.publicAccessHelp.length).toBeLessThanOrEqual(180);
	});
});
