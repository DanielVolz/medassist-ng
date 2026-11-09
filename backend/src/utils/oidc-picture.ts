/** Accept browser-displayable provider pictures without fetching them on the server. */
export function sanitizeOidcPictureUrl(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048 || !/^https:\/\//i.test(value)) return "";
	if (/[\s\\]|\p{Cc}/u.test(value)) return "";
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "";
		url.hash = "";
		return url.href;
	} catch {
		return "";
	}
}
