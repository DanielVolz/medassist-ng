import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAlterMigrations } from "../db/migration-utils.js";

// Use the production client against one dedicated file so these tests exercise the real
// immediate-write transaction helper rather than a mocked router or database layer.
const dataDir = mkdtempSync(join(tmpdir(), "medassist-as-needed-service-"));
process.env.DATA_DIR = dataDir;
process.env.DOTENV_PATH = join(dataDir, "missing.env");
process.env.NODE_ENV = "test";
process.env.AUTH_ENABLED = "false";
process.env.OIDC_ENABLED = "false";
process.env.LOG_LEVEL = "silent";

const [{ db, migrationsReady }, schema, service] = await Promise.all([
	import("../db/client.js"),
	import("../db/schema.js"),
	import("../services/as-needed-intakes-service.js"),
]);
const { asNeededIntakeEvents, doseTracking, medications, userSettings, users } = schema;
const {
	createAsNeededIntake,
	filterScheduledDoseRows,
	getActiveAsNeededStockEffectMilli,
	getAsNeededAnchorDoseIds,
	getActiveAsNeededStockEffectsMilli,
	reverseAsNeededIntake,
} = service;

const __filename = fileURLToPath(import.meta.url);
const migrationsFolder = resolve(dirname(__filename), "../../drizzle");
let sequence = 0;

function intentKey(): string {
	sequence += 1;
	return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
	await expect(operation).rejects.toMatchObject({ name: "AsNeededIntakeError", code });
}

async function seedMedication(
	options: {
		userId?: number;
		stock?: number;
		people?: ReadonlyArray<string>;
		intakes?: ReadonlyArray<unknown>;
		form?: string;
		packageType?: string;
		endDate?: string | null;
		isObsolete?: boolean;
	} = {}
): Promise<number> {
	const [medication] = await db
		.insert(medications)
		.values({
			userId: options.userId ?? 1,
			name: "As-needed medicine",
			takenByJson: JSON.stringify(options.people ?? []),
			medicationForm: options.form ?? "tablet",
			packageType: options.packageType ?? "blister",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: options.stock ?? 10,
			intakesJson: JSON.stringify(options.intakes ?? []),
			medicationEndDate: options.endDate ?? null,
			isObsolete: options.isObsolete ?? false,
		})
		.returning({ id: medications.id });
	return medication.id;
}

async function eventCount(): Promise<number> {
	return (await db.select().from(asNeededIntakeEvents)).length;
}

