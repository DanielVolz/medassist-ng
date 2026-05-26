// Backend translations for notifications
import { parseStringListEnv } from "../utils/env-parsing.js";

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
	// Stock reminder (shared across email + push)
	stockReminder: {
		subject: string;
		title: string;
		description: string;
		descriptionEmpty: string;
		descriptionMixed: string;
		alertSingle: string;
		alertMultiple: string;
		alertEmptySingle: string;
		alertEmptyMultiple: string;
		alertLowSingle: string;
		alertLowMultiple: string;
		alertLowStockSingle: string;
		alertLowStockMultiple: string;
		descriptionLow: string;
		tableHeaders: {
			medication: string;
			pills: string;
			days: string;
			runsOut: string;
		};
		now: string;
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
	};
	// Push notifications
	push: {
		stockTitle: string;
		stockTitleMultiple: string;
		intakeTitle: string;
		intakeTakenConfirmation: string;
		intakeSkippedConfirmation: string;
		pillsLeft: string;
		daysLeft: string;
		pillsAt: string;
		repeatDailyNote: string;
		empty: string;
		low: string;
		critical: string;
		lowStock: string;
		reorderNow: string;
		emptySection: string;
		lowSection: string;
		criticalSection: string;
		lowStockSection: string;
	};
	// Prescription reminder (shared across email + push)
	prescriptionReminder: {
		subjectSingle: string;
		subjectMultiple: string;
		pushTitleLow: string;
		pushTitleEmpty: string;
		pushEmpty: string;
		pushEmptySingle: string;
		pushLow: string;
		pushLowSingle: string;
		pushRenewNow: string;
		pushEmptySection: string;
		pushLowSection: string;
		pushRefillsLeft: string;
		title: string;
		titleEmpty: string;
		descriptionLow: string;
		descriptionEmpty: string;
		alertLowSingle: string;
		alertLowMultiple: string;
		alertEmptySingle: string;
		alertEmptyMultiple: string;
		line: string;
		lineEmpty: string;
		expiresSuffix: string;
		repeatDailyNote: string;
		tableHeaders: {
			medication: string;
			refillsLeft: string;
			reminderThreshold: string;
			prescriptionExpires: string;
		};
	};
	// Demand calculator email
	demandCalculator: {
		subject: string;
		title: string;
		description: string;
		summaryOutOfStock: string;
		summaryAllOk: string;
		tableHeaders: {
			medication: string;
			usage: string;
			needed: string;
			prescriptionRefills: string;
			available: string;
			status: string;
		};
		statusEnough: string;
		statusEmpty: string;
		prescriptionNotApplicable: string;
	};
	// Common
	common: {
		pill: string;
		pills: string;
		puffs: string;
		injections: string;
		units: string;
		ml: string;
		blister: string;
		blisters: string;
		day: string;
		days: string;
		soon: string;
		footer: string;
	};
};

