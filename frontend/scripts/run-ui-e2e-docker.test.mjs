import assert from "node:assert/strict";
import test from "node:test";
import { createShardPlan, parseOptions } from "./run-ui-e2e-docker.mjs";

test("defaults local UI Docker runs to one shard and supports explicit two-shard runs", () => {
	assert.equal(parseOptions([]).shards, 1);
	assert.equal(parseOptions(["--shards=2"]).shards, 2);
	assert.equal(parseOptions(["--shards=1"]).shards, 1);
	assert.equal(parseOptions([], { PLAYWRIGHT_UI_SHARDS: "1" }).shards, 1);
});

test("rejects invalid and conflicting shard counts and preserves repeat arguments", () => {
	for (const args of [
		["--shards=0"],
		["--shards=3"],
		["--shards=1", "--shards=2"],
		["--shards=2", "--update-snapshots"],
		["--repeat-each=0"],
	]) {
		assert.throws(() => parseOptions(args));
	}
	assert.throws(() => parseOptions([], { PLAYWRIGHT_UI_SHARDS: "3" }));
	assert.deepEqual(parseOptions(["--repeat-each=2"]), {
		shards: 1,
		updateSnapshots: false,
		repeatArgs: ["--repeat-each=2"],
		cache: true,
	});
	assert.equal(parseOptions(["--update-snapshots"]).shards, 1);
});

test("dependency caches are locked, shard-specific, and optional", () => {
	const first = createShardPlan(1, 2, "one", parseOptions(["--shards=2"]));
	const second = createShardPlan(2, 2, "two", parseOptions(["--shards=2"]));
	assert.match(first.args.at(-1), /flock .*install\.lock/);
	assert.ok(first.args.includes("--volume"));
	const cacheVolumes = (plan) => plan.args.filter((arg) => arg.startsWith("medassist-ui-deps-"));
	assert.equal(cacheVolumes(first).length, 4);
	assert.ok(cacheVolumes(first).every((volume) => !cacheVolumes(second).includes(volume)));
	const later = createShardPlan(1, 2, "later", parseOptions(["--shards=2"]));
	assert.deepEqual(cacheVolumes(first), cacheVolumes(later));
	const cold = createShardPlan(1, 1, "cold", parseOptions(["--no-cache"]));
	assert.equal(cacheVolumes(cold).length, 0);
	assert.doesNotMatch(cold.args.at(-1), /flock/);
	assert.ok(cold.args.includes("/work/frontend/node_modules:rw,exec"));
});

test("builds shard-specific Docker resources, Playwright selection, and report paths", () => {
	const options = {
		shards: 2,
		updateSnapshots: false,
		repeatArgs: ["--repeat-each=2"],
	};
	const first = createShardPlan(1, 2, "run-123", options);
	const second = createShardPlan(2, 2, "run-123", options);

	assert.notEqual(first.name, second.name);
	assert.notEqual(first.outputDir, second.outputDir);
	assert.notEqual(first.reportDir, second.reportDir);
	assert.deepEqual(first.testArgs, ["--shard=1/2", "--repeat-each=2"]);
	assert.deepEqual(second.testArgs, ["--shard=2/2", "--repeat-each=2"]);
	assert.deepEqual(first.args.slice(0, 6), ["run", "--rm", "--init", "--name", first.name, "--platform=linux/amd64"]);
	assert.ok(first.args.includes("/work/shared/dist:rw,exec"));
	assert.ok(first.args.includes(`PLAYWRIGHT_OUTPUT_DIR=${first.outputDir}`));
	assert.ok(first.args.includes(`PLAYWRIGHT_HTML_OUTPUT_DIR=${first.reportDir}`));
	assert.ok(first.args.at(-1).includes("--shard=1/2 --repeat-each=2"));
});
