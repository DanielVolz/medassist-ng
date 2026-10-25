import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { demoMedications } from "./seed.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sandboxDir = resolve(root, ".ui-dev");
const dataDir = resolve(sandboxDir, "data");
const assetsDir = resolve(root, "tools/ui-sandbox/assets");
const lockPath = resolve(sandboxDir, "launcher.lock");
const seedMarker = resolve(sandboxDir, "seed-complete.json");
const backendPort = 5177;
const frontendPort = 5176;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const requireBackend = createRequire(resolve(root, "backend/package.json"));
const dotenv = requireBackend("dotenv");
const sharp = requireBackend("sharp");
const smtpEnvKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_TOKEN", "SMTP_FROM", "SMTP_SECURE"];
const children = new Set();
let lockFd;
let stopping = false;

function fail(message) {
	throw new Error(message);
}

function runBuild() {
	try {
		execFileSync("npm", ["--prefix", "shared", "run", "build"], {
			cwd: root,
			stdio: "inherit",
		});
	} catch {
		fail("Building shared contracts failed; the UI sandbox was not started.");
	}
}

function minimalEnv(overrides = {}, inheritedEnv = process.env) {
	const env = {};
	for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME"]) {
		if (inheritedEnv[key]) env[key] = inheritedEnv[key];
	}
	return { ...env, ...overrides };
}

function loadSandboxSmtpEnv(projectRoot) {
	const envPath = resolve(projectRoot, ".env");
	if (!existsSync(envPath)) return {};

	const parsed = dotenv.parse(readFileSync(envPath));
	return Object.fromEntries(
		smtpEnvKeys
			.filter((key) => parsed[key] !== undefined && parsed[key] !== "")
			.map((key) => [key, parsed[key]])
	);
}

export async function resolveSandboxNetwork(projectRoot = root, dependencies = {}) {
	const loopback = { host: "127.0.0.1", publicAppUrl: undefined };
	const envPath = resolve(projectRoot, ".env");
	if (!existsSync(envPath)) return loopback;
	const configuredUrl = dotenv.parse(readFileSync(envPath)).PUBLIC_APP_URL;
	if (!configuredUrl) return loopback;

	try {
		const url = new URL(configuredUrl);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return loopback;
		const addresses = await (dependencies.lookup ?? lookup)(url.hostname, { all: true });
		const interfaces = (dependencies.networkInterfaces ?? networkInterfaces)();
		const localAddresses = new Set(
			Object.values(interfaces).flat().filter((entry) => entry && !entry.internal).map((entry) => entry.address)
		);
		const isLocalPrivate = ({ address }) => {
			if (!isIPv4(address) || !localAddresses.has(address)) return false;
			const [first, second] = address.split(".").map(Number);
			return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
		};
		if (addresses.length === 0 || !addresses.every(isLocalPrivate)) return loopback;
		if (addresses.some(({ address }) => address !== addresses[0].address)) return loopback;
		return { host: addresses[0].address, publicAppUrl: `http://${url.hostname}:${frontendPort}/` };
	} catch {
		return loopback;
	}
}

export function buildSandboxBackendEnv(projectRoot = root, inheritedEnv = process.env, network = {}) {
	const dataDir = resolve(projectRoot, ".ui-dev", "data");
	return minimalEnv(
		{
			NODE_ENV: "development",
			AUTH_ENABLED: "false",
			ALLOW_UNAUTHENTICATED: "false",
			UI_SANDBOX_LAUNCHER: "1",
			PORT: String(backendPort),
			CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
			DATA_DIR: dataDir,
			DOTENV_PATH: "/dev/null",
			MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: "false",
			...loadSandboxSmtpEnv(projectRoot),
			...(network.publicAppUrl ? {
				PUBLIC_APP_URL: network.publicAppUrl,
				CORS_ORIGINS: `http://127.0.0.1:${frontendPort},${new URL(network.publicAppUrl).origin}`,
			} : {}),
		},
		inheritedEnv
	);
}

