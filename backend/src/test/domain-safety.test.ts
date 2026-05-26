import { existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";
import { doseTracking, medications } from "../db/schema.js";
import { computeMedicationCurrentStock } from "../services/current-stock.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";
import {
	countScheduledOccurrencesInRange,
	forEachScheduledOccurrenceInRange,
	getEffectiveTimezone,
	getTodayInTimezone,
	parseLocalDateTime,
} from "../utils/scheduler-utils.js";
import { dstCorpus, scheduleCorpus, stockPropertyCorpus } from "./fixtures/domain-safety-corpus.js";

const { testClient, testDb, testDbPath, mockedEnv } = vi.hoisted(() => {
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const dbPath = join(tmpdir(), `medassist-domain-safety-${process.pid}-${Date.now()}.db`);
	const client = createClient({ url: `file:${dbPath}` });
	const db = drizzle(client);
	return {
		testClient: client,
		testDb: db,
		testDbPath: dbPath,
		mockedEnv: {
			AUTH_ENABLED: false,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
			PUBLIC_APP_URL: "https://app.example.com",
			CORS_ORIGINS: "https://app.example.com",
			SHARE_TOKEN_TTL_DAYS: 90,
			SENSITIVE_LOGGING_ENABLED: false,
			LOG_LEVEL: "silent",
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
	getAnonymousUserId: () => 1,
	isReadOnlyApiKeyRequest: () => false,
}));

const { medicationRoutes } = await import("../routes/medications.js");
const { doseRoutes } = await import("../routes/doses.js");
const { shareRoutes } = await import("../routes/share.js");
const { exportRoutes } = await import("../routes/export.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

type MedicationPayload = {
	name: string;
	takenBy?: string[];
	packageType?: "blister" | "bottle" | "tube" | "liquid_container" | "inhaler" | "injection";
	medicationForm?: "capsule" | "tablet" | "liquid" | "topical";
	packCount?: number;
	blistersPerPack?: number;
	pillsPerBlister?: number;
	looseTablets?: number;
	totalPills?: number | null;
	expiryDate?: string | null;
	prescriptionEnabled?: boolean;
	prescriptionAuthorizedRefills?: number | null;
	prescriptionRemainingRefills?: number | null;
	prescriptionLowRefillThreshold?: number;
	prescriptionExpiryDate?: string | null;
	intakes: Array<{
		usage: number;
		every: number;
		start: string;
		scheduleMode?: "interval" | "weekdays";
		weekdays?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
		takenBy?: string | null;
		intakeRemindersEnabled?: boolean;
	}>;
};

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM users");
	await testClient.execute("DELETE FROM sqlite_sequence");
}

async function seedAnonymousUser() {
	await testClient.execute({
		sql: "INSERT INTO users (id, username, auth_provider, is_active) VALUES (?, ?, ?, 1)",
		args: [1, "anon", "anonymous"],
	});
}

async function seedSettings(
	overrides: {
		stockCalculationMode?: "automatic" | "manual";
		timezone?: string;
		expiryWarningDays?: number;
		reminderDaysBefore?: number;
		lowStockDays?: number;
		shareMedicationOverview?: boolean;
	} = {}
) {
	await testClient.execute({
		sql: `INSERT INTO user_settings (
			user_id, timezone, stock_calculation_mode, expiry_warning_days,
			reminder_days_before, low_stock_days, share_medication_overview, language
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'en')`,
		args: [
			1,
			overrides.timezone ?? "",
			overrides.stockCalculationMode ?? "automatic",
			overrides.expiryWarningDays ?? 30,
			overrides.reminderDaysBefore ?? 7,
			overrides.lowStockDays ?? 30,
			overrides.shareMedicationOverview ? 1 : 0,
		],
	});
}

async function createMedication(
	app: FastifyInstance,
	payload: MedicationPayload
): Promise<{ id: number; name: string }> {
	const packageType = payload.packageType ?? "blister";
	const isAmountBased = ["bottle", "tube", "liquid_container", "inhaler", "injection"].includes(packageType);
	let defaultMedicationForm: "capsule" | "tablet" | "liquid" | "topical" = "tablet";
	if (packageType === "tube") {
		defaultMedicationForm = "topical";
	} else if (packageType === "liquid_container") {
		defaultMedicationForm = "liquid";
	}
	const medicationForm = payload.medicationForm ?? defaultMedicationForm;
	const response = await app.inject({
		method: "POST",
		url: "/medications",
		payload: {
			medicationForm,
			pillForm: medicationForm === "tablet" ? "tablet" : null,
			lifecycleCategory: "refill_when_empty",
			packageType,
			packCount: payload.packCount ?? (packageType === "tube" ? 1 : 1),
			blistersPerPack: isAmountBased ? 1 : (payload.blistersPerPack ?? 1),
			pillsPerBlister: isAmountBased ? 1 : (payload.pillsPerBlister ?? 10),
			looseTablets: payload.looseTablets ?? 0,
			totalPills: payload.totalPills ?? null,
			packageAmountValue: packageType === "tube" || packageType === "liquid_container" ? 30 : 0,
			packageAmountUnit: packageType === "tube" ? "g" : "ml",
			doseUnit: medicationForm === "liquid" ? "ml" : "mg",
			takenBy: payload.takenBy ?? [],
			...payload,
		},
	});

	expect(response.statusCode).toBe(200);
	return response.json();
}

function dateOnlyMs(localDate: string): number {
	const date = parseLocalDateTime(`${localDate}T00:00:00`);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function doseId(medicationId: number, intakeIndex: number, localDate: string, person?: string): string {
	const base = `${medicationId}-${intakeIndex}-${dateOnlyMs(localDate)}`;
	return person ? `${base}-${person}` : base;
}

async function insertDose(options: {
	doseId: string;
	takenAt: string;
	markedBy?: string | null;
	dismissed?: boolean;
	takenSource?: "manual" | "automatic";
}): Promise<number> {
	const result = await testClient.execute({
		sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, marked_by, dismissed, taken_source)
		      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			1,
			options.doseId,
			Math.floor(new Date(options.takenAt).getTime() / 1000),
			options.markedBy ?? null,
			options.dismissed ? 1 : 0,
			options.takenSource ?? "manual",
		],
	});
	return Number(result.rows[0].id);
}

async function getUsageRow(app: FastifyInstance, medicationName: string) {
	const response = await app.inject({
		method: "POST",
		url: "/medications/usage",
		payload: {
			startDate: "2026-06-01T00:00:00.000Z",
			endDate: "2026-06-15T23:59:59.999Z",
		},
	});

	expect(response.statusCode).toBe(200);
	const row = response.json().find((entry: { medicationName: string }) => entry.medicationName === medicationName);
	expect(row).toBeDefined();
	return row;
}

async function getCurrentStock(medicationId: number, stockCalculationMode: "automatic" | "manual", nowMs: number) {
	const [medication] = await testDb.select().from(medications).where(eq(medications.id, medicationId));
	const doses = await testDb.select().from(doseTracking).where(eq(doseTracking.userId, 1));
	expect(medication).toBeDefined();
	return computeMedicationCurrentStock({ medication: medication!, doses, stockCalculationMode, nowMs });
}

function localDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function withTimezone<T>(timezone: string, callback: () => T): T {
	const previousTimezone = process.env.TZ;
	process.env.TZ = timezone;
	try {
		return callback();
	} finally {
		if (previousTimezone === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = previousTimezone;
		}
	}
}

describe("Domain safety corpus: scheduling", () => {
	it.each(dstCorpus)("$name", (testCase) => {
		withTimezone(testCase.timezone, () => {
			const occurrences: Date[] = [];
			const rangeStart = new Date(
				testCase.rangeStart.year,
				testCase.rangeStart.monthIndex,
				testCase.rangeStart.day,
				0,
				0,
				0,
				0
			);
			const rangeEnd = new Date(
				testCase.rangeEnd.year,
				testCase.rangeEnd.monthIndex,
				testCase.rangeEnd.day,
				0,
				0,
				0,
				0
			);

			forEachScheduledOccurrenceInRange(
				{ every: 1, start: testCase.scheduleStart },
				rangeStart.getTime(),
				rangeEnd.getTime() - 1,
				(occurrenceMs) => occurrences.push(new Date(occurrenceMs))
			);

			expect(occurrences.map(localDateString)).toEqual(testCase.expectedLocalDates);
			expect(occurrences.map((date) => date.getHours())).toEqual(
				Array(testCase.expectedLocalDates.length).fill(testCase.expectedLocalHour)
			);
		});
	});

	it.each(scheduleCorpus)("counts $name schedules deterministically", (testCase) => {
		const result = countScheduledOccurrencesInRange(
			testCase.schedule,
			parseLocalDateTime(testCase.rangeStart).getTime(),
			parseLocalDateTime(testCase.rangeEnd).getTime() - 1
		);

		expect(result.count).toBe(testCase.expectedCount);
	});
});

describe("Domain safety corpus: real route and service flows", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(medicationRoutes);
		await app.register(shareRoutes);
		await app.register(doseRoutes);
		await app.register(exportRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
		if (existsSync(testDbPath)) {
			unlinkSync(testDbPath);
		}
	});

	beforeEach(async () => {
		await clearTables();
		await seedAnonymousUser();
	});

	it("distinguishes automatic and manual stock calculation with multi-person and per-intake takenBy", async () => {
		await seedSettings({ stockCalculationMode: "automatic" });
		const medication = await createMedication(app, {
			name: "Multi Person Safety",
			takenBy: ["Alice", "Bob"],
			packCount: 2,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [
				{ usage: 1, every: 1, start: "2026-06-01T08:00:00", takenBy: "Alice" },
				{ usage: 1, every: 1, start: "2026-06-01T20:00:00", takenBy: null },
			],
		});

		const stockReferenceTime = new Date("2026-06-03T12:00:00.000Z").getTime();
		expect(await getCurrentStock(medication.id, "automatic", stockReferenceTime)).toBe(13);
		expect(await getCurrentStock(medication.id, "manual", stockReferenceTime)).toBe(20);

		await insertDose({
			doseId: doseId(medication.id, 1, "2026-06-02", "Bob"),
			takenAt: "2026-06-02T20:05:00.000Z",
			markedBy: "Bob",
		});

		expect(await getCurrentStock(medication.id, "manual", stockReferenceTime)).toBe(19);
	});

	it.each(stockPropertyCorpus)("never displays negative current stock: $name", async ({ stock, doseCount }) => {
		await seedSettings({ stockCalculationMode: "manual" });
		const medication = await createMedication(app, {
			name: `Clamp ${stock}-${doseCount}`,
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: stock,
			intakes: [{ usage: 1, every: 1, start: "2026-06-01T08:00:00" }],
		});

		for (let index = 0; index < doseCount; index++) {
			const day = String(index + 1).padStart(2, "0");
			await insertDose({
				doseId: doseId(medication.id, 0, `2026-06-${day}`),
				takenAt: `2026-06-${day}T08:05:00.000Z`,
			});
		}

		const usageRow = await getUsageRow(app, medication.name);
		expect(usageRow.currentPills).toBeGreaterThanOrEqual(0);
		expect(usageRow.totalPills).toBeGreaterThanOrEqual(0);
	});

	it("marks a dose idempotently through the public dose route", async () => {
		await seedSettings({ stockCalculationMode: "manual" });
		const medication = await createMedication(app, {
			name: "Idempotent Dose",
			takenBy: ["Alice"],
			looseTablets: 5,
			intakes: [{ usage: 1, every: 1, start: "2026-06-03T08:00:00", takenBy: "Alice" }],
		});
		const targetDoseId = doseId(medication.id, 0, "2026-06-03", "Alice");

		const first = await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: targetDoseId } });
		const second = await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: targetDoseId } });

		expect(first.statusCode).toBe(200);
		expect(second.statusCode).toBe(200);
		expect(second.json()).toEqual({ success: true, message: "Already marked" });

		const count = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [1, targetDoseId],
		});
		expect(Number(count.rows[0].count)).toBe(1);
	});

	it("does not deduct stock when a dose is skipped/dismissed", async () => {
		await seedSettings({ stockCalculationMode: "manual" });
		const medication = await createMedication(app, {
			name: "Skipped Dose Stock",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 5,
			intakes: [{ usage: 1, every: 1, start: "2026-06-03T08:00:00" }],
		});
		const targetDoseId = doseId(medication.id, 0, "2026-06-03");

		const response = await app.inject({ method: "POST", url: "/doses/skip", payload: { doseId: targetDoseId } });
		expect(response.statusCode).toBe(200);

		const usageRow = await getUsageRow(app, medication.name);
		expect(usageRow.currentPills).toBe(5);

		const rows = await testClient.execute({
			sql: "SELECT dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [1, targetDoseId],
		});
		expect(rows.rows).toEqual([expect.objectContaining({ dismissed: 1 })]);
	});

	it("blocks out-of-stock dose marking without writing dose history", async () => {
		await seedSettings({ stockCalculationMode: "manual" });
		const medication = await createMedication(app, {
			name: "Empty Medication",
			packCount: 0,
			looseTablets: 0,
			intakes: [{ usage: 1, every: 1, start: "2026-06-03T08:00:00" }],
		});
		const targetDoseId = doseId(medication.id, 0, "2026-06-03");

		const response = await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: targetDoseId } });

		expect(response.statusCode).toBe(409);
		expect(response.json()).toEqual({ error: "Medication is out of stock", code: "OUT_OF_STOCK" });

		const count = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ?",
			args: [1],
		});
		expect(Number(count.rows[0].count)).toBe(0);
	});

	it("keeps share schedules scoped to per-intake takenBy and invalidates regenerated tokens", async () => {
		await seedSettings({ stockCalculationMode: "automatic", expiryWarningDays: 21 });
		await createMedication(app, {
			name: "Shared Per Intake",
			takenBy: ["Alice"],
			looseTablets: 10,
			intakes: [
				{ usage: 1, every: 1, start: "2026-06-03T08:00:00", takenBy: "Alice" },
				{ usage: 1, every: 1, start: "2026-06-03T20:00:00", takenBy: "Bob" },
			],
		});

		const createResponse = await app.inject({
			method: "POST",
			url: "/share",
			payload: { takenBy: "Bob", scheduleDays: 14, expiryDays: null, allowMarkTaken: true },
		});
		expect(createResponse.statusCode).toBe(200);
		const oldToken = createResponse.json().token as string;

		const shareRead = await app.inject({ method: "GET", url: `/share/${oldToken}` });
		expect(shareRead.statusCode).toBe(200);
		expect(shareRead.json()).toMatchObject({
			takenBy: "Bob",
			stockThresholds: { expiryWarningDays: 21 },
		});
		expect(shareRead.json().medications).toHaveLength(1);

		const regenerate = await app.inject({ method: "POST", url: `/share/${oldToken}/regenerate` });
		expect(regenerate.statusCode).toBe(200);
		const newToken = regenerate.json().token as string;
		expect(newToken).not.toBe(oldToken);

		const oldRead = await app.inject({ method: "GET", url: `/share/${oldToken}` });
		const newRead = await app.inject({ method: "GET", url: `/share/${newToken}` });
		expect(oldRead.statusCode).toBe(404);
		expect(newRead.statusCode).toBe(200);
	});

	it("preserves schedules, histories, thresholds, and regenerated shares through export/import roundtrip", async () => {
		await seedSettings({
			stockCalculationMode: "manual",
			timezone: "America/New_York",
			expiryWarningDays: 45,
			reminderDaysBefore: 5,
			lowStockDays: 12,
			shareMedicationOverview: true,
		});
		const medication = await createMedication(app, {
			name: "Roundtrip Domain Med",
			takenBy: ["Alice", "Bob"],
			looseTablets: 18,
			expiryDate: "2026-07-01",
			prescriptionEnabled: true,
			prescriptionAuthorizedRefills: 4,
			prescriptionRemainingRefills: 1,
			prescriptionLowRefillThreshold: 2,
			prescriptionExpiryDate: "2026-08-15",
			intakes: [
				{
					usage: 1,
					every: 1,
					start: "2026-06-01T08:00:00",
					scheduleMode: "weekdays",
					weekdays: ["mon", "wed", "fri"],
					takenBy: "Alice",
					intakeRemindersEnabled: true,
				},
				{ usage: 2, every: 3, start: "2026-06-02T20:00:00", takenBy: "Bob" },
			],
		});
		const trackedDoseId = doseId(medication.id, 0, "2026-06-01", "Alice");
		const doseTrackingId = await insertDose({
			doseId: trackedDoseId,
			takenAt: "2026-06-01T08:04:00.000Z",
			markedBy: "Alice",
		});
		await testClient.execute({
			sql: `INSERT INTO intake_journal (user_id, dose_tracking_id, medication_id, scheduled_for, note, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [
				1,
				doseTrackingId,
				medication.id,
				Math.floor(new Date("2026-06-01T00:00:00.000Z").getTime() / 1000),
				"Took after breakfast",
				Math.floor(new Date("2026-06-01T08:05:00.000Z").getTime() / 1000),
				Math.floor(new Date("2026-06-01T08:06:00.000Z").getTime() / 1000),
			],
		});
		await testClient.execute({
			sql: "INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date) VALUES (?, ?, ?, ?, ?, ?)",
			args: [medication.id, 1, 1, 4, 1, Math.floor(new Date("2026-05-30T10:00:00.000Z").getTime() / 1000)],
		});
		const shareResponse = await app.inject({
			method: "POST",
			url: "/share",
			payload: { takenBy: "Alice", scheduleDays: 14, expiryDays: null, allowJournalNotes: true, allowMarkTaken: true },
		});
		expect(shareResponse.statusCode).toBe(200);

		const beforeExport = await app.inject({ method: "GET", url: "/export?includeSensitive=false&includeImages=false" });
		expect(beforeExport.statusCode).toBe(200);
		const before = beforeExport.json();

		const importResponse = await app.inject({ method: "POST", url: "/import", payload: before });
		expect(importResponse.statusCode).toBe(200);
		expect(importResponse.json()).toMatchObject({
			success: true,
			imported: { medications: 1, doseHistory: 1, refillHistory: 1, settings: 1, shareLinks: 1 },
		});

		const afterExport = await app.inject({ method: "GET", url: "/export?includeSensitive=false&includeImages=false" });
		expect(afterExport.statusCode).toBe(200);
		const after = afterExport.json();

		const normalize = (payload: typeof before) => ({
			medications: payload.medications.map((med: Record<string, unknown>) => ({
				name: med.name,
				takenBy: med.takenBy,
				inventory: med.inventory,
				schedules: med.schedules,
				expiryDate: med.expiryDate,
				prescriptionEnabled: med.prescriptionEnabled,
				prescriptionRemainingRefills: med.prescriptionRemainingRefills,
				prescriptionLowRefillThreshold: med.prescriptionLowRefillThreshold,
				prescriptionExpiryDate: med.prescriptionExpiryDate,
			})),
			doseHistory: payload.doseHistory.map((dose: Record<string, unknown>) => ({
				scheduleIndex: dose.scheduleIndex,
				scheduledTime: dose.scheduledTime,
				takenAt: dose.takenAt,
				markedBy: dose.markedBy,
				takenByPerson: dose.takenByPerson,
				journalNote: dose.journalNote,
			})),
			refillHistory: payload.refillHistory.map((refill: Record<string, unknown>) => ({
				packsAdded: refill.packsAdded,
				loosePillsAdded: refill.loosePillsAdded,
				quantityAdded: refill.quantityAdded,
				usedPrescription: refill.usedPrescription,
				refillDate: refill.refillDate,
			})),
			settings: {
				timezone: payload.settings.timezone,
				reminderDaysBefore: payload.settings.reminderDaysBefore,
				lowStockDays: payload.settings.lowStockDays,
				expiryWarningDays: payload.settings.expiryWarningDays,
				stockCalculationMode: payload.settings.stockCalculationMode,
				shareMedicationOverview: payload.settings.shareMedicationOverview,
			},
			shareLinks: payload.shareLinks.map((share: Record<string, unknown>) => ({
				takenBy: share.takenBy,
				scheduleDays: share.scheduleDays,
				allowJournalNotes: share.allowJournalNotes,
				allowMarkTaken: share.allowMarkTaken,
				expiresAt: share.expiresAt,
				regenerateToken: share.regenerateToken,
			})),
		});

		expect(normalize(after)).toEqual(normalize(before));
	});

	it("uses the saved timezone override for reminder day bucketing", () => {
		expect(getEffectiveTimezone("America/New_York")).toBe("America/New_York");

		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-01T02:30:00.000Z"));

		expect(getTodayInTimezone("UTC")).toBe("2026-06-01");
		expect(getTodayInTimezone("America/New_York")).toBe("2026-05-31");
		vi.useRealTimers();
	});
});
