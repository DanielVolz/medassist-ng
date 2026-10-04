import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCli = path.join(frontendRoot, "node_modules", "@playwright", "test", "cli.js");

export const browserBatches = [
	{ name: "chromium", projects: ["chromium", "chromium-data"] },
	{ name: "firefox", projects: ["firefox"] },
	{ name: "webkit", projects: ["webkit"] },
];

export function createBatchEnvironment(batch, root, frontendPort, backendPort, sourceEnv = process.env) {
	const batchRoot = path.join(root, batch.name);
	return {
		...sourceEnv,
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
		PLAYWRIGHT_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
		PLAYWRIGHT_FRONTEND_PORT: String(frontendPort),
		PLAYWRIGHT_DATA_DIR: path.join(batchRoot, "data"),
		PLAYWRIGHT_AUTH_FILE: path.join(batchRoot, "auth", "user.json"),
		PLAYWRIGHT_HTML_OPEN: "never",
		PLAYWRIGHT_REUSE_EXISTING_SERVER: "false",
	};
}

async function getFreePort(usedPorts) {
	while (true) {
		const server = net.createServer();
		const port = await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					reject(new Error("Could not allocate a local Playwright port"));
					return;
				}
				resolve(address.port);
			});
		});
		await new Promise((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		if (!usedPorts.has(port)) {
			usedPorts.add(port);
			return port;
		}
	}
}

async function runBatch(batch, root, extraArgs) {
	const usedPorts = new Set();
	const frontendPort = await getFreePort(usedPorts);
	const backendPort = await getFreePort(usedPorts);
	const env = createBatchEnvironment(batch, root, frontendPort, backendPort);
	const args = [
		playwrightCli,
		"test",
		"--config=playwright.all.config.ts",
		...batch.projects.map((project) => `--project=${project}`),
		"--reporter=list",
		`--output=${path.join(root, batch.name, "results")}`,
		...extraArgs,
	];

	console.log(`\nRunning ${batch.name} with isolated backend data and ports ${frontendPort}/${backendPort}`);
	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd: frontendRoot, env, stdio: "inherit" });
		const forwardSignal = (signal) => child.kill(signal);
		process.once("SIGINT", forwardSignal);
		process.once("SIGTERM", forwardSignal);
		child.once("error", (error) => {
			process.off("SIGINT", forwardSignal);
			process.off("SIGTERM", forwardSignal);
			reject(error);
		});
		child.once("exit", (code, signal) => {
			process.off("SIGINT", forwardSignal);
			process.off("SIGTERM", forwardSignal);
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${batch.name} Playwright run failed${signal ? ` with signal ${signal}` : ` (exit ${code})`}`));
		});
	});
}

export async function runAllBrowsers(extraArgs = process.argv.slice(2), runner = {}) {
	const createRoot = runner.createRoot ?? (() => mkdtemp(path.join(os.tmpdir(), "medassist-playwright-all-")));
	const executeBatch = runner.runBatch ?? runBatch;
	const removeRoot = runner.removeRoot ?? ((root) => rm(root, { recursive: true, force: true }));
	const reportRetainedRoot =
		runner.reportRetainedRoot ?? ((root) => console.error(`Playwright failure artifacts retained at ${root}`));
	const root = await createRoot();
	let succeeded = false;
	try {
		for (const batch of browserBatches) {
			await executeBatch(batch, root, extraArgs);
		}
		succeeded = true;
	} finally {
		if (succeeded) {
			await removeRoot(root);
		} else {
			reportRetainedRoot(root);
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runAllBrowsers().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
