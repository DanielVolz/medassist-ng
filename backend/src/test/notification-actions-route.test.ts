import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, closeTestApp, insertScheduledTestMedication } from "./setup.js";

const { testClient, testDb, mockedEnv, fetchMock, mockLogger } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	const logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		silent: vi.fn(),
		level: "info",
		child: vi.fn(),
	};
	logger.child.mockImplementation(() => logger);

	return {
		testClient: client,
		testDb: db,
		fetchMock: vi.fn(),
		mockLogger: logger,
		mockedEnv: {
			AUTH_ENABLED: false,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			PORT: 3000,
			CORS_ORIGINS: "*",
			PUBLIC_APP_URL: "https://app.example.com",
			OPENAPI_DOCS_ENABLED: false,
		},
	};
});

global.fetch = fetchMock;

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { notificationActionRoutes } = await import("../routes/notification-actions.js");
const { createNotificationActionContext } = await import("../services/notification-actions-service.js");

function extractToken(url: string): string {
	return url.split("/").at(-1) ?? "";
}

async function insertNotificationMedication(options: {
	id: number;
	userId: number;
	packCount?: number;
	looseTablets?: number;
}) {
	await insertScheduledTestMedication(testClient, {
		name: "Route Medication",
		start: "2026-01-05T08:00:00.000Z",
		intakeRemindersEnabled: true,
		...options,
	});
}

async function clearTables() {
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM notification_action_tokens");
	await testClient.execute("DELETE FROM notification_action_groups");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM users");
}

async function createUser(username: string) {
	const result = await testClient.execute({
		sql: "INSERT INTO users (username, auth_provider, is_active) VALUES (?, 'local', 1) RETURNING id",
		args: [username],
	});

	return Number(result.rows[0].id);
}

async function insertUserSettings(
	userId: number,
	stockCalculationMode: "automatic" | "manual" = "automatic",
	overrides: { shoutrrrEnabled?: boolean; shoutrrrUrl?: string | null } = {}
) {
	await testClient.execute({
		sql: "INSERT INTO user_settings (user_id, stock_calculation_mode, shoutrrr_enabled, shoutrrr_url) VALUES (?, ?, ?, ?)",
		args: [userId, stockCalculationMode, overrides.shoutrrrEnabled ? 1 : 0, overrides.shoutrrrUrl ?? null],
	});
}

async function seedContext(options: { userId: number; doseId: string }) {
	const scheduledFor = new Date("2026-01-05T08:00:00.000Z");
	const context = await createNotificationActionContext({
		userId: options.userId,
		title: "Reminder",
		message: "Take your medication now",
		doseIds: [options.doseId],
		scheduledFor,
		publicAppUrl: mockedEnv.PUBLIC_APP_URL,
		language: "en",
	});

	return {
		respondToken: extractToken(context!.respondUrl!),
		takenToken: extractToken(context!.actions.find((action) => action.kind === "taken")!.url),
		skipToken: extractToken(context!.actions.find((action) => action.kind === "skip")!.url),
		context: context!,
	};
}

