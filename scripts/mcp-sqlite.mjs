import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = process.argv[2] ?? path.join(root, "data", "medassist-ng.db");
let snapshotDirectory;

function cleanup() {
	if (snapshotDirectory) {
		rmSync(snapshotDirectory, { recursive: true, force: true });
	}
}

try {
	if (!statSync(source).isFile()) {
		throw new Error(`SQLite source is not a file: ${source}`);
	}
	snapshotDirectory = mkdtempSync(path.join(tmpdir(), "medassist-mcp-sqlite-"));
	const snapshot = path.join(snapshotDirectory, "snapshot.db");
	const sourceDatabase = new DatabaseSync(source, { readOnly: true });
	try {
		await backup(sourceDatabase, snapshot);
	} finally {
		sourceDatabase.close();
	}
	const child = spawn(
		"npx",
		[
			"-y",
			"db-mcp@5.0.1",
			"--transport",
			"stdio",
			"--sqlite-native",
			snapshot,
			"--tool-filter",
			"read_query,list_tables,describe_table,-sqlite_execute_code",
		],
		{ cwd: root, stdio: "inherit" }
	);
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => child.kill(signal));
	}
	child.on("error", (error) => {
		console.error(`Unable to launch SQLite MCP: ${error.message}`);
		process.exitCode = 1;
	});
	child.on("exit", (code, signal) => {
		if (signal) console.error(`SQLite MCP exited with ${signal}`);
		process.exitCode = code ?? 1;
		cleanup();
	});
	process.on("exit", cleanup);
} catch (error) {
	cleanup();
	console.error(`Unable to start read-only SQLite MCP: ${error.message}`);
	process.exitCode = 1;
}
