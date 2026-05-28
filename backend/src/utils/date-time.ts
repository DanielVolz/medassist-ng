export function normalizeDateTime(value: unknown): string | null {
	if (value == null) {
		return null;
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}

	if (typeof value === "number") {
		const timestampMs = value < 1_000_000_000_000 ? value * 1000 : value;
		const date = new Date(timestampMs);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	if (typeof value === "string") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	return null;
}
