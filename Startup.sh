#!/usr/bin/env bash
set -euo pipefail

MODE="dev"
REGISTRY="ghcr.io"
OWNER="unfurlsystemslab"
IMAGE_TAG="0.1.0-snapshot"
PORT="5173"
NO_OPEN="false"
NO_PULL="false"
PUBLISH_IMAGES="false"
SKIP_IMAGE_BUILD="false"
NO_UI="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-open) NO_OPEN="true"; shift ;;
    --no-pull) NO_PULL="true"; shift ;;
    --publish-images) PUBLISH_IMAGES="true"; shift ;;
    --skip-image-build) SKIP_IMAGE_BUILD="true"; shift ;;
    --no-ui) NO_UI="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration loader: imports local development env files without committing secrets.
load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

# Health gate: waits for one HTTP endpoint before moving to the next startup phase.
wait_http() {
  local url="$1"
  local attempts="${2:-90}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${url}" >&2
  return 1
}

# Adapter: normalizes Docker Compose v2 and legacy docker-compose invocation shapes.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose was not found. Install Docker Desktop or docker-compose." >&2
    return 1
  fi
}

# Environment guard: verifies Docker Desktop or another Docker engine is reachable.
assert_docker_engine() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed, but the Docker engine is not reachable. Start Docker Desktop and wait for the Linux engine before starting Lab services." >&2
    return 1
  fi
}

# Guard: locates the PowerShell runtime used by the existing Studio launcher.
find_powershell() {
  if command -v pwsh >/dev/null 2>&1; then
    command -v pwsh
  elif command -v powershell >/dev/null 2>&1; then
    command -v powershell
  else
    echo "PowerShell was not found. Install PowerShell 7+ or run Startup.ps1 on Windows." >&2
    return 1
  fi
}

# Projector: creates the container-facing Foundry deployment root and rewrites local tool URLs.
prepare_foundry_deployment() {
  local source_root="${WORKSPACE_ROOT}/unfurl-foundry/deployment"
  local target_root="${SCRIPT_DIR}/.startup/foundry-deployment"
  [[ -d "$source_root" ]] || { echo "Foundry deployment source is missing: ${source_root}" >&2; return 1; }
  rm -rf "$target_root"
  mkdir -p "$(dirname "$target_root")"
  cp -R "$source_root" "$target_root"
  local tools_file="${target_root}/registries/tools.yaml"
  if [[ -f "$tools_file" ]]; then
    sed -i.bak -e 's#http://127\.0\.0\.1:7878#http://unfurl-fabric:7878#g' \
               -e 's#http://localhost:7878#http://unfurl-fabric:7878#g' "$tools_file"
    rm -f "${tools_file}.bak"
  fi
}

load_env "${WORKSPACE_ROOT}/.debug/foundry.env"
load_env "${SCRIPT_DIR}/.env"
POWERSHELL_BIN="$(find_powershell)"

export UNFURL_FABRIC_IMAGE="$(echo "${REGISTRY}/${OWNER}/unfurl-fabric-studio:${IMAGE_TAG}" | tr '[:upper:]' '[:lower:]')"
export UNFURL_FOUNDRY_IMAGE="$(echo "${REGISTRY}/${OWNER}/unfurl-foundry:${IMAGE_TAG}" | tr '[:upper:]' '[:lower:]')"
export UNFURL_FLOW_IMAGE="$(echo "${REGISTRY}/${OWNER}/unfurl-flow:${IMAGE_TAG}" | tr '[:upper:]' '[:lower:]')"

if [[ "$PUBLISH_IMAGES" == "true" ]]; then
  args=(-Registry "$REGISTRY" -Owner "$OWNER" -ImageTag "$IMAGE_TAG" -Push)
  if [[ "$SKIP_IMAGE_BUILD" == "true" ]]; then
    args+=(-SkipBuild)
  fi
  "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/scripts/Publish-DependentImages.ps1" "${args[@]}"
fi

if [[ "$MODE" != "fixture" ]]; then
  assert_docker_engine
  if [[ -z "${UNFURL_FOUNDRY_CREDENTIAL_KEY:-}" ]]; then
    echo "UNFURL_FOUNDRY_CREDENTIAL_KEY is required for Foundry. Put it in ../.debug/foundry.env or set it in the shell." >&2
    exit 1
  fi
  prepare_foundry_deployment
  if [[ "$NO_PULL" != "true" ]]; then
    compose -f "${SCRIPT_DIR}/docker-compose.dependencies.yml" pull
  fi
  compose -f "${SCRIPT_DIR}/docker-compose.dependencies.yml" up -d
  wait_http "http://127.0.0.1:7878/health"
  wait_http "http://127.0.0.1:7979/health"
  wait_http "http://127.0.0.1:8080/health"
fi

if [[ "$NO_UI" != "true" ]]; then
  launch_args=(-Mode "$MODE" -Port "$PORT")
  if [[ "$NO_OPEN" == "true" ]]; then
    launch_args+=(-NoOpen)
  fi
  "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/scripts/launch-studio.ps1" "${launch_args[@]}"
fi
