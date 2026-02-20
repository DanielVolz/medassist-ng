import { describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("../../utils/logger");

async function loadLogger(level?: string): Promise<LoggerModule["log"]> {
	vi.resetModules();
	if (typeof level === "string") {
		Object.defineProperty(globalThis, "__LOG_LEVEL__", {
			value: level,
			configurable: true,
			writable: true,
		});
	} else {
		Reflect.deleteProperty(globalThis, "__LOG_LEVEL__");
	}
	const mod = await import("../../utils/logger");
	return mod.log;
}

describe("frontend logger", () => {
	it("defaults to warn threshold", async () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const log = await loadLogger();
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");

		expect(debugSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledWith("w");
		expect(errorSpy).toHaveBeenCalledWith("e");
	});

	it("logs everything at debug level", async () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const log = await loadLogger("debug");
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");

		expect(debugSpy).toHaveBeenCalledWith("d");
		expect(infoSpy).toHaveBeenCalledWith("i");
		expect(warnSpy).toHaveBeenCalledWith("w");
		expect(errorSpy).toHaveBeenCalledWith("e");
	});

	it("suppresses all logs at silent level", async () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const log = await loadLogger("silent");
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");

		expect(debugSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
