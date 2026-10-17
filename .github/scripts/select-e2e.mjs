import { appendFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const GROUPS = [
	"core-a",
	"core-b",
	"medication-data",
	"planning-data",
	"ui",
	"performance",
];
export const FULL_GROUPS = [...GROUPS];

const SPECS_BY_GROUP = {
	"core-a": [
		"app-shell.spec.ts",
		"as-needed-record-now.spec.ts",
		"as-needed-take-polish.spec.ts",
		"auth.spec.ts",
		"button-height-contract.spec.ts",
		"medications.spec.ts",
		"refill-restock-matrix.spec.ts",
		"schedule.spec.ts",
	],
	"core-b": [
		"accessibility-audit.spec.ts",
		"auth-session.spec.ts",
		"dashboard.spec.ts",
		"domain-safety.spec.ts",
		"export-import.spec.ts",
		"med-detail-footer-actions.spec.ts",
		"mobile-modal-history.spec.ts",
		"modal-layout-contract.spec.ts",
		"planner.spec.ts",
		"settings.spec.ts",
	],
	"medication-data": [
		"medication-crud.spec.ts",
		"medication-edit.spec.ts",
		"medication-lifecycle.spec.ts",
		"stock-status.spec.ts",
	],
	"planning-data": [
		"dashboard-data.spec.ts",
		"planner-data.spec.ts",
		"schedule-data.spec.ts",
		"share-schedule.spec.ts",
		"tooltip-data.spec.ts",
	],
	ui: ["medication-ui-regression.spec.ts"],
	performance: ["performance.spec.ts"],
};

const SPEC_GROUPS = new Map();
for (const [group, specs] of Object.entries(SPECS_BY_GROUP)) {
	for (const spec of specs) {
		const groups = SPEC_GROUPS.get(spec) ?? [];
		groups.push(group);
		SPEC_GROUPS.set(spec, groups);
	}
}

const PLAYWRIGHT_PROJECTS = {
	"core-a": "chromium",
	"core-b": "chromium",
	"medication-data": "chromium-data",
	"planning-data": "chromium-data",
	ui: "chromium-ui",
	performance: "chromium-data",
};

const GLOBAL_FULL_PATTERNS = [
	/^\.github\/workflows\//,
	/^\.github\/actions\//,
	/^\.github\/scripts\//,
	/^shared\//,
	/^(?:package(?:-lock)?\.json|release-policy\.json|biome\.json|knip\.jsonc)$/,
	/^(?:backend|frontend)\/package(?:-lock)?\.json$/,
	/^backend\/src\/db\//,
	/^backend\/src\/(?:plugins\/auth|routes\/(?:auth|oidc)\.ts)(?:\/|$)/,
	/^frontend\/playwright[^/]*\.ts$/,
	/^frontend\/playwright\.config/,
	/^frontend\/scripts\//,
	/^frontend\/e2e\/(?:auth\.setup|fixtures\/)/,
	/^frontend\/src\/(?:App\.|main\.|context\/|router\/|i18n\/|api\/)/,
];

const NON_PRODUCT_PATHS = [
	/^(?:README(?:\.[^/]*)?|AGENTS\.md|MEMORY\.md)$/,
	/^(?:docs|doku)\//,
	/^\.github\/(?:agents|skills|prompts)\//,
	/^\.github\/copilot-instructions\.md$/,
];

const EDITOR_GROUPS = ["core-a", "core-b", "medication-data", "ui"];
const DASHBOARD_GROUPS = ["core-b", "planning-data"];
const PLANNER_GROUPS = ["core-a", "core-b", "planning-data"];
const MEDICATION_GROUPS = ["core-a", "core-b", "medication-data", "planning-data"];
const SETTINGS_GROUPS = ["core-b", "planning-data"];

function normalizePath(value) {
	return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function groupsForPath(rawPath) {
	const filePath = normalizePath(rawPath);

	if (NON_PRODUCT_PATHS.some((pattern) => pattern.test(filePath))) {
		return { groups: [], reason: "documentation or agent guidance only" };
	}

	if (GLOBAL_FULL_PATTERNS.some((pattern) => pattern.test(filePath))) {
		return { groups: FULL_GROUPS, reason: "global runtime, contract, dependency, or test infrastructure" };
	}

	if (filePath.startsWith("frontend/e2e/") && filePath.endsWith(".spec.ts")) {
		const spec = filePath.slice("frontend/e2e/".length);
		const mappedGroups = SPEC_GROUPS.get(spec);
		if (mappedGroups) {
			return { groups: mappedGroups, reason: `mapped E2E spec: ${spec}` };
		}
		return { groups: FULL_GROUPS, reason: `unmapped E2E spec: ${spec}` };
	}

	if (/^frontend\/src\/ui\/primitives\/DataTable\./.test(filePath)) {
		return { groups: FULL_GROUPS, reason: "shared data-table coverage across product screens" };
	}

	if (
		filePath === "frontend/src/pages/DashboardPage.tsx" ||
		filePath === "frontend/src/pages/DashboardPage.module.css"
	) {
		return { groups: DASHBOARD_GROUPS, reason: "dashboard browser and data coverage" };
	}

	if (
		filePath === "frontend/src/pages/MedicationsPage.tsx" ||
		filePath.startsWith("frontend/src/pages/MedicationsPage.") ||
		filePath.startsWith("frontend/src/components/MobileEditModal.") ||
		/^frontend\/src\/ui\/modal\/AppModal\./.test(filePath) ||
		filePath.startsWith("frontend/src/hooks/useModalHistory.") ||
		filePath.startsWith("frontend/src/styles/") ||
		(filePath.startsWith("frontend/src/components/") && filePath.endsWith(".css"))
	) {
		return { groups: EDITOR_GROUPS, reason: "editor, modal, or shared-style coverage" };
	}

	if (
		/^backend\/src\/routes\/medications\.ts$/.test(filePath) ||
		/^backend\/src\/services\/(?:medication|stock|refill)[^/]*$/.test(filePath)
	) {
		return { groups: MEDICATION_GROUPS, reason: "medication-domain browser and data coverage" };
	}

	if (
		/^backend\/src\/routes\/(?:planner|settings)\.ts$/.test(filePath) ||
		/^backend\/src\/services\/(?:reminder-scheduler|planner|schedule)[^/]*$/.test(filePath)
	) {
		return { groups: PLANNER_GROUPS, reason: "planning and schedule browser/data coverage" };
	}

	if (/^frontend\/src\/pages\/PlannerPage\.[^/]+$/.test(filePath)) {
		return { groups: PLANNER_GROUPS, reason: "planner/schedule browser and data coverage" };
	}

	if (/^frontend\/src\/pages\/SettingsPage\.[^/]+$/.test(filePath)) {
		return { groups: SETTINGS_GROUPS, reason: "planning/settings browser and data coverage" };
	}

	if (filePath.startsWith("backend/") || filePath.startsWith("frontend/") || filePath.startsWith("shared/")) {
		return { groups: FULL_GROUPS, reason: "unclassified product path; conservative full browser coverage" };
	}

	return { groups: FULL_GROUPS, reason: "unclassified path; conservative full browser coverage" };
}

export function assertSpecInventory(specNames) {
	const actual = [...specNames].sort();
	const expected = [...SPEC_GROUPS.keys()].sort();
	const unique = new Set(actual);
	const missing = expected.filter((spec) => !actual.includes(spec));
	const unassigned = actual.filter((spec) => !SPEC_GROUPS.has(spec));

	if (missing.length || unassigned.length || unique.size !== actual.length) {
		throw new Error(
			`Playwright E2E selector inventory mismatch. Unassigned specs: ${unassigned.join(", ") || "none"}. ` +
				`Stale mappings: ${missing.join(", ") || "none"}. ` +
				`${unique.size !== actual.length ? "Duplicate spec filenames detected. " : ""}` +
				"Update SPECS_BY_GROUP in .github/scripts/select-e2e.mjs."
		);
	}

	return true;
}

export function getSpecsForGroup(group) {
	const specs = SPECS_BY_GROUP[group];
	if (!specs) throw new Error(`Unknown Playwright group: ${group}.`);
	return [...specs];
}

export function getProjectForGroup(group) {
	const project = PLAYWRIGHT_PROJECTS[group];
	if (!project) throw new Error(`Unknown Playwright group: ${group}.`);
	return project;
}

export function buildPlaywrightArgs(group) {
	const specs = getSpecsForGroup(group);
	const project = getProjectForGroup(group);
	return ["test", "--config=playwright.stable.config.ts", `--project=${project}`, ...specs.map((spec) => `e2e/${spec}`)];
}

export function checkRepositorySpecInventory(root = ROOT) {
	const specDirectory = path.join(root, "frontend/e2e");
	const findSpecs = (directory) =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const filePath = path.join(directory, entry.name);
			if (entry.isDirectory()) return findSpecs(filePath);
			if (!entry.isFile() || !entry.name.endsWith(".spec.ts")) return [];
			return [path.relative(specDirectory, filePath).split(path.sep).join("/")];
		});
	const specs = findSpecs(specDirectory).sort();
	return assertSpecInventory(specs);
}