describe.sequential("as-needed intake service", () => {
	beforeAll(() => migrationsReady);

	beforeEach(async () => {
		sequence = 0;
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		await db.delete(userSettings);
		await db.delete(users);
		await db.insert(users).values([
			{ id: 1, username: "owner" },
			{ id: 2, username: "other" },
		]);
		await db.insert(userSettings).values([{ userId: 1, stockCalculationMode: "manual" }, { userId: 2 }]);
	});

	afterAll(() => rmSync(dataDir, { force: true, recursive: true }));

	it("creates the runtime table safely for a pre-0022 database and keeps its defaults, checks, and indexes", async () => {
		const client = createClient({ url: ":memory:" });
		const testDb = drizzle(client);
		await migrate(testDb, { migrationsFolder });
		await client.execute("DROP TABLE as_needed_intake_events");
		expect((await runAlterMigrations(client)).errors).toEqual([]);
		expect((await runAlterMigrations(client)).errors).toEqual([]);
		const table = await client.execute(
			"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'as_needed_intake_events'"
		);
		const indexes = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'as_needed_intake_events'"
		);
		expect(table.rows[0].sql).toContain("CHECK(quantity_milli > 0)");
		expect(table.rows[0].sql).toContain("DEFAULT 'owner_as_needed'");
		expect(indexes.rows.map((row) => row.name)).toEqual(
			expect.arrayContaining(["as_needed_intake_events_anchor_unique", "as_needed_intake_events_owner_key_unique"])
		);
		await client.execute("INSERT INTO users (id, username) VALUES (1, 'runtime-owner')");
		await client.execute("INSERT INTO medications (id, user_id, name) VALUES (1, 1, 'runtime-medication')");
		await client.execute("INSERT INTO dose_tracking (id, user_id, dose_id) VALUES (1, 1, 'as-needed:runtime')");
		await client.execute(
			"INSERT INTO as_needed_intake_events (event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint, occurred_at, recorded_at, quantity_milli, quantity_unit) VALUES ('runtime-event', 1, 1, 1, 'key', 'fingerprint', 1, 1, 1000, 'pills')"
		);
		expect(
			(await client.execute("SELECT source, status, stock_effect_milli, revision FROM as_needed_intake_events")).rows[0]
		).toMatchObject({ source: "owner_as_needed", status: "active", stock_effect_milli: 0, revision: 1 });
		await expect(
			client.execute(
				"INSERT INTO as_needed_intake_events (event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint, occurred_at, recorded_at, quantity_milli, quantity_unit) VALUES ('invalid-event', 1, 1, 1, 'other-key', 'fingerprint', 1, 1, 0, 'pills')"
			)
		).rejects.toThrow(/CHECK constraint/i);
		await client.close();
	});

	it("creates a trusted anchor and event atomically, replays one key, and scopes keys and events to their owner", async () => {
		const medicationId = await seedMedication({ people: ["Ava"] });
		const key = intentKey();
		const event = await createAsNeededIntake({
			userId: 1,
			medicationId,
			quantity: 1,
			personName: "Ava",
			idempotencyKey: key,
		});
		const [anchor] = await db.select().from(doseTracking);
		expect(anchor).toMatchObject({ userId: 1, doseId: `as-needed:${event.eventId}`, markedBy: "Ava" });
		expect(event).toMatchObject({ stockEffectMilli: 1000, quantityMilli: 1000, status: "active" });
		expect(
			(await createAsNeededIntake({ userId: 1, medicationId, quantity: 1, personName: "Ava", idempotencyKey: key })).id
		).toBe(event.id);
		await expectCode(
			createAsNeededIntake({ userId: 1, medicationId, quantity: 0.5, personName: "Ava", idempotencyKey: key }),
			"IDEMPOTENCY_KEY_REUSED"
		);
		const otherMedicationId = await seedMedication({ userId: 2 });
		expect(
			(await createAsNeededIntake({ userId: 2, medicationId: otherMedicationId, quantity: 1, idempotencyKey: key }))
				.userId
		).toBe(2);
		await expectCode(
			reverseAsNeededIntake({ userId: 2, eventId: event.eventId, expectedRevision: 1, idempotencyKey: intentKey() }),
			"EVENT_NOT_FOUND"
		);
		expect(await eventCount()).toBe(2);
	});

	it("aggregates active effects per owner and medication while retaining reversed and zero-effect rows as zero", async () => {
		const ownerMedicationId = await seedMedication({ stock: 5 });
		const otherMedicationId = await seedMedication({ userId: 2, stock: 5 });
		const active = await createAsNeededIntake({
			userId: 1,
			medicationId: ownerMedicationId,
			quantity: 1,
			idempotencyKey: intentKey(),
		});
		const reversed = await createAsNeededIntake({
			userId: 1,
			medicationId: ownerMedicationId,
			quantity: 1,
			idempotencyKey: intentKey(),
		});
		await reverseAsNeededIntake({
			userId: 1,
			eventId: reversed.eventId,
			expectedRevision: 1,
			idempotencyKey: intentKey(),
		});
		await createAsNeededIntake({
			userId: 2,
			medicationId: otherMedicationId,
			quantity: 1,
			idempotencyKey: intentKey(),
		});
		expect(await getActiveAsNeededStockEffectMilli(db, 1, ownerMedicationId)).toBe(active.stockEffectMilli);
		expect(await getActiveAsNeededStockEffectsMilli(db, 1, [ownerMedicationId, otherMedicationId])).toEqual(
			new Map([[ownerMedicationId, active.stockEffectMilli]])
		);
		const topicalId = await seedMedication({ form: "topical", packageType: "tube", stock: 0 });
		await createAsNeededIntake({ userId: 1, medicationId: topicalId, quantity: 1, idempotencyKey: intentKey() });
		expect(await getActiveAsNeededStockEffectMilli(db, 1, topicalId)).toBe(0);
	});

	it("identifies anchors only through the companion relation and owner boundary", async () => {
		const medicationId = await seedMedication();
		const event = await createAsNeededIntake({ userId: 1, medicationId, quantity: 1, idempotencyKey: intentKey() });
		const scheduledLookingAnchor = `1-0-1735344000000`;
		const [ordinary] = await db.insert(doseTracking).values({ userId: 1, doseId: scheduledLookingAnchor }).returning();
		const [fakePrefix] = await db
			.insert(doseTracking)
			.values({ userId: 1, doseId: "as-needed:untrusted-prefix" })
			.returning();
		const rows = await db.select().from(doseTracking).where(eq(doseTracking.userId, 1));
		expect((await getAsNeededAnchorDoseIds(db, 1)).has(`as-needed:${event.eventId}`)).toBe(true);
		expect(await filterScheduledDoseRows(db, 1, rows)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: ordinary.id }),
				expect.objectContaining({ id: fakePrefix.id }),
			])
		);
		expect(await getAsNeededAnchorDoseIds(db, 2, [`as-needed:${event.eventId}`])).toEqual(new Set());
	});

	it.each([
		["scheduled", { intakes: [{ usage: 1, every: 1, start: "2099-01-01T08:00:00" }] }, undefined, "NOT_ELIGIBLE"],
		["ended", { endDate: "2000-01-01" }, undefined, "NOT_ELIGIBLE"],
		["obsolete", { isObsolete: true }, undefined, "NOT_ELIGIBLE"],
		["unassigned person", { people: ["Ava"] }, "Ben", "INVALID_PERSON"],
	] as const)(
		"rejects %s medication eligibility without an anchor or event",
		async (_case, options, personName, code) => {
			const medicationId = await seedMedication(options);
			await expectCode(
				createAsNeededIntake({ userId: 1, medicationId, quantity: 1, personName, idempotencyKey: intentKey() }),
				code
			);
			expect(await eventCount()).toBe(0);
			expect((await db.select().from(doseTracking)).length).toBe(0);
		}
	);

	it.each([
		["insufficient stock", { stock: 1 }, 2, "INSUFFICIENT_STOCK"],
		["unresolvable stock", { stock: Number.MAX_SAFE_INTEGER, packageType: "bottle" }, 1, "STOCK_UNRESOLVABLE"],
	] as const)("rejects %s without partial writes", async (_case, options, quantity, code) => {
		const medicationId = await seedMedication(options);
		await expectCode(createAsNeededIntake({ userId: 1, medicationId, quantity, idempotencyKey: intentKey() }), code);
		expect(await eventCount()).toBe(0);
		expect((await db.select().from(doseTracking)).length).toBe(0);
	});

	it("records topical application without changing measurable stock and preserves reversal and replacement history", async () => {
		const medicationId = await seedMedication({ stock: 0, form: "topical", packageType: "tube" });
		const original = await createAsNeededIntake({ userId: 1, medicationId, quantity: 1, idempotencyKey: intentKey() });
		expect(original).toMatchObject({
			quantityUnit: "application",
			stockEffectMilli: 0,
			stockEffectReason: "non_measurable",
		});
		const reversalKey = intentKey();
		const reversed = await reverseAsNeededIntake({
			userId: 1,
			eventId: original.eventId,
			expectedRevision: 1,
			idempotencyKey: reversalKey,
		});
		expect(reversed).toMatchObject({ status: "reversed", revision: 2, reversalIdempotencyKeyHash: expect.any(String) });
		expect(
			(
				await reverseAsNeededIntake({
					userId: 1,
					eventId: original.eventId,
					expectedRevision: 1,
					idempotencyKey: reversalKey,
				})
			).id
		).toBe(original.id);
		expect(
			(
				await reverseAsNeededIntake({
					userId: 1,
					eventId: original.eventId,
					expectedRevision: 1,
					idempotencyKey: intentKey(),
				})
			).revision
		).toBe(2);
		const replacement = await createAsNeededIntake({
			userId: 1,
			medicationId,
			quantity: 1,
			replacesEventId: original.eventId,
			idempotencyKey: intentKey(),
		});
		expect(replacement.replacesEventId).toBe(original.id);
	});
});
