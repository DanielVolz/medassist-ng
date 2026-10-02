export const APP_LANGUAGES = ["en-US", "de-DE", "pt-PT", "es-ES"] as const;

export const LEGACY_APP_LANGUAGE_MAP = {
	en: "en-US",
	de: "de-DE",
} as const;

export const LEGACY_APP_LANGUAGES = Object.keys(LEGACY_APP_LANGUAGE_MAP) as Array<keyof typeof LEGACY_APP_LANGUAGE_MAP>;

export const APP_LANGUAGE_INPUTS = [...APP_LANGUAGES, ...LEGACY_APP_LANGUAGES] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function normalizeAppLanguage(value: unknown): AppLanguage {
	if (typeof value === "string") {
		if (value in LEGACY_APP_LANGUAGE_MAP) {
			return LEGACY_APP_LANGUAGE_MAP[value as keyof typeof LEGACY_APP_LANGUAGE_MAP];
		}

		const primaryLanguage = value.split("-")[0]?.toLowerCase();
		if (primaryLanguage === "de") return "de-DE";
		if (primaryLanguage === "pt") return "pt-PT";
		if (primaryLanguage === "es") return "es-ES";
	}

	return "en-US";
}
