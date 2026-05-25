import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";

const { testClient, testDb, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
		mockedEnv: {
			PUBLIC_APP_URL: "https://app.example.com",
			CORS_ORIGINS: "http://localhost:5173,http://localhost:4174",
		},
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { createNotificationActionContext, getNotificationActionTokenRecord, hashActionToken } = await import(
	"../services/notification-actions-service.js"
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

function extractToken(url: string): string {
	return url.split("/").at(-1) ?? "";
}

type ActionTokenRow = {
	kind: string | null;
	token_hash: string | null;
};

async function clearTables() {
	await testClient.execute("DELETE FROM notification_action_tokens");
	await testClient.execute("DELETE FROM notification_action_groups");
	await testClient.execute("DELETE FROM users");
}

async function createUser(username: string) {
	const result = await testClient.execute({
		sql: "INSERT INTO users (username, auth_provider, is_active) VALUES (?, 'local', 1) RETURNING id",
		args: [username],
	});

	return Number(result.rows[0].id);
}

describe("notification-actions-service", () => {
	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
	});

	afterAll(() => {
		testClient.close();
	});

	beforeEach(async () => {
		await clearTables();
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";
		mockedEnv.CORS_ORIGINS = "http://localhost:5173,http://localhost:4174";
	});

	it("creates a notification action group with hashed tokens and app/view links", async () => {
		const userId = await createUser("notify-actions-user");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");

		const context = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds: ["9-1-1736064000000", "9-0-1736064000000", "9-1-1736064000000"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(context).toMatchObject({
			respondUrl: expect.stringContaining("/api/notification-actions/"),
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=9-0-1736064000000",
			sequenceId: expect.stringMatching(/^medassist-/),
		});
		expect(context?.actions.map((action) => action.kind)).toEqual(["taken", "skip", "view"]);

		const groups = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM notification_action_groups WHERE user_id = ?",
			args: [userId],
		});
		expect(Number(groups.rows[0].count)).toBe(1);

		const tokenRows = await testClient.execute({
			sql: "SELECT kind, token_hash FROM notification_action_tokens ORDER BY kind ASC",
		});
		expect(tokenRows.rows).toHaveLength(3);

		const respondToken = extractToken(context!.respondUrl!);
		const respondRow = tokenRows.rows.find((row: { kind?: unknown }) => row.kind === "respond");
		expect(respondRow).toEqual(expect.objectContaining({ token_hash: hashActionToken(respondToken), kind: "respond" }));
		expect(respondRow?.token_hash).not.toBe(respondToken);

		const record = await getNotificationActionTokenRecord(respondToken);
		expect(record).toMatchObject({
			doseIds: ["9-0-1736064000000", "9-1-1736064000000"],
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=9-0-1736064000000",
		});
	});

	it("creates a view-only context without mutation tokens", async () => {
		const userId = await createUser("notify-actions-view-only");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");

		const context = await createNotificationActionContext({
			userId,
			title: "Grouped reminder",
			message: "Open the dashboard for details",
			doseIds: ["9-0-1736064000000", "10-0-1736064000000"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
			actionMode: "view-only",
		});

		expect(context).toEqual({
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=10-0-1736064000000",
			actions: [
				{
					kind: "view",
					label: "View",
					url: "https://app.example.com/dashboard?day=2026-01-05&dose=10-0-1736064000000",
					method: "GET",
				},
			],
		});

		const groups = await testClient.execute("SELECT COUNT(*) AS count FROM notification_action_groups");
		expect(Number(groups.rows[0].count)).toBe(0);

		const tokens = await testClient.execute("SELECT COUNT(*) AS count FROM notification_action_tokens");
		expect(Number(tokens.rows[0].count)).toBe(0);
	});

	it("reuses an unresolved active group for the same dose set and schedule", async () => {
		const userId = await createUser("notify-actions-reuse");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");

		const first = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds: ["9-0-1736064000000"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});
		const second = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds: ["9-0-1736064000000"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(second?.sequenceId).toBe(first?.sequenceId);

		const groups = await testClient.execute("SELECT id, sequence_id FROM notification_action_groups");
		expect(groups.rows).toHaveLength(1);
		expect(groups.rows[0]).toEqual(expect.objectContaining({ sequence_id: first?.sequenceId }));

		const tokens = await testClient.execute("SELECT COUNT(*) AS count FROM notification_action_tokens");
		expect(Number(tokens.rows[0].count)).toBe(6);
	});

	it("reactivates a resolved group with the same key instead of inserting a duplicate", async () => {
		const userId = await createUser("notify-actions-reactivate");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");
		const doseIds = ["9-1-1736064000000", "9-0-1736064000000"];

		const first = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds,
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(first).toMatchObject({
			groupId: expect.any(Number),
			respondUrl: expect.stringContaining("/api/notification-actions/"),
			sequenceId: expect.stringMatching(/^medassist-/),
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=9-0-1736064000000",
		});

		const firstGroupId = first!.groupId!;
		const firstSequenceId = first!.sequenceId!;
		const firstRespondToken = extractToken(first!.respondUrl!);
		const firstTokenRows = await testClient.execute({
			sql: "SELECT kind, token_hash FROM notification_action_tokens WHERE group_id = ? ORDER BY kind ASC",
			args: [firstGroupId],
		});
		expect(firstTokenRows.rows).toHaveLength(3);

		await testClient.execute({
			sql: "UPDATE notification_action_groups SET resolved_action = 'taken', resolved_at = ?, ntfy_original_message_id = 'old-message-id' WHERE id = ?",
			args: [new Date(), firstGroupId],
		});

		const second = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds,
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(second).toMatchObject({
			groupId: firstGroupId,
			respondUrl: expect.stringContaining("/api/notification-actions/"),
			sequenceId: expect.stringMatching(/^medassist-/),
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=9-0-1736064000000",
		});
		expect(second?.sequenceId).toBe(firstSequenceId);

		const groups = await testClient.execute(
			"SELECT id, sequence_id, resolved_action, resolved_at, ntfy_original_message_id FROM notification_action_groups"
		);
		expect(groups.rows).toHaveLength(1);
		expect(groups.rows[0]).toEqual(
			expect.objectContaining({
				id: firstGroupId,
				sequence_id: second?.sequenceId,
				resolved_action: null,
				resolved_at: null,
				ntfy_original_message_id: "",
			})
		);

		const secondTokenRows = await testClient.execute({
			sql: "SELECT kind, token_hash FROM notification_action_tokens WHERE group_id = ? ORDER BY kind ASC",
			args: [firstGroupId],
		});
		expect(secondTokenRows.rows).toHaveLength(3);
		expect(secondTokenRows.rows.map((row: ActionTokenRow) => row.kind)).toEqual(["respond", "skip", "taken"]);

		const firstTokenHashes = new Set(firstTokenRows.rows.map((row: ActionTokenRow) => String(row.token_hash)));
		const secondTokenHashes = new Set(secondTokenRows.rows.map((row: ActionTokenRow) => String(row.token_hash)));
		expect(secondTokenHashes.size).toBe(3);
		expect([...secondTokenHashes].every((tokenHash) => !firstTokenHashes.has(tokenHash))).toBe(true);

		expect(await getNotificationActionTokenRecord(firstRespondToken)).toBeNull();

		const secondRespondToken = extractToken(second!.respondUrl!);
		const secondRespondRecord = await getNotificationActionTokenRecord(secondRespondToken);
		expect(secondRespondRecord).toMatchObject({
			doseIds: ["9-0-1736064000000", "9-1-1736064000000"],
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=9-0-1736064000000",
		});
		expect(secondRespondRecord?.group.id).toBe(firstGroupId);
	});

	it("prefers a non-local CORS origin when PUBLIC_APP_URL points to localhost", async () => {
		const userId = await createUser("notify-actions-mobile");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");
		mockedEnv.PUBLIC_APP_URL = "http://localhost:5173";
		mockedEnv.CORS_ORIGINS = "http://localhost:5173,http://192.168.0.113:5173";

		const context = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds: ["9-0-1736064000000"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(context).toMatchObject({
			respondUrl: `http://192.168.0.113:5173/api/notification-actions/${extractToken(context!.respondUrl!)}`,
			viewUrl: "http://192.168.0.113:5173/dashboard?day=2026-01-05&dose=9-0-1736064000000",
		});

		const record = await getNotificationActionTokenRecord(extractToken(context!.respondUrl!));
		expect(record?.viewUrl).toBe("http://192.168.0.113:5173/dashboard?day=2026-01-05&dose=9-0-1736064000000");
	});

	it("falls back to the date view when dose ids do not contain a medication id", async () => {
		const userId = await createUser("notify-actions-fallback");
		const scheduledFor = new Date("2026-01-05T08:00:00.000Z");

		const context = await createNotificationActionContext({
			userId,
			title: "Reminder",
			message: "Take your medication now",
			doseIds: ["invalid-dose-id"],
			scheduledFor,
			publicAppUrl: mockedEnv.PUBLIC_APP_URL,
			language: "en",
		});

		expect(context?.viewUrl).toBe("https://app.example.com/dashboard?day=2026-01-05&dose=invalid-dose-id");
	});
});
