import type { FastifyInstance } from "fastify";
import { startIntakeReminderScheduler } from "../services/intake-reminder-scheduler.js";
import { startMedicationEnrichmentService } from "../services/medication-enrichment.js";
import { startReminderScheduler } from "../services/reminder-scheduler.js";

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

export function startRuntimeSchedulers(
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
	await app.listen({ port: options.port, host });
	app.log.info(`Server running on ${options.port}`);
	const schedulerOptions =
		options.medicationEnrichmentStartupRefreshEnabled === undefined
			? {}
			: { medicationEnrichmentStartupRefreshEnabled: options.medicationEnrichmentStartupRefreshEnabled };
	startRuntimeSchedulers(app, schedulerOptions);
}
