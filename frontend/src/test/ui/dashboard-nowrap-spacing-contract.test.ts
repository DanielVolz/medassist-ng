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

	it("keeps mobile dose action buttons in stable slots", () => {
		const surfacesCss = readSource("AppSurfaces.css");
		const dashboardSource = readSource("pages/DashboardPage.tsx");
		const scheduleSource = readSource("pages/SchedulePage.tsx");
		const sharedScheduleSource = readSource("components/SharedSchedule.tsx");
		const doseActionSources = [dashboardSource, scheduleSource, sharedScheduleSource];
		const buttonCss = readSource("components/DoseActionButton.module.css");
		const doseItemHasRecipients = blockFor(surfacesCss, ".dose-item.has-recipients");
		const doseItemHasRecipientsSummary = blockFor(surfacesCss, ".dose-item.has-recipients .dose-summary");
		const doseItemHasRecipientsUsage = blockFor(surfacesCss, ".dose-item.has-recipients .dose-usage");
		const doseItemHasRecipientsRecipients = blockFor(surfacesCss, ".dose-item.has-recipients .dose-recipients");
		const doseItemHasRecipientsRecipientName = blockFor(surfacesCss, ".dose-item.has-recipients .dose-recipient-name");
		const doseItemHasRecipientsReminder = blockFor(surfacesCss, ".dose-item.has-recipients .reminder-icon");
		const doseRecipientName = blockFor(surfacesCss, ".dose-recipient-name");
		const dosePerson = lastBlockFor(surfacesCss, ".dose-person");
		const dosePersonName = lastBlockFor(surfacesCss, ".dose-person .person-name");
		const singleRecipientDosePerson = blockFor(
			surfacesCss,
			".dose-checks.has-recipient-summary:not(.multi-person) .dose-person"
		);
		const anonymousDosePerson = blockFor(surfacesCss, ".dose-person:not(:has(.person-name))");
		const dosePersonButton = lastBlockFor(surfacesCss, ".dose-person .dose-btn");
		const dosePersonRawButton = blockFor(surfacesCss, ".dose-person button");
		const tooltipTarget = blockFor(buttonCss, ".tooltipTarget");
		const actionButton = blockFor(buttonCss, ".button");
		const buttonInner = blockFor(buttonCss, ".buttonInner");
		const buttonLabel = blockFor(buttonCss, ".buttonLabel");
		const actionLabel = blockFor(buttonCss, ".label");
		const skipActionLabel = blockFor(buttonCss, ".skipAction .label");
		const undoButtonLabel = blockFor(buttonCss, ".undo .buttonLabel");
		const takeAction = blockFor(buttonCss, ".takeAction");
		const skipAction = blockFor(buttonCss, ".skipAction");
		const journalAction = blockFor(buttonCss, ".journalAction");

		expect(doseItemHasRecipients).toMatch(
			/grid-template-columns\s*:\s*minmax\(3\.35rem, auto\) max-content minmax\(0, 1fr\) auto/
		);
		expect(doseItemHasRecipients).toMatch(/column-gap\s*:\s*0\.25rem/);
		expect(doseItemHasRecipientsSummary).toMatch(/grid-column\s*:\s*2 \/ 4/);
		expect(doseItemHasRecipientsSummary).toMatch(/display\s*:\s*grid/);
		expect(doseItemHasRecipientsSummary).toMatch(/grid-template-columns\s*:\s*minmax\(0, 1fr\) max-content/);
		expect(doseItemHasRecipientsSummary).toMatch(/column-gap\s*:\s*0\.4rem/);
		expect(doseItemHasRecipientsUsage).toMatch(/flex\s*:\s*none/);
		expect(doseItemHasRecipientsUsage).toMatch(/min-width\s*:\s*max-content/);
		expect(doseItemHasRecipientsRecipients).toMatch(/justify-self\s*:\s*end/);
		expect(doseItemHasRecipientsRecipients).toMatch(/width\s*:\s*auto/);
		expect(doseItemHasRecipientsRecipients).toMatch(/min-width\s*:\s*max-content/);
		expect(doseItemHasRecipientsRecipients).toMatch(/overflow\s*:\s*visible/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/max-width\s*:\s*none/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/overflow\s*:\s*visible/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/text-overflow\s*:\s*clip/);
		expect(doseItemHasRecipientsReminder).toMatch(/grid-column\s*:\s*4/);
		expect(dosePerson).toMatch(/display\s*:\s*grid/);
		expect(dosePerson).toMatch(/width\s*:\s*calc\(100% \+ 1rem\)/);
		expect(dosePerson).toMatch(/margin-inline\s*:\s*-0\.5rem/);
		expect(dosePerson).toMatch(/--dose-action-take-width\s*:\s*clamp\(5\.35rem, 23vw, 7\.1rem\)/);
		expect(dosePerson).toMatch(/--dose-action-skip-width\s*:\s*clamp\(5\.75rem, 24vw, 6\.75rem\)/);
		expect(dosePerson).toMatch(/--dose-action-journal-width\s*:\s*clamp\(5rem, 21vw, 6\.35rem\)/);
		expect(dosePerson).toMatch(
			/grid-template-columns\s*:\s*minmax\(var\(--dose-action-take-width\), 1fr\) minmax\(var\(--dose-action-skip-width\), 1fr\)\s*minmax\(var\(--dose-action-journal-width\), 1fr\)/
		);
		expect(dosePerson).toMatch(/gap\s*:\s*0\.25rem/);
		expect(dosePerson).toMatch(/padding\s*:\s*0\.28rem/);
		expect(dosePersonName).toMatch(/grid-column\s*:\s*1 \/ -1/);
		expect(dosePersonName).toMatch(/justify-self\s*:\s*end/);
		expect(singleRecipientDosePerson).not.toMatch(/grid-template-columns/);
		expect(anonymousDosePerson).not.toMatch(/grid-template-columns/);
		expect(dosePersonButton).toMatch(/width\s*:\s*100%/);
		expect(dosePersonRawButton).toMatch(/width\s*:\s*100%/);
		expect(tooltipTarget).toMatch(/width\s*:\s*100%/);
		expect(actionButton).toMatch(/font-size-adjust\s*:\s*0\.52/);
		expect(buttonInner).toMatch(/display\s*:\s*flex/);
		expect(buttonInner).toMatch(/justify-content\s*:\s*center/);
		expect(buttonInner).toMatch(/overflow\s*:\s*visible/);
		expect(buttonLabel).toMatch(/width\s*:\s*100%/);
		expect(buttonLabel).toMatch(/flex\s*:\s*1 1 auto/);
		expect(buttonLabel).toMatch(/overflow\s*:\s*visible/);
		expect(buttonLabel).toMatch(/text-align\s*:\s*center/);
		expect(buttonLabel).toMatch(/line-height\s*:\s*1\.1/);
		expect(actionLabel).toMatch(/text-align\s*:\s*center/);
		expect(actionLabel).toMatch(/text-overflow\s*:\s*clip/);
		expect(actionLabel).not.toMatch(/text-overflow\s*:\s*ellipsis/);
		expect(skipActionLabel).toMatch(/width\s*:\s*100%/);
		expect(undoButtonLabel).toMatch(/gap\s*:\s*0\.22rem/);
		expect(buttonCss).toMatch(/@media \(max-width: 600px\)[\s\S]*--button-padding-x\s*:\s*0\.62rem/);
		expect(buttonCss).toMatch(/@media \(max-width: 600px\)[\s\S]*--button-fz\s*:\s*0\.78rem/);
		expect(buttonCss).toMatch(/@media \(max-width: 600px\)[\s\S]*font-size\s*:\s*0\.78rem/);
		expect(buttonCss).toMatch(/@media \(max-width: 600px\)[\s\S]*padding-inline\s*:\s*0\.62rem/);
		expect(buttonCss).toMatch(
			/@media \(max-width: 600px\)[\s\S]*\.undo:global\(\.mantine-Button-root\)[\s\S]*padding-inline\s*:\s*0\.25rem[\s\S]*font-size\s*:\s*0\.74rem/
		);
		expect(buttonCss).toMatch(
			/@supports \(-moz-appearance: none\)[\s\S]*\.button:global\(\.mantine-Button-root\)[\s\S]*--button-fz\s*:\s*0\.72rem[\s\S]*font-size\s*:\s*0\.72rem/
		);
		expect(buttonCss).toMatch(
			/@supports \(-moz-appearance: none\)[\s\S]*\.undo:global\(\.mantine-Button-root\)[\s\S]*--button-fz\s*:\s*0\.68rem[\s\S]*font-size\s*:\s*0\.68rem/
		);
		expect(buttonCss).not.toMatch(/font-size\s*:\s*clamp\(0\.62rem, 2\.45vw, 0\.7rem\)/);
		expect(buttonCss).toMatch(
			/@media \(min-width: 601px\)[\s\S]*\.takeAction:global\(\.mantine-Button-root\)[\s\S]*\.skipAction:global\(\.mantine-Button-root\)[\s\S]*width\s*:\s*7\.5rem[\s\S]*min-width\s*:\s*7\.5rem/
		);
		expect(takeAction).toMatch(/grid-column\s*:\s*1/);
		expect(skipAction).toMatch(/grid-column\s*:\s*2/);
		expect(journalAction).toMatch(/grid-column\s*:\s*3/);
		expect(doseRecipientName).toMatch(/line-height\s*:\s*1\.3/);
		expect(dashboardSource).toContain('className="dose-recipient-name"');
		expect(dashboardSource).toContain("lineHeight={1.3}");
		expect(dashboardSource).toContain('paddingBlockEnd: "0.08em"');
		expect(dashboardSource).toContain('t("common.pillShort")');
		expect(dashboardSource).toContain('t("common.pillsShort")');
		for (const source of doseActionSources) {
			expect(source).toContain('const hideDoseActionIcons = i18n.language.startsWith("de");');
			expect(source).toContain("inner: doseButtonClasses.buttonInner");
			expect(source).toContain("label: doseButtonClasses.buttonLabel");
			expect(source).toContain("classNames={doseActionButtonClassNames}");
			expect(source).toContain("options.isAutomaticallyTaken && !hideDoseActionIcons");
			expect(source).toContain("options.isEmpty && !hideDoseActionIcons");
			expect(source).toContain('t("dose.undoAction")');
			expect(source).toContain("<Undo2");
			expect(source).not.toContain("{!hideDoseActionIcons && <Undo2");
			expect(source).toContain("<NotebookPen");
			expect(source).not.toContain("{!hideDoseActionIcons && <NotebookPen");
			expect(source).not.toContain('t("common.undo")');
			expect(source).not.toContain("<Check");
		}
	});

	it("lets desktop dose action names use the available row width", () => {
		const surfacesCss = readSource("AppSurfaces.css");

		expect(surfacesCss).toMatch(
			/@media \(min-width: 769px\)[\s\S]*\.dose-item \{[\s\S]*grid-template-columns\s*:\s*5rem minmax\(8rem, 1fr\) auto max-content/
		);
		expect(surfacesCss).toMatch(
			/@media \(min-width: 769px\)[\s\S]*\.dose-item \.dose-checks \{[\s\S]*min-width\s*:\s*max-content[\s\S]*max-width\s*:\s*100%/
		);
		expect(surfacesCss).toMatch(/@media \(min-width: 769px\)[\s\S]*\.dose-person \{[\s\S]*flex-wrap\s*:\s*nowrap/);
		expect(surfacesCss).toMatch(
			/@media \(min-width: 769px\)[\s\S]*\.dose-person \.person-name \{[\s\S]*min-width\s*:\s*max-content[\s\S]*max-width\s*:\s*none[\s\S]*white-space\s*:\s*nowrap[\s\S]*overflow-wrap\s*:\s*normal/
		);
	});

	it("keeps shared mobile recipient names in the dose summary row", () => {
		const sharedCss = readSource("components/SharedSchedule.module.css");
		const doseItemHasRecipients = blockFor(sharedCss, ".shared-schedule-section :global(.dose-item.has-recipients)");
		const doseSummary = blockFor(sharedCss, ".shared-schedule-section :global(.dose-summary)");
		const doseItemHasRecipientsSummary = blockFor(
			sharedCss,
			".shared-schedule-section :global(.dose-item.has-recipients .dose-summary)"
		);
		const doseItemHasRecipientsUsage = blockFor(
			sharedCss,
			".shared-schedule-section :global(.dose-item.has-recipients .dose-usage)"
		);
		const doseItemHasRecipientsRecipients = blockFor(
			sharedCss,
			".shared-schedule-section :global(.dose-item.has-recipients) .shared-dose-recipients"
		);
		const doseItemHasRecipientsRecipientName = blockFor(
			sharedCss,
			".shared-schedule-section :global(.dose-item.has-recipients) .shared-dose-recipient-name"
		);
		const recipients = lastBlockFor(sharedCss, ".shared-dose-recipients");
		const recipientName = lastBlockFor(sharedCss, ".shared-dose-recipient-name");
		const actionRecipientName = blockFor(sharedCss, ".shared-action-recipient-name");
		const hiddenActionRowName = blockFor(
			sharedCss,
			".shared-schedule-section :global(.dose-checks.has-recipient-summary:not(.multi-person) .person-name)"
		);
		const sharedDosePerson = blockFor(sharedCss, ".shared-schedule-section :global(.dose-person)");
		const sharedDosePersonName = blockFor(sharedCss, ".shared-schedule-section :global(.dose-person .person-name)");
		const takeAction = blockFor(sharedCss, ".shared-schedule-section :global(.shared-dose-action-take)");
		const skipAction = blockFor(sharedCss, ".shared-schedule-section :global(.shared-dose-action-skip)");
		const journalAction = blockFor(sharedCss, ".shared-schedule-section :global(.shared-dose-action-journal)");

		expect(sharedCss).not.toContain(".shared-timeline");
		expect(sharedCss).not.toContain(".shared-dose {");
		expect(sharedCss).not.toContain(".shared-schedule-section :global(.dose-recipients)");
		expect(sharedCss).not.toMatch(
			/\.shared-schedule-section\s+\.(timeline|day-block|time-row|time-main|doses-col|dose-item|dose-checks|dose-person)/
		);
		expect(doseItemHasRecipients).toMatch(
			/grid-template-columns\s*:\s*minmax\(3\.35rem, auto\) max-content minmax\(0, 1fr\) auto/
		);
		expect(doseItemHasRecipients).toMatch(/column-gap\s*:\s*0\.25rem/);
		expect(doseSummary).toMatch(/grid-column\s*:\s*2/);
		expect(doseSummary).toMatch(/display\s*:\s*flex/);
		expect(doseItemHasRecipientsSummary).toMatch(/grid-column\s*:\s*2 \/ 4/);
		expect(doseItemHasRecipientsSummary).toMatch(/display\s*:\s*grid/);
		expect(doseItemHasRecipientsSummary).toMatch(/grid-template-columns\s*:\s*minmax\(0, 1fr\) max-content/);
		expect(doseItemHasRecipientsSummary).toMatch(/column-gap\s*:\s*0\.4rem/);
		expect(doseItemHasRecipientsUsage).toMatch(/flex\s*:\s*none/);
		expect(doseItemHasRecipientsUsage).toMatch(/min-width\s*:\s*max-content/);
		expect(recipients).toMatch(/display\s*:\s*flex/);
		expect(recipients).toMatch(/justify-content\s*:\s*flex-end/);
		expect(doseItemHasRecipientsRecipients).toMatch(/justify-self\s*:\s*end/);
		expect(doseItemHasRecipientsRecipients).toMatch(/width\s*:\s*auto/);
		expect(doseItemHasRecipientsRecipients).toMatch(/min-width\s*:\s*max-content/);
		expect(doseItemHasRecipientsRecipients).toMatch(/overflow\s*:\s*visible/);
		expect(recipientName).toMatch(/text-overflow\s*:\s*ellipsis/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/max-width\s*:\s*none/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/overflow\s*:\s*visible/);
		expect(doseItemHasRecipientsRecipientName).toMatch(/text-overflow\s*:\s*clip/);
		expect(hiddenActionRowName).toMatch(/display\s*:\s*none/);
		expect(actionRecipientName).toMatch(/display\s*:\s*none/);
		expect(sharedDosePerson).toMatch(/--dose-action-skip-width\s*:\s*clamp\(5\.75rem, 24vw, 6\.75rem\)/);
		expect(sharedDosePerson).toMatch(/width\s*:\s*calc\(100% \+ 1rem\)/);
		expect(sharedDosePerson).toMatch(/margin-inline\s*:\s*-0\.5rem/);
		expect(sharedDosePerson).toMatch(
			/grid-template-columns\s*:\s*minmax\(var\(--dose-action-take-width\), 1fr\) minmax\(var\(--dose-action-skip-width\), 1fr\)\s*minmax\(var\(--dose-action-journal-width\), 1fr\)/
		);
		expect(sharedDosePerson).toMatch(/gap\s*:\s*0\.25rem/);
		expect(sharedDosePerson).toMatch(/padding\s*:\s*0\.28rem/);
		expect(sharedDosePersonName).toMatch(/grid-column\s*:\s*1 \/ -1/);
		expect(sharedDosePersonName).toMatch(/justify-self\s*:\s*end/);
		expect(takeAction).toMatch(/grid-column\s*:\s*1/);
		expect(skipAction).toMatch(/grid-column\s*:\s*2/);
		expect(journalAction).toMatch(/grid-column\s*:\s*3/);
	});
});
