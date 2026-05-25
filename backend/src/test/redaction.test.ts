import { describe, expect, it } from "vitest";
import { redactTokenForLog, tokenFingerprint } from "../utils/redaction.js";

describe("tokenFingerprint", () => {
	it("returns a stable short hash without exposing the raw token", () => {
		const rawToken = "share-token-secret-value";
		const fingerprint = tokenFingerprint(rawToken);

		expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
		expect(fingerprint).toBe(tokenFingerprint(rawToken));
		expect(fingerprint).not.toContain(rawToken);
	});

	it("normalizes empty tokens to a non-sensitive placeholder", () => {
		expect(tokenFingerprint("")).toBe("missing");
		expect(tokenFingerprint("   ")).toBe("missing");
		expect(tokenFingerprint(null)).toBe("missing");
		expect(tokenFingerprint(undefined)).toBe("missing");
	});
});

describe("redactTokenForLog", () => {
	it("returns a stable short hash reference without exposing the raw token", () => {
		const rawToken = "share-token-secret-value";
		const tokenRef = redactTokenForLog(rawToken);

		expect(tokenRef).toMatch(/^sha256:[a-f0-9]{12}$/);
		expect(tokenRef).toBe(redactTokenForLog(rawToken));
		expect(tokenRef).not.toContain(rawToken);
	});

	it("normalizes empty tokens to a non-sensitive placeholder", () => {
		expect(redactTokenForLog("")).toBe("missing");
		expect(redactTokenForLog("   ")).toBe("missing");
		expect(redactTokenForLog(null)).toBe("missing");
		expect(redactTokenForLog(undefined)).toBe("missing");
	});
});
