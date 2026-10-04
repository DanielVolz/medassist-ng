import type { FastifyInstance } from "fastify";
import { startIntakeReminderScheduler, stopIntakeReminderScheduler } from "../services/intake-reminder-scheduler.js";
import {
	startMedicationEnrichmentService,
	stopMedicationEnrichmentService,
} from "../services/medication-enrichment.js";
import { startReminderScheduler, stopReminderScheduler } from "../services/reminder-scheduler.js";

const schedulerOwners = new Set<FastifyInstance>();

export interface StartServerOptions {
	port: number;
	host?: string;
	medicationEnrichmentStartupRefreshEnabled?: boolean;
}

function buildFastifyServiceLogger(app: FastifyInstance) {
	return {
		info: (msg: string) => app.log.info(msg),
		debug: (msg: string) => app.log.debug(msg),
		warn: (msg: string) => app.log.warn(msg),
		error: (msg: string, error?: unknown) => {
			if (error === undefined) {
				app.log.error(msg);
				return;
			}
			app.log.error({ err: error }, msg);
		},
	};
}

function startRuntimeSchedulers(
	app: FastifyInstance,
	options: Pick<StartServerOptions, "medicationEnrichmentStartupRefreshEnabled"> = {}
): void {
	const serviceLogger = buildFastifyServiceLogger(app);
	const medicationEnrichmentOptions =
		options.medicationEnrichmentStartupRefreshEnabled === undefined
			? {}
			: { startupRefreshEnabled: options.medicationEnrichmentStartupRefreshEnabled };
	startReminderScheduler(serviceLogger);
	startMedicationEnrichmentService(serviceLogger, medicationEnrichmentOptions);
	startIntakeReminderScheduler(serviceLogger);
}

export async function startServer(app: FastifyInstance, options: StartServerOptions): Promise<void> {
	const host = options.host ?? "0.0.0.0";
	app.addHook("onClose", async () => {
		if (!schedulerOwners.delete(app) || schedulerOwners.size > 0) return;
		stopReminderScheduler();
		stopMedicationEnrichmentService();
		stopIntakeReminderScheduler();
	});
	await app.listen({ port: options.port, host });
	const firstOwner = schedulerOwners.size === 0;
	if (firstOwner) {
		const schedulerOptions =
			options.medicationEnrichmentStartupRefreshEnabled === undefined
				? {}
				: { medicationEnrichmentStartupRefreshEnabled: options.medicationEnrichmentStartupRefreshEnabled };
		try {
			startRuntimeSchedulers(app, schedulerOptions);
		} catch (error) {
			stopReminderScheduler();
			stopMedicationEnrichmentService();
			stopIntakeReminderScheduler();
			try {
				await app.close();
			} catch (closeError) {
				app.log.error({ err: closeError }, "Server cleanup failed after scheduler startup error");
			}
			throw error;
		}
	}
	schedulerOwners.add(app);
	app.log.info(`Server running on ${options.port}`);
}
