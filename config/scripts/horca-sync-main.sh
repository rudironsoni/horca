#!/usr/bin/env bash
# Lease-push Horca main. Conflict-free only. Never creates a merge.
#   promote  — put HEAD on main (first cut / manual)
#   rebase   — replay origin/main onto upstream/main, then lease-push
set -euo pipefail

MODE=${1:?usage: horca-sync-main.sh promote|rebase}
git config user.name "Horca Maintenance"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git fetch --prune --no-prune-tags origin
git fetch --prune --no-prune-tags https://github.com/stablyai/orca.git main
upstream=$(git rev-parse FETCH_HEAD)
observed=$(git rev-parse origin/main)
short=$(git rev-parse --short "$upstream")

if [ "$MODE" = promote ]; then
  source_sha=$(git rev-parse HEAD)
  echo "promote $source_sha onto main (lease $observed)"
  git push --force-with-lease="refs/heads/main:$observed" origin "$source_sha:refs/heads/main"
  exit 0
fi

if [ "$MODE" != rebase ]; then
  echo "unknown mode: $MODE" >&2
  exit 2
fi

if git merge-base --is-ancestor "$upstream" origin/main; then
  echo "origin/main already contains $short"
  exit 0
fi

git switch --detach origin/main
if ! git rebase "$upstream"; then
  git rebase --abort || true
  echo "conflict rebase-upstream-$short"
  exit 10
fi

new_head=$(git rev-parse HEAD)
echo "rebase $observed -> $new_head onto $short"
git push --force-with-lease="refs/heads/main:$observed" origin "$new_head:refs/heads/main"
