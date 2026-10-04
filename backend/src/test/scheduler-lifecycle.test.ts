import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer } from "../app/startServer.js";
import { getAllUserSettings } from "../routes/settings.js";
import * as intakeScheduler from "../services/intake-reminder-scheduler.js";
import { startIntakeReminderScheduler, stopIntakeReminderScheduler } from "../services/intake-reminder-scheduler.js";
import * as enrichmentService from "../services/medication-enrichment.js";
import {
	startMedicationEnrichmentService,
	stopMedicationEnrichmentService,
} from "../services/medication-enrichment.js";
import * as reminderScheduler from "../services/reminder-scheduler.js";
import { startReminderScheduler, stopReminderScheduler } from "../services/reminder-scheduler.js";

vi.mock("../db/client.js", () => ({ db: {} }));
vi.mock("../routes/settings.js", () => ({ getAllUserSettings: vi.fn() }));
vi.mock("../services/notifications/state.js", () => ({
	loadReminderState: () => ({ notifiedMedications: [] }),
	saveReminderState: vi.fn(),
	updateUserReminderSentTime: vi.fn(),
	updateReminderSentTime: vi.fn(),
}));
vi.mock("../services/notifications/delivery.js", () => ({
	getSmtpConfig: vi.fn(),
	sendEmailNotification: vi.fn(),
	sendPushNotification: vi.fn(),
}));

