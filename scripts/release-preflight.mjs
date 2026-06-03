#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function fail(message) {
  throw new Error(message);
}

function resolveInputPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function readJson(relativePath) {
  const absolutePath = resolveInputPath(relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function readText(relativePath) {
  const absolutePath = resolveInputPath(relativePath);
  return readFileSync(absolutePath, "utf8");
}

function parseReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match) {
    fail(`Release tag must match v<semver>. Received: ${tag}`);
  }

  return { tag, version: match[1] };
}

function parseNumericSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    fail(`Expected a semver-compatible version, received: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function isVersionAhead(candidate, baseline) {
  const candidateParts = parseNumericSemver(candidate);
  const baselineParts = parseNumericSemver(baseline);

  if (candidateParts.major !== baselineParts.major) {
    return candidateParts.major > baselineParts.major;
  }
  if (candidateParts.minor !== baselineParts.minor) {
    return candidateParts.minor > baselineParts.minor;
  }

  return candidateParts.patch > baselineParts.patch;
}

function extractImageLine(content, imageName) {
  const pattern = new RegExp(`^\\s*image:\\s*(ghcr\\.io\\/[^\\s]+\\/${imageName}:[^\\s]+)\\s*$`, "m");
  const match = content.match(pattern);
  if (!match) {
    fail(`Could not find image line for ${imageName}.`);
  }
  return match[1];
}

function validateTaggedCompose(composePath, releaseVersion) {
  const composeContent = readText(composePath);

  for (const imageName of ["medassist-ng-backend", "medassist-ng-frontend"]) {
    const imageRef = extractImageLine(composeContent, imageName);
    if (imageRef.includes("@")) {
      fail(`${composePath} should use version tags only for ${imageName}, but found digest-pinned ref: ${imageRef}`);
    }

    const tag = imageRef.split(":").pop();
    if (tag !== releaseVersion) {
      fail(`${composePath} must reference ${imageName}:${releaseVersion}, found ${imageRef}`);
    }
  }
}

function validatePinnedCompose(pinnedComposePath, releaseVersion) {
  const pinnedContent = readText(pinnedComposePath);

  for (const imageName of ["medassist-ng-backend", "medassist-ng-frontend"]) {
    const imageRef = extractImageLine(pinnedContent, imageName);
    const match = new RegExp(`:${releaseVersion}@(sha256:[a-f0-9]{64})$`).exec(imageRef);
    if (!match) {
      fail(`${pinnedComposePath} must pin ${imageName}:${releaseVersion}@sha256:<digest>, found ${imageRef}`);
    }
  }
}

function validateChangelog(changelogPath, releaseTag, releaseVersion) {
  const changelog = readText(changelogPath);

  if (!changelog.includes(releaseTag)) {
    fail(`${changelogPath} must mention the current release tag ${releaseTag}.`);
  }

  if (changelog.includes("/compare/...")) {
    fail(`${changelogPath} contains a malformed compare URL with an empty previous tag.`);
  }

  const backendPullPattern = new RegExp(`docker pull ghcr\\.io\\/[^\\s]+\\/medassist-ng-backend:${releaseVersion}`);
  const frontendPullPattern = new RegExp(`docker pull ghcr\\.io\\/[^\\s]+\\/medassist-ng-frontend:${releaseVersion}`);

  if (!backendPullPattern.test(changelog)) {
    fail(`${changelogPath} is missing the backend docker pull command for ${releaseVersion}.`);
  }

  if (!frontendPullPattern.test(changelog)) {
    fail(`${changelogPath} is missing the frontend docker pull command for ${releaseVersion}.`);
  }
}

function validateWorkflowNeeds(workflowPath) {
  const workflow = readText(workflowPath);
  const match = workflow.match(/create-release:\s*[\s\S]*?needs:\s*\[([^\]]+)\]/);
  if (!match) {
    fail(`${workflowPath} must keep an explicit inline needs list for create-release so release-preflight can verify required gates.`);
  }

  const needs = match[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const requiredNeed of ["build-and-push", "container-smoke"]) {
    if (!needs.includes(requiredNeed)) {
      fail(`${workflowPath} create-release.needs must include ${requiredNeed}. Found [${needs.join(", ")}].`);
    }
  }
}

function validatePolicy(releaseTag, releaseVersion) {
  const policy = readJson("release-policy.json");
  const backendPackage = readJson("backend/package.json");
  const frontendPackage = readJson("frontend/package.json");
  const sharedPackage = readJson("shared/package.json");

  if (policy.versionPolicy !== "pragmatic") {
    fail(`Unsupported release policy "${policy.versionPolicy}". Expected "pragmatic".`);
  }

  if (policy.packages?.backend !== "tag" || policy.packages?.frontend !== "tag") {
    fail("release-policy.json must require backend/frontend to match the release tag.");
  }

  if (backendPackage.version !== releaseVersion) {
    fail(`backend/package.json version must match ${releaseVersion}, found ${backendPackage.version}.`);
  }

  if (frontendPackage.version !== releaseVersion) {
    fail(`frontend/package.json version must match ${releaseVersion}, found ${frontendPackage.version}.`);
  }

  if (policy.packages?.shared !== "independent") {
    fail("release-policy.json must explicitly mark shared as independently versioned for the pragmatic policy.");
  }

  if (policy.shared?.allowIndependentVersion !== true) {
    fail("release-policy.json must explicitly allow the shared package to version independently.");
  }

  if (policy.shared?.lastReviewedTag !== releaseTag) {
    fail(
      `release-policy.json shared.lastReviewedTag must be reviewed for ${releaseTag}; found ${policy.shared?.lastReviewedTag ?? "<missing>"}.`
    );
  }

  if (typeof policy.shared?.rationale !== "string" || policy.shared.rationale.trim().length === 0) {
    fail("release-policy.json must document why shared is allowed to differ from the release tag.");
  }

  parseNumericSemver(sharedPackage.version);
  if (isVersionAhead(sharedPackage.version, releaseVersion)) {
    fail(`shared/package.json version ${sharedPackage.version} must not be ahead of release version ${releaseVersion}.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tag) {
    fail("Usage: npm run release:preflight -- --tag vX.Y.Z [--static-only] [--changelog <file>] [--compose <file>] [--pinned-compose <file>] [--workflow <file>]");
  }

  const { tag, version } = parseReleaseTag(String(args.tag));
  validatePolicy(tag, version);

  const composePath = String(args.compose || "docker-compose.yml");
  validateTaggedCompose(composePath, version);

  const workflowPath = String(args.workflow || ".github/workflows/docker-build.yml");
  validateWorkflowNeeds(workflowPath);

  if (args["static-only"]) {
    console.log(`release-preflight: static checks passed for ${tag}`);
    return;
  }

  const pinnedComposePath = String(args["pinned-compose"] || "docker-compose.pinned.yml");
  if (!existsSync(resolveInputPath(pinnedComposePath))) {
    fail(`Pinned compose file not found: ${pinnedComposePath}`);
  }
  validatePinnedCompose(pinnedComposePath, version);

  const changelogPath = String(args.changelog || "changelog.md");
  if (!existsSync(resolveInputPath(changelogPath))) {
    fail(`Changelog file not found: ${changelogPath}`);
  }
  validateChangelog(changelogPath, tag, version);

  console.log(`release-preflight: full checks passed for ${tag}`);
}

main();
