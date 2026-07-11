#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const preflightScript = path.join(repoRoot, "scripts/release-preflight.mjs");
const releaseVersion = JSON.parse(readFileSync(path.join(repoRoot, "backend/package.json"), "utf8")).version;
const releaseTag = `v${releaseVersion}`;
const escapedReleaseVersion = releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function copyFixture() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "medassist-release-preflight-"));
  const pathsToCopy = [
    "package.json",
    "release-policy.json",
    "docker-compose.yml",
    "backend/package.json",
    "backend/package-lock.json",
    "backend/Dockerfile",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/Dockerfile",
    "shared/package.json",
    "shared/package-lock.json",
    ".github/workflows/docker-build.yml",
    ".github/workflows/container-smoke.yml",
    ".github/workflows/dependabot-automerge.yml",
    ".github/workflows/test.yml",
    ".github/workflows/e2e.yml"
  ];

  for (const relativePath of pathsToCopy) {
    const destination = path.join(fixtureRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repoRoot, relativePath), destination, { recursive: true });
  }

  return fixtureRoot;
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function writeJson(root, relativePath, value) {
  writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function runPreflight(root) {
  return execFileSync("node", [preflightScript, "--tag", releaseTag, "--static-only"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function expectPreflightFailure(root, expectedMessage) {
  assert.throws(
    () => runPreflight(root),
    (error) => {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      assert.match(output, expectedMessage);
      return true;
    }
  );
}

test("release preflight accepts the strict package version policy", () => {
  const fixtureRoot = copyFixture();
  try {
    assert.match(runPreflight(fixtureRoot), /static checks passed/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects shared package version drift", () => {
  const fixtureRoot = copyFixture();
  try {
    const sharedPackage = readJson(fixtureRoot, "shared/package.json");
    sharedPackage.version = "1.27.2";
    writeJson(fixtureRoot, "shared/package.json", sharedPackage);

    expectPreflightFailure(fixtureRoot, new RegExp(`shared/package\\.json version must match ${escapedReleaseVersion}`));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects local shared lockfile drift", () => {
  const fixtureRoot = copyFixture();
  try {
    const backendLockfile = readJson(fixtureRoot, "backend/package-lock.json");
    backendLockfile.packages["../shared"].version = "1.27.2";
    writeJson(fixtureRoot, "backend/package-lock.json", backendLockfile);

    expectPreflightFailure(
      fixtureRoot,
      new RegExp(`backend/package-lock\\.json \\.\\./shared version must match ${escapedReleaseVersion}`)
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects Dockerfiles that do not build shared from source", () => {
  const fixtureRoot = copyFixture();
  try {
    const frontendDockerfilePath = path.join(fixtureRoot, "frontend/Dockerfile");
    const frontendDockerfile = readFileSync(frontendDockerfilePath, "utf8").replace(
      "RUN cd shared && npm run build",
      "RUN node --version"
    );
    writeFileSync(frontendDockerfilePath, frontendDockerfile);

    expectPreflightFailure(fixtureRoot, /frontend\/Dockerfile must build the shared package from source/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects missing backend domain safety gate script", () => {
  const fixtureRoot = copyFixture();
  try {
    const backendPackage = readJson(fixtureRoot, "backend/package.json");
    backendPackage.scripts["test:domain"] = "vitest run src/test/server.test.ts";
    writeJson(fixtureRoot, "backend/package.json", backendPackage);

    expectPreflightFailure(
      fixtureRoot,
      /backend\/package\.json test:domain must run backend\/src\/test\/domain-safety\.test\.ts/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects missing frontend domain E2E gate script", () => {
  const fixtureRoot = copyFixture();
  try {
    const frontendPackage = readJson(fixtureRoot, "frontend/package.json");
    frontendPackage.scripts["test:e2e:domain"] = "playwright test --config=playwright.stable.config.ts e2e/planner.spec.ts";
    writeJson(fixtureRoot, "frontend/package.json", frontendPackage);

    expectPreflightFailure(
      fixtureRoot,
      /frontend\/package\.json test:e2e:domain must run frontend\/e2e\/domain-safety\.spec\.ts/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects CI workflow without the domain safety release gate", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/test.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace("run: npm run test:domain", "run: npm run test:run");
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(fixtureRoot, /\.github\/workflows\/test\.yml must run the domain safety release gate/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects CI workflow without the domain E2E release gate", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/e2e.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      "run: npm run test:e2e:domain",
      "run: npx playwright test --project=chromium"
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(fixtureRoot, /\.github\/workflows\/e2e\.yml must run the domain E2E release gate/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects frontend CI without the static check before build", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/test.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace("run: npm run check", "run: npm run lint");
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/test\.yml must run the frontend static check before the frontend build/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects E2E CI without the data-focused Chromium project", () => {
  const fixtureRoot = copyFixture();
  try {
    const frontendPackage = readJson(fixtureRoot, "frontend/package.json");
    frontendPackage.scripts["test:e2e:ci:data"] =
      "rm -rf test-results && PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_WORKERS=1 playwright test --config=playwright.stable.config.ts --project=chromium";
    writeJson(fixtureRoot, "frontend/package.json", frontendPackage);

    expectPreflightFailure(
      fixtureRoot,
      /frontend\/package\.json test:e2e:ci:data must run the data-focused Chromium project non-interactively/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects hidden workflow-run container smoke", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/container-smoke.yml");
    const workflow = readFileSync(workflowPath, "utf8")
      .replace("pull_request:", "workflow_run:\n    workflows: ['Test', 'E2E Tests']\n    types: [completed]")
      .replace("    branches: [main]\n", "");
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(fixtureRoot, /\.github\/workflows\/container-smoke\.yml must run directly on pull_request/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects fatal container smoke cache export", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/container-smoke.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      "cache-to: type=gha,mode=max,scope=container-smoke-backend,ignore-error=true",
      "cache-to: type=gha,mode=max"
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/container-smoke\.yml backend smoke build must ignore GitHub Actions cache export failures/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects fatal Docker publish cache export", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/docker-build.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      "cache-to: type=gha,mode=max,scope=docker-${{ matrix.image }},ignore-error=true",
      "cache-to: type=gha,mode=max"
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/docker-build\.yml build-and-push cache-to must ignore GitHub Actions cache export failures/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects Dependabot automerge without a scheduled stale PR sweep", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/dependabot-automerge.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      /\s{2}schedule:\n(?:\s{4}#.*\n)*\s{4}- cron: '[^']+'\n/,
      ""
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/dependabot-automerge\.yml must run a scheduled stale Dependabot auto-merge sweep/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects Dependabot automerge when the scheduled sweep does not run the rebase job", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/dependabot-automerge.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      "github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
      "github.event_name == 'push' || github.event_name == 'workflow_dispatch'"
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/dependabot-automerge\.yml stale Dependabot rebase job must run for scheduled sweeps/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects Dependabot automerge without direct update-branch rebase", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/dependabot-automerge.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      'gh pr update-branch "$pr_number" --repo "$REPO" --rebase',
      'gh pr view "$pr_number" --repo "$REPO"'
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/dependabot-automerge\.yml must rebase stale Dependabot PRs through GitHub's update-branch API/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight rejects Dependabot automerge command comments from github-actions", () => {
  const fixtureRoot = copyFixture();
  try {
    const workflowPath = path.join(fixtureRoot, ".github/workflows/dependabot-automerge.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace(
      'gh pr update-branch "$pr_number" --repo "$REPO" --rebase',
      'gh pr update-branch "$pr_number" --repo "$REPO" --rebase\n              gh pr comment "$pr_number" --repo "$REPO" --body "@dependabot rebase"'
    );
    writeFileSync(workflowPath, workflow);

    expectPreflightFailure(
      fixtureRoot,
      /\.github\/workflows\/dependabot-automerge\.yml must not rely on Dependabot command comments from github-actions\[bot\]/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
