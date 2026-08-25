# Fork maintenance

This fork ships a personal downstream distribution named **Horca** —
side-by-side installable with official Orca on macOS and Windows, built from
this repository's `main` when `ORCA_DOWNSTREAM_BUILD=1` is set at build time.
The identity contract, state isolation rules, updater gating, and
official-service audit live in
[`reference/horca-distribution.md`](./reference/horca-distribution.md).
Horca GitHub Releases live on this repository. Stable tags are
`v<upstream-core>-horca.<N>` (example: `v1.4.178-horca.1`). Betas are
GitHub prereleases tagged `v<core>-horca.<N>-beta.<M>` (example:
`v1.4.178-horca.2-beta.1`) and never become `/releases/latest`. Never create a
plain `vX.Y.Z` tag — those belong to the mirrored upstream desktop
namespace and are copied here as git tags, not GitHub Releases.

## History

`main` is `stablyai/orca:main` plus **one** Horca commit, then whatever merge
commits [Fork Shepherd](https://github.com/FasterApiWeb/fork-shepherd) adds
when it syncs upstream. GitHub will not stay at "1 commit ahead" forever;
each upstream merge is a merge commit. That is expected.

There is no `upstream-main` mirror. Shepherd syncs the same-named branch
(`stablyai/orca` `main` → this fork's `main`). Do not recreate the old
two-branch sync.

A squash (2026-08-24), a rebase (2026-08-25), and another squash (2026-08-25)
each reset `main` to `stablyai/orca:main` plus **one** Horca commit. Pre-rewrite
tips are tagged `horca/pre-squash-YYYYMMDD` / `horca/pre-rebase-YYYYMMDD`.
Shepherd merge commits will make GitHub show more than "1 ahead"; squash
again only when that one-commit shape is requested. Restore the tag only if
the rewrite must be undone.

On 2026-08-20 a rebase of `main` deleted fork-maintenance work from PRs #7,
#8, and #9. The squash/rebase tags are the documented exceptions to
"never rewrite main."

## Fork Shepherd

`.github/workflows/fork-shepherd.yml` runs only on `rudironsoni/orca`
(`if: github.repository == 'rudironsoni/orca'`). It is pinned to
`FasterApiWeb/fork-shepherd@v1` and uses one PAT for checkout and the
action: `secrets.FORK_SYNC_PAT`.

| Feature | When | What it does |
| --- | --- | --- |
| Branch sync | hourly `:17`, `workflow_dispatch` | Merges `stablyai/orca` `main` into `main` (`merge_strategy: merge`) |
| PR monitor | off | `fork-shepherd@v1` `get_open_prs` writes a notice to stdout, then parses that line as a PR (`origin/open`, exit 128). See [FasterApiWeb/fork-shepherd#1](https://github.com/FasterApiWeb/fork-shepherd/issues/1). |
| Backport | `pull_request_target` closed (merged) | Copies a merged PR onto branches named by `backport-to-<branch>` labels |
| Cleanup | schedule / dispatch / push to `main` | Closes stale `sync-conflict` issues when the conflict is gone |
| Overlay ratchet | schedule / dispatch only | Fetches `stablyai/orca` `main` and fails the job if overlays grew |

Shepherd does **not** run `PR Checks / verify` before merging upstream.
Safety is: conflicts → `sync-conflict` issue; overlay guard; push-to-main CI.

Backport is a no-op until a merged PR is labeled `backport-to-<existing-branch>`.

### Conflicts

Shepherd opens a `sync-conflict` issue and leaves `main` untouched. Never
merge `main` into upstream, and never open a GitHub PR that contains
upstream's history — GitHub will count every upstream line as this fork's
diff (issue #64 / PR #65). Replay the one Horca commit onto current
`stablyai/orca` `main` instead:

```bash
git fetch origin
git fetch https://github.com/stablyai/orca.git main
git switch -c sync/upstream-YYYY-MM-DD origin/main
git rebase --onto FETCH_HEAD origin/main^
# Resolve conflicts. Take upstream unless the hunk is Horca identity.
# Prefer moving identity into fork-only files over leaving hunks in
# high-churn upstream files.
```

If overlays still apply cleanly, let Shepherd merge. Do not use a review PR
as the vehicle for catching `main` up to upstream.

Do not leave long-lived patches under `tests/e2e/` or
`src/renderer/src/i18n/locales/`. Dual-tree edits there caused PR #52 and
issue #64. New fork specs and Horca-only copy belong in files upstream does
not own (`src/shared/distribution-update-copy.ts` for updater strings;
`config/electron-builder-downstream.cjs` for packaging identity).
`config/scripts/fork-upstream-overlay-guard.mjs` is the ratchet: overlays
must stay on its allowlist, fork-only files on its fork-only list, and
`tests/e2e/` plus locale JSON are denied even if added to the allowlist.
Pull requests run `.github/workflows/fork-overlay-guard.yml` (not
`pull_request_target`).

When both sides independently landed the same edit, take the upstream
version. A leftover one-line fork delta is enough to conflict the next time
upstream touches that file.

## Tag mirror

Fork Shepherd does not copy tags. `.github/workflows/mirror-upstream-v-tags.yml`
copies `refs/tags/v*` from `stablyai/orca` by object id, never force-updates,
and skips `v*-horca.N`. The Skill update round-trip resolves `v<appVersion>`
from `resources/skills/release-mapping.json` and fails when those tags are
missing.

## Horca releases

Horca jobs run only on `rudironsoni/orca`. A further fork does not inherit
notarized publishing. `releases/latest` on this repository is the latest
**stable** Horca release. Stable version math and detectors filter
`/^v\d+\.\d+\.\d+-horca\.\d+$/` only (betas never increment that N). Commits
whose message contains `[skip horca-release]` skip both the stable release
and a beta; `[skip horca-beta]` skips only the beta workflow.

| Workflow | Purpose |
| --- | --- |
| `horca-build.yml` | Dispatch / `workflow_call` only. Produces the three verified artifacts. Never PR Checks. Not started by push to `main` (that double-notarized with `horca-release.yml`). Accepts `<core>-horca.<N>` or `<core>-horca.<N>-beta.<M>`. Apple secrets are optional at the call boundary. |
| `horca-release.yml` | Runs on every push to `main`. Compute `v<core>-horca.<N>` from the newest `stablyai/orca` main commit actually contained by the source SHA, call the build, draft → 3 assets → undraft, then call `bump-horca-cask.yml` (`cask_token: horca`) and wait. Concurrent runs queue. |
| `horca-beta-release.yml` | Runs on push to `feature/**`, `feat/**`, `fix/**`, `bugfix/**`, `hotfix/**`, `perf/**`, `refactor/**` (not `main`, `cursor/**`, `chore/**`, `docs/**`, `ci/**`, `test/**`, `style/**`, `personal/**`, `release/**`). Compute `v<core>-horca.<nextN>-beta.<M>`, call the build, publish `--prerelease`, then bump `horca@beta`. Force-push cancels the in-flight run. |
| `bump-horca-cask.yml` | Dispatch / `workflow_call` only. After a published Horca tag, rewrites `rudironsoni/homebrew-tap` `Casks/${cask_token}.rb` (version + sha256) and pushes. `cask_token` is `horca` or `horca@beta`. A missing tap file is copied from `config/horca-homebrew/Casks/`. `FORK_SYNC_PAT` must be able to push to that tap. |
| `horca-check-source.yml` | Backup every 6 hours: compare `main` HEAD to the latest **stable** Horca release `Source-SHA`. Unchanged → Linux-only exit. Changed → call `horca-release.yml`. Refuses to bootstrap if no Horca release exists yet. Does not follow betas. |

Release attaches the build workflow's Actions artifacts to this repository's GitHub Release; it does not package again.

Homebrew staging lives in `config/horca-homebrew/` and is copied once into
`rudironsoni/homebrew-tap`. The tap stays a separate repository. Release
Horca calls `.github/workflows/bump-horca-cask.yml` (same `uses:` wait as
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
2. Prove the pipeline without publishing: Actions → **Build Horca** → Run
   workflow. Optional inputs: Horca version (`<core>-horca.N` or
   `<core>-horca.N-beta.M`) and commit SHA.
3. A merge (or Shepherd push) to `main` starts **Release Horca** only.
   After the GitHub Release is undrafted, that run calls **Bump horca cask**
   (`horca`) and waits. Dispatch remains available.
4. A push to a conventional `feature/**` / `fix/**` / `hotfix/**` / … branch
   starts **Release Horca beta**. `[skip horca-beta]` or `[skip horca-release]`
   in the commit message skips it. Dispatch remains available.
5. `horca-check-source.yml` is a backup if a push event is missed. It
   still will not bootstrap a first release by itself, and it ignores betas.

## Secrets, labels, rulesets

Applied by `.github/workflows/horca-repo-admin.yml` using `FORK_SYNC_PAT`
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