function barrier<T>() {
	let release!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const settings = vi.mocked(getAllUserSettings);

describe("runtime scheduler lifecycles", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
		settings.mockReset().mockResolvedValue([]);
	});

	afterEach(() => {
		stopIntakeReminderScheduler();
		stopReminderScheduler();
		stopMedicationEnrichmentService();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("starts intake once, skips overlapping ticks visibly, and retains single-flight across stop/restart", async () => {
		const pending = barrier<Awaited<ReturnType<typeof getAllUserSettings>>>();
		settings.mockReturnValueOnce(pending.promise);
		startIntakeReminderScheduler(logger);
		startIntakeReminderScheduler(logger);
		expect(settings).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		expect(logger.info).toHaveBeenCalledWith(
			"[IntakeReminder] Scheduler already started, skipping duplicate start call"
		);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(settings).toHaveBeenCalledTimes(1);
		expect(logger.info).toHaveBeenCalledWith(
			"[IntakeReminder] Skipping overlapping scheduler check; previous check still in flight"
		);
		stopIntakeReminderScheduler();
		stopIntakeReminderScheduler();
		expect(vi.getTimerCount()).toBe(0);
		startIntakeReminderScheduler(logger);
		expect(settings).toHaveBeenCalledTimes(1);
		pending.release([]);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(59_999);
		expect(settings).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(settings).toHaveBeenCalledTimes(2);
		stopIntakeReminderScheduler();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(settings).toHaveBeenCalledTimes(2);
		startIntakeReminderScheduler(logger);
		expect(settings).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(0);
	});

	it("logs startup and scheduled failures and releases the intake guard for the next minute", async () => {
		const failure = new Error("settings unavailable");
		settings.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
		startIntakeReminderScheduler(logger);
		await vi.advanceTimersByTimeAsync(0);
		expect(logger.error).toHaveBeenCalledWith("[IntakeReminder] Startup check failed", failure);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(logger.error).toHaveBeenCalledWith("[IntakeReminder] Scheduled check failed", failure);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(settings).toHaveBeenCalledTimes(3);
	});

	it("stops enrichment ticks without aborting the shared in-flight refresh, and permits restart", async () => {
		const pending = barrier<Response>();
		const fetchMock = vi.fn().mockReturnValue(pending.promise);
		vi.stubGlobal("fetch", fetchMock);
		startMedicationEnrichmentService(logger);
		startMedicationEnrichmentService(logger);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(2); // Scheduler interval plus existing request timeout.
		stopMedicationEnrichmentService();
		stopMedicationEnrichmentService();
		expect(vi.getTimerCount()).toBe(1);
		expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
		startMedicationEnrichmentService(logger);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		pending.release(new Response("[]"));
		await vi.advanceTimersByTimeAsync(0);
		expect(logger.info).toHaveBeenCalledWith("[MedicationEnrichment] EMA catalog refreshed (startup) with 0 entries");
		expect(vi.getTimerCount()).toBe(1);
		stopMedicationEnrichmentService();
		await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("propagates listen failures without starting scheduler timers", async () => {
		const app = Fastify();
		const failure = new Error("listen failed");
		vi.spyOn(app, "listen").mockRejectedValue(failure);
		try {
			await expect(startServer(app, { port: 0 })).rejects.toBe(failure);
			expect(vi.getTimerCount()).toBe(0);
			expect(settings).not.toHaveBeenCalled();
		} finally {
			await app.close();
		}
	});

	it.each([
		false,
		true,
	])("shares scheduler ownership only after successful listen (B succeeds: %s)", async (succeeds) => {
		const a = Fastify();
		const b = Fastify();
		const starts = [
			vi.spyOn(reminderScheduler, "startReminderScheduler"),
			vi.spyOn(enrichmentService, "startMedicationEnrichmentService"),
			vi.spyOn(intakeScheduler, "startIntakeReminderScheduler"),
		];
		const stops = [
			vi.spyOn(reminderScheduler, "stopReminderScheduler"),
			vi.spyOn(enrichmentService, "stopMedicationEnrichmentService"),
			vi.spyOn(intakeScheduler, "stopIntakeReminderScheduler"),
		];
		vi.spyOn(a, "listen").mockImplementation(async () => {
			await a.ready();
			return "no-port";
		});
		const failure = new Error("B listen failed");
		vi.spyOn(b, "listen").mockImplementation(async () => {
			await b.ready();
			if (!succeeds) throw failure;
			return "no-port";
		});
		const options = { port: 0, medicationEnrichmentStartupRefreshEnabled: false };
		try {
			await startServer(a, options);
			if (succeeds) await startServer(b, options);
			else {
				await expect(startServer(b, options)).rejects.toBe(failure);
				await b.close();
			}
			for (const start of starts) expect(start).toHaveBeenCalledTimes(1);
			for (const stop of stops) expect(stop).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(3);
			await a.close();
			for (const stop of stops) expect(stop).toHaveBeenCalledTimes(succeeds ? 0 : 1);
			expect(vi.getTimerCount()).toBe(succeeds ? 3 : 0);
			await b.close();
			for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await a.close();
			await b.close();
		}
	});

	it("cleans up a synchronous scheduler startup failure and lets the next app own the schedulers", async () => {
		const failedApp = Fastify();
		const healthyApp = Fastify();
		const startReminder = startReminderScheduler;
		const startIntake = vi.spyOn(intakeScheduler, "startIntakeReminderScheduler");
		const startEnrichment = vi.spyOn(enrichmentService, "startMedicationEnrichmentService");
		const startReminderSpy = vi.spyOn(reminderScheduler, "startReminderScheduler");
		const stopReminder = vi.spyOn(reminderScheduler, "stopReminderScheduler");
		const stopEnrichment = vi.spyOn(enrichmentService, "stopMedicationEnrichmentService");
		const stopIntake = vi.spyOn(intakeScheduler, "stopIntakeReminderScheduler");
		const failedClose = vi.spyOn(failedApp, "close");
		for (const app of [failedApp, healthyApp]) {
			vi.spyOn(app, "listen").mockImplementation(async () => {
				await app.ready();
				return "no-port";
			});
		}
		const failure = new Error("reminder scheduler startup failed");
		startReminderSpy.mockImplementationOnce((serviceLogger) => {
			startReminder(serviceLogger);
			throw failure;
		});

		try {
			await expect(
				startServer(failedApp, {
					port: 0,
					medicationEnrichmentStartupRefreshEnabled: false,
				})
			).rejects.toBe(failure);
			expect(failedClose).toHaveBeenCalledTimes(1);
			expect(stopReminder).toHaveBeenCalledTimes(1);
			expect(stopEnrichment).toHaveBeenCalledTimes(1);
			expect(stopIntake).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);

			await startServer(healthyApp, {
				port: 0,
				medicationEnrichmentStartupRefreshEnabled: false,
			});
			expect(startReminderSpy).toHaveBeenCalledTimes(2);
			expect(startEnrichment).toHaveBeenCalledTimes(1);
			expect(startIntake).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(3);

			await failedApp.close();
			expect(stopReminder).toHaveBeenCalledTimes(1);
			expect(stopEnrichment).toHaveBeenCalledTimes(1);
			expect(stopIntake).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(3);

			await healthyApp.close();
			expect(stopReminder).toHaveBeenCalledTimes(2);
			expect(stopEnrichment).toHaveBeenCalledTimes(2);
			expect(stopIntake).toHaveBeenCalledTimes(2);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await failedApp.close();
			await healthyApp.close();
		}
	});

	it("registers shutdown before listen and app.close clears all three real scheduler timers without a port", async () => {
		const app = Fastify();
		vi.spyOn(app, "listen").mockImplementation(async () => {
			await app.ready(); // Adding a close hook after this would fail.
			return "no-port";
		});
		try {
			await startServer(app, { port: 0, medicationEnrichmentStartupRefreshEnabled: false });
			await vi.advanceTimersByTimeAsync(0);
			expect(app.listen).toHaveBeenCalledWith({ port: 0, host: "0.0.0.0" });
			expect(vi.getTimerCount()).toBe(3);
			await app.close();
			expect(vi.getTimerCount()).toBe(0);
			const checksAtClose = settings.mock.calls.length;
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(settings).toHaveBeenCalledTimes(checksAtClose);
		} finally {
			await app.close();
		}
	});
});
