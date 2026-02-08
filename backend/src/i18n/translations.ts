// Backend translations for notifications
export type Language = "en" | "de";

/**
 * Map timezone to region code (ISO 3166-1 alpha-2).
 * This allows combining app language with regional formatting.
 */
const TIMEZONE_TO_REGION: Record<string, string> = {
	// Europe
	"Europe/Berlin": "DE",
	"Europe/Vienna": "AT",
	"Europe/Zurich": "CH",
	"Europe/London": "GB",
	"Europe/Dublin": "IE",
	"Europe/Paris": "FR",
	"Europe/Madrid": "ES",
	"Europe/Rome": "IT",
	"Europe/Amsterdam": "NL",
	"Europe/Brussels": "BE",
	"Europe/Warsaw": "PL",
	"Europe/Prague": "CZ",
	"Europe/Stockholm": "SE",
	"Europe/Oslo": "NO",
	"Europe/Copenhagen": "DK",
	"Europe/Helsinki": "FI",
	"Europe/Athens": "GR",
	"Europe/Lisbon": "PT",
	"Europe/Moscow": "RU",
	"Europe/Kiev": "UA",
	"Europe/Kyiv": "UA",
	"Europe/Budapest": "HU",
	"Europe/Bucharest": "RO",
	// Americas
	"America/New_York": "US",
	"America/Chicago": "US",
	"America/Denver": "US",
	"America/Los_Angeles": "US",
	"America/Phoenix": "US",
	"America/Toronto": "CA",
	"America/Vancouver": "CA",
	"America/Mexico_City": "MX",
	"America/Sao_Paulo": "BR",
	"America/Buenos_Aires": "AR",
	// Asia/Pacific
	"Asia/Tokyo": "JP",
	"Asia/Shanghai": "CN",
	"Asia/Hong_Kong": "HK",
	"Asia/Singapore": "SG",
	"Asia/Seoul": "KR",
	"Asia/Dubai": "AE",
	"Asia/Kolkata": "IN",
	"Australia/Sydney": "AU",
	"Australia/Melbourne": "AU",
	"Pacific/Auckland": "NZ",
};

/**
 * Get region code from TZ environment variable.
 */
function getRegionFromTimezone(): string | undefined {
	const tz = process.env.TZ;
	if (!tz) return undefined;
	return TIMEZONE_TO_REGION[tz];
}

type TranslationKeys = {
	// Stock reminder email
	stockReminder: {
		subject: string;
		title: string;
		description: string;
		alertSingle: string;
		alertMultiple: string;
		tableHeaders: {
			medication: string;
			pills: string;
			days: string;
			runsOut: string;
		};
		footer: string;
		repeatDailyNote: string;
	};
	// Intake reminder email
	intakeReminder: {
		subject: string;
		title: string;
		description: string;
		alertSingle: string;
		alertMultiple: string;
		tableHeaders: {
			medication: string;
			dosage: string;
			time: string;
		};
		pills: string;
		takenBy: string;
		footer: string;
	};
	// Push notifications
	push: {
		stockTitle: string;
		stockTitleMultiple: string;
		intakeTitle: string;
		pillsLeft: string;
		daysLeft: string;
		pillsAt: string;
		repeatDailyNote: string;
		empty: string;
		low: string;
		reorderNow: string;
		emptySection: string;
		lowSection: string;
	};
	// Common
	common: {
		pill: string;
		pills: string;
		day: string;
		days: string;
		soon: string;
	};
};

