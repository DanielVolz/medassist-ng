import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider picture deployment policy", () => {
	it("allows HTTPS images without widening scripts or API connections", () => {
		const nginx = readFileSync("nginx.conf", "utf8");
		const policy = nginx.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1];
		expect(policy).toBeDefined();
		const directives = new Map(
			policy
				?.split(";")
				.map((directive) => directive.trim().split(/\s+/))
				.map(([name, ...sources]) => [name, sources])
		);
		expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
		expect(directives.get("script-src")).toEqual(["'self'"]);
		expect(directives.get("connect-src")).toEqual(["'self'", "https://api.github.com"]);
	});
});
