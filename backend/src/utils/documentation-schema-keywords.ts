export function registerDocumentationSchemaKeywords(ajv: {
	addKeyword: (definition: { keyword: string; schemaType?: string | string[]; valid?: boolean }) => void;
}) {
	ajv.addKeyword({ keyword: "example", valid: true });
}

export const documentationSchemaAjv = {
	plugins: [registerDocumentationSchemaKeywords] as const,
};
