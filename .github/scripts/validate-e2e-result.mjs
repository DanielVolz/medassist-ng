import { pathToFileURL } from "node:url";

export function validateE2EResult({
	selectionResult,
	standardResult,
	uiResult,
	uiSelected,
	groups,
	reason,
	targetSha,
}) {
	console.log(`Target commit: ${targetSha}`);
	console.log(`Selected groups: ${groups}`);
	console.log(`Reason: ${reason}`);

	if (selectionResult !== "success") {
		throw new Error("E2E selection failed; refusing to report success.");
	}
	if (standardResult !== "success") {
		throw new Error("The standard Playwright matrix did not succeed.");
	}
	if (uiSelected === "true" && uiResult !== "success") {
		throw new Error("The selected medication UI group did not succeed.");
	}
	if (uiSelected === "false" && uiResult !== "skipped") {
		throw new Error("The unselected medication UI group should remain skipped.");
	}
	if (uiSelected !== "true" && uiSelected !== "false") {
		throw new Error("The medication UI selection output must be true or false.");
	}

	console.log(
		"Aggregate Playwright result is successful; intentionally unselected groups remain visible as skipped jobs."
	);
}

function run() {
	validateE2EResult({
		selectionResult: process.env.SELECTION_RESULT,
		standardResult: process.env.STANDARD_RESULT,
		uiResult: process.env.UI_RESULT,
		uiSelected: process.env.UI_SELECTED,
		groups: process.env.GROUPS ?? "",
		reason: process.env.REASON ?? "",
		targetSha: process.env.TARGET_SHA ?? "",
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		run();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
