import { describe, expect, it } from "vitest";
import { getDeliveryError } from "../services/notifications/delivery-result.js";
import { normalizeDateTime } from "../utils/date-time.js";
import { buildDoseId, parseDoseId } from "../utils/dose-id.js";
import { escapeHtml, toHtmlText } from "../utils/html.js";

describe("shared backend utility regressions", () => {
	it("normalizes supported date-time inputs and rejects invalid values", () => {
		expect(normalizeDateTime(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime(1_767_225_600)).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime(1_767_225_600_000)).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime("not-a-date")).toBeNull();
		expect(normalizeDateTime({ value: "2026-01-01" })).toBeNull();
		expect(normalizeDateTime(null)).toBeNull();
	});

	it("round-trips dose IDs and preserves multi-part person suffixes", () => {
		const doseId = buildDoseId(42, 1, 1_767_225_600_000, "Daniel-Volz");

		expect(doseId).toBe("42-1-1767225600000-Daniel-Volz");
		expect(parseDoseId(doseId)).toEqual({
			medicationId: 42,
			intakeIndex: 1,
			timestampMs: 1_767_225_600_000,
			personSuffix: "Daniel-Volz",
		});
	});

	it("rejects malformed dose IDs before stock or export logic consumes them", () => {
		expect(parseDoseId("")).toBeNull();
		expect(parseDoseId("42-1")).toBeNull();
		expect(parseDoseId("42--1-1767225600000")).toBeNull();
		expect(parseDoseId("med-1-1767225600000")).toBeNull();
		expect(parseDoseId("42-1-not-a-time")).toBeNull();
	});

	it("keeps escaped plain text safe for HTML notification bodies", () => {
		expect(escapeHtml(`A&B <script>alert("x")</script> 'quote'`)).toBe(
			"A&amp;B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#39;quote&#39;"
		);
		expect(toHtmlText("Line <one>\nLine & two")).toBe("Line &lt;one&gt;<br />Line &amp; two");
	});

	it("keeps SMTP delivery result classification stable", () => {
		expect(getDeliveryError({ accepted: [" ok@example.com "], rejected: ["bad@example.com"] })).toBeNull();
		expect(getDeliveryError({ accepted: [], rejected: [" bad@example.com ", 42, null] })).toBe(
			"SMTP rejected all recipients: bad@example.com, 42"
		);
		expect(getDeliveryError({ accepted: [], rejected: [], response: "550 relay denied" })).toBe(
			"SMTP did not confirm accepted recipients. Response: 550 relay denied"
		);
		expect(getDeliveryError({ accepted: [], rejected: [], response: "" })).toBe(
			"SMTP did not confirm accepted recipients."
		);
	});
});
