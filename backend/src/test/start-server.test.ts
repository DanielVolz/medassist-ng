import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
	startReminderScheduler: vi.fn(),
	startMedicationEnrichmentService: vi.fn(),
	startIntakeReminderScheduler: vi.fn(),
	stopReminderScheduler: vi.fn(),
	stopMedicationEnrichmentService: vi.fn(),
	stopIntakeReminderScheduler: vi.fn(),
}));

vi.mock("../services/reminder-scheduler.js", () => ({
	startReminderScheduler: schedulerMocks.startReminderScheduler,
	stopReminderScheduler: schedulerMocks.stopReminderScheduler,
}));
vi.mock("../services/medication-enrichment.js", () => ({
	startMedicationEnrichmentService: schedulerMocks.startMedicationEnrichmentService,
	stopMedicationEnrichmentService: schedulerMocks.stopMedicationEnrichmentService,
}));
vi.mock("../services/intake-reminder-scheduler.js", () => ({
	startIntakeReminderScheduler: schedulerMocks.startIntakeReminderScheduler,
	stopIntakeReminderScheduler: schedulerMocks.stopIntakeReminderScheduler,
}));

import { startServer } from "../app/startServer.js";

function createApp(listen: FastifyInstance["listen"]): FastifyInstance {
	const onCloseHooks: Array<() => Promise<void>> = [];
	let app: FastifyInstance;

	app = {
		listen,
		addHook: vi.fn((hookName: string, hook: () => Promise<void>) => {
			if (hookName === "onClose") {
				onCloseHooks.push(hook);
			}
			return app;
		}),
		close: vi.fn(async () => {
			for (const hook of onCloseHooks) {
				await hook();
			}
		}),
		log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
	} as unknown as FastifyInstance;

	return app;
}

describe("startServer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("listens before starting each runtime scheduler and forwards startup options", async () => {
		const startupOrder: string[] = [];
		const listen = vi.fn(async () => {
			startupOrder.push("listen");
			return "http://127.0.0.1:43123";
		});
		schedulerMocks.startReminderScheduler.mockImplementation(() => startupOrder.push("reminder"));
		schedulerMocks.startMedicationEnrichmentService.mockImplementation(() => startupOrder.push("enrichment"));
		schedulerMocks.startIntakeReminderScheduler.mockImplementation(() => startupOrder.push("intake-reminder"));
		const app = createApp(listen);

		await startServer(app, {
			port: 43123,
			host: "127.0.0.1",
			medicationEnrichmentStartupRefreshEnabled: false,
		});

		try {
			expect(listen).toHaveBeenCalledWith({ port: 43123, host: "127.0.0.1" });
			expect(app.addHook).toHaveBeenCalledWith("onClose", expect.any(Function));
			expect(schedulerMocks.startReminderScheduler).toHaveBeenCalledOnce();
			expect(schedulerMocks.startMedicationEnrichmentService).toHaveBeenCalledWith(expect.any(Object), {
				startupRefreshEnabled: false,
			});
			expect(schedulerMocks.startIntakeReminderScheduler).toHaveBeenCalledOnce();
			expect(startupOrder).toEqual(["listen", "reminder", "enrichment", "intake-reminder"]);
		} finally {
			await app.close();
		}

		expect(schedulerMocks.stopReminderScheduler).toHaveBeenCalledOnce();
		expect(schedulerMocks.stopMedicationEnrichmentService).toHaveBeenCalledOnce();
		expect(schedulerMocks.stopIntakeReminderScheduler).toHaveBeenCalledOnce();
	});

	it("does not start runtime schedulers if listening fails", async () => {
		const listenError = new Error("listen failed");
		const app = createApp(vi.fn(async () => Promise.reject(listenError)));

		await expect(startServer(app, { port: 43123 })).rejects.toBe(listenError);
		expect(app.addHook).toHaveBeenCalledWith("onClose", expect.any(Function));
		expect(schedulerMocks.startReminderScheduler).not.toHaveBeenCalled();
		expect(schedulerMocks.startMedicationEnrichmentService).not.toHaveBeenCalled();
		expect(schedulerMocks.startIntakeReminderScheduler).not.toHaveBeenCalled();

		await app.close();
		expect(schedulerMocks.stopReminderScheduler).not.toHaveBeenCalled();
		expect(schedulerMocks.stopMedicationEnrichmentService).not.toHaveBeenCalled();
		expect(schedulerMocks.stopIntakeReminderScheduler).not.toHaveBeenCalled();
	});
});
