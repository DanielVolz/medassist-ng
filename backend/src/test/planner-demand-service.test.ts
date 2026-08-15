import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/migration-utils.js";

const { testClient, testDb } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	return { testClient: client, testDb: drizzle(client) };
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

import { calculatePlannerDemandRows } from "../services/planner-demand.js";

const __filename = fileURLToPath(import.meta.url);
const migrationsFolder = resolve(dirname(__filename), "../../drizzle");
const fixedNow = new Date("2026-01-04T12:00:00.000Z");

async function insertMedication(options: {
	id: number;
	userId: number;
	name?: string;
	genericName?: string | null;
	packageType?: string;
	medicationForm?: string;
	packCount?: number;
	pillsPerBlister?: number;
	looseTablets?: number;
	intakes?: Array<{ usage: number; every: number; start: string }>;
	isObsolete?: boolean;
}): Promise<void> {
	const intakes = options.intakes ?? [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z" }];
	await testClient.execute({
		sql: `INSERT INTO medications (
			id, user_id, name, generic_name, taken_by_json, medication_form, package_type,
			pack_count, blisters_per_pack, pills_per_blister, loose_tablets, stock_adjustment,
			usage_json, every_json, start_json, intakes_json, is_obsolete
		) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 1, ?, ?, 0, ?, ?, ?, ?, ?)`,
		args: [
			options.id,
			options.userId,
			options.name ?? "Planner medication",
			options.genericName ?? null,
			options.medicationForm ?? "tablet",
			options.packageType ?? "blister",
			options.packCount ?? 1,
			options.pillsPerBlister ?? 10,
			options.looseTablets ?? 0,
			JSON.stringify(intakes.map((intake) => intake.usage)),
			JSON.stringify(intakes.map((intake) => intake.every)),
			JSON.stringify(intakes.map((intake) => intake.start)),
			JSON.stringify(intakes.map((intake) => ({ ...intake, takenBy: null, intakeRemindersEnabled: false }))),
			options.isObsolete ? 1 : 0,
		],
	});
}

describe("calculatePlannerDemandRows", () => {
	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
	});

	beforeEach(async () => {
		await testClient.execute("DELETE FROM dose_tracking");
		await testClient.execute("DELETE FROM medications");
		await testClient.execute("DELETE FROM user_settings");
		await testClient.execute("DELETE FROM users");
	});

	afterAll(() => testClient.close());

	it("uses manual stock tracking while independently calculating planner demand", async () => {
		await testClient.execute("INSERT INTO users (id, username) VALUES (1, 'planner-owner')");
		await testClient.execute("INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (1, 'manual')");
		await insertMedication({ id: 1, userId: 1 });
		await testClient.execute({
			sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
			args: [1, "1-0-1767340800000", 1767340800000, 0, 1, "1-0-1767427200000", 1767427200000, 1],
		});

		const rows = await calculatePlannerDemandRows({
			userId: 1,
			startDate: new Date("2026-01-05T00:00:00.000Z"),
			endDate: new Date("2026-01-07T00:00:00.000Z"),
			now: fixedNow,
		});

		expect(rows).toEqual([
			expect.objectContaining({
				medicationId: 1,
				currentPills: 9,
				plannerUsage: 2,
				blistersNeeded: 1,
				fullBlisters: 0,
				loosePills: 7,
				enough: true,
			}),
		]);
	});

	it("falls back to automatic stock and a stable display name when settings and names are absent", async () => {
		await testClient.execute("INSERT INTO users (id, username) VALUES (1, 'planner-owner')");
		await testClient.execute("INSERT INTO users (id, username) VALUES (2, 'other-owner')");
		await insertMedication({ id: 2, userId: 1, name: " ", genericName: " " });
		await insertMedication({ id: 3, userId: 1, name: "Obsolete", isObsolete: true });
		await insertMedication({ id: 4, userId: 2, name: "Other user" });

		const rows = await calculatePlannerDemandRows({
			userId: 1,
			startDate: new Date("2026-01-05T00:00:00.000Z"),
			endDate: new Date("2026-01-07T00:00:00.000Z"),
			medicationIds: [2, 2, 2.5, Number.NaN],
			now: fixedNow,
		});

		expect(rows).toEqual([
			expect.objectContaining({
				medicationId: 2,
				medicationName: "Medication #2",
				currentPills: 6,
				plannerUsage: 2,
			}),
		]);
	});

	it("preserves amount-based package quantities without applying tablet blister arithmetic", async () => {
		await testClient.execute("INSERT INTO users (id, username) VALUES (1, 'planner-owner')");
		await testClient.execute("INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (1, 'manual')");
		await insertMedication({
			id: 5,
			userId: 1,
			packageType: "liquid_container",
			medicationForm: "liquid",
			looseTablets: 120,
			pillsPerBlister: 10,
		});

		const [row] = await calculatePlannerDemandRows({
			userId: 1,
			startDate: new Date("2026-01-05T00:00:00.000Z"),
			endDate: new Date("2026-01-07T00:00:00.000Z"),
			now: fixedNow,
		});

		expect(row).toMatchObject({
			packageType: "liquid_container",
			currentPills: 120,
			plannerUsage: 2,
			fullBlisters: 0,
			loosePills: 118,
		});
	});

	it.each(["automatic", "manual"] as const)(
		"subtracts active owner effects from planner stock in %s mode",
		async (stockCalculationMode) => {
			await testClient.execute("INSERT INTO users (id, username) VALUES (1, 'planner-owner')");
			await testClient.execute("INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (1, ?)", [
				stockCalculationMode,
			]);
			await insertMedication({
				id: 1,
				userId: 1,
				packCount: 0,
				looseTablets: 3,
				intakes: [{ usage: 1, every: 1, start: "2099-01-01T08:00:00.000Z" }],
			});
			await testClient.execute(
				"INSERT INTO dose_tracking (id, user_id, dose_id) VALUES (1, 1, 'as-needed:planner-anchor')"
			);
			await testClient.execute(
				"INSERT INTO as_needed_intake_events (event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint, occurred_at, recorded_at, quantity_milli, quantity_unit, stock_effect_milli) VALUES ('planner-event', 1, 1, 1, 'key', 'fingerprint', 1, 1, 1500, 'pills', 1500)"
			);
			const [row] = await calculatePlannerDemandRows({
				userId: 1,
				startDate: fixedNow,
				endDate: fixedNow,
				now: fixedNow,
			});
			expect(row.currentPills).toBe(1);
		}
	);
});
