import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { validateAgentHarness } from "./validate-agent-harness.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = new URL("./validate-agent-harness.mjs", import.meta.url).pathname;
const ORCHESTRATOR_AGENTS = [
  "model-router",
  "fast-task",
  "standard-task",
  "complex-task",
  "engineering-reviewer",
  "testing-manager",
  "release-manager",
  "project-bot",
];
const ALL_AGENTS = ["engineering-orchestrator", ...ORCHESTRATOR_AGENTS];
const EXPECTED_AGENT_MODELS = {
  "engineering-orchestrator": "GPT-5.6 Terra",
  "model-router": "GPT-5.6 Luna",
  "fast-task": "GPT-5.6 Luna",
  "standard-task": "GPT-5.6 Terra",
  "complex-task": "GPT-5.6 Sol",
  "engineering-reviewer": "GPT-5.6 Sol",
  "testing-manager": "GPT-5.6 Terra",
  "release-manager": "GPT-5.6 Sol",
  "project-bot": "GPT-5.6 Luna",
};

function agentSource(name, attributes = {}, body = `# ${name}\n`) {
  const entries = {
    name,
    description: `Fixture definition for ${name}.`,
    agents: [],
    ...attributes,
  };
  const frontmatter = Object.entries(entries)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: [${value.map((item) => `'${item}'`).join(", ")}]`;
      return `${key}: ${value}`;
    })
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}

async function createValidFixture(testContext) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "medassist-agent-harness-"));
  testContext.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, ".github/agents"), { recursive: true });
  await mkdir(path.join(rootDir, ".github/skills/example-skill"), { recursive: true });

  const orchestratorBody = `# Engineering Orchestrator

Ask \`model-router\` to select Fast, Standard, or Complex.
Route test planning directly to \`testing-manager\`.
Route release work directly to \`release-manager\`.
Send metadata-only GitHub coordination to \`project-bot\`.
`;

  for (const name of ALL_AGENTS) {
    const attributes = { model: EXPECTED_AGENT_MODELS[name] };
    let body;
    if (name === "engineering-orchestrator") {
      attributes.agents = ORCHESTRATOR_AGENTS;
      attributes["user-invocable"] = true;
      body = orchestratorBody;
    }
    if (name !== "engineering-orchestrator") {
      attributes["user-invocable"] = false;
    }
    if (name === "model-router") attributes.tools = [];

    await writeFile(
      path.join(rootDir, `.github/agents/${name}.agent.md`),
      agentSource(name, attributes, body),
    );
  }

  await writeFile(
    path.join(rootDir, ".github/skills/example-skill/SKILL.md"),
    "---\nname: example-skill\ndescription: Valid fixture skill for harness tests.\n---\n",
  );

  const governance = `${ALL_AGENTS.join("\n")}

Route specialist work directly; do not send testing, release, or metadata-only work through a generic task worker.
Keep one implementation owner and one writer per file set.
Limit normal parallel fan-out to three independent read-only workers.
Allow at most one focused repair pass after review.
Start with the lowest capable tier.
`;
  await writeFile(path.join(rootDir, "AGENTS.md"), governance);
  await writeFile(
    path.join(rootDir, ".github/copilot-instructions.md"),
    `Treat AGENTS.md as canonical when available.\n${governance}`,
  );
  return rootDir;
}

async function mutate(rootDir, relativePath, transform) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, "utf8");
  await writeFile(filePath, transform(source));
}

function assertHasError(errors, expectedText) {
  assert.ok(
    errors.some((error) => error.includes(expectedText)),
    `Expected an error containing "${expectedText}", received:\n${errors.join("\n")}`,
  );
}

test("accepts a complete non-recursive harness with direct specialist routing", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  assert.deepEqual(await validateAgentHarness({ rootDir }), []);
});

