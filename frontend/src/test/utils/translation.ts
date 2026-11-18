import type { TranslationFunction } from "../../i18n/types";

export function asTranslationFunction(
	translate: (key: string, options?: Record<string, unknown>) => string
): TranslationFunction {
	return translate as unknown as TranslationFunction;
}
