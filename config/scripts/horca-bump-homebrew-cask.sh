#!/usr/bin/env bash
# Rewrite Casks/${CASK_TOKEN}.rb in TAP_DIR to VERSION using sha256s of the
# published macOS DMGs on rudironsoni/orca. Writes changed=true|false to
# GITHUB_OUTPUT. Missing tap files are copied from this repo's staging cask.
set -euo pipefail

VERSION=${VERSION:?VERSION is required}
TAP_DIR=${TAP_DIR:-.}
CASK_TOKEN=${CASK_TOKEN:-horca}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STAGING_CASK=${STAGING_CASK:-"$repo_root/config/horca-homebrew/Casks/${CASK_TOKEN}.rb"}

case "$CASK_TOKEN" in
  horca)
    version_re='^[0-9]+\.[0-9]+\.[0-9]+-horca\.[0-9]+$'
    version_hint='<upstream-core>-horca.<N>'
    ;;
  horca@beta)
    version_re='^[0-9]+\.[0-9]+\.[0-9]+-horca\.[0-9]+-beta\.[0-9]+$'
    version_hint='<upstream-core>-horca.<N>-beta.<M>'
    ;;
  *)
    echo "::error::CASK_TOKEN must be horca or horca@beta, got: $CASK_TOKEN" >&2
    exit 1
    ;;
esac

if ! [[ "$VERSION" =~ $version_re ]]; then
  echo "::error::version must match $version_hint for $CASK_TOKEN, got: $VERSION" >&2
  exit 1
fi

CASK="$TAP_DIR/Casks/${CASK_TOKEN}.rb"
if [ ! -f "$CASK" ]; then
  if [ -f "$STAGING_CASK" ]; then
    mkdir -p "$(dirname "$CASK")"
    cp "$STAGING_CASK" "$CASK"
  else
    echo "::error::missing cask at $CASK and no staging file at $STAGING_CASK" >&2
    exit 1
  fi
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
  -e 's/depends_on macos: ">= :big_sur"/depends_on macos: :big_sur/' \
  "$CASK" >"$tmp"
mv "$tmp" "$CASK"

grep -q "version \"$VERSION\"" "$CASK"
grep -q "$sha_arm64" "$CASK"
grep -q "$sha_x64" "$CASK"

[ -n "${GITHUB_OUTPUT:-}" ] && echo "changed=true" >>"$GITHUB_OUTPUT"
