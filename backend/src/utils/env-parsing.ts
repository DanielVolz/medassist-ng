export interface ParseIntEnvOptions {
	defaultValue: number;
	min?: number;
	max?: number;
}

function normalizeEnvValue(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function parseBoolEnv(value: string | null | undefined, defaultValue: boolean): boolean {
	const normalized = normalizeEnvValue(value);
	if (normalized === undefined) {
		return defaultValue;
	}

	switch (normalized.toLowerCase()) {
		case "true":
		case "1":
		case "yes":
			return true;
		case "false":
		case "0":
		case "no":
			return false;
		default:
			throw new Error(`Invalid boolean environment value: ${value}`);
	}
}

export function parseIntEnv(value: string | null | undefined, options: ParseIntEnvOptions): number {
	const normalized = normalizeEnvValue(value);
	if (normalized === undefined) {
		return options.defaultValue;
	}

	if (!/^-?\d+$/.test(normalized)) {
		throw new Error(`Invalid integer environment value: ${value}`);
	}

	const parsed = Number.parseInt(normalized, 10);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`Invalid integer environment value: ${value}`);
	}

	if (options.min !== undefined && parsed < options.min) {
		throw new Error(`Environment integer value ${parsed} is below minimum ${options.min}`);
	}

	if (options.max !== undefined && parsed > options.max) {
		throw new Error(`Environment integer value ${parsed} is above maximum ${options.max}`);
	}

	return parsed;
}

export function parseStringListEnv(value: string | null | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}
