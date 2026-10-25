import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSandboxBackendEnv, resolveSandboxNetwork } from "./index.mjs";
import { sandboxViteOptions } from "../../frontend/scripts/ui-sandbox-vite.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = resolve(root, "tools/ui-sandbox/index.mjs");

async function withNetworkFixture(url, addresses, local, run) {
	const projectRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-network-"));
	writeFileSync(resolve(projectRoot, ".env"), `PUBLIC_APP_URL=${url}\nDEFAULT_NOTIFICATION_EMAIL=not-forwarded@example.invalid\n`);
	try {
		const network = await resolveSandboxNetwork(projectRoot, {
			lookup: async () => addresses.map((address) => ({ address })),
			networkInterfaces: () => ({ en0: local.map((address) => ({ address, internal: false })) }),
		});
		await run(network, projectRoot);
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
}

test("sandbox network rewrites production scheme, port, path, query and fragment", async () => {
	await withNetworkFixture("https://sandbox.example:8443/production/path?secret=fixture#section", ["192.168.1.20"], ["192.168.1.20"], (network, projectRoot) => {
		assert.deepEqual(network, { host: "192.168.1.20", publicAppUrl: "http://sandbox.example:5176/" });
		const backend = buildSandboxBackendEnv(projectRoot, {}, network);
		assert.equal(backend.PUBLIC_APP_URL, network.publicAppUrl);
		assert.equal(backend.CORS_ORIGINS, "http://127.0.0.1:5176,http://sandbox.example:5176");
		assert.equal(backend.DEFAULT_NOTIFICATION_EMAIL, undefined);
		const frontend = sandboxViteOptions({ UI_SANDBOX_HOST: network.host, PUBLIC_APP_URL: backend.PUBLIC_APP_URL });
		assert.equal(frontend.server.host, "192.168.1.20");
		assert.ok(frontend.server.allowedHosts.includes("sandbox.example"));
		assert.equal(frontend.envDir, false);
	});
});

test("sandbox network requires every resolved address to be private and assigned locally", async () => {
	for (const address of ["10.1.2.3", "172.16.0.2", "172.31.255.2", "192.168.1.20"]) {
		await withNetworkFixture("https://sandbox.example", [address], [address], (network) => assert.equal(network.host, address));
	}
	for (const [addresses, local] of [
		[["192.168.1.20"], ["192.168.1.21"]],
		[["203.0.113.10"], ["203.0.113.10"]],
		[["127.0.0.1"], ["127.0.0.1"]],
		[["172.15.0.1"], ["172.15.0.1"]],
		[["172.32.0.1"], ["172.32.0.1"]],
		[["169.254.1.1"], ["169.254.1.1"]],
		[["::1"], ["::1"]],
		[["192.168.1.20", "203.0.113.10"], ["192.168.1.20"]],
		[["192.168.1.20", "192.168.1.21"], ["192.168.1.20", "192.168.1.21"]],
		[[], ["192.168.1.20"]],
	]) {
		await withNetworkFixture("https://sandbox.example", addresses, local, (network, projectRoot) => {
			assert.deepEqual(network, { host: "127.0.0.1", publicAppUrl: undefined });
			assert.equal(buildSandboxBackendEnv(projectRoot, {}, network).PUBLIC_APP_URL, undefined);
			assert.equal(sandboxViteOptions({ UI_SANDBOX_HOST: network.host }).server.host, "127.0.0.1");
		});
	}
});

test("sandbox network fails closed for malformed URLs, credentials and failed DNS", async () => {
	for (const url of ["not-a-url", "ftp://sandbox.example", "https://user:password@sandbox.example"]) {
		await withNetworkFixture(url, ["192.168.1.20"], ["192.168.1.20"], (network) => assert.equal(network.publicAppUrl, undefined));
	}
	const projectRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-network-"));
	try {
		assert.deepEqual(await resolveSandboxNetwork(projectRoot), { host: "127.0.0.1", publicAppUrl: undefined });
		writeFileSync(resolve(projectRoot, ".env"), "PUBLIC_APP_URL=https://sandbox.example\n");
		const network = await resolveSandboxNetwork(projectRoot, { lookup: async () => { throw new Error("DNS unavailable"); } });
		assert.equal(network.publicAppUrl, undefined);
		const internalNetwork = await resolveSandboxNetwork(projectRoot, {
			lookup: async () => [{ address: "192.168.1.20" }],
			networkInterfaces: () => ({ lo0: [{ address: "192.168.1.20", internal: true }] }),
		});
		assert.equal(internalNetwork.publicAppUrl, undefined);
		assert.equal(sandboxViteOptions({}).server.host, "127.0.0.1");
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
});

test("sandbox backend environment includes only the SMTP allowlist from repository env", () => {
	const projectRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-sandbox-"));
	const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_TOKEN", "SMTP_FROM", "SMTP_SECURE"];
	const smtpEntries = smtpKeys.map((key) => `${key}=sandbox-test-${key}`).join("\n");
	const excludedEntries = [
		"PUBLIC_APP_URL=https://production.example",
		"DEFAULT_NOTIFICATION_EMAIL=production@example.invalid",
		"DEFAULT_SHOUTRRR_URL=ntfy://production-topic",
		"NTFY_URL=https://ntfy.example/production-topic",
		"AUTH_SECRET=production-auth-secret",
		"DATABASE_URL=file:production.db",
		"DB_PATH=production.db",
	].join("\n");
	writeFileSync(resolve(projectRoot, ".env"), `${smtpEntries}\n${excludedEntries}\n`);

	try {
		const backendEnv = buildSandboxBackendEnv(projectRoot, {
			PATH: "/usr/bin",
			PUBLIC_APP_URL: "https://inherited.example",
			DEFAULT_NOTIFICATION_EMAIL: "inherited@example.invalid",
			DEFAULT_SHOUTRRR_URL: "ntfy://inherited-topic",
			AUTH_SECRET: "inherited-auth-secret",
			DATABASE_URL: "file:inherited.db",
			DB_PATH: "inherited.db",
		});

		assert.deepEqual(Object.keys(backendEnv).filter((key) => key.startsWith("SMTP_")), smtpKeys);
		for (const key of smtpKeys) assert.equal(backendEnv[key], `sandbox-test-${key}`);
		for (const key of [
			"PUBLIC_APP_URL",
			"DEFAULT_NOTIFICATION_EMAIL",
			"DEFAULT_SHOUTRRR_URL",
			"NTFY_URL",
			"AUTH_SECRET",
			"DATABASE_URL",
			"DB_PATH",
		]) {
			assert.equal(Object.hasOwn(backendEnv, key), false, `${key} must not reach the sandbox backend`);
		}
		assert.equal(backendEnv.AUTH_ENABLED, "false");
		assert.equal(backendEnv.DOTENV_PATH, "/dev/null");
		assert.equal(backendEnv.DATA_DIR, resolve(projectRoot, ".ui-dev", "data"));
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
});

test("sandbox backend environment retains its isolated defaults when repository env is absent", () => {
	const projectRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-sandbox-"));
	try {
		const backendEnv = buildSandboxBackendEnv(projectRoot, { PATH: "/usr/bin", SMTP_HOST: "inherited.example" });
		assert.equal(Object.keys(backendEnv).some((key) => key.startsWith("SMTP_")), false);
		assert.equal(backendEnv.DATA_DIR, resolve(projectRoot, ".ui-dev", "data"));
		assert.equal(backendEnv.AUTH_ENABLED, "false");
		assert.equal(backendEnv.DOTENV_PATH, "/dev/null");
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
});

function listen(port, host = "127.0.0.1") {
	return new Promise((resolveListen, reject) => {
		const server = createServer((_request, response) => response.end("foreign server"));
		server.on("request", () => {
			server.requests = (server.requests ?? 0) + 1;
		});
		server.once("error", reject);
		server.listen(port, host, () => resolveListen(server));
	});
}

function close(server) {
	return new Promise((resolveClose, reject) =>
		server.close((error) => (error ? reject(error) : resolveClose()))
	);
}

function portIsOpen(port, host = "127.0.0.1") {
	return new Promise((resolveOpen) => {
		const socket = createConnection({ host, port });
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
		assert.equal(await portIsOpen(5176, (await resolveSandboxNetwork(root)).host), false);
	} finally {
		await close(foreign);
	}
});

test("an occupied frontend port is not probed and the owned backend stops", async () => {
	const foreign = await listen(5176, (await resolveSandboxNetwork(root)).host);
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
