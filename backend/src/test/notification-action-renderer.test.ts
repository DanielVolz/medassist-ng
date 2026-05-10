import { describe, expect, it } from "vitest";
import {
	getNotificationActionLabels,
	isNtfyNotificationUrl,
	type PushNotificationAction,
	renderNotificationActionPayload,
} from "../services/notifications/action-renderer.js";

function decodeRfc2047Base64(value: string): string {
	const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(value);
	if (!match) {
		return value;
	}

	return Buffer.from(match[1], "base64").toString("utf-8");
}

const actions: PushNotificationAction[] = [
	{
		kind: "taken",
		label: "Take",
		url: "https://app.example.com/api/notification-actions/taken-token",
		method: "POST",
	},
	{
		kind: "skip",
		label: "Skip",
		url: "https://app.example.com/api/notification-actions/skip-token",
		method: "POST",
	},
	{ kind: "view", label: "View", url: "https://app.example.com/?date=2026-01-05", method: "GET" },
];

describe("notification action renderer", () => {
	it("builds ntfy native actions without duplicate click headers", () => {
		const result = renderNotificationActionPayload("ntfy://ntfy.sh/medassist", "Body", {
			actions,
			clickUrl: "https://app.example.com/api/notification-actions/respond-token",
			respondUrl: "https://app.example.com/api/notification-actions/respond-token",
			viewUrl: "https://app.example.com/?date=2026-01-05",
			tags: ["pill"],
			priority: 4,
			sequenceId: "medassist-sequence",
		});

		expect(result.message).toBe("Body");
		expect(result.headers).toMatchObject({
			Tags: "pill",
			Priority: "4",
			"X-Sequence-ID": "medassist-sequence",
		});
		expect(result.headers.Click).toBeUndefined();

		const parsedActions = JSON.parse(result.headers.Actions ?? "[]");
		expect(parsedActions).toEqual([
			{
				action: "http",
				label: "Take",
				url: "https://app.example.com/api/notification-actions/taken-token",
				method: "POST",
				clear: true,
			},
			{
				action: "http",
				label: "Skip",
				url: "https://app.example.com/api/notification-actions/skip-token",
				method: "POST",
				clear: true,
			},
			{
				action: "view",
				label: "View",
				url: "https://app.example.com/?date=2026-01-05",
				clear: false,
			},
		]);
	});

	it("keeps the ntfy click header when there are no native actions", () => {
		const result = renderNotificationActionPayload("ntfy://ntfy.sh/medassist", "Body", {
			clickUrl: "https://app.example.com/api/notification-actions/respond-token",
		});

		expect(result.headers.Click).toBe("https://app.example.com/api/notification-actions/respond-token");
	});

	it("treats direct https ntfy URLs as ntfy targets with native actions", () => {
		const result = renderNotificationActionPayload("https://ntfy.danielvolz.org/medis_test", "Body", {
			actions,
			clickUrl: "https://app.example.com/api/notification-actions/respond-token",
			respondUrl: "https://app.example.com/api/notification-actions/respond-token",
			viewUrl: "https://app.example.com/?date=2026-01-05",
		});

		expect(isNtfyNotificationUrl("https://ntfy.danielvolz.org/medis_test")).toBe(true);
		expect(result.message).toBe("Body");
		expect(result.headers.Actions).toBeTruthy();
		expect(result.message).not.toContain("Respond:");
	});

	it("keeps insecure http mutation targets as direct ntfy http actions without the dev fallback", () => {
		const result = renderNotificationActionPayload("https://ntfy.danielvolz.org/medis_test", "Body", {
			actions: [
				{
					kind: "taken",
					label: "Take",
					url: "http://192.168.0.113:5173/api/notification-actions/taken-token",
					method: "POST",
				},
			],
		});

		expect(JSON.parse(result.headers.Actions ?? "[]")).toEqual([
			{
				action: "http",
				label: "Take",
				url: "http://192.168.0.113:5173/api/notification-actions/taken-token",
				method: "POST",
				clear: true,
			},
		]);
	});

	it("encodes non-ascii ntfy action labels as RFC 2047 headers", () => {
		const result = renderNotificationActionPayload("https://ntfy.danielvolz.org/medis_test", "Body", {
			actions: [
				{
					kind: "skip",
					label: "Überspringen",
					url: "https://app.example.com/api/notification-actions/skip-token",
					method: "POST",
				},
				{
					kind: "view",
					label: "Öffnen",
					url: "https://app.example.com/?date=2026-01-05",
					method: "GET",
				},
			],
		});

		expect(result.headers.Actions).toMatch(/^=\?UTF-8\?B\?/);
		expect(JSON.parse(decodeRfc2047Base64(result.headers.Actions ?? "[]"))).toEqual([
			{
				action: "http",
				label: "Überspringen",
				url: "https://app.example.com/api/notification-actions/skip-token",
				method: "POST",
				clear: true,
			},
			{
				action: "view",
				label: "Öffnen",
				url: "https://app.example.com/?date=2026-01-05",
				clear: false,
			},
		]);
	});

	it("uses consistent action-form labels for English and German", () => {
		expect(getNotificationActionLabels("en")).toEqual({
			taken: "Take",
			skip: "Skip",
			respond: "Respond",
			view: "View",
		});
		expect(getNotificationActionLabels("de")).toEqual({
			taken: "Einnehmen",
			skip: "Überspringen",
			respond: "Antworten",
			view: "Öffnen",
		});
	});

	it("appends respond and view fallback links for non-ntfy providers", () => {
		const result = renderNotificationActionPayload("https://hooks.slack.com/services/a/b/c", "Body", {
			respondUrl: "https://app.example.com/api/notification-actions/respond-token",
			viewUrl: "https://app.example.com/?date=2026-01-05",
		});

		expect(result.headers).toEqual({});
		expect(result.message).toBe(
			"Body\n\nRespond:\nhttps://app.example.com/api/notification-actions/respond-token\n\nView:\nhttps://app.example.com/?date=2026-01-05"
		);
	});
});
