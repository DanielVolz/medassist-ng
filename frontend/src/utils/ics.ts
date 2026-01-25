// =============================================================================
// ICS Calendar Generation
// =============================================================================

import type { Medication } from "../types";

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
	const events = med.blisters
		.map((blister, idx) => {
			const start = new Date(blister.start);
			const end = new Date(start.getTime() + 15 * 60 * 1000); // 15 min duration
			const interval = blister.every;

			const pillInfo = `${blister.usage} pill${blister.usage !== 1 ? "s" : ""}${med.pillWeightMg ? ` (${blister.usage * med.pillWeightMg} mg)` : ""}`;
			const summary = `💊 ${med.name} - ${pillInfo}`;
			const description = [
				`Medication: ${med.name}`,
				med.genericName ? `Generic: ${med.genericName}` : "",
				med.takenBy && med.takenBy.length > 0 ? `For: ${med.takenBy.join(", ")}` : "",
				`Dosage: ${pillInfo}`,
				`Frequency: every ${interval} day${interval !== 1 ? "s" : ""}`,
				med.notes ? `Notes: ${med.notes}` : "",
			]
				.filter(Boolean)
				.join("\\n");

			return `BEGIN:VEVENT
UID:medassist-ng-${med.id}-${idx}@medassist-ng
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(start)}
DTEND:${formatICSDate(end)}
RRULE:FREQ=DAILY;INTERVAL=${interval}
SUMMARY:${summary}
DESCRIPTION:${description}
BEGIN:VALARM
TRIGGER:-PT5M
ACTION:DISPLAY
DESCRIPTION:Time to take ${med.name}
END:VALARM
END:VEVENT`;
		})
		.join("\n");

	const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MedAssist-ng//Medication Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${med.name} Schedule
${events}
END:VCALENDAR`;

	const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${med.name.replace(/[^a-zA-Z0-9]/g, "_")}_schedule.ics`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
