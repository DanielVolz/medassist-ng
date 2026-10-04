import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { browserBatches, createBatchEnvironment, runAllBrowsers } from "./run-playwright-all.mjs";

test("runs the Chromium core and data projects in one isolated batch", () => {
	assert.deepEqual(browserBatches[0], {
		name: "chromium",
		projects: ["chromium", "chromium-data"],
	});
});

test("runs Firefox and WebKit against independent backend and auth-state paths", () => {
	const root = "/tmp/playwright-run";
	const firefoxEnv = createBatchEnvironment(browserBatches[1], root, 41001, 41002, {
		CI: "true",
		PLAYWRIGHT_FRONTEND_PORT: "4174",
		PLAYWRIGHT_REUSE_EXISTING_SERVER: "true",
	});
	const webkitEnv = createBatchEnvironment(browserBatches[2], root, 41003, 41004, { CI: "true" });

	assert.notEqual(firefoxEnv.PLAYWRIGHT_API_BASE_URL, webkitEnv.PLAYWRIGHT_API_BASE_URL);
	assert.notEqual(firefoxEnv.PLAYWRIGHT_DATA_DIR, webkitEnv.PLAYWRIGHT_DATA_DIR);
	assert.notEqual(firefoxEnv.PLAYWRIGHT_AUTH_FILE, webkitEnv.PLAYWRIGHT_AUTH_FILE);
	assert.equal(firefoxEnv.PLAYWRIGHT_FRONTEND_PORT, "41001");
	assert.equal(firefoxEnv.PLAYWRIGHT_REUSE_EXISTING_SERVER, "false");
	assert.equal(firefoxEnv.CI, "true");
	assert.equal(firefoxEnv.PLAYWRIGHT_HTML_OPEN, "never");
});

test("removes the temporary workspace after successful browser batches", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "medassist-playwright-runner-success-"));
	try {
		await runAllBrowsers([], {
			createRoot: async () => root,
			runBatch: async () => {},
		});
		await assert.rejects(stat(root), { code: "ENOENT" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("preserves and reports diagnostics after a browser batch fails", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "medassist-playwright-runner-failure-"));
	const diagnostic = path.join(root, "chromium", "results", "trace.zip");
	let reportedPath;
	try {
		await assert.rejects(
			runAllBrowsers([], {
				createRoot: async () => root,
				runBatch: async () => {
					await mkdir(path.dirname(diagnostic), { recursive: true });
					await writeFile(diagnostic, "trace");
					throw new Error("Chromium failed");
				},
				reportRetainedRoot: (retainedRoot) => {
					reportedPath = retainedRoot;
				},
			}),
			/Chromium failed/
		);
		assert.equal(reportedPath, root);
		assert.equal(await readFile(diagnostic, "utf8"), "trace");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
