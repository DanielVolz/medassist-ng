import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// This suite deliberately imports the production database client after pointing it at a
// dedicated on-disk database. Route suites normally mock db/client, which cannot exercise
// the production FIFO writer queue or contention between independent SQLite connections.
const dataDir = mkdtempSync(join(tmpdir(), "medassist-zero-schedule-concurrency-"));
process.env.DATA_DIR = dataDir;
process.env.DOTENV_PATH = join(dataDir, "missing.env");
process.env.NODE_ENV = "test";
process.env.AUTH_ENABLED = "false";
process.env.OIDC_ENABLED = "false";
process.env.LOG_LEVEL = "silent";

const [
	{ default: Fastify },
	{ default: sensible },
	{ sql },
	{ documentationSchemaAjv },
	dbClient,
	schema,
	auth,
	medicationRoutesModule,
	refillRoutesModule,
	stock,
	asNeededService,
] = await Promise.all([
	import("fastify"),
	import("@fastify/sensible"),
	import("drizzle-orm"),
	import("../utils/documentation-schema-keywords.js"),
	import("../db/client.js"),
	import("../db/schema.js"),
	import("../plugins/auth.js"),
	import("../routes/medications.js"),
	import("../routes/refills.js"),
	import("../services/current-stock.js"),
	import("../services/as-needed-intakes-service.js"),
]);

const { db, migrationsReady, withImmediateWriteTransaction } = dbClient;
const { asNeededIntakeEvents, doseTracking, medications, userSettings, users } = schema;
const { getAnonymousUserId } = auth;
const { medicationRoutes } = medicationRoutesModule;
const { refillRoutes } = refillRoutesModule;
const { computeMedicationCurrentStockRaw } = stock;
const { createAsNeededIntake, reverseAsNeededIntake } = asNeededService;

type StockMode = "automatic" | "manual";

function scheduleStart(): string {
	return "2099-01-02T08:00:00";
}

function medicationPayload(intakes: Array<{ usage: number; every: number; start: string }>) {
	return {
		name: "Concurrency medicine",
		genericName: null,
		takenBy: [],
		medicationForm: "tablet",
		pillForm: "tablet",
		lifecycleCategory: "refill_when_empty",
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		packageAmountValue: 0,
		packageAmountUnit: "ml",
		totalPills: null,
		looseTablets: 0,
		pillWeightMg: null,
		doseUnit: "mg",
		medicationStartDate: "",
		medicationEndDate: null,
		autoMarkObsoleteAfterEndDate: true,
		expiryDate: null,
		notes: null,
		prescriptionEnabled: false,
		prescriptionAuthorizedRefills: null,
		prescriptionRemainingRefills: null,
		prescriptionLowRefillThreshold: 1,
		prescriptionExpiryDate: null,
		intakeRemindersEnabled: false,
		intakes,
	};
}

let idempotencySequence = 0;

function idempotencyKey(): string {
	idempotencySequence += 1;
	return `00000000-0000-4000-8000-${idempotencySequence.toString().padStart(12, "0")}`;
}

async function waitForChildLine(child: ReturnType<typeof spawn>, expected: string): Promise<void> {
	let received = "";
	await Promise.race([
		new Promise<void>((resolve, reject) => {
			child.stdout?.on("data", (chunk: Buffer) => {
				received += chunk.toString();
				if (received.includes(expected)) resolve();
			});
			child.once("error", reject);
			child.once("exit", (code) => reject(new Error(`lock holder exited before ready (${code}): ${received}`)));
		}),
		new Promise<void>((_, reject) =>
			setTimeout(() => reject(new Error("timed out waiting for independent lock holder")), 3000)
		),
	]);
}

async function releaseChild(child: ReturnType<typeof spawn>): Promise<void> {
	child.stdin?.end("release\n");
	const [code] = await once(child, "exit");
	expect(code).toBe(0);
}

