#!/bin/bash
# =============================================================================
# MedAssist Release Script (non-interactive)
# =============================================================================
# Usage:
#   ./scripts/release.sh patch    # 1.0.0 -> 1.0.1 (bugfixes)
#   ./scripts/release.sh minor    # 1.0.0 -> 1.1.0 (new features)
#   ./scripts/release.sh major    # 1.0.0 -> 2.0.0 (breaking changes)
#   ./scripts/release.sh 1.2.3    # explicit version
#
# Fully non-interactive: no y/N prompts. Designed to be called by AI agents
# or CI systems. Creates a PR for the version bump (required due to branch
# protection), waits for CI with retry logic, merges, and creates a signed tag.
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="DanielVolz/medassist-ng"
CI_POLL_INTERVAL=15          # seconds between CI status polls
CI_INITIAL_DELAY=20          # seconds to wait before first CI check
CI_MAX_WAIT=600              # maximum seconds to wait for CI (10 minutes)

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Detect git remote name for the configured GitHub repository.
# This avoids accidentally pulling from a non-GitHub origin in multi-remote setups.
detect_remote() {
    local target_repo_lower
    target_repo_lower=$(echo "${GITHUB_REPO}" | tr '[:upper:]' '[:lower:]')

    local remote
    while read -r remote; do
        local url
        url=$(git remote get-url "$remote" 2>/dev/null || true)
        local url_lower
        url_lower=$(echo "$url" | tr '[:upper:]' '[:lower:]')

        if [[ "$url_lower" == *"github.com"* && "$url_lower" == *"${target_repo_lower}.git"* ]]; then
            echo "$remote"
            return 0
        fi
        if [[ "$url_lower" == *"github.com"* && "$url_lower" == *"${target_repo_lower}" ]]; then
            echo "$remote"
            return 0
        fi
    done < <(git remote)

    if git remote | grep -q '^github$'; then
        echo "github"
        return 0
    fi

    echo -e "${RED}Error: No git remote points to github.com/${GITHUB_REPO}.${NC}" >&2
    exit 1
}

GIT_REMOTE=$(detect_remote)

# Wait for CI checks on a PR with retry logic
# GitHub Actions can take 10-30 seconds before checks are reported.
# This function polls until checks appear and then watches them.
wait_for_ci() {
    local pr_number="$1"
    local elapsed=0

    echo -e "${BLUE}Waiting ${CI_INITIAL_DELAY}s for CI checks to be registered...${NC}"
    sleep "${CI_INITIAL_DELAY}"
    elapsed=$CI_INITIAL_DELAY

    while [[ $elapsed -lt $CI_MAX_WAIT ]]; do
        # Check if any checks have been reported
        local check_output
        check_output=$(gh pr checks "${pr_number}" --repo "${GITHUB_REPO}" 2>&1) || true

        if echo "$check_output" | grep -q "no checks reported"; then
            echo -e "${YELLOW}No checks reported yet (${elapsed}s elapsed). Retrying in ${CI_POLL_INTERVAL}s...${NC}"
            sleep "${CI_POLL_INTERVAL}"
            elapsed=$((elapsed + CI_POLL_INTERVAL))
            continue
        fi

        # Checks are registered — use --watch to wait for completion
        echo -e "${BLUE}CI checks registered. Watching for completion...${NC}"
        if gh pr checks "${pr_number}" --repo "${GITHUB_REPO}" --watch; then
            echo -e "${GREEN}CI checks passed!${NC}"
            return 0
        else
            echo -e "${RED}CI checks failed!${NC}"
            return 1
        fi
    done

    echo -e "${RED}Timed out waiting for CI checks after ${CI_MAX_WAIT}s.${NC}"
    return 1
}

# ─── Preflight checks ────────────────────────────────────────────────────────

if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is required but not installed.${NC}"
    echo "Install it with: brew install gh"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI.${NC}"
    echo "Run: gh auth login"
    exit 1
fi

if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Error: You have uncommitted changes. Commit or stash them first.${NC}"
    git status --short
    exit 1
fi

# ─── Determine version ───────────────────────────────────────────────────────

echo -e "${BLUE}Updating main branch...${NC}"
git checkout main
git pull "${GIT_REMOTE}" main

CURRENT_VERSION=$(grep '"version"' backend/package.json | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${BLUE}Current version: ${YELLOW}v${CURRENT_VERSION}${NC}"

if [[ -z "$1" ]]; then
    echo -e "${RED}Usage: $0 <patch|minor|major|x.y.z>${NC}"
    exit 1
fi

case "$1" in
    patch)
        IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
        NEW_VERSION="$major.$minor.$((patch + 1))"
        ;;
    minor)
        IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
        NEW_VERSION="$major.$((minor + 1)).0"
        ;;
    major)
        IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
        NEW_VERSION="$((major + 1)).0.0"
        ;;
    *)
        if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo -e "${RED}Invalid version format. Use: x.y.z${NC}"
            exit 1
        fi
        NEW_VERSION="$1"
        ;;
esac

echo -e "${GREEN}Releasing: ${YELLOW}v${CURRENT_VERSION} → v${NEW_VERSION}${NC}"