const translations: Record<Language, TranslationKeys> = {
	en: {
		stockReminder: {
			subject: "MedAssist-ng: ⚠️ {count} Medication{s} Running Critically Low",
			title: "⚠️ MedAssist-ng: Automatic Reorder Reminder",
			description: "The following medications are running critically low and need to be reordered:",
			descriptionEmpty: "The following medications are empty and need to be reordered immediately:",
			descriptionMixed: "The following medications need to be reordered:",
			alertSingle: "⚠️ 1 medication running critically low!",
			alertMultiple: "⚠️ {count} medications running critically low!",
			alertEmptySingle: "🚨 1 medication empty - reorder immediately!",
			alertEmptyMultiple: "🚨 {count} medications empty - reorder immediately!",
			alertLowSingle: "⚠️ 1 medication running critically low",
			alertLowMultiple: "⚠️ {count} medications running critically low",
			alertLowStockSingle: "⚠️ 1 medication running low",
			alertLowStockMultiple: "⚠️ {count} medications running low",
			descriptionLow: "The following medications are running low and should be reordered soon:",
			tableHeaders: {
				medication: "Medication",
				pills: "Available",
				days: "Days",
				runsOut: "Runs Out",
			},
			now: "NOW",
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
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medication Running Critically Low",
			stockTitleMultiple: "MedAssist-ng: {count} Medications Running Critically Low",
			intakeTitle: "💊 Reminder: Medication intake in {minutes} min",
			intakeTakenConfirmation: "✅ This dose was marked as taken.",
			intakeSkippedConfirmation: "⏭️ This intake was marked as skipped.",
			pillsLeft: "{count} pills",
			daysLeft: "{count} days left",
			pillsAt: "{count} pills at {time}",
			repeatDailyNote: "(Daily reminder enabled)",
			empty: "Empty",
			low: "Critical",
			critical: "Critical",
			lowStock: "Low",
			reorderNow: "Reorder Now!",
			emptySection: "Empty (reorder immediately)",
			lowSection: "Running critically low",
			criticalSection: "Running critically low",
			lowStockSection: "Running low",
		},
		prescriptionReminder: {
			subjectSingle: "MedAssist-ng: 🚨 Prescription Refill Reminder",
			subjectMultiple: "MedAssist-ng: 🚨 {count} Prescriptions Need Renewal Soon",
			pushTitleLow: "💊 MedAssist-ng: {count} prescriptions are running low",
			pushTitleEmpty: "💊 MedAssist-ng: {count} prescriptions need renewal now",
			pushEmpty: "prescriptions out of refills",
			pushEmptySingle: "prescription out of refills",
			pushLow: "prescriptions low on refills",
			pushLowSingle: "prescription low on refills",
			pushRenewNow: "Renew Now!",
			pushEmptySection: "Prescriptions with no refills left",
			pushLowSection: "Prescriptions running low on refills",
			pushRefillsLeft: "{count} refill(s) remaining on this prescription",
			title: "⚠️ MedAssist-ng - Prescription Reminder",
			titleEmpty: "🚨 MedAssist-ng - Prescription Reminder",
			descriptionLow: "Some prescriptions are low on remaining refills.",
			descriptionEmpty: "Some prescriptions have no refills left. Contact your doctor for renewal.",
			alertLowSingle: "⚠️ 1 prescription is low on refills",
			alertLowMultiple: "⚠️ {count} prescriptions are low on refills",
			alertEmptySingle: "🚨 1 prescription needs renewal now",
			alertEmptyMultiple: "🚨 {count} prescriptions need renewal now",
			line: "{name}: {refills} refill(s) remaining on this prescription{expirySuffix}",
			lineEmpty: "{name}: no refills remaining on this prescription{expirySuffix}",
			expiresSuffix: ", expires {date}",
			repeatDailyNote: "You are receiving this daily reminder because 'Repeat Daily' is enabled in settings.",
			tableHeaders: {
				medication: "Medication",
				refillsLeft: "Prescription refills left",
				reminderThreshold: "Reminder threshold",
				prescriptionExpires: "Prescription expires",
			},
		},
		demandCalculator: {
			subject: "MedAssist-ng: Supply Overview ({from} - {until})",
			title: "MedAssist-ng: Demand Calculator",
			description: "Supply overview from {from} to {until}",
			summaryOutOfStock: "⚠️ {count} medication{s} will be out of stock during this period.",
			summaryAllOk: "✓ All medications have sufficient supply for this period.",
			tableHeaders: {
				medication: "Medication",
				usage: "Usage",
				needed: "Blisters needed",
				prescriptionRefills: "Prescription refills",
				available: "Available",
				status: "Status",
			},
			statusEnough: "✓ Enough",
			statusEmpty: "✗ Empty",
			prescriptionNotApplicable: "–",
		},
		common: {
			pill: "pill",
			pills: "pills",
			puffs: "puffs",
			injections: "injections",
			units: "units",
			ml: "ml",
			blister: "blister",
			blisters: "blisters",
			day: "day",
			days: "days",
			soon: "soon",
			footer: "🤖 Sent from MedAssist-ng",
		},
	},
	de: {
		stockReminder: {
			subject: "MedAssist-ng: ⚠️ {count} Medikament{e} kritisch niedrig",
			title: "⚠️ MedAssist-ng: Automatische Nachbestell-Erinnerung",
			description: "Die folgenden Medikamente sind kritisch niedrig und sollten nachbestellt werden:",
			descriptionEmpty: "Die folgenden Medikamente sind leer und müssen sofort nachbestellt werden:",
			descriptionMixed: "Die folgenden Medikamente müssen nachbestellt werden:",
			alertSingle: "⚠️ 1 Medikament kritisch niedrig!",
			alertMultiple: "⚠️ {count} Medikamente kritisch niedrig!",
			alertEmptySingle: "🚨 1 Medikament leer - sofort nachbestellen!",
			alertEmptyMultiple: "🚨 {count} Medikamente leer - sofort nachbestellen!",
			alertLowSingle: "⚠️ 1 Medikament kritisch niedrig",
			alertLowMultiple: "⚠️ {count} Medikamente kritisch niedrig",
			alertLowStockSingle: "⚠️ 1 Medikament niedrig",
			alertLowStockMultiple: "⚠️ {count} Medikamente niedrig",
			descriptionLow: "Die folgenden Medikamente werden knapp und sollten bald nachbestellt werden:",
			tableHeaders: {
				medication: "Medikament",
				pills: "Verfuegbar",
				days: "Tage",
				runsOut: "Aufgebraucht",
			},
			now: "JETZT",
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
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medikament kritisch niedrig",
			stockTitleMultiple: "MedAssist-ng: {count} Medikamente kritisch niedrig",
			intakeTitle: "💊 Erinnerung: Medikamenteneinnahme in {minutes} Min.",
			intakeTakenConfirmation: "✅ Diese Einnahme wurde als genommen markiert.",
			intakeSkippedConfirmation: "⏭️ Diese Einnahme wurde als übersprungen markiert.",
			pillsLeft: "{count} Tabletten",
			daysLeft: "{count} Tage übrig",
			pillsAt: "{count} Tabletten um {time}",
			repeatDailyNote: "(Tägliche Erinnerung aktiviert)",
			empty: "Leer",
			low: "Kritisch",
			critical: "Kritisch",
			lowStock: "Niedrig",
			reorderNow: "Jetzt nachbestellen!",
			emptySection: "Leer (sofort nachbestellen)",
			lowSection: "Kritisch niedrig",
			criticalSection: "Kritisch niedrig",
			lowStockSection: "Niedrig",
		},
		prescriptionReminder: {
			subjectSingle: "MedAssist-ng: 🚨 Rezept-Nachfüll-Erinnerung",
			subjectMultiple: "MedAssist-ng: 🚨 {count} Rezepte müssen bald erneuert werden",
			pushTitleLow: "💊 MedAssist-ng: {count} Rezept(e) haben nur noch wenige Nachfüllungen",
			pushTitleEmpty: "💊 MedAssist-ng: {count} Rezept(e) müssen jetzt erneuert werden",
			pushEmpty: "Rezepte ohne verbleibende Nachfüllung",
			pushEmptySingle: "Rezept ohne verbleibende Nachfüllung",
			pushLow: "Rezepte mit wenigen verbleibenden Nachfüllungen",
			pushLowSingle: "Rezept mit wenigen verbleibenden Nachfüllungen",
			pushRenewNow: "Jetzt erneuern!",
			pushEmptySection: "Rezepte ohne Nachfüllungen",
			pushLowSection: "Rezepte mit bald aufgebrauchten Nachfüllungen",
			pushRefillsLeft: "{count} Nachfüllung(en) für dieses Rezept übrig",
			title: "⚠️ MedAssist-ng - Rezept-Erinnerung",
			titleEmpty: "🚨 MedAssist-ng - Rezept-Erinnerung",
			descriptionLow: "Einige Rezepte haben nur noch wenige Nachfüllungen.",
			descriptionEmpty:
				"Einige Rezepte haben keine Nachfüllungen mehr. Bitte kontaktieren Sie Ihren Arzt für eine Erneuerung.",
			alertLowSingle: "⚠️ 1 Rezept ist bei den Nachfüllungen niedrig",
			alertLowMultiple: "⚠️ {count} Rezepte sind bei den Nachfüllungen niedrig",
			alertEmptySingle: "🚨 1 Rezept muss jetzt erneuert werden",
			alertEmptyMultiple: "🚨 {count} Rezepte müssen jetzt erneuert werden",
			line: "{name}: {refills} Nachfüllung(en) für dieses Rezept übrig{expirySuffix}",
			lineEmpty: "{name}: keine Nachfüllung mehr für dieses Rezept{expirySuffix}",
			expiresSuffix: ", läuft ab {date}",
			repeatDailyNote:
				"Sie erhalten diese tägliche Erinnerung, weil 'Täglich wiederholen' in den Einstellungen aktiviert ist.",
			tableHeaders: {
				medication: "Medikament",
				refillsLeft: "Rezept-Nachfüllungen übrig",
				reminderThreshold: "Erinnerungsschwelle",
				prescriptionExpires: "Rezeptablauf",
			},
		},
		demandCalculator: {
			subject: "MedAssist-ng: Bestandsübersicht ({from} - {until})",
			title: "MedAssist-ng: Bedarfsrechner",
			description: "Bestandsübersicht von {from} bis {until}",
			summaryOutOfStock: "⚠️ {count} Medikament{e} wird im Zeitraum nicht ausreichen.",
			summaryAllOk: "✓ Alle Medikamente reichen für diesen Zeitraum.",
			tableHeaders: {
				medication: "Medikament",
				usage: "Verbrauch",
				needed: "Blister benötigt",
				prescriptionRefills: "Rezept-Nachfüllungen",
				available: "Verfügbar",
				status: "Status",
			},
			statusEnough: "✓ Ausreichend",
			statusEmpty: "✗ Leer",
			prescriptionNotApplicable: "–",
		},
		common: {
			pill: "Tablette",
			pills: "Tabletten",
			puffs: "Hübe",
			injections: "Injektionen",
			units: "Einheiten",
			ml: "ml",
			blister: "Blister",
			blisters: "Blister",
			day: "Tag",
			days: "Tage",
			soon: "bald",
			footer: "🤖 Gesendet von MedAssist-ng",
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

/**
 * Get the app URL from the first CORS_ORIGINS entry.
 * Falls back to empty string if not set.
 */
export function getAppUrl(): string {
	return parseStringListEnv(process.env.CORS_ORIGINS)[0] ?? "";
}

/**
 * Get the unified footer as HTML with MedAssist-ng as a link to the instance.
 * @param variant - 'planner' uses the Medication Planner footer text
 */
export function getFooterHtml(language: Language): string {
	const tr = getTranslations(language);
	const appUrl = getAppUrl();
	const appName = appUrl
		? `<a href="${appUrl}" style="color: #6b7280; text-decoration: underline;">MedAssist-ng</a>`
		: "MedAssist-ng";
	return tr.common.footer.replace("MedAssist-ng", appName);
}

/**
 * Get the unified footer as plain text.
 * @param variant - 'planner' uses the Medication Planner footer text
 */
export function getFooterPlain(language: Language): string {
	const tr = getTranslations(language);
	const appUrl = getAppUrl();
	if (appUrl) {
		return `${tr.common.footer} (${appUrl})`;
	}
	return tr.common.footer;
}
