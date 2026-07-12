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
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { exportRoutes } = await import("../routes/export.js");
const { intakeJournalRoutes } = await import("../routes/intake-journal.js");

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
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

describe("Intake journal routes", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({ client: testClient });
		app = context.app;
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
