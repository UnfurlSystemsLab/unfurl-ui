#!/usr/bin/env bash
set -euo pipefail

REMOVE_VOLUMES="false"
REMOVE_IMAGES="false"
UI_PORTS=(5173 5174 4173)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-volumes|-RemoveVolumes) REMOVE_VOLUMES="true"; shift ;;
    --remove-images|-RemoveImages) REMOVE_IMAGES="true"; shift ;;
    --ui-port|-UiPort) UI_PORTS+=("$2"); shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.dependencies.yml"

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

args=(-f "$COMPOSE_FILE" down --remove-orphans)
if [[ "$REMOVE_VOLUMES" == "true" ]]; then
  args+=(--volumes)
fi
if [[ "$REMOVE_IMAGES" == "true" ]]; then
  args+=(--rmi local)
fi

compose "${args[@]}"
echo "Unfurl dependency containers are stopped."

# Shutdown strategy: stops only the local Unfurl UI dev/preview processes, not arbitrary Node apps.
stop_unfurl_ui_processes() {
  local pids=()
  for port in "${UI_PORTS[@]}"; do
    if command -v lsof >/dev/null 2>&1; then
      while IFS= read -r pid; do
        [[ -n "$pid" ]] && pids+=("$pid")
      done < <(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
    elif command -v fuser >/dev/null 2>&1; then
      while IFS= read -r pid; do
        [[ -n "$pid" ]] && pids+=("$pid")
      done < <(fuser "${port}/tcp" 2>/dev/null || true)
    fi
  done

  if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(pgrep -f "unfurl-ui.*(vite|@unfurl/host-shell|npm-cli|launch-studio)" || true)
  fi

  if [[ "${#pids[@]}" -eq 0 ]]; then
    echo "No Unfurl UI dev server processes were running."
    return 0
  fi

  mapfile -t unique_pids < <(printf '%s\n' "${pids[@]}" | sort -n -u)
  for pid in "${unique_pids[@]}"; do
    if [[ "$pid" != "$$" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for pid in "${unique_pids[@]}"; do
    if [[ "$pid" != "$$" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  echo "Stopped ${#unique_pids[@]} Unfurl UI process(es)."
}

stop_unfurl_ui_processes
