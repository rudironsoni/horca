#!/usr/bin/env bash
# Wrap only the adversarial Electron invocation so an uncaught Napi::Error
# prints what() and a native backtrace from std::terminate.
# This is not a shutdown fix. The harness and the PTY order are unchanged.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: adversarial-terminate-diagnostic.sh <electron-binary>" >&2
  exit 2
fi

electron="$1"
here="$(cd "$(dirname "$0")" && pwd)"
pkg="$(cd "$(dirname "$electron")/../../../.." && pwd)/package.json"
test -x "$electron"
test -f "$pkg"
test -f "$here/terminate-diagnostic.cpp"
test -f "$here/adversarial-terminate-diagnostic.js"

version="$(node -p "require(process.argv[1]).version" "$pkg")"
case "$version" in
  ''|*[!0-9.]*)
    echo "could not read the Electron version from $pkg" >&2
    exit 2
    ;;
esac

hdr="${RUNNER_TEMP:-/tmp}/horca-electron-headers-$version"
addon="${RUNNER_TEMP:-/tmp}/horca-terminate-diag.node"
if [ ! -f "$hdr/include/node/node_api.h" ]; then
  mkdir -p "$hdr"
  curl -fsSL "https://artifacts.electronjs.org/headers/dist/v${version}/node-v${version}-headers.tar.gz" \
    | tar -xz -C "$hdr" --strip-components=1
fi
test -f "$hdr/include/node/node_api.h"

clang++ -std=c++17 -stdlib=libc++ -fPIC -bundle -undefined dynamic_lookup -g \
  -I "$hdr/include/node" \
  -o "$addon" \
  "$here/terminate-diagnostic.cpp"
test -s "$addon"

export HORCA_TERMINATE_DIAG="$addon"
exec "$electron" "$here/adversarial-terminate-diagnostic.js"
