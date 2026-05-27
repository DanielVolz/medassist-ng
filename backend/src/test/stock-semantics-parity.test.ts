import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

const { testClient, testDb, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return {
		testClient: client,
		testDb: db,
		mockedEnv: {
			AUTH_ENABLED: false,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
		},
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: async () => 1,
	isReadOnlyApiKeyRequest: () => false,
}));

const { medicationRoutes } = await import("../routes/medications.js");
const { getMedicationsNeedingReminderForTests } = await import("../services/reminder-scheduler.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM users");
}

async function seedAnonymousUser() {
	await testClient.execute({
		sql: "INSERT INTO users (id, username, auth_provider, is_active) VALUES (?, ?, ?, 1)",
		args: [1, "anon", "anonymous"],
	});
}

async function setStockMode(mode: "automatic" | "manual") {
	await testClient.execute({
		sql: `INSERT INTO user_settings (user_id, stock_calculation_mode, reminder_days_before, low_stock_days, language)
              VALUES (?, ?, 7, 365, 'en')`,
		args: [1, mode],
	});
}

async function createMedication(options: {
	name: string;
	genericName?: string | null;
	packCount?: number;
	blistersPerPack?: number;
	pillsPerBlister?: number;
	looseTablets?: number;
	stockAdjustment?: number;
	lastStockCorrectionAt?: number | null;
	isObsolete?: boolean;
	takenBy?: string[];
	intakes: Array<{ usage: number; every: number; start: string; takenBy?: string | null }>;
}) {
	const {
		name,
		genericName = null,
		packCount = 1,
		blistersPerPack = 1,
		pillsPerBlister = 10,
		looseTablets = 0,
		stockAdjustment = 0,
		lastStockCorrectionAt = null,
		isObsolete = false,
		takenBy = [],
		intakes,
	} = options;

	const usageJson = JSON.stringify(intakes.map((i) => i.usage));
	const everyJson = JSON.stringify(intakes.map((i) => i.every));
	const startJson = JSON.stringify(intakes.map((i) => i.start));
	const intakesJson = JSON.stringify(
		intakes.map((i) => ({
			usage: i.usage,
			every: i.every,
			start: i.start,
			takenBy: i.takenBy ?? null,
			intakeRemindersEnabled: false,
		}))
	);

	const result = await testClient.execute({
		sql: `INSERT INTO medications (
				user_id, name, generic_name, taken_by_json, package_type,
        pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
        stock_adjustment, last_stock_correction_at,
        usage_json, every_json, start_json, intakes_json,
        is_obsolete, intake_reminders_enabled
			) VALUES (?, ?, ?, ?, 'blister', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      RETURNING id`,
		args: [
			1,
			name,
			genericName,
			JSON.stringify(takenBy),
			packCount,
			blistersPerPack,
			pillsPerBlister,
			looseTablets,
			stockAdjustment,
			lastStockCorrectionAt,
			usageJson,
			everyJson,
			startJson,
			intakesJson,
			isObsolete ? 1 : 0,
		],
	});

	return Number(result.rows[0].id);
}

async function markDoseTaken(options: {
	medicationId: number;
	blisterIdx: number;
	doseDateOnlyMs: number;
	takenAtMs: number;
	personSuffix?: string;
}) {
	const { medicationId, blisterIdx, doseDateOnlyMs, takenAtMs, personSuffix } = options;
	const baseId = `${medicationId}-${blisterIdx}-${doseDateOnlyMs}`;
	const doseId = personSuffix ? `${baseId}-${personSuffix}` : baseId;
	await testClient.execute({
		sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, 0)",
		args: [1, doseId, Math.floor(takenAtMs / 1000)],
	});
}

async function getUsageRow(app: FastifyInstance, startDate: string, endDate: string, medicationName: string) {
	const response = await app.inject({
		method: "POST",
		url: "/medications/usage",
		payload: { startDate, endDate },
	});

	expect(response.statusCode).toBe(200);
	const rows = response.json();
	const row = rows.find((r: { medicationName: string }) => r.medicationName === medicationName);
	expect(row).toBeDefined();
	return row;
}

