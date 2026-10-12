import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { GROUPS, buildPlaywrightArgs, getProjectForGroup, getSpecsForGroup } from "./select-e2e.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNNER = path.join(ROOT, ".github/scripts/run-e2e-group.mjs");
const AGGREGATE = path.join(ROOT, ".github/scripts/validate-e2e-result.mjs");

function createFakePlaywrightFrontend() {
	const frontend = mkdtempSync(path.join(os.tmpdir(), "medassist-e2e-runner-"));
	mkdirSync(path.join(frontend, "node_modules/playwright"), { recursive: true });
	writeFileSync(path.join(frontend, "playwright.stable.config.ts"), "export default {};\n");
	writeFileSync(
		path.join(frontend, "node_modules/playwright/cli.js"),
		"process.stdout.write(JSON.stringify({ args: process.argv.slice(2), ui: process.env.PLAYWRIGHT_UI_TESTS ?? null }));\n"
	);
	return frontend;
}

function invokeGroupRunner(frontend, group, args = []) {
	const result = spawnSync(process.execPath, [RUNNER, ...args], {
		cwd: frontend,
		encoding: "utf8",
		env: { ...process.env, E2E_GROUP: group, PLAYWRIGHT_UI_TESTS: "false" },
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

test("the real group runner forwards selected groups, Playwright projects, and specs to its CLI", (t) => {
	const frontend = createFakePlaywrightFrontend();
	t.after(() => rmSync(frontend, { recursive: true, force: true }));

	const assignedSpecs = [];
	for (const group of GROUPS) {
		const invocation = invokeGroupRunner(frontend, group, ["--list"]);
		assert.deepEqual(invocation.args, [...buildPlaywrightArgs(group), "--list"]);
		assert.equal(invocation.ui, group === "ui" ? "true" : "false");
		assignedSpecs.push(...getSpecsForGroup(group));
	}
	assert.equal(assignedSpecs.length, 28);
	assert.equal(new Set(assignedSpecs).size, 28);
	assert.deepEqual([...assignedSpecs].sort(), [...new Set(assignedSpecs)].sort());
});

test("workflow source connects default PR selection to the selected runner and aggregate status", () => {
	const testWorkflow = readFileSync(path.join(ROOT, ".github/workflows/test.yml"), "utf8");
	const e2eWorkflow = readFileSync(path.join(ROOT, ".github/workflows/e2e.yml"), "utf8");
	const testTriggers = testWorkflow.split("permissions:")[0];

	assert.match(testWorkflow, /^  pull_request:\n    branches: \[main\]\n/m);
	assert.doesNotMatch(testTriggers, /^\s+paths(?:-ignore)?:/m);
	assert.match(testWorkflow, /e2e:\n[\s\S]*?uses: \.\/\.github\/workflows\/e2e\.yml\n[\s\S]*?selection_mode: pull_request/);
	assert.match(testWorkflow, /upstream_success: \$\{\{ needs\.backend-test\.result == 'success' && needs\.frontend-build\.result == 'success' \}\}/);
	assert.match(e2eWorkflow, /workflow_dispatch:[\s\S]*?default: full/);
	assert.match(e2eWorkflow, /schedule:\n\s+- cron:/);
	assert.match(e2eWorkflow, /selection_mode:[\s\S]*?default: pull_request/);
	assert.match(e2eWorkflow, /fetch-depth: 0/);
	assert.match(e2eWorkflow, /run: node \.github\/scripts\/select-e2e\.mjs/);
	assert.match(e2eWorkflow, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
	assert.match(e2eWorkflow, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
	assert.match(e2eWorkflow, /target_sha: \$\{\{ steps\.select\.outputs\.target_sha \}\}/);
	assert.match(e2eWorkflow, /matrix_groups: \$\{\{ steps\.select\.outputs\.matrix_groups \}\}/);
	assert.match(e2eWorkflow, /group: \$\{\{ fromJSON\(needs\.selection\.outputs\.matrix_groups \|\| '\["none"\]'\) \}\}/);
	assert.equal([...e2eWorkflow.matchAll(/ref: \$\{\{ needs\.selection\.outputs\.target_sha \}\}/g)].length, 2);
	assert.match(e2eWorkflow, /E2E_GROUP: \$\{\{ matrix\.group \}\}/);
	assert.match(e2eWorkflow, /run: node \.\.\/\.github\/scripts\/run-e2e-group\.mjs/);
	assert.match(e2eWorkflow, /needs\.selection\.outputs\.ui_selected == 'true'/);
	assert.match(e2eWorkflow, /needs: \[selection, playwright-standard, playwright-ui\]/);
	assert.match(e2eWorkflow, /if: always\(\)/);
	assert.match(e2eWorkflow, /run: node \.github\/scripts\/validate-e2e-result\.mjs/);
	assert.match(testWorkflow, /Publish legacy Playwright E2E status/);
	assert.match(testWorkflow, /context: 'Playwright E2E'/);
});

test("the aggregate CLI accepts only complete selected results and rejects failures, cancellation, or unexpected skips", (t) => {
	const temporary = mkdtempSync(path.join(os.tmpdir(), "medassist-e2e-aggregate-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const invoke = (values) =>
		spawnSync(process.execPath, [AGGREGATE], {
			encoding: "utf8",
			env: {
				...process.env,
				SELECTION_RESULT: "success",
				STANDARD_RESULT: "success",
				UI_RESULT: "skipped",
				UI_SELECTED: "false",
				GROUPS: "core-b,planning-data",
				REASON: "test",
				TARGET_SHA: "fixture-sha",
				...values,
			},
		});

	assert.equal(invoke({}).status, 0);
	assert.equal(invoke({ UI_SELECTED: "true", UI_RESULT: "success" }).status, 0);
	for (const selectionResult of ["failure", "cancelled", "skipped"]) {
		assert.notEqual(invoke({ SELECTION_RESULT: selectionResult }).status, 0, selectionResult);
	}
	for (const standardResult of ["failure", "cancelled", "skipped"]) {
		assert.notEqual(invoke({ STANDARD_RESULT: standardResult }).status, 0, standardResult);
	}
	for (const uiResult of ["failure", "cancelled", "skipped"]) {
		assert.notEqual(invoke({ UI_SELECTED: "true", UI_RESULT: uiResult }).status, 0, uiResult);
	}
	for (const uiResult of ["success", "failure", "cancelled"]) {
		assert.notEqual(invoke({ UI_RESULT: uiResult }).status, 0, uiResult);
	}
	assert.notEqual(invoke({ UI_SELECTED: "unknown" }).status, 0);
});
