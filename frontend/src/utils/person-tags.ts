export function getPersonTagKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

export function personTagsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
	if (typeof left !== "string" || typeof right !== "string") {
		return false;
	}

	return getPersonTagKey(left) === getPersonTagKey(right);
}

export function mergePersonTags(values: Array<string | null | undefined>): string[] {
	const merged = new Map<string, string>();

	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}

		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}

		const key = getPersonTagKey(trimmed);
		if (!merged.has(key)) {
			merged.set(key, trimmed);
		}
	}

	return Array.from(merged.values()).sort((left, right) =>
		left.localeCompare(right, undefined, { sensitivity: "accent" })
	);
}
