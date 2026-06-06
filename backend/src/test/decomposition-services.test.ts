import { describe, expect, it, vi } from "vitest";
import {
	calculateUsageInRange,
	normalizeDateTime,
	parseIntakesWithUnits,
	parseRawIntakeUnits,
} from "../services/medications-service.js";
import { escapeHtml, getDeliveryError, getPlannerUnit, isContainerPackage } from "../services/planner-service.js";

describe("medications-service decomposition regression", () => {
	it("preserves intake unit parsing from unified intakes_json", () => {
		const intakesJson = JSON.stringify([
			{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z", intakeUnit: "ml" },
			{ usage: 2, every: 1, start: "2026-01-01T20:00:00.000Z", intakeUnit: "bogus" },
		]);

		expect(parseRawIntakeUnits(intakesJson)).toEqual(["ml", null]);

		const parsed = parseIntakesWithUnits({
			intakesJson,
			usageJson: "[1,2]",
			everyJson: "[1,1]",
			startJson: '["2026-01-01T08:00:00.000Z","2026-01-01T20:00:00.000Z"]',
			intakeRemindersEnabled: false,
		});

		expect(parsed[0]?.intakeUnit).toBe("ml");
		expect(parsed[1]?.intakeUnit).toBeNull();
	});

	it("normalizes date-time values and keeps invalid input null-safe", () => {
		expect(normalizeDateTime("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime(1_767_225_600)).toBe("2026-01-01T00:00:00.000Z");
		expect(normalizeDateTime("not-a-date")).toBeNull();
		expect(normalizeDateTime(undefined)).toBeNull();
	});

	it("calculates range usage with split-safe helper behavior", () => {
		const usage = calculateUsageInRange(
			[
				{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z", scheduleMode: "interval", weekdays: [] },
				{ usage: 0.5, every: 1, start: "2026-01-01T20:00:00.000Z", scheduleMode: "interval", weekdays: [] },
			],
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-02T00:00:00.000Z")
		);

		expect(usage).toBe(1.5);
	});

	it("applies planner people multipliers when calculating range usage", () => {
		const usage = calculateUsageInRange(
			[
				{
					usage: 1,
					every: 1,
					start: "2026-01-01T08:00:00.000Z",
					scheduleMode: "interval",
					weekdays: [],
					peopleMultiplier: 2,
				},
			],
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-11T00:00:00.000Z")
		);

		expect(usage).toBe(20);
	});
});

describe("planner-service decomposition regression", () => {
	it("keeps HTML escaping and SMTP delivery error parsing stable", () => {
		expect(escapeHtml(`<script>alert('x')</script>`)).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
		expect(getDeliveryError({ accepted: ["ok@example.com"], rejected: [] })).toBeNull();
		expect(getDeliveryError({ accepted: [], rejected: ["bad@example.com"] })).toContain("SMTP rejected all recipients");
		expect(getDeliveryError({ accepted: [], rejected: [], response: "550 relay denied" })).toContain(
			"550 relay denied"
		);
	});

	it("maps package type to expected planner units after service extraction", () => {
		const tr = { common: { units: "units", ml: "ml", pills: "pills", puffs: "puffs", injections: "injections" } };

		expect(isContainerPackage("bottle")).toBe(true);
		expect(isContainerPackage("inhaler")).toBe(true);
		expect(isContainerPackage("injection")).toBe(true);
		expect(isContainerPackage("blister")).toBe(false);
		expect(getPlannerUnit("tube", tr)).toBe("units");
		expect(getPlannerUnit("liquid_container", tr)).toBe("ml");
		expect(getPlannerUnit("bottle", tr)).toBe("pills");
		expect(getPlannerUnit("inhaler", tr)).toBe("puffs");
		expect(getPlannerUnit("injection", tr)).toBe("injections");
		expect(getPlannerUnit("blister", tr)).toBe("pills");
	});
});

describe("settings-service decomposition regression", () => {
	it("keeps notification URL and classification helpers stable", async () => {
		vi.resetModules();
		vi.doMock("../db/client.js", () => ({ db: {} }));
		vi.doMock("../db/schema.js", () => ({ userSettings: { userId: "userId" } }));

		const { classifyTestEmailFailure, getNotificationProvider, sanitizeNotificationUrl, validateNotificationHostname } =
			await import("../services/settings-service.js");

		expect(classifyTestEmailFailure(new Error("SMTP rejected all recipients: person@example.com"))).toMatchObject({
			status: 400,
			code: "EMAIL_RECIPIENT_REJECTED",
		});
		expect(classifyTestEmailFailure(new Error("SMTP did not confirm accepted recipients."))).toMatchObject({
			status: 502,
			code: "SMTP_DELIVERY_UNCONFIRMED",
		});
		expect(getNotificationProvider("telegram://token@chat-id")).toBe("telegram");
		expect(getNotificationProvider("https://hooks.slack.com/services/a/b/c")).toBe("hooks.slack.com");

		expect(validateNotificationHostname("127.0.0.1")).toContain("not allowed");
		expect(validateNotificationHostname("[::1]")).toContain("not allowed");
		expect(validateNotificationHostname("[fd00::1]")).toContain("not allowed");
		expect(validateNotificationHostname("[fe80::1]")).toContain("not allowed");
		expect(validateNotificationHostname("0.0.0.0")).toContain("not allowed");
		expect(validateNotificationHostname("100.64.0.1")).toContain("not allowed");
		expect(validateNotificationHostname("::ffff:7f00:1")).toContain("not allowed");
		expect(validateNotificationHostname("example.com")).toBeNull();

		expect(sanitizeNotificationUrl("discord://abc@not-a-number")).toEqual({ error: "Invalid Discord webhook ID" });
		expect(sanitizeNotificationUrl("https://[::1]/hook")).toEqual({ error: "Localhost URLs are not allowed" });
		expect(sanitizeNotificationUrl("ntfy://user:pass@ntfy.sh/topic")).toMatchObject({
			url: "https://ntfy.sh/topic",
			isNtfy: true,
			auth: { user: "user", pass: "pass" },
		});
	});
});
