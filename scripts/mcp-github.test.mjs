import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const launcher = path.join(root, "scripts", "mcp-github.mjs");
const image =
	"ghcr.io/github/github-mcp-server@sha256:a9dd39eec67f09ded51631c79641dd72acb4945c6391df47824fa2d508b5431b";
const fakeToken = "fake-github-token-for-test-only";

async function withTempDirectory(callback) {
	const directory = mkdtempSync(path.join(tmpdir(), "mcp-github-test-"));
	try {
		await callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function installFakeCommands(directory, { auth = "success", docker = "capture" } = {}) {
	const binDirectory = path.join(directory, "bin");
	mkdirSync(binDirectory);
	const ghSource =
		auth === "failure"
			? "#!/bin/sh\nprintf '%s\\n' 'simulated gh auth failure' >&2\nexit 7\n"
			: auth === "empty"
				? "#!/bin/sh\nexit 0\n"
				: `#!/bin/sh\nprintf '%s' '${fakeToken}'\n`;
	writeFileSync(path.join(binDirectory, "gh"), ghSource, { mode: 0o755 });

	if (docker !== "missing") {
		const dockerSource =
			docker === "capture"
				? "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MCP_GITHUB_CAPTURE_ARGS\"\nprintf '%s' \"$GITHUB_PERSONAL_ACCESS_TOKEN\" > \"$MCP_GITHUB_CAPTURE_TOKEN\"\n"
				: `#!/bin/sh\nexit ${docker}\n`;
		writeFileSync(path.join(binDirectory, "docker"), dockerSource, { mode: 0o755 });
	}

	return binDirectory;
}

function runLauncher(directory, binDirectory) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [launcher], {
			cwd: root,
			env: {
				...process.env,
				PATH: binDirectory,
				MCP_GITHUB_CAPTURE_ARGS: path.join(directory, "docker-args.txt"),
				MCP_GITHUB_CAPTURE_TOKEN: path.join(directory, "docker-token.txt"),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 10_000);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr, timedOut });
		});
	});
}

function assertDidNotLaunchDocker(directory) {
	assert.equal(existsSync(path.join(directory, "docker-args.txt")), false);
	assert.equal(existsSync(path.join(directory, "docker-token.txt")), false);
}

test("GitHub CLI authentication failure does not launch Docker", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const binDirectory = installFakeCommands(directory, { auth: "failure" });
		const result = await runLauncher(directory, binDirectory);

		assert.equal(result.timedOut, false, result.stderr);
		assert.equal(result.code, 1);
		assert.equal(result.signal, null);
		assert.match(result.stderr, /Unable to start GitHub MCP using GitHub CLI authentication/);
		assert.match(result.stderr, /simulated gh auth failure/);
		assertDidNotLaunchDocker(directory);
	});
});

test("an empty GitHub credential does not launch Docker", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const binDirectory = installFakeCommands(directory, { auth: "empty" });
		const result = await runLauncher(directory, binDirectory);

		assert.equal(result.timedOut, false, result.stderr);
		assert.equal(result.code, 1);
		assert.equal(result.signal, null);
		assert.match(result.stderr, /GitHub CLI returned an empty credential/);
		assertDidNotLaunchDocker(directory);
	});
});

test("the credential is passed to Docker through its environment, not arguments or output", {
	timeout: 20_000,
}, async () => {
	await withTempDirectory(async (directory) => {
		const binDirectory = installFakeCommands(directory);
		const result = await runLauncher(directory, binDirectory);
		const combinedOutput = result.stdout + result.stderr;

		assert.equal(result.timedOut, false, combinedOutput);
		assert.equal(result.code, 0, combinedOutput);
		assert.equal(result.signal, null);
		assert.doesNotMatch(combinedOutput, new RegExp(fakeToken));

		const args = readFileSync(path.join(directory, "docker-args.txt"), "utf8").trim().split("\n");
		assert.deepEqual(args, [
			"run",
			"-i",
			"--rm",
			"-e",
			"GITHUB_PERSONAL_ACCESS_TOKEN",
			image,
			"stdio",
			"--toolsets=all",
		]);
		assert.equal(args.includes(fakeToken), false);
		assert.equal(readFileSync(path.join(directory, "docker-token.txt"), "utf8"), fakeToken);
	});
});

test("Docker exit status is surfaced by the launcher", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const binDirectory = installFakeCommands(directory, { docker: 37 });
		const result = await runLauncher(directory, binDirectory);

		assert.equal(result.timedOut, false, result.stderr);
		assert.equal(result.code, 37);
		assert.equal(result.signal, null);
	});
});

test("Docker launch errors are reported", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const binDirectory = installFakeCommands(directory, { docker: "missing" });
		const result = await runLauncher(directory, binDirectory);

		assert.equal(result.timedOut, false, result.stderr);
		assert.equal(result.code, 1);
		assert.equal(result.signal, null);
		assert.match(result.stderr, /Unable to launch GitHub MCP/);
		assert.match(result.stderr, /spawn docker ENOENT/);
	});
});
