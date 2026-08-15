import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ readOnly: false, userId: 1 }));
const dataDir = mkdtempSync(join(tmpdir(), "medassist-as-needed-routes-"));
process.env.DATA_DIR = dataDir;
process.env.DOTENV_PATH = join(dataDir, "missing.env");
process.env.NODE_ENV = "test";
process.env.AUTH_ENABLED = "false";
process.env.OIDC_ENABLED = "false";
process.env.LOG_LEVEL = "silent";

vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: async () => authState.userId,
	isReadOnlyApiKeyRequest: () => authState.readOnly,
}));

const [{ db, migrationsReady }, schema, { asNeededIntakeRoutes }] = await Promise.all([
	import("../db/client.js"),
	import("../db/schema.js"),
	import("../routes/as-needed-intakes.js"),
]);
const { asNeededIntakeEvents, doseTracking, intakeJournal, medications, userSettings, users } = schema;
let sequence = 0;

function key(): string {
	sequence += 1;
	return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

async function buildRouteApp() {
	const app = Fastify({ logger: false });
	await app.register(asNeededIntakeRoutes);
	return app;
}

async function seedMedication(userId = 1, stock = 50, options: { people?: string[]; intakes?: unknown[] } = {}) {
	const [medication] = await db
		.insert(medications)
		.values({
			userId,
			name: `As-needed route medication ${userId}`,
			takenByJson: JSON.stringify(options.people ?? []),
			medicationForm: "tablet",
			packageType: "blister",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: stock,
			intakesJson: JSON.stringify(options.intakes ?? []),
		})
		.returning({ id: medications.id });
	return medication.id;
}

async function create(
	app: Awaited<ReturnType<typeof buildRouteApp>>,
	medicationId: number,
	body: object,
	idempotencyKey = key()
) {
	return app.inject({
		method: "POST",
		url: `/medications/${medicationId}/as-needed-intakes`,
		headers: { "idempotency-key": idempotencyKey },
		payload: body,
	});
}

describe.sequential("as-needed owner routes", () => {
	beforeAll(() => migrationsReady);

	beforeEach(async () => {
		sequence = 0;
		authState.readOnly = false;
		authState.userId = 1;
		await db.delete(intakeJournal);
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		await db.delete(userSettings);
		await db.delete(users);
		await db.insert(users).values([
			{ id: 1, username: "owner" },
			{ id: 2, username: "other" },
			{ id: 3, username: "limited" },
		]);
		await db.insert(userSettings).values([{ userId: 1, stockCalculationMode: "manual" }, { userId: 2 }, { userId: 3 }]);
	});

	afterAll(() => rmSync(dataDir, { force: true, recursive: true }));

	it("registers the four owner /api-convention paths with documented strict schemas", async () => {
		const app = await buildRouteApp();
		const routes = app.printRoutes();
		expect(routes).toContain(":medicationId");
		expect(routes).toContain("/as-needed-intakes (GET, HEAD, POST)");
		expect(routes).toContain(":eventId");
		expect(routes).toContain("/reversal (POST)");
		expect(routes).toContain(":eventId (DELETE)");
		expect(routes).not.toContain("share");
		expect((await app.inject({ method: "DELETE", url: "/medications/1/as-needed-intakes" })).statusCode).toBe(404);
		expect((await app.inject({ method: "GET", url: "/api/medications/1/as-needed-intakes" })).statusCode).toBe(404);
		await app.close();
	});

	it("undos active intakes idempotently without disclosing unknown, other-owner, or reversed events", async () => {
		const app = await buildRouteApp();
		const medicationId = await seedMedication(1, 10);
		const otherMedicationId = await seedMedication(2, 10);
		const active = await create(app, medicationId, { quantity: 2 });
		const activeEventId = active.json().event.eventId as string;
		authState.userId = 2;
		const other = await create(app, otherMedicationId, { quantity: 1 });
		const otherEventId = other.json().event.eventId as string;
		authState.userId = 1;
		const reversed = await create(app, medicationId, { quantity: 1 });
		const reversedEventId = reversed.json().event.eventId as string;
		expect(
			(
				await app.inject({
					method: "POST",
					url: `/as-needed-intakes/${reversedEventId}/reversal`,
					headers: { "idempotency-key": key() },
					payload: { expectedRevision: 1 },
				})
			).statusCode
		).toBe(200);

		authState.readOnly = true;
		expect((await app.inject({ method: "DELETE", url: `/as-needed-intakes/${activeEventId}` })).json()).toMatchObject({
			code: "READ_ONLY",
		});
		authState.readOnly = false;

		for (const eventId of [
			"00000000-0000-4000-8000-000000000999",
			otherEventId,
			reversedEventId,
			activeEventId,
			activeEventId,
		]) {
			expect((await app.inject({ method: "DELETE", url: `/as-needed-intakes/${eventId}` })).statusCode).toBe(204);
		}
		expect((await db.select().from(asNeededIntakeEvents)).map((event) => event.eventId)).toEqual(
			expect.arrayContaining([otherEventId, reversedEventId])
		);
		expect((await db.select().from(asNeededIntakeEvents)).map((event) => event.eventId)).not.toContain(activeEventId);
		await app.close();
	});

	it("accepts a person assigned to another medication owned by the same user", async () => {
		const app = await buildRouteApp();
		const medicationId = await seedMedication(1, 10);
		await seedMedication(1, 10, { people: ["Ava"] });
		await seedMedication(2, 10, { people: ["Ben"] });
		expect((await create(app, medicationId, { quantity: 1, person: "Ava" })).statusCode).toBe(201);
		for (const person of ["Ben", "Unknown"]) {
			const response = await create(app, medicationId, { quantity: 1, person });
			expect(response.statusCode).toBe(400);
			expect(response.json()).toMatchObject({ code: "INVALID_PERSON" });
		}
		await app.close();
	});

	it("creates, lists with deterministic cursor pagination, and exposes nullable journal DTOs to read scope", async () => {
		const app = await buildRouteApp();
		const medicationId = await seedMedication();
		const one = await create(app, medicationId, { quantity: 1 });
		const two = await create(app, medicationId, { quantity: 1 });
		expect(one.statusCode).toBe(201);
		expect(two.statusCode).toBe(201);
		expect(one.json()).toMatchObject({
			event: { eventType: "as_needed", journal: null },
			inventory: { currentStock: 49 },
		});
		authState.readOnly = true;
		const page = await app.inject({ method: "GET", url: `/medications/${medicationId}/as-needed-intakes?limit=1` });
		expect(page.statusCode).toBe(200);
		expect(page.json()).toMatchObject({ events: [expect.objectContaining({ eventType: "as_needed", journal: null })] });
		expect(page.json().nextCursor).toEqual(expect.any(String));
		const next = await app.inject({
			method: "GET",
			url: `/medications/${medicationId}/as-needed-intakes?limit=1&cursor=${encodeURIComponent(page.json().nextCursor)}`,
		});
		expect(next.statusCode).toBe(200);
		expect(next.json().events[0].eventId).not.toBe(page.json().events[0].eventId);
		for (const url of [
			`/medications/${medicationId}/as-needed-intakes?limit=0`,
			`/medications/${medicationId}/as-needed-intakes?cursor=not-a-cursor`,
		]) {
			expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
		}
		await app.close();
	});

	it("enforces strict idempotency and known mutation request shapes while preserving read-only key access", async () => {
		const app = await buildRouteApp();
		const medicationId = await seedMedication();
		expect(
			(
				await app.inject({
					method: "POST",
					url: `/medications/${medicationId}/as-needed-intakes`,
					payload: { quantity: 1 },
				})
			).statusCode
		).toBe(400);
		expect((await create(app, medicationId, { quantity: 1, replacementForEventId: "not-a-uuid" })).statusCode).toBe(
			400
		);
		authState.readOnly = true;
		expect((await create(app, medicationId, { quantity: 1 })).json()).toMatchObject({ code: "READ_ONLY" });
		expect(
			(await app.inject({ method: "GET", url: `/medications/${medicationId}/as-needed-intakes` })).statusCode
		).toBe(200);
		await app.close();
	});

	it("maps owner eligibility, quantity, person, stock, key, revision, replacement and owner boundaries without disclosure", async () => {
		const app = await buildRouteApp();
		const medicationId = await seedMedication(1, 1, { people: ["Ava"] });
		const otherMedicationId = await seedMedication(2, 5);
		const validKey = key();
		const valid = await create(app, medicationId, { quantity: 1, person: "Ava" }, validKey);
		const eventId = valid.json().event.eventId as string;
		expect((await create(app, medicationId, { quantity: 0.5, person: "Ava" }, validKey)).json()).toMatchObject({
			code: "IDEMPOTENCY_KEY_REUSED",
		});
		for (const [body, status, code] of [
			[{ quantity: 0 }, 400, "INVALID_QUANTITY"],
			[{ quantity: 1, person: "Ben" }, 400, "INVALID_PERSON"],
			[{ quantity: 2 }, 409, "INSUFFICIENT_STOCK"],
			[{ quantity: 1 }, 409, "INSUFFICIENT_STOCK"],
		] as const) {
			const result = await create(app, medicationId, body);
			expect(result.statusCode).toBe(status);
			expect(result.json()).toMatchObject({ code });
		}
		authState.userId = 2;
		expect(
			(await app.inject({ method: "GET", url: `/medications/${medicationId}/as-needed-intakes` })).statusCode
		).toBe(404);
		expect(
			(
				await app.inject({
					method: "POST",
					url: `/as-needed-intakes/${eventId}/reversal`,
					headers: { "idempotency-key": key() },
					payload: { expectedRevision: 1 },
				})
			).statusCode
		).toBe(404);
		authState.userId = 1;
		authState.readOnly = true;
		expect(
			(
				await app.inject({
					method: "POST",
					url: `/as-needed-intakes/${eventId}/reversal`,
					headers: { "idempotency-key": key() },
					payload: { expectedRevision: 1 },
				})
			).json()
		).toMatchObject({ code: "READ_ONLY" });
		authState.readOnly = false;
		const reversed = await app.inject({
			method: "POST",
			url: `/as-needed-intakes/${eventId}/reversal`,
			headers: { "idempotency-key": key() },
			payload: { expectedRevision: 1 },
		});
		expect(reversed.statusCode).toBe(200);
		expect(
			(
				await app.inject({
					method: "POST",
					url: `/as-needed-intakes/${eventId}/reversal`,
					headers: { "idempotency-key": key() },
					payload: { expectedRevision: 0 },
				})
			).json()
		).toMatchObject({ code: "INVALID_REVISION" });
		const replacement = await create(app, medicationId, { quantity: 1, replacementForEventId: eventId });
		expect(replacement.statusCode).toBe(201);
		expect(replacement.json().event.replacementForEventId).toBe(eventId);
		expect((await create(app, medicationId, { quantity: 1, replacementForEventId: eventId })).json()).toMatchObject({
			code: "REPLACEMENT_NOT_ALLOWED",
		});
		expect(otherMedicationId).toBeGreaterThan(0);
		await app.close();
	});

	it("replays a lost create response before the 20-intent guard and supplies Retry-After for the next new intent", async () => {
		const app = await buildRouteApp();
		authState.userId = 3;
		const medicationId = await seedMedication(3, 30);
		const firstKey = key();
		const first = await create(app, medicationId, { quantity: 1 }, firstKey);
		expect(first.statusCode).toBe(201);
		for (let index = 1; index < 20; index += 1) {
			expect((await create(app, medicationId, { quantity: 1 })).statusCode).toBe(201);
		}
		const replay = await create(app, medicationId, { quantity: 1 }, firstKey);
		expect(replay.statusCode).toBe(200);
		expect(replay.headers["idempotent-replay"]).toBe("true");
		const limited = await create(app, medicationId, { quantity: 1 });
		expect(limited.statusCode).toBe(429);
		expect(limited.headers["retry-after"]).toMatch(/^[1-9][0-9]*$/);
		expect(limited.json()).toMatchObject({ code: "TOO_MANY_NEW_INTAKES" });
		await app.close();
	});
});
