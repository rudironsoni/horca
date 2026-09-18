# Horca releases

Horca publishes stable and beta channels through GitHub Releases and
`rudironsoni/homebrew-tap`. Release tags are internal immutable identifiers.
People do not create or manage them.

A release always starts from a Horca source commit. It materializes the pinned
Orca revision from `upstream.lock.json`, applies declared overlays, then signs
and notarizes macOS DMGs. The job does not use a developer `.cache/worktrees`
directory.

## Stable

Each successful push to Horca `main` starts `Horca: Stable Release` with
publish enabled. The workflow validates the exact source SHA, materializes
pinned Orca, builds signed and notarized macOS DMGs, creates
`v<orca-core>-horca.<N>`, and publishes the GitHub release. The core is the
latest Orca stable GitHub release, not Horca `package.json` (`0.0.1`). The
Horca Maintenance App then dispatches an immediate update of `Casks/horca.rb`.

Stable omits Windows until Horca has its own Windows signing certificate.

Install or upgrade stable:

```bash
brew install --cask rudironsoni/tap/horca
brew upgrade --cask rudironsoni/tap/horca
```

## Rehearsal

Run `Horca: Stable Release` from GitHub Actions on a feature branch. Leave
`publish` unchecked (false). The job uses the real signing and notarization
secrets, uploads DMGs plus `horca-release.json` and `SHA256SUMS` as workflow
artifacts, and does not create a tag, GitHub Release, or Homebrew dispatch.

A feature-branch push does not start the stable pipeline.

## Beta

Run `Horca: Beta Release` in GitHub Actions. Enter a non-main branch name or an
exact 40-character commit SHA from this repository. The workflow rejects the
current `main` SHA, validates the selected commit, creates
`v<orca-core>-horca-beta.<N>`, and updates `Casks/horca@beta.rb`.

Beta publishes signed and notarized macOS builds only.

Install beta:

```bash
brew install --cask rudironsoni/tap/horca@beta
```

Stable and beta conflict, so uninstall one channel before installing the other.

## Recovery

Release allocation is idempotent by source SHA. A rerun reuses an existing tag.
If the GitHub release already exists, a publishing run exits without rebuilding
it. A rehearsal never takes that shortcut.

The tap also checks both channels at `0 * * * *` and can be run manually. The
hourly run repairs a missed dispatch. The tap never selects a version by
publication date, never downgrades a cask, and validates release checksums
before it changes `main`.

Required Horca repository secrets:

- `MAC_CERTS`
- `MAC_CERTS_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `HORCA_APP_ID` and `HORCA_APP_PRIVATE_KEY` in the `horca-maintenance`
  environment. The App installation needs access to `rudironsoni/homebrew-tap`.
