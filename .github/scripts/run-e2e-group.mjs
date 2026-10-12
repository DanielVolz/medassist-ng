import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlaywrightArgs, checkRepositorySpecInventory } from "./select-e2e.mjs";

function run() {
	checkRepositorySpecInventory();
	const group = process.env.E2E_GROUP;
	if (!group) throw new Error("E2E_GROUP is required.");

	const cliPath = path.resolve(process.cwd(), "node_modules/playwright/cli.js");
	if (!existsSync(path.resolve(process.cwd(), "playwright.stable.config.ts")) || !existsSync(cliPath)) {
		throw new Error("Run this script from frontend/ after installing frontend dependencies.");
	}

	const args = [cliPath, ...buildPlaywrightArgs(group), ...process.argv.slice(2)];
	const result = spawnSync(process.execPath, args, {
		cwd: process.cwd(),
		env: {
			...process.env,
			...(group === "ui" ? { PLAYWRIGHT_UI_TESTS: "true" } : {}),
		},
		stdio: "inherit",
	});

	if (result.error) throw result.error;
	if (result.signal) throw new Error(`Playwright was terminated by ${result.signal}.`);
	process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		run();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

export { run };
