import { beforeEach, describe, expect, it, vi } from "vitest";

const startupMocks = vi.hoisted(() => ({
	migrationsReady: Promise.resolve(),
	createApp: vi.fn(),
	startServer: vi.fn(),
	ensureImagesDirectory: vi.fn(() => "/tmp/medassist-test-images"),
	buildRuntimeAppOptions: vi.fn(() => ({ imagesDir: "/tmp/medassist-test-images" })),
	log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../db/client.js", () => ({ migrationsReady: startupMocks.migrationsReady }));
vi.mock("../app/createApp.js", () => ({ createApp: startupMocks.createApp }));
vi.mock("../app/startServer.js", () => ({ startServer: startupMocks.startServer }));
vi.mock("../plugins/env.js", () => ({
	env: {
		PORT: 43123,
		MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: false,
	},
}));
vi.mock("../utils/logger.js", () => ({ log: startupMocks.log }));
vi.mock("../utils/server-config.js", () => ({
	buildAppConfig: vi.fn(),
	buildBaseCookieOptions: vi.fn(),
	buildRefreshCookieOptions: vi.fn(),
	buildRuntimeAppOptions: startupMocks.buildRuntimeAppOptions,
	ensureImagesDirectory: startupMocks.ensureImagesDirectory,
	getJwtConfig: vi.fn(),
	parseCorsOrigins: vi.fn(),
}));

describe("runtime entrypoint startup ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("waits for migrations before creating the app or listening", async () => {
		let resolveMigrations!: () => void;
		let resolveStarted!: () => void;
		const migrationsReady = new Promise<void>((resolve) => {
			resolveMigrations = resolve;
		});
		const startupReached = new Promise<void>((resolve) => {
			resolveStarted = resolve;
		});
		const app = {};
		startupMocks.migrationsReady = migrationsReady;
		startupMocks.createApp.mockResolvedValue(app);
		startupMocks.startServer.mockImplementation(async () => {
			resolveStarted();
		});

		const entrypoint = import("../index.js");
		expect(startupMocks.createApp).not.toHaveBeenCalled();
		expect(startupMocks.ensureImagesDirectory).not.toHaveBeenCalled();
		expect(startupMocks.startServer).not.toHaveBeenCalled();

		resolveMigrations();
		await startupReached;
		await entrypoint;
		expect(startupMocks.createApp).toHaveBeenCalledOnce();
		expect(startupMocks.startServer).toHaveBeenCalledWith(app, {
			port: 43123,
			host: "0.0.0.0",
			medicationEnrichmentStartupRefreshEnabled: false,
		});
	});
});
