#!/usr/bin/env bash
set -euo pipefail

# Builds (optional) and pushes images to the registry.
# Required env: REGISTRY_TOKEN (registry access token).
# Optional env: REGISTRY_USER (defaults to token), REGISTRY_HOST (default git.danielvolz.org), PROJECT_PATH (default daniel/medassist), IMAGE_TAG (set via -v or prompt).
# Flag: -v <tag> to set image tag (e.g. -v 1.0.0).

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

usage() {
  cat >&2 <<'EOF'
Usage: REGISTRY_TOKEN=... [REGISTRY_USER=...] ./scripts/push-images.sh [-v <tag>]

Flow:
  1) Tag wählen (per -v oder Auswahl/Prompt)
  2) Optional bauen (Backend/Frontend)
  3) Push bestätigen

Options:
  -v <tag>   Set image tag (default: prompt if unset)
  -h         Show this help

Env (can be supplied via .env):
  REGISTRY_TOKEN   Required registry access token
  REGISTRY_USER    Optional; defaults to REGISTRY_TOKEN
  REGISTRY_HOST    Default git.danielvolz.org
  PROJECT_PATH     Default daniel/medassist
  IMAGE_TAG        If set, used as default tag
EOF
}

prompt_yes_no() {
  local prompt="$1" default="$2" answer
  local suffix="[y/N]"
  [[ "$default" == "y" ]] && suffix="[Y/n]"
  while true; do
    read -r -p "$prompt $suffix " answer
    answer=${answer:-$default}
    case "$answer" in
      y|Y) return 0 ;;
      n|N) return 1 ;;
      *) echo "Please answer y or n." ;;
    esac
  done
}

select_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    echo "Using tag: $IMAGE_TAG"
    return
  fi

  mapfile -t tags < <(docker images --format '{{.Tag}}' medassist-backend 2>/dev/null | grep -v '<none>' | sort -u)

  if ((${#tags[@]} > 0)); then
    echo "Select tag to use:"
    local i=1
    for t in "${tags[@]}"; do
      echo "  [$i] $t"
      ((i++))
    done
    echo "  [n] Enter new tag"
    read -r -p "Choice: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#tags[@]} )); then
      IMAGE_TAG="${tags[choice-1]}"
      echo "Using tag: $IMAGE_TAG"
      return
    fi
  fi

  while [[ -z "${IMAGE_TAG:-}" ]]; do
    read -r -p "Enter tag (e.g. 1.0.0): " IMAGE_TAG
  done
  echo "Using tag: $IMAGE_TAG"
}

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
fi

REGISTRY_HOST=${REGISTRY_HOST:-git.danielvolz.org}
PROJECT_PATH=${PROJECT_PATH:-daniel/medassist}
IMAGE_TAG=${IMAGE_TAG:-}

while getopts ":v:h" opt; do
  case "$opt" in
    v)
      IMAGE_TAG="$OPTARG"
      ;;
    h)
      usage
      exit 0
      ;;
    \?)
      echo "Unknown option -$OPTARG" >&2
      usage
      exit 1
      ;;
    :)
      echo "Option -$OPTARG requires an argument" >&2
      usage
      exit 1
      ;;
  esac
done

select_tag

REGISTRY_TOKEN=${REGISTRY_TOKEN:-}
REGISTRY_USER=${REGISTRY_USER:-$REGISTRY_TOKEN}

if [[ -z "$REGISTRY_TOKEN" ]]; then
  echo "Missing REGISTRY_TOKEN. Set it in your env or in .env." >&2
  usage
  exit 1
fi

build_images() {
  echo "Building medassist-backend:${IMAGE_TAG}..."
  docker build -t "medassist-backend:${IMAGE_TAG}" "$REPO_ROOT/backend"
  echo "Building medassist-frontend:${IMAGE_TAG}..."
  docker build -t "medassist-frontend:${IMAGE_TAG}" "$REPO_ROOT/frontend"
}

BACKEND_LOCAL="medassist-backend:${IMAGE_TAG}"
FRONTEND_LOCAL="medassist-frontend:${IMAGE_TAG}"
BACKEND_REMOTE="${REGISTRY_HOST}/${PROJECT_PATH}/backend:${IMAGE_TAG}"
FRONTEND_REMOTE="${REGISTRY_HOST}/${PROJECT_PATH}/frontend:${IMAGE_TAG}"

update_compose_prod() {
  local compose_file="$REPO_ROOT/docker-compose.prod.yml"
  local sed_inplace

  case "$(uname -s)" in
    Darwin*) sed_inplace=("-i" "") ;;
    *) sed_inplace=("-i") ;;
  esac

  if [[ -f "$compose_file" ]]; then
    # Replace image tags in prod compose to the selected tag
    sed "${sed_inplace[@]}" \
      -e "s|^\s*image: ${REGISTRY_HOST}/${PROJECT_PATH}/backend:.*|    image: ${REGISTRY_HOST}/${PROJECT_PATH}/backend:${IMAGE_TAG}|" \
      -e "s|^\s*image: ${REGISTRY_HOST}/${PROJECT_PATH}/frontend:.*|    image: ${REGISTRY_HOST}/${PROJECT_PATH}/frontend:${IMAGE_TAG}|" \
      "$compose_file"
    echo "Updated docker-compose.prod.yml with tag ${IMAGE_TAG}."
  else
    echo "Warning: docker-compose.prod.yml not found; skipped updating tag." >&2
  fi
}

built=0
if prompt_yes_no "Build images for tag ${IMAGE_TAG}?" "y"; then
  build_images
  built=1
else
  echo "Skipping build. Using existing local images for tag ${IMAGE_TAG}."
fi

push_default="n"
[[ $built -eq 1 ]] && push_default="y"

if ! prompt_yes_no "Push images for tag ${IMAGE_TAG} to ${REGISTRY_HOST}/${PROJECT_PATH}?" "$push_default"; then
  echo "Push cancelled."
  exit 0
fi

printf 'Logging in to %s...\n' "$REGISTRY_HOST"
echo "$REGISTRY_TOKEN" | docker login "$REGISTRY_HOST" --username "$REGISTRY_USER" --password-stdin

docker tag "$BACKEND_LOCAL" "$BACKEND_REMOTE"
docker tag "$FRONTEND_LOCAL" "$FRONTEND_REMOTE"

docker push "$BACKEND_REMOTE"
docker push "$FRONTEND_REMOTE"

printf 'Pushed:\n  %s\n  %s\n' "$BACKEND_REMOTE" "$FRONTEND_REMOTE"

update_compose_prod