# ─── Create release branch and PR ────────────────────────────────────────────

RELEASE_BRANCH="chore/release-${NEW_VERSION}"

if git show-ref --verify --quiet "refs/heads/${RELEASE_BRANCH}"; then
    echo -e "${YELLOW}Branch ${RELEASE_BRANCH} already exists locally. Deleting...${NC}"
    git branch -D "${RELEASE_BRANCH}"
fi

echo -e "${BLUE}Creating release branch...${NC}"
git checkout -b "${RELEASE_BRANCH}"

echo -e "${BLUE}Updating package.json files...${NC}"
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" backend/package.json
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" frontend/package.json 2>/dev/null || true

echo -e "${BLUE}Committing version bump...${NC}"
git add backend/package.json frontend/package.json 2>/dev/null || git add backend/package.json
git commit -m "chore: release v${NEW_VERSION}"

echo -e "${BLUE}Pushing release branch...${NC}"
git push -u "${GIT_REMOTE}" "${RELEASE_BRANCH}"

echo -e "${BLUE}Creating Pull Request...${NC}"
PR_URL=$(gh pr create \
    --repo "${GITHUB_REPO}" \
    --head "${RELEASE_BRANCH}" \
    --title "chore: release v${NEW_VERSION}" \
    --body "## Release v${NEW_VERSION}

Automated version bump for release v${NEW_VERSION}.

This PR was created by the release script.")

echo -e "${GREEN}PR created: ${YELLOW}${PR_URL}${NC}"
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')

MERGED_SHA=""

# ─── Wait for CI and merge ────────────────────────────────────────────────────

if ! wait_for_ci "${PR_NUMBER}"; then
    echo -e "${RED}CI checks failed! Please fix the issues and try again.${NC}"
    echo -e "${RED}Release branch '${RELEASE_BRANCH}' and PR #${PR_NUMBER} are still open.${NC}"
    exit 1
fi

echo -e "${BLUE}Merging PR #${PR_NUMBER}...${NC}"
gh pr merge "${PR_NUMBER}" --repo "${GITHUB_REPO}" --squash --delete-branch

MERGED_SHA=$(gh pr view "${PR_NUMBER}" --repo "${GITHUB_REPO}" --json mergeCommit --jq '.mergeCommit.oid')
if [[ -z "${MERGED_SHA}" || "${MERGED_SHA}" == "null" ]]; then
    echo -e "${RED}Error: Could not resolve merge commit SHA for PR #${PR_NUMBER}.${NC}"
    exit 1
fi
echo -e "${BLUE}Resolved merge commit: ${YELLOW}${MERGED_SHA}${NC}"

echo -e "${BLUE}Updating main branch...${NC}"
git checkout main
git fetch "${GIT_REMOTE}" main
git pull --ff-only "${GIT_REMOTE}" main

if ! git cat-file -e "${MERGED_SHA}^{commit}" 2>/dev/null; then
    echo -e "${BLUE}Fetching merge commit from ${GIT_REMOTE}...${NC}"
    git fetch "${GIT_REMOTE}" "${MERGED_SHA}"
fi

HEAD_SHA=$(git rev-parse HEAD)
if [[ "${HEAD_SHA}" != "${MERGED_SHA}" ]]; then
    echo -e "${YELLOW}Local main is at ${HEAD_SHA}, expected merge commit ${MERGED_SHA}.${NC}"
    echo -e "${YELLOW}Tag will be created on the merge commit SHA to avoid stale tags.${NC}"
fi

MERGED_VERSION=$(git show "${MERGED_SHA}:backend/package.json" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p')
if [[ "${MERGED_VERSION}" != "${NEW_VERSION}" ]]; then
    echo -e "${RED}Error: merge commit backend/package.json version is '${MERGED_VERSION}', expected '${NEW_VERSION}'.${NC}"
    echo -e "${RED}Aborting to prevent creating a tag on the wrong release commit.${NC}"
    exit 1
fi

# ─── Create and push signed tag ──────────────────────────────────────────────

if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists locally. Deleting...${NC}"
    git tag -d "v${NEW_VERSION}"
fi

if git ls-remote --tags "${GIT_REMOTE}" "v${NEW_VERSION}" 2>/dev/null | grep -q "v${NEW_VERSION}"; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} exists on remote. Deleting...${NC}"
    git push "${GIT_REMOTE}" ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
fi

echo -e "${BLUE}Creating signed tag v${NEW_VERSION}...${NC}"
git tag -s "v${NEW_VERSION}" "${MERGED_SHA}" -m "Release v${NEW_VERSION}"

echo -e "${BLUE}Pushing tag...${NC}"
git push "${GIT_REMOTE}" "v${NEW_VERSION}"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Released v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}GitHub Actions will now build and publish Docker images.${NC}"
echo -e "Track progress: ${YELLOW}https://github.com/${GITHUB_REPO}/actions${NC}"
echo -e "Release page:   ${YELLOW}https://github.com/${GITHUB_REPO}/releases/tag/v${NEW_VERSION}${NC}"
