#!/usr/bin/env bash
# Remove disposable materialized worktrees in a Git-aware way.
#
# A materialized worktree is intentionally dirty after overlays and composition:
# the overlay modifies tracked files, and Candidate B regenerates dependency
# metadata. `git worktree remove` refuses a dirty worktree, so `--force` is the
# documented Git idiom for a DISPOSABLE worktree whose content is reproducible
# from the locked upstream SHA plus committed Horca inputs.
#
# `--force` is NOT permission to ignore unexplained tracked changes. Before the
# forced removal this script proves that every tracked modification is one of:
#   * a declared overlay target (from HORCA_OVERLAY_MANIFEST, if set), or
#   * a declared generated dependency file (HORCA_CLEANUP_ALLOW, colon-separated).
# Cleanup FAILS if any other tracked file was modified.
#
# Usage: cleanup-worktrees.sh [worktree-path ...]   (no args: all materializations)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache/upstream.git"
MANIFEST="${HORCA_OVERLAY_MANIFEST:-$ROOT/overlay/manifest.json}"
ALLOW="${HORCA_CLEANUP_ALLOW:-pnpm-workspace.yaml:pnpm-lock.yaml}"

declared_targets() {
  [ -f "$MANIFEST" ] || return 0
  node -e "for (const o of (require('$MANIFEST').overrides||[])) console.log(o.target)" 2>/dev/null
}

validate_one() {
  local wt="$1"
  local status
  status="$(git -C "$wt" status --porcelain | grep -v '^??' || true)"
  [ -z "$status" ] && return 0

  local bad=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local file="${line:3}"
    # strip rename arrow if present
    file="${file%% -> *}"
    local allowed=0
    if declared_targets | grep -qxF "$file"; then allowed=1; fi
    if echo "$ALLOW" | tr ':' '\n' | grep -qxF "$file"; then allowed=1; fi
    if [ "$allowed" -ne 1 ]; then
      echo "  CLEANUP VALIDATION FAILED: unexplained tracked modification: $file"
      bad=1
    fi
  done <<< "$status"
  return "$bad"
}

remove_one() {
  local wt="$1"
  if ! validate_one "$wt"; then
    echo "  refusing to force-remove $wt"
    return 1
  fi
  rm -f "$wt/.horca-build-identity.json"
  if git -C "$CACHE" worktree remove --force "$wt" 2>/dev/null; then
    echo "removed $wt"
  else
    echo "skip (not a worktree or already gone): $wt"
  fi
}

if [ "$#" -gt 0 ]; then
  for wt in "$@"; do remove_one "$wt"; done
else
  while IFS= read -r wt; do
    case "$wt" in
      "$CACHE") ;;
      *) remove_one "$wt" ;;
    esac
  done < <(git -C "$CACHE" worktree list --porcelain | sed -n 's/^worktree //p')
fi

git -C "$CACHE" worktree prune --expire now
echo "=== remaining worktrees ==="
git -C "$CACHE" worktree list