export function parseNameStatus(output) {
	const fields = output.split("\0");
	const paths = [];

	for (let index = 0; index < fields.length; ) {
		const status = fields[index++];
		if (!status) continue;

		const pathCount = /^[RC]/.test(status) ? 2 : 1;
		for (let count = 0; count < pathCount; count++) {
			const changedPath = fields[index++];
			if (changedPath === undefined) {
				throw new Error(`Malformed git diff --name-status output near status ${status}.`);
			}
			paths.push(changedPath);
		}
	}

	return paths;
}

export function selectGroups(changedPaths) {
	if (changedPaths.length === 0) {
		return {
			groups: [],
			reason: "no browser-relevant paths changed",
			reasons: [],
		};
	}

	const selected = new Set();
	const reasons = [];
	for (const changedPath of changedPaths) {
		const classification = groupsForPath(changedPath);
		for (const group of classification.groups) selected.add(group);
		reasons.push({ path: normalizePath(changedPath), reason: classification.reason });
	}

	const groups = GROUPS.filter((group) => selected.has(group));
	const reason = groups.length ? "selected by conservative path scope" : "documentation or non-product changes only";
	return { groups, reason, reasons };
}

export function resolveManualGroups(value) {
	const requested = value
		.split(",")
		.map((group) => group.trim())
		.filter(Boolean);
	if (requested.length === 0) throw new Error("Manual selection must name at least one E2E group.");
	if (requested.includes("full")) {
		if (requested.length !== 1) throw new Error("Use 'full' alone or list specific E2E groups.");
		return FULL_GROUPS;
	}

	const invalid = requested.filter((group) => !GROUPS.includes(group));
	if (invalid.length) {
		throw new Error(`Unknown E2E group(s): ${invalid.join(", ")}. Allowed groups: full, ${GROUPS.join(", ")}.`);
	}

	return GROUPS.filter((group) => requested.includes(group));
}

