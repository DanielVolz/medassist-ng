import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, closeTestApp } from "./setup.js";

const { testClient, testDb, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
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

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { medicationRoutes } = await import("../routes/medications.js");
const { doseRoutes } = await import("../routes/doses.js");
const { refillRoutes } = await import("../routes/refills.js");
const { shareRoutes } = await import("../routes/share.js");
const { reportRoutes } = await import("../routes/report.js");
const { exportRoutes } = await import("../routes/export.js");
const { hashApiKeyToken } = await import("../plugins/auth.js");

async function clearTables() {
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM api_keys");
	await testClient.execute("DELETE FROM refresh_tokens");
	await testClient.execute("DELETE FROM users");
}

async function createUser(username: string) {
	const result = await testClient.execute({
		sql: "INSERT INTO users (username, auth_provider, is_active) VALUES (?, 'local', 1) RETURNING id",
		args: [username],
	});

	return Number(result.rows[0].id);
}

async function buildSessionCookie(app: FastifyInstance, userId: number, username: string) {
	const token = await app.jwt.sign({ sub: userId, username });
	return `access_token=${token}`;
}

async function insertApiKey(options: {
	userId: number;
	token: string;
	scope?: "read" | "write";
	isActive?: boolean;
	expiresAt?: Date | null;
}) {
	const expiresAtValue = options.expiresAt ? Math.floor(options.expiresAt.getTime() / 1000) : null;

	await testClient.execute({
		sql: `INSERT INTO api_keys (user_id, name, key_hash, token_prefix, scope, is_active, expires_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		args: [
			options.userId,
			"Seeded Key",
			hashApiKeyToken(options.token),
			`${options.token.slice(0, 12)}...`,
			options.scope ?? "write",
			options.isActive === false ? 0 : 1,
			expiresAtValue,
		],
	});
}

async function seedMedication(options: {
	userId: number;
	name: string;
	takenBy?: string[];
	packCount?: number;
	looseTablets?: number;
	start?: string;
}) {
	const start = options.start ?? "2026-01-01T08:00:00.000Z";
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
			options.packCount ?? 1,
			1,
			10,
			options.looseTablets ?? 0,
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

async function seedDose(options: { userId: number; doseId: string; dismissed?: boolean }) {
	await testClient.execute({
		sql: "INSERT INTO dose_tracking (user_id, dose_id, dismissed) VALUES (?, ?, ?)",
		args: [options.userId, options.doseId, options.dismissed ? 1 : 0],
	});
}

async function seedRefill(options: {
	userId: number;
	medicationId: number;
	packsAdded?: number;
	loosePillsAdded?: number;
}) {
	await testClient.execute({
		sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription)
		      VALUES (?, ?, ?, ?, 0)`,
		args: [options.medicationId, options.userId, options.packsAdded ?? 1, options.loosePillsAdded ?? 0],
	});
}

function buildMedicationPayload(name: string) {
	return {
		name,
		genericName: `${name} Generic`,
		takenBy: ["Daniel"],
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 0,
		blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z" }],
	};
}

function buildImportPayload() {
	return {
		version: "1.3",
		exportedAt: new Date().toISOString(),
		includeSensitiveData: false,
		medications: [],
		doseHistory: [],
		refillHistory: [],
		settings: {
			emailEnabled: false,
			emailStockReminders: true,
			emailIntakeReminders: true,
			emailPrescriptionReminders: true,
			shoutrrrStockReminders: true,
			shoutrrrIntakeReminders: true,
			shoutrrrPrescriptionReminders: true,
			reminderDaysBefore: 7,
			repeatDailyReminders: false,
			skipRemindersForTakenDoses: false,
			repeatRemindersEnabled: false,
			reminderRepeatIntervalMinutes: 30,
			maxNaggingReminders: 5,
			lowStockDays: 30,
			normalStockDays: 90,
			highStockDays: 180,
			language: "en",
			stockCalculationMode: "automatic",
			shareStockStatus: true,
		},
		shareLinks: [],
	};
}

describe("Real business route authz contracts", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({ client: testClient });
		app = context.app;
		await app.register(medicationRoutes);
		await app.register(doseRoutes);
		await app.register(refillRoutes);
		await app.register(shareRoutes);
		await app.register(reportRoutes);
		await app.register(exportRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await closeTestApp({ app, db: testDb, client: testClient });
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		await clearTables();
	});

	it("rejects protected business endpoints without authentication", async () => {
		const endpoints: Array<{
			method: "GET" | "POST";
			url: string;
			payload?: Record<string, unknown>;
		}> = [
			{ method: "GET", url: "/medications" },
			{ method: "GET", url: "/doses/taken" },
			{ method: "POST", url: "/share", payload: { takenBy: "Daniel", scheduleDays: 7 } },
			{ method: "GET", url: "/export" },
			{ method: "POST", url: "/medications/report-data", payload: { medicationIds: [1] } },
			{ method: "POST", url: "/medications/1/refill", payload: { packsAdded: 1, loosePillsAdded: 0 } },
		];

		for (const endpoint of endpoints) {
			const response = await app.inject({ method: endpoint.method, url: endpoint.url, payload: endpoint.payload });
			expect(response.statusCode, `${endpoint.method} ${endpoint.url}`).toBe(401);
			expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
		}
	});

	it("scopes medication listing and export output to the authenticated user", async () => {
		const ownerId = await createUser("owner-medications");
		const otherId = await createUser("other-medications");
		const ownerCookie = await buildSessionCookie(app, ownerId, "owner-medications");

		await seedMedication({ userId: ownerId, name: "Owner Only Med" });
		await seedMedication({ userId: otherId, name: "Other User Med" });

		const listResponse = await app.inject({
			method: "GET",
			url: "/medications",
			headers: { cookie: ownerCookie },
		});

		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.body).toContain("Owner Only Med");
		expect(listResponse.body).not.toContain("Other User Med");

		const exportResponse = await app.inject({
			method: "GET",
			url: "/export",
			headers: { cookie: ownerCookie },
		});

		expect(exportResponse.statusCode).toBe(200);
		expect(exportResponse.body).toContain("Owner Only Med");
		expect(exportResponse.body).not.toContain("Other User Med");
	});

	it("returns 404 when a user updates or deletes another user's medication", async () => {
		const ownerId = await createUser("owner-update");
		const otherId = await createUser("other-update");
		const otherCookie = await buildSessionCookie(app, otherId, "other-update");
		const medicationId = await seedMedication({ userId: ownerId, name: "Protected Medication" });

		const updateResponse = await app.inject({
			method: "PUT",
			url: `/medications/${medicationId}`,
			headers: { cookie: otherCookie },
			payload: buildMedicationPayload("Updated By Stranger"),
		});

		expect(updateResponse.statusCode).toBe(404);

		const deleteResponse = await app.inject({
			method: "DELETE",
			url: `/medications/${medicationId}`,
			headers: { cookie: otherCookie },
		});

		expect(deleteResponse.statusCode).toBe(404);

		const dbState = await testClient.execute({
			sql: "SELECT name FROM medications WHERE id = ?",
			args: [medicationId],
		});
		expect(dbState.rows).toEqual([expect.objectContaining({ name: "Protected Medication" })]);
	});

	it("scopes dose reads and writes to the authenticated user", async () => {
		const ownerId = await createUser("owner-dose");
		const otherId = await createUser("other-dose");
		const ownerCookie = await buildSessionCookie(app, ownerId, "owner-dose");
		const otherCookie = await buildSessionCookie(app, otherId, "other-dose");

		await seedDose({ userId: ownerId, doseId: "101-0-1760000000000" });
		await seedDose({ userId: otherId, doseId: "202-0-1760000000000" });

		const listResponse = await app.inject({
			method: "GET",
			url: "/doses/taken",
			headers: { cookie: ownerCookie },
		});

		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.body).toContain("101-0-1760000000000");
		expect(listResponse.body).not.toContain("202-0-1760000000000");

		const deleteResponse = await app.inject({
			method: "DELETE",
			url: "/doses/taken/101-0-1760000000000",
			headers: { cookie: otherCookie },
		});

		expect(deleteResponse.statusCode).toBe(200);

		const ownerDose = await testClient.execute({
			sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
			args: [ownerId, "101-0-1760000000000"],
		});
		expect(Number(ownerDose.rows[0].count)).toBe(1);
	});

	it("enforces medication ownership on refill history and report generation", async () => {
		const ownerId = await createUser("owner-refill");
		const otherId = await createUser("other-refill");
		const otherCookie = await buildSessionCookie(app, otherId, "other-refill");
		const medicationId = await seedMedication({ userId: ownerId, name: "Owner Refill Med", packCount: 2 });
		await seedRefill({ userId: ownerId, medicationId });

		const refillListResponse = await app.inject({
			method: "GET",
			url: `/medications/${medicationId}/refills`,
			headers: { cookie: otherCookie },
		});

		expect(refillListResponse.statusCode).toBe(404);

		const refillMutationResponse = await app.inject({
			method: "POST",
			url: `/medications/${medicationId}/refill`,
			headers: { cookie: otherCookie },
			payload: { packsAdded: 1, loosePillsAdded: 0 },
		});

		expect(refillMutationResponse.statusCode).toBe(404);

		const reportResponse = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			headers: { cookie: otherCookie },
			payload: { medicationIds: [medicationId] },
		});

		expect(reportResponse.statusCode).toBe(403);
		expect(reportResponse.json()).toMatchObject({ error: "Access denied to medication" });
	});

	it("scopes share people to the authenticated user's medications", async () => {
		const ownerId = await createUser("owner-share");
		const otherId = await createUser("other-share");
		const ownerCookie = await buildSessionCookie(app, ownerId, "owner-share");

		await seedMedication({ userId: ownerId, name: "Daniel Med", takenBy: ["Daniel"] });
		await seedMedication({ userId: otherId, name: "Anna Med", takenBy: ["Anna"] });

		const response = await app.inject({
			method: "GET",
			url: "/share/people",
			headers: { cookie: ownerCookie },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ people: ["Daniel"] });
	});

	it("rejects mutation routes for read-only API keys across business endpoints", async () => {
		const userId = await createUser("readonly-business-key");
		const medicationId = await seedMedication({ userId, name: "Readonly Med" });
		const apiToken = "ma_readonly_business_routes_123456789";
		await insertApiKey({ userId, token: apiToken, scope: "read" });

		const responses = await Promise.all([
			app.inject({
				method: "POST",
				url: "/medications",
				headers: { authorization: `Bearer ${apiToken}` },
				payload: buildMedicationPayload("Blocked Create"),
			}),
			app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { authorization: `Bearer ${apiToken}` },
				payload: { doseId: "1-0-1760000000000" },
			}),
			app.inject({
				method: "POST",
				url: `/medications/${medicationId}/refill`,
				headers: { authorization: `Bearer ${apiToken}` },
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			}),
			app.inject({
				method: "POST",
				url: "/share",
				headers: { authorization: `Bearer ${apiToken}` },
				payload: { takenBy: "Daniel", scheduleDays: 7 },
			}),
			app.inject({
				method: "POST",
				url: "/import",
				headers: { authorization: `Bearer ${apiToken}` },
				payload: buildImportPayload(),
			}),
		]);

		for (const response of responses) {
			expect(response.statusCode).toBe(403);
			expect(response.json()).toMatchObject({ code: "API_KEY_SCOPE_FORBIDDEN" });
		}
	});

	it("allows read-only API keys to use read endpoints while keeping data scoped to the key owner", async () => {
		const userId = await createUser("readonly-export-user");
		const otherId = await createUser("readonly-export-other");
		await seedMedication({ userId, name: "Readable Owner Med" });
		await seedMedication({ userId: otherId, name: "Unreadable Other Med" });
		const apiToken = "ma_readonly_export_access_123456789";
		await insertApiKey({ userId, token: apiToken, scope: "read" });

		const response = await app.inject({
			method: "GET",
			url: "/export",
			headers: { authorization: `Bearer ${apiToken}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("Readable Owner Med");
		expect(response.body).not.toContain("Unreadable Other Med");
	});

	it("does not auto-mark obsolete medications when listing with a read-only API key", async () => {
		const userId = await createUser("readonly-medications-no-side-effects");
		const medicationId = await seedMedication({ userId, name: "Expired Readonly Med" });
		await testClient.execute({
			sql: `UPDATE medications
			      SET medication_end_date = '2026-01-01', auto_mark_obsolete_after_end_date = 1, is_obsolete = 0
			      WHERE id = ?`,
			args: [medicationId],
		});
		const apiToken = "ma_readonly_no_obsolete_write_123456789";
		await insertApiKey({ userId, token: apiToken, scope: "read" });

		const response = await app.inject({
			method: "GET",
			url: "/medications",
			headers: { authorization: `Bearer ${apiToken}` },
		});

		expect(response.statusCode).toBe(200);
		const medicationRows = await testClient.execute({
			sql: "SELECT is_obsolete, obsolete_at FROM medications WHERE id = ?",
			args: [medicationId],
		});
		expect(medicationRows.rows[0]).toMatchObject({ is_obsolete: 0, obsolete_at: null });
	});
});
