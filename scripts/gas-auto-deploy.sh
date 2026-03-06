#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ -f ".gas-deploy.env" ]]; then
  # shellcheck disable=SC1091
  source ".gas-deploy.env"
fi

DEFAULT_DEPLOYMENT_ID="AKfycbymh2mAIMJUwkG_N3MRk8vRvwwDeB2dXe_GHRXtcO-_rap3EZtFjjGCpB1WBlnwCloZzA"
DEPLOYMENT_ID="${GAS_DEPLOYMENT_ID:-$DEFAULT_DEPLOYMENT_ID}"
HEALTH_TIMEOUT="${GAS_HEALTH_TIMEOUT:-20}"
HEALTH_EXPECT="${GAS_HEALTH_EXPECT:-}"
HEALTH_STRICT="${GAS_HEALTH_STRICT:-false}"
MESSAGE="${1:-Auto deploy $(date '+%Y-%m-%d %H:%M:%S')}"

if [[ -z "$DEPLOYMENT_ID" ]]; then
  echo "GAS_DEPLOYMENT_ID is required."
  exit 1
fi

HEALTH_URL="${GAS_HEALTHCHECK_URL:-https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec}"

get_deployment_version() {
  local dep_id="$1"
  clasp deployments | awk -v id="$dep_id" '$0 ~ id {for(i=1;i<=NF;i++){if($i ~ /^@[0-9]+$/){gsub("@","",$i); print $i; exit}}}'
}

run_healthcheck() {
  local url="$1"
  local code body_file
  body_file="$(mktemp)"
  code="$(curl -sS -L --max-time "$HEALTH_TIMEOUT" -o "$body_file" -w "%{http_code}" "$url" || true)"
  if [[ ! "$code" =~ ^[23] ]]; then
    if [[ "$code" == "404" && "$HEALTH_STRICT" != "true" ]]; then
      echo "Healthcheck inconclusive: HTTP 404 (likely auth/session restricted in CLI)."
      rm -f "$body_file"
      return 2
    fi
    echo "Healthcheck failed: HTTP $code"
    rm -f "$body_file"
    return 1
  fi

  if grep -Eq "현재 파일을 열 수 없습니다|페이지를 찾을 수 없습니다|Google Drive를 사용하여 작업하세요" "$body_file"; then
    echo "Healthcheck failed: Drive error page detected"
    rm -f "$body_file"
    return 1
  fi

  if [[ -n "$HEALTH_EXPECT" ]] && ! grep -Fq "$HEALTH_EXPECT" "$body_file"; then
    echo "Healthcheck failed: expected marker not found -> $HEALTH_EXPECT"
    rm -f "$body_file"
    return 1
  fi

  rm -f "$body_file"
  return 0
}

PREV_VERSION="$(get_deployment_version "$DEPLOYMENT_ID" || true)"
echo "Current deployment version: ${PREV_VERSION:-unknown}"

echo "[1/4] Push to Apps Script"
clasp push --force

echo "[2/4] Create version"
VERSION_OUTPUT="$(clasp version "$MESSAGE")"
echo "$VERSION_OUTPUT"
VERSION_NUMBER="$(echo "$VERSION_OUTPUT" | grep -Eo '[0-9]+' | tail -1)"
if [[ -z "$VERSION_NUMBER" ]]; then
  echo "Version number parse failed."
  exit 1
fi

echo "[3/4] Deploy version ${VERSION_NUMBER}"
clasp deploy --deploymentId "$DEPLOYMENT_ID" --description "$MESSAGE" --versionNumber "$VERSION_NUMBER"

echo "[4/4] Healthcheck -> $HEALTH_URL"
if run_healthcheck "$HEALTH_URL"; then
  echo "Done: version ${VERSION_NUMBER} deployed and healthy."
  exit 0
else
  health_status=$?
  if [[ "$health_status" -eq 2 ]]; then
    echo "Done: version ${VERSION_NUMBER} deployed (healthcheck inconclusive, rollback skipped)."
    exit 0
  fi
fi

echo "Healthcheck failed after deploy ${VERSION_NUMBER}."
if [[ -n "$PREV_VERSION" ]]; then
  echo "Rolling back to previous version ${PREV_VERSION}..."
  clasp deploy --deploymentId "$DEPLOYMENT_ID" --description "Auto rollback to ${PREV_VERSION} after failed healthcheck" --versionNumber "$PREV_VERSION"
  echo "Rollback completed: deployment restored to ${PREV_VERSION}."
else
  echo "Rollback skipped: previous version not found."
fi

exit 1
