#!/usr/bin/env bash
# Gate A contract runner against the CURRENT upstream main.
#
# T0: fetch upstream main, resolve the exact SHA, write it to upstream.lock.json.
# T1: run the complete Gate A contract against that immutable SHA.
#
# Fails closed on: engine mismatch, pnpm mismatch, materialized HEAD != lock.
# Packaging is unsigned (ad-hoc). No Horca functional overlay is used.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache/upstream.git"
OUT="$ROOT/migration/evidence/gate-a-current"
mkdir -p "$OUT"

NODE24="/Users/rudimar.ronsoni@feverup.com/.nvm/versions/node/v24.20.0/bin"
export PATH="$NODE24:$PATH"

PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

echo "=========== T0: resolve current upstream main ==========="
FETCH_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$CACHE" fetch origin main > /dev/null 2>&1
SHA="$(git -C "$CACHE" rev-parse refs/heads/main)"
COMMIT_TS="$(git -C "$CACHE" log -1 --format=%cI "$SHA")"
SUBJECT="$(git -C "$CACHE" log -1 --format=%s "$SHA")"
cat > "$ROOT/upstream.lock.json" <<EOF
{
  "repository": "https://github.com/stablyai/orca.git",
  "commit": "$SHA"
}
EOF
{
  echo "repository: https://github.com/stablyai/orca.git"
  echo "resolvedSha: $SHA"
  echo "fetchTimestampUtc: $FETCH_TS"
  echo "commitTimestamp: $COMMIT_TS"
  echo "subject: $SUBJECT"
} | tee "$OUT/t0-target.txt" | sed 's/^/  /'

echo "=========== T1: complete Gate A contract ==========="

WT="$(node "$ROOT/scripts/materialize.mjs" 2>"$OUT/materialize.log" | tail -1)"
if [ ! -d "$WT" ]; then ok_err="materialize"; echo "  FAIL  materialize"; echo "done"; exit 1; fi
ok "materialize"

HEAD_ACTUAL="$(git -C "$WT" rev-parse HEAD)"
[ "$HEAD_ACTUAL" = "$SHA" ] && ok "materialized HEAD == lock ($HEAD_ACTUAL)" || bad "materialized HEAD mismatch ($HEAD_ACTUAL != $SHA)"

node "$ROOT/scripts/apply-overlays.mjs" "$WT" > "$OUT/apply.log" 2>&1 && ok "apply-overlays (empty)" || bad "apply-overlays"
node "$ROOT/scripts/verify-overlay.mjs" "$WT" > "$OUT/verify.log" 2>&1 && ok "verify-overlay" || bad "verify-overlay"

DECLARED_NODE="$(node -e "console.log(require('$WT/package.json').engines.node)")"
RUNNING_NODE="$(node --version | sed 's/^v//;s/\..*//')"
[ "$DECLARED_NODE" = "$RUNNING_NODE" ] && ok "node engine ($RUNNING_NODE == $DECLARED_NODE)" || bad "node engine ($RUNNING_NODE != $DECLARED_NODE)"
DECLARED_PM="$(node -e "console.log(require('$WT/package.json').packageManager.split('@')[1].split('+')[0])")"
RUNNING_PM="$(pnpm --version)"
[ "$DECLARED_PM" = "$RUNNING_PM" ] && ok "pnpm version ($RUNNING_PM)" || bad "pnpm version ($RUNNING_PM != $DECLARED_PM)"
{ echo "node: $(node --version)"; echo "pnpm: $(pnpm --version)"; echo "engines.node: $DECLARED_NODE"; } > "$OUT/toolchain.txt"

( cd "$WT" && pnpm install --frozen-lockfile ) > "$OUT/install.log" 2>&1 && ok "frozen install (full, with scripts)" || bad "frozen install"

for tc in tc:node tc:cli tc:web tc; do
  ( cd "$WT" && NODE_OPTIONS=--max-old-space-size=8192 pnpm "$tc" ) > "$OUT/${tc//:/_}.log" 2>&1 && ok "$tc" || bad "$tc"
done

( cd "$WT" && pnpm exec vitest run --config config/vitest.config.ts src/shared/agent-cli-flag-detection.test.ts 2>/dev/null ) > "$OUT/test-smoke.log" 2>&1 && ok "test (smoke)" || bad "test (smoke)"
( cd "$WT" && pnpm exec vitest run --config config/vitest.config.ts config/scripts/electron-builder-runtime-resources.test.mjs 2>/dev/null ) > "$OUT/test-packaging-resources.log" 2>&1 && ok "test (packaging-resources)" || bad "test (packaging-resources)"

( cd "$WT" && pnpm build:desktop ) > "$OUT/build_desktop.log" 2>&1 && ok "build:desktop" || bad "build:desktop"
( cd "$WT" && pnpm ensure:electron-runtime ) > "$OUT/ensure-runtime.log" 2>&1 && ok "ensure:electron-runtime" || bad "ensure:electron-runtime"

( cd "$WT" && CSC_IDENTITY_AUTO_DISCOVERY=false CSC_NAME=- npx electron-builder --config config/electron-builder.config.cjs --dir ) > "$OUT/electron-builder-dir.log" 2>&1 && ok "electron-builder --dir (unsigned)" || bad "electron-builder --dir (unsigned)"
APP="$(ls -d "$WT"/dist/mac-*/*.app 2>/dev/null | head -1)"
[ -n "$APP" ] && [ -x "$APP/Contents/MacOS/Orca" ] && ok "packaged .app ($(du -sh "$APP" | awk '{print $1}'))" || bad "packaged .app"

# Git-aware cleanup
rm -f "$WT/.horca-build-identity.json"
( cd "$CACHE" && git worktree remove "$WT" && git worktree prune --expire now ) > "$OUT/cleanup.log" 2>&1 && ok "cleanup (git worktree remove)" || bad "cleanup"
( cd "$CACHE" && ! git worktree list --porcelain | grep -qF "$WT" ) && ok "cleanup verification" || bad "cleanup verification"
( cd "$CACHE" && ! grep -rq . "$CACHE/worktrees" 2>/dev/null ) && ok "no stale worktree metadata" || bad "no stale worktree metadata"

# Second materialization after cleanup
WT2="$(node "$ROOT/scripts/materialize.mjs" 2>"$OUT/materialize2.log" | tail -1)"
[ -d "$WT2" ] && [ "$(git -C "$WT2" rev-parse HEAD)" = "$SHA" ] && ok "second materialization" || bad "second materialization"

# Concurrent materialization isolation
WT3="$(node "$ROOT/scripts/materialize.mjs" 2>"$OUT/materialize3.log" | tail -1)"
if [ -d "$WT2" ] && [ -d "$WT3" ] && [ "$WT2" != "$WT3" ] && [ "$(git -C "$WT2" rev-parse HEAD)" = "$SHA" ] && [ "$(git -C "$WT3" rev-parse HEAD)" = "$SHA" ]; then
  ok "concurrent materialization isolation"
else
  bad "concurrent materialization isolation"
fi
for w in "$WT2" "$WT3"; do rm -f "$w/.horca-build-identity.json"; ( cd "$CACHE" && git worktree remove "$w" 2>/dev/null ); done
( cd "$CACHE" && git worktree prune --expire now )

echo "=========== RESULT ==========="
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo "  Gate A: PASS ($SHA)" || echo "  Gate A: FAIL ($SHA)"
