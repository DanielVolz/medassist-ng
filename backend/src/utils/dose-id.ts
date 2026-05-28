const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

export type ParsedDoseId = {
	medicationId: number;
	intakeIndex: number;
	timestampMs: number;
	personSuffix: string | null;
};

export function parseDoseId(doseId: string): ParsedDoseId | null {
	const match = doseIdPattern.exec(doseId);
	if (!match) {
		return null;
	}

	const medicationId = Number.parseInt(match[1], 10);
	const intakeIndex = Number.parseInt(match[2], 10);
	const timestampMs = Number.parseInt(match[3], 10);
	const personSuffix = match[4] ? match[4].trim() : null;

	if (Number.isNaN(medicationId) || Number.isNaN(intakeIndex) || Number.isNaN(timestampMs) || intakeIndex < 0) {
		return null;
	}

	return {
		medicationId,
		intakeIndex,
		timestampMs,
		personSuffix,
	};
}

export function buildDoseId(
	medicationId: number,
	intakeIndex: number,
	timestampMs: number,
	personSuffix?: string | null
): string {
	const base = `${medicationId}-${intakeIndex}-${timestampMs}`;
	return personSuffix ? `${base}-${personSuffix}` : base;
}
