import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = resolve(root, "scripts/dev-ui.mjs");

function listen(port) {
	return new Promise((resolveListen, reject) => {
		const server = createServer((_request, response) => response.end("foreign server"));
		server.on("request", () => {
			server.requests = (server.requests ?? 0) + 1;
		});
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolveListen(server));
	});
}

function close(server) {
	return new Promise((resolveClose, reject) =>
		server.close((error) => (error ? reject(error) : resolveClose()))
	);
}

function portIsOpen(port) {
	return new Promise((resolveOpen) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolveOpen(true);
		});
		socket.once("error", () => resolveOpen(false));
	});
}

function runLauncher() {
	return new Promise((resolveRun, reject) => {
		const child = spawn(process.execPath, [launcher], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		let settled = false;
		const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			settled = true;
			clearTimeout(timer);
			resolveRun({ code, signal, output });
		});
		timer.unref();
		setTimeout(() => {
			if (!settled) child.kill("SIGKILL");
		}, 125_000).unref();
	});
}

test("direct backend entry rejects unsafe settings before importing the database", () => {
	const backendEntry = resolve(root, "backend/src/ui-sandbox.ts");
	const tsxCli = resolve(root, "backend/node_modules/tsx/dist/cli.mjs");
	const result = spawnSync(process.execPath, [tsxCli, backendEntry], {
		cwd: root,
		encoding: "utf8",
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			NODE_ENV: "production",
			AUTH_ENABLED: "false",
			ALLOW_UNAUTHENTICATED: "true",
			DATA_DIR: resolve(root, "data"),
		},
		timeout: 15_000,
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /must be started by its launcher/);
	assert.doesNotMatch(result.stderr, /Backend listening/);
});

test("the UI Vite server opts out of environment-file loading", () => {
	const viteEntry = readFileSync(resolve(root, "frontend/scripts/ui-sandbox-vite.mjs"), "utf8");
	assert.match(viteEntry, /envDir:\s*false/);
});

test("an occupied backend port receives no launcher requests or frontend sibling", async () => {
	const foreign = await listen(5177);
	try {
		const result = await runLauncher();
		assert.notEqual(result.code, 0, result.output);
		assert.match(result.output, /Backend exited before becoming ready|Backend failed to start/);
		assert.equal(foreign.requests ?? 0, 0);
		assert.equal(await portIsOpen(5176), false);
	} finally {
		await close(foreign);
	}
});

test("an occupied frontend port is not probed and the owned backend stops", async () => {
	const foreign = await listen(5176);
	try {
		const result = await runLauncher();
		assert.notEqual(result.code, 0, result.output);
		assert.match(result.output, /Frontend exited before becoming ready|Frontend failed to start/);
		assert.equal(foreign.requests ?? 0, 0);
		assert.equal(await portIsOpen(5177), false);
	} finally {
		await close(foreign);
	}
});
