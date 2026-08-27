#!/usr/bin/env bash
# Register TAP_DIR as rudironsoni/tap, then brew style/audit CASK_TOKEN.
# Homebrew 5+ rejects cask files that are not under Library/Taps/<user>/homebrew-<repo>.
set -euo pipefail

CASK_TOKEN=${CASK_TOKEN:?CASK_TOKEN is required}
TAP_DIR=${TAP_DIR:?TAP_DIR is required}

case "$CASK_TOKEN" in
  horca | horca@beta) ;;
  *)
    echo "::error::CASK_TOKEN must be horca or horca@beta, got: $CASK_TOKEN" >&2
    exit 1
    ;;
esac

tap_dir=$(cd "$TAP_DIR" && pwd)
tap_link="$(brew --repository rudironsoni/tap)"
mkdir -p "$(dirname "$tap_link")"
# Why: replace a prior clone so brew sees this working tree, including uncommitted bump edits.
rm -rf "$tap_link"
ln -s "$tap_dir" "$tap_link"

# Why: Homebrew 6 blocks evaluating third-party taps until `brew trust`. This job lints a cask it just wrote.
export HOMEBREW_NO_REQUIRE_TAP_TRUST=1
export HOMEBREW_NO_AUTO_UPDATE=1

brew style --fix --cask "rudironsoni/tap/${CASK_TOKEN}"
brew style --cask "rudironsoni/tap/${CASK_TOKEN}"
brew audit --cask "rudironsoni/tap/${CASK_TOKEN}"
