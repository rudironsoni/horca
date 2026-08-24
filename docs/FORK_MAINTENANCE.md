# Fork maintenance

This fork ships a personal downstream distribution named **Horca** —
side-by-side installable with official Orca on macOS and Windows, built from
this repository's `main` when `ORCA_DOWNSTREAM_BUILD=1` is set at build time.
The identity contract, state isolation rules, updater gating, and
official-service audit live in
[`reference/horca-distribution.md`](./reference/horca-distribution.md).
Horca GitHub Releases live on this repository and are tagged only
`v<upstream-core>-horca.<N>` (example: `v1.4.178-horca.1`). Never create a
plain `vX.Y.Z` tag — those belong to the mirrored upstream desktop
namespace and are copied here as git tags, not GitHub Releases.

This fork keeps two long-lived branches:

- `upstream-main` is a read-only mirror of `stablyai/orca:main`.
- `main` is the personal distribution and may contain fork-only changes.

Never commit to `upstream-main`, merge `main` into it, or use it as a development
branch. The invariant is:

```text
rudironsoni/orca:upstream-main == stablyai/orca:main
```

Updates flow one way:

```text
stablyai/orca:main
        |
        | hourly fast-forward mirror (Sync Upstream Main)
        v
rudironsoni/orca:upstream-main
        |
        | merge PR, never rebase
        v
rudironsoni/orca:main
        |
        + fork-only maintenance commits
```

## Never rewrite main

`main` is a published, long-lived branch. Never rebase it, never force-push it,
and never "clean up" its history. Update it only by merging — normal PRs and
`upstream-main` merge PRs — so existing commits are always preserved.

This is not theoretical. On 2026-08-20 `main` was rebased onto upstream, which
silently deleted the fork-maintenance work from PRs #7, #8, and #9 (including
this document); PR #11 had to restore the workflow pieces. A merge of
`origin/upstream-main` would have absorbed the same upstream commits without
destroying anything.

Temporary contribution branches may still be rebased (see below). The
prohibition applies to long-lived published branches: `main` and
`upstream-main`.

## The sync workflow

The scheduled `Sync Upstream Main` workflow lives only on personal `main`. It
runs hourly at minute 17 (plus manual dispatch) and does three things:

1. Fast-forwards `upstream-main` to `stablyai/orca:main`. It refuses to push
   anything that is not a fast-forward; a rejected push means history diverged
   and a human must look.
2. Mirrors upstream desktop release tags (`refs/tags/v*`), excluding
   `*-horca.*` so a fork-only Horca tag can never be treated as an upstream
   desktop tag. The Skill update round trip check resolves `v<appVersion>`
   tags from `resources/skills/release-mapping.json` and fails on a fork
   missing them. Tags present in both repositories are compared by object
   id: a divergent tag fails the run loudly and is never overwritten.
3. Opens an `upstream-main -> main` merge PR when the mirror is ahead of
   `main`. `Merge upstream sync PR` merges it with a merge commit after the
   required `PR Checks / verify` result succeeds.

The merge workflow runs when `PR Checks` completes and reconciles open sync PRs
hourly at minute 37. The reconciliation path picks up an already-green PR when
the workflow is first installed or an event is missed. It revalidates the
repository, same-repository `upstream-main -> main` refs, exact head SHA,
successful `verify` result, and mergeability immediately before merging.
Failed checks, conflicts, changed heads, and missing credentials leave the PR
open.

The workflow authenticates with `secrets.UPSTREAM_SYNC_TOKEN` when configured,
falling back to the default Actions token. The default token cannot push tags
whose history touches `.github/workflows` (GitHub rejects them without the
`workflows` permission) and PRs it creates do not trigger PR CI. Configure
`UPSTREAM_SYNC_TOKEN` as a fork-owned fine-grained PAT with contents,
workflows, and pull-requests write on this repository to lift both limits. The
merge workflow requires this PAT rather than falling back to `GITHUB_TOKEN`, so
the resulting push to `main` triggers normal downstream workflows.

Do not add the sync workflow, or other fork-only files, to `upstream-main`.

Upstream-only workflows that need Stably secrets or write to Stably projects
(`track-community-prs`, release, Homebrew, signed builds) stay scoped to
`stablyai/orca` so they do not fail on this fork. Official `release-cut.yml`
and `release-mac-build.yml` stay official-only; Horca publishing uses the
fork-only workflows below.

## Horca releases

Horca jobs run only on `rudironsoni/orca` (`if: github.repository ==
'rudironsoni/orca'`). A further fork does not inherit notarized publishing.
`releases/latest` on this repository is the latest Horca release. Version
math and detectors filter `/^v\d+\.\d+\.\d+-horca\.\d+$/` only.

| Workflow | Purpose |
| --- | --- |
| `horca-build.yml` | Prove or produce the three verified artifacts. Dispatch or `workflow_call` only — never `push` to `main`, never PR Checks. |
| `horca-release.yml` | Runs on every push to `main`. Compute `v<core>-horca.<N>`, call the build, then draft → 3 assets → undraft. The git tag is `--target` the source commit. Concurrent runs queue. |
| `horca-check-source.yml` | Backup every 6 hours: compare `main` HEAD to the latest Horca release `Source-SHA`. Unchanged → Linux-only exit. Changed → call `horca-release.yml`. Refuses to bootstrap if no Horca release exists yet. |

Homebrew staging lives in `config/horca-homebrew/` and is copied once into
`rudironsoni/homebrew-tap`. The tap stays a separate repository; its bump
workflow already pulls from GitHub Releases on this repo.

