import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
	FULL_GROUPS,
	GROUPS,
	assertSpecInventory,
	buildPlaywrightArgs,
	checkRepositorySpecInventory,
	getProjectForGroup,
	getSpecsForGroup,
	parseNameStatus,
	resolveEventSelection,
	resolveManualGroups,
	selectGroups,
} from "./select-e2e.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SELECTOR = path.join(ROOT, ".github/scripts/select-e2e.mjs");

function runGit(repository, args) {
	return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

function writeFixtureFile(repository, filePath, contents) {
	const absolutePath = path.join(repository, filePath);
	mkdirSync(path.dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, contents);
}

function createGitFixture() {
	const repository = mkdtempSync(path.join(os.tmpdir(), "medassist-e2e-selector-"));
	runGit(repository, ["init", "-q", "-b", "main"]);
	runGit(repository, ["config", "user.name", "E2E selector test"]);
	runGit(repository, ["config", "user.email", "e2e-selector@example.invalid"]);
	writeFixtureFile(repository, ".gitignore", ".test-output/\n");
	writeFixtureFile(repository, "frontend/src/pages/DashboardPage.module.css", ".dashboard { gap: 1rem; }\n");
	writeFixtureFile(repository, "frontend/src/pages/MedicationsPage.tsx", "export const MedicationPage = 1;\n");
	writeFixtureFile(repository, "backend/src/routes/medications.ts", "export const medicationRoute = 1;\n");
	writeFixtureFile(repository, "docs/old-dashboard.md", "Dashboard notes.\n");
	runGit(repository, ["add", "."]);
	runGit(repository, ["commit", "-m", "base"]);
	return { repository, baseSha: runGit(repository, ["rev-parse", "HEAD"]) };
}

function commitScenario(fixture, branch, update) {
	runGit(fixture.repository, ["checkout", "-q", "-b", branch, fixture.baseSha]);
	update(fixture.repository);
	runGit(fixture.repository, ["add", "-A"]);
	runGit(fixture.repository, ["commit", "-m", branch]);
	return runGit(fixture.repository, ["rev-parse", "HEAD"]);
}

function invokeSelector(fixture, { headSha = fixture.baseSha, mode = "pull_request", upstreamSuccess = "true", manualGroups } = {}) {
	const outputDirectory = path.join(fixture.repository, ".test-output");
	mkdirSync(outputDirectory, { recursive: true });
	const outputPath = path.join(outputDirectory, `output-${Math.random()}`);
	const summaryPath = path.join(outputDirectory, `summary-${Math.random()}`);
	const result = spawnSync(process.execPath, [SELECTOR], {
		cwd: ROOT,
		encoding: "utf8",
		env: {
			...process.env,
			SELECTION_MODE: mode,
			GITHUB_EVENT_NAME: mode,
			E2E_REPOSITORY_ROOT: fixture.repository,
			BASE_SHA: fixture.baseSha,
			HEAD_SHA: headSha,
			UPSTREAM_SUCCESS: upstreamSuccess,
			MANUAL_GROUPS: manualGroups ?? "",
			TARGET_REF: "refs/pull/123/merge",
			TARGET_SHA: headSha,
			GITHUB_OUTPUT: outputPath,
			GITHUB_STEP_SUMMARY: summaryPath,
		},
	});
	return { ...result, outputPath, summaryPath };
}

function selectedCliOutput(result) {
	assert.equal(result.status, 0, result.stderr);
	const selection = JSON.parse(result.stdout);
	const outputs = Object.fromEntries(
		readFileSync(result.outputPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => {
				const separator = line.indexOf("=");
				return [line.slice(0, separator), line.slice(separator + 1)];
			})
	);
	return { selection, outputs, summary: readFileSync(result.summaryPath, "utf8") };
}

test("the checked-in Playwright spec inventory is fully assigned to browser groups", () => {
	assert.equal(checkRepositorySpecInventory(), true);
	assert.deepEqual(resolveManualGroups("full"), FULL_GROUPS);
});

test("every CI group executes the specs in its inventory on the expected Playwright project", () => {
	const assigned = new Set();
	for (const group of GROUPS) {
		const args = buildPlaywrightArgs(group);
		assert.equal(args[0], "test");
		assert.equal(args[1], "--config=playwright.stable.config.ts");
		assert.equal(args[2], `--project=${getProjectForGroup(group)}`);
		assert.deepEqual(args.slice(3), getSpecsForGroup(group).map((spec) => `e2e/${spec}`));
		for (const spec of getSpecsForGroup(group)) assigned.add(spec);
	}
	assert.equal(assigned.size, 28);
	assert.deepEqual(
		FULL_GROUPS.flatMap((group) => getSpecsForGroup(group)).sort(),
		[...assigned].sort()
	);
	assert.throws(() => buildPlaywrightArgs("unknown"), /Unknown Playwright group/);
});

test("new E2E specs cannot silently disappear from the selector inventory", () => {
	assert.deepEqual(selectGroups(["frontend/e2e/future-feature.spec.ts"]).groups, FULL_GROUPS);
	assert.deepEqual(
		selectGroups(["frontend/e2e/new/medication-edit.spec.ts"]).groups,
		FULL_GROUPS,
		"new nested specs must not inherit a mapped basename"
	);
	assert.throws(() => assertSpecInventory(["future-feature.spec.ts"]), /Unassigned specs: future-feature\.spec\.ts/);
});

test("dashboard CSS keeps dashboard browser and data coverage without selecting unrelated suites", () => {
	assert.deepEqual(selectGroups(["frontend/src/pages/DashboardPage.module.css"]).groups, [
		"core-b",
		"planning-data",
	]);
});

test("shared modal and table components select coverage for their actual UI paths", () => {
	assert.deepEqual(selectGroups(["frontend/src/ui/modal/AppModal.tsx"]).groups, [
		"core-a",
		"core-b",
		"medication-data",
		"ui",
	]);
	for (const filePath of [
		"frontend/src/ui/primitives/DataTable.tsx",
		"frontend/src/ui/primitives/DataTable.module.css",
	]) {
		assert.deepEqual(selectGroups([filePath]).groups, FULL_GROUPS, filePath);
	}
});

test("editor, routing history, and shared style changes retain editor and modal coverage", () => {
	for (const filePath of [
		"frontend/src/pages/MedicationsPage.tsx",
		"frontend/src/hooks/useModalHistory.ts",
		"frontend/src/components/AppModal.module.css",
	]) {
		assert.deepEqual(selectGroups([filePath]).groups, ["core-a", "core-b", "medication-data", "ui"]);
	}
});

test("backend medication and planning domains select their relevant core and data groups", () => {
	assert.deepEqual(selectGroups(["backend/src/routes/medications.ts"]).groups, [
		"core-a",
		"core-b",
		"medication-data",
		"planning-data",
	]);
	assert.deepEqual(selectGroups(["backend/src/routes/planner.ts"]).groups, [
		"core-a",
		"core-b",
		"planning-data",
	]);
	assert.deepEqual(selectGroups(["frontend/src/pages/PlannerPage.tsx"]).groups, [
		"core-a",
		"core-b",
		"planning-data",
	]);
});

test("shared contracts, authentication, schema, locks, workflows, and unknown product paths fail broad", () => {
	for (const filePath of [
		"shared/src/contracts.ts",
		"backend/src/routes/auth.ts",
		"backend/src/db/schema.ts",
		"frontend/package-lock.json",
		".github/workflows/test.yml",
		".github/workflows/e2e.yml",
		"scripts/dev-ui.mjs",
		"backend/src/services/unclassified-service.ts",
		"package-lock.json",
		"knip.jsonc",
		"some-root-tooling-file.mjs",
	]) {
		assert.deepEqual(selectGroups([filePath]).groups, FULL_GROUPS, filePath);
	}
});

test("documentation-only changes do not select browser suites", () => {
	assert.deepEqual(
		selectGroups(["docs/DEVELOPMENT.md", "README.md", ".github/skills/medassist-test-design/SKILL.md"])
			.groups,
		[]
	);
});

test("manual selection accepts explicit groups and requires full to stand alone", () => {
	assert.deepEqual(resolveManualGroups("ui,core-b"), ["core-b", "ui"]);
	assert.deepEqual(resolveManualGroups("performance"), ["performance"]);
	assert.throws(() => resolveManualGroups("full,ui"), /Use 'full' alone/);
	assert.throws(() => resolveManualGroups("unknown"), /Unknown E2E group/);
	assert.throws(() => resolveManualGroups(" , "), /must name at least one/);
});

test("scheduled runs select every group, including the separate performance suite", () => {
	assert.deepEqual(resolveEventSelection({ GITHUB_EVENT_NAME: "schedule" }).groups, FULL_GROUPS);
	assert.ok(GROUPS.includes("performance"));
});

test("manual full and selected-group runs use the requested explicit scope", () => {
	assert.deepEqual(
		resolveEventSelection({
			GITHUB_EVENT_NAME: "workflow_dispatch",
			MANUAL_GROUPS: "full",
		}).groups,
		FULL_GROUPS
	);
	assert.deepEqual(
		resolveEventSelection({
			GITHUB_EVENT_NAME: "workflow_dispatch",
			MANUAL_GROUPS: "ui,planning-data",
		}).groups,
		["planning-data", "ui"]
	);
});

test("pull request path selection uses the full changed-path list and does not interpolate paths", () => {
	const selection = selectGroups([
		"frontend/src/pages/DashboardPage.module.css",
		"docs/DEVELOPMENT.md",
	]);
	assert.deepEqual(selection.groups, ["core-b", "planning-data"]);
	assert.equal(selection.reasons.length, 2);
});

test("root package lock changes select full coverage when classified with the PR diff", () => {
	assert.deepEqual(
		selectGroups(["docs/DEVELOPMENT.md", "package-lock.json"]).groups,
		FULL_GROUPS,
		"root package lockfile must not be hidden by the backend/frontend path filters"
	);
});

test("git name-status parsing handles spaces, deletions, and renames as individual paths", () => {
	assert.deepEqual(
		parseNameStatus(
			[
				"M",
				"frontend/src/pages/Dashboard page.module.css",
				"D",
				"backend/src/routes/old.ts",
				"R100",
				"frontend/e2e/old spec.spec.ts",
				"frontend/e2e/new spec.spec.ts",
				"",
			].join("\0")
		),
		[
			"frontend/src/pages/Dashboard page.module.css",
			"backend/src/routes/old.ts",
			"frontend/e2e/old spec.spec.ts",
			"frontend/e2e/new spec.spec.ts",
		]
	);
});

test("the PR selector CLI classifies full git histories, including renames, deletions, and global impact", (t) => {
	const fixture = createGitFixture();
	t.after(() => rmSync(fixture.repository, { recursive: true, force: true }));

	const documentationSha = commitScenario(fixture, "documentation", (repository) => {
		writeFixtureFile(repository, "docs/long-guidance.md", "Large documentation change.\n".repeat(4000));
	});
	const documentation = selectedCliOutput(invokeSelector(fixture, { headSha: documentationSha }));
	assert.deepEqual(documentation.selection.groups, []);
	assert.ok(documentation.selection.paths.includes("docs/long-guidance.md"));
	assert.deepEqual(JSON.parse(documentation.outputs.matrix_groups), ["none"]);

	const dashboardSha = commitScenario(fixture, "dashboard-after-docs", (repository) => {
		writeFixtureFile(repository, "docs/long-guidance.md", "Large documentation change.\n".repeat(4000));
		writeFixtureFile(repository, "frontend/src/pages/DashboardPage.module.css", ".dashboard { gap: 1.25rem; }\n");
	});
	const dashboard = selectedCliOutput(invokeSelector(fixture, { headSha: dashboardSha }));
	assert.deepEqual(dashboard.selection.groups, ["core-b", "planning-data"], JSON.stringify(dashboard.selection));
	assert.ok(dashboard.selection.paths.includes("docs/long-guidance.md"));
	assert.ok(dashboard.selection.paths.includes("frontend/src/pages/DashboardPage.module.css"));
	assert.deepEqual(JSON.parse(dashboard.outputs.matrix_groups), ["core-b", "planning-data"]);
	assert.equal(dashboard.outputs.ui_selected, "false");
	assert.match(dashboard.summary, /Selection: core-b, planning-data/);

	const editorSha = commitScenario(fixture, "authenticated-editor-flow", (repository) => {
		writeFixtureFile(repository, "frontend/src/pages/MedicationsPage.tsx", "export const MedicationPage = 2;\n");
	});
	const editor = selectedCliOutput(invokeSelector(fixture, { headSha: editorSha }));
	assert.deepEqual(editor.selection.groups, ["core-a", "core-b", "medication-data", "ui"]);
	assert.deepEqual(JSON.parse(editor.outputs.matrix_groups), ["core-a", "core-b", "medication-data"]);
	assert.equal(editor.outputs.ui_selected, "true");

	const medicationDeleteSha = commitScenario(fixture, "deleted-medication-route", (repository) => {
		rmSync(path.join(repository, "backend/src/routes/medications.ts"));
	});
	const medicationDelete = selectedCliOutput(invokeSelector(fixture, { headSha: medicationDeleteSha }));
	assert.ok(medicationDelete.selection.paths.includes("backend/src/routes/medications.ts"));
	assert.deepEqual(medicationDelete.selection.groups, [
		"core-a",
		"core-b",
		"medication-data",
		"planning-data",
	]);

	const renameSha = commitScenario(fixture, "rename-dashboard-to-docs", (repository) => {
		renameSync(
			path.join(repository, "frontend/src/pages/DashboardPage.module.css"),
			path.join(repository, "docs/renamed-dashboard-guidance.md")
		);
	});
	const rename = selectedCliOutput(invokeSelector(fixture, { headSha: renameSha }));
	assert.ok(rename.selection.paths.includes("frontend/src/pages/DashboardPage.module.css"));
	assert.ok(rename.selection.paths.includes("docs/renamed-dashboard-guidance.md"));
	assert.deepEqual(rename.selection.groups, ["core-b", "planning-data"]);

	const globalSha = commitScenario(fixture, "global-runtime-inputs", (repository) => {
		for (const filePath of [
			"shared/src/contracts.ts",
			"backend/src/db/schema.ts",
			"backend/src/routes/auth.ts",
			"package-lock.json",
			"frontend/package-lock.json",
			".github/workflows/test.yml",
		]) {
			writeFixtureFile(repository, filePath, "global change\n");
		}
	});
	const global = selectedCliOutput(invokeSelector(fixture, { headSha: globalSha }));
	assert.deepEqual(global.selection.groups, FULL_GROUPS);
	assert.equal(global.outputs.ui_selected, "true");
	assert.deepEqual(
		global.selection.paths.sort(),
		[
			".github/workflows/test.yml",
			"backend/src/db/schema.ts",
			"backend/src/routes/auth.ts",
			"frontend/package-lock.json",
			"package-lock.json",
			"shared/src/contracts.ts",
		].sort()
	);

	const unknownSha = commitScenario(fixture, "unknown-root-tool", (repository) => {
		writeFixtureFile(repository, "new-root-tool.mjs", "export {};\n");
	});
	assert.deepEqual(selectedCliOutput(invokeSelector(fixture, { headSha: unknownSha })).selection.groups, FULL_GROUPS);

	const mixedSha = commitScenario(fixture, "small-dashboard-plus-global", (repository) => {
		writeFixtureFile(repository, "frontend/src/pages/DashboardPage.module.css", ".dashboard { gap: 2rem; }\n");
		writeFixtureFile(repository, "shared/src/contracts.ts", "export const version = 2;\n");
	});
	assert.deepEqual(selectedCliOutput(invokeSelector(fixture, { headSha: mixedSha })).selection.groups, FULL_GROUPS);

	const noDiff = selectedCliOutput(invokeSelector(fixture));
	assert.deepEqual(noDiff.selection.groups, []);
	assert.deepEqual(JSON.parse(noDiff.outputs.matrix_groups), ["none"]);
	assert.match(noDiff.summary, /no browser groups/);
});

test("the PR selector CLI rejects failed upstream gates, invalid SHAs, and invalid manual input", (t) => {
	const fixture = createGitFixture();
	t.after(() => rmSync(fixture.repository, { recursive: true, force: true }));

	const failedUpstream = invokeSelector(fixture, { upstreamSuccess: "false" });
	assert.notEqual(failedUpstream.status, 0);
	assert.match(failedUpstream.stderr, /required gates failed or were cancelled/);

	const invalidSha = invokeSelector(fixture, { headSha: "not-a-full-sha" });
	assert.notEqual(invalidSha.status, 0);
	assert.match(invalidSha.stderr, /full 40-character commit SHAs/);

	const invalidManual = invokeSelector(fixture, {
		mode: "workflow_dispatch",
		manualGroups: "unknown",
	});
	assert.notEqual(invalidManual.status, 0);
	assert.match(invalidManual.stderr, /Unknown E2E group/);
});
