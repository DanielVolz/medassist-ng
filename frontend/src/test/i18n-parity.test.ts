import { describe, expect, it } from "vitest";
import de from "../i18n/de.json";
import en from "../i18n/en.json";
import es from "../i18n/es-ES.json";
import ptPT from "../i18n/pt-PT.json";

interface TranslationTree {
	[key: string]: string | TranslationTree;
}

function flattenTranslations(tree: TranslationTree, prefix = ""): Map<string, string> {
	const entries = new Map<string, string>();

	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;

		if (typeof value === "string") {
			entries.set(path, value);
			continue;
		}

		for (const [nestedPath, nestedValue] of flattenTranslations(value, path)) {
			entries.set(nestedPath, nestedValue);
		}
	}

	return entries;
}

function interpolationKeys(value: string): string[] {
	return [...value.matchAll(/{{\s*([\w.-]+)[^}]*}}/g)].map((match) => match[1]).sort();
}

describe("frontend i18n parity", () => {
	it("keeps English and German translation keys in sync", () => {
		const english = flattenTranslations(en);
		const german = flattenTranslations(de);

		expect([...german.keys()].sort()).toEqual([...english.keys()].sort());
	});

	it("keeps interpolation variables aligned for every translation key", () => {
		const english = flattenTranslations(en);
		const german = flattenTranslations(de);

		for (const [key, englishValue] of english) {
			expect(interpolationKeys(german.get(key) ?? ""), `German interpolation mismatch for ${key}`).toEqual(
				interpolationKeys(englishValue)
			);
		}
	});

	it("keeps Portuguese translations nonempty and compatible with English placeholders", () => {
		const english = flattenTranslations(en);
		const portuguese = flattenTranslations(ptPT);
		const missing = [...english.keys()].filter(
			(key) =>
				!portuguese.has(key) &&
				(/_(one|other)$/.test(key) || !portuguese.has(`${key}_one`) || !portuguese.has(`${key}_other`))
		);
		expect(missing, "Missing Portuguese translations for English keys").toEqual([]);
		expect(portuguese.get("dashboard.reorder.lowWarning_one")).toContain("está criticamente baixo");
		expect(portuguese.get("form.enrichment.description")).toContain(
			"Reveja cada sugestão antes de a aplicar ao formulário."
		);
		expect(portuguese.get("form.enrichment.noResults")).toContain(
			"Pode continuar a introduzir o medicamento manualmente."
		);
		expect(portuguese.get("form.placeholders.commercial")).toBe("por exemplo, Ozempic");
		expect(portuguese.get("form.placeholders.notes")).toContain("tomar com comida, evitar álcool");
		expect(portuguese.get("form.packageTypeInjection")).toBe("Injeção");
		expect(portuguese.get("share.activeLinkDays_one")).toBe("{{count}} dia");
		expect(portuguese.get("refill.packsAdded_one")).toBe("{{count}} caixa");
		expect([...portuguese.keys()].some((key) => key.endsWith("_many"))).toBe(true);

		for (const [key, value] of portuguese) {
			const sourceKey = key.replace(/_(one|other|many)$/, "");
			const source = english.get(key) ?? english.get(sourceKey) ?? english.get(`${sourceKey}_other`);
			expect(source, `Unknown Portuguese translation key ${key}`).toBeDefined();
			expect(value.trim(), `Empty Portuguese translation for ${key}`).not.toBe("");
			expect(interpolationKeys(value), `Portuguese interpolation mismatch for ${key}`).toEqual(
				interpolationKeys(source ?? "")
			);
		}
	});

	it("keeps the supplied Spanish catalog complete and compatible with English placeholders", () => {
		const english = flattenTranslations(en);
		const spanish = flattenTranslations(es);
		expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());

		for (const [key, value] of spanish) {
			expect(value.trim(), `Empty Spanish translation for ${key}`).not.toBe("");
			expect(interpolationKeys(value), `Spanish interpolation mismatch for ${key}`).toEqual(
				interpolationKeys(english.get(key) ?? "")
			);
		}
	});

	it("uses the same native language labels in all four catalogs", () => {
		const labels = {
			"settings.language.english": "🇬🇧 English",
			"settings.language.german": "🇩🇪 Deutsch",
			"settings.language.portuguese": "🇵🇹 Português",
			"settings.language.spanish": "🇪🇸 Español",
		};
		for (const catalog of [en, de, ptPT, es]) {
			const translations = flattenTranslations(catalog);
			for (const [key, value] of Object.entries(labels)) {
				expect(translations.get(key)).toBe(value);
			}
		}
	});
});
