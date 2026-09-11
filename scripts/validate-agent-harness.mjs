#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const AGENT_DIRECTORY = ".github/agents";
const SKILL_DIRECTORY = ".github/skills";
const ORCHESTRATOR = "engineering-orchestrator";
const REQUIRED_AGENTS = [
  ORCHESTRATOR,
  "model-router",
  "fast-task",
  "standard-task",
  "complex-task",
  "engineering-reviewer",
  "testing-manager",
  "release-manager",
  "project-bot",
];
const ORCHESTRATOR_AGENTS = REQUIRED_AGENTS.filter((name) => name !== ORCHESTRATOR);
const NON_RECURSIVE_AGENTS = ORCHESTRATOR_AGENTS;
const HIDDEN_INTERNAL_AGENTS = [
  "model-router",
  "fast-task",
  "standard-task",
  "complex-task",
  "engineering-reviewer",
  "testing-manager",
  "release-manager",
  "project-bot",
];
const GENERATED_AGENT_NAMES = new Set(["medassist-feature-orchestrator"]);
const execFileAsync = promisify(execFile);

function parseScalar(value, filePath, lineNumber) {
  const trimmed = value.trim();

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const content = trimmed.slice(1, -1).trim();
    if (!content) return [];

    return content.split(",").map((entry) => {
      const item = entry.trim();
      const quote = item[0];
      if ((quote !== "'" && quote !== '"') || item.at(-1) !== quote) {
        throw new Error(`${filePath}:${lineNumber}: inline array entries must be quoted`);
      }
      return item.slice(1, -1);
    });
  }

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  if (!trimmed) {
    throw new Error(`${filePath}:${lineNumber}: frontmatter values must not be empty`);
  }

  return trimmed;
}

