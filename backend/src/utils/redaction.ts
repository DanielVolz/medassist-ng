import { createHash } from "node:crypto";

export function redactTokenForLog(token: string | null | undefined): string {
	const normalizedToken = token?.trim();
	if (!normalizedToken) {
		return "missing";
	}

	return `sha256:${createHash("sha256").update(normalizedToken, "utf8").digest("hex").slice(0, 12)}`;
}
