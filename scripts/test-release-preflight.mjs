#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const preflightScript = path.join(repoRoot, "scripts/release-preflight.mjs");
const releaseTag = "v1.27.4";

function copyFixture() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "medassist-release-preflight-"));
  const pathsToCopy = [
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
    ".github/workflows/docker-build.yml"
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

    expectPreflightFailure(fixtureRoot, /shared\/package\.json version must match 1\.27\.4/);
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

    expectPreflightFailure(fixtureRoot, /backend\/package-lock\.json \.\.\/shared version must match 1\.27\.4/);
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
