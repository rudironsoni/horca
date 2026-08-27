# Fork maintenance

This fork ships a personal downstream distribution named **Horca** —
side-by-side installable with official Orca on macOS, Windows, and Linux,
built when `ORCA_DOWNSTREAM_BUILD=1` is set at build time. Identity lives in
[`reference/horca-distribution.md`](./reference/horca-distribution.md).

`main` is `stablyai/orca:main` plus a linear Horca patch stack. Never merge
upstream into `main`. Routine catch-up is a rebase of that stack onto
`upstream/main` on a `chore/rebase-upstream-<sha>` candidate. Promote to
`main` only with `--force-with-lease` from the **Horca Maintenance** GitHub
App (the only ruleset bypass actor).

Carried upstream patches (today: Claude Keychain SSO,
[stablyai/orca#16673](https://github.com/stablyai/orca/pull/16673)) are listed
in [`horca-carried-patches.json`](../config/horca-carried-patches.json). Drop a patch
only when `git range-diff` vs upstream is empty.

Immutable backup of the pre-rebuild `main`: tag
`archive/pre-maintainable-fork-2026-08-27`.

Fetch Horca tags with `--no-prune-tags`. Upstream `v*` tags belong in
`refs/upstream-tags/v*`, never in `refs/tags/*`.

## History

Checkpoint A rebuilt `chore/rebuild-patch-stack` from current upstream plus
classified Horca commits. Do not replay PRs #82 / #85 (single-parent
squashes) or mixed commits `cff117f9ed`, `f609f65a42`, `872641fad7`.

Older squash/rebase tags (`horca/pre-squash-*`) remain recovery points.

## Sync

`.github/workflows/horca_maintenance.yml` runs daily. It fetches with
`--no-prune-tags`, disables unused Actions workflows, runs the overlay
guard, and rebases a `chore/rebase-upstream-<sha>` candidate when Git can
do that with no conflicts. Conflicts open or update one `sync-conflict`
issue and leave `main` untouched.

Never merge `main` into upstream. Never open a GitHub PR that contains
upstream's history (issue #64 / PR #65).

```bash
git fetch --prune --no-prune-tags origin
git fetch --prune --no-prune-tags upstream
git switch -c chore/rebase-upstream-$(git rev-parse --short upstream/main) origin/main
git rebase upstream/main
# Take upstream unless the hunk is Horca identity or the Herdr composition root.
```

Do not use a review PR as the vehicle for catching `main` up to upstream.

Do not leave long-lived patches under `tests/e2e/` or
`src/renderer/src/i18n/locales/`. Dual-tree edits there caused PR #52 and
issue #64. New fork specs and Horca-only copy belong in files upstream does
not own (`src/shared/distribution-update-copy.ts` for updater strings;
`config/electron-builder-downstream.cjs` for packaging identity).
`config/scripts/fork-upstream-overlay-guard.mjs` is the ratchet: overlays
must stay on its allowlist, fork-only files on its fork-only list or prefix,
and overlays under `tests/e2e/` plus locale JSON are denied. New files in
those trees may be listed as fork-only.
Pull requests into `main` run `.github/workflows/horca_overlay_guard.yml` (not
`pull_request_target`). PRs into other branches skip that tree-wide compare
so in-flight feature work is not blocked by overlays the base already has.

When both sides independently landed the same edit, take the upstream
version. A leftover one-line fork delta is enough to conflict the next time
upstream touches that file.

## Tag mirror

Fork Shepherd does not copy tags. `.github/workflows/horca_mirror_upstream_v_tags.yml`
copies `refs/tags/v*` from `stablyai/orca` by object id, never force-updates,
and skips `v*-horca.N`. The Skill update round-trip resolves `v<appVersion>`
from `resources/skills/release-mapping.json` and fails when those tags are
missing.

## Horca releases

Horca jobs run only on `rudironsoni/orca`. A further fork does not inherit
notarized publishing. `releases/latest` on this repository is the latest
**stable** Horca release. Stable version math and detectors filter
`/^v\d+\.\d+\.\d+-horca\.\d+$/` only (betas never increment that N). Commits
whose **subject** (first line) contains `[skip horca-release]` skip both the
stable release and a beta; `[skip horca-beta]` skips only the beta workflow.
A token only in the squash-merge body does not skip.

| Workflow                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `horca_build.yml`        | Dispatch / `workflow_call` only. Produces the three verified artifacts. Never PR Checks. Not started by push to `main` (that double-notarized with `horca_release.yml`). Accepts `<core>-horca.<N>` or `<core>-horca.<N>-beta.<M>`. Apple secrets are optional at the call boundary.                                                                                                                                                                   |
| `horca_release.yml`      | Runs on every push to `main`. Compute `v<core>-horca.<N>` from the newest `stablyai/orca` main commit actually contained by the source SHA, call the build, draft → 3 assets → undraft, then call `horca_bump_cask.yml` (`cask_token: horca`) and wait. Concurrent runs queue.                                                                                                                                                                         |
| `horca_beta_release.yml` | Runs on push to `feature/**`, `feat/**`, `fix/**`, `bugfix/**`, `hotfix/**`, `perf/**`, `refactor/**` (not `main`, `cursor/**`, `chore/**`, `docs/**`, `ci/**`, `test/**`, `style/**`, `personal/**`, `release/**`). Compute `v<core>-horca.<nextN>-beta.<M>`, call the build, publish `--prerelease`, then bump `horca@beta` with `allow_push_failure: true` so a tap 403 does not fail the branch. Force-push cancels the in-flight run.                                                                                   |
| `horca_bump_cask.yml`    | Dispatch / `workflow_call` only. After a published Horca tag, rewrites `rudironsoni/homebrew-tap` `Casks/${cask_token}.rb` (version + sha256) and pushes. `cask_token` is `horca` or `horca@beta`. A missing tap file is copied from `config/horca-homebrew/Casks/`. Registers the tap checkout under Homebrew's `Library/Taps` before `brew style`/`brew audit` (Homebrew rejects bare cask paths). `FORK_SYNC_PAT` must be able to push to that tap. Beta passes `allow_push_failure`; stable still fails the job on a denied push. |
| `horca_check_source.yml` | Backup every 6 hours: compare `main` HEAD to the latest **stable** Horca release `Source-SHA`. Unchanged → Linux-only exit. Changed → call `horca_release.yml`. Refuses to bootstrap if no Horca release exists yet. Does not follow betas.                                                                                                                                                                                                            |

Release attaches the build workflow's Actions artifacts to this repository's GitHub Release; it does not package again.

Homebrew staging lives in `config/horca-homebrew/` and is copied once into
`rudironsoni/homebrew-tap`. The tap stays a separate repository. Release
Horca calls `.github/workflows/horca_bump_cask.yml` (same `uses:` wait as
the build) so `Casks/horca.rb` matches the stable tag that just shipped.
Release Horca beta does the same for `Casks/horca@beta.rb` (`conflicts_with
cask: "horca"`). The tap's own scheduled copy remains a 6-hour backup: it
polls stable `v*-horca.*` into `horca.rb` and prerelease
`v*-horca.*-beta.*` into `horca@beta.rb` (never `/releases/latest`). The
cask URL is `rudironsoni/orca`, never `orca-builds`. Install beta with
`brew install --cask rudironsoni/tap/horca@beta`.

### Runbook

1. Apple notarization secrets live on this repository:
   `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The macOS job fail-closes
   if any are missing.
2. Prove the pipeline without publishing: Actions → **Horca: Build** → Run
   workflow. Optional inputs: Horca version (`<core>-horca.N` or
   `<core>-horca.N-beta.M`) and commit SHA.
3. A merge (or Shepherd push) to `main` starts **Horca: Release** only.
   After the GitHub Release is undrafted, that run calls **Horca: Bump cask**
   (`horca`) and waits. Dispatch remains available.
4. A push to a conventional `feature/**` / `fix/**` / `hotfix/**` / … branch
   starts **Horca: Release beta**. `[skip horca-beta]` or `[skip horca-release]`
   in the commit subject (first line) skips it. A token only in the squash
   body does not. Dispatch remains available.
5. `horca_check_source.yml` is a backup if a push event is missed. It
   still will not bootstrap a first release by itself, and it ignores betas.

## Secrets, labels, rulesets

Applied by `.github/workflows/horca_repo_admin.yml` using `FORK_SYNC_PAT`
(dispatch, or when that workflow file itself is pushed).

- Secret `FORK_SYNC_PAT` only (no `UPSTREAM_SYNC_TOKEN` fallback): Contents +
  Issues + PRs write; **Administration** write for rulesets and the
  auto-delete toggle; **Workflows** write so Shepherd can push upstream merges
  that touch `.github/workflows`. Same token on checkout and the action. The
  default `GITHUB_TOKEN` cannot push workflow files and PRs it creates do not
  trigger PR CI. The token must also be able to push to
  `rudironsoni/homebrew-tap` so Release Horca can bump the cask.
- Labels: `sync-conflict` (cleanup), `sync-bot` (unused while PR monitor is
  off), `backport-to-*` as needed.
- Ruleset on `main` (`refs/heads/main`): **block force-push** and **restrict
  deletions**. Do **not** require a pull request (Shepherd must push merge
  commits). Do not add an `update` rule (that blocks every push, including
  Shepherd). No bypass. "Automatically delete head branches" stays off.

Configuring rulesets: Settings → Rules → Rulesets.

## Remotes

Use `origin` for `rudironsoni/orca` and `upstream` for `stablyai/orca`:

```bash
git remote -v
git remote add upstream git@github.com:stablyai/orca.git
git fetch origin
git fetch upstream
```

Add `upstream` only if it does not already exist.

## Start fork-specific work

```bash
git switch main
git pull --ff-only origin main
git switch -c personal/<descriptive-name>
```

The `personal/` prefix identifies fork-only work but is not enforced.

## Start an upstream contribution

Read [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) on current
`stablyai/orca:main` before starting. Base contribution branches on current
upstream history, never on customized `main`:

```bash
git fetch upstream
git switch -c fix/<descriptive-name> upstream/main
```

Use `feat/<descriptive-name>` or another descriptive prefix when appropriate.
Open the pull request with `stablyai/orca:main` as the base and the fork branch
as the head.

## Refresh an upstream contribution

Temporary contribution branches may be rebased:

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease
```

Never use unrestricted `--force`.

When a contribution is also wanted in the personal distribution, prefer to let
it return through upstream after acceptance and the normal Shepherd merge.
Upstream may squash or rewrite the pull request commits. Cherry-pick it into
`main` only when immediate inclusion is a deliberate choice.
