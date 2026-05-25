import { createHash } from "node:crypto";

export function tokenFingerprint(token: string | null | undefined): string {
	const normalizedValue = token?.trim();
	if (!normalizedValue) {
		return "missing";
	}

	return createHash("sha256").update(normalizedValue, "utf8").digest("hex").slice(0, 12);
}

export function valueFingerprint(value: string | null | undefined): string {
	return tokenFingerprint(value);
}

export function redactTokenForLog(token: string | null | undefined): string {
	const fingerprint = tokenFingerprint(token);
	return fingerprint === "missing" ? fingerprint : `sha256:${fingerprint}`;
}
