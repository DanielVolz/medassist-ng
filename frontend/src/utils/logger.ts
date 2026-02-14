/**
 * Frontend logger that respects LOG_LEVEL (injected at build time via Vite define).
 * Mirrors the backend logger API so usage is consistent across the stack.
 *
 * Levels (high → low): silent > error > warn > info > debug
 * Default: "warn" — only warn and error messages are shown.
 */

declare const __LOG_LEVEL__: string;

const LOG_LEVELS: Record<string, number> = {
	silent: 50,
	error: 40,
	warn: 30,
	info: 20,
	debug: 10,
};

const configuredLevel = typeof __LOG_LEVEL__ !== "undefined" ? __LOG_LEVEL__.toLowerCase() : "warn";
const threshold = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.warn;

function shouldLog(level: string): boolean {
	return (LOG_LEVELS[level] ?? 0) >= threshold;
}

export const log = {
	debug(...args: unknown[]): void {
		if (shouldLog("debug")) console.debug(...args);
	},
	info(...args: unknown[]): void {
		if (shouldLog("info")) console.info(...args);
	},
	warn(...args: unknown[]): void {
		if (shouldLog("warn")) console.warn(...args);
	},
	error(...args: unknown[]): void {
		if (shouldLog("error")) console.error(...args);
	},
};