function readChangedPaths(baseSha, headSha, repositoryRoot = ROOT) {
	if (!/^[0-9a-f]{40}$/i.test(baseSha) || !/^[0-9a-f]{40}$/i.test(headSha)) {
		throw new Error("Pull request base/head must be full 40-character commit SHAs.");
	}
	const output = execFileSync(
		"git",
		["diff", "--name-status", "-z", "--find-renames", `${baseSha}...${headSha}`],
		{ cwd: repositoryRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
	);
	return parseNameStatus(output);
}

export function resolveEventSelection(env) {
	const mode = env.SELECTION_MODE ?? env.GITHUB_EVENT_NAME;
	if (mode === "schedule") {
		return { groups: FULL_GROUPS, reason: "scheduled complete suite, including performance", paths: [] };
	}

	if (mode === "workflow_dispatch") {
		return {
			groups: resolveManualGroups(env.MANUAL_GROUPS ?? "full"),
			reason: "explicit workflow_dispatch selection",
			paths: [],
		};
	}

	if (mode === "pull_request") {
		if (env.UPSTREAM_SUCCESS === "false") {
			throw new Error("Backend/frontend required gates failed or were cancelled; refusing to report E2E success.");
		}
		const paths = readChangedPaths(
			env.BASE_SHA ?? "",
			env.HEAD_SHA ?? "",
			env.E2E_REPOSITORY_ROOT ?? ROOT
		);
		return { ...selectGroups(paths), paths };
	}

	throw new Error(`Unsupported workflow event for E2E selection: ${mode || "missing"}.`);
}

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) return;
	appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function run() {
	checkRepositorySpecInventory();
	const env = {
		...process.env,
	};
	const selection = resolveEventSelection(env);
	const standardGroups = selection.groups.filter((group) => group !== "ui");
	const selectedStandardGroups = standardGroups.length ? standardGroups : ["none"];
	const output = {
		groups: selection.groups,
		matrix_groups: selectedStandardGroups,
		ui_selected: selection.groups.includes("ui"),
		reason: selection.reason,
		reasons: selection.reasons ?? [],
		paths: selection.paths,
		target_ref: process.env.TARGET_REF ?? process.env.GITHUB_REF ?? "unknown",
		target_sha: process.env.TARGET_SHA ?? process.env.GITHUB_SHA ?? "unknown",
	};

	setOutput("groups", JSON.stringify(output.groups));
	setOutput("matrix_groups", JSON.stringify(output.matrix_groups));
	setOutput("ui_selected", String(output.ui_selected));
	setOutput("reason", output.reason);
	setOutput("target_sha", output.target_sha);
	console.log(JSON.stringify(output, null, 2));

	if (process.env.GITHUB_STEP_SUMMARY) {
		const summary = [
			"## Playwright E2E selection",
			"",
			`- Target ref: \`${output.target_ref.replaceAll("`", "'")}\``,
			`- Target commit: \`${output.target_sha}\``,
			`- Selection: ${output.groups.length ? output.groups.join(", ") : "no browser groups"}`,
			`- Reason: ${output.reason}`,
			"- Changed paths (JSON):",
			"",
			"```json",
			JSON.stringify(output.paths, null, 2),
			"```",
			"",
		].join("\n");
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	run();
}
