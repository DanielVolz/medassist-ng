const htmlEscapes: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

export function toHtmlText(value: string): string {
	return escapeHtml(value).replaceAll("\n", "<br />");
}
