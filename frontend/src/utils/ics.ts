// =============================================================================
// ICS Calendar Generation
// =============================================================================

import type { Medication } from "../types";
import { getMedDisplayName } from "../types";
import {
	getIntakeFrequencyText,
	getIntakeScheduleMode,
	getMedicationIntakes,
	getWeekdayIcsCode,
	normalizeWeekdays,
} from "./intake-schedule";

/**
 * Format a Date for ICS format (YYYYMMDDTHHMMSSZ)
 */
function formatICSDate(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

/**
 * Generate and download an ICS calendar file for a medication's schedule
 */
export function generateICS(med: Medication): void {
	const displayName = getMedDisplayName(med);
	const events = getMedicationIntakes(med)
		.map((intake, idx) => {
			const start = new Date(intake.start);
			const end = new Date(start.getTime() + 15 * 60 * 1000); // 15 min duration
			const interval = intake.every;

			const pillInfo = `${intake.usage} pill${intake.usage !== 1 ? "s" : ""}${med.pillWeightMg ? ` (${intake.usage * med.pillWeightMg} mg)` : ""}`;
			const summary = `💊 ${displayName} - ${pillInfo}`;
			const weekdayCodes = normalizeWeekdays(intake.weekdays);
			const frequencyText =
				getIntakeScheduleMode(intake) === "weekdays"
					? weekdayCodes.map(getWeekdayIcsCode).join(", ")
					: getIntakeFrequencyText(intake, (key, options) => {
							if (key === "common.daily") return "daily";
							if (key === "common.everyNDays") return `every ${options?.count ?? interval} days`;
							return key;
						});
			const rrule =
				getIntakeScheduleMode(intake) === "weekdays" && weekdayCodes.length > 0
					? `RRULE:FREQ=WEEKLY;BYDAY=${weekdayCodes.map(getWeekdayIcsCode).join(",")}`
					: `RRULE:FREQ=DAILY;INTERVAL=${interval}`;
			const description = [
				`Medication: ${displayName}`,
				med.genericName ? `Generic: ${med.genericName}` : "",
				med.takenBy && med.takenBy.length > 0 ? `For: ${med.takenBy.join(", ")}` : "",
				`Dosage: ${pillInfo}`,
				`Frequency: ${frequencyText}`,
				med.notes ? `Notes: ${med.notes}` : "",
			]
				.filter(Boolean)
				.join("\\n");

			return `BEGIN:VEVENT
UID:medassist-ng-${med.id}-${idx}@medassist-ng
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(start)}
DTEND:${formatICSDate(end)}
${rrule}
SUMMARY:${summary}
DESCRIPTION:${description}
BEGIN:VALARM
TRIGGER:-PT5M
ACTION:DISPLAY
DESCRIPTION:Time to take ${displayName}
END:VALARM
END:VEVENT`;
		})
		.join("\n");

	const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MedAssist-ng//Medication Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${displayName} Schedule
${events}
END:VCALENDAR`;

	const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${displayName.replace(/[^a-zA-Z0-9]/g, "_")}_schedule.ics`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
