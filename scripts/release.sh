#!/bin/bash
# =============================================================================
# MedAssist Release Script
# =============================================================================
# Usage:
#   ./scripts/release.sh patch    # 1.0.0 -> 1.0.1 (bugfixes)
#   ./scripts/release.sh minor    # 1.0.0 -> 1.1.0 (new features)
#   ./scripts/release.sh major    # 1.0.0 -> 2.0.0 (breaking changes)
#   ./scripts/release.sh 1.2.3    # explicit version
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Error: You have uncommitted changes. Commit or stash them first.${NC}"
    git status --short
    exit 1
fi

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

# Update version in package.json files
echo -e "${BLUE}Updating package.json files...${NC}"
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" backend/package.json
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" frontend/package.json 2>/dev/null || true

# Commit version bump
echo -e "${BLUE}Committing version bump...${NC}"
git add backend/package.json frontend/package.json 2>/dev/null || git add backend/package.json
git commit -m "chore: release v${NEW_VERSION}"

# Check if tag exists
if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists. Overwriting...${NC}"
    git tag -d "v${NEW_VERSION}"
    git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
fi

# Create and push tag
echo -e "${BLUE}Creating signed tag v${NEW_VERSION}...${NC}"
git tag -s "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

# Push
echo -e "${BLUE}Pushing to origin (GitHub)...${NC}"
git push origin main
git push origin "v${NEW_VERSION}"

echo ""
echo -e "${GREEN}✓ Released v${NEW_VERSION}${NC}"
echo -e "${BLUE}GitHub Actions will now build and publish Docker images.${NC}"
echo -e "Track progress: ${YELLOW}https://github.com/DanielVolz/medassist-ng/actions${NC}"