const translations: Record<Language, TranslationKeys> = {
	en: {
		stockReminder: {
			subject: "MedAssist-ng Auto-Reminder: {count} Medication{s} Running Low",
			title: "⚠️ MedAssist-ng - Automatic Reorder Reminder",
			description: "The following medications are running low and need to be reordered:",
			alertSingle: "⚠️ 1 medication running low!",
			alertMultiple: "⚠️ {count} medications running low!",
			tableHeaders: {
				medication: "Medication",
				pills: "Pills",
				days: "Days",
				runsOut: "Runs Out",
			},
			footer: "🤖 Automatic reminder from MedAssist-ng",
			repeatDailyNote: "You are receiving this daily reminder because 'Repeat Daily' is enabled in settings.",
		},
		intakeReminder: {
			subject: "MedAssist-ng: Medication Reminder - {medications}",
			title: "💊 MedAssist-ng - Intake Reminder",
			description: "Time to take your medication in {minutes} minutes:",
			alertSingle: "💊 1 medication scheduled",
			alertMultiple: "💊 {count} medications scheduled",
			tableHeaders: {
				medication: "Medication",
				dosage: "Dosage",
				time: "Time",
			},
			pills: "pills",
			takenBy: "for {name}",
			footer: "🤖 Automatic reminder from MedAssist-ng",
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medication Running Low",
			stockTitleMultiple: "MedAssist-ng: {count} Medications Running Low",
			intakeTitle: "💊 Reminder: Medication intake in {minutes} min",
			pillsLeft: "{count} pills",
			daysLeft: "{count} days left",
			pillsAt: "{count} pills at {time}",
			repeatDailyNote: "(Daily reminder enabled)",
			empty: "Empty",
			low: "Low",
			reorderNow: "Reorder Now!",
			emptySection: "EMPTY (reorder immediately)",
			lowSection: "RUNNING LOW (reorder soon)",
		},
		common: {
			pill: "pill",
			pills: "pills",
			day: "day",
			days: "days",
			soon: "soon",
		},
	},
	de: {
		stockReminder: {
			subject: "MedAssist-ng Auto-Erinnerung: {count} Medikament{e} wird knapp",
			title: "⚠️ MedAssist-ng - Automatische Nachbestell-Erinnerung",
			description: "Die folgenden Medikamente gehen zur Neige und sollten nachbestellt werden:",
			alertSingle: "⚠️ 1 Medikament wird knapp!",
			alertMultiple: "⚠️ {count} Medikamente werden knapp!",
			tableHeaders: {
				medication: "Medikament",
				pills: "Tabletten",
				days: "Tage",
				runsOut: "Aufgebraucht",
			},
			footer: "🤖 Automatische Erinnerung von MedAssist-ng",
			repeatDailyNote:
				"Sie erhalten diese tägliche Erinnerung, weil 'Täglich wiederholen' in den Einstellungen aktiviert ist.",
		},
		intakeReminder: {
			subject: "MedAssist-ng: Einnahme-Erinnerung - {medications}",
			title: "💊 MedAssist-ng - Einnahme-Erinnerung",
			description: "Zeit für Ihre Medikamente in {minutes} Minuten:",
			alertSingle: "💊 1 Medikament geplant",
			alertMultiple: "💊 {count} Medikamente geplant",
			tableHeaders: {
				medication: "Medikament",
				dosage: "Dosis",
				time: "Uhrzeit",
			},
			pills: "Tabletten",
			takenBy: "für {name}",
			footer: "🤖 Automatische Erinnerung von MedAssist-ng",
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medikament wird knapp",
			stockTitleMultiple: "MedAssist-ng: {count} Medikamente werden knapp",
			intakeTitle: "💊 Erinnerung: Medikamenteneinnahme in {minutes} Min.",
			pillsLeft: "{count} Tabletten",
			daysLeft: "{count} Tage übrig",
			pillsAt: "{count} Tabletten um {time}",
			repeatDailyNote: "(Tägliche Erinnerung aktiviert)",
			empty: "Leer",
			low: "Knapp",
			reorderNow: "Jetzt nachbestellen!",
			emptySection: "LEER (sofort nachbestellen)",
			lowSection: "WIRD KNAPP (bald nachbestellen)",
		},
		common: {
			pill: "Tablette",
			pills: "Tabletten",
			day: "Tag",
			days: "Tage",
			soon: "bald",
		},
	},
};

export function getTranslations(language: Language): TranslationKeys {
	return translations[language] || translations.en;
}

// Helper function to replace placeholders in strings
export function t(template: string, params: Record<string, string | number> = {}): string {
	let result = template;
	for (const [key, value] of Object.entries(params)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
	}
	return result;
}

/**
 * Get locale for formatting based on language and timezone region.
 * Combines language (en/de) with region from timezone (DE/US/etc.)
 * Example: lang=en + TZ=Europe/Berlin → en-DE (English text, German format = 24h time)
 */
export function getDateLocale(language: Language): string {
	const region = getRegionFromTimezone();

	if (region) {
		return `${language}-${region}`;
	}

	// Fallback: use language default
	switch (language) {
		case "de":
			return "de-DE";
		default:
			return "en-US";
	}
}
