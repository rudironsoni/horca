#!/usr/bin/env bash
# Disable every Actions workflow except the Horca allowlist.
set -euo pipefail

REPO=${GITHUB_REPOSITORY:-rudironsoni/orca}

KEEP='Horca: Build
Horca: Release
Horca: Bump cask
Horca: CI
Horca: Maintenance
Horca: Overlay guard'

while IFS=$'\t' read -r name _state id; do
  [ -n "${name:-}" ] || continue
  if printf '%s\n' "$KEEP" | grep -Fxq "$name"; then
    echo "keep $name"
    continue
  fi
  echo "disable $name"
  gh workflow disable "$id" --repo "$REPO"
done < <(gh workflow list --repo "$REPO" --limit 80)
