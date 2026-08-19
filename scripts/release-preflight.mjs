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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const escapedReleaseVersion = escapeRegExp(releaseVersion);

  for (const imageName of ["medassist-ng-backend", "medassist-ng-frontend"]) {
    const imageRef = extractImageLine(pinnedContent, imageName);
    const match = new RegExp(`:${escapedReleaseVersion}@(sha256:[a-f0-9]{64})$`).exec(imageRef);
    if (!match) {
      fail(`${pinnedComposePath} must pin ${imageName}:${releaseVersion}@sha256:<digest>, found ${imageRef}`);
    }
  }
}

function validateChangelog(changelogPath, releaseTag, releaseVersion) {
  const changelog = readText(changelogPath);
  const escapedReleaseVersion = escapeRegExp(releaseVersion);

  if (!changelog.includes(releaseTag)) {
    fail(`${changelogPath} must mention the current release tag ${releaseTag}.`);
  }

  if (changelog.includes("/compare/...")) {
    fail(`${changelogPath} contains a malformed compare URL with an empty previous tag.`);
  }

  const backendPullPattern = new RegExp(`docker pull ghcr\\.io\\/[^\\s]+\\/medassist-ng-backend:${escapedReleaseVersion}`);
  const frontendPullPattern = new RegExp(`docker pull ghcr\\.io\\/[^\\s]+\\/medassist-ng-frontend:${escapedReleaseVersion}`);

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

function validateDockerBuildCachePolicy(workflowPath) {
  const workflow = readText(workflowPath);
  const requiredCacheTo = "cache-to: type=gha,mode=max,scope=docker-${{ matrix.image }},ignore-error=true";
  const requiredCacheFrom = "cache-from: type=gha,scope=docker-${{ matrix.image }}";

  if (!workflow.includes(requiredCacheFrom)) {
    fail(`${workflowPath} build-and-push cache-from must use a Docker image-specific GitHub Actions cache scope.`);
  }

  if (!workflow.includes(requiredCacheTo)) {
    fail(`${workflowPath} build-and-push cache-to must ignore GitHub Actions cache export failures.`);
  }
}

function validateContainerSmokeWorkflow(workflowPath) {
  const workflow = readText(workflowPath);

  if (!/\n\s*pull_request:\s*\n\s*branches:\s*\[main\]/.test(workflow)) {
    fail(`${workflowPath} must run directly on pull_request for main so Container Smoke is visible as a PR check.`);
  }

  if (/\n\s*workflow_run:/.test(workflow)) {
    fail(`${workflowPath} must not use workflow_run; it hides Container Smoke from PR check rollups and creates duplicate post-check runs.`);
  }

  if (!workflow.includes("Wait for required PR checks")) {
    fail(`${workflowPath} must wait for Backend Tests, Frontend Build, and Playwright E2E before running smoke on PRs.`);
  }

  if (!workflow.includes("name === checkName || name.endsWith(` / ${checkName}`)")) {
    fail(`${workflowPath} must recognize exact and reusable-workflow-suffixed required check names.`);
  }

  if (!workflow.includes("const e2eLaneChecks = ['Playwright E2E core (core-a)', 'Playwright E2E core (core-b)', 'Playwright E2E data'];")) {
    fail(`${workflowPath} must require successful core-a, core-b, and data Playwright E2E lanes.`);
  }

  if (!workflow.includes('github.rest.repos.getCombinedStatusForRef')) {
    fail(`${workflowPath} must recognize the legacy Playwright E2E commit status.`);
  }

  if (!workflow.includes("legacyE2EStatus?.state === 'success'")) {
    fail(`${workflowPath} must accept a successful legacy Playwright E2E commit status.`);
  }

  for (const imageName of ["backend", "frontend"]) {
    const cacheFrom = `cache-from: type=gha,scope=container-smoke-${imageName}`;
    const cacheTo = `cache-to: type=gha,mode=max,scope=container-smoke-${imageName},ignore-error=true`;

    if (!workflow.includes(cacheFrom)) {
      fail(`${workflowPath} ${imageName} smoke build must use an image-specific GitHub Actions cache scope.`);
    }

    if (!workflow.includes(cacheTo)) {
      fail(`${workflowPath} ${imageName} smoke build must ignore GitHub Actions cache export failures.`);
    }
  }
}

function validateLegacyPlaywrightStatus(workflowPath) {
  const workflow = readText(workflowPath);

  if (!/legacy-playwright-e2e-status:[\s\S]*?needs:\s*e2e/.test(workflow)) {
    fail(`${workflowPath} must publish the legacy Playwright E2E status after the reusable E2E caller.`);
  }

  if (!/legacy-playwright-e2e-status:[\s\S]*?permissions:\s*\n\s*statuses:\s*write/.test(workflow)) {
    fail(`${workflowPath} legacy Playwright E2E status publisher must grant only statuses: write.`);
  }

  if (!/legacy-playwright-e2e-status:[\s\S]*?actions\/github-script@v9/.test(workflow)) {
    fail(`${workflowPath} must publish the legacy Playwright E2E status through actions/github-script.`);
  }

  if (!workflow.includes("sha: context.payload.pull_request.head.sha")) {
    fail(`${workflowPath} legacy Playwright E2E status publisher must target the pull request head SHA.`);
  }

  if (!workflow.includes("context: 'Playwright E2E'")) {
    fail(`${workflowPath} must preserve the legacy Playwright E2E commit-status context.`);
  }
}

function validateDependabotAutomergeWorkflow(workflowPath) {
  const workflow = readText(workflowPath);

  if (!/\n\s*schedule:\s*\n(?:\s*#.*\n)*\s*-\s*cron:\s*['"][^'"]+['"]/.test(workflow)) {
    fail(`${workflowPath} must run a scheduled stale Dependabot auto-merge sweep.`);
  }

  if (!workflow.includes("github.event_name == 'schedule'")) {
    fail(`${workflowPath} stale Dependabot rebase job must run for scheduled sweeps.`);
  }

  if (
    !/gh pr list[\s\S]*--author "app\/dependabot"[\s\S]*--json number,autoMergeRequest,mergeStateStatus[\s\S]*mergeStateStatus == "BEHIND"/.test(
      workflow
    )
  ) {
    fail(`${workflowPath} must find open Dependabot auto-merge PRs that are behind main.`);
  }

  if (!/gh pr update-branch "\$pr_number"[\s\S]*--repo "\$REPO"[\s\S]*--rebase/.test(workflow)) {
    fail(`${workflowPath} must rebase stale Dependabot PRs through GitHub's update-branch API.`);
  }

  if (workflow.includes("@dependabot rebase") || /gh pr comment[\s\S]*dependabot rebase/.test(workflow)) {
    fail(`${workflowPath} must not rely on Dependabot command comments from github-actions[bot].`);
  }
}

function validatePackageVersion(packageName, packageJsonPath, packageJson, releaseVersion) {
  if (packageJson.version !== releaseVersion) {
    fail(`${packageJsonPath} version must match ${releaseVersion}, found ${packageJson.version}.`);
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
    fail(`${packageName} package version must be semver-compatible, found ${packageJson.version}.`);
  }
}

function validateSharedDependency(packageName, packageJsonPath, packageJson) {
  if (packageJson.dependencies?.["@medassist/shared"] !== "file:../shared") {
    fail(`${packageJsonPath} must consume @medassist/shared through file:../shared.`);
  }

  if (packageJson.devDependencies?.["@medassist/shared"] || packageJson.peerDependencies?.["@medassist/shared"]) {
    fail(`${packageName} must declare @medassist/shared only as a runtime local dependency.`);
  }
}

function validatePackageLockVersion(lockfilePath, lockfile, packagePath, releaseVersion) {
  const packageEntry = packagePath === "" ? lockfile.packages?.[""] : lockfile.packages?.[packagePath];
  const versions = new Set([lockfile.version, packageEntry?.version].filter(Boolean));

  if (!packageEntry) {
    fail(`${lockfilePath} is missing package lock entry "${packagePath || "<root>"}".`);
  }

  for (const version of versions) {
    if (version !== releaseVersion) {
      fail(`${lockfilePath} package entry "${packagePath || "<root>"}" must use ${releaseVersion}, found ${version}.`);
    }
  }
}

function validateSharedLockEntry(lockfilePath, lockfile, releaseVersion) {
  const sharedEntry = lockfile.packages?.["../shared"];
  if (!sharedEntry) {
    fail(`${lockfilePath} is missing the local ../shared package lock entry.`);
  }

  if (sharedEntry.version !== releaseVersion) {
    fail(`${lockfilePath} ../shared version must match ${releaseVersion}, found ${sharedEntry.version}.`);
  }

  const linkedEntry = lockfile.packages?.["node_modules/@medassist/shared"];
  if (!linkedEntry || linkedEntry.resolved !== "../shared" || linkedEntry.link !== true) {
    fail(`${lockfilePath} must lock @medassist/shared as a local link to ../shared.`);
  }
}

function requireDockerPattern(dockerfilePath, dockerfile, pattern, description) {
  if (!pattern.test(dockerfile)) {
    fail(`${dockerfilePath} must ${description}.`);
  }
}

function requireScriptPattern(packageJsonPath, packageJson, scriptName, pattern, description) {
  const script = packageJson.scripts?.[scriptName];
  if (typeof script !== "string" || !pattern.test(script)) {
    fail(`${packageJsonPath} ${scriptName} must ${description}.`);
  }
}

function requireTextPattern(filePath, pattern, description) {
  const content = readText(filePath);
  if (!pattern.test(content)) {
    fail(`${filePath} must ${description}.`);
  }
}

function validateDockerSharedBuild(dockerfilePath, { requiresRuntimeCopy }) {
  const dockerfile = readText(dockerfilePath);

  requireDockerPattern(
    dockerfilePath,
    dockerfile,
    /COPY shared\/package\.json shared\/package-lock\.json\* \.\/shared\//,
    "copy the shared package manifest and lockfile before installing dependencies"
  );
  requireDockerPattern(
    dockerfilePath,
    dockerfile,
    /COPY shared\/src \.\/shared\/src/,
    "copy the shared package source into the image build context"
  );
  requireDockerPattern(dockerfilePath, dockerfile, /RUN cd shared && npm run build/, "build the shared package from source");

  if (requiresRuntimeCopy) {
    requireDockerPattern(
      dockerfilePath,
      dockerfile,
      /COPY --from=builder \/app\/shared\/package\.json \/shared\/package\.json/,
      "copy the built shared package manifest into the runtime image"
    );
    requireDockerPattern(
      dockerfilePath,
      dockerfile,
      /COPY --from=builder \/app\/shared\/dist \/shared\/dist/,
      "copy the built shared package output into the runtime image"
    );
  }
}

function validateDomainSafetyGate(rootPackage, backendPackage, frontendPackage) {
  requireScriptPattern(
    "package.json",
    rootPackage,
    "test:domain",
    /backend[\s\S]*npm run test:domain[\s\S]*frontend[\s\S]*npm run test:e2e:domain/,
    "run the backend and frontend domain safety gates"
  );
  requireScriptPattern(
    "backend/package.json",
    backendPackage,
    "test:domain",
    /src\/test\/domain-safety\.test\.ts/,
    "run backend/src/test/domain-safety.test.ts"
  );
  requireScriptPattern(
    "backend/package.json",
    backendPackage,
    "test:coverage",
    /^vitest run --coverage$/,
    "keep full developer coverage without excluding the domain safety release gate"
  );
  requireScriptPattern(
    "backend/package.json",
    backendPackage,
    "test:coverage:ci",
    /vitest run --coverage[\s\S]*--exclude[\s\S]*src\/test\/domain-safety\.test\.ts/,
    "exclude the already-run domain safety release gate from CI coverage"
  );
  requireTextPattern(".github/workflows/test.yml", /run:\s*npm run test:domain/, "run the domain safety release gate");
  requireTextPattern(
    ".github/workflows/test.yml",
    /run:\s*npm run test:domain[\s\S]*run:\s*npm run test:coverage:ci/,
    "run CI coverage after the domain safety release gate without re-executing it"
  );
  requireTextPattern(
    ".github/workflows/test.yml",
    /run:\s*npm run check[\s\S]*run:\s*npm run build/,
    "run the frontend static check before the frontend build"
  );
  requireTextPattern(
    ".github/workflows/e2e.yml",
    /matrix:\s*\n\s*include:\s*\n\s*-\s*id:\s*core-a\s*\n\s*script:\s*test:e2e:ci:core:a\s*\n\s*-\s*id:\s*core-b\s*\n\s*script:\s*test:e2e:ci:core:b[\s\S]*run:\s*npm run \$\{\{ matrix\.script \}\}/,
    "run the approved core-a and core-b Chromium E2E matrix"
  );
  requireScriptPattern(
    "frontend/package.json",
    frontendPackage,
    "test:e2e:ci:core:a",
    /PLAYWRIGHT_HTML_OPEN=never[\s\S]*PLAYWRIGHT_WORKERS=1[\s\S]*--project=chromium/,
    "run the core-a Chromium shard non-interactively"
  );
  requireScriptPattern(
    "frontend/package.json",
    frontendPackage,
    "test:e2e:ci:core:b",
    /PLAYWRIGHT_HTML_OPEN=never[\s\S]*PLAYWRIGHT_WORKERS=1[\s\S]*--project=chromium[\s\S]*e2e\/domain-safety\.spec\.ts/,
    "run the core-b Chromium shard non-interactively with frontend/e2e/domain-safety.spec.ts"
  );
  requireScriptPattern(
    "frontend/package.json",
    frontendPackage,
    "test:e2e:ci:data",
    /PLAYWRIGHT_HTML_OPEN=never[\s\S]*PLAYWRIGHT_WORKERS=1[\s\S]*--project=chromium-data/,
    "run the data-focused Chromium project non-interactively"
  );
}

function validatePolicy(releaseTag, releaseVersion) {
  const rootPackage = readJson("package.json");
  const policy = readJson("release-policy.json");
  const backendPackage = readJson("backend/package.json");
  const frontendPackage = readJson("frontend/package.json");
  const sharedPackage = readJson("shared/package.json");
  const backendLockfile = readJson("backend/package-lock.json");
  const frontendLockfile = readJson("frontend/package-lock.json");
  const sharedLockfile = readJson("shared/package-lock.json");

  if (policy.versionPolicy !== "strict") {
    fail(`Unsupported release policy "${policy.versionPolicy}". Expected "strict".`);
  }

  for (const packageName of ["backend", "frontend", "shared"]) {
    if (policy.packages?.[packageName] !== "tag") {
      fail(`release-policy.json must require ${packageName} to match the release tag.`);
    }
  }

  if (policy.shared?.mustMatchReleaseTag !== true) {
    fail("release-policy.json must require shared.mustMatchReleaseTag=true for the strict policy.");
  }

  if (typeof policy.shared?.rationale !== "string" || policy.shared.rationale.trim().length === 0) {
    fail("release-policy.json must document why shared must match the release tag.");
  }

  validatePackageVersion("backend", "backend/package.json", backendPackage, releaseVersion);
  validatePackageVersion("frontend", "frontend/package.json", frontendPackage, releaseVersion);
  validatePackageVersion("shared", "shared/package.json", sharedPackage, releaseVersion);

  validateSharedDependency("backend", "backend/package.json", backendPackage);
  validateSharedDependency("frontend", "frontend/package.json", frontendPackage);

  validatePackageLockVersion("backend/package-lock.json", backendLockfile, "", releaseVersion);
  validatePackageLockVersion("frontend/package-lock.json", frontendLockfile, "", releaseVersion);
  validatePackageLockVersion("shared/package-lock.json", sharedLockfile, "", releaseVersion);

  validateSharedLockEntry("backend/package-lock.json", backendLockfile, releaseVersion);
  validateSharedLockEntry("frontend/package-lock.json", frontendLockfile, releaseVersion);

  validateDockerSharedBuild("backend/Dockerfile", { requiresRuntimeCopy: true });
  validateDockerSharedBuild("frontend/Dockerfile", { requiresRuntimeCopy: false });
  validateDomainSafetyGate(rootPackage, backendPackage, frontendPackage);
  validateLegacyPlaywrightStatus(".github/workflows/test.yml");
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
  validateDockerBuildCachePolicy(workflowPath);

  const containerSmokeWorkflowPath = String(args["container-smoke-workflow"] || ".github/workflows/container-smoke.yml");
  validateContainerSmokeWorkflow(containerSmokeWorkflowPath);

  const dependabotAutomergeWorkflowPath = String(
    args["dependabot-automerge-workflow"] || ".github/workflows/dependabot-automerge.yml"
  );
  validateDependabotAutomergeWorkflow(dependabotAutomergeWorkflowPath);

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
