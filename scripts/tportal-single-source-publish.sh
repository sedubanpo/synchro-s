#!/usr/bin/env bash
set -euo pipefail

# Single source of truth:
# - Source: /Users/anjongseong/Documents/New project/index.html
# - Target: <repo>/index.html
# This script intentionally does NOT use index_git.html.

SRC_HTML="/Users/anjongseong/Documents/New project/index.html"
TARGET_REPO_DEFAULT="/Users/anjongseong/Documents/프로그램/에스에듀 개발/강사 포털"
TARGET_REPO="${1:-$TARGET_REPO_DEFAULT}"
COMMIT_MSG="${2:-Sync index.html from single source}"

if [[ ! -f "$SRC_HTML" ]]; then
  echo "[ERROR] source file not found: $SRC_HTML"
  exit 1
fi

if [[ ! -d "$TARGET_REPO/.git" ]]; then
  echo "[ERROR] target is not a git repo: $TARGET_REPO"
  exit 1
fi

if [[ -f "$TARGET_REPO/index_git.html" ]]; then
  echo "[WARN] $TARGET_REPO/index_git.html exists."
  echo "[WARN] This workflow ignores index_git.html and updates index.html only."
fi

cp "$SRC_HTML" "$TARGET_REPO/index.html"

pushd "$TARGET_REPO" >/dev/null

git add index.html

if git diff --cached --quiet; then
  echo "[INFO] no changes to commit."
  popd >/dev/null
  exit 0
fi

git commit -m "$COMMIT_MSG"
git push origin main

popd >/dev/null
echo "[OK] published index.html from single source."

