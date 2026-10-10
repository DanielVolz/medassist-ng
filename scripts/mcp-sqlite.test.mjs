import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const launcher = path.join(root, "scripts", "mcp-sqlite.mjs");
const expectedArgs = [
	"-y",
	"db-mcp@5.0.1",
	"--transport",
	"stdio",
	"--sqlite-native",
	"<snapshot>",
	"--tool-filter",
	"read_query,list_tables,describe_table,-sqlite_execute_code",
];
const fakeNpxSource = `#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const snapshotIndex = args.indexOf("--sqlite-native");
if (snapshotIndex < 0 || !args[snapshotIndex + 1]) {
	process.exit(41);
}
const snapshot = args[snapshotIndex + 1];
const database = new DatabaseSync(snapshot, { readOnly: true });
const values = database.prepare("SELECT value FROM fixture ORDER BY value").all().map((row) => row.value);
database.close();
console.log("FAKE_NPX_RESULT:" + JSON.stringify({
	args,
	snapshot,
	snapshotIsFile: statSync(snapshot).isFile(),
	snapshotDirectoryMode: statSync(path.dirname(snapshot)).mode & 0o777,
	values,
}));
`;

async function withTempDirectory(callback) {
	const directory = mkdtempSync(path.join(tmpdir(), "mcp-sqlite-test-"));
	try {
		await callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function installFakeNpx(directory) {
	const binDirectory = path.join(directory, "bin");
	mkdirSync(binDirectory);
	const executable = path.join(binDirectory, "npx");
	writeFileSync(executable, fakeNpxSource, { mode: 0o755 });
	return binDirectory;
}

function runLauncher(source, binDirectory) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [launcher, source], {
			cwd: root,
			env: {
				...process.env,
				PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 10_000);
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, output, timedOut });
		});
	});
}

function fakeResult(output) {
	const line = output.split("\n").find((entry) => entry.startsWith("FAKE_NPX_RESULT:"));
	assert.ok(line, `fake npx did not report its fixture result: ${output}`);
	return JSON.parse(line.slice("FAKE_NPX_RESULT:".length));
}

function createFixtureDatabase(filename, values) {
	const database = new DatabaseSync(filename);
	database.exec("CREATE TABLE fixture (value TEXT NOT NULL)");
	const insert = database.prepare("INSERT INTO fixture (value) VALUES (?)");
	for (const value of values) insert.run(value);
	return database;
}

function assertInvocation(result, values) {
	assert.equal(result.timedOut, false, result.output);
	assert.equal(result.code, 0, result.output);
	assert.equal(result.signal, null);
	const captured = fakeResult(result.output);
	assert.equal(captured.snapshotIsFile, true);
	assert.deepEqual(captured.values, values);
	assert.equal(captured.snapshotDirectoryMode, 0o700);
	assert.deepEqual(captured.args, [
		...expectedArgs.slice(0, 5),
		captured.snapshot,
		...expectedArgs.slice(6),
	]);
	assert.match(path.basename(path.dirname(captured.snapshot)), /^medassist-mcp-sqlite-/);
	return captured.snapshot;
}

test("a missing source fails without creating a database or launching npx", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const source = path.join(directory, "missing.db");
		const binDirectory = installFakeNpx(directory);
		const result = await runLauncher(source, binDirectory);

		assert.equal(result.timedOut, false, result.output);
		assert.equal(result.code, 1);
		assert.equal(result.signal, null);
		assert.match(result.output, /Unable to start read-only SQLite MCP/);
		assert.doesNotMatch(result.output, /FAKE_NPX_RESULT:/);
		assert.equal(statSync(directory).isDirectory(), true);
		assert.throws(() => statSync(source), { code: "ENOENT" });
	});
});

test("a directory source fails instead of being passed to npx", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const source = path.join(directory, "source-directory");
		mkdirSync(source);
		const binDirectory = installFakeNpx(directory);
		const result = await runLauncher(source, binDirectory);

		assert.equal(result.timedOut, false, result.output);
		assert.equal(result.code, 1);
		assert.match(result.output, /SQLite source is not a file/);
		assert.doesNotMatch(result.output, /FAKE_NPX_RESULT:/);
	});
});

test("the snapshot includes committed WAL data while its source writer remains open", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const source = path.join(directory, "wal-source.db");
		const writer = new DatabaseSync(source);
		try {
			assert.equal(writer.prepare("PRAGMA journal_mode = WAL").get().journal_mode, "wal");
			writer.exec("CREATE TABLE fixture (value TEXT NOT NULL)");
			writer.prepare("INSERT INTO fixture (value) VALUES (?)").run("wal-committed");
			assert.ok(statSync(`${source}-wal`).size > 0);

			const binDirectory = installFakeNpx(directory);
			const result = await runLauncher(source, binDirectory);
			assertInvocation(result, ["wal-committed"]);
			assert.deepEqual(
				writer.prepare("SELECT value FROM fixture ORDER BY value").all().map((row) => row.value),
				["wal-committed"],
			);
		} finally {
			writer.close();
		}
	});
});

test("the launcher leaves source content unchanged and removes the snapshot on child exit", { timeout: 20_000 }, async () => {
	await withTempDirectory(async (directory) => {
		const source = path.join(directory, "source.db");
		const database = createFixtureDatabase(source, ["fictional-a", "fictional-b"]);
		database.close();
		const originalHash = createHash("sha256").update(readFileSync(source)).digest("hex");

		const binDirectory = installFakeNpx(directory);
		const result = await runLauncher(source, binDirectory);
		const snapshot = assertInvocation(result, ["fictional-a", "fictional-b"]);

		assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), originalHash);
		assert.throws(() => statSync(path.dirname(snapshot)), { code: "ENOENT" });
	});
});
