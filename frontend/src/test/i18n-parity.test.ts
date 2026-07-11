import { describe, expect, it } from "vitest";
import de from "../i18n/de.json";
import en from "../i18n/en.json";

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
});
