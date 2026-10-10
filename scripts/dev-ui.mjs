import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandboxDir = resolve(root, ".ui-dev");
const dataDir = resolve(sandboxDir, "data");
const lockPath = resolve(sandboxDir, "launcher.lock");
const seedMarker = resolve(sandboxDir, "seed-complete.json");
const backendPort = 5177;
const frontendPort = 5176;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const appUrl = `http://127.0.0.1:${frontendPort}/dashboard`;
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

function minimalEnv(overrides = {}) {
	const env = {};
	for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME"]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return { ...env, ...overrides };
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

const startDate = new Date(Date.now() - 86_400_000).toISOString();
const regularIntake = (usage, takenBy) => ({
	usage,
	every: 1,
	start: startDate,
	takenBy,
	intakeRemindersEnabled: false,
});

const demoMedications = [
	{
		name: "Pocket Sunshine for Indoor Goblins",
		genericName: "Cholecalciferol",
		takenBy: ["Sir Snoozes-a-Lot"],
		medicationForm: "capsule",
		pillForm: "capsule",
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 14,
		looseTablets: 22,
		doseUnit: "IU",
		intakes: [regularIntake(1, "Sir Snoozes-a-Lot")],
	},
	{
		name: "Sneezus Interruptus Deluxe",
		genericName: "Cetirizine",
		takenBy: ["Sir Snoozes-a-Lot", "Professor Wobble McNoodle"],
		medicationForm: "tablet",
		pillForm: "tablet",
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 3,
		doseUnit: "mg",
		intakes: [regularIntake(1, "Professor Wobble McNoodle")],
	},
	{
		name: "Cough Goblin Eviction Juice",
		genericName: "Dextromethorphan",
		takenBy: ["Professor Wobble McNoodle"],
		medicationForm: "liquid",
		packageType: "liquid_container",
		packCount: 1,
		packageAmountValue: 120,
		packageAmountUnit: "ml",
		totalPills: 120,
		looseTablets: 18,
		doseUnit: "ml",
		intakes: [regularIntake(5, "Professor Wobble McNoodle")],
	},
	{
		name: "Itch Please! Emergency Goblin Butter",
		genericName: "Moisturizing cream",
		takenBy: ["Sir Snoozes-a-Lot"],
		medicationForm: "topical",
		packageType: "tube",
		packCount: 1,
		packageAmountValue: 30,
		packageAmountUnit: "g",
		doseUnit: "g",
		intakes: [regularIntake(1, "Sir Snoozes-a-Lot")],
	},
	{
		name: "Brain Gremlin Eviction Notice",
		genericName: "Ibuprofen",
		takenBy: ["Sir Snoozes-a-Lot"],
		medicationForm: "tablet",
		pillForm: "tablet",
		packageType: "bottle",
		packCount: 1,
		totalPills: 24,
		looseTablets: 24,
		doseUnit: "mg",
		intakes: [],
	},
];

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

	for (const medication of demoMedications) {
		await requestJson(`${backendUrl}/medications`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(medication),
		});
	}

	const seeded = await requestJson(`${backendUrl}/medications`);
	const seededNames = new Set(seeded.map((medication) => medication.name));
	if (demoMedications.some((medication) => !seededNames.has(medication.name))) {
		fail("Sandbox seed verification failed. The database may contain a partial seed; it was left untouched.");
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

	const safeEnv = minimalEnv({
		NODE_ENV: "development",
		AUTH_ENABLED: "false",
		ALLOW_UNAUTHENTICATED: "false",
		UI_SANDBOX_LAUNCHER: "1",
		PORT: String(backendPort),
		CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
		DATA_DIR: dataDir,
		DOTENV_PATH: "/dev/null",
		MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED: "false",
	});
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
			}),
		},
		"Frontend"
	);
	await waitForReady(frontend, "Frontend");
	await waitForUrl(appUrl, "Frontend");

	console.log(`\nUI sandbox ready: ${appUrl}`);
	console.log("Local anonymous demo only; this does not test authenticated login or registration.");
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

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));

start().catch(async (error) => {
	console.error(`UI sandbox startup failed: ${error instanceof Error ? error.message : String(error)}`);
	await shutdown();
	process.exitCode = 1;
});