test("rejects an agent assigned to the wrong model tier", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/fast-task.agent.md", (source) =>
    source.replace("model: GPT-5.6 Luna", "model: GPT-5.6 Sol"),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    ".github/agents/fast-task.agent.md: model must be GPT-5.6 Luna",
  );
});

test("reports malformed frontmatter with the file and line", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/fast-task.agent.md", (source) =>
    source.replace("description: Fixture", "description Fixture"),
  );

  const errors = await validateAgentHarness({ rootDir });
  assertHasError(errors, ".github/agents/fast-task.agent.md:3: unsupported frontmatter syntax");
});

test("rejects an agent name that does not match its filename", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/engineering-reviewer.agent.md", (source) =>
    source.replace("name: engineering-reviewer", "name: reviewer"),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    "frontmatter name must be engineering-reviewer, received reviewer",
  );
});

test("discovers additional managed agents and rejects unknown references", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await writeFile(
    path.join(rootDir, ".github/agents/additional-worker.agent.md"),
    agentSource("additional-worker", { agents: ["missing-worker"] }),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    "additional-worker.agent.md: agents references unknown managed agent missing-worker",
  );
});

test("detects cycles across additional managed agents", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await writeFile(
    path.join(rootDir, ".github/agents/worker-a.agent.md"),
    agentSource("worker-a", { agents: ["worker-b"] }),
  );
  await writeFile(
    path.join(rootDir, ".github/agents/worker-b.agent.md"),
    agentSource("worker-b", { agents: ["worker-a"] }),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    "agent delegation graph: cycle detected: worker-a -> worker-b -> worker-a",
  );
});

test("ignores generated Spec Kit agent files in fixture discovery", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await writeFile(
    path.join(rootDir, ".github/agents/speckit.plan.agent.md"),
    "generated content without supported frontmatter",
  );
  await writeFile(
    path.join(rootDir, ".github/agents/medassist-feature-orchestrator.agent.md"),
    "generated content without supported frontmatter",
  );

  assert.deepEqual(await validateAgentHarness({ rootDir }), []);
});

test("validates every managed skill folder name and description", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mkdir(path.join(rootDir, ".github/skills/broken-skill"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".github/skills/broken-skill/SKILL.md"),
    "---\nname: wrong-name\ndescription: ''\n---\n",
  );

  const errors = await validateAgentHarness({ rootDir });
  assertHasError(errors, "frontmatter name must match skill folder broken-skill, received wrong-name");
  assertHasError(errors, "broken-skill/SKILL.md: frontmatter description must be a non-empty string");
});

test("rejects missing or extra orchestrator delegation targets", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/engineering-orchestrator.agent.md", (source) =>
    source.replace("'engineering-reviewer', ", ""),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    "agents must contain exactly model-router, fast-task, standard-task, complex-task, engineering-reviewer",
  );
});

test("rejects recursive leaf delegation", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/testing-manager.agent.md", (source) =>
    source.replace("agents: []", "agents: ['standard-task']"),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    ".github/agents/testing-manager.agent.md: agents must be [] to prevent recursive delegation",
  );
});

test("keeps the classifier inert and internal agents hidden", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/engineering-orchestrator.agent.md", (source) =>
    source.replace("user-invocable: true", "user-invocable: false"),
  );
  await mutate(rootDir, ".github/agents/model-router.agent.md", (source) =>
    source.replace("tools: []", "tools: ['execute']"),
  );
  await mutate(rootDir, ".github/agents/engineering-reviewer.agent.md", (source) =>
    source.replace("user-invocable: false", "user-invocable: true"),
  );
  await mutate(rootDir, ".github/agents/fast-task.agent.md", (source) =>
    source.replace("user-invocable: false", "user-invocable: true"),
  );
  await mutate(rootDir, ".github/agents/project-bot.agent.md", (source) =>
    source.replace("user-invocable: false", "user-invocable: true"),
  );

  const errors = await validateAgentHarness({ rootDir });
  assertHasError(errors, "engineering-orchestrator.agent.md: user-invocable must be true");
  assertHasError(errors, "model-router.agent.md: tools must be [] because the router only classifies work");
  assertHasError(errors, "engineering-reviewer.agent.md: user-invocable must be false");
  assertHasError(errors, "fast-task.agent.md: user-invocable must be false");
  assertHasError(errors, "project-bot.agent.md: user-invocable must be false");
});

