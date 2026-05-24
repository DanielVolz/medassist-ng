function pad(value: number, size = 2): string {
	return String(value).padStart(size, "0");
}

export function toLocalDateTimeOffsetString(value: Date): string {
	const offsetMinutes = -value.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffsetMinutes = Math.abs(offsetMinutes);
	const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
	const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

	return [
		`${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
		`T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`,
		`${sign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`,
	].join("");
}