function startNode(args, options, label) {
	const child = spawn(process.execPath, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: ["inherit", "inherit", "inherit", "ipc"],
	});
	children.add(child);
	child.once("error", (error) => {
		children.delete(child);
		if (stopping) return;
		process.exitCode = 1;
		console.error(`Could not start the UI sandbox ${label.toLowerCase()}: ${error.message}`);
		void shutdown();
	});
	child.once("exit", (code, signal) => {
		children.delete(child);
		if (!stopping) {
			process.exitCode = 1;
			void shutdown();
			console.error(
				`UI sandbox process exited unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}); stopping its sibling.`
			);
		}
	});
	return child;
}

function assertRunning() {
	if (stopping) fail("UI sandbox startup was cancelled.");
}

async function waitForReady(child, label) {
	assertRunning();
	if (child.exitCode !== null || child.signalCode !== null) {
		fail(`${label} exited before becoming ready. Check the preceding startup message.`);
	}
	await new Promise((resolveReady, rejectReady) => {
		const cleanup = () => {
			clearTimeout(timeout);
			child.off("message", onMessage);
			child.off("exit", onExit);
			child.off("error", onError);
		};
		const timeout = setTimeout(() => {
			cleanup();
			rejectReady(new Error(`${label} did not report readiness within 60 seconds.`));
		}, 60_000);
		const onMessage = (message) => {
			if (message?.type !== "ready") return;
			cleanup();
			resolveReady();
		};
		const onExit = () => {
			cleanup();
			rejectReady(new Error(`${label} exited before becoming ready. Check the preceding startup message.`));
		};
		const onError = (error) => {
			cleanup();
			rejectReady(new Error(`${label} failed before becoming ready: ${error.message}`));
		};
		child.on("message", onMessage);
		child.once("exit", onExit);
		child.once("error", onError);
	});
	assertRunning();
}

async function waitForUrl(url, label) {
	assertRunning();
	let response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(5000) });
	} catch (error) {
		fail(`${label} did not respond at ${url} after its own process reported readiness.`);
	}
	assertRunning();
	if (!response.ok) {
		fail(`${label} returned HTTP ${response.status} after its own process reported readiness.`);
	}
	return response;
}

async function requestJson(url, options) {
	assertRunning();
	const response = await fetch(url, options);
	assertRunning();
	let body;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		fail(`Sandbox API ${url} returned HTTP ${response.status}; refusing to report a ready app.`);
	}
	return body;
}

async function uploadDemoImage(medicationId, imageAsset) {
	const svg = readFileSync(resolve(assetsDir, imageAsset));
	const png = await sharp(svg).png().toBuffer();
	const formData = new FormData();
	formData.append("file", new Blob([png], { type: "image/png" }), imageAsset.replace(/\.svg$/, ".png"));
	const response = await fetch(`${backendUrl}/medications/${medicationId}/image`, {
		method: "POST",
		body: formData,
	});
	if (!response.ok) {
		fail(`Sandbox image upload for seeded medication ${medicationId} returned HTTP ${response.status}.`);
	}
}

