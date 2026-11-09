import { describe, expect, it } from "vitest";
import { sanitizeOidcPictureUrl } from "../utils/oidc-picture.js";

describe("OIDC picture URL validation", () => {
	it("normalizes HTTPS URLs and removes fragments without fetching", () => {
		expect(sanitizeOidcPictureUrl("https://IMAGES.example.test/avatar.png?size=64#unused")).toBe(
			"https://images.example.test/avatar.png?size=64"
		);
	});

	it.each([
		undefined,
		null,
		{},
		"",
		"/avatar.png",
		"//images.example.test/avatar.png",
		"http://images.example.test/avatar.png",
		"javascript:alert(1)",
		"data:image/png;base64,abc",
		"file:///avatar.png",
		"https://user:password@images.example.test/avatar.png",
		"https://images.example.test/\nunsafe",
		"https://images.example.test/has space",
		"https:\\\\images.example.test\\avatar.png",
		`https://images.example.test/${"a".repeat(2048)}`,
	])("rejects absent, malformed or unsafe pictures (%#)", (value) => {
		expect(sanitizeOidcPictureUrl(value)).toBe("");
	});
});