export function parseFrontmatter(source, filePath = "agent file") {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error(`${filePath}:1: expected frontmatter opening delimiter ---`);
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    throw new Error(`${filePath}: missing frontmatter closing delimiter ---`);
  }

  const attributes = {};
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;

    const match = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${filePath}:${index + 1}: unsupported frontmatter syntax: ${line}`);
    }

    const [, key, rawValue] = match;
    if (Object.hasOwn(attributes, key)) {
      throw new Error(`${filePath}:${index + 1}: duplicate frontmatter key ${key}`);
    }
    attributes[key] = parseScalar(rawValue, filePath, index + 1);
  }

  return {
    attributes,
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

function requireBodyContract(errors, filePath, body, pattern, message) {
  if (!pattern.test(body)) {
    errors.push(`${filePath}: ${message}`);
  }
}

async function readText(rootDir, relativePath, errors) {
  try {
    return await readFile(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    errors.push(`${relativePath}: unable to read file (${error.code ?? error.message})`);
    return null;
  }
}

function isManagedAgentPath(relativePath) {
  const filename = path.posix.basename(relativePath);
  const name = filename.replace(/\.agent\.md$/, "");
  return (
    relativePath.startsWith(`${AGENT_DIRECTORY}/`) &&
    filename.endsWith(".agent.md") &&
    !name.startsWith("speckit.") &&
    !GENERATED_AGENT_NAMES.has(name)
  );
}

async function listFixtureFiles(rootDir) {
  const agentPaths = [];
  const skillPaths = [];

  try {
    const entries = await readdir(path.join(rootDir, AGENT_DIRECTORY), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${AGENT_DIRECTORY}/${entry.name}`;
      if (entry.isFile() && isManagedAgentPath(relativePath)) agentPaths.push(relativePath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    const entries = await readdir(path.join(rootDir, SKILL_DIRECTORY), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${SKILL_DIRECTORY}/${entry.name}/SKILL.md`;
      try {
        const skillEntries = await readdir(path.join(rootDir, SKILL_DIRECTORY, entry.name));
        if (skillEntries.includes("SKILL.md")) skillPaths.push(relativePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return { agentPaths, skillPaths };
}

async function listManagedFiles(rootDir) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "ls-files", "-z", "--", `${AGENT_DIRECTORY}/*.agent.md`, `${SKILL_DIRECTORY}/*/SKILL.md`],
      { encoding: "utf8" },
    );
    const trackedPaths = stdout.split("\0").filter(Boolean);
    return {
      agentPaths: trackedPaths.filter(isManagedAgentPath),
      skillPaths: trackedPaths.filter(
        (relativePath) =>
          relativePath.startsWith(`${SKILL_DIRECTORY}/`) && relativePath.endsWith("/SKILL.md"),
      ),
    };
  } catch {
    return listFixtureFiles(rootDir);
  }
}

function findDelegationCycles(agents, errors) {
  const states = new Map();
  const stack = [];
  const reportedCycles = new Set();

  function visit(agentName) {
    states.set(agentName, "visiting");
    stack.push(agentName);

    const targets = agents.get(agentName)?.attributes.agents ?? [];
    for (const target of targets) {
      if (!agents.has(target)) continue;
      if (states.get(target) === "visiting") {
        const cycle = [...stack.slice(stack.indexOf(target)), target];
        const signature = [...new Set(cycle)].sort().join("|");
        if (!reportedCycles.has(signature)) {
          reportedCycles.add(signature);
          errors.push(`agent delegation graph: cycle detected: ${cycle.join(" -> ")}`);
        }
      } else if (!states.has(target)) {
        visit(target);
      }
    }

    stack.pop();
    states.set(agentName, "visited");
  }

  for (const agentName of agents.keys()) {
    if (!states.has(agentName)) visit(agentName);
  }
}

function validateGovernanceDocument(errors, relativePath, source, { fallback = false } = {}) {
  for (const [agentName, purpose] of [
    ["engineering-orchestrator", "universal engineering coordination"],
    ["engineering-reviewer", "independent engineering review"],
    ["testing-manager", "testing ownership"],
    ["release-manager", "release ownership"],
    ["project-bot", "metadata-only GitHub coordination"],
    ["model-router", "model-tier routing"],
  ]) {
    if (!source.includes(agentName)) {
      errors.push(`${relativePath}: must name ${agentName} for ${purpose}`);
    }
  }

  for (const [pattern, message] of [
    [
      /(?:route specialist work directly|testing (?:goes|work goes) directly to [`@]*testing-manager)/i,
      "must preserve direct specialist routing",
    ],
    [
      /(?:one implementation owner and one writer|one implementation owner;.*one writer)/i,
      "must preserve one implementation owner and one writer per file set",
    ],
    [
      /(?:independent read-only[\s\S]{0,200}fan-out to three|fan-out to three[\s\S]{0,200}independent read-only|up to three parallel subagents only for independent read-only)/i,
      "must limit normal fan-out to three independent read-only workers",
    ],
    [/(?:one focused repair pass|one implementation repair pass)/i, "must allow at most one repair pass"],
    [
      /(?:lowest capable|lowest viable)[^.\n]{0,100} tier/i,
      "must preserve lowest-capable-tier cost control",
    ],
  ]) {
    requireBodyContract(errors, relativePath, source, pattern, message);
  }

  const indirectSpecialistPattern =
    /(?:testing|test planning|release|metadata(?:-only)?(?: GitHub)?|project metadata)[^\n.]{0,100}(?:through|to) [`@]*(?:fast-task|standard-task|complex-task)/i;
  if (indirectSpecialistPattern.test(source)) {
    errors.push(`${relativePath}: must not route specialist work through a generic task worker`);
  }

  if (fallback && !/AGENTS\.md[^\n.]{0,100}canonical/i.test(source)) {
    errors.push(`${relativePath}: must keep AGENTS.md canonical when the fallback is used`);
  }
}

export async function validateAgentHarness({ rootDir = process.cwd() } = {}) {
  const errors = [];
  const agents = new Map();
  const discovered = await listManagedFiles(rootDir);
  const requiredAgentPaths = REQUIRED_AGENTS.map(
    (name) => `${AGENT_DIRECTORY}/${name}.agent.md`,
  );
  const agentPaths = [...new Set([...discovered.agentPaths, ...requiredAgentPaths])].sort();

  for (const relativePath of agentPaths) {
    const expectedName = path.posix.basename(relativePath).replace(/\.agent\.md$/, "");
    const source = await readText(rootDir, relativePath, errors);
    if (source === null) continue;

    try {
      const parsed = parseFrontmatter(source, relativePath);
      agents.set(expectedName, { ...parsed, relativePath });
      if (parsed.attributes.name !== expectedName) {
        errors.push(
          `${relativePath}: frontmatter name must be ${expectedName}, received ${String(parsed.attributes.name)}`,
        );
      }
      if (
        typeof parsed.attributes.description !== "string" ||
        parsed.attributes.description.trim().length === 0
      ) {
        errors.push(`${relativePath}: frontmatter description must be a non-empty string`);
      }
      if (!Array.isArray(parsed.attributes.agents)) {
        errors.push(`${relativePath}: frontmatter agents must be an array`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const relativePath of discovered.skillPaths.sort()) {
    const expectedName = relativePath.split("/").at(-2);
    const source = await readText(rootDir, relativePath, errors);
    if (source === null) continue;

    try {
      const { attributes } = parseFrontmatter(source, relativePath);
      if (attributes.name !== expectedName) {
        errors.push(
          `${relativePath}: frontmatter name must match skill folder ${expectedName}, received ${String(attributes.name)}`,
        );
      }
      if (typeof attributes.description !== "string" || attributes.description.trim().length === 0) {
        errors.push(`${relativePath}: frontmatter description must be a non-empty string`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const agent of agents.values()) {
    if (!Array.isArray(agent.attributes.agents)) continue;
    for (const target of agent.attributes.agents) {
      if (!agents.has(target)) {
        errors.push(`${agent.relativePath}: agents references unknown managed agent ${String(target)}`);
      }
    }
  }
  findDelegationCycles(agents, errors);

  const orchestrator = agents.get(ORCHESTRATOR);
  if (orchestrator) {
    if (orchestrator.attributes["user-invocable"] !== true) {
      errors.push(`${orchestrator.relativePath}: user-invocable must be true`);
    }
    if (!sameMembers(orchestrator.attributes.agents, ORCHESTRATOR_AGENTS)) {
      errors.push(
        `${orchestrator.relativePath}: agents must contain exactly ${ORCHESTRATOR_AGENTS.join(", ")}`,
      );
    }

    requireBodyContract(
      errors,
      orchestrator.relativePath,
      orchestrator.body,
      /ask `model-router` to select Fast, Standard, or Complex/i,
      "must classify implementation complexity through model-router",
    );
    requireBodyContract(
      errors,
      orchestrator.relativePath,
      orchestrator.body,
      /directly to `testing-manager`/i,
      "must route testing work directly to testing-manager",
    );
    requireBodyContract(
      errors,
      orchestrator.relativePath,
      orchestrator.body,
      /directly to `release-manager`/i,
      "must route release work directly to release-manager",
    );
    requireBodyContract(
      errors,
      orchestrator.relativePath,
      orchestrator.body,
      /metadata-only GitHub coordination to `project-bot`/i,
      "must route metadata-only GitHub work directly to project-bot",
    );
  }

  for (const agentName of NON_RECURSIVE_AGENTS) {
    const agent = agents.get(agentName);
    if (agent && (!Array.isArray(agent.attributes.agents) || agent.attributes.agents.length !== 0)) {
      errors.push(`${agent.relativePath}: agents must be [] to prevent recursive delegation`);
    }
  }

  for (const agentName of HIDDEN_INTERNAL_AGENTS) {
    const agent = agents.get(agentName);
    if (agent && agent.attributes["user-invocable"] !== false) {
      errors.push(`${agent.relativePath}: user-invocable must be false`);
    }
  }

  const modelRouter = agents.get("model-router");
  if (modelRouter && (!Array.isArray(modelRouter.attributes.tools) || modelRouter.attributes.tools.length !== 0)) {
    errors.push(`${modelRouter.relativePath}: tools must be [] because the router only classifies work`);
  }

  const routingDocs = [
    { relativePath: "AGENTS.md", fallback: false },
    { relativePath: ".github/copilot-instructions.md", fallback: true },
  ];
  for (const { relativePath, fallback } of routingDocs) {
    const source = await readText(rootDir, relativePath, errors);
    if (source === null) continue;

    validateGovernanceDocument(errors, relativePath, source, { fallback });
  }

  return errors;
}

async function main() {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const errors = await validateAgentHarness({ rootDir });

  if (errors.length === 0) {
    console.log("Agent harness validation passed.");
    return;
  }

  console.error(`Agent harness validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  await main();
}