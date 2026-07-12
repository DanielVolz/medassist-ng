/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readFrontendFile(filePath: string) {
	return readFileSync(resolve(frontendRoot, filePath), "utf8");
}

// Regression rationale: browser icon declarations and packaged assets are build inputs, not interactive UI behavior.
describe("favicon contract", () => {
	it("declares explicit browser favicon sizes in index.html", () => {
		const html = readFrontendFile("index.html");

		expect(html).toContain('rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"');
		expect(html).toContain('rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"');
		expect(html).toContain('rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png"');
		expect(html).toContain('rel="shortcut icon" type="image/x-icon" href="/favicon.ico"');
		expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"');
	});

	it("ships the favicon assets referenced by the app shell", () => {
		for (const fileName of [
			"favicon-16x16.png",
			"favicon-32x32.png",
			"favicon-96x96.png",
			"favicon.ico",
			"apple-touch-icon.png",
			"site.webmanifest",
			"web-app-manifest-192x192.png",
			"web-app-manifest-512x512.png",
		]) {
			expect(existsSync(resolve(frontendRoot, "public", fileName)), fileName).toBe(true);
		}
	});

	it("declares manifest icons for normal browser use, not maskable-only", () => {
		const manifest = JSON.parse(readFrontendFile("public/site.webmanifest"));

		expect(manifest.icons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ src: "/web-app-manifest-192x192.png", purpose: "any maskable" }),
				expect.objectContaining({ src: "/web-app-manifest-512x512.png", purpose: "any maskable" }),
			])
		);
	});
});
