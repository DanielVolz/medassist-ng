import type { Plugin } from "ajv";

export const registerDocumentationSchemaKeywords: Plugin<unknown> = (ajv) => {
	ajv.addKeyword({ keyword: "example", valid: true });
	return ajv;
};

export const documentationSchemaAjv = {
	plugins: [registerDocumentationSchemaKeywords],
};
