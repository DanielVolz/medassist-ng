import { existsSync, unlinkSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, buildTestSessionCookie, closeTestApp, createTestUser } from "./setup.js";

const { testClient, testDb, testDbPath, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const dbPath = join(tmpdir(), `medassist-intake-journal-routes-${process.pid}-${Date.now()}.db`);
	const client = createClient({ url: `file:${dbPath}` });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
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
			PUBLIC_APP_URL: "https://app.example.com",
		},
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
	withImmediateWriteTransaction: async <T>(operation: (transactionDb: typeof testDb) => Promise<T>) =>
		testDb.transaction(operation),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { exportRoutes } = await import("../routes/export.js");
const { asNeededIntakeRoutes } = await import("../routes/as-needed-intakes.js");
const { intakeJournalRoutes } = await import("../routes/intake-journal.js");
const { hashApiKeyToken } = await import("../plugins/auth.js");

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
	await testClient.execute("DELETE FROM as_needed_intake_events");
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM api_keys");
	await testClient.execute("DELETE FROM refresh_tokens");
	await testClient.execute("DELETE FROM users");
}

async function seedMedication(options: { userId: number; name: string; start?: string; takenBy?: string[] }) {
	const start = options.start ?? "2026-02-01T08:00:00.000Z";
	const takenBy = options.takenBy ?? ["Daniel"];
	const result = await testClient.execute({
		sql: `INSERT INTO medications (
		  user_id, name, generic_name, taken_by_json, medication_form, package_type,
		  pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
		  usage_json, every_json, start_json, intakes_json,
		  stock_adjustment, intake_reminders_enabled
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			options.userId,
			options.name,
			`${options.name} Generic`,
			JSON.stringify(takenBy),
			"tablet",
			"blister",
			1,
			1,
			10,
			0,
			JSON.stringify([1]),
			JSON.stringify([1]),
			JSON.stringify([start]),
			JSON.stringify([
				{
					usage: 1,
					every: 1,
					start,
					takenBy: takenBy[0] ?? null,
					intakeRemindersEnabled: true,
				},
			]),
			0,
			1,
		],
	});

	return Number(result.rows[0].id);
}

async function seedTrackedDose(options: {
	userId: number;
	doseId: string;
	takenAt: Date;
	markedBy?: string | null;
	dismissed?: boolean;
}) {
	const result = await testClient.execute({
		sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, marked_by, taken_source, dismissed)
		      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			options.userId,
			options.doseId,
			Math.floor(options.takenAt.getTime() / 1000),
			options.markedBy ?? null,
			"manual",
			options.dismissed ? 1 : 0,
		],
	});

	return Number(result.rows[0].id);
}

async function seedAsNeededEvent(options: {
	userId: number;
	medicationId: number;
	eventId: string;
	occurredAt: string;
	journalScheduledFor?: string;
}) {
	const doseId = `as-needed:${options.eventId}`;
	const occurredAt = new Date(options.occurredAt);
	const idempotencyKeyHash = options.eventId.replaceAll("-", "").padEnd(64, "0");
	const anchorId = await seedTrackedDose({ userId: options.userId, doseId, takenAt: occurredAt });
	await testClient.execute({
		sql: `INSERT INTO as_needed_intake_events (
		  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
		  occurred_at, recorded_at, quantity_milli, quantity_unit, stock_effect_milli
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			options.eventId,
			options.userId,
			options.medicationId,
			anchorId,
			idempotencyKeyHash,
			HASH_B,
			Math.floor(occurredAt.getTime() / 1000),
			Math.floor(occurredAt.getTime() / 1000),
			1000,
			"pills",
			1000,
		],
	});

	if (options.journalScheduledFor) {
		await testClient.execute({
			sql: `INSERT INTO intake_journal (
			  user_id, dose_tracking_id, medication_id, scheduled_for, mood, note, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				options.userId,
				anchorId,
				options.medicationId,
				Math.floor(new Date(options.journalScheduledFor).getTime() / 1000),
				"neutral",
				"Seeded note",
				Math.floor(occurredAt.getTime() / 1000),
				Math.floor(occurredAt.getTime() / 1000),
			],
		});
	}

	return { anchorId, doseId };
}

async function insertReadOnlyApiKey(userId: number, token: string) {
	await testClient.execute({
		sql: `INSERT INTO api_keys (user_id, name, key_hash, token_prefix, scope, is_active)
		      VALUES (?, 'Read journal', ?, ?, 'read', 1)`,
		args: [userId, hashApiKeyToken(token), `${token.slice(0, 12)}...`],
	});
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const EVENT_A = "00000000-0000-4000-8000-000000000001";
const EVENT_B = "00000000-0000-4000-8000-000000000002";
const EVENT_C = "00000000-0000-4000-8000-000000000003";

function asNeededImportEvent(overrides: Record<string, unknown> = {}) {
	return {
		eventId: EVENT_A,
		medicationRef: "med-1",
		idempotencyKeyHash: HASH_A,
		requestFingerprint: HASH_B,
		occurredAt: "2026-02-05T08:00:00.000Z",
		recordedAt: "2026-02-05T08:01:00.000Z",
		quantityMilli: 1000,
		quantityUnit: "pills",
		person: null,
		source: "owner_as_needed",
		status: "active",
		stockEffectMilli: 1000,
		stockEffectReason: "applied",
		stockCutoffAt: null,
		replacementForEventId: null,
		reversedAt: null,
		reversalIdempotencyKeyHash: null,
		revision: 1,
		journalNote: null,
		journalMood: null,
		journalCreatedAt: null,
		journalUpdatedAt: null,
		...overrides,
	};
}

describe("Intake journal routes", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({ client: testClient });
		app = context.app;
		await app.register(asNeededIntakeRoutes);
		await app.register(intakeJournalRoutes);
		await app.register(exportRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await closeTestApp({ app, db: testDb, client: testClient });
		for (const path of [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`]) {
			if (existsSync(path)) {
				unlinkSync(path);
			}
		}
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		await clearTables();
	});

	it("keeps journal CRUD/history owner-scoped across route access", async () => {
		const ownerId = await createTestUser(testClient, { username: "journal-owner" });
		const otherId = await createTestUser(testClient, { username: "journal-other" });
		const ownerCookie = await buildTestSessionCookie(app, ownerId, "journal-owner");
		const otherCookie = await buildTestSessionCookie(app, otherId, "journal-other");

		const ownerStart = "2026-02-01T08:00:00.000Z";
		const otherStart = "2026-02-02T09:00:00.000Z";
		const ownerMedicationId = await seedMedication({ userId: ownerId, name: "Owner Med", start: ownerStart });
		const otherMedicationId = await seedMedication({ userId: otherId, name: "Other Med", start: otherStart });

		const ownerDoseId = `${ownerMedicationId}-0-${new Date(ownerStart).getTime()}-Daniel`;
		const otherDoseId = `${otherMedicationId}-0-${new Date(otherStart).getTime()}-Maria`;
		await seedTrackedDose({
			userId: ownerId,
			doseId: ownerDoseId,
			takenAt: new Date("2026-02-01T08:05:00.000Z"),
			markedBy: "Daniel",
		});
		await seedTrackedDose({
			userId: otherId,
			doseId: otherDoseId,
			takenAt: new Date("2026-02-02T09:05:00.000Z"),
			markedBy: "Maria",
		});

		const ownerPutResponse = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(ownerDoseId)}`,
			headers: { cookie: ownerCookie },
			payload: { note: "Took after breakfast.", mood: "good" },
		});

		expect(ownerPutResponse.statusCode).toBe(200);
		expect(ownerPutResponse.json().entry).toEqual(
			expect.objectContaining({
				doseId: ownerDoseId,
				medicationId: ownerMedicationId,
				scheduledFor: expect.stringContaining("T08:00:00"),
				mood: "good",
				note: "Took after breakfast.",
			})
		);

		const otherPutResponse = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(otherDoseId)}`,
			headers: { cookie: otherCookie },
			payload: { note: "Different owner note." },
		});

		expect(otherPutResponse.statusCode).toBe(200);

		const ownerHistoryResponse = await app.inject({
			method: "GET",
			url: `/intake-journal?medicationId=${ownerMedicationId}&limit=25`,
			headers: { cookie: ownerCookie },
		});

		expect(ownerHistoryResponse.statusCode).toBe(200);
		expect(ownerHistoryResponse.json().entries).toEqual([
			expect.objectContaining({
				doseId: ownerDoseId,
				medicationId: ownerMedicationId,
				mood: "good",
				note: "Took after breakfast.",
				markedBy: "Daniel",
			}),
		]);

		const moodOnlyResponse = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(ownerDoseId)}`,
			headers: { cookie: ownerCookie },
			payload: { note: "   ", mood: "neutral" },
		});

		expect(moodOnlyResponse.statusCode).toBe(200);
		expect(moodOnlyResponse.json().entry).toEqual(
			expect.objectContaining({
				doseId: ownerDoseId,
				mood: "neutral",
				note: "",
			})
		);

		const invalidMoodResponse = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(ownerDoseId)}`,
			headers: { cookie: ownerCookie },
			payload: { note: "Took after breakfast.", mood: "excellent" },
		});

		expect(invalidMoodResponse.statusCode).toBe(400);

		const otherEventResponse = await app.inject({
			method: "GET",
			url: `/intake-journal/event/${encodeURIComponent(otherDoseId)}`,
			headers: { cookie: ownerCookie },
		});

		expect(otherEventResponse.statusCode).toBe(404);
		expect(otherEventResponse.json()).toMatchObject({ code: "DOSE_NOT_FOUND" });

		const deleteResponse = await app.inject({
			method: "DELETE",
			url: `/intake-journal/event/${encodeURIComponent(ownerDoseId)}`,
			headers: { cookie: ownerCookie },
		});

		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toEqual({ success: true });

		const emptyHistoryResponse = await app.inject({
			method: "GET",
			url: "/intake-journal",
			headers: { cookie: ownerCookie },
		});

		expect(emptyHistoryResponse.statusCode).toBe(200);
		expect(emptyHistoryResponse.json().entries).toEqual([]);
	});

	it.skip("keeps scheduled DTOs stable while exposing owner-scoped as-needed journal events", async () => {
		const ownerId = await createTestUser(testClient, { username: "journal-as-needed-owner" });
		const otherId = await createTestUser(testClient, { username: "journal-as-needed-other" });
		const ownerCookie = await buildTestSessionCookie(app, ownerId, "journal-as-needed-owner");
		const medicationId = await seedMedication({ userId: ownerId, name: "As-needed journal medication" });
		const otherMedicationId = await seedMedication({ userId: otherId, name: "Other as-needed medication" });
		const scheduledDoseId = `${medicationId}-0-${new Date("2026-02-02T08:00:00.000Z").getTime()}-Daniel`;
		await seedTrackedDose({
			userId: ownerId,
			doseId: scheduledDoseId,
			takenAt: new Date("2026-02-02T08:05:00.000Z"),
			markedBy: "Daniel",
		});
		const { doseId } = await seedAsNeededEvent({
			userId: ownerId,
			medicationId,
			eventId: EVENT_A,
			occurredAt: "2026-02-03T09:15:00.000Z",
		});
		const { doseId: otherDoseId } = await seedAsNeededEvent({
			userId: otherId,
			medicationId: otherMedicationId,
			eventId: EVENT_B,
			occurredAt: "2026-02-03T10:15:00.000Z",
		});

		const scheduled = await app.inject({
			method: "GET",
			url: `/intake-journal/event/${encodeURIComponent(scheduledDoseId)}`,
			headers: { cookie: ownerCookie },
		});
		expect(scheduled.statusCode).toBe(200);
		expect(scheduled.json().entry).toMatchObject({
			eventType: "scheduled",
			eventId: null,
			scheduledFor: expect.stringContaining("T08:00:00"),
			occurredAt: null,
			status: "taken",
			takenSource: "manual",
		});

		const initial = await app.inject({
			method: "GET",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { cookie: ownerCookie },
		});
		expect(initial.statusCode).toBe(200);
		expect(initial.json().entry).toMatchObject({
			eventType: "as_needed",
			eventId: EVENT_A,
			scheduledFor: null,
			occurredAt: "2026-02-03T09:15:00.000Z",
			status: "active",
			takenSource: "owner_as_needed",
			markedBy: null,
			note: null,
			mood: null,
		});

		const saved = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { cookie: ownerCookie },
			payload: { note: "Used when needed.", mood: "good" },
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json().entry).toMatchObject({ eventType: "as_needed", scheduledFor: null, note: "Used when needed." });

		for (const inaccessibleDoseId of [otherDoseId, `as-needed:${EVENT_C}`]) {
			const response = await app.inject({
				method: "GET",
				url: `/intake-journal/event/${encodeURIComponent(inaccessibleDoseId)}`,
				headers: { cookie: ownerCookie },
			});
			expect(response.statusCode).toBe(404);
			expect(response.json()).toMatchObject({ code: "DOSE_NOT_FOUND" });
		}

		const apiToken = "ma_read_as_needed_journal_123456789";
		await insertReadOnlyApiKey(ownerId, apiToken);
		expect(
			(
				await app.inject({
					method: "GET",
					url: "/intake-journal",
					headers: { authorization: `Bearer ${apiToken}` },
				})
			).statusCode
		).toBe(200);
		const readOnlyMutation = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { authorization: `Bearer ${apiToken}` },
			payload: { note: "Must not be saved." },
		});
		expect(readOnlyMutation.statusCode).toBe(403);
		expect(readOnlyMutation.json()).toMatchObject({ code: "API_KEY_SCOPE_FORBIDDEN" });

		const reversed = await app.inject({
			method: "POST",
			url: `/as-needed-intakes/${EVENT_A}/reversal`,
			headers: { cookie: ownerCookie, "idempotency-key": "00000000-0000-4000-8000-000000000010" },
			payload: { expectedRevision: 1 },
		});
		expect(reversed.statusCode).toBe(200);

		const reversedRead = await app.inject({
			method: "GET",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { cookie: ownerCookie },
		});
		expect(reversedRead.statusCode).toBe(200);
		expect(reversedRead.json().entry).toMatchObject({ status: "reversed", note: "Used when needed." });

		for (const mutation of [
			{ method: "PUT", payload: { note: "Cannot alter reversed event." } },
			{ method: "DELETE" },
		] as const) {
			const response = await app.inject({
				method: mutation.method,
				url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
				headers: { cookie: ownerCookie },
				payload: mutation.payload,
			});
			expect(response.statusCode).toBe(409);
			expect(response.json()).toMatchObject({ code: "EVENT_REVERSED" });
		}
	});

	it("sorts and filters as-needed journal history by occurredAt rather than its journal timestamp", async () => {
		const userId = await createTestUser(testClient, { username: "journal-history-time" });
		const cookie = await buildTestSessionCookie(app, userId, "journal-history-time");
		const medicationId = await seedMedication({ userId, name: "History timing medication" });
		const first = await seedAsNeededEvent({
			userId,
			medicationId,
			eventId: EVENT_A,
			occurredAt: "2026-02-10T09:00:00.000Z",
			journalScheduledFor: "2026-01-01T09:00:00.000Z",
		});
		const second = await seedAsNeededEvent({
			userId,
			medicationId,
			eventId: EVENT_B,
			occurredAt: "2026-02-11T09:00:00.000Z",
			journalScheduledFor: "2026-01-02T09:00:00.000Z",
		});

		const response = await app.inject({
			method: "GET",
			url: "/intake-journal?from=2026-02-10T00:00:00.000Z&to=2026-02-10T23:59:59.999Z",
			headers: { cookie },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().entries).toEqual([
			expect.objectContaining({ doseId: first.doseId, occurredAt: "2026-02-10T09:00:00.000Z", scheduledFor: null }),
		]);

		const all = await app.inject({ method: "GET", url: "/intake-journal", headers: { cookie } });
		expect(all.statusCode).toBe(200);
		expect(all.json().entries.map((entry: { doseId: string }) => entry.doseId)).toEqual([second.doseId, first.doseId]);
	});

	it.skip("keeps legacy reversal journal race coverage out of the public Undo contract", async () => {
		const userId = await createTestUser(testClient, { username: "journal-reversal-race" });
		const cookie = await buildTestSessionCookie(app, userId, "journal-reversal-race");
		const medicationId = await seedMedication({ userId, name: "Reversal race medication" });
		const { doseId } = await seedAsNeededEvent({
			userId,
			medicationId,
			eventId: EVENT_C,
			occurredAt: "2026-02-12T09:00:00.000Z",
		});

		const [journalUpdate, reversal] = await Promise.all([
			app.inject({
				method: "PUT",
				url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
				headers: { cookie },
				payload: { note: "Race-safe note" },
			}),
			app.inject({
				method: "POST",
				url: `/as-needed-intakes/${EVENT_C}/reversal`,
				headers: { cookie, "idempotency-key": "00000000-0000-4000-8000-000000000011" },
				payload: { expectedRevision: 1 },
			}),
		]);

		expect(reversal.statusCode).toBe(200);
		expect([200, 409]).toContain(journalUpdate.statusCode);
		if (journalUpdate.statusCode === 409) {
			expect(journalUpdate.json()).toMatchObject({ code: "EVENT_REVERSED" });
		}

		const afterRace = await app.inject({
			method: "GET",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { cookie },
		});
		expect(afterRace.statusCode).toBe(200);
		expect(afterRace.json().entry).toMatchObject({ eventType: "as_needed", status: "reversed" });

		const laterUpdate = await app.inject({
			method: "PUT",
			url: `/intake-journal/event/${encodeURIComponent(doseId)}`,
			headers: { cookie },
			payload: { note: "Cannot cross reversal boundary" },
		});
		expect(laterUpdate.statusCode).toBe(409);
		expect(laterUpdate.json()).toMatchObject({ code: "EVENT_REVERSED" });
	});

	it("exports owner as-needed events in v1.9 without leaking anchors into scheduled history", async () => {
		const userId = await createTestUser(testClient, { username: "as-needed-export-owner" });
		const otherUserId = await createTestUser(testClient, { username: "as-needed-export-other" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "as-needed-export-owner");
		const medicationId = await seedMedication({ userId, name: "As-needed export medication" });
		await testClient.execute({
			sql: "UPDATE medications SET last_stock_correction_at = ? WHERE id = ?",
			args: [1770282300, medicationId],
		});
		const otherMedicationId = await seedMedication({ userId: otherUserId, name: "Other owner medication" });
		const scheduledFor = "2026-02-05T07:00:00.000Z";
		await seedTrackedDose({
			userId,
			doseId: `${medicationId}-0-${new Date(scheduledFor).getTime()}-Daniel`,
			takenAt: new Date("2026-02-05T07:02:00.000Z"),
			markedBy: "Daniel",
		});
		const firstAnchorId = await seedTrackedDose({
			userId,
			doseId: `as-needed:${EVENT_A}`,
			takenAt: new Date("2026-02-05T08:01:00.000Z"),
			markedBy: "Daniel",
		});
		const replacementAnchorId = await seedTrackedDose({
			userId,
			doseId: `as-needed:${EVENT_B}`,
			takenAt: new Date("2026-02-05T09:01:00.000Z"),
		});
		const otherAnchorId = await seedTrackedDose({
			userId: otherUserId,
			doseId: `as-needed:${EVENT_C}`,
			takenAt: new Date("2026-02-05T10:01:00.000Z"),
		});

		const firstEvent = await testClient.execute({
			sql: `INSERT INTO as_needed_intake_events (
			  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
			  occurred_at, recorded_at, quantity_milli, quantity_unit, person_name, status, stock_effect_milli,
			  stock_effect_reason, stock_cutoff_at, reversed_at, reversal_idempotency_key_hash, revision
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			args: [
				EVENT_A,
				userId,
				medicationId,
				firstAnchorId,
				HASH_A,
				HASH_B,
				1770278400,
				1770278460,
				1500,
				"pills",
				"Daniel",
				"reversed",
				1500,
				"applied",
				0,
				1770279000,
				HASH_C,
				2,
			],
		});
		const firstEventId = Number(firstEvent.rows[0].id);
		await testClient.execute({
			sql: `INSERT INTO as_needed_intake_events (
			  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
			  occurred_at, recorded_at, quantity_milli, quantity_unit, person_name, stock_effect_milli,
			  stock_effect_reason, stock_cutoff_at, replaces_event_id, revision
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				EVENT_B,
				userId,
				medicationId,
				replacementAnchorId,
				HASH_B,
				HASH_C,
				1770282000,
				1770282060,
				1000,
				"pills",
				"",
				0,
				"before_correction",
				1770282300,
				firstEventId,
				3,
			],
		});
		await testClient.execute({
			sql: `INSERT INTO as_needed_intake_events (
			  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
			  occurred_at, recorded_at, quantity_milli, quantity_unit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				EVENT_C,
				otherUserId,
				otherMedicationId,
				otherAnchorId,
				HASH_C,
				HASH_A,
				1770285600,
				1770285660,
				1000,
				"pills",
			],
		});
		await testClient.execute({
			sql: `INSERT INTO intake_journal (
			  user_id, dose_tracking_id, medication_id, scheduled_for, mood, note, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				userId,
				replacementAnchorId,
				medicationId,
				1770282000,
				"neutral",
				"Replacement note",
				1770282100,
				1770282200,
			],
		});

		const response = await app.inject({ method: "GET", url: "/export", headers: { cookie: sessionCookie } });

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.version).toBe("1.9");
		expect(body.doseHistory).toHaveLength(1);
		expect(body.doseHistory[0]).toEqual(expect.objectContaining({ medicationRef: "med-1", takenByPerson: "Daniel" }));
		expect(body.asNeededIntakes).toEqual([
			{
				eventId: EVENT_A,
				medicationRef: "med-1",
				idempotencyKeyHash: HASH_A,
				requestFingerprint: HASH_B,
				occurredAt: "2026-02-05T08:00:00.000Z",
				recordedAt: "2026-02-05T08:01:00.000Z",
				quantityMilli: 1500,
				quantityUnit: "pills",
				person: "Daniel",
				source: "owner_as_needed",
				status: "reversed",
				stockEffectMilli: 1500,
				stockEffectReason: "applied",
				stockCutoffAt: null,
				replacementForEventId: null,
				reversedAt: "2026-02-05T08:10:00.000Z",
				reversalIdempotencyKeyHash: HASH_C,
				revision: 2,
				journalNote: null,
				journalMood: null,
				journalCreatedAt: null,
				journalUpdatedAt: null,
			},
			{
				eventId: EVENT_B,
				medicationRef: "med-1",
				idempotencyKeyHash: HASH_B,
				requestFingerprint: HASH_C,
				occurredAt: "2026-02-05T09:00:00.000Z",
				recordedAt: "2026-02-05T09:01:00.000Z",
				quantityMilli: 1000,
				quantityUnit: "pills",
				person: null,
				source: "owner_as_needed",
				status: "active",
				stockEffectMilli: 0,
				stockEffectReason: "before_correction",
				stockCutoffAt: "2026-02-05T09:05:00.000Z",
				replacementForEventId: EVENT_A,
				reversedAt: null,
				reversalIdempotencyKeyHash: null,
				revision: 3,
				journalNote: "Replacement note",
				journalMood: "neutral",
				journalCreatedAt: "2026-02-05T09:01:40.000Z",
				journalUpdatedAt: "2026-02-05T09:03:20.000Z",
			},
		]);

		const restored = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: body,
		});
		expect(restored.statusCode).toBe(200);
		expect(restored.json().imported).toEqual(
			expect.objectContaining({ medications: 1, doseHistory: 1, asNeededIntakes: 2 })
		);

		const reExport = await app.inject({ method: "GET", url: "/export", headers: { cookie: sessionCookie } });
		expect(reExport.statusCode).toBe(200);
		expect(reExport.json().doseHistory).toEqual(body.doseHistory);
		expect(reExport.json().asNeededIntakes).toEqual(body.asNeededIntakes);

		const repeatedRestore = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: body,
		});
		expect(repeatedRestore.statusCode).toBe(200);
		const [events, anchors, stockEffect] = await Promise.all([
			testClient.execute("SELECT event_id FROM as_needed_intake_events WHERE user_id = ? ORDER BY event_id", [userId]),
			testClient.execute("SELECT dose_id FROM dose_tracking WHERE user_id = ? AND dose_id LIKE 'as-needed:%'", [
				userId,
			]),
			testClient.execute(
				"SELECT coalesce(sum(stock_effect_milli), 0) AS total FROM as_needed_intake_events WHERE user_id = ?",
				[userId]
			),
		]);
		expect(events.rows).toEqual([
			expect.objectContaining({ event_id: EVENT_A }),
			expect.objectContaining({ event_id: EVENT_B }),
		]);
		expect(anchors.rows).toHaveLength(2);
		expect(stockEffect.rows[0].total).toBe(1500);
	});

	it("requires asNeededIntakes for v1.9 while keeping empty v1.9 and older imports compatible", async () => {
		const userId = await createTestUser(testClient, { username: "as-needed-import-compatibility" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "as-needed-import-compatibility");
		const basePayload = { exportedAt: "2026-02-05T08:00:00.000Z", medications: [], doseHistory: [] };

		const missingV19 = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: { ...basePayload, version: "1.9" },
		});
		expect(missingV19.statusCode).toBe(400);

		const emptyV19 = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: { ...basePayload, version: "1.9", asNeededIntakes: [] },
		});
		expect(emptyV19.statusCode).toBe(200);
		expect(emptyV19.json().imported).toEqual(expect.objectContaining({ asNeededIntakes: 0 }));

		const olderImport = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: { ...basePayload, version: "1.8" },
		});
		expect(olderImport.statusCode).toBe(200);
		expect(olderImport.json().imported).toEqual(expect.objectContaining({ asNeededIntakes: 0 }));
	});

	it("rejects invalid nonempty v1.9 restores before changing data", async () => {
		const userId = await createTestUser(testClient, { username: "as-needed-import-rejection" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "as-needed-import-rejection");
		const medicationId = await seedMedication({ userId, name: "Existing import medication" });
		const anchorId = await seedTrackedDose({
			userId,
			doseId: `as-needed:${EVENT_A}`,
			takenAt: new Date("2026-02-05T08:01:00.000Z"),
		});
		await testClient.execute({
			sql: `INSERT INTO as_needed_intake_events (
			  event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint,
			  occurred_at, recorded_at, quantity_milli, quantity_unit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [EVENT_A, userId, medicationId, anchorId, HASH_A, HASH_B, 1770278400, 1770278460, 1000, "pills"],
		});

		const payload = {
			version: "1.9",
			exportedAt: "2026-02-05T08:00:00.000Z",
			medications: [],
			doseHistory: [],
			asNeededIntakes: [asNeededImportEvent({ journalNote: "Imported journal", journalMood: "good" })],
		};
		const preview = await app.inject({
			method: "POST",
			url: "/import/preview",
			headers: { cookie: sessionCookie },
			payload,
		});
		expect(preview.statusCode).toBe(400);
		expect(preview.json()).toEqual(expect.objectContaining({ code: "INVALID_IMPORT_DATA" }));

		const rejectedImport = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload,
		});
		expect(rejectedImport.statusCode).toBe(400);
		expect(rejectedImport.json()).toEqual(expect.objectContaining({ code: "INVALID_IMPORT_DATA" }));

		const [medicationRows, eventRows, doseRows] = await Promise.all([
			testClient.execute("SELECT name FROM medications WHERE user_id = ?", [userId]),
			testClient.execute("SELECT event_id FROM as_needed_intake_events WHERE user_id = ?", [userId]),
			testClient.execute("SELECT dose_id FROM dose_tracking WHERE user_id = ?", [userId]),
		]);
		expect(medicationRows.rows).toEqual([expect.objectContaining({ name: "Existing import medication" })]);
		expect(eventRows.rows).toEqual([expect.objectContaining({ event_id: EVENT_A })]);
		expect(doseRows.rows).toEqual([expect.objectContaining({ dose_id: `as-needed:${EVENT_A}` })]);
	});

	it("bounds invalid as-needed import graphs and leaves existing rows untouched", async () => {
		const userId = await createTestUser(testClient, { username: "as-needed-import-matrix" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "as-needed-import-matrix");
		const medicationId = await seedMedication({ userId, name: "Unchanged import medication" });
		const baseMedication = {
			_exportId: "med-1",
			name: "Imported tablet",
			medicationForm: "tablet",
			inventory: { packCount: 0, blistersPerPack: 1, pillsPerBlister: 1, looseTablets: 5, packageType: "blister" },
			schedules: [],
		};
		const payloadFor = (asNeededIntakes: Record<string, unknown>[], medication = baseMedication) => ({
			version: "1.9",
			exportedAt: "2026-02-05T08:00:00.000Z",
			medications: [medication],
			doseHistory: [],
			asNeededIntakes,
		});
		const reversedEvent = asNeededImportEvent({
			status: "reversed",
			reversedAt: "2026-02-05T08:02:00.000Z",
			reversalIdempotencyKeyHash: HASH_C,
			revision: 2,
		});
		const matrix = [
			payloadFor([asNeededImportEvent(), asNeededImportEvent()]),
			payloadFor([asNeededImportEvent(), asNeededImportEvent({ eventId: EVENT_B, requestFingerprint: HASH_A })]),
			payloadFor([asNeededImportEvent({ replacementForEventId: EVENT_B })]),
			payloadFor([asNeededImportEvent({ replacementForEventId: EVENT_A })]),
			payloadFor([asNeededImportEvent({ reversalIdempotencyKeyHash: HASH_C })]),
			payloadFor([asNeededImportEvent({ person: " Daniel " })]),
			payloadFor([asNeededImportEvent({ stockEffectMilli: 0 })]),
			payloadFor([asNeededImportEvent({ journalMood: "good" })]),
			payloadFor([asNeededImportEvent({ idempotencyKeyHash: "not-a-hash" })]),
			payloadFor([asNeededImportEvent({ occurredAt: "2026-02-05T08:00:00.500Z" })]),
			payloadFor([asNeededImportEvent({ stockEffectReason: "before_correction", stockEffectMilli: 0 })]),
			payloadFor([asNeededImportEvent()], {
				...baseMedication,
				medicationForm: "liquid",
				inventory: { ...baseMedication.inventory, packageType: "liquid_container" },
			}),
			{
				version: "1.9",
				exportedAt: "2026-02-05T08:00:00.000Z",
				medications: [baseMedication, { ...baseMedication, _exportId: "med-2", name: "Imported tablet two" }],
				doseHistory: [],
				asNeededIntakes: [
					reversedEvent,
					asNeededImportEvent({
						eventId: EVENT_B,
						medicationRef: "med-2",
						idempotencyKeyHash: HASH_B,
						requestFingerprint: HASH_C,
						occurredAt: "2026-02-05T08:03:00.000Z",
						recordedAt: "2026-02-05T08:04:00.000Z",
						replacementForEventId: EVENT_A,
					}),
				],
			},
		];

		for (const payload of matrix) {
			const response = await app.inject({
				method: "POST",
				url: "/import",
				headers: { cookie: sessionCookie },
				payload,
			});
			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual(
				expect.objectContaining({
					code: "INVALID_IMPORT_DATA",
					details: expect.objectContaining({ _errors: expect.any(Array) }),
				})
			);
			expect(response.json().details._errors.length).toBeLessThanOrEqual(10);
		}

		const rows = await testClient.execute("SELECT id, name FROM medications WHERE user_id = ?", [userId]);
		expect(rows.rows).toEqual([expect.objectContaining({ id: medicationId, name: "Unchanged import medication" })]);
	});

	it("preserves journal metadata through authenticated export and import", async () => {
		const userId = await createTestUser(testClient, { username: "journal-roundtrip" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "journal-roundtrip");
		const start = "2026-02-03T07:30:00.000Z";
		const medicationId = await seedMedication({
			userId,
			name: "Roundtrip Journal Med",
			start,
			takenBy: ["Daniel-Volz"],
		});
		const doseId = `${medicationId}-0-${new Date(start).getTime()}-Daniel-Volz`;
		const doseTrackingId = await seedTrackedDose({
			userId,
			doseId,
			takenAt: new Date("2026-02-03T07:33:00.000Z"),
			markedBy: "Daniel-Volz",
		});

		const createdAt = new Date("2026-02-03T07:40:00.000Z");
		const updatedAt = new Date("2026-02-03T07:50:00.000Z");
		await testClient.execute({
			sql: `INSERT INTO intake_journal (
			  user_id, dose_tracking_id, medication_id, scheduled_for, mood, note, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				userId,
				doseTrackingId,
				medicationId,
				Math.floor(new Date(start).getTime() / 1000),
				"good",
				"Roundtrip journal note",
				Math.floor(createdAt.getTime() / 1000),
				Math.floor(updatedAt.getTime() / 1000),
			],
		});

		const exportResponse = await app.inject({
			method: "GET",
			url: "/export",
			headers: { cookie: sessionCookie },
		});

		expect(exportResponse.statusCode).toBe(200);
		const exportBody = exportResponse.json();
		expect(exportBody.doseHistory).toHaveLength(1);
		expect(exportBody.doseHistory[0]).toEqual(
			expect.objectContaining({
				scheduleIndex: 0,
				takenByPerson: "Daniel-Volz",
				journalNote: "Roundtrip journal note",
				journalMood: "good",
				journalCreatedAt: createdAt.toISOString(),
				journalUpdatedAt: updatedAt.toISOString(),
			})
		);

		const importResponse = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: exportBody,
		});

		expect(importResponse.statusCode).toBe(200);

		const reExportResponse = await app.inject({
			method: "GET",
			url: "/export",
			headers: { cookie: sessionCookie },
		});

		expect(reExportResponse.statusCode).toBe(200);
		expect(reExportResponse.json().doseHistory).toEqual([
			expect.objectContaining({
				scheduleIndex: 0,
				takenByPerson: "Daniel-Volz",
				journalNote: "Roundtrip journal note",
				journalMood: "good",
				journalCreatedAt: createdAt.toISOString(),
				journalUpdatedAt: updatedAt.toISOString(),
			}),
		]);

		const restoredJournalRows = await testClient.execute({
			sql: "SELECT note, mood FROM intake_journal WHERE user_id = ?",
			args: [userId],
		});

		expect(restoredJournalRows.rows).toHaveLength(1);
		expect(restoredJournalRows.rows[0].note).toBe("Roundtrip journal note");
		expect(restoredJournalRows.rows[0].mood).toBe("good");
	});

	it("preserves the shared journal-note permission through authenticated export and import", async () => {
		const userId = await createTestUser(testClient, { username: "share-journal-roundtrip" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "share-journal-roundtrip");

		await testClient.execute({
			sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, allow_journal_notes, expires_at)
			      VALUES (?, ?, ?, ?, ?, ?)`,
			args: [userId, "share-journal-token", "Daniel", 14, 1, null],
		});

		const exportResponse = await app.inject({
			method: "GET",
			url: "/export?includeSensitive=true",
			headers: { cookie: sessionCookie },
		});

		expect(exportResponse.statusCode).toBe(200);
		const exportBody = exportResponse.json();
		expect(exportBody.shareLinks).toEqual([
			expect.objectContaining({
				takenBy: "Daniel",
				scheduleDays: 14,
				allowJournalNotes: true,
				regenerateToken: true,
			}),
		]);

		const importResponse = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: exportBody,
		});

		expect(importResponse.statusCode).toBe(200);

		const shareRows = await testClient.execute({
			sql: "SELECT token, taken_by, schedule_days, allow_journal_notes FROM share_tokens WHERE user_id = ?",
			args: [userId],
		});

		expect(shareRows.rows).toHaveLength(1);
		expect(shareRows.rows[0]).toEqual(
			expect.objectContaining({
				taken_by: "Daniel",
				schedule_days: 14,
				allow_journal_notes: 1,
			})
		);
		expect(shareRows.rows[0].token).not.toBe("share-journal-token");
	});

	it("keeps existing data when image import fails inside the replacement transaction", async () => {
		const userId = await createTestUser(testClient, { username: "import-rollback" });
		const sessionCookie = await buildTestSessionCookie(app, userId, "import-rollback");
		await seedMedication({ userId, name: "Existing Rollback Med" });

		const importResponse = await app.inject({
			method: "POST",
			url: "/import",
			headers: { cookie: sessionCookie },
			payload: {
				version: "1.6",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Imported Rollback Med",
						inventory: { packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, looseTablets: 0 },
						schedules: [{ usage: 1, every: 1, start: "2026-02-04T08:00:00.000Z" }],
						image: "data:image/png;base64,not-valid",
					},
				],
				doseHistory: [
					{
						medicationRef: "med-1",
						scheduleIndex: 0,
						scheduledTime: "2026-02-04T08:00:00.000Z",
						takenAt: "2026-02-04T08:03:00.000Z",
					},
				],
			},
		});

		expect(importResponse.statusCode).toBe(400);

		const medicationRows = await testClient.execute({
			sql: "SELECT name FROM medications WHERE user_id = ? ORDER BY name",
			args: [userId],
		});

		expect(medicationRows.rows).toEqual([expect.objectContaining({ name: "Existing Rollback Med" })]);
	});
});
