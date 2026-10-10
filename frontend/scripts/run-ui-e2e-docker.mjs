import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const image = "mcr.microsoft.com/playwright:v1.63.0-noble";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const usage =
	"Usage: npm run test:e2e:ui:docker[:update] [-- --shards=N] [--update-snapshots] [--repeat-each=N] [--no-cache]";

export function dependencyCacheKey() {
	const hash = createHash("sha256").update(`${image}:linux/amd64`);
	for (const project of ["shared", "backend", "frontend"]) {
		for (const file of ["package.json", "package-lock.json"]) {
			hash.update(readFileSync(path.join(root, project, file)));
		}
	}
	return hash.digest("hex").slice(0, 20);
}

export function parseOptions(args, env = process.env) {
	const shardArgs = args.filter((argument) => argument.startsWith("--shards="));
	const repeatArgs = args.filter((argument) => argument.startsWith("--repeat-each="));
	const updateCount = args.filter((argument) => argument === "--update-snapshots").length;
	const envShards = env.PLAYWRIGHT_UI_SHARDS;
	const explicitShardValue = shardArgs[0]?.slice("--shards=".length) ?? envShards;

	if (
		args.some(
			(argument) =>
				argument !== "--update-snapshots" &&
				argument !== "--no-cache" &&
				!/^--repeat-each=[1-9]\d*$/.test(argument) &&
				!/^--shards=[1-9]\d*$/.test(argument)
		) ||
		shardArgs.length > 1 ||
		repeatArgs.length > 1 ||
		updateCount > 1 ||
		(envShards !== undefined && !/^[1-9]\d*$/.test(envShards)) ||
		(explicitShardValue !== undefined && !/^[1-9]\d*$/.test(explicitShardValue))
	) {
		throw new Error(usage);
	}

	const updateSnapshots = updateCount === 1;
	const shards = explicitShardValue === undefined ? 1 : Number(explicitShardValue);
	if (shards > 2 || (updateSnapshots && shards !== 1)) {
		throw new Error(`${usage}\nShard count must be 1 or 2; snapshot updates require one shard.`);
	}

	return {
		shards,
		updateSnapshots,
		repeatArgs,
		cache: !args.includes("--no-cache"),
	};
}

export function createShardPlan(shardIndex, shardCount, runId, options) {
	const shardLabel = `shard-${shardIndex}-of-${shardCount}`;
	const outputDir = `test-results/ui-e2e-${runId}-${shardLabel}`;
	const reportDir = `playwright-report/ui-e2e-${runId}-${shardLabel}`;
	const name = `medassist-ui-${runId}-${shardLabel}`;
	const testArgs = [
		`--shard=${shardIndex}/${shardCount}`,
		...(options.updateSnapshots ? ["--update-snapshots"] : []),
		...options.repeatArgs,
	];
	const cachePrefix = `medassist-ui-deps-${dependencyCacheKey()}-${shardIndex}`;
	const install = [
		"npm ci --prefix shared",
		"npm ci --prefix backend",
		"npm ci --prefix frontend",
	].join(" && ");
	const installation = options.cache === false
		? install
		: `flock /dependency-cache/install.lock bash -lc 'if [ ! -f /dependency-cache/ready ]; then ${install} && touch /dependency-cache/ready; else echo "Reusing locked UI test dependencies"; fi'`;
	const containerCommand = [
		installation,
		"npm run build --prefix shared",
		`npm run test:e2e:ci:ui --prefix frontend -- ${testArgs.join(" ")}`,
	].join(" && ");
	const args = [
		"run",
		"--rm",
		"--init",
		"--name",
		name,
		"--platform=linux/amd64",
		"--volume",
		`${root}:/work`,
		"--workdir",
		"/work",
		"--tmpfs",
		"/work/shared/dist:rw,exec",
		"--env",
		"CI=true",
		"--env",
		"PLAYWRIGHT_AUTH_FILE=/tmp/medassist-ui-auth/user.json",
		"--env",
		"PLAYWRIGHT_DATA_DIR=/tmp/medassist-ui-e2e-data",
		"--env",
		`PLAYWRIGHT_OUTPUT_DIR=${outputDir}`,
		"--env",
		`PLAYWRIGHT_SETUP_OUTPUT_DIR=test-results/ui-setup-${runId}-${shardLabel}`,
		"--env",
		`PLAYWRIGHT_HTML_OUTPUT_DIR=${reportDir}`,
		"--env",
		"PLAYWRIGHT_UI_TESTS=true",
		image,
		"bash",
		"-lc",
		containerCommand,
	];
	const mounts = [];
	for (const project of ["shared", "backend", "frontend"]) {
		if (options.cache === false) {
			mounts.push("--tmpfs", `/work/${project}/node_modules:rw,exec`);
		} else {
			mounts.push("--volume", `${cachePrefix}-${project}:/work/${project}/node_modules`);
		}
	}
	if (options.cache !== false) mounts.push("--volume", `${cachePrefix}-lock:/dependency-cache`);
	args.splice(args.indexOf("--workdir"), 0, ...mounts);

	return { name, args, outputDir, reportDir, testArgs };
}

