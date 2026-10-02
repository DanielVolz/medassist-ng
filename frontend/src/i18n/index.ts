import { normalizeAppLanguage } from "@medassist/shared";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";
import esES from "./es-ES.json";
import ptPT from "./pt-PT.json";

const resources = {
	"en-US": { translation: en },
	"de-DE": { translation: de },
	"pt-PT": { translation: ptPT },
	"es-ES": { translation: esES },
};

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources,
		fallbackLng: "en-US",
		supportedLngs: ["en-US", "de-DE", "pt-PT", "es-ES"],
		load: "currentOnly",
		interpolation: {
			escapeValue: false, // React already escapes
		},
		detection: {
			order: ["localStorage", "navigator"],
			caches: ["localStorage"],
			lookupLocalStorage: "medassist-ng-language",
			convertDetectedLanguage: normalizeAppLanguage,
		},
	});
