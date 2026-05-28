import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";
import { insertScheduledTestMedication } from "./setup.js";

const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

const { dismissDosesForUser, markDoseTakenForUser } = await import("../services/dose-tracking-service.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM dose_tracking");
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

async function insertUserSettings(userId: number, stockCalculationMode: "automatic" | "manual" = "automatic") {
	await testClient.execute({
		sql: "INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, ?)",
		args: [userId, stockCalculationMode],
	});
}

async function insertDose(options: {
	userId: number;
	doseId: string;
	dismissed?: boolean;
	takenAt?: number;
	takenSource?: "manual" | "automatic" | "notification";
	markedBy?: string | null;
}) {
	await testClient.execute({
		sql: `INSERT INTO dose_tracking (user_id, dose_id, dismissed, taken_at, taken_source, marked_by)
		      VALUES (?, ?, ?, ?, ?, ?)`,
		args: [
			options.userId,
			options.doseId,
			options.dismissed ? 1 : 0,
			options.takenAt ?? Math.floor(Date.now() / 1000),
			options.takenSource ?? "manual",
			options.markedBy ?? null,
		],
	});
}

describe("dose-tracking-service", () => {
	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
	});

	afterAll(() => {
		testClient.close();
	});

	beforeEach(async () => {
		await clearTables();
	});

	it("inserts a taken row for a valid in-stock dose", async () => {
		const userId = await createUser("dose-service-user");
		await insertScheduledTestMedication(testClient, { id: 5, userId, packCount: 1 });
		await insertUserSettings(userId, "automatic");

		const result = await markDoseTakenForUser({
			userId,
			doseId: "5-0-1736064000000",
			source: "notification",
			markedBy: null,
		});

		expect(result).toEqual({ success: true, status: "marked" });

		const rows = await testClient.execute({
			sql: "SELECT dismissed, taken_source, marked_by FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [userId, "5-0-1736064000000"],
		});
		expect(rows.rows).toEqual([
			expect.objectContaining({ dismissed: 0, taken_source: "notification", marked_by: null }),
		]);
	});

	it("is idempotent when the dose is already taken", async () => {
		const userId = await createUser("dose-service-existing");
		await insertDose({ userId, doseId: "5-0-1736064000000", dismissed: false });

		const result = await markDoseTakenForUser({
			userId,
			doseId: "5-0-1736064000000",
			source: "manual",
			markedBy: null,
		});

		expect(result).toEqual({ success: true, status: "already_taken" });

		const count = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [userId, "5-0-1736064000000"],
		});
		expect(Number(count.rows[0].count)).toBe(1);
	});

	it("keeps one row when the same dose is marked concurrently", async () => {
		const userId = await createUser("dose-service-concurrent");
		await insertScheduledTestMedication(testClient, { id: 5, userId, packCount: 1 });
		await insertUserSettings(userId, "automatic");

		const results = await Promise.all([
			markDoseTakenForUser({
				userId,
				doseId: "5-0-1736064000000",
				source: "notification",
				markedBy: null,
			}),
			markDoseTakenForUser({
				userId,
				doseId: "5-0-1736064000000",
				source: "notification",
				markedBy: null,
			}),
		]);

		expect(results).toEqual(
			expect.arrayContaining([
				{ success: true, status: "marked" },
				{ success: true, status: "already_taken" },
			])
		);

		const count = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [userId, "5-0-1736064000000"],
		});
		expect(Number(count.rows[0].count)).toBe(1);
	});

	it("rejects taking a dose that is already skipped", async () => {
		const userId = await createUser("dose-service-dismissed");
		await insertScheduledTestMedication(testClient, { id: 5, userId, packCount: 1 });
		await insertUserSettings(userId, "automatic");
		await insertDose({
			userId,
			doseId: "5-0-1736064000000",
			dismissed: true,
			takenAt: 0,
			takenSource: "manual",
			markedBy: null,
		});

		const result = await markDoseTakenForUser({
			userId,
			doseId: "5-0-1736064000000",
			source: "notification",
			markedBy: "reminder",
		});

		expect(result).toEqual({ success: false, code: "ALREADY_SKIPPED", message: "Dose is already skipped" });

		const rows = await testClient.execute({
			sql: "SELECT dismissed, taken_source, marked_by, taken_at FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [userId, "5-0-1736064000000"],
		});
		expect(rows.rows).toEqual([expect.objectContaining({ dismissed: 1, taken_source: "manual", marked_by: null })]);
		expect(Number(rows.rows[0].taken_at)).toBe(0);
	});

	it("returns OUT_OF_STOCK without mutating dose tracking", async () => {
		const userId = await createUser("dose-service-stock");
		await insertScheduledTestMedication(testClient, { id: 5, userId, packCount: 0, looseTablets: 0 });
		await insertUserSettings(userId, "automatic");

		const result = await markDoseTakenForUser({
			userId,
			doseId: "5-0-1736064000000",
			source: "notification",
			markedBy: null,
		});

		expect(result).toEqual({ success: false, code: "OUT_OF_STOCK", message: "Medication is out of stock" });

		const count = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ?",
			args: [userId],
		});
		expect(Number(count.rows[0].count)).toBe(0);
	});

	it("dismisses new doses, stays idempotent for dismissed rows, and preserves real taken rows", async () => {
		const userId = await createUser("dose-service-dismiss");
		await insertDose({ userId, doseId: "5-1-1736064000000", dismissed: true, takenAt: 0 });
		await insertDose({ userId, doseId: "5-2-1736064000000", dismissed: false });

		const result = await dismissDosesForUser({
			userId,
			doseIds: ["5-0-1736064000000", "5-1-1736064000000", "5-2-1736064000000"],
		});

		expect(result).toEqual({ success: true, dismissedCount: 1, alreadyTakenCount: 1 });

		const rows = await testClient.execute({
			sql: "SELECT dose_id, dismissed, taken_at FROM dose_tracking WHERE user_id = ? ORDER BY dose_id ASC",
			args: [userId],
		});
		expect(rows.rows).toEqual([
			expect.objectContaining({ dose_id: "5-0-1736064000000", dismissed: 1, taken_at: 0 }),
			expect.objectContaining({ dose_id: "5-1-1736064000000", dismissed: 1, taken_at: 0 }),
			expect.objectContaining({ dose_id: "5-2-1736064000000", dismissed: 0 }),
		]);
	});
});