function removeOwnedContainers(names) {
	for (const name of names) {
		spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
	}
}

async function runShards(options) {
	const runId = `${process.pid}-${randomUUID().slice(0, 8)}`;
	const plans = Array.from({ length: options.shards }, (_, index) =>
		createShardPlan(index + 1, options.shards, runId, options)
	);
	const children = new Map();
	let requestedSignal;
	const signalHandlers = new Map();

	for (const signal of ["SIGINT", "SIGTERM"]) {
		const handler = () => {
			requestedSignal ??= signal;
			removeOwnedContainers(plans.map((plan) => plan.name));
			for (const child of children.values()) child.kill("SIGTERM");
		};
		signalHandlers.set(signal, handler);
		process.on(signal, handler);
	}

	const running = plans.map((plan) => {
		console.log(`Starting isolated UI E2E ${plan.name}`);
		const child = spawn("docker", plan.args, { cwd: root, stdio: "inherit" });
		children.set(plan.name, child);
		return new Promise((resolve) => {
			let spawnError;
			child.once("error", (error) => {
				spawnError = error;
			});
			child.once("close", (code, signal) => {
				children.delete(plan.name);
				resolve({
					name: plan.name,
					code: code ?? 1,
					signal,
					error: spawnError,
				});
			});
		});
	});

	const pending = new Set(running);
	let failed;
	while (pending.size > 0 && !failed && !requestedSignal) {
		const settled = await Promise.race(
			[...pending].map(async (promise) => ({ promise, result: await promise }))
		);
		pending.delete(settled.promise);
		const { result } = settled;
		if (result.error || result.code !== 0) failed = result;
	}

	if (failed || requestedSignal) {
		removeOwnedContainers(plans.map((plan) => plan.name));
		for (const child of children.values()) child.kill("SIGTERM");
	}

	const results = await Promise.all(running);
	if (failed || requestedSignal) removeOwnedContainers(plans.map((plan) => plan.name));
	for (const [signal, handler] of signalHandlers) process.off(signal, handler);

	if (requestedSignal) {
		process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
	} else if (failed) {
		const details = failed.error
			? `: ${failed.error.message}`
			: ` (exit ${failed.code}${failed.signal ? `, signal ${failed.signal}` : ""})`;
		console.error(`UI E2E shard ${failed.name} failed${details}`);
		process.exitCode = failed.code || 1;
	} else if (results.some((result) => result.code !== 0)) {
		const result = results.find((item) => item.code !== 0);
		console.error(`UI E2E shard ${result.name} failed (exit ${result.code})`);
		process.exitCode = result.code || 1;
	} else {
		console.log(`All ${options.shards} isolated UI E2E shard(s) passed.`);
	}
}

async function main() {
	let options;
	try {
		options = parseOptions(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
		return;
	}
	await runShards(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
