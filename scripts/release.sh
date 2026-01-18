#!/bin/bash
# =============================================================================
# MedAssist Release Script
# =============================================================================
# Usage:
#   ./scripts/release.sh patch    # 1.0.0 -> 1.0.1 (bugfixes)
#   ./scripts/release.sh minor    # 1.0.0 -> 1.1.0 (new features)
#   ./scripts/release.sh major    # 1.0.0 -> 2.0.0 (breaking changes)
#   ./scripts/release.sh 1.2.3    # explicit version
#
# This script creates a PR for the version bump (required due to branch protection),
# waits for CI, merges it, and then creates a signed tag for the release.
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# GitHub repo
GITHUB_REPO="DanielVolz/medassist-ng"

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is required but not installed.${NC}"
    echo "Install it with: brew install gh"
    exit 1
fi

# Check gh authentication
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI.${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Error: You have uncommitted changes. Commit or stash them first.${NC}"
    git status --short
    exit 1
fi

# Make sure we're on main and up to date
echo -e "${BLUE}Updating main branch...${NC}"
git checkout main
git pull origin main 2>/dev/null || git pull github main 2>/dev/null || true

# Get current version from backend/package.json
CURRENT_VERSION=$(grep '"version"' backend/package.json | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${BLUE}Current version: ${YELLOW}v${CURRENT_VERSION}${NC}"

# Calculate new version
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
        # Assume explicit version (validate format)
        if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo -e "${RED}Invalid version format. Use: x.y.z${NC}"
            exit 1
        fi
        NEW_VERSION="$1"
        ;;
esac

echo -e "${GREEN}New version: ${YELLOW}v${NEW_VERSION}${NC}"
echo ""

# Confirm
read -p "Release v${NEW_VERSION}? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Branch name for the release
RELEASE_BRANCH="chore/release-${NEW_VERSION}"

# Check if branch already exists
if git show-ref --verify --quiet "refs/heads/${RELEASE_BRANCH}"; then
    echo -e "${YELLOW}Branch ${RELEASE_BRANCH} already exists locally. Deleting...${NC}"
    git branch -D "${RELEASE_BRANCH}"
fi

# Create release branch
echo -e "${BLUE}Creating release branch...${NC}"
git checkout -b "${RELEASE_BRANCH}"

# Update version in package.json files
echo -e "${BLUE}Updating package.json files...${NC}"
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" backend/package.json
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" frontend/package.json 2>/dev/null || true

# Commit version bump
echo -e "${BLUE}Committing version bump...${NC}"
git add backend/package.json frontend/package.json 2>/dev/null || git add backend/package.json
git commit -m "chore: release v${NEW_VERSION}"

# Push branch to GitHub
echo -e "${BLUE}Pushing release branch to GitHub...${NC}"
git push -u origin "${RELEASE_BRANCH}" 2>/dev/null || git push -u github "${RELEASE_BRANCH}"

# Create PR
echo -e "${BLUE}Creating Pull Request...${NC}"
PR_URL=$(gh pr create \
    --repo "${GITHUB_REPO}" \
    --head "${RELEASE_BRANCH}" \
    --title "chore: release v${NEW_VERSION}" \
    --body "## Release v${NEW_VERSION}

Automated version bump for release v${NEW_VERSION}.

This PR was created by the release script." \
    2>&1)

echo -e "${GREEN}PR created: ${YELLOW}${PR_URL}${NC}"

# Extract PR number
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')

# Wait for CI checks
echo -e "${BLUE}Waiting for CI checks to complete...${NC}"
if ! gh pr checks "${PR_NUMBER}" --repo "${GITHUB_REPO}" --watch; then
    echo -e "${RED}CI checks failed! Please fix the issues and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}CI checks passed!${NC}"

# Merge PR
echo -e "${BLUE}Merging PR...${NC}"
gh pr merge "${PR_NUMBER}" --repo "${GITHUB_REPO}" --squash --delete-branch

# Switch back to main and pull
echo -e "${BLUE}Updating main branch with merged changes...${NC}"
git checkout main
git pull origin main 2>/dev/null || git pull github main 2>/dev/null || true

# Check if tag exists and delete it
if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists locally. Deleting...${NC}"
    git tag -d "v${NEW_VERSION}"
fi

# Check if remote tag exists
if git ls-remote --tags origin "v${NEW_VERSION}" 2>/dev/null | grep -q "v${NEW_VERSION}" || \
   git ls-remote --tags github "v${NEW_VERSION}" 2>/dev/null | grep -q "v${NEW_VERSION}"; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} exists on remote. Deleting...${NC}"
    git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
    git push github ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
fi

# Create signed tag
echo -e "${BLUE}Creating signed tag v${NEW_VERSION}...${NC}"
git tag -s "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

# Push tag
echo -e "${BLUE}Pushing tag to GitHub...${NC}"
git push origin "v${NEW_VERSION}" 2>/dev/null || git push github "v${NEW_VERSION}"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Released v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}GitHub Actions will now build and publish Docker images.${NC}"
echo -e "Track progress: ${YELLOW}https://github.com/${GITHUB_REPO}/actions${NC}"
echo -e "Release page:   ${YELLOW}https://github.com/${GITHUB_REPO}/releases/tag/v${NEW_VERSION}${NC}"
