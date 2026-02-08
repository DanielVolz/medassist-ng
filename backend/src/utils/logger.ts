/**
 * Simple startup logger that respects LOG_LEVEL environment variable.
 * Used for code that runs before Fastify is initialized (db/client.ts, migrations).
 * Once Fastify is running, use app.log instead.
 */

const LOG_LEVELS: Record<string, number> = {
	silent: 60,
	fatal: 60,
	error: 50,
	warn: 40,
	info: 30,
	debug: 20,
	trace: 10,
};

function getLevel(): number {
	const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
	return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

function shouldLog(level: string): boolean {
	return LOG_LEVELS[level] >= getLevel();
}

export const log = {
	debug(msg: string): void {
		if (shouldLog("debug")) console.log(msg);
	},
	info(msg: string): void {
		if (shouldLog("info")) console.log(msg);
	},
	warn(msg: string): void {
		if (shouldLog("warn")) console.warn(msg);
	},
	error(msg: string): void {
		if (shouldLog("error")) console.error(msg);
	},
};

/** Logger interface for services that receive a logger from the caller */
export type ServiceLogger = {
	info: (msg: string) => void;
	debug: (msg: string) => void;
	error: (msg: string) => void;
};
