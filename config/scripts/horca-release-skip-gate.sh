#!/usr/bin/env bash
# Skip Horca release/beta only when the commit subject contains a skip token.
# Squash-merge bodies must not skip: GitHub Actions contains() matches the whole message.
set -euo pipefail

EVENT_NAME=${EVENT_NAME:-}
COMMIT_MESSAGE=${COMMIT_MESSAGE:-}
HORCA_CHANNEL=${HORCA_CHANNEL:-stable}
GITHUB_OUTPUT=${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}

run=true
if [ "$EVENT_NAME" = push ]; then
  subject="${COMMIT_MESSAGE%%$'\n'*}"
  if [[ "$subject" == *'[skip horca-release]'* ]]; then
    run=false
  fi
  if [ "$HORCA_CHANNEL" = beta ] && [[ "$subject" == *'[skip horca-beta]'* ]]; then
    run=false
  fi
fi

{
  echo "event=${EVENT_NAME}"
  echo "channel=${HORCA_CHANNEL}"
  echo "run=${run}"
} >&2
echo "run=${run}" >>"$GITHUB_OUTPUT"