### Runbook

1. Copy these Actions secrets from `rudironsoni/orca-builds` onto this
   repository (same names). The macOS job fail-closes if any are missing:
   `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
2. Prove the pipeline without publishing: Actions → **Build Horca** → Run
   workflow. Required input: Horca version (`<core>-horca.N`, matching
   `package.json` at the SHA). Optional: commit SHA (defaults to the
   dispatched ref).
3. A merge to `main` starts **Release Horca** (including the merge that
   lands this trigger). Dispatch remains available. Hourly
   `upstream-main` merges also cut a release.
4. `horca-check-source.yml` is a backup if a push event is missed. It
   still will not bootstrap a first release by itself.
5. After the first in-repo release is verified, archive
   `rudironsoni/orca-builds` (do not delete) and close leftover packaging
   PRs there.

## Branch protection

Use active branch rulesets with no bypass actors.

Protect `main` with:

- "Restrict deletions" and "Block force pushes".
- "Require a pull request before merging" with zero required approvals.
- The unique GitHub Actions `verify` status check. Do not require the branch to
  be up to date; updating an `upstream-main -> main` PR would contaminate the
  mirror.
- "Require a merge type" with only "Merge" allowed. Squash and rebase merges
  do not make the upstream commits ancestors of `main`.

Leave linear history, merge queue, signed commits, deployments, branch locking,
and update restrictions off for `main`.

Protect `upstream-main` with only "Restrict deletions" and "Block force
pushes". Do not require PRs, checks, a merge type, or update restrictions: the
sync workflow must keep making ordinary fast-forward pushes.

Keep "Always suggest updating pull request branches" off. After both rulesets
are active, enable "Automatically delete head branches"; deletion protection
keeps the long-lived `upstream-main` PR head intact.

A human-owned PAT cannot distinguish an accidental manual fast-forward from the
sync workflow. Such a push makes the next sync fail loudly if it diverges from
upstream. A dedicated GitHub App plus an update restriction is optional future
hardening.

Configuring rulesets requires repository admin access (Settings → Rules →
Rulesets), which automation tokens on this fork do not have.

Before opening an upstream pull request, read
[`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) on current
`stablyai/orca:main`.

## Remotes

Use `origin` for `rudironsoni/orca` and `upstream` for `stablyai/orca`:

```bash
git remote -v
git remote add upstream git@github.com:stablyai/orca.git
git fetch origin
git fetch upstream
```

Add `upstream` only if it does not already exist.

## Update the upstream mirror manually

```bash
git fetch upstream
git push origin upstream/main:refs/heads/upstream-main
```

This push must remain fast-forward only. Do not add `--force`. If it fails,
inspect the branch history instead of rewriting the mirror.

## Update personal main

Use the automated `upstream-main -> main` PR; CI selects the merge-commit method
after `verify` passes. Direct pushes, squash merges, and rebase merges into
published `main` are not allowed.

### Resolve an upstream merge conflict

Do not use GitHub's conflict editor on the direct merge PR, and never merge
`main` into `upstream-main`. Resolve on a temporary branch instead:

```bash
git fetch origin
git switch -c sync/upstream-YYYY-MM-DD origin/main
git merge --no-ff origin/upstream-main
# Resolve conflicts, then complete the merge commit.
git push -u origin sync/upstream-YYYY-MM-DD
```

Open `sync/upstream-YYYY-MM-DD -> main` and merge it after `verify` passes. The
temporary merge commit contains the real `upstream-main` SHA as an ancestor
without changing the mirror.

When both sides independently landed the same edit, take the `upstream-main`
version. A leftover one-line fork delta is enough to conflict the next time
the mirror touches that file. PR #52 stalled this way: fork PR #33 and
upstream #15166 both wrapped `expectSingleOwningPty` in
`tests/e2e/helpers/startup-exec-readiness-oracle.ts`, and Git stopped on the
timeout (`RECOVERY_DEADLINE_MS` vs `30_000`). The helper now matches the
mirror again.

### Keep overlays off high-churn upstream files

Do not leave long-lived patches in files `upstream-main` also owns under
`tests/e2e/`. Put fork-only specs, fixtures, and timing wrappers in new files
the mirror never touches.

`config/scripts/fork-upstream-overlay-guard.mjs` is the ratchet:

- Dual-tree diffs must stay on its overlay allowlist.
- Files that exist only on personal `main` must stay on its fork-only list.
- Dual-tree patches under `tests/e2e/` are denied even if someone adds them
  to the allowlist.

Hourly `Sync Upstream Main` runs the guard against `origin/main` and
`origin/upstream-main` so a new helper overlay fails before it can dirty the
next merge PR. Update the lists in the same commit as a new Horca file or an
accepted overlay.

## Start fork-specific work

```bash
git switch main
git pull --ff-only origin main
git switch -c personal/<descriptive-name>
```

The `personal/` prefix identifies fork-only work but is not enforced.

## Start an upstream contribution

Read the current upstream contribution guide before starting. Base contribution
branches on current upstream history, never on customized `main`:

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

Rebasing keeps a temporary contribution focused on current upstream history.
Merging is preferred for personal `main` because it preserves the published
history other work may already depend on.

When a contribution is also wanted in the personal distribution, prefer to let
it return through upstream after acceptance and the normal mirror-to-main flow.
Upstream may squash or rewrite the pull request commits. Cherry-pick it into
`main` only when immediate inclusion is a deliberate choice.