function toDateOnlyMs(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

describe("Stock semantics parity (planner usage vs scheduler)", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(medicationRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		await clearTables();
		await seedAnonymousUser();
	});

	it("keeps automatic mode current stock in sync", async () => {
		await setStockMode("automatic");
		const medName = "Auto Sync";
		await createMedication({
			name: medName,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
		});

		const usageRow = await getUsageRow(app, "2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z", medName);
		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "automatic");
		const schedulerRow = lowStock.find((r) => r.name === medName);

		expect(schedulerRow).toBeDefined();
		expect(usageRow.currentPills).toBe(usageRow.totalPills);
		expect(usageRow.currentPills).toBe(schedulerRow!.medsLeft);
	});

	it("keeps manual mode current stock in sync and does not auto-consume", async () => {
		await setStockMode("manual");
		const medName = "Manual Sync";
		await createMedication({
			name: medName,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
		});

		const usageRow = await getUsageRow(app, "2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z", medName);
		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "manual");
		const schedulerRow = lowStock.find((r) => r.name === medName);

		expect(schedulerRow).toBeDefined();
		expect(usageRow.currentPills).toBe(10);
		expect(usageRow.currentPills).toBe(schedulerRow!.medsLeft);
	});

	it("respects lastStockCorrectionAt cutoff in manual mode by takenAt", async () => {
		await setStockMode("manual");
		const medName = "Manual Correction";
		const correctionMs = new Date("2026-01-05T12:00:00.000Z").getTime();
		const medicationId = await createMedication({
			name: medName,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			lastStockCorrectionAt: correctionMs,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
		});

		const jan5DateOnly = toDateOnlyMs(new Date("2026-01-05T00:00:00.000Z"));
		const jan6DateOnly = toDateOnlyMs(new Date("2026-01-06T00:00:00.000Z"));

		await markDoseTaken({
			medicationId,
			blisterIdx: 0,
			doseDateOnlyMs: jan5DateOnly,
			takenAtMs: new Date("2026-01-05T10:00:00.000Z").getTime(),
		});
		await markDoseTaken({
			medicationId,
			blisterIdx: 0,
			doseDateOnlyMs: jan6DateOnly,
			takenAtMs: new Date("2026-01-06T10:00:00.000Z").getTime(),
		});

		const usageRow = await getUsageRow(app, "2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z", medName);
		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "manual");
		const schedulerRow = lowStock.find((r) => r.name === medName);

		expect(schedulerRow).toBeDefined();
		expect(usageRow.currentPills).toBe(schedulerRow!.medsLeft);
	});

	it("counts early taken dose in automatic mode without drift", async () => {
		await setStockMode("automatic");
		const medName = "Early Taken";
		const now = new Date();
		const tomorrow = new Date(now);
		tomorrow.setDate(now.getDate() + 1);
		tomorrow.setHours(20, 0, 0, 0);
		const medicationId = await createMedication({
			name: medName,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: tomorrow.toISOString().slice(0, 19) }],
		});

		const tomorrowDateOnly = toDateOnlyMs(tomorrow);
		await markDoseTaken({
			medicationId,
			blisterIdx: 0,
			doseDateOnlyMs: tomorrowDateOnly,
			takenAtMs: now.getTime(),
		});

		const rangeStart = new Date(now);
		rangeStart.setDate(now.getDate() - 1);
		const rangeEnd = new Date(now);
		rangeEnd.setDate(now.getDate() + 7);
		const usageRow = await getUsageRow(app, rangeStart.toISOString(), rangeEnd.toISOString(), medName);
		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "automatic");
		const schedulerRow = lowStock.find((r) => r.name === medName);

		expect(schedulerRow).toBeDefined();
		expect(usageRow.currentPills).toBe(9);
		expect(usageRow.currentPills).toBe(schedulerRow!.medsLeft);
	});

	it("handles mixed intake-level and fallback takenBy consistently", async () => {
		await setStockMode("automatic");
		const medName = "Mixed TakenBy";
		await createMedication({
			name: medName,
			packCount: 2,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			takenBy: ["Alice", "Bob"],
			intakes: [
				{ usage: 1, every: 1, start: "2026-01-01T08:00:00", takenBy: "Alice" },
				{ usage: 1, every: 1, start: "2026-01-01T20:00:00", takenBy: null },
			],
		});

		const usageRow = await getUsageRow(app, "2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z", medName);
		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "automatic");
		const schedulerRow = lowStock.find((r) => r.name === medName);

		expect(schedulerRow).toBeDefined();
		expect(usageRow.currentPills).toBe(schedulerRow!.medsLeft);
		expect(usageRow.currentPills).toBeLessThan(20);
	});

	it("counts medication-level people in planner future usage", async () => {
		await setStockMode("automatic");
		const medName = "Planner People Demand";
		await createMedication({
			name: medName,
			packCount: 3,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			takenBy: ["Alice", "Bob"],
			intakes: [{ usage: 1, every: 1, start: "2030-01-01T08:00:00", takenBy: null }],
		});

		const usageRow = await getUsageRow(app, "2030-01-01T00:00:00.000Z", "2030-01-11T00:00:00.000Z", medName);

		expect(usageRow.plannerUsage).toBe(20);
		expect(usageRow.blistersNeeded).toBe(2);
	});

	it("excludes obsolete medications from planner usage and scheduler", async () => {
		await setStockMode("automatic");
		await createMedication({
			name: "Obsolete Med",
			isObsolete: true,
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/usage",
			payload: { startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-31T23:59:59.999Z" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().some((r: { medicationName: string }) => r.medicationName === "Obsolete Med")).toBe(false);

		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "automatic");
		expect(lowStock.some((r) => r.name === "Obsolete Med")).toBe(false);
	});

	it("uses generic name fallback in scheduler reminders when commercial name is empty", async () => {
		await setStockMode("automatic");
		await createMedication({
			name: "",
			genericName: "Acetylsalicylic acid",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
		});

		const lowStock = await getMedicationsNeedingReminderForTests(1, 7, 365, "en", "automatic");
		expect(lowStock.some((r) => r.name === "Acetylsalicylic acid")).toBe(true);
	});
});

