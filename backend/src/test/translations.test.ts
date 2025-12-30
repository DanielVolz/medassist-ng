/**
 * Tests for translations module
 */
import { describe, it, expect } from "vitest";
import { getTranslations, t, getDateLocale, type Language } from "../i18n/translations.js";

describe("Translations Module", () => {
  describe("getTranslations", () => {
    it("should return English translations for 'en'", () => {
      const translations = getTranslations("en");
      expect(translations.stockReminder.title).toContain("MedAssist-ng");
      expect(translations.common.pills).toBe("pills");
    });

    it("should return German translations for 'de'", () => {
      const translations = getTranslations("de");
      expect(translations.stockReminder.title).toContain("MedAssist-ng");
      expect(translations.common.pills).toBe("Tabletten");
    });

    it("should fallback to English for unknown language", () => {
      const translations = getTranslations("fr" as Language);
      expect(translations.common.pills).toBe("pills");
    });

    it("should have all required keys in English", () => {
      const translations = getTranslations("en");
      
      // Stock reminder keys
      expect(translations.stockReminder.subject).toBeDefined();
      expect(translations.stockReminder.title).toBeDefined();
      expect(translations.stockReminder.description).toBeDefined();
      expect(translations.stockReminder.tableHeaders.medication).toBeDefined();
      
      // Intake reminder keys
      expect(translations.intakeReminder.subject).toBeDefined();
      expect(translations.intakeReminder.title).toBeDefined();
      expect(translations.intakeReminder.pills).toBeDefined();
      expect(translations.intakeReminder.takenBy).toBeDefined();
      
      // Push notification keys
      expect(translations.push.stockTitle).toBeDefined();
      expect(translations.push.intakeTitle).toBeDefined();
      expect(translations.push.pillsLeft).toBeDefined();
      expect(translations.push.emptySection).toBeDefined();
      expect(translations.push.lowSection).toBeDefined();
    });

    it("should have all required keys in German", () => {
      const translations = getTranslations("de");
      
      // Stock reminder keys
      expect(translations.stockReminder.subject).toBeDefined();
      expect(translations.stockReminder.title).toBeDefined();
      expect(translations.stockReminder.description).toBeDefined();
      expect(translations.stockReminder.tableHeaders.medication).toBe("Medikament");
      
      // Intake reminder keys
      expect(translations.intakeReminder.subject).toBeDefined();
      expect(translations.intakeReminder.pills).toBe("Tabletten");
      expect(translations.intakeReminder.takenBy).toBe("für {name}");
    });
  });

  describe("t (template function)", () => {
    it("should replace single placeholder", () => {
      const result = t("Hello {name}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("should replace multiple placeholders", () => {
      const result = t("{count} {type} running low", { count: 3, type: "medications" });
      expect(result).toBe("3 medications running low");
    });

    it("should replace same placeholder multiple times", () => {
      const result = t("{name} and {name} again", { name: "test" });
      expect(result).toBe("test and test again");
    });

    it("should leave unmatched placeholders", () => {
      const result = t("Hello {name}!", {});
      expect(result).toBe("Hello {name}!");
    });

    it("should handle numeric values", () => {
      const result = t("{count} pills left", { count: 42 });
      expect(result).toBe("42 pills left");
    });

    it("should handle empty params object", () => {
      const result = t("No placeholders here", {});
      expect(result).toBe("No placeholders here");
    });

    it("should work with real translation strings", () => {
      const translations = getTranslations("en");
      
      // Stock reminder subject
      const subject = t(translations.stockReminder.subject, { count: 3, s: "s" });
      expect(subject).toBe("MedAssist-ng Auto-Reminder: 3 Medications Running Low");
      
      // Intake reminder description
      const description = t(translations.intakeReminder.description, { minutes: 30 });
      expect(description).toBe("Time to take your medication in 30 minutes:");
      
      // Push notification
      const push = t(translations.push.pillsAt, { count: 2, time: "08:00" });
      expect(push).toBe("2 pills at 08:00");
    });

    it("should work with German translations", () => {
      const translations = getTranslations("de");
      
      const subject = t(translations.stockReminder.subject, { count: 2, e: "e" });
      expect(subject).toBe("MedAssist-ng Auto-Erinnerung: 2 Medikamente wird knapp");
      
      const takenBy = t(translations.intakeReminder.takenBy, { name: "Daniel" });
      expect(takenBy).toBe("für Daniel");
    });
  });

  describe("getDateLocale", () => {
    it("should return 'en-US' for English", () => {
      expect(getDateLocale("en")).toBe("en-US");
    });

    it("should return 'de-DE' for German", () => {
      expect(getDateLocale("de")).toBe("de-DE");
    });

    it("should return 'en-US' for unknown language", () => {
      expect(getDateLocale("fr" as Language)).toBe("en-US");
    });
  });
});
