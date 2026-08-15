import { existsSync, unlinkSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, buildTestSessionCookie, closeTestApp, createTestUser } from "./setup.js";

const { testClient, testDb, testDbPath, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const dbPath = join(tmpdir(), `medassist-report-routes-${process.pid}-${Date.now()}.db`);
	const client = createClient({ url: `file:${dbPath}` });
	return {
		testClient: client,
		testDb: drizzle(client),
		testDbPath: dbPath,
		mockedEnv: {
			AUTH_ENABLED: true,
			REGISTRATION_ENABLED: true,
			FORM_LOGIN_ENABLED: true,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			PORT: 3000,
			CORS_ORIGINS: "*",
			JWT_SECRET: "test-jwt-secret",
			REFRESH_SECRET: "test-refresh-secret",
			COOKIE_SECRET: "test-cookie-secret",
			ACCESS_TOKEN_TTL_MINUTES: 15,
			REFRESH_TOKEN_TTL_DAYS: 7,
			OPENAPI_DOCS_ENABLED: false,
		},
	};
});

vi.mock("../db/client.js", () => ({ db: testDb, migrationsReady: Promise.resolve() }));
vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { reportRoutes } = await import("../routes/report.js");

const EVENT_A = "00000000-0000-4000-8000-000000000001";
const EVENT_B = "00000000-0000-4000-8000-000000000002";
const EVENT_C = "00000000-0000-4000-8000-000000000003";
const EVENT_D = "00000000-0000-4000-8000-000000000004";

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
	await testClient.execute("DELETE FROM as_needed_intake_events");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM api_keys");
	await testClient.execute("DELETE FROM refresh_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM users");
}

async function seedMedication(userId: number, name: string) {
	const start = "2026-02-01T08:00:00.000Z";
	const result = await testClient.execute({
		sql: `INSERT INTO medications (
		  user_id, name, generic_name, taken_by_json, medication_form, package_type,
		  pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
		  usage_json, every_json, start_json, intakes_json, stock_adjustment, intake_reminders_enabled
		) VALUES (?, ?, ?, '[]', 'tablet', 'blister', 1, 1, 10, 0, '[1]', '[1]', ?, ?, 0, 0) RETURNING id`,
		args: [
			userId,
			name,
			`${name} Generic`,
			start,
			JSON.stringify([{ usage: 1, every: 1, start, takenBy: null, intakeRemindersEnabled: false }]),
		],
	});
	return Number(result.rows[0].id);
}

async function seedAsNeededEvent(input: {
	userId: number;
	medicationId: number;
	eventId: string;
	occurredAt: string;
	recordedAt?: string;
	quantityMilli: number;
	quantityUnit: "pills" | "ml" | "application";
	person?: string;
	status?: "active" | "reversed";
	stockEffectMilli?: number;
	stockEffectReason?: "applied" | "non_measurable";
	replacesEventId?: number;
	revision?: number;
	journal?: { mood: "good" | "bad" | "neutral"; note: string };
}) {
	const occurredAt = new Date(input.occurredAt);
	const recordedAt = new Date(input.recordedAt ?? input.occurredAt);
	const anchor = await testClient.execute({
		sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at) VALUES (?, ?, ?) RETURNING id",
		args: [input.userId, `as-needed:${input.eventId}`, Math.floor(occurredAt.getTime() / 1000)],
	});
	const doseTrackingId = Number(anchor.rows[0].id);
	const event = await testClient.execute({
		sql: `INSERT INTO as_needed_intake_events (
		  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
		  occurred_at, recorded_at, quantity_milli, quantity_unit, person_name, status,
		  stock_effect_milli, stock_effect_reason, replaces_event_id, reversed_at, revision
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			input.eventId,
			input.userId,
			input.medicationId,
			doseTrackingId,
			input.eventId.replaceAll("-", "").padEnd(64, "0"),
			"f".repeat(64),
			Math.floor(occurredAt.getTime() / 1000),
			Math.floor(recordedAt.getTime() / 1000),
			input.quantityMilli,
			input.quantityUnit,
			input.person ?? "",
			input.status ?? "active",
			input.stockEffectMilli ?? input.quantityMilli,
			input.stockEffectReason ?? "applied",
			input.replacesEventId ?? null,
			input.status === "reversed" ? Math.floor(recordedAt.getTime() / 1000) : null,
			input.revision ?? 1,
		],
	});

	if (input.journal) {
		await testClient.execute({
			sql: `INSERT INTO intake_journal (
			  user_id, dose_tracking_id, medication_id, scheduled_for, mood, note, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				input.userId,
				doseTrackingId,
				input.medicationId,
				Math.floor(occurredAt.getTime() / 1000),
				input.journal.mood,
				input.journal.note,
				Math.floor(occurredAt.getTime() / 1000),
				Math.floor(occurredAt.getTime() / 1000),
			],
		});
	}

	return { id: Number(event.rows[0].id), doseTrackingId };
}