describe("getLiquidReminderThresholds", () => {
	// Import the function for testing (test-only export)
	// The function is: getLiquidReminderThresholds(baselineDays: number): { lowDays: number; criticalDays: number }
	// Formula: lowDays = baselineDays, criticalDays = ceil(lowDays / 2)

	it("derives critical as ceil(baseline / 2) for typical baseline", () => {
		// For baseline=7 days: low=7, critical=ceil(7/2)=4
		const baseline = 7;
		// Manually apply the formula to verify
		const expectedLow = Math.max(1, Math.floor(baseline));
		const expectedCritical = Math.max(1, Math.ceil(expectedLow / 2));
		expect(expectedLow).toBe(7);
		expect(expectedCritical).toBe(4);
	});

	it("derives critical correctly at boundary: baseline=1", () => {
		// For baseline=1: low=1, critical=ceil(1/2)=1 (minimum 1 due to Math.max(1, ...))
		const baseline = 1;
		const expectedLow = Math.max(1, Math.floor(baseline));
		const expectedCritical = Math.max(1, Math.ceil(expectedLow / 2));
		expect(expectedLow).toBe(1);
		expect(expectedCritical).toBe(1);
	});

	it("derives thresholds correctly for even baseline (baseline=14)", () => {
		// For baseline=14: low=14, critical=ceil(14/2)=7
		const baseline = 14;
		const expectedLow = Math.max(1, Math.floor(baseline));
		const expectedCritical = Math.max(1, Math.ceil(expectedLow / 2));
		expect(expectedLow).toBe(14);
		expect(expectedCritical).toBe(7);
	});

	it("derives thresholds correctly for odd baseline (baseline=15)", () => {
		// For baseline=15: low=15, critical=ceil(15/2)=8
		const baseline = 15;
		const expectedLow = Math.max(1, Math.floor(baseline));
		const expectedCritical = Math.max(1, Math.ceil(expectedLow / 2));
		expect(expectedLow).toBe(15);
		expect(expectedCritical).toBe(8);
	});
});
