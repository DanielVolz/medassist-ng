import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userSettings } from "../db/schema.js";
import { buildExportSettings, exportUserData } from "../services/export-service.js";
import {
	collectImportValidationIssues,
	createImportImageFiles,
	importValidatedData,
	parseImportData,
	previewImportData,
} from "../services/import-service.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

// Only auth is synthetic. The route, migrations, SQLite client, transaction helper,
// image decoder and image writer are production code, not callback mocks.
vi.mock("../plugins/env.js", () => ({ env: { AUTH_ENABLED: true } }));
vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => undefined,
	getAnonymousUserId: () => 1,
}));
vi.mock("node:crypto", async (original) => {
	const actual = await original<typeof import("node:crypto")>();
	return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

let app: FastifyInstance;
let client: Client;
let productionDb: typeof import("../db/client.js");
let directory: string;
let images: string;
let image: string;
const timestamp = "2026-10-03T12:00:00.000Z";
const medication = () => ({
	_exportId: "med-1",
	name: "Synthetic medication",
	inventory: {},
	schedules: [{ usage: 1, every: 1, start: timestamp }],
});
const invalidMedication = (fields: Record<string, unknown>) => ({ medications: [{ ...medication(), ...fields }] });
const payload = () => ({
	version: "1.9",
	exportedAt: timestamp,
	medications: [medication()],
	asNeededIntakes: [
		{
			eventId: "22222222-2222-4222-8222-222222222222",
			medicationRef: "med-1",
			idempotencyKeyHash: "a".repeat(64),
			requestFingerprint: "b".repeat(64),
			occurredAt: timestamp,
			recordedAt: timestamp,
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
		},
	],
	settings: { language: "en", shareStockStatus: true },
	doseHistory: [
		{
			medicationRef: "med-1",
			scheduleIndex: 0,
			scheduledTime: timestamp,
			takenAt: timestamp,
			journalNote: "Synthetic journal",
		},
	],
	refillHistory: [{ medicationRef: "med-1", refillDate: timestamp }],
	shareLinks: [{ takenBy: "Synthetic person" }],
});
const tables = [
	"medications",
	"dose_tracking",
	"as_needed_intake_events",
	"intake_journal",
	"refill_history",
	"share_tokens",
	"user_settings",
];
async function snapshot() {
	return Promise.all(tables.map(async (table) => (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows));
}
function files() {
	return readdirSync(images)
		.sort()
		.map((name) => [name, readFileSync(join(images, name)).toString("base64")]);
}

describe("production import atomicity", () => {
	beforeAll(async () => {
		directory = mkdtempSync(join(tmpdir(), "medassist-import-"));
		images = join(directory, "images");
		mkdirSync(images);
		vi.stubEnv("DATA_DIR", directory);
		vi.stubEnv("DOTENV_PATH", join(directory, "absent.env"));
		vi.stubEnv("AUTH_ENABLED", "false");
		productionDb = await import("../db/client.js");
		await productionDb.migrationsReady;
		client = createClient({ url: `file:${join(directory, "medassist-ng.db")}` });
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		app.addHook("onRequest", async (request) => {
			request.user = { id: 1 } as typeof request.user;
		});
		await app.register((await import("../routes/export.js")).exportRoutes);
		await app.ready();
		image = `data:image/png;base64,${(
			await sharp({
				create: {
					width: 2,
					height: 2,
					channels: 3,
					background: "red",
				},
			})
				.png()
				.toBuffer()
		).toString("base64")}`;
	});
	beforeEach(async () => {
		vi.restoreAllMocks();
		await client.execute("DROP TRIGGER IF EXISTS fail_import");
		expect((await app.inject({ method: "POST", url: "/import", payload: payload() })).statusCode).toBe(200);
		for (const name of readdirSync(images)) rmSync(join(images, name));
		writeFileSync(join(images, "preexisting.webp"), "existing full image");
		writeFileSync(join(images, "preexisting-thumb.webp"), "existing thumbnail");
		await client.execute("UPDATE medications SET image_url = 'preexisting.webp'");
	});
	afterAll(async () => {
		await app?.close();
		client?.close();
		productionDb?.db.$client.close();
		vi.unstubAllEnvs();
		rmSync(directory, { recursive: true, force: true });
	});

	it("parses defaults and legacy settings at service level without DB or file mutation", async () => {
		const before = await snapshot();
		const beforeFiles = files();
		const parsed = parseImportData(payload());
		expect(parsed.success).toBe(true);
		if (!parsed.success) throw new Error("Expected valid fixture");
		expect(parsed.data.includeSensitiveData).toBe(false);
		expect(parsed.data.settings?.language).toBe("en-US");
		expect(parsed.data.settings?.shareStockStatus).toBe(true);
		expect(parsed.data.medications[0].inventory.packCount).toBe(1);
		expect(parsed.data.doseHistory[0].takenSource).toBe("manual");
		expect(parseImportData({ version: "1.8", exportedAt: timestamp })).toMatchObject({
			success: true,
			data: { asNeededIntakes: [] },
		});
		expect(parseImportData({ version: "1.9", exportedAt: timestamp })).toEqual({
			success: false,
			issues: ["asNeededIntakes: Export format 1.9 requires asNeededIntakes"],
		});
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("bounds service schema issues and preserves path formatting", () => {
		const parsed = parseImportData({ ...payload(), medications: Array.from({ length: 20 }, () => ({})) });
		expect(parsed.success).toBe(false);
		if (parsed.success) throw new Error("Expected invalid fixture");
		expect(parsed.issues).toHaveLength(10);
		expect(parsed.issues[0]).toMatch(/^medications\.0\._exportId: /);
		expect(parseImportData({ ...payload(), settings: { userId: 99 } })).toMatchObject({ success: false });
	});

	it.each(["commit", "rollback"])("service mutation preserves real DB/filesystem %s semantics", async (outcome) => {
		const parsed = parseImportData({ ...payload(), medications: [{ ...medication(), image }] });
		if (!parsed.success) throw new Error("Expected valid fixture");
		expect(await collectImportValidationIssues(parsed.data)).toEqual([]);
		if (outcome === "rollback") {
			await client.execute(
				"CREATE TRIGGER fail_import BEFORE INSERT ON refill_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
			);
		}
		const before = await snapshot();
		const beforeFiles = files();
		const operation = importValidatedData(1, parsed.data, createImportImageFiles(images), { warn: vi.fn() });
		if (outcome === "rollback") {
			await expect(operation).rejects.toThrow('insert into "refill_history"');
			expect(await snapshot()).toEqual(before);
			expect(files()).toEqual(beforeFiles);
		} else {
			expect(await operation).toMatchObject({ medications: 1, asNeededIntakes: 1, refillHistory: 1 });
			expect((await snapshot()).map((rows) => rows.length)).toEqual([1, 2, 1, 1, 1, 1, 1]);
			expect(files()).toHaveLength(2);
			expect(files().some(([name]) => name === "preexisting.webp")).toBe(false);
		}
	});

	it("omits sensitive settings by default in the service and production route", async () => {
		await client.execute(
			"UPDATE user_settings SET notification_email = 'synthetic@example.invalid', shoutrrr_enabled = 1, shoutrrr_url = 'generic://synthetic.invalid/?token=synthetic'"
		);
		const [settings] = await productionDb.db.select().from(userSettings);
		const before = await snapshot();
		const beforeFiles = files();
		expect(buildExportSettings(undefined)).toBeUndefined();
		for (const includeSensitive of [undefined, false, true]) {
			const assembled = buildExportSettings(settings, includeSensitive);
			const url = includeSensitive === undefined ? "/export" : `/export?includeSensitive=${includeSensitive}`;
			const response = await app.inject({ method: "GET", url });
			expect(response.statusCode).toBe(200);
			const exported = response.json();
			expect(exported.settings).toEqual(JSON.parse(JSON.stringify(assembled)));
			expect(exported.includeSensitiveData).toBe(includeSensitive === true);
			expect(exported.shareLinks).toHaveLength(includeSensitive === true ? 1 : 0);
			for (const key of ["notificationEmail", "shoutrrrEnabled", "shoutrrrUrl"]) {
				expect(Object.hasOwn(exported.settings, key)).toBe(includeSensitive === true);
			}
			expect(assembled?.language).toBe("en-US");
		}
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("caps semantic issues and rejects inconsistent stock/journal/cyclic graphs without mutation", async () => {
		const before = await snapshot();
		const beforeFiles = files();
		const parsed = parseImportData(payload());
		if (!parsed.success) throw new Error("Expected valid fixture");
		parsed.data.medications.push(...Array.from({ length: 20 }, () => parsed.data.medications[0]));
		expect(await collectImportValidationIssues(parsed.data)).toEqual(
			Array.from({ length: 10 }, () => "Duplicate medication reference: med-1")
		);
		parsed.data.medications.splice(1);
		const event = parsed.data.asNeededIntakes[0];
		event.journalMood = "good";
		event.stockEffectMilli = 0;
		event.replacementForEventId = event.eventId;
		expect(await collectImportValidationIssues(parsed.data)).toEqual([
			"As-needed intake journal fields are inconsistent",
			"Applied as-needed intake has an invalid stock effect",
			"As-needed replacement target must be a different reversed event for the same medication",
			"As-needed replacement graph contains a cycle",
		]);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("assembles a complete scoped backup at service level with opt-in privacy and real image reads", async () => {
		const data = payload();
		Object.assign(data.medications[0], { image });
		Object.assign(data.settings, {
			notificationEmail: "synthetic@example.invalid",
			shoutrrrUrl: "generic://synthetic",
		});
		const validated = parseImportData(data);
		if (!validated.success) throw new Error("Expected valid fixture");
		expect(await collectImportValidationIssues(validated.data)).toEqual([]);
		await importValidatedData(1, validated.data, createImportImageFiles(images), { warn: vi.fn() });
		const before = await snapshot();
		const beforeFiles = files();
		for (const includeSensitive of [undefined, false, true]) {
			const assembled = await exportUserData(1, { includeSensitive }, images);
			const parsed = parseImportData(assembled);
			if (!parsed.success) throw new Error("Expected importable service export");
			expect(await collectImportValidationIssues(parsed.data)).toEqual([]);
			expect(assembled.medications[0]._exportId).toBe("med-1");
			expect(assembled.medications[0].image).toMatch(/^data:image\/webp;base64,/);
			expect(assembled.doseHistory).toHaveLength(1);
			expect(assembled.doseHistory[0].journalNote).toBe("Synthetic journal");
			expect(assembled.asNeededIntakes[0].eventId).toBe(data.asNeededIntakes[0].eventId);
			expect(assembled.refillHistory[0].medicationRef).toBe("med-1");
			expect(assembled.shareLinks).toHaveLength(includeSensitive === true ? 1 : 0);
			expect(JSON.stringify(assembled).includes("synthetic@example.invalid")).toBe(includeSensitive === true);
			const url = includeSensitive === undefined ? "/export" : `/export?includeSensitive=${includeSensitive}`;
			const response = await app.inject({ method: "GET", url });
			expect(response.statusCode).toBe(200);
			const exported = response.json();
			expect(exported).toEqual({ ...JSON.parse(JSON.stringify(assembled)), exportedAt: exported.exportedAt });
		}
		const withoutImages = await exportUserData(1, { includeImages: false }, images);
		expect(withoutImages.medications[0].image).toBeNull();
		const imageFreeResponse = await app.inject({ method: "GET", url: "/export?includeImages=false" });
		expect(imageFreeResponse.statusCode).toBe(200);
		expect(imageFreeResponse.json().medications[0].image).toBeNull();
		const empty = await exportUserData(999, {}, images);
		expect(empty).toMatchObject({
			medications: [],
			doseHistory: [],
			asNeededIntakes: [],
			refillHistory: [],
			shareLinks: [],
		});
		expect(empty.settings).toBeUndefined();
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("retains production image parsing, owned image sets and safe cleanup without DB mutation", async () => {
		const imageFiles = createImportImageFiles(images);
		writeFileSync(join(directory, "outside.webp"), "private test marker");
		const before = await snapshot();
		const beforeFiles = files();
		await expect(imageFiles.write("data:image/png;base64,YmFk", 999)).rejects.toThrow("Invalid image data");
		expect(imageFiles.remove("../outside.webp")).toBe("Unsafe image filename");
		expect(readFileSync(join(directory, "outside.webp"), "utf8")).toBe("private test marker");
		expect(files()).toEqual(beforeFiles);
		const filename = await imageFiles.write(image, 999);
		if (!filename) throw new Error("Expected saved image");
		expect(readdirSync(images)).toContain(filename);
		expect(readdirSync(images)).toContain(filename.replace(/\.webp$/, "-thumb.webp"));
		expect(imageFiles.remove(filename)).toBeNull();
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("keeps download headers and optional username filename formatting in the HTTP route", async () => {
		const response = await app.inject({ method: "GET", url: "/export" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toMatch(/^application\/json(?:; charset=utf-8)?$/);
		expect(response.headers["content-disposition"]).toMatch(
			/^attachment; filename="medassist-export-\d{8}-\d{4}\.json"$/
		);
		const namedApp = Fastify({ logger: false, ajv: documentationSchemaAjv });
		namedApp.addHook("onRequest", async (request) => {
			request.user = { id: 1, username: "Synthetic" } as typeof request.user;
		});
		try {
			await namedApp.register((await import("../routes/export.js")).exportRoutes);
			const namedResponse = await namedApp.inject({ method: "GET", url: "/export" });
			expect(namedResponse.statusCode).toBe(200);
			expect(namedResponse.headers["content-disposition"]).toMatch(
				/^attachment; filename="medassist-export-Synthetic-\d{8}-\d{4}\.json"$/
			);
		} finally {
			await namedApp.close();
		}
	});

	it.each(["1", ...Array.from({ length: 10 }, (_, index) => `1.${index}`)])("retains version %s", async (version) => {
		const data = { ...payload(), version, asNeededIntakes: version === "1.9" ? payload().asNeededIntakes : undefined };
		const before = await snapshot();
		const beforeFiles = files();
		expect((await app.inject({ method: "POST", url: "/import/preview", payload: data })).statusCode).toBe(200);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
		expect((await app.inject({ method: "POST", url: "/import", payload: data })).statusCode).toBe(200);
	});

	it.each([
		["unknown root field", { userId: 99 }],
		["unsafe medication field", invalidMedication({ imageUrl: "../outside.webp" })],
		[
			"invalid schedule",
			invalidMedication({ schedules: [{ ...medication().schedules[0], scheduleMode: "unsafe", weekdays: ["bad"] }] }),
		],
		["unsupported version", { version: "2.0" }],
		["bad reference", { refillHistory: [{ medicationRef: "missing", refillDate: timestamp }] }],
		["invalid image path", invalidMedication({ image: "../outside.png" })],
		["invalid decoded image", invalidMedication({ image: "data:image/png;base64,YmFk" })],
		["invalid medication date", invalidMedication({ expiryDate: "not-a-date" })],
		["invalid calendar date", invalidMedication({ expiryDate: "2026-02-30" })],
		["unsafe settings field", { settings: { userId: 99 } }],
		["unsafe inventory field", invalidMedication({ inventory: { id: 99 } })],
	])("rejects %s identically without mutation", async (_label, invalid) => {
		const data = { ...payload(), ...(invalid as Record<string, unknown>) };
		const before = await snapshot();
		const beforeFiles = files();
		const parsed = parseImportData(data);
		if (parsed.success) expect(await collectImportValidationIssues(parsed.data)).not.toHaveLength(0);
		for (const url of ["/import/preview", "/import"]) {
			const response = await app.inject({ method: "POST", url, payload: data });
			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("INVALID_IMPORT_DATA");
			expect(await snapshot()).toEqual(before);
			expect(files()).toEqual(beforeFiles);
		}
	});

	it("valid image preview is mutation-free", async () => {
		const data = payload();
		Object.assign(data.medications[0], { image });
		const before = await snapshot();
		const beforeFiles = files();
		const parsed = parseImportData(data);
		if (!parsed.success) throw new Error("Expected valid fixture");
		expect(await collectImportValidationIssues(parsed.data)).toEqual([]);
		const preview = await previewImportData(1, parsed.data);
		expect(preview).toEqual({
			version: "1.9",
			exportedAt: timestamp,
			includeSensitiveData: false,
			incoming: {
				medications: 1,
				doseHistory: 1,
				asNeededIntakes: 1,
				refillHistory: 1,
				shareLinks: 1,
				journalEntries: 1,
				imageCount: 1,
				hasSettings: true,
			},
			current: {
				medications: 1,
				doseHistory: 1,
				asNeededIntakes: 1,
				refillHistory: 1,
				shareLinks: 1,
				hasSettings: true,
			},
			warnings: {
				replacesExistingData: true,
				regeneratesShareLinks: true,
				containsImages: true,
				containsSensitiveData: false,
			},
		});
		const response = await app.inject({ method: "POST", url: "/import/preview", payload: data });
		expect(response.statusCode).toBe(200);
		expect(response.json().preview).toEqual(preview);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it.each(["full", "thumbnail"])("preserves preexisting %s on exclusive image-write failure", async (variant) => {
		const nextId =
			Number((await client.execute("SELECT seq FROM sqlite_sequence WHERE name = 'medications'")).rows[0].seq) + 1;
		const uuid = "11111111-1111-4111-8111-111111111111";
		vi.mocked(randomUUID).mockReturnValueOnce(uuid);
		const name = `med-${nextId}-${uuid}${variant === "thumbnail" ? "-thumb" : ""}.webp`;
		writeFileSync(join(images, name), "existing collision");
		const before = await snapshot();
		const beforeFiles = files();
		const data = payload();
		Object.assign(data.medications[0], { image });
		expect((await app.inject({ method: "POST", url: "/import", payload: data })).statusCode).toBe(400);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it.each(["bytes", "pixels"])("bounds decoded image %s in preview and commit", async (limit) => {
		const buffer =
			limit === "bytes"
				? Buffer.alloc(10 * 1024 * 1024 + 1)
				: await sharp({
						create: {
							width: 6500,
							height: 6500,
							channels: 3,
							background: "red",
						},
					})
						.png()
						.toBuffer();
		const data = payload();
		Object.assign(data.medications[0], { image: `data:image/png;base64,${buffer.toString("base64")}` });
		const before = await snapshot();
		const beforeFiles = files();
		const parsed = parseImportData(data);
		if (!parsed.success) throw new Error("Expected valid fixture");
		expect(await collectImportValidationIssues(parsed.data)).toHaveLength(1);
		for (const url of ["/import/preview", "/import"]) {
			expect((await app.inject({ method: "POST", url, payload: data })).statusCode).toBe(400);
			expect(await snapshot()).toEqual(before);
			expect(files()).toEqual(beforeFiles);
		}
	});

	it.each(["/import/preview", "/import"])("rejects malformed JSON at %s without mutation", async (url) => {
		const before = await snapshot();
		const beforeFiles = files();
		expect(
			(await app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: "{invalid" }))
				.statusCode
		).toBe(400);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it("rolls back the entire account graph and new images after a late SQLite failure", async () => {
		const data = payload();
		Object.assign(data.medications[0], { image });
		// A final refill insert fails after medication/image, dose/journal, settings and share writes.
		await client.execute(
			"CREATE TRIGGER fail_import BEFORE INSERT ON refill_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
		);
		const before = await snapshot();
		const nextId =
			Number((await client.execute("SELECT seq FROM sqlite_sequence WHERE name = 'medications'")).rows[0].seq) + 1;
		vi.spyOn(Date, "now").mockReturnValue(123456789);
		const collision = `med-${nextId}-123456789.webp`;
		writeFileSync(join(images, collision), "preexisting collision");
		const beforeFiles = files();
		expect((await app.inject({ method: "POST", url: "/import", payload: data })).statusCode).toBe(500);
		expect(await snapshot()).toEqual(before);
		expect(files()).toEqual(beforeFiles);
	});

	it.each(["/import/preview", "/import"])("rejects oversized JSON cleanly at %s", async (url) => {
		const before = await snapshot();
		const response = await app.inject({
			method: "POST",
			url,
			headers: { "content-type": "application/json" },
			payload: JSON.stringify({ ...payload(), padding: "x".repeat(50 * 1024 * 1024) }),
		});
		expect(response.statusCode).toBe(413);
		expect(response.json().code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
		expect(await snapshot()).toEqual(before);
	});
});