describe("notification action routes", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({
			client: testClient,
			fastifyOptions: { loggerInstance: mockLogger, disableRequestLogging: true },
		});
		app = context.app;
		await app.register(notificationActionRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await closeTestApp({ app, db: testDb, client: testClient });
	});

	beforeEach(async () => {
		await clearTables();
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";
		mockedEnv.NODE_ENV = "test";
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true });
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
		mockLogger.debug.mockClear();
		mockLogger.trace.mockClear();
		mockLogger.fatal.mockClear();
		mockLogger.child.mockClear();
	});

	it("renders HTML for respond tokens without mutating state", async () => {
		const userId = await createUser("notification-route-get");
		const { respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const response = await app.inject({
			method: "GET",
			url: `/notification-actions/${respondToken}`,
			headers: { accept: "text/html" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("Respond to reminder");
		expect(response.body).toContain("Take your medication now");

		const rows = await testClient.execute({
			sql: `SELECT g.resolved_action, t.used_at
			      FROM notification_action_groups g
			      INNER JOIN notification_action_tokens t ON t.group_id = g.id
			      WHERE t.kind = 'respond'`,
		});
		expect(rows.rows).toEqual([expect.objectContaining({ resolved_action: null, used_at: null })]);
	});

	it("returns the expected GET behavior for missing, non-respond, and expired tokens", async () => {
		const missing = await app.inject({ method: "GET", url: "/notification-actions/missing-token" });
		expect(missing.statusCode).toBe(404);

		const userId = await createUser("notification-route-errors");
		const { respondToken, takenToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const nonRespond = await app.inject({
			method: "GET",
			url: `/notification-actions/${takenToken}`,
			headers: { accept: "text/html" },
		});
		expect(nonRespond.statusCode).toBe(405);
		expect(nonRespond.json()).toEqual({ error: "Direct GET is only available for respond actions" });

		await testClient.execute({
			sql: "UPDATE notification_action_groups SET expires_at = ?",
			args: [new Date(0)],
		});

		const expired = await app.inject({ method: "GET", url: `/notification-actions/${respondToken}` });
		expect(expired.statusCode).toBe(410);
		expect(expired.json()).toEqual({ error: "Notification action has expired" });
	});

	it("shows an already-processed HTML state for resolved respond tokens", async () => {
		const userId = await createUser("notification-route-resolved");
		const { respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });
		await testClient.execute({
			sql: "UPDATE notification_action_groups SET resolved_action = 'skip', resolved_at = ?",
			args: [new Date()],
		});

		const response = await app.inject({
			method: "GET",
			url: `/notification-actions/${respondToken}`,
			headers: { accept: "text/html" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("Already processed");
		expect(response.body).toContain(
			"This intake is already marked as skipped. If you want to mark it as taken instead, open MedAssist and do that there."
		);
	});

	it("skips doses through a respond token and returns friendly success for already-resolved follow-up actions", async () => {
		const userId = await createUser("notification-route-skip");
		const { respondToken, takenToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}`,
			payload: { action: "skip" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ success: true, action: "skip" });
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				userId,
				groupId: expect.any(Number),
				tokenKind: "respond",
				doseCount: 1,
				hasViewUrl: true,
				requestedAction: "skip",
			}),
			"[NotificationActions] Recorded notification action"
		);

		const dismissedRow = await testClient.execute({
			sql: "SELECT dismissed, taken_at FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [userId, "5-0-1736064000000"],
		});
		expect(dismissedRow.rows).toEqual([expect.objectContaining({ dismissed: 1, taken_at: 0 })]);

		const groupRow = await testClient.execute({
			sql: "SELECT resolved_action FROM notification_action_groups",
		});
		expect(groupRow.rows).toEqual([expect.objectContaining({ resolved_action: "skip" })]);

		const conflict = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});

		expect(conflict.statusCode).toBe(200);
		expect(conflict.json()).toEqual({
			success: true,
			action: "skip",
			alreadyProcessed: true,
			message: "This intake is already marked as skipped. Changes can only be made in MedAssist.",
		});
	});

	it("keeps legacy dismiss respond actions working as a skip alias", async () => {
		const userId = await createUser("notification-route-dismiss-alias");
		const { respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}`,
			payload: { action: "dismiss" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ success: true, action: "skip" });

		const groupRow = await testClient.execute({
			sql: "SELECT resolved_action FROM notification_action_groups",
		});
		expect(groupRow.rows).toEqual([expect.objectContaining({ resolved_action: "skip" })]);
	});

	it("returns an undo hint when a reminder was already taken before a follow-up skip action", async () => {
		const userId = await createUser("notification-route-taken-followup");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic");
		const { takenToken, respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const firstResponse = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});

		expect(firstResponse.statusCode).toBe(200);
		expect(firstResponse.json()).toEqual({ success: true, action: "taken" });

		const followUpHtml = await app.inject({
			method: "GET",
			url: `/notification-actions/${respondToken}`,
			headers: { accept: "text/html" },
		});

		expect(followUpHtml.statusCode).toBe(200);
		expect(followUpHtml.body).toContain(
			"This dose is already marked as taken. If you need to change it, open MedAssist and undo it there."
		);

		const followUpJson = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}`,
			payload: { action: "skip" },
		});

		expect(followUpJson.statusCode).toBe(200);
		expect(followUpJson.json()).toEqual({
			success: true,
			action: "taken",
			alreadyProcessed: true,
			message: "This dose is already marked as taken. Changes can only be made in MedAssist.",
		});
	});

	it("replaces the original ntfy notification after a successful action with a view-only confirmation", async () => {
		const userId = await createUser("notification-route-ntfy-delete");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic", {
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://user:pass@ntfy.example.com/medassist",
		});
		const { takenToken, context } = await seedContext({ userId, doseId: "5-0-1736064000000" });
		await testClient.execute({
			sql: "UPDATE notification_action_groups SET ntfy_original_message_id = ? WHERE user_id = ?",
			args: ["ntfy-msg-1", userId],
		});
		fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "ntfy-msg-2" }) });
		fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("") });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});

		expect(response.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const [targetUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
		expect(targetUrl).toBe("https://ntfy.example.com/medassist");
		expect(requestInit).toEqual(
			expect.objectContaining({
				method: "POST",
				body: "Take your medication now\n\n✅ This dose was marked as taken.",
				redirect: "error",
				headers: expect.objectContaining({
					Authorization: expect.stringMatching(/^Basic /),
					"X-Sequence-ID": context.sequenceId,
				}),
			})
		);

		const actionHeader = String((requestInit as { headers?: Record<string, string> }).headers?.Actions ?? "[]");
		expect(JSON.parse(actionHeader)).toEqual([
			{
				action: "view",
				label: "View",
				url: context.viewUrl,
				clear: false,
			},
		]);

		const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] ?? [];
		expect(deleteUrl).toBe("https://ntfy.example.com/medassist/ntfy-msg-1");
		expect(deleteInit).toEqual(
			expect.objectContaining({
				method: "DELETE",
				headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
			})
		);

		const groupRow = await testClient.execute({
			sql: "SELECT ntfy_original_message_id FROM notification_action_groups WHERE user_id = ?",
			args: [userId],
		});
		expect(groupRow.rows).toEqual([expect.objectContaining({ ntfy_original_message_id: "ntfy-msg-2" })]);
	});

	it("replaces the original ntfy notification after a skip action with a view-only confirmation", async () => {
		const userId = await createUser("notification-route-ntfy-skip-delete");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic", {
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://user:pass@ntfy.example.com/medassist",
		});
		const { skipToken, context } = await seedContext({ userId, doseId: "5-0-1736064000000" });
		await testClient.execute({
			sql: "UPDATE notification_action_groups SET ntfy_original_message_id = ? WHERE user_id = ?",
			args: ["ntfy-msg-7", userId],
		});
		fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "ntfy-msg-3" }) });
		fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("") });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${skipToken}`,
		});

		expect(response.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const [targetUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
		expect(targetUrl).toBe("https://ntfy.example.com/medassist");
		expect(requestInit).toEqual(
			expect.objectContaining({
				method: "POST",
				body: "Take your medication now\n\n⏭️ This intake was marked as skipped.",
				redirect: "error",
				headers: expect.objectContaining({
					Authorization: expect.stringMatching(/^Basic /),
					"X-Sequence-ID": context.sequenceId,
				}),
			})
		);

		const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] ?? [];
		expect(deleteUrl).toBe("https://ntfy.example.com/medassist/ntfy-msg-7");
		expect(deleteInit).toEqual(
			expect.objectContaining({
				method: "DELETE",
				headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
			})
		);

		const groupRow = await testClient.execute({
			sql: "SELECT ntfy_original_message_id FROM notification_action_groups WHERE user_id = ?",
			args: [userId],
		});
		expect(groupRow.rows).toEqual([expect.objectContaining({ ntfy_original_message_id: "ntfy-msg-3" })]);
	});

	it("warns when ntfy replacement, delete, and fallback clear all fail", async () => {
		const userId = await createUser("notification-route-ntfy-delete-warn");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic", {
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://user:pass@ntfy.example.com/medassist",
		});
		const { takenToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });
		fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("publish failed") });
		fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("upstream down") });
		fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve("not found") });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});

		expect(response.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(app.log.warn).toHaveBeenCalledWith(
			expect.objectContaining({ requestedAction: "taken" }),
			expect.stringContaining("Failed to replace ntfy notification after resolved action")
		);
		expect(app.log.warn).toHaveBeenCalledWith(
			expect.objectContaining({ requestedAction: "taken" }),
			expect.stringContaining("Failed to delete ntfy notification after resolved action")
		);
		expect(app.log.warn).toHaveBeenCalledWith(
			expect.objectContaining({ requestedAction: "taken" }),
			expect.stringContaining("Failed to clear ntfy notification after delete fallback")
		);
	});

	it("falls back to clear when ntfy replacement and delete both fail", async () => {
		const userId = await createUser("notification-route-ntfy-delete-clear-fallback");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic", {
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://user:pass@ntfy.example.com/medassist",
		});
		const { takenToken, context } = await seedContext({ userId, doseId: "5-0-1736064000000" });
		fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("publish failed") });
		fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve("missing") });
		fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("") });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});

		expect(response.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);

		const [clearUrl, clearInit] = fetchMock.mock.calls[2] ?? [];
		expect(clearUrl).toBe(`https://ntfy.example.com/medassist/${context.sequenceId}/clear`);
		expect(clearInit).toEqual(
			expect.objectContaining({
				method: "PUT",
				headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
			})
		);
	});

	it("allows browser-origin CORS requests for public notification action tokens", async () => {
		const userId = await createUser("notification-route-cors");
		const { respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const preflight = await app.inject({
			method: "OPTIONS",
			url: `/notification-actions/${respondToken}?action=taken`,
			headers: {
				origin: "https://ntfy.danielvolz.org",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		});

		expect(preflight.statusCode).toBe(204);
		expect(preflight.headers["access-control-allow-origin"]).toBe("https://ntfy.danielvolz.org");
		expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
		expect(preflight.headers["access-control-allow-headers"]).toContain("content-type");

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}`,
			headers: {
				origin: "https://ntfy.danielvolz.org",
			},
			payload: { action: "skip" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["access-control-allow-origin"]).toBe("https://ntfy.danielvolz.org");
	});

	it("accepts standard HTML form posts on respond pages", async () => {
		const userId = await createUser("notification-route-form-post");
		await insertNotificationMedication({ id: 5, userId, packCount: 1, looseTablets: 0 });
		await insertUserSettings(userId, "automatic");
		const { respondToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const response = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}?action=taken`,
			headers: {
				accept: "text/html",
				"content-type": "application/x-www-form-urlencoded",
			},
			payload: "",
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("Action recorded");
		expect(response.body).toContain("The dose was marked as taken.");
	});

	it("returns non-2xx for invalid, expired, and out-of-stock POST actions", async () => {
		const missing = await app.inject({ method: "POST", url: "/notification-actions/missing-token" });
		expect(missing.statusCode).toBe(404);

		const expiredUserId = await createUser("notification-route-expired");
		const { respondToken } = await seedContext({ userId: expiredUserId, doseId: "5-0-1736064000000" });
		await testClient.execute({
			sql: "UPDATE notification_action_groups SET expires_at = ? WHERE user_id = ?",
			args: [new Date(0), expiredUserId],
		});

		const expired = await app.inject({
			method: "POST",
			url: `/notification-actions/${respondToken}`,
			payload: { action: "skip" },
		});
		expect(expired.statusCode).toBe(410);

		const userId = await createUser("notification-route-stock");
		await insertNotificationMedication({ id: 5, userId, packCount: 0, looseTablets: 0 });
		await insertUserSettings(userId, "automatic");
		const { takenToken } = await seedContext({ userId, doseId: "5-0-1736064000000" });

		const outOfStock = await app.inject({
			method: "POST",
			url: `/notification-actions/${takenToken}`,
		});
		expect(outOfStock.statusCode).toBe(409);
		expect(outOfStock.json()).toEqual({ error: "Medication is out of stock", code: "OUT_OF_STOCK" });
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				userId,
				groupId: expect.any(Number),
				tokenKind: "taken",
				doseCount: 1,
				hasViewUrl: true,
				requestedAction: "taken",
				failedDoseIndex: 0,
				code: "OUT_OF_STOCK",
			}),
			"[NotificationActions] Failed to record taken notification action"
		);

		const state = await testClient.execute({
			sql: "SELECT resolved_action FROM notification_action_groups WHERE user_id = ?",
			args: [userId],
		});
		expect(state.rows).toEqual([expect.objectContaining({ resolved_action: null })]);
	});
});
