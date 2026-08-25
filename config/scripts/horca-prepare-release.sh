#!/usr/bin/env bash
# Computes the next Horca version, verifies release provenance, and writes
# the release notes body.
#
# Run inside a full-history checkout of this repository at the exact commit
# being released. Upstream tip is stablyai/orca main (or HORCA_UPSTREAM_TIP_REF
# in tests). Requires `gh` with a token that can read this repository's Horca
# releases (v*-horca.* only).
#
# Env:
#   SOURCE_SHA     full 40-char commit being released
#   BUILDS_REPO    owner/name of the repo that holds Horca GitHub Releases
#                  (this repository: rudironsoni/orca)
#   NOTES_PATH     where to write the release notes body
#   HORCA_CHANNEL  stable (default) or beta
#   HORCA_BRANCH   branch name recorded in beta notes
#
# Outputs (appended to $GITHUB_OUTPUT when set, and always printed):
#   version, tag, source_sha, upstream_sha
set -euo pipefail

fail() {
  echo "::error::$1" >&2
  exit 1
}

[[ "${SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_SHA must be a full 40-char SHA, got: ${SOURCE_SHA:-<empty>}"
[ -n "${BUILDS_REPO:-}" ] || fail "BUILDS_REPO is required"
NOTES_PATH="${NOTES_PATH:-release-notes.md}"
CHANNEL="${HORCA_CHANNEL:-stable}"
[[ "$CHANNEL" == "stable" || "$CHANNEL" == "beta" ]] || fail "HORCA_CHANNEL must be stable or beta, got: $CHANNEL"

git rev-parse --verify --quiet "$SOURCE_SHA^{commit}" >/dev/null || fail "SOURCE_SHA $SOURCE_SHA not found in this checkout"

# --- Provenance -------------------------------------------------------------
# Upstream-SHA is the newest stablyai/orca main commit actually contained by
# SOURCE_SHA. Shepherd can move upstream ahead of this commit; claiming that
# tip when it is not an ancestor would lie. Unrelated histories still fail.
if [ -n "${HORCA_UPSTREAM_TIP_REF:-}" ]; then
  git rev-parse --verify --quiet "${HORCA_UPSTREAM_TIP_REF}^{commit}" >/dev/null ||
    fail "HORCA_UPSTREAM_TIP_REF ($HORCA_UPSTREAM_TIP_REF) is not a commit"
  UPSTREAM_TIP="$HORCA_UPSTREAM_TIP_REF"
else
  git fetch --no-tags https://github.com/stablyai/orca.git main
  UPSTREAM_TIP=FETCH_HEAD
fi
UPSTREAM_SHA=$(git merge-base "$UPSTREAM_TIP" "$SOURCE_SHA") ||
  fail "SOURCE_SHA ($SOURCE_SHA) shares no history with stablyai/orca main"

# --- Version ----------------------------------------------------------------
# Upstream core = package.json version at SOURCE_SHA with any prerelease
# suffix stripped. N is 1 + the highest already-released stable N for that
# core (resets automatically when the core changes). Betas never increment
# that N; they use the pending N plus -beta.<M>. Plain vX.Y.Z tags are
# ignored — they belong to the mirrored upstream namespace.
core=$(git show "$SOURCE_SHA:package.json" | node -e '
  let data = ""
  process.stdin.on("data", (c) => (data += c))
  process.stdin.on("end", () => process.stdout.write(JSON.parse(data).version.split("-")[0]))
')
[[ "$core" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "could not derive upstream core version, got: $core"

# One release per NDJSON line; node below consumes the stream once for both
# the next version and the previous release's provenance markers.
releases_ndjson=$(gh api "repos/$BUILDS_REPO/releases" --paginate \
  --jq '.[] | {tag_name, body, draft, created_at}' || true)

release_meta=$(CORE="$core" HORCA_CHANNEL="$CHANNEL" node -e '
  let data = ""
  process.stdin.on("data", (c) => (data += c))
  process.stdin.on("end", () => {
    const channel = process.env.HORCA_CHANNEL
    const releases = data
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .filter((r) => !r.draft)
    const stableReleases = releases.filter((r) =>
      /^v\d+\.\d+\.\d+-horca\.\d+$/.test(r.tag_name)
    )
    const corePattern = new RegExp(
      `^v${process.env.CORE.replace(/\./g, "\\.")}-horca\\.(\\d+)$`
    )
    let maxN = 0
    for (const release of stableReleases) {
      const match = corePattern.exec(release.tag_name)
      if (match) maxN = Math.max(maxN, Number(match[1]))
    }
    const nextN = maxN + 1
    const byCreated = (list) =>
      [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    let version
    let prev
    if (channel === "beta") {
      const betaPattern = new RegExp(
        `^v${process.env.CORE.replace(/\./g, "\\.")}-horca\\.${nextN}-beta\\.(\\d+)$`
      )
      const betas = releases.filter((r) => betaPattern.test(r.tag_name))
      let maxM = 0
      for (const release of betas) {
        const match = betaPattern.exec(release.tag_name)
        if (match) maxM = Math.max(maxM, Number(match[1]))
      }
      version = `${process.env.CORE}-horca.${nextN}-beta.${maxM + 1}`
      prev = byCreated(betas)[0] ?? byCreated(stableReleases)[0]
    } else {
      version = `${process.env.CORE}-horca.${nextN}`
      prev = byCreated(stableReleases)[0]
    }
    const marker = (name) =>
      prev ? ((prev.body ?? "").match(new RegExp(`^${name}: ([0-9a-f]{40})$`, "m")) || [])[1] ?? "" : ""
    process.stdout.write(
      [version, prev ? prev.tag_name : "", marker("Source-SHA"), marker("Upstream-SHA")].join("\n")
    )
  })
' <<<"$releases_ndjson")
version=$(sed -n 1p <<<"$release_meta")
prev_tag=$(sed -n 2p <<<"$release_meta")
prev_source=$(sed -n 3p <<<"$release_meta")
prev_upstream=$(sed -n 4p <<<"$release_meta")
tag="v$version"

# --- Changelog sections ------------------------------------------------------
upstream_section=""
horca_range_excludes=("^$UPSTREAM_SHA")
if [ -z "$prev_tag" ]; then
  upstream_section="First Horca release. Built on upstream \`stablyai/orca\` at \`$UPSTREAM_SHA\`."
else
  if [ -n "$prev_upstream" ] && [ "$prev_upstream" != "$UPSTREAM_SHA" ]; then
    upstream_section="Upstream moved \`$prev_upstream\` → \`$UPSTREAM_SHA\`: https://github.com/stablyai/orca/compare/$prev_upstream...$UPSTREAM_SHA"
  else
    upstream_section="No upstream changes since $prev_tag (upstream at \`$UPSTREAM_SHA\`)."
  fi
  # Fork main is never rebased, so the previous release's source commit must
  # still exist; if it does not, fall back to listing every personal commit.
  if [ -n "$prev_source" ] && git rev-parse --verify --quiet "$prev_source^{commit}" >/dev/null; then
    horca_range_excludes+=("^$prev_source")
  fi
fi

horca_commits=$(git log --format='- %s (%h)' "$SOURCE_SHA" "${horca_range_excludes[@]}")
if [ -z "$horca_commits" ]; then
  horca_commits="- No Horca-only changes in this release."
fi

if [ "$CHANNEL" = "beta" ]; then
  notes_headers="Source-Repo: rudironsoni/orca
Source-SHA: $SOURCE_SHA
Upstream-SHA: $UPSTREAM_SHA
Channel: beta
Branch: ${HORCA_BRANCH:-}"
  brew_cask="rudironsoni/tap/horca@beta"
else
  notes_headers="Source-Repo: rudironsoni/orca
Source-SHA: $SOURCE_SHA
Upstream-SHA: $UPSTREAM_SHA"
  brew_cask="rudironsoni/tap/horca"
fi

# --- Notes body ---------------------------------------------------------------
cat >"$NOTES_PATH" <<EOF
$notes_headers

## Upstream changes

$upstream_section

## Horca changes

$horca_commits

## Signing status

- macOS: Developer ID signed and notarized.
- Windows: **unsigned**. SmartScreen will warn on first run — choose "More info" → "Run anyway".

## Install

- macOS: \`brew install --cask $brew_cask\`, or download the DMG for your architecture.
- Windows: download and run \`horca-windows-x64-setup.exe\`.

The in-app updater is intentionally disabled for Horca; update via Homebrew or these releases.
EOF

emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1=$2" >>"$GITHUB_OUTPUT"
  fi
  echo "$1=$2"
}
emit version "$version"
emit tag "$tag"
emit source_sha "$SOURCE_SHA"
emit upstream_sha "$UPSTREAM_SHA"
