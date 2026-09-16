#!/usr/bin/env bash
# Gate A three-SHA differential harness.
#
# Runs the identical Gate A command set against pre-regression, regression, and
# repair, under the Node major DECLARED by the tested Orca revision
# (package.json engines.node). Fails closed if the running Node major does not
# satisfy the engine declaration, so an unsupported toolchain cannot silently
# produce misleading results.
#
# Packaging uses CSC_NAME=- (ad-hoc signing). Gate A requires UNSIGNED
# packaging and must not depend on a Developer ID or release secrets.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache/upstream.git"
OUT="$ROOT/migration/evidence/gate-a"
mkdir -p "$OUT"

NODE24="/Users/rudimar.ronsoni@feverup.com/.nvm/versions/node/v24.20.0/bin"
export PATH="$NODE24:$PATH"

declare -a NAMES=(pre-regression regression repair)
declare -a SHAS=(
  07b7687a2e6468ca699e1baf2415d479a9aca318
  15cac68802361f3b9075630335d3e6d379c2a909
  a7e34d5695fda152a9ca441f0a496a89359bae91
)

assert_engine() {
  local wt="$1" declared running
  declared="$(node -e "console.log(require('$wt/package.json').engines.node)")"
  running="$(node --version | sed 's/^v//;s/\..*//')"
  if [ "$declared" != "$running" ]; then
    echo "  ENGINE MISMATCH: upstream declares node $declared, running node $running"
    return 1
  fi
  echo "  engine: node $running (matches declared $declared)"
}

for i in "${!NAMES[@]}"; do
  NAME="${NAMES[$i]}"; SHA="${SHAS[$i]}"
  echo "=================== $NAME ($SHA) ==================="

  cat > "$ROOT/upstream.lock.json" <<EOF
{
  "repository": "https://github.com/stablyai/orca.git",
  "commit": "$SHA"
}
EOF

  node "$ROOT/scripts/fetch-upstream.mjs" > "$OUT/$NAME-fetch.log" 2>&1 \
    && echo "  fetch: PASS" || { echo "  fetch: FAIL"; continue; }

  WT="$(node "$ROOT/scripts/materialize.mjs" 2>"$OUT/$NAME-materialize.log" | tail -1)"
  [ -d "$WT" ] || { echo "  materialize: FAIL"; continue; }
  echo "  materialize: $(basename "$WT")"

  {
    echo "node: $(node --version)"
    echo "pnpm: $(pnpm --version)"
    echo "engines.node: $(node -e "console.log(require('$WT/package.json').engines.node)")"
    echo "packageManager: $(node -e "console.log(require('$WT/package.json').packageManager)")"
  } > "$OUT/$NAME-toolchain.log"
  sed 's/^/    /' "$OUT/$NAME-toolchain.log"
  assert_engine "$WT" || { echo "  engine: FAIL (refusing unsupported toolchain)"; continue; }

  node "$ROOT/scripts/apply-overlays.mjs" "$WT" > "$OUT/$NAME-apply.log" 2>&1 \
    && echo "  apply-overlays: PASS" || echo "  apply-overlays: FAIL"
  node "$ROOT/scripts/verify-overlay.mjs" "$WT" > "$OUT/$NAME-verify.log" 2>&1 \
    && echo "  verify-overlay: PASS" || echo "  verify-overlay: FAIL"

  ( cd "$WT" && pnpm install --frozen-lockfile ) > "$OUT/$NAME-install.log" 2>&1 \
    && echo "  install(frozen): PASS" || echo "  install(frozen): FAIL"

  for tc in tc:node tc:cli tc:web tc; do
    ( cd "$WT" && NODE_OPTIONS=--max-old-space-size=8192 pnpm "$tc" ) > "$OUT/$NAME-${tc//:/_}.log" 2>&1 \
      && echo "  $tc: PASS" || echo "  $tc: FAIL"
  done

  ( cd "$WT" && pnpm exec vitest run --config config/vitest.config.ts src/shared/agent-cli-flag-detection.test.ts 2>/dev/null ) \
    > "$OUT/$NAME-test-smoke.log" 2>&1 && echo "  test(smoke): PASS" || echo "  test(smoke): FAIL"
  ( cd "$WT" && pnpm exec vitest run --config config/vitest.config.ts config/scripts/electron-builder-runtime-resources.test.mjs 2>/dev/null ) \
    > "$OUT/$NAME-test-packaging-resources.log" 2>&1 && echo "  test(packaging-resources): PASS" || echo "  test(packaging-resources): FAIL"

  ( cd "$WT" && pnpm build:desktop ) > "$OUT/$NAME-build_desktop.log" 2>&1 \
    && echo "  build:desktop: PASS" || echo "  build:desktop: FAIL"

  ( cd "$WT" && pnpm ensure:electron-runtime ) > "$OUT/$NAME-ensure-runtime.log" 2>&1 \
    && echo "  ensure:electron-runtime: PASS" || echo "  ensure:electron-runtime: FAIL"
  ( cd "$WT" && CSC_IDENTITY_AUTO_DISCOVERY=false CSC_NAME=- npx electron-builder --config config/electron-builder.config.cjs --dir ) \
    > "$OUT/$NAME-electron-builder-dir.log" 2>&1 && echo "  electron-builder --dir (unsigned): PASS" || echo "  electron-builder --dir (unsigned): FAIL"
  if ls "$WT"/dist/mac-*/*.app >/dev/null 2>&1; then echo "  packaged artifact: PASS ($(du -sh "$WT"/dist/mac-*/*.app | awk '{print $1}'))"; else echo "  packaged artifact: MISSING"; fi

  rm -f "$WT/.horca-build-identity.json"
  ( cd "$CACHE" && git worktree remove "$WT" && git worktree prune --expire now ) \
    > "$OUT/$NAME-cleanup.log" 2>&1 && echo "  cleanup: PASS" || echo "  cleanup: FAIL"
  if ( cd "$CACHE" && git worktree list --porcelain | grep -qF "$WT" ); then
    echo "  cleanup-verify: FAIL (stale registration)"
  else
    echo "  cleanup-verify: PASS"
  fi
done

echo "=================== DONE ==================="
cd "$CACHE" && git worktree list