async function initializeSandboxData() {
	const authState = await requestJson(`${backendUrl}/auth/state`);
	if (authState.authEnabled !== false) {
		fail("Backend auth state is not disabled; refusing to seed or launch the UI sandbox.");
	}

	const medications = await requestJson(`${backendUrl}/medications`);
	if (!Array.isArray(medications)) fail("Medication API returned an unexpected response.");

	if (existsSync(seedMarker)) {
		return;
	}
	if (medications.length > 0) {
		fail(
			"UI sandbox data exists without a completed seed marker. No data was changed; inspect .ui-dev/data before continuing."
		);
	}

	for (const { medication, imageAsset } of demoMedications) {
		const created = await requestJson(`${backendUrl}/medications`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(medication),
		});
		await uploadDemoImage(created.id, imageAsset);
	}

	const seeded = await requestJson(`${backendUrl}/medications`);
	const seededNames = new Set(seeded.map((medication) => medication.name));
	if (demoMedications.some(({ medication }) => !seededNames.has(medication.name))) {
		fail("Sandbox seed verification failed. The database may contain a partial seed; it was left untouched.");
	}
	if (demoMedications.some(({ medication }) => !seeded.some((item) => item.name === medication.name && item.imageUrl))) {
		fail("Sandbox image verification failed. The seed marker was not written.");
	}
	for (const { medication } of demoMedications) {
		const seededMedication = seeded.find((item) => item.name === medication.name);
		const imageResponse = await fetch(`${backendUrl}/images/${seededMedication.imageUrl}`);
		if (!imageResponse.ok || !imageResponse.headers.get("content-type")?.startsWith("image/")) {
			fail(`Sandbox image verification failed for ${medication.name}. The seed marker was not written.`);
		}
		const image = await imageResponse.arrayBuffer();
		if (image.byteLength === 0) {
			fail(`Sandbox image for ${medication.name} is empty. The seed marker was not written.`);
		}
	}

	const temporaryMarker = `${seedMarker}.${process.pid}.tmp`;
	writeFileSync(
		temporaryMarker,
		`${JSON.stringify({ seededAt: new Date().toISOString(), medicationCount: seeded.length }, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 }
	);
	renameSync(temporaryMarker, seedMarker);
}

async function start() {
	mkdirSync(sandboxDir, { recursive: true });
	try {
		lockFd = openSync(lockPath, "wx", 0o600);
		writeFileSync(lockFd, `${process.pid}\n`);
	} catch (error) {
		if (error?.code === "EEXIST") {
			fail("Another UI sandbox launcher holds .ui-dev/launcher.lock; stop it before starting another.");
		}
		throw error;
	}

	mkdirSync(dataDir, { recursive: true });
	runBuild();
	assertRunning();

	const network = await resolveSandboxNetwork(root);
	const appUrl = new URL("dashboard", network.publicAppUrl ?? `http://127.0.0.1:${frontendPort}/`).href;
	console.log(network.publicAppUrl
		? "Sandbox LAN action URL validated; frontend binds only to its local private interface."
		: "Sandbox remains loopback-only; no usable local private action URL was established. Do not send actionable reminders.");
	const safeEnv = buildSandboxBackendEnv(root, process.env, network);
	const availableSmtpKeys = smtpEnvKeys.filter((key) => safeEnv[key] !== undefined);
	console.log(`Sandbox SMTP configuration keys available: ${availableSmtpKeys.join(", ") || "none"}`);
	const backend = startNode(
		[resolve(root, "backend/node_modules/tsx/dist/cli.mjs"), resolve(root, "backend/src/ui-sandbox.ts")],
		{ cwd: root, env: safeEnv },
		"Backend"
	);

	await waitForReady(backend, "Backend");
	await waitForUrl(`${backendUrl}/health`, "Backend");
	assertRunning();
	await initializeSandboxData();
	assertRunning();

	const frontend = startNode(
		[resolve(root, "frontend/scripts/ui-sandbox-vite.mjs")],
		{
			cwd: resolve(root, "frontend"),
			env: minimalEnv({
				NODE_ENV: "development",
				BACKEND_URL: backendUrl,
				UI_SANDBOX_HOST: network.host,
				...(network.publicAppUrl ? { PUBLIC_APP_URL: network.publicAppUrl } : {}),
			}),
		},
		"Frontend"
	);
	await waitForReady(frontend, "Frontend");
	if (network.host === "127.0.0.1") {
		await waitForUrl(appUrl, "Frontend");
	}

	console.log(`\nUI sandbox ready: ${appUrl}`);
	console.log("Anonymous sandbox demo only; this does not test authenticated login or registration.");
	console.log(`Persistent demo data: ${dataDir}`);
	console.log("Press Ctrl+C to stop both local processes.");
}

async function shutdown() {
	if (stopping) return;
	stopping = true;
	const running = [...children];
	for (const child of running) child.kill("SIGTERM");
	await Promise.all(
		running.map(
			(child) =>
				new Promise((resolveWait) => {
					if (child.exitCode !== null || child.signalCode !== null) return resolveWait();
					child.once("exit", resolveWait);
					setTimeout(() => {
						if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
					}, 5000).unref();
				})
		)
	);
	if (lockFd !== undefined) {
		closeSync(lockFd);
		lockFd = undefined;
		try {
			unlinkSync(lockPath);
		} catch (error) {
			if (error?.code !== "ENOENT") {
				console.error(`Could not remove UI sandbox launcher lock ${lockPath}: ${error.message}`);
			}
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));

	start().catch(async (error) => {
		console.error(`UI sandbox startup failed: ${error instanceof Error ? error.message : String(error)}`);
		await shutdown();
		process.exitCode = 1;
	});
}