describe("Report route as-needed audit data", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({ client: testClient });
		app = context.app;
		await app.register(reportRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await closeTestApp({ app, db: testDb, client: testClient });
		for (const path of [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`]) {
			if (existsSync(path)) unlinkSync(path);
		}
	});

	beforeEach(async () => {
		await clearTables();
	});

	it("keeps active quantities and moods separate from reversed audit events with deterministic ordering", async () => {
		const ownerId = await createTestUser(testClient, { username: "report-audit-owner" });
		const otherId = await createTestUser(testClient, { username: "report-audit-other" });
		const cookie = await buildTestSessionCookie(app, ownerId, "report-audit-owner");
		const medicationId = await seedMedication(ownerId, "Audit medication");
		const otherMedicationId = await seedMedication(otherId, "Other medication");
		const replacementTarget = await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_A,
			occurredAt: "2026-02-01T08:00:00.000Z",
			quantityMilli: 1000,
			quantityUnit: "pills",
		});
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_B,
			occurredAt: "2026-02-10T09:00:00.000Z",
			recordedAt: "2026-02-20T09:00:00.000Z",
			quantityMilli: 2500,
			quantityUnit: "pills",
			person: "Alice",
			replacesEventId: replacementTarget.id,
			revision: 3,
			journal: { mood: "good", note: "Steady effect" },
		});
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_C,
			occurredAt: "2026-02-11T10:00:00.000Z",
			quantityMilli: 1000,
			quantityUnit: "ml",
			person: "Alice",
			status: "reversed",
			revision: 2,
			journal: { mood: "bad", note: "Reversed note" },
		});
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_D,
			occurredAt: "2026-02-11T10:00:00.000Z",
			quantityMilli: 2000,
			quantityUnit: "application",
			person: "Alice",
			stockEffectMilli: 0,
			stockEffectReason: "non_measurable",
		});
		await seedAsNeededEvent({
			userId: otherId,
			medicationId: otherMedicationId,
			eventId: "00000000-0000-4000-8000-000000000005",
			occurredAt: "2026-02-11T11:00:00.000Z",
			quantityMilli: 9000,
			quantityUnit: "pills",
			journal: { mood: "good", note: "Other owner note" },
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			headers: { cookie },
			payload: {
				medicationIds: [medicationId],
				startDate: "2026-02-10T00:00:00.000Z",
				endDate: "2026-02-12T00:00:00.000Z",
			},
		});
		expect(response.statusCode).toBe(200);
		const report = response.json()[medicationId];
		expect(report.asNeededIntakesTaken).toBe(2);
		expect(report.asNeededQuantityByUnit).toEqual({ pills: 2.5, application: 2 });
		expect(report.moodSummary).toMatchObject({ good: 1, bad: 0 });
		expect(report.asNeededIntakes.map((entry: { eventId: string }) => entry.eventId)).toEqual([
			EVENT_D,
			EVENT_C,
			EVENT_B,
		]);
		expect(report.asNeededIntakes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventId: EVENT_B,
					status: "active",
					occurredAt: "2026-02-10T09:00:00.000Z",
					recordedAt: "2026-02-20T09:00:00.000Z",
					person: "Alice",
					source: "owner_as_needed",
					stockEffect: 2.5,
					stockEffectReason: "applied",
					replacementForEventId: EVENT_A,
					revision: 3,
					mood: "good",
					note: "Steady effect",
				}),
				expect.objectContaining({
					eventId: EVENT_C,
					status: "reversed",
					stockEffect: 1,
					reversedAt: "2026-02-11T10:00:00.000Z",
					mood: "bad",
					note: "Reversed note",
				}),
				expect.objectContaining({ eventId: EVENT_D, stockEffect: 0, stockEffectReason: "non_measurable" }),
			])
		);
	});

	it("uses occurredAt with inclusive-start/exclusive-end and preserves scheduled report filtering", async () => {
		const ownerId = await createTestUser(testClient, { username: "report-filter-owner" });
		const cookie = await buildTestSessionCookie(app, ownerId, "report-filter-owner");
		const medicationId = await seedMedication(ownerId, "Filter medication");
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_A,
			occurredAt: "2026-02-10T00:00:00.000Z",
			recordedAt: "2026-03-01T00:00:00.000Z",
			quantityMilli: 1000,
			quantityUnit: "pills",
			person: " ALIce ",
		});
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_B,
			occurredAt: "2026-02-11T00:00:00.000Z",
			quantityMilli: 1000,
			quantityUnit: "pills",
			person: "Alice",
		});
		await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_C,
			occurredAt: "2026-02-10T12:00:00.000Z",
			quantityMilli: 1000,
			quantityUnit: "pills",
			person: "",
		});
		const scheduledDose = await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, 0) RETURNING id",
			args: [
				ownerId,
				`${medicationId}-0-${Date.parse("2026-02-10T08:00:00.000Z")}-Alice`,
				Math.floor(Date.parse("2026-02-10T08:05:00.000Z") / 1000),
			],
		});
		await testClient.execute({
			sql: `INSERT INTO intake_journal (user_id, dose_tracking_id, medication_id, scheduled_for, mood, note)
		      VALUES (?, ?, ?, ?, 'neutral', 'Scheduled snapshot')`,
			args: [
				ownerId,
				Number(scheduledDose.rows[0].id),
				medicationId,
				Math.floor(Date.parse("2026-02-10T08:00:00.000Z") / 1000),
			],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			headers: { cookie },
			payload: {
				medicationIds: [medicationId],
				startDate: "2026-02-10T00:00:00.000Z",
				endDate: "2026-02-11T00:00:00.000Z",
				takenByFilter: ["alice"],
			},
		});
		expect(response.statusCode).toBe(200);
		const report = response.json()[medicationId];
		expect(report.asNeededIntakesTaken).toBe(1);
		expect(report.asNeededIntakes).toEqual([expect.objectContaining({ eventId: EVENT_A, person: " ALIce " })]);
		expect(report.dosesTaken).toBe(1);
		expect(report.moodSummary).toMatchObject({ neutral: 1 });
		expect(report.journalEntries).toEqual([
			expect.objectContaining({
				scheduledFor: "2026-02-10T08:00:00.000Z",
				takenAt: "2026-02-10T08:05:00.000Z",
				dismissed: false,
				takenSource: "manual",
				takenByPerson: "Alice",
				mood: "neutral",
				note: "Scheduled snapshot",
			}),
		]);
	});
});
