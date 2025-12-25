// Backend translations for notifications
export type Language = "en" | "de";

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
      intakeTitle: "Medication Reminder in {minutes} min",
      pillsLeft: "{count} pills",
      daysLeft: "{count} days left",
      pillsAt: "{count} pills at {time}",
      repeatDailyNote: "(Daily reminder enabled)",
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
      repeatDailyNote: "Sie erhalten diese tägliche Erinnerung, weil 'Täglich wiederholen' in den Einstellungen aktiviert ist.",
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
      intakeTitle: "Einnahme-Erinnerung in {minutes} Min.",
      pillsLeft: "{count} Tabletten",
      daysLeft: "{count} Tage übrig",
      pillsAt: "{count} Tabletten um {time}",
      repeatDailyNote: "(Tägliche Erinnerung aktiviert)",
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

// Get date locale for toLocaleDateString
export function getDateLocale(language: Language): string {
  switch (language) {
    case "de":
      return "de-DE";
    case "en":
    default:
      return "en-US";
  }
}
