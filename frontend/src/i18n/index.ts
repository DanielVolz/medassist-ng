import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";

const resources = {
	en: { translation: en },
	de: { translation: de },
};

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources,
		fallbackLng: "en",
		supportedLngs: ["en", "de"],
		interpolation: {
			escapeValue: false, // React already escapes
		},
		detection: {
			order: ["localStorage", "navigator"],
			caches: ["localStorage"],
			lookupLocalStorage: "medassist-ng-language",
		},
	});

export default i18n;
