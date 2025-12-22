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
      subject: "MedAssist Auto-Reminder: {count} Medication{s} Running Low",
      title: "⚠️ MedAssist - Automatic Reorder Reminder",
      description: "The following medications are running low and need to be reordered:",
      alertSingle: "⚠️ 1 medication running low!",
      alertMultiple: "⚠️ {count} medications running low!",
      tableHeaders: {
        medication: "Medication",
        pills: "Pills",
        days: "Days",
        runsOut: "Runs Out",
      },
      footer: "🤖 Automatic reminder from MedAssist",
    },
    intakeReminder: {
      subject: "MedAssist: Medication Reminder - {medications}",
      title: "💊 MedAssist - Intake Reminder",
      description: "Time to take your medication in {minutes} minutes:",
      alertSingle: "💊 1 medication scheduled",
      alertMultiple: "💊 {count} medications scheduled",
      tableHeaders: {
        medication: "Medication",
        dosage: "Dosage",
        time: "Time",
      },
      pills: "pills",
      footer: "MedAssist Medication Planner",
    },
    push: {
      stockTitle: "MedAssist: 1 Medication Running Low",
      stockTitleMultiple: "MedAssist: {count} Medications Running Low",
      intakeTitle: "Medication Reminder in {minutes} min",
      pillsLeft: "{count} pills",
      daysLeft: "{count} days left",
      pillsAt: "{count} pills at {time}",
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
      subject: "MedAssist Auto-Erinnerung: {count} Medikament{e} wird knapp",
      title: "⚠️ MedAssist - Automatische Nachbestell-Erinnerung",
      description: "Die folgenden Medikamente gehen zur Neige und sollten nachbestellt werden:",
      alertSingle: "⚠️ 1 Medikament wird knapp!",
      alertMultiple: "⚠️ {count} Medikamente werden knapp!",
      tableHeaders: {
        medication: "Medikament",
        pills: "Tabletten",
        days: "Tage",
        runsOut: "Aufgebraucht",
      },
      footer: "🤖 Automatische Erinnerung von MedAssist",
    },
    intakeReminder: {
      subject: "MedAssist: Einnahme-Erinnerung - {medications}",
      title: "💊 MedAssist - Einnahme-Erinnerung",
      description: "Zeit für Ihre Medikamente in {minutes} Minuten:",
      alertSingle: "💊 1 Medikament geplant",
      alertMultiple: "💊 {count} Medikamente geplant",
      tableHeaders: {
        medication: "Medikament",
        dosage: "Dosis",
        time: "Uhrzeit",
      },
      pills: "Tabletten",
      footer: "MedAssist Medikamentenplaner",
    },
    push: {
      stockTitle: "MedAssist: 1 Medikament wird knapp",
      stockTitleMultiple: "MedAssist: {count} Medikamente werden knapp",
      intakeTitle: "Einnahme-Erinnerung in {minutes} Min.",
      pillsLeft: "{count} Tabletten",
      daysLeft: "{count} Tage übrig",
      pillsAt: "{count} Tabletten um {time}",
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
