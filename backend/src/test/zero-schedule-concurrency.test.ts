import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
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
	stock,
] = await Promise.all([
	import("fastify"),
	import("@fastify/sensible"),
	import("drizzle-orm"),
	import("../utils/documentation-schema-keywords.js"),
	import("../db/client.js"),
	import("../db/schema.js"),
	import("../plugins/auth.js"),
	import("../routes/medications.js"),
	import("../services/current-stock.js"),
]);

const { db, migrationsReady, withImmediateWriteTransaction } = dbClient;
const { doseTracking, medications, userSettings } = schema;
const { getAnonymousUserId } = auth;
const { medicationRoutes } = medicationRoutesModule;
const { computeMedicationCurrentStockRaw } = stock;

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
});
