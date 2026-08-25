#!/usr/bin/env bash
# Rewrite Casks/horca.rb in TAP_DIR to VERSION using sha256s of the published
# macOS DMGs on rudironsoni/orca. Writes changed=true|false to GITHUB_OUTPUT.
set -euo pipefail

VERSION=${VERSION:?VERSION is required}
TAP_DIR=${TAP_DIR:-.}
CASK="$TAP_DIR/Casks/horca.rb"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-horca\.[0-9]+$ ]]; then
  echo "::error::version must match <upstream-core>-horca.<N>, got: $VERSION" >&2
  exit 1
fi

if [ ! -f "$CASK" ]; then
  echo "::error::missing cask at $CASK" >&2
  exit 1
fi

current=$(sed -n 's/^  version "\(.*\)".*$/\1/p' "$CASK" | head -1)
echo "cask version: $current, target: $VERSION"
if [ "$current" = "$VERSION" ]; then
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "changed=false" >>"$GITHUB_OUTPUT"
  exit 0
fi

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for arch in arm64 x64; do
  gh release download "v$VERSION" \
    --repo rudironsoni/orca \
    --pattern "horca-macos-$arch.dmg" \
    --dir "$work"
done

sha_arm64=$(hash_file "$work/horca-macos-arm64.dmg")
sha_x64=$(hash_file "$work/horca-macos-x64.dmg")

tmp=$(mktemp)
sed \
  -e "s|^  version \".*$|  version \"$VERSION\"|" \
  -e "s|^  sha256 arm:   \".*\",$|  sha256 arm:   \"$sha_arm64\",|" \
  -e "s|^         intel: \".*\"$|         intel: \"$sha_x64\"|" \
  "$CASK" >"$tmp"
mv "$tmp" "$CASK"

grep -q "version \"$VERSION\"" "$CASK"
grep -q "$sha_arm64" "$CASK"
grep -q "$sha_x64" "$CASK"

[ -n "${GITHUB_OUTPUT:-}" ] && echo "changed=true" >>"$GITHUB_OUTPUT"
