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

// Regression rationale: these responsive overview-table semantics have no deterministic browser fixture.
describe("dashboard table and spacing contract", () => {
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
		const surfacesCss = readSource("AppSurfaces.css");
		const tableCss = readSource("ui/primitives/DataTable.module.css");
		const desktopDatePairEntry = blockFor(surfacesCss, ".date-pair-entry");
		const mobileDatePairEntry = lastBlockFor(surfacesCss, ".date-pair-entry");
		const overviewDatePairEntry = blockFor(tableCss, '.bodyCell[data-column-key="datePair"] :global(.date-pair-entry)');

		expect(desktopDatePairEntry).toMatch(/display\s*:\s*flex/);
		expect(desktopDatePairEntry).toMatch(/flex-direction\s*:\s*column/);
		expect(mobileDatePairEntry).toMatch(/display\s*:\s*grid/);
		expect(mobileDatePairEntry).toMatch(/grid-template-columns\s*:\s*minmax\(11rem, 48%\) minmax\(0, 1fr\)/);
		expect(mobileDatePairEntry).toMatch(/align-items\s*:\s*baseline/);
		expect(overviewDatePairEntry).toMatch(/grid-template-columns\s*:\s*minmax\(11rem, 48%\) minmax\(0, 1fr\)/);
	});

	it("keeps reminder label/value spacing close to a single typed space", () => {
		const css = readSource("components/dashboard/DashboardReminderSection.module.css");
		const row = blockFor(css, ".row");

		expect(row).toMatch(/gap\s*:\s*0\.5rem\s+0\.35rem/);
		expect(row).not.toMatch(/0\.85rem/);
	});

	it("sizes dashboard medication avatars to the matching two-line name stacks", () => {
		const surfacesCss = readSource("AppSurfaces.css");
		const dashboardCss = readSource("pages/DashboardPage.module.css");
		const scheduleName = blockFor(surfacesCss, ".time-main .med-name");
		const scheduleAvatar = blockFor(surfacesCss, ".time-main .med-name:has(.med-generic-inline) .med-avatar-sm");
		const overviewNameLine = blockFor(dashboardCss, ".overviewNameLine");
		const overviewAvatar = blockFor(
			dashboardCss,
			".overviewNameLine:has(.overviewTakenByLine) :global(.med-avatar-sm)"
		);

		expect(scheduleName).toMatch(
			/--schedule-med-name-stack-height\s*:\s*calc\(1rem \* 1\.55 \+ 0\.1rem \+ 0\.875rem \* 1\.2\)/
		);
		expect(scheduleAvatar).toMatch(/width\s*:\s*var\(--schedule-med-name-stack-height\)/);
		expect(scheduleAvatar).toMatch(/height\s*:\s*var\(--schedule-med-name-stack-height\)/);
		expect(overviewNameLine).toMatch(
			/--overview-name-stack-height\s*:\s*calc\(1rem \* 1\.55 \+ 0\.4rem \+ 0\.78rem \* 1\.2\)/
		);
		expect(overviewAvatar).toMatch(/width\s*:\s*var\(--overview-name-stack-height\)/);
		expect(overviewAvatar).toMatch(/height\s*:\s*var\(--overview-name-stack-height\)/);
	});
});
