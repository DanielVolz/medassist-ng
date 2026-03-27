import { afterEach, describe, expect, it, vi } from "vitest";

type ClientTestOptions = {
	dirWritable?: boolean;
	authEnabled?: boolean;
};

async function loadDbClientModule(options: ClientTestOptions = {}) {
	const { dirWritable = true, authEnabled = false } = options;

	vi.resetModules();
	vi.restoreAllMocks();

	process.env.AUTH_ENABLED = authEnabled ? "true" : "false";
	process.env.DOTENV_PATH = "/tmp/medassist-nonexistent.env";

	const existsSync = vi.fn().mockReturnValue(false);
	const statSync = vi.fn().mockReturnValue({ mode: 0o40755, uid: 1000, gid: 1000 });
	vi.doMock("node:fs", () => ({ existsSync, statSync }));

	const dotenvConfig = vi.fn();
	vi.doMock("dotenv", () => ({ default: { config: dotenvConfig } }));

	const createClient = vi.fn().mockReturnValue({ execute: vi.fn() });
	vi.doMock("@libsql/client", () => ({ createClient }));

	const drizzle = vi.fn().mockReturnValue({ __db: true });
	vi.doMock("drizzle-orm/libsql", () => ({ drizzle }));

	const ensureDataDirectory = vi
		.fn()
		.mockReturnValue(dirWritable ? { success: true } : { success: false, error: "permission denied" });
	const getDbPaths = vi.fn().mockReturnValue({
		dataDir: "/tmp/medassist-data",
		dbPath: "/tmp/medassist-data/medassist-ng.db",
		url: "file:/tmp/medassist-data/medassist-ng.db",
	});
	const runDrizzleMigrations = vi.fn().mockResolvedValue({ success: true });
	const runAlterMigrations = vi.fn().mockResolvedValue({ errors: [] });
	const repairTrailingHyphenDoseIds = vi.fn().mockResolvedValue({ repaired: 0, errors: [] });
	const repairOrphanedDoseIds = vi.fn().mockResolvedValue({ repaired: 0, errors: [] });
	const ensureDefaultUser = vi.fn().mockResolvedValue(false);

	vi.doMock("../db/path-utils.js", () => ({
		getDataDir: vi.fn(),
		buildDbUrl: vi.fn(),
		ensureDataDirectory,
		getDbPaths,
	}));

	vi.doMock("../db/migration-utils.js", () => ({
		runDrizzleMigrations,
		runAlterMigrations,
		ensureDefaultUser,
	}));

	vi.doMock("../db/repair-utils.js", () => ({
		repairTrailingHyphenDoseIds,
		repairOrphanedDoseIds,
	}));

	const log = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	vi.doMock("../utils/logger.js", () => ({ log }));

	const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		throw new Error(`process.exit:${code ?? 0}`);
	}) as never);

	const modulePromise = import("../db/client.js");

	return {
		modulePromise,
		mocks: {
			existsSync,
			statSync,
			dotenvConfig,
			createClient,
			drizzle,
			ensureDataDirectory,
			getDbPaths,
			runDrizzleMigrations,
			runAlterMigrations,
			repairTrailingHyphenDoseIds,
			repairOrphanedDoseIds,
			ensureDefaultUser,
			log,
			exitSpy,
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("db/client bootstrap", () => {
	it("initializes db and runs migrations when directory is writable", async () => {
		const { modulePromise, mocks } = await loadDbClientModule({ dirWritable: true, authEnabled: false });
		const mod = await modulePromise;

		expect(mod.db).toBeTruthy();
		expect(mod.migrationsReady).toBeInstanceOf(Promise);
		await mod.migrationsReady;

		expect(mocks.ensureDataDirectory).toHaveBeenCalledWith("/tmp/medassist-data");
		expect(mocks.createClient).toHaveBeenCalledWith({ url: "file:/tmp/medassist-data/medassist-ng.db" });
		expect(mocks.runDrizzleMigrations).toHaveBeenCalledTimes(1);
		expect(mocks.runAlterMigrations).toHaveBeenCalledTimes(1);
		expect(mocks.repairTrailingHyphenDoseIds).toHaveBeenCalledTimes(1);
		expect(mocks.repairOrphanedDoseIds).toHaveBeenCalledTimes(1);
		expect(mocks.ensureDefaultUser).toHaveBeenCalledWith(expect.anything(), false);
	});

	it("passes auth-enabled flag to ensureDefaultUser", async () => {
		const { modulePromise, mocks } = await loadDbClientModule({ dirWritable: true, authEnabled: true });
		const mod = await modulePromise;
		await mod.migrationsReady;

		expect(mocks.ensureDefaultUser).toHaveBeenCalledWith(expect.anything(), true);
	});

	it("exits when data directory is not writable", async () => {
		const { modulePromise } = await loadDbClientModule({ dirWritable: false });
		await expect(modulePromise).rejects.toThrow("process.exit:1");
	});
});