describe.sequential("zero-schedule production write serialization", () => {
	let app: Awaited<ReturnType<typeof Fastify>>;
	let userId: number;

	beforeAll(async () => {
		await migrationsReady;
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(sensible);
		await app.register(medicationRoutes);
		await app.register(refillRoutes);
		await app.ready();
		userId = await getAnonymousUserId();
	});

	afterAll(async () => {
		await app.close();
		rmSync(dataDir, { force: true, recursive: true });
	});

	it.each<StockMode>([
		"automatic",
		"manual",
	])("serializes simultaneous schedule boundary writes and preserves raw %s stock", async (stockCalculationMode) => {
		await db.delete(doseTracking);
		await db.delete(medications);
		await db.delete(userSettings);
		await db.insert(userSettings).values({ userId, stockCalculationMode });

		const start = scheduleStart();
		const created = await app.inject({
			method: "POST",
			url: "/medications",
			payload: medicationPayload([{ usage: 1, every: 1, start }]),
		});
		expect(created.statusCode).toBe(200);
		const medicationId = created.json().id as number;
		const historicalDoseId = `${medicationId}-0-${new Date(2099, 0, 2).getTime()}`;
		await db.insert(doseTracking).values({
			userId,
			doseId: historicalDoseId,
			takenAt: new Date(),
			markedBy: "history",
			takenSource: "manual",
		});

		const [beforeMedication] = await db.select().from(medications);
		const beforeDoses = await db.select().from(doseTracking);
		const expectedRawStock = computeMedicationCurrentStockRaw({
			medication: beforeMedication,
			doses: beforeDoses,
			stockCalculationMode,
		});

		const [toUnscheduled, toScheduled] = await Promise.all([
			app.inject({ method: "PUT", url: `/medications/${medicationId}`, payload: medicationPayload([]) }),
			app.inject({
				method: "PUT",
				url: `/medications/${medicationId}`,
				payload: medicationPayload([{ usage: 2, every: 1, start }]),
			}),
		]);

		expect(toUnscheduled.statusCode).toBe(200);
		expect(toScheduled.statusCode).toBe(200);
		const [persisted] = await db.select().from(medications);
		const persistedDoses = await db.select().from(doseTracking);
		expect(JSON.parse(persisted.intakesJson)).toHaveLength(1);
		expect(persistedDoses.map((dose) => dose.doseId)).toContain(historicalDoseId);
		expect(
			computeMedicationCurrentStockRaw({ medication: persisted, doses: persistedDoses, stockCalculationMode })
		).toBe(expectedRawStock);
		expect(Number.isInteger(persisted.scheduleStockRebaseMilli)).toBe(true);
		expect(persisted.scheduleStockRebaseMilli).not.toBe(0);
	});

	it("returns the original bounded SQLITE_BUSY from an independent writer and releases the FIFO queue", async () => {
		const databaseUrl = `file:${resolve(dataDir, "medassist-ng.db")}`;
		const child = spawn(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`import { createClient } from "@libsql/client";
const client = createClient({ url: process.env.MEDASSIST_LOCK_DB_URL });
const transaction = await client.transaction("write");
process.stdout.write("locked\\n");
process.stdin.once("data", async () => {
	await transaction.commit();
	transaction.close();
	await client.close();
	process.exitCode = 0;
});`,
			],
			{
				cwd: resolve(process.cwd()),
				env: { ...process.env, MEDASSIST_LOCK_DB_URL: databaseUrl },
				stdio: ["pipe", "pipe", "pipe"],
			}
		);

		await waitForChildLine(child, "locked\n");
		const failure = await Promise.race([
			withImmediateWriteTransaction(async (transactionDb) => {
				await transactionDb.run(sql`UPDATE medications SET notes = 'blocked'`);
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("production write helper hung on SQLITE_BUSY")), 3000)
			),
		]).then(
			() => null,
			(error: unknown) => error
		);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toMatch(/SQLITE_BUSY|database is locked/i);

		await releaseChild(child);
		await expect(
			withImmediateWriteTransaction(async (transactionDb) => {
				await transactionDb.run(sql`UPDATE medications SET notes = 'written after lock'`);
				return "queued writer completed";
			})
		).resolves.toBe("queued writer completed");
	});

	it("preserves the aggregate-reduced raw stock across both zero-schedule boundaries", async () => {
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		const created = await app.inject({
			method: "POST",
			url: "/medications",
			payload: medicationPayload([{ usage: 1, every: 1, start: scheduleStart() }]),
		});
		const medicationId = created.json().id as number;
		const [anchor] = await db
			.insert(doseTracking)
			.values({ userId, doseId: "as-needed:rebase-effect" })
			.returning({ id: doseTracking.id });
		await db.insert(asNeededIntakeEvents).values({
			eventId: "rebase-effect",
			userId,
			medicationId,
			doseTrackingId: anchor.id,
			idempotencyKeyHash: "key",
			requestFingerprint: "fingerprint",
			occurredAt: new Date(),
			recordedAt: new Date(),
			quantityMilli: 1500,
			quantityUnit: "pills",
			stockEffectMilli: 1500,
		});
		const [beforeEvent] = await db.select().from(asNeededIntakeEvents);
		const before = await db.select().from(medications).where(sql`${medications.id} = ${medicationId}`);
		const raw = computeMedicationCurrentStockRaw({
			medication: before[0],
			doses: await db.select().from(doseTracking),
			stockCalculationMode: "manual",
			asNeededStockEffectMilli: 1500,
		});
		for (const intakes of [[], [{ usage: 2, every: 1, start: scheduleStart() }]]) {
			const response = await app.inject({
				method: "PUT",
				url: `/medications/${medicationId}`,
				payload: medicationPayload(intakes),
			});
			expect(response.statusCode).toBe(200);
			const [persisted] = await db.select().from(medications).where(sql`${medications.id} = ${medicationId}`);
			const [persistedEvent] = await db.select().from(asNeededIntakeEvents);
			expect(
				computeMedicationCurrentStockRaw({
					medication: persisted,
					doses: await db.select().from(doseTracking),
					stockCalculationMode: "manual",
					asNeededStockEffectMilli: 1500,
				})
			).toBe(raw);
			expect(persistedEvent).toMatchObject({
				stockEffectMilli: 1500,
				stockCutoffAt: 0,
				revision: beforeEvent.revision,
			});
		}
	});

	it("neutralizes only eligible active effects when a correction races with a physical edit", async () => {
		idempotencySequence = 0;
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		const created = await app.inject({ method: "POST", url: "/medications", payload: medicationPayload([]) });
		expect(created.statusCode).toBe(200);
		const medicationId = created.json().id as number;
		const applied = await createAsNeededIntake({
			userId,
			medicationId,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		const reversed = await createAsNeededIntake({
			userId,
			medicationId,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		await reverseAsNeededIntake({
			userId,
			eventId: reversed.eventId,
			expectedRevision: 1,
			idempotencyKey: idempotencyKey(),
		});
		const future = await createAsNeededIntake({
			userId,
			medicationId,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		await db
			.update(asNeededIntakeEvents)
			.set({ occurredAt: new Date("2099-01-01T00:00:00.000Z") })
			.where(sql`${asNeededIntakeEvents.eventId} = ${future.eventId}`);
		const [zeroAnchor] = await db
			.insert(doseTracking)
			.values({ userId, doseId: "as-needed:zero-effect" })
			.returning({ id: doseTracking.id });
		await db.insert(asNeededIntakeEvents).values({
			eventId: "zero-effect",
			userId,
			medicationId,
			doseTrackingId: zeroAnchor.id,
			idempotencyKeyHash: "zero-effect-key",
			requestFingerprint: "zero-effect-fingerprint",
			occurredAt: new Date("2020-01-01T00:00:00.000Z"),
			recordedAt: new Date(),
			quantityMilli: 1000,
			quantityUnit: "pills",
			stockEffectMilli: 0,
			stockEffectReason: "non_measurable",
		});

		const [correction, physicalEdit] = await Promise.all([
			app.inject({
				method: "PATCH",
				url: `/medications/${medicationId}/stock-adjustment`,
				payload: { stockAdjustment: 7 },
			}),
			app.inject({
				method: "PUT",
				url: `/medications/${medicationId}`,
				payload: { ...medicationPayload([]), looseTablets: 3 },
			}),
		]);
		expect(correction.statusCode).toBe(200);
		expect(physicalEdit.statusCode).toBe(200);
		const events = await db.select().from(asNeededIntakeEvents);
		const byEventId = new Map(events.map((event) => [event.eventId, event]));
		expect(byEventId.get(applied.eventId)).toMatchObject({
			stockEffectMilli: 0,
			stockEffectReason: "superseded_by_correction",
			stockCutoffAt: expect.any(Number),
			revision: 2,
		});
		expect(byEventId.get(reversed.eventId)).toMatchObject({ status: "reversed", stockEffectMilli: 1000, revision: 2 });
		expect(byEventId.get(future.eventId)).toMatchObject({ stockEffectMilli: 1000, stockCutoffAt: 0, revision: 1 });
		expect(byEventId.get("zero-effect")).toMatchObject({
			stockEffectMilli: 0,
			stockEffectReason: "non_measurable",
			revision: 1,
		});
	});

	it.each<StockMode>([
		"automatic",
		"manual",
	])("rebases %s refills from transaction-visible raw stock and consumes prior event effects exactly", async (stockCalculationMode) => {
		idempotencySequence = 0;
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		await db.delete(userSettings);
		await db.insert(userSettings).values({ userId, stockCalculationMode });
		const created = await app.inject({ method: "POST", url: "/medications", payload: medicationPayload([]) });
		const medicationId = created.json().id as number;
		const event = await createAsNeededIntake({
			userId,
			medicationId,
			quantity: 1.5,
			idempotencyKey: idempotencyKey(),
		});
		const refills = await Promise.all([
			app.inject({
				method: "POST",
				url: `/medications/${medicationId}/refill`,
				payload: { loosePillsAdded: 2 },
			}),
			app.inject({
				method: "POST",
				url: `/medications/${medicationId}/refill`,
				payload: { loosePillsAdded: 2 },
			}),
		]);
		expect(refills.map((refill) => refill.statusCode)).toEqual([200, 200]);
		expect(refills.map((refill) => refill.json().newStock.totalPills).sort()).toEqual([10.5, 12.5]);
		const [persisted] = await db.select().from(medications).where(sql`${medications.id} = ${medicationId}`);
		const [persistedEvent] = await db
			.select()
			.from(asNeededIntakeEvents)
			.where(sql`${asNeededIntakeEvents.eventId} = ${event.eventId}`);
		expect(persisted.scheduleStockRebaseMilli).toBe(500);
		expect(persistedEvent).toMatchObject({
			stockEffectMilli: 0,
			stockEffectReason: "superseded_by_correction",
			revision: 2,
		});
		expect(
			computeMedicationCurrentStockRaw({
				medication: persisted,
				doses: await db.select().from(doseTracking),
				stockCalculationMode,
			})
		).toBe(12.5);
	});

	it("deletes only owned event anchors after the medication delete commits", async () => {
		idempotencySequence = 0;
		await db.delete(asNeededIntakeEvents);
		await db.delete(doseTracking);
		await db.delete(medications);
		await db.delete(users).where(sql`${users.id} = 2`);
		await db.insert(users).values({ id: 2, username: "other-anchor-owner" });
		const target = await app.inject({ method: "POST", url: "/medications", payload: medicationPayload([]) });
		const targetId = target.json().id as number;
		const [otherMedication] = await db
			.insert(medications)
			.values({
				userId,
				name: "Other medication",
				takenByJson: "[]",
				intakesJson: "[]",
				looseTablets: 10,
			})
			.returning({ id: medications.id });
		const [otherOwnerMedication] = await db
			.insert(medications)
			.values({
				userId: 2,
				name: "Other owner medication",
				takenByJson: "[]",
				intakesJson: "[]",
				looseTablets: 10,
			})
			.returning({ id: medications.id });
		const targetEvent = await createAsNeededIntake({
			userId,
			medicationId: targetId,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		const otherMedicationEvent = await createAsNeededIntake({
			userId,
			medicationId: otherMedication.id,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		const otherOwnerEvent = await createAsNeededIntake({
			userId: 2,
			medicationId: otherOwnerMedication.id,
			quantity: 1,
			idempotencyKey: idempotencyKey(),
		});
		await db.insert(doseTracking).values({ userId, doseId: "as-needed:untrusted-prefix" });
		const imageDir = join(dataDir, "images");
		mkdirSync(imageDir, { recursive: true });
		writeFileSync(join(imageDir, "target-image.webp"), "target");
		writeFileSync(join(imageDir, "other-owner-image.webp"), "other owner");
		await db.update(medications).set({ imageUrl: "target-image.webp" }).where(sql`${medications.id} = ${targetId}`);
		await db
			.update(medications)
			.set({ imageUrl: "other-owner-image.webp" })
			.where(sql`${medications.id} = ${otherOwnerMedication.id}`);

		const deletion = await app.inject({ method: "DELETE", url: `/medications/${targetId}` });
		expect(deletion.statusCode).toBe(204);
		expect(existsSync(join(imageDir, "target-image.webp"))).toBe(false);
		const failedDeletion = await app.inject({ method: "DELETE", url: `/medications/${otherOwnerMedication.id}` });
		expect(failedDeletion.statusCode).toBe(404);
		expect(existsSync(join(imageDir, "other-owner-image.webp"))).toBe(true);
		const remainingEvents = await db.select().from(asNeededIntakeEvents);
		expect(remainingEvents.map((event) => event.eventId)).toEqual(
			expect.arrayContaining([otherMedicationEvent.eventId, otherOwnerEvent.eventId])
		);
		expect(remainingEvents.map((event) => event.eventId)).not.toContain(targetEvent.eventId);
		const remainingDoses = await db.select().from(doseTracking);
		expect(remainingDoses.map((dose) => dose.doseId)).toEqual(
			expect.arrayContaining([
				`as-needed:${otherMedicationEvent.eventId}`,
				`as-needed:${otherOwnerEvent.eventId}`,
				"as-needed:untrusted-prefix",
			])
		);
	});
});
