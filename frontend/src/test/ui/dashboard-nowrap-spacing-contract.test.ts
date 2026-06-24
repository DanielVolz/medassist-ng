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

function lastBlockFor(css: string, selector: string) {
	return (
		extractSimpleCssBlocks(css)
			.filter((block) => block.selector === selector)
			.at(-1)?.body ?? ""
	);
}

describe("dashboard no-wrap and reminder spacing contract", () => {
	it("keeps overview table headers visually distinct", () => {
		const tableCss = readSource("ui/primitives/DataTable.module.css");
		const surfacesCss = readSource("AppSurfaces.css");
		const headCell = blockFor(tableCss, ".headCell");
		const stackedHeaderLabel = blockFor(surfacesCss, ".date-pair-stack-header .date-pair-label");

		expect(headCell).toMatch(/font-size\s*:\s*0\.95rem/);
		expect(headCell).toMatch(/font-weight\s*:\s*750/);
		expect(stackedHeaderLabel).toMatch(/font-family\s*:\s*inherit/);
		expect(stackedHeaderLabel).toMatch(/font-size\s*:\s*inherit/);
		expect(stackedHeaderLabel).toMatch(/text-transform\s*:\s*none/);
		expect(stackedHeaderLabel).toMatch(/letter-spacing\s*:\s*0/);
	});

	it("keeps short overview values on one line when horizontal space is available", () => {
		const css = readSource("ui/primitives/DataTable.module.css");
		const mobileBodyCell = lastBlockFor(css, ".bodyCell");
		const numericValueColumns = blockFor(
			css,
			[
				'.bodyCell[data-column-key="stock"]',
				'.bodyCell[data-column-key="dailyConsumption"]',
				'.bodyCell[data-column-key="stockDetails"]',
				'.bodyCell[data-column-key="daysLeft"]',
				'.bodyCell[data-column-key="status"]',
			].join(",\n")
		);
		const dateValue = blockFor(css, '.bodyCell[data-column-key="datePair"] :global(.date-pair-value)');

		expect(mobileBodyCell).toMatch(/grid-template-columns\s*:\s*minmax\(11rem, 48%\) minmax\(0, 1fr\)/);
		expect(numericValueColumns).toMatch(/white-space\s*:\s*nowrap/);
		expect(dateValue).toMatch(/white-space\s*:\s*nowrap/);
	});

	it("keeps mobile runs-out and expiry dates in the same value column as other overview values", () => {
		const css = readSource("AppSurfaces.css");
		const desktopDatePairEntry = blockFor(css, ".date-pair-entry");
		const mobileDatePairEntry = lastBlockFor(css, ".date-pair-entry");

		expect(desktopDatePairEntry).toMatch(/display\s*:\s*flex/);
		expect(desktopDatePairEntry).toMatch(/flex-direction\s*:\s*column/);
		expect(mobileDatePairEntry).toMatch(/display\s*:\s*grid/);
		expect(mobileDatePairEntry).toMatch(/grid-template-columns\s*:\s*minmax\(11rem, 48%\) minmax\(0, 1fr\)/);
		expect(mobileDatePairEntry).toMatch(/align-items\s*:\s*baseline/);
	});

	it("keeps reminder label/value spacing close to a single typed space", () => {
		const css = readSource("components/dashboard/DashboardReminderSection.module.css");
		const row = blockFor(css, ".row");

		expect(row).toMatch(/gap\s*:\s*0\.5rem\s+0\.35rem/);
		expect(row).not.toMatch(/0\.85rem/);
	});

	it("keeps mobile dose action buttons in stable slots", () => {
		const surfacesCss = readSource("AppSurfaces.css");
		const buttonCss = readSource("components/DoseActionButton.module.css");
		const dosePerson = lastBlockFor(surfacesCss, ".dose-person");
		const singleRecipientDosePerson = blockFor(
			surfacesCss,
			".dose-checks.has-recipient-summary:not(.multi-person) .dose-person"
		);
		const anonymousDosePerson = blockFor(surfacesCss, ".dose-person:not(:has(.person-name))");
		const dosePersonButton = lastBlockFor(surfacesCss, ".dose-person .dose-btn");
		const dosePersonRawButton = blockFor(surfacesCss, ".dose-person button");
		const tooltipTarget = blockFor(buttonCss, ".tooltipTarget");

		expect(dosePerson).toMatch(/display\s*:\s*grid/);
		expect(dosePerson).toMatch(/--dose-action-take-width\s*:\s*clamp\(5\.35rem, 23vw, 7\.1rem\)/);
		expect(dosePerson).toMatch(/--dose-action-skip-width\s*:\s*clamp\(4\.45rem, 19vw, 5\.35rem\)/);
		expect(dosePerson).toMatch(/--dose-action-journal-width\s*:\s*clamp\(5rem, 21vw, 6\.35rem\)/);
		expect(dosePerson).toMatch(
			/grid-template-columns\s*:\s*minmax\(0, 1fr\) var\(--dose-action-take-width\) var\(--dose-action-skip-width\)\s*var\(--dose-action-journal-width\)/
		);
		expect(singleRecipientDosePerson).not.toMatch(/grid-template-columns/);
		expect(anonymousDosePerson).not.toMatch(/grid-template-columns/);
		expect(dosePersonButton).toMatch(/width\s*:\s*100%/);
		expect(dosePersonRawButton).toMatch(/width\s*:\s*100%/);
		expect(tooltipTarget).toMatch(/width\s*:\s*100%/);
	});
});
