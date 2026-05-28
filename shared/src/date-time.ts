export function parseLocalDateTime(isoString: string): Date {
	const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
	if (!match) {
		return new Date(isoString);
	}

	const [, year, month, day, hour, minute, second] = match;
	return new Date(
		parseInt(year, 10),
		parseInt(month, 10) - 1,
		parseInt(day, 10),
		parseInt(hour, 10),
		parseInt(minute, 10),
		parseInt(second ?? "0", 10)
	);
}