for (const [label, text, expectedError] of [
  ["testing", "directly to `testing-manager`", "must route testing work directly to testing-manager"],
  ["release", "directly to `release-manager`", "must route release work directly to release-manager"],
  [
    "project metadata",
    "metadata-only GitHub coordination to `project-bot`",
    "must route metadata-only GitHub work directly to project-bot",
  ],
]) {
  test(`enforces direct ${label} routing`, async (testContext) => {
    const rootDir = await createValidFixture(testContext);
    await mutate(rootDir, ".github/agents/engineering-orchestrator.agent.md", (source) =>
      source.replace(text, "to `standard-task`"),
    );

    assertHasError(await validateAgentHarness({ rootDir }), expectedError);
  });
}

for (const relativePath of ["AGENTS.md", ".github/copilot-instructions.md"]) {
  test(`${relativePath} must preserve the routing role inventory`, async (testContext) => {
    const rootDir = await createValidFixture(testContext);
    await mutate(rootDir, relativePath, (source) => source.replace("engineering-reviewer\n", ""));

    assertHasError(
      await validateAgentHarness({ rootDir }),
      `${relativePath}: must name engineering-reviewer for independent engineering review`,
    );
  });

  for (const [contract, replacement, expectedError] of [
    [
      "Keep one implementation owner and one writer per file set.",
      "Use any number of implementation owners and writers.",
      "must preserve one implementation owner and one writer per file set",
    ],
    [
      "Limit normal parallel fan-out to three independent read-only workers.",
      "Parallel fan-out is unrestricted.",
      "must limit normal fan-out to three independent read-only workers",
    ],
    [
      "Allow at most one focused repair pass after review.",
      "Allow repeated repair passes after review.",
      "must allow at most one repair pass",
    ],
    [
      "Start with the lowest capable tier.",
      "Start with the complex tier.",
      "must preserve lowest-capable-tier cost control",
    ],
  ]) {
    test(`${relativePath} preserves ${expectedError}`, async (testContext) => {
      const rootDir = await createValidFixture(testContext);
      await mutate(rootDir, relativePath, (source) => source.replace(contract, replacement));

      assertHasError(await validateAgentHarness({ rootDir }), `${relativePath}: ${expectedError}`);
    });
  }
}

test("rejects a fallback that contradicts direct specialist routing", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/copilot-instructions.md", (source) =>
    `${source}\nWhen testing-manager is unavailable, route testing through standard-task.\n`,
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    ".github/copilot-instructions.md: must not route specialist work through a generic task worker",
  );
});

test("fallback must keep AGENTS.md canonical", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/copilot-instructions.md", (source) =>
    source.replace("Treat AGENTS.md as canonical", "Treat AGENTS.md as optional"),
  );

  assertHasError(
    await validateAgentHarness({ rootDir }),
    ".github/copilot-instructions.md: must keep AGENTS.md canonical when the fallback is used",
  );
});

test("the CLI exits non-zero and prints actionable failures", async (testContext) => {
  const rootDir = await createValidFixture(testContext);
  await mutate(rootDir, ".github/agents/complex-task.agent.md", (source) =>
    source.replace("agents: []", "agents: ['complex-task']"),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT_PATH, rootDir]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Agent harness validation failed with 2 error/);
      assert.match(error.stderr, /cycle detected: complex-task -> complex-task/);
      assert.match(error.stderr, /complex-task\.agent\.md: agents must be \[\]/);
      return true;
    },
  );
});